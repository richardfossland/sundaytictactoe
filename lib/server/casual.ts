import "server-only";

import {
  addPlayer,
  createGame,
  createRound,
  createTournament,
  getTournament,
  getTournamentByPin,
  listGames,
  listPlayers,
  listRounds,
  updateTournament,
} from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import type { TournamentConfig } from "@/lib/types";

// A casual 1v1 is modelled as a throwaway two-player "tournament" so it can
// reuse the whole game pipeline (GameView, moves, realtime, results). It is
// flagged casual so it never shows up as a real tournament and the second join
// auto-starts the single game — no host, no lobby wait.
const CASUAL_CONFIG: TournamentConfig = {
  leagueRounds: 1,
  playoff: false,
  playoffSize: 0,
  roundTimerSec: null,
  casual: true,
};

export interface CasualIdentity {
  tournamentId: string;
  joinPin: string;
  playerId: string;
  resumeCode: string;
  displayName: string;
}

/** Create a casual 1v1 session and add the challenger. Status stays "lobby"
 * until the opponent joins with the code (which auto-starts the game). */
export async function createCasualGame(name: string): Promise<CasualIdentity> {
  const t = await createTournament("Vennekamp", CASUAL_CONFIG);
  const a = await addPlayer(t.id, name);
  return {
    tournamentId: t.id,
    joinPin: t.join_pin,
    playerId: a.id,
    resumeCode: a.resume_code,
    displayName: a.display_name,
  };
}

export type JoinCasualResult =
  | {
      ok: true;
      tournamentId: string;
      playerId: string;
      resumeCode: string;
      displayName: string;
      gameId: string;
    }
  | { ok: false; reason: "not_found" | "not_casual" | "full" };

/** Join a casual session by code as the second player and auto-start the game
 * with random colours. Idempotent against an empty/missing session. */
export async function joinCasualGame(
  pin: string,
  name: string,
): Promise<JoinCasualResult> {
  const t = await getTournamentByPin(pin);
  if (!t) return { ok: false, reason: "not_found" };
  if (!t.config.casual) return { ok: false, reason: "not_casual" };

  const existing = await listPlayers(t.id);
  if (existing.length >= 2) return { ok: false, reason: "full" };
  if (existing.length === 0) return { ok: false, reason: "not_found" };

  const challenger = existing[0];
  const joiner = await addPlayer(t.id, name);

  // Atomicity guard (no DB constraint on the 2-seat cap): if two players joined
  // at once, re-read by join order and let only the first joiner (seat 1) take
  // the seat. A later joiner gets a clean "full" instead of a duplicate
  // round/game and a confusing 503. (seat 0 is the challenger.)
  const seats = await listPlayers(t.id); // ordered by joined_at asc
  const seat = seats.findIndex((p) => p.id === joiner.id);
  if (seat < 0 || seat >= 2) return { ok: false, reason: "full" };

  // Random colours between the challenger and the joiner.
  const challengerWhite = Math.random() < 0.5;
  const whiteId = challengerWhite ? challenger.id : joiner.id;
  const blackId = challengerWhite ? joiner.id : challenger.id;

  const round = await createRound(t.id, 1, "league", "live");
  const game = await createGame({
    tournamentId: t.id,
    roundId: round.id,
    whitePlayerId: whiteId,
    blackPlayerId: blackId,
    slot: 0,
  });
  await updateTournament(t.id, { status: "league", current_round: 1 });
  await broadcast(channels.lobby(t.id), events.roster, { joined: joiner.id });
  await broadcast(channels.lobby(t.id), events.tournament, { started: true });

  return {
    ok: true,
    tournamentId: t.id,
    playerId: joiner.id,
    resumeCode: joiner.resume_code,
    displayName: joiner.display_name,
    gameId: game.id,
  };
}

export type RematchResult =
  | { ok: true; gameId: string }
  | { ok: false; reason: "not_found" | "not_casual" | "not_player" };

/** Start a rematch in an existing casual session: a fresh game in a new round
 * with the colours swapped from the most recent game. Idempotent — if a rematch
 * is already live (the other player clicked first, or a double-tap), return it
 * so both players land in the SAME game. Caller must have verified the player. */
export async function rematchCasual(
  tournamentId: string,
  playerId: string,
): Promise<RematchResult> {
  const t = await getTournament(tournamentId);
  if (!t) return { ok: false, reason: "not_found" };
  if (!t.config.casual) return { ok: false, reason: "not_casual" };

  const players = await listPlayers(tournamentId);
  if (!players.some((p) => p.id === playerId)) return { ok: false, reason: "not_player" };
  if (players.length < 2) return { ok: false, reason: "not_found" };

  const games = await listGames(tournamentId); // ordered by updated_at asc
  const live = games.find((g) => g.status === "live");
  if (live) return { ok: true, gameId: live.id }; // rematch already running

  // Swap colours from the most recent game (fall back to roster order).
  const last = games[games.length - 1];
  const whiteId = last ? last.black_player_id ?? players[1].id : players[0].id;
  const blackId = last ? last.white_player_id : players[1].id;

  const rounds = await listRounds(tournamentId);
  const nextNumber = (rounds[rounds.length - 1]?.number ?? 0) + 1;
  const round = await createRound(tournamentId, nextNumber, "league", "live");
  const game = await createGame({
    tournamentId,
    roundId: round.id,
    whitePlayerId: whiteId,
    blackPlayerId: blackId,
    slot: 0,
  });
  await broadcast(channels.lobby(tournamentId), events.tournament, {
    rematch: game.id,
  });
  return { ok: true, gameId: game.id };
}
