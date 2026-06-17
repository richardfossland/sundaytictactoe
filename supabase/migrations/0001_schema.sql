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
