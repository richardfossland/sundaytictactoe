-- ===================== 0000_schema_init.sql =====================
-- SundayTicTacToe lives in a DEDICATED `tictactoe` schema on the SHARED Supabase
-- project (the same project hosts SundayChess on `public`, plus harvest/market/
-- turnering on their own schemas). Every following migration is schema-qualified
-- to `tictactoe`.
--
-- IMPORTANT (one-time, on the hosted project): add `tictactoe` to the project's
-- Exposed schemas (Dashboard → Project Settings → API → Exposed schemas), or
-- every PostgREST request from the app returns PGRST106 "schema must be one of…".
create schema if not exists tictactoe;

-- ===================== 0001_schema.sql =====================
-- SundaySjakk schema. Code-identity (no church_id / no tenancy).
-- RLS is enabled on every table with NO anon/authenticated policies: clients
-- never touch tables directly. All reads/writes go through server API routes
-- using the service role (which bypasses RLS). Realtime broadcast/presence is
-- channel-authorised separately and carries no table data. (spec §8)

-- ---------- updated_at trigger ----------
create or replace function tictactoe.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- tournaments ----------
create table tictactoe.tournaments (
  id            uuid primary key default gen_random_uuid(),
  join_pin      text not null unique,
  host_code     text not null,
  host_user_id  uuid,
  title         text,
  status        text not null default 'lobby'
                  check (status in ('lobby','league','playoff','finished')),
  config        jsonb not null default '{}'::jsonb,
  current_round int not null default 0,
  created_at    timestamptz not null default now()
);
create index tournaments_join_pin_idx on tictactoe.tournaments (join_pin);

-- ---------- players ----------
create table tictactoe.players (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tictactoe.tournaments (id) on delete cascade,
  display_name  text not null,
  resume_code   text not null,
  score         numeric not null default 0,
  tiebreak      numeric not null default 0,
  status        text not null default 'active' check (status in ('active','left')),
  seed          int,
  joined_at     timestamptz not null default now(),
  unique (tournament_id, resume_code)
);
create index players_tournament_idx on tictactoe.players (tournament_id);

-- ---------- rounds ----------
create table tictactoe.rounds (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tictactoe.tournaments (id) on delete cascade,
  number        int not null,
  phase         text not null default 'league' check (phase in ('league','playoff')),
  status        text not null default 'pairing' check (status in ('pairing','live','done')),
  started_at    timestamptz,
  unique (tournament_id, phase, number)
);
create index rounds_tournament_idx on tictactoe.rounds (tournament_id);

-- ---------- games ----------
create table tictactoe.games (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references tictactoe.tournaments (id) on delete cascade,
  round_id        uuid not null references tictactoe.rounds (id) on delete cascade,
  white_player_id uuid not null references tictactoe.players (id),
  black_player_id uuid references tictactoe.players (id),   -- null = bye
  fen             text not null,
  pgn             text not null default '',
  status          text not null default 'live'
                    check (status in ('live','white_win','black_win','draw','bye','aborted')),
  result_source   text check (result_source in ('play','teacher_override','bye','timeout_draw')),
  turn            text not null default 'w' check (turn in ('w','b')),
  updated_at      timestamptz not null default now()
);
create index games_round_idx on tictactoe.games (round_id);
create index games_tournament_idx on tictactoe.games (tournament_id);
create index games_players_idx on tictactoe.games (white_player_id, black_player_id);

create trigger games_set_updated_at
  before update on tictactoe.games
  for each row execute function tictactoe.set_updated_at();

-- ---------- moves (append-only audit / replay) ----------
create table tictactoe.moves (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references tictactoe.games (id) on delete cascade,
  ply           int not null,
  san           text not null,
  fen_after     text not null,
  by_player_id  uuid not null references tictactoe.players (id),
  created_at    timestamptz not null default now(),
  unique (game_id, ply)
);
create index moves_game_idx on tictactoe.moves (game_id);

-- ---------- RLS: lock everything to the service role ----------
alter table tictactoe.tournaments enable row level security;
alter table tictactoe.players     enable row level security;
alter table tictactoe.rounds      enable row level security;
alter table tictactoe.games       enable row level security;
alter table tictactoe.moves       enable row level security;
-- No policies created on purpose → anon/authenticated get zero access.
-- The service-role key used by the API routes bypasses RLS entirely.

