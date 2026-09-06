// Round-timer expiry. Pure — no interval, no React. UI components tick `now`
// themselves (see lib/client/useCountdown.ts); this just says whether a given
// round's timer has run out as of that tick, so the league and bracket boards
// derive the same "time's up" moment from the same rule.

/** Shape both `BoardState["rounds"][number]` (host boards) and `Round` (server)
 * satisfy — just enough to compute the countdown target. */
export interface TimedRound {
  startedAt: string | null;
  extendedMs?: number;
}

/** Countdown target, in epoch ms. Null when there is no timer configured for
 * the tournament, or the round hasn't started yet (nothing to count down to). */
export function roundTimerEndMs(
  round: TimedRound | null | undefined,
  timerSec: number | null | undefined,
): number | null {
  if (!timerSec || !round?.startedAt) return null;
  return new Date(round.startedAt).getTime() + timerSec * 1000 + (round.extendedMs ?? 0);
}

/** Whether the round timer has expired as of `now` (epoch ms). */
export function roundTimeUp(
  round: TimedRound | null | undefined,
  timerSec: number | null | undefined,
  now: number,
): boolean {
  const endMs = roundTimerEndMs(round, timerSec);
  return endMs != null && now >= endMs;
}
