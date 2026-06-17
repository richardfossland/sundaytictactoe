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
