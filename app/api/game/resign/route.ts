import { getGame, resolveGameRpc } from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import { afterGameResolved } from "@/lib/server/gameEvents";
import { fail, ok, readJson } from "@/lib/server/http";
import type { GameStatus } from "@/lib/types";

// POST /api/game/resign — the resigning player loses; opponent wins.
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[resign]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{
    gameId?: string;
    playerId?: string;
    resumeCode?: string;
  }>(req);
  if (!body?.gameId) return fail(400, "bad_request");

  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");
  if (game.tournament_id !== player.tournament_id) return fail(403, "forbidden");
  if (game.status !== "live") return fail(409, "not_live");

  const isWhite = game.white_player_id === player.id;
  const isBlack = game.black_player_id === player.id;
  if (!isWhite && !isBlack) return fail(403, "not_a_player");

  // The other side wins.
  const status: GameStatus = isWhite ? "black_win" : "white_win";
  const result = await resolveGameRpc(game.id, status, "play", /* requireLive */ true);
  if (!result.ok) return fail(409, result.conflict ?? "conflict");

  await afterGameResolved(game, status, "play");
  return ok({ status });
}
