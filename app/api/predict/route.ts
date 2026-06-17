import {
  getGame,
  listPredictionsForPlayer,
  upsertPrediction,
  type PredictedResult,
} from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import { clientIp, fail, ok, rateLimit, readJson } from "@/lib/server/http";

// POST /api/predict — a waiting/eliminated player tips the result of a live
// game they are NOT playing in. One prediction per (game, player); re-tipping
// before the game ends overwrites. GETting own predictions also goes through
// POST (action 'list') so the resume-code bearer auth stays in the body.
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[predict]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{
    playerId?: string;
    resumeCode?: string;
    gameId?: string;
    predicted?: PredictedResult;
    action?: "tip" | "list";
  }>(req);
  if (!body) return fail(400, "bad_request");

  // Per-player key (classroom shares one NAT IP); auth below is the real gate.
  if (!rateLimit(`predict:${clientIp(req)}:${body.playerId ?? "anon"}`, 60, 60_000)) {
    return fail(429, "rate_limited");
  }

  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");

  if (body.action === "list") {
    const mine = await listPredictionsForPlayer(player.tournament_id, player.id);
    return ok({ predictions: mine });
  }

  if (!body.gameId || !body.predicted) return fail(400, "bad_request");
  if (!["white", "black", "draw"].includes(body.predicted)) {
    return fail(400, "bad_prediction");
  }

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");
  if (game.tournament_id !== player.tournament_id) return fail(403, "forbidden");
  if (game.status !== "live") return fail(409, "not_live");
  if (game.white_player_id === player.id || game.black_player_id === player.id) {
    return fail(403, "own_game"); // no tipping your own game
  }

  const saved = await upsertPrediction(
    player.tournament_id,
    game.id,
    player.id,
    body.predicted,
  );
  if (!saved) return fail(503, "predictions_unavailable"); // table not migrated
  return ok({ predicted: body.predicted });
}
