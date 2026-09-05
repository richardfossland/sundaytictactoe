-- 0013: close two security-audit findings, SQL-only, idempotent/re-runnable
-- (create-or-replace + revoke; no destructive DDL). Owner runs this by hand in
-- the Supabase SQL editor after 0012. Safe to run any number of times.
--
--   1. `tictactoe.cleanup_old_tournaments()` (0010) and
--      `tictactoe.cleanup_client_events()` (0012) are `security definer`
--      functions living in `tictactoe`, a schema PostgREST exposes over the
--      REST API (0011 adds it to PostgREST's schema list). Postgres grants
--      EXECUTE to PUBLIC on every new function by default, and 0011 goes
--      further — `grant all on all routines in schema tictactoe to anon,
--      authenticated, service_role` plus a matching `alter default privileges
--      ... grant all on routines to anon, authenticated, service_role` for
--      every function created afterwards. That blanket grant is dangerous
--      specifically for `security definer` functions: it hands anon/
--      authenticated EXECUTE on elevated-rights code by default, with no
--      per-function opt-out anywhere in 0011. `cleanup_old_tournaments()`
--      predates 0011 (so got the direct grant); `cleanup_client_events()`
--      postdates it (so got EXECUTE via the default-privileges clause
--      instead) — either way, `POST /rest/v1/rpc/cleanup_old_tournaments`
--      with the public anon key currently runs a definer-rights DELETE/UPDATE
--      across every tournament in the shared project. Neither function is
--      ever called by the app — only pg_cron, as the migration-owning role —
--      so revoking EXECUTE from public/anon/authenticated removes the anon
--      RPC surface with zero effect on the app. This revoke runs AFTER 0011
--      by filename order, so it wins over 0011's grant. `service_role` is
--      untouched: the RPCs the app actually calls (`apply_move`,
--      `resolve_game`, `extend_round`, `recompute_scores`, `join_team_player`)
--      are separate functions, unaffected here. (Scope kept deliberately
--      narrow — this does NOT touch 0011's schema-wide grants/default
--      privileges; any future `security definer` function added to this
--      schema will need the same explicit per-function revoke unless/until
--      0011's blanket grant itself is revisited.)
--
--   2. Casual (1v1) sessions are created with `status: "league"`
--      (`lib/server/casual.ts`), so they ride 0010's league/playoff auto-finish
--      (12h) and are eligible for the casual delete branch (1 day) even while a
--      game is still `live` — a student mid-lesson can have their session
--      deleted out from under them, surfacing as a `404 not_found` on resume.
--      Re-defines `cleanup_old_tournaments()` (create-or-replace, identical
--      otherwise) so the casual delete clause never fires while a live game
--      exists for that tournament, and raises the casual retention window from
--      1 day to 7 days (owner-approved). Cron job name/schedule unchanged from
--      0010 (`cleanup-old-tournaments-ttt`) — a body-only change via
--      create-or-replace needs no unschedule/reschedule.

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
      -- casual 1v1: throwaway — drop after 7 days of inactivity, but never while
      -- a game in it is still live (a student may be mid-session).
      or (
        coalesce((t.config->>'casual')::boolean, false) = true
        and greatest(
              t.created_at,
              coalesce(
                (select max(g.updated_at) from tictactoe.games g where g.tournament_id = t.id),
                t.created_at
              )
            ) < now() - interval '7 days'
        and not exists (
          select 1 from tictactoe.games g
           where g.tournament_id = t.id and g.status = 'live'
        )
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

-- Anon/authenticated must never be able to invoke either cleanup function
-- directly over PostgREST, regardless of whether 0011's blanket grant or the
-- default-privileges clause is what handed them EXECUTE. Listing anon,
-- authenticated explicitly (not just relying on `revoke ... from public`)
-- because 0011 granted directly to those roles, not only to PUBLIC.
revoke execute on function tictactoe.cleanup_old_tournaments() from public, anon, authenticated;
revoke execute on function tictactoe.cleanup_client_events() from public, anon, authenticated;