-- ===================== 0002_move_apply.sql =====================
-- Atomic move application. Chess legality is validated in Node (chess.js) by
-- the /api/move route BEFORE calling this; the function's job is to commit the
-- result safely under concurrency.
--
-- Safety (spec §4): the game row is locked FOR UPDATE, and the caller's
-- expected_fen must still match the stored fen. Two near-simultaneous moves
-- therefore cannot both succeed — the second sees a changed fen and is rejected
-- with conflict='stale'. The ply number is derived inside the lock, so it can
-- never collide either.

create or replace function tictactoe.apply_move(
  p_game_id        uuid,
  p_expected_fen   text,
  p_new_fen        text,
  p_new_pgn        text,
  p_san            text,
  p_new_turn       text,
  p_new_status     text,
  p_result_source  text,
  p_by_player_id   uuid
) returns jsonb
language plpgsql
as $$
declare
  g           tictactoe.games%rowtype;
  v_ply       int;
  v_expected  uuid;
begin
  select * into g from tictactoe.games where id = p_game_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'conflict', 'no_game');
  end if;

  if g.status <> 'live' then
    return jsonb_build_object('ok', false, 'conflict', 'not_live');
  end if;

  -- Optimistic concurrency: the position must be unchanged since the caller read it.
  if g.fen <> p_expected_fen then
    return jsonb_build_object('ok', false, 'conflict', 'stale');
  end if;

  -- Defence in depth: the mover must own the side to move.
  v_expected := case when g.turn = 'w' then g.white_player_id else g.black_player_id end;
  if v_expected is null or v_expected <> p_by_player_id then
    return jsonb_build_object('ok', false, 'conflict', 'not_your_turn');
  end if;

  select coalesce(max(ply), 0) + 1 into v_ply from tictactoe.moves where game_id = p_game_id;

  insert into tictactoe.moves (game_id, ply, san, fen_after, by_player_id)
  values (p_game_id, v_ply, p_san, p_new_fen, p_by_player_id);

  update tictactoe.games
     set fen = p_new_fen,
         pgn = p_new_pgn,
         turn = p_new_turn,
         status = p_new_status,
         result_source = case when p_new_status = 'live' then null else p_result_source end
   where id = p_game_id;

  return jsonb_build_object('ok', true, 'ply', v_ply, 'status', p_new_status);
end;
$$;

-- Resolve a game without a final move (teacher override, bye, timeout draw).
-- Idempotent-ish: only acts on a game that is still live (or re-sets the same
-- terminal status). Returns the applied status.
create or replace function tictactoe.resolve_game(
  p_game_id        uuid,
  p_new_status     text,
  p_result_source  text
) returns jsonb
language plpgsql
as $$
declare
  g tictactoe.games%rowtype;
begin
  select * into g from tictactoe.games where id = p_game_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'conflict', 'no_game');
  end if;

  update tictactoe.games
     set status = p_new_status,
         result_source = p_result_source
   where id = p_game_id;

  return jsonb_build_object('ok', true, 'status', p_new_status);
end;
$$;

-- Refresh denormalised players.score from the authoritative game results.
-- (Standings on the board are computed in TS from games; this keeps the cached
-- column consistent for quick queries / pairing fallbacks.)
create or replace function tictactoe.recompute_scores(p_tournament_id uuid)
returns void
language plpgsql
as $$
begin
  update tictactoe.players p set score = coalesce(s.total, 0)
  from (
    select pid, sum(pts) as total from (
      select white_player_id as pid,
             case status when 'white_win' then 1 when 'draw' then 0.5
                         when 'bye' then 1 else 0 end as pts
        from tictactoe.games where tournament_id = p_tournament_id
      union all
      select black_player_id as pid,
             case status when 'black_win' then 1 when 'draw' then 0.5 else 0 end as pts
        from tictactoe.games
       where tournament_id = p_tournament_id and black_player_id is not null
    ) t group by pid
  ) s
  where p.id = s.pid and p.tournament_id = p_tournament_id;
end;
$$;

