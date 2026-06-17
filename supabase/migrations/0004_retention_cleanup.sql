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
