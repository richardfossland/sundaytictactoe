import { authHost } from "@/lib/server/auth";
import { advanceRound, currentRoundResolved } from "@/lib/server/league";
import { advancePlayoff, playoffRoundResolved } from "@/lib/server/playoff";
import { getTournament, isUniqueViolation } from "@/lib/server/store";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";

// POST /api/round/advance — teacher clicks "Neste runde". Guarded: every game
// in the current round must be resolved (play it out, override, or force).
export async function POST(req: Request) {
  const limited = hostRateLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    tournamentId?: string;
    hostCode?: string;
    // Playoff draw handling: "rematch" (default) spawns a swap-colours rematch;
    // "ranking" sends the higher seed straight through (no rematch).
    tiebreak?: "rematch" | "ranking";
  }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode);
  if (!t) return fail(401, "unauthorized");

  try {
    if (t.status === "league") {
      if (!(await currentRoundResolved(t))) return fail(409, "round_unresolved");
      const next = await advanceRound(t);
      return ok({ status: next });
    }
    if (t.status === "playoff") {
      if (!(await playoffRoundResolved(t))) return fail(409, "round_unresolved");
      const next = await advancePlayoff(t, {
        resolveDrawsBySeed: body?.tiebreak === "ranking",
      });
      return ok({ status: next });
    }
    return fail(409, "not_in_progress");
  } catch (err) {
    // A drawn playoff game has no winner — the teacher must decide it first.
    if (err instanceof Error && err.message === "needs_decision") {
      return fail(409, "needs_decision");
    }
    // Double-fire (double-click / two tabs): the OTHER request already created
    // the next round — that advance succeeded, so answer 200, not a scary 500.
    // (createRound runs before the current_round bump, so no double-bump.)
    if (isUniqueViolation(err)) {
      const fresh = await getTournament(t.id).catch(() => null);
      return ok({ status: fresh?.status ?? t.status });
    }
    console.error("[round/advance]", err);
    return fail(500, "advance_failed");
  }
}
