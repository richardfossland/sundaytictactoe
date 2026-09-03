import { authPlayer } from "@/lib/server/auth";
import { getTournament, setPlayerStatus } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";

// POST /api/lobby/rejoin — a student who was removed from the LOBBY puts
// themselves back in. The counterpart to /api/lobby/kick, and the reason the
// auto-kick is survivable: the host's ghost-sweep removes anyone whose socket
// has been gone past the grace window, which a locked phone or a backgrounded
// tab can trigger without the student doing anything wrong. Before this route a
// kick was one-way — there was no un-kick at all.
//
// Only valid while the tournament is still in the lobby: once pairings exist,
// silently re-adding a player would change the bracket. Then the client says so
// instead ("Du ble fjernet fra turneringen") and they join afresh.
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[rejoin]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  // Same generous per-IP cap as /api/resume: a whole class sits behind ONE
  // school NAT IP, and a rejoin follows a resume that just succeeded.
  if (!rateLimit(`rejoin:${clientIp(req)}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{
    tournamentId?: string;
    playerId?: string;
    resumeCode?: string;
  }>(req);
  if (!body?.tournamentId || !body.playerId) return fail(400, "bad_request");

  // The (playerId, resumeCode) bearer pair — a student may only re-add THEMSELF.
  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");
  if (player.tournament_id !== body.tournamentId) return fail(403, "forbidden");

  const t = await getTournament(player.tournament_id);
  if (!t) return fail(404, "not_found");
  if (t.status !== "lobby") return fail(409, "not_lobby");

  await setPlayerStatus(player.id, "active");
  // The roster hint is what /api/join broadcasts, so the host board refreshes
  // exactly as it does for a first-time join. It runs after the response — the
  // student's own state is already committed (see lib/server/defer.ts).
  defer(
    () => broadcast(channels.lobby(t.id), events.roster, { joined: player.id }),
    "rejoin:roster",
  );
  return ok({});
}
