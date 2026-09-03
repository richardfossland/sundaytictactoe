-- 0012 — client_events: a minimal, privacy-respecting client telemetry table.
-- Port of sundaychess#87 (T5). Lives in THIS app's own `tictactoe` schema, not
-- `public` — the shared Supabase project also hosts SundayChess there, and a
-- table named `client_events` must not collide between the two apps.
--
-- WHY: there was NO client-side error reporting. When a student is "thrown out"
-- mid-lesson or the board freezes, nothing recorded why — the teacher only ever
-- hears "det funka ikke". This table is the smallest thing that answers that
-- question after the fact, and nothing more.
--
-- WHAT IS STORED (see docs/TELEMETRY.md for the full contract):
--   * opaque UUIDs already minted by this app (tournament / player / game)
--   * one enum-ish `kind` from a fixed allow-list
--   * a tiny flat `detail` object (status codes, error codes, ≤ 2 KB, capped
--     and shape-checked server-side in app/api/telemetry/route.ts)
--   * a per-page-load random `sid` (correlates events from one tab, nothing more)
--   * `ua_class`: literally the string 'mobile' or 'desktop'
--
-- WHAT IS NEVER STORED: names, IP addresses, user-agent strings, resume codes,
-- host codes, PINs, URLs, or any free text the student typed.
--
-- Storage lives in THIS app's own schema on purpose (owner decision) rather than
-- the suite's telemetry service: it is classroom debugging data, it must die with
-- the same 14-day clock, and it must never leave the app's own database.
--
-- IDEMPOTENT + INERT: the app degrades gracefully while this migration has NOT
-- been run — the telemetry route answers 204 and the host diagnostics modal says
-- "tabellen finnes ikke ennå". Nothing breaks if it is never applied.

create table if not exists tictactoe.client_events (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  tournament_id  uuid,
  player_id      uuid,
  game_id        uuid,
  kind           text not null check (
                   kind in (
                     'kick',
                     'watchdog',
                     'channel_error',
                     'api_timeout',
                     'api_network',
                     'api_5xx',
                     'move_rollback',
                     'game_vanished',
                     'tab_passive',
                     'js_error'
                   )
                 ),
  detail         jsonb not null default '{}'::jsonb,
  sid            text,
  ua_class       text
);

-- The only read this table serves: "everything for tournament X, newest first"
-- (the host diagnostics modal). One index, exactly matching that query.
create index if not exists client_events_tournament_idx
  on tictactoe.client_events (tournament_id, at desc);

-- ---------- RLS: lock to the service role, like every other table (0005/0006) ----------
alter table tictactoe.client_events enable row level security;
-- No policies created on purpose → anon/authenticated get zero access. The
-- service-role key used by the API routes bypasses RLS entirely, so the ONLY way
-- to read this is through the host-code-authenticated diagnostics route. Table
-- privileges themselves flow from 0011's ALTER DEFAULT PRIVILEGES for the
-- `tictactoe` schema, so no additional grant is needed here.

-- ---------- retention: 14 days, no exceptions ----------
-- Mirrors 0004/0010's style: a security-definer function plus an idempotent
-- (unschedule-then-schedule) pg_cron job, so this migration is safe to re-run.
-- The job name carries the `-ttt` suffix used throughout this app's migrations
-- (see 0004/0010) so it can never collide with sundaychess's own
-- `cleanup-client-events` job in the same shared Supabase project.

create extension if not exists pg_cron;

create or replace function tictactoe.cleanup_client_events()
returns integer
language plpgsql
security definer
set search_path = tictactoe
as $$
declare
  removed integer;
begin
  with doomed as (
    delete from tictactoe.client_events
     where at < now() - interval '14 days'
    returning 1
  )
  select count(*) into removed from doomed;
  return removed;
end;
$$;

do $$
begin
  perform cron.unschedule('cleanup-client-events-ttt');
exception when others then
  null; -- wasn't scheduled yet
end $$;

-- 04:20 UTC — a few minutes after the tournament sweep (0004/0010, 04:00 UTC)
-- so the two nightly jobs don't start in the same second.
select cron.schedule(
  'cleanup-client-events-ttt',
  '20 4 * * *',
  $$select tictactoe.cleanup_client_events();$$
);

notify pgrst, 'reload schema';
