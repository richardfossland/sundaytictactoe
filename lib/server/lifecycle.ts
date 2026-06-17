import "server-only";

import { finishIfActive, listGames } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import type { Game, Tournament } from "@/lib/types";

// Auto-finish a tournament that was left running and then abandoned (e.g.
// overnight): otherwise students resume the next day into a zombie live board.
// The nightly cron (migration 0010) is the backstop; this lazy check on read
// closes the common case the moment anyone opens the app.

/** How long with no activity before an active tournament auto-finishes. */
export const STALE_MS = 12 * 60 * 60 * 1000;

/** Last activity = the freshest of created_at and any game's updated_at (a game
 * row's updated_at is bumped by the set_updated_at trigger on every move/result).
 * Pure + unit-testable. */
export function lastActivityMs(tournament: Tournament, games: Game[]): number {
  let latest = Date.parse(tournament.created_at);
  for (const g of games) {
    const u = Date.parse(g.updated_at);
    if (Number.isFinite(u) && u > latest) latest = u;
  }
  return latest;
}

/** Only mid-flight tournaments can go stale; a finished/lobby one is handled
 * elsewhere (lobby has its own retention tier and no live board to re-enter). */
export function autoFinishEligible(status: Tournament["status"]): boolean {
  return status === "league" || status === "playoff";
}

/** Pure staleness test (now injectable for tests). */
export function isStale(lastMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - lastMs > STALE_MS;
}

/**
 * Flip an inactive (>12h) league/playoff tournament to `finished` and notify
 * the lobby channel. Returns the (possibly updated) tournament so callers can
 * use the fresh status. `games` is reused when the caller already fetched them,
 * to avoid a second round-trip. Never throws on the broadcast.
 */
export async function maybeAutoFinishStale(
  tournament: Tournament,
  games?: Game[],
): Promise<Tournament> {
  if (!autoFinishEligible(tournament.status)) return tournament;
  const gs = games ?? (await listGames(tournament.id));
  if (!isStale(lastActivityMs(tournament, gs))) return tournament;

  // Atomic: only the FIRST caller (of a whole class resuming at once) actually
  // transitions the row and broadcasts; the rest get null and stay quiet.
  const updated = await finishIfActive(tournament.id);
  if (!updated) return { ...tournament, status: "finished" };
  try {
    await broadcast(channels.lobby(tournament.id), events.tournament, {
      finished: true,
      autoFinished: true,
    });
  } catch {
    // a missed nudge is harmless — clients refetch on their poll
  }
  return updated;
}
