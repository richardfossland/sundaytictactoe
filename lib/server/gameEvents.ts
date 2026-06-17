import "server-only";

import { recomputeScores, scorePredictions } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import type { Game, GameStatus, ResultSource, Turn } from "@/lib/types";

/** Broadcast that a position changed on a game channel (after a move). */
export async function broadcastPosition(
  gameId: string,
  fen: string,
  turn: Turn,
  status: GameStatus,
  lastMove: { cell: number } | null,
): Promise<void> {
  await broadcast(channels.game(gameId), events.position, {
    fen,
    turn,
    status,
    lastMove,
  });
}

/** Broadcast a move to the tournament-wide spectate feed so the teacher's
 * live-games grid updates instantly without polling every game channel. */
export async function broadcastSpectate(
  tournamentId: string,
  gameId: string,
  fen: string,
  turn: Turn,
  status: GameStatus,
): Promise<void> {
  await broadcast(channels.spectate(tournamentId), events.position, {
    gameId,
    fen,
    turn,
    status,
  });
}

/** Side-effects when a game reaches a terminal status: refresh the cached
 * scores and nudge both the game channel (players) and the lobby channel
 * (board standings + "neste runde" availability). */
export async function afterGameResolved(
  game: Pick<Game, "id" | "tournament_id">,
  status: GameStatus,
  resultSource: ResultSource,
  opts?: { skipRecompute?: boolean },
): Promise<void> {
  // recomputeScores re-aggregates the WHOLE tournament; a batch resolver (e.g.
  // forceResolveRound across N boards) passes skipRecompute and recomputes once
  // at the end instead of N identical times.
  if (!opts?.skipRecompute) await recomputeScores(game.tournament_id);
  // settle the tipping points; no-op until the predictions table exists
  await scorePredictions(game.id, status).catch(() => {});
  await Promise.all([
    broadcast(channels.game(game.id), events.result, {
      gameId: game.id,
      status,
      resultSource,
    }),
    broadcast(channels.lobby(game.tournament_id), events.tournament, {
      gameResolved: game.id,
    }),
    // Also tell the spectate feed so the live-games grid reacts to a game
    // ending (override/timeout/resign emit no position broadcast) instantly —
    // no 5s poll wait, and the open spectator view can play a winner animation.
    broadcast(channels.spectate(game.tournament_id), events.result, {
      gameId: game.id,
      status,
    }),
  ]);
}
