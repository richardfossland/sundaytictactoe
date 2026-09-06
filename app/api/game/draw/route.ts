import { getGame, resolveGameRpc, setDrawOffer } from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import { afterGameResolved } from "@/lib/server/gameEvents";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels } from "@/lib/realtime";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";

// POST /api/game/draw — draw by agreement, with the pending offer stored in the
// DB (consistent across Worker isolates — the old in-memory store was not).
//   action 'offer'   → record draw_offered_by + notify the opponent
//   action 'accept'  → only resolves if the OPPONENT has a pending offer AND the
//                      game is still live (require_live) → draw
//   action 'decline' → clear the offer + notify
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[draw]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{
    gameId?: string;
    playerId?: string;
    resumeCode?: string;
    action?: "offer" | "accept" | "decline";
  }>(req);
  if (!body?.gameId || !body.action) return fail(400, "bad_request");
  // A malformed gameId is a client error, not an outage (22P02 → false 503).
  if (!isUuid(body.gameId)) return fail(400, "bad_request");

  // H4: bound player-action bursts per IP (a whole classroom shares one NAT
  // IP, so this is generous — well above any real click rate).
  if (!rateLimit(`gameact:${clientIp(req)}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }

  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");
  if (game.tournament_id !== player.tournament_id) return fail(403, "forbidden");
  if (game.status !== "live") return fail(409, "not_live");

  const isPlayer =
    game.white_player_id === player.id || game.black_player_id === player.id;
  if (!isPlayer) return fail(403, "not_a_player");

  const topic = channels.game(game.id);

  if (body.action === "offer") {
    await setDrawOffer(game.id, player.id);
    // The offer is stored; notifying the opponent is a hint layer, so it runs
    // after the response (see lib/server/defer.ts).
    defer(() => broadcast(topic, "draw_offer", { by: player.id }), "draw:offer");
    return ok({ offered: true });
  }

  if (body.action === "decline") {
    await setDrawOffer(game.id, null);
    defer(() => broadcast(topic, "draw_declined", { by: player.id }), "draw:decline");
    return ok({ declined: true });
  }

  // accept: there must be a pending offer from the OTHER player (read from DB,
  // so it is correct regardless of which isolate handled the offer).
  if (!game.draw_offered_by || game.draw_offered_by === player.id) {
    return fail(409, "no_offer");
  }

  const result = await resolveGameRpc(game.id, "draw", "play", /* requireLive */ true);
  if (!result.ok) return fail(409, result.conflict ?? "conflict");
  defer(() => afterGameResolved(game, "draw", "play"), "draw:accept");
  return ok({ status: "draw" });
}
