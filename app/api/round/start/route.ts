import { authHost } from "@/lib/server/auth";
import { isUniqueViolation, listPlayers } from "@/lib/server/store";
import { startLeague } from "@/lib/server/league";
import { startCup } from "@/lib/server/playoff";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";

// POST /api/round/start — organizer starts the tournament: league round 1, or
// straight into the knockout bracket when format = "cup".
export async function POST(req: Request) {
  const limited = hostRateLimit(req);
  if (limited) return limited;
  const body = await readJson<{ tournamentId?: string; hostCode?: string }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode);
  if (!t) return fail(401, "unauthorized");
  if (t.status !== "lobby") return fail(409, "already_started");

  const players = await listPlayers(t.id);
  if (players.filter((p) => p.status === "active").length < 2) {
    return fail(409, "not_enough_players");
  }

  try {
    if (t.config.format === "cup") {
      await startCup(t);
      return ok({ status: "playoff" });
    }
    await startLeague(t);
    return ok({ status: "league" });
  } catch (err) {
    // Double-fire: the other request created round 1 first (unique constraint
    // on rounds). The tournament IS starting — tell the client that, not 500.
    if (isUniqueViolation(err)) return fail(409, "already_started");
    console.error("[round/start]", err);
    return fail(500, "start_failed");
  }
}