-- ===================== 0003_draw_and_results.sql =====================
-- Draw correctness + walkover result sources.
--
-- (1) Move the pending draw offer into the DB so it is consistent across
--     Cloudflare Worker isolates (the old in-memory store was per-isolate).
-- (2) Guard resolve_game so player-initiated results (draw accept, resign,
--     walkover) only apply while the game is still live — preventing a draw
--     from overwriting an already-decided game.
-- (3) Allow 'walkover' / 'opponent_absent' result sources.

alter table tictactoe.games add column if not exists draw_offered_by uuid;

-- Widen the result_source CHECK.
alter table tictactoe.games drop constraint if exists games_result_source_check;
alter table tictactoe.games
  add constraint games_result_source_check
  check (
    result_source in (
      'play', 'teacher_override', 'bye', 'timeout_draw', 'walkover', 'opponent_absent'
    )
  );

-- resolve_game gains p_require_live (DEFAULT false → backward compatible with
-- any 3-arg callers still deployed). Also clears any pending draw offer.
drop function if exists tictactoe.resolve_game(uuid, text, text);

create or replace function tictactoe.resolve_game(
  p_game_id        uuid,
  p_new_status     text,
  p_result_source  text,
  p_require_live    boolean default false
) returns jsonb
language plpgsql
as $$
declare
  g tictactoe.games%rowtype;
begin
  select * into g from tictactoe.games where id = p_game_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'conflict', 'no_game');
  end if;

  -- Player-initiated resolutions must not overwrite a finished game.
  if p_require_live and g.status <> 'live' then
    return jsonb_build_object('ok', false, 'conflict', 'not_live');
  end if;

  update tictactoe.games
     set status = p_new_status,
         result_source = p_result_source,
         draw_offered_by = null
   where id = p_game_id;

  return jsonb_build_object('ok', true, 'status', p_new_status);
end;
$$;

-- ===================== 0004_retention_cleanup.sql =====================
-- Automatic retention. Without this, every tournament — including empty lobbies
-- that were created and abandoned — lives forever, and each one holds its unique
-- join_pin permanently. Two tiers:
--   * empty abandoned lobby (no players, still 'lobby')  → deleted after 2 days
--   * everything else, once no activity for 30 days       → deleted
-- Deleting a tournament row cascades to its players / rounds / games / moves.

create extension if not exists pg_cron;

create or replace function tictactoe.cleanup_old_tournaments()
returns integer
language plpgsql
security definer
set search_path = tictactoe
as $$
declare
  removed integer;
begin
  with doomed as (
    delete from tictactoe.tournaments t
    where
      -- 1) empty abandoned lobby: nobody joined, never started, > 2 days old
      (
        t.status = 'lobby'
        and t.created_at < now() - interval '2 days'
        and not exists (select 1 from tictactoe.players p where p.tournament_id = t.id)
      )
      -- 2) no activity (created / joined / played) for 30 days
      or greatest(
           t.created_at,
           coalesce(
             (select max(g.updated_at) from tictactoe.games g where g.tournament_id = t.id),
             t.created_at
           ),
           coalesce(
             (select max(p.joined_at) from tictactoe.players p where p.tournament_id = t.id),
             t.created_at
           )
         ) < now() - interval '30 days'
    returning 1
  )
  select count(*) into removed from doomed;
  return removed;
end;
$$;

-- (re)schedule the nightly sweep (04:00 UTC ≈ 06:00 norsk sommertid),
-- replacing any prior definition so this migration is safe to re-run.
do $$
begin
  perform cron.unschedule('cleanup-old-tournaments-ttt');
exception when others then
  null; -- wasn't scheduled yet
end $$;

select cron.schedule(
  'cleanup-old-tournaments-ttt',
  '0 4 * * *',
  $$select tictactoe.cleanup_old_tournaments();$$
);

-- ===================== 0005_predictions.sql =====================
-- Tippemodus: waiting/eliminated players predict live-game results for points.
-- One prediction per (game, player); `correct` is filled in when the game
-- resolves. Same RLS posture as everything else: no policies, service role only.

