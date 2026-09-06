import { rematchCasual } from "@/lib/server/casual";
import { authPlayer } from "@/lib/server/auth";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";

// POST /api/casual/rematch — either player in a finished casual 1v1 starts a
// rematch (new game, swapped colours, same throwaway session). Idempotent: both
// players calling it land in the same game.
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[casual/rematch]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`casualrematch:${clientIp(req)}`, 30, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{
    tournamentId?: string;
    playerId?: string;
    resumeCode?: string;
  }>(req);

  const player = await authPlayer(body?.playerId, body?.resumeCode);
  if (!player) return fail(401, "unauthorized");
  // `rematchCasual` hands the tournamentId to Postgres; a malformed one is a
  // client error (22P02 → false 503), not a permissions problem.
  const tournamentId = body?.tournamentId;
  if (!isUuid(tournamentId)) return fail(400, "bad_request");
  if (player.tournament_id !== tournamentId) return fail(403, "forbidden");

  const res = await rematchCasual(tournamentId, player.id);
  if (!res.ok) {
    const map = {
      not_found: [404, "not_found"],
      not_casual: [409, "not_casual"],
      not_player: [403, "forbidden"],
    } as const;
    const [status, code] = map[res.reason];
    return fail(status, code);
  }
  return ok(res);
}
