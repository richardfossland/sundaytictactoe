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
