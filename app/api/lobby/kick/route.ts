import { authHost } from "@/lib/server/auth";
import { getPlayer, setPlayerStatus } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";

// POST /api/lobby/kick — host removes a player from the LOBBY (bad/abusive name,
// or a ghost who left and never came back). Only valid before the tournament
// starts; once games are live the "absent" flow (a walkover) applies instead.
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[kick]", err);
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

  const t = await authHost(body.tournamentId, body.hostCode);
  if (!t) return fail(401, "unauthorized");
  if (t.status !== "lobby") return fail(409, "not_lobby");

  // Guard against cross-tournament kicks: the target must belong to this lobby.
  const player = await getPlayer(body.playerId);
  if (!player || player.tournament_id !== t.id) return fail(404, "no_player");

  await setPlayerStatus(player.id, "left");
  await broadcast(channels.lobby(t.id), events.roster, { left: player.id });
  return ok({ ok: true });
}
