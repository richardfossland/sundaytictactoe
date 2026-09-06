import { authHost } from "@/lib/server/auth";
import { getPlayer, setPlayerStatus } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";

// POST /api/game/reinstate — the teacher's undo for /api/game/absent's
// scope:'tournament' (and for a lobby ghost-kick once the tournament has moved
// past the lobby, where /api/lobby/rejoin no longer applies — see its 409
// not_lobby). Late-join after the tournament has started stays BLOCKED: the
// current round's pairings are already set. This route is the honest
// alternative — it brings a "left" player back to "active" so
// lib/server/league.ts's `active` filter includes them again from the NEXT
// round's pairing. It never touches the CURRENT round, and never revives a
// finished tournament.
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[reinstate]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  const limited = hostRateLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    tournamentId?: string;
    hostCode?: string;
    playerId?: string;
  }>(req);
  if (!body?.tournamentId || !body.playerId) return fail(400, "bad_request");
  // `getPlayer` below hands playerId straight to Postgres; a malformed one is a
  // client error (22P02 → false 503), not a missing player and not an outage.
  // (tournamentId is shape-checked inside authHost.)
  if (!isUuid(body.playerId)) return fail(400, "bad_request");

  const t = await authHost(body.tournamentId, body.hostCode);
  if (!t) return fail(401, "unauthorized");
  // Pairings no longer exist to re-enter once the tournament is over.
  if (t.status === "finished") return fail(409, "finished");

  // Guard against cross-tournament reinstates: the target must belong here.
  const player = await getPlayer(body.playerId);
  if (!player || player.tournament_id !== t.id) return fail(404, "no_player");
  // Nothing to undo for a player who was never marked away.
  if (player.status !== "left") return fail(409, "not_left");

  // The status write is a real state mutation — the caller must be TOLD if it
  // fails (M3-style), unlike the roster nudge below, which is a pure hint.
  await setPlayerStatus(player.id, "active");
  defer(
    () =>
      broadcast(channels.lobby(t.id), events.tournament, {
        playerReinstated: player.id,
      }),
    "reinstate:roster",
  );
  return ok({});
}