create table tictactoe.predictions (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tictactoe.tournaments (id) on delete cascade,
  game_id       uuid not null references tictactoe.games (id) on delete cascade,
  player_id     uuid not null references tictactoe.players (id) on delete cascade,
  predicted     text not null check (predicted in ('white','black','draw')),
  correct       boolean,
  created_at    timestamptz not null default now(),
  unique (game_id, player_id)
);
create index predictions_tournament_idx on tictactoe.predictions (tournament_id);
create index predictions_game_idx on tictactoe.predictions (game_id);

alter table tictactoe.predictions enable row level security;
-- No policies on purpose → anon/authenticated get zero direct access.

-- ===================== 0006_teams.sql =====================
-- Lagturnering: players carry a team name (from tournaments.config.teams).
-- Assignment happens at join (auto-balanced, smallest team first); team
-- standings are computed, never stored.

alter table tictactoe.players add column if not exists team text;

-- ===================== 0007_slots_and_extensions.sql =====================
-- 0007: bracket slot order + atomic round-timer extensions.
--
-- games.slot: the bracket/pairing position a game was created at. Without it,
-- advancePlayoff read games ordered by updated_at (which changes as games
-- resolve), so out-of-order finishes scrambled single-elimination pairing.
--
-- rounds.extended_ms + extend_round(): the organizer's "+1 min" used to shift
-- rounds.started_at forward — but started_at is also the chess clocks' t0, so
-- shifting it ERASED time the players had already used. The extension now
-- lives in its own column (round end = started_at + duration + extended_ms)
-- and the RPC increments it atomically (a double-click adds 2 minutes, not 1).

alter table tictactoe.games  add column if not exists slot int not null default 0;
alter table tictactoe.rounds add column if not exists extended_ms int not null default 0;

create or replace function tictactoe.extend_round(p_round_id uuid)
returns int
language sql
as $$
  update tictactoe.rounds
     set extended_ms = extended_ms + 60000
   where id = p_round_id
   returning extended_ms;
$$;

notify pgrst, 'reload schema';

-- ===================== 0008_team_join_atomic.sql =====================
-- Atomic, balanced team assignment at join.
--
-- addPlayer() previously read team counts in one statement and inserted the
-- player in another, so two concurrent joins could read identical counts and
-- pick the SAME team — skewing balance (e.g. 6–4 instead of 5–5) whenever a
-- class taps "join" together. join_team_player() chooses the smallest team and
-- inserts in a single call, serialised per-tournament by a transaction-scoped
-- advisory lock, so concurrent joins can no longer collide on team selection.
--
-- Resume-code uniqueness (tournament_id, resume_code) is still enforced by the
-- table constraint; the caller regenerates + retries on 23505. The app keeps a
-- JS fallback for when this migration has not been applied yet, so deploy order
-- between code and DB does not matter.

create or replace function tictactoe.join_team_player(
  p_tournament_id uuid,
  p_display_name  text,
  p_resume_code   text,
  p_teams         text[]
) returns tictactoe.players
language plpgsql
as $$
declare
  chosen text := null;
  rec tictactoe.players%rowtype;
begin
  -- Serialise team-balance decisions for THIS tournament. The lock is released
  -- at commit, so the next concurrent join sees this player's committed row when
  -- it recomputes the counts. Different tournaments never block each other.
  perform pg_advisory_xact_lock(hashtextextended(p_tournament_id::text, 0));

  if coalesce(array_length(p_teams, 1), 0) >= 2 then
    select t.name into chosen
    from unnest(p_teams) with ordinality as t(name, ord)
    left join tictactoe.players p
      on p.tournament_id = p_tournament_id
     and p.team = t.name
    group by t.name, t.ord
    order by count(p.id) asc, t.ord asc   -- smallest team; ties → declared order
    limit 1;
  end if;

  insert into tictactoe.players (tournament_id, display_name, resume_code, team)
  values (p_tournament_id, left(p_display_name, 40), p_resume_code, chosen)
  returning * into rec;

  return rec;
end;
$$;

