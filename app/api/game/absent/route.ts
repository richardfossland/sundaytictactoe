import { authHost } from "@/lib/server/auth";
import {
  getGame,
  resolveGameRpc,
  setPlayerStatus,
} from "@/lib/server/store";
import { afterGameResolved } from "@/lib/server/gameEvents";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";
import type { GameStatus } from "@/lib/types";

// POST /api/game/absent — teacher marks a player "away from the board"; the
// opponent gets a walkover win (not a draw).
//   scope 'round'      → resolve this game as the opponent's win (player stays)
//   scope 'tournament' → same + status='left' (excluded from future rounds)
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[absent]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  const limited = hostRateLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    gameId?: string;
    hostCode?: string;
    absentPlayerId?: string;
    scope?: "round" | "tournament";
  }>(req);
  if (!body?.gameId || !body.absentPlayerId) return fail(400, "bad_request");
  // A malformed gameId is a client error, not an outage (22P02 → false 503).
  if (!isUuid(body.gameId)) return fail(400, "bad_request");
  const scope = body.scope === "tournament" ? "tournament" : "round";
  const absentPlayerId = body.absentPlayerId;

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");

  const t = await authHost(game.tournament_id, body.hostCode);
  if (!t) return fail(401, "unauthorized");

  const isWhite = game.white_player_id === absentPlayerId;
  const isBlack = game.black_player_id === absentPlayerId;
  if (!isWhite && !isBlack) return fail(400, "not_in_game");
  if (!game.black_player_id) return fail(400, "bye_has_no_opponent");

  // The present opponent wins.
  const status: GameStatus = isWhite ? "black_win" : "white_win";
  const source = scope === "tournament" ? "opponent_absent" : "walkover";

  if (game.status === "live") {
    const result = await resolveGameRpc(game.id, status, source, /* requireLive */ true);
    if (!result.ok) return fail(409, result.conflict ?? "conflict");
    // M1: the walkover is committed; scoring + broadcasts are a hint layer, so
    // they run after the response (see lib/server/defer.ts).
    defer(() => afterGameResolved(game, status, source), "absent:resolve");
  }

  if (scope === "tournament") {
    // The status write itself stays awaited — the caller must be TOLD if it
    // fails (M3-style), unlike the roster nudge below, which is a pure hint.
    await setPlayerStatus(absentPlayerId, "left");
    defer(
      () =>
        broadcast(channels.lobby(game.tournament_id), events.tournament, {
          playerLeft: absentPlayerId,
        }),
      "absent:roster",
    );
  }

  return ok({ status, scope });
}
