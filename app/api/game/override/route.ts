import { authHost } from "@/lib/server/auth";
import { getGame, resolveGameRpc } from "@/lib/server/store";
import { afterGameResolved } from "@/lib/server/gameEvents";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";
import type { GameStatus } from "@/lib/types";

const ALLOWED: GameStatus[] = ["white_win", "black_win", "draw", "aborted"];

// POST /api/game/override — teacher sets a game result from the board (spec §3).
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[override]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  const limited = hostRateLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    gameId?: string;
    hostCode?: string;
    result?: GameStatus;
  }>(req);
  if (!body?.gameId || !body.result || !ALLOWED.includes(body.result)) {
    return fail(400, "bad_request");
  }

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");

  const t = await authHost(game.tournament_id, body.hostCode);
  if (!t) return fail(401, "unauthorized");

  // A bye isn't a played game — overriding it would mis-score the bye player
  // (the absent route guards byes too). Reject rather than corrupt standings.
  if (game.status === "bye") return fail(409, "cannot_override_bye");

  const result = await resolveGameRpc(game.id, body.result, "teacher_override");
  if (!result.ok) return fail(409, result.conflict ?? "conflict");

  await afterGameResolved(game, body.result, "teacher_override");
  return ok({ status: body.result });
}