-- ===================== 0009_tiebreak_idempotency.sql =====================
-- 0009: idempotency for game creation at a bracket slot.
--
-- A double-fired playoff "advance" (or a concurrent tiebreak-rematch creation)
-- could create TWO live games at the same bracket slot, scrambling the bracket.
-- The invariant we want is: at most ONE *live* game per (round_id, slot).
--
-- Why partial on status='live' (NOT a plain unique on (round_id, slot)):
--   * League rounds: every game is live with a DISTINCT slot (0,1,2,…) → fine.
--   * Playoff tiebreak: the drawn original game keeps its slot but is no longer
--     'live', and the rematch reuses that same slot. A plain unique(round_id,slot)
--     would REJECT the legitimate rematch; the partial index allows it because the
--     original is resolved (draw), so only the rematch is live.
--   * A double-fired second rematch would be a 2nd live game at the slot →
--     23505, which createGame() now catches and treats as "already created".
--
-- Pre-check (run once if the index creation fails on legacy data):
--   select round_id, slot, count(*) from tictactoe.games
--   where status = 'live' group by round_id, slot having count(*) > 1;
-- Old tournaments are finished (and the retention job deletes 30-day-old ones),
-- so live collisions should not exist; this is safe to run on a live DB.

create unique index if not exists games_one_live_per_slot
  on tictactoe.games (round_id, slot)
  where status = 'live';

notify pgrst, 'reload schema';

-- ===================== 0010_casual_retention_and_autofinish.sql =====================
-- 0010: tighten retention for casual 1v1 sessions + auto-finish stale active
-- tournaments, folded into the existing nightly cleanup (0004).
--
-- Two problems this addresses:
--   1. Casual 1v1 sessions (config.casual = true) are throwaway — one tournament
--      row per game. The 30-day blanket TTL keeps them around far too long.
--      → delete a casual session after 1 day of inactivity.
--   2. A real tournament left running overnight (status league/playoff) is never
--      closed, so the next day students resume into a zombie live board.
--      → auto-FINISH (don't delete — keep standings) any league/playoff
--        tournament with no activity for > 12h.
--
-- "Activity" = greatest(created_at, max(games.updated_at)) — the same signal the
-- 30-day tier already uses. The lazy server-side check in lib/server/lifecycle.ts
-- handles the common case immediately on read; this nightly pass is the backstop.
-- Re-runnable: create-or-replace + reschedule (mirrors 0004).

create or replace function tictactoe.cleanup_old_tournaments()
returns integer
language plpgsql
security definer
set search_path = tictactoe
as $$
declare
  removed integer;
begin
  -- (a) Auto-finish stale ACTIVE tournaments (keep the row + standings).
  update tictactoe.tournaments t
     set status = 'finished'
   where t.status in ('league', 'playoff')
     and greatest(
           t.created_at,
           coalesce(
             (select max(g.updated_at) from tictactoe.games g where g.tournament_id = t.id),
             t.created_at
           )
         ) < now() - interval '12 hours';

  -- (b) Delete abandoned / expired tournaments.
  with doomed as (
    delete from tictactoe.tournaments t
    where
      -- empty abandoned lobby: nobody joined, never started, > 2 days old
      (
        t.status = 'lobby'
        and t.created_at < now() - interval '2 days'
        and not exists (select 1 from tictactoe.players p where p.tournament_id = t.id)
      )
      -- casual 1v1: throwaway — drop after 1 day of inactivity
      or (
        coalesce((t.config->>'casual')::boolean, false) = true
        and greatest(
              t.created_at,
              coalesce(
                (select max(g.updated_at) from tictactoe.games g where g.tournament_id = t.id),
                t.created_at
              )
            ) < now() - interval '1 day'
      )
      -- everything else: no activity (created / joined / played) for 30 days
      or greatest(
           t.created_at,
           coalesce(
             (select max(g.updated_at) from tictactoe.games g where g.tournament_id = t.id),
             t.created_at
           ),
           coalesce(
             (select max(p.joined_at) from tictactoe.players p where p.tournament_id = t.id),
             t.created_at
           )
         ) < now() - interval '30 days'
    returning 1
  )
  select count(*) into removed from doomed;
  return removed;
end;
$$;

-- (re)schedule the nightly sweep (04:00 UTC ≈ 06:00 norsk sommertid),
-- replacing any prior definition so this migration is safe to re-run.
do $$
begin
  perform cron.unschedule('cleanup-old-tournaments-ttt');
exception when others then
  null; -- wasn't scheduled yet
end $$;

select cron.schedule(
  'cleanup-old-tournaments-ttt',
  '0 4 * * *',
  $$select tictactoe.cleanup_old_tournaments();$$
);

