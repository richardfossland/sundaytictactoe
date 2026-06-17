import { applyMove } from "@/lib/ttt/validateMove";
import { variantById } from "@/lib/ttt/variants";
import {
  applyMoveRpc,
  getGame,
  getTournament,
  setDrawOffer,
} from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import {
  afterGameResolved,
  broadcastPosition,
  broadcastSpectate,
} from "@/lib/server/gameEvents";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import type { Turn } from "@/lib/types";

// POST /api/move — THE server-authoritative move path (spec §4).
export async function POST(req: Request) {
  try {
    return await handleMove(req);
  } catch (err) {
    // Never let an unexpected throw become a platform 500/1102 HTML page: the
    // client maps an unknown move error to a (false) "Ulovlig trekk". Return a
    // structured transient error so the client shows reconnecting + resyncs.
    console.error("[move]", err);
    return fail(503, "server_error");
  }
}

async function handleMove(req: Request): Promise<Response> {
  const body = await readJson<{
    gameId?: string;
    cell?: number;
    playerId?: string;
    resumeCode?: string;
  }>(req);
  if (!body?.gameId || typeof body.cell !== "number") return fail(400, "bad_request");

  // Rate-limit per player, not per IP: a whole classroom shares one school
  // NAT IP, so an IP-wide cap would throttle legitimate play. The playerId is
  // unauthenticated here, but flooding random ids buys nothing — auth below
  // is the real gate; this only bounds per-student request bursts.
  if (!rateLimit(`move:${clientIp(req)}:${body.playerId ?? "anon"}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }

  // 1. Authenticate the mover (resume code is a bearer token).
  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");

  // 2. Load authoritative game state.
  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");
  if (game.tournament_id !== player.tournament_id) return fail(403, "forbidden");
  if (game.status !== "live") return fail(409, "not_live");

  // 3. Enforce "wait your turn": the mover must own the side to move. This is
  //    the real enforcement, not just a UI hint.
  const sideOwner = game.turn === "w" ? game.white_player_id : game.black_player_id;
  if (sideOwner !== player.id) return fail(403, "not_your_turn");

  // 4. Validate legality against the stored board + the tournament's variant
  //    (board size + win length). Loading the tournament also lets a casual game
  //    default to classic 3×3.
  const tournament = await getTournament(game.tournament_id);
  const variant = variantById(tournament?.config.variant);
  const applied = applyMove(game.fen, { cell: body.cell }, game.pgn, variant);
  if (!applied.ok) return fail(400, applied.reason);

  // 5. Commit atomically (row lock + optimistic board check inside the RPC).
  const result = await applyMoveRpc({
    gameId: game.id,
    expectedFen: game.fen,
    newFen: applied.fen,
    newPgn: applied.pgn,
    san: applied.san,
    newTurn: applied.turn as Turn,
    newStatus: applied.status,
    resultSource: "play",
    byPlayerId: player.id,
  });

  if (!result.ok) {
    // A concurrent move won the race, or the game changed under us.
    const code = result.conflict ?? "conflict";
    const status =
      code === "not_your_turn" ? 403 : code === "no_game" ? 404 : 409;
    return fail(status, code);
  }

  // A move supersedes any pending draw offer.
  if (game.draw_offered_by) await setDrawOffer(game.id, null);

  // 6. Broadcast the new authoritative position (hint to refetch/sync) — to the
  //    players' game channel and the teacher's tournament-wide spectate feed.
  await broadcastPosition(game.id, applied.fen, applied.turn as Turn, applied.status, {
    cell: body.cell,
  });
  await broadcastSpectate(
    game.tournament_id,
    game.id,
    applied.fen,
    applied.turn as Turn,
    applied.status,
  );

  // 7. If the game ended on this move, run resolution side-effects.
  if (applied.status !== "live") {
    await afterGameResolved(game, applied.status, "play");
  }

  return ok({
    fen: applied.fen,
    turn: applied.turn,
    status: applied.status,
    san: applied.san,
  });
}
