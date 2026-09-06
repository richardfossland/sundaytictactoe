import { openTournamentByHostCode } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp, hostRateLimit } from "@/lib/server/http";
import { isResumeCodeShape, normalizeResumeCode } from "@/lib/codes";

// POST /api/tournament/open — reopen a tournament board with the host code.
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[tournament/open]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{ hostCode?: string }>(req);
  const code = normalizeResumeCode(body?.hostCode?.toString() ?? "");
  if (!code) return fail(400, "missing_code");
  // H5: the shape check is the FIRST substantive line, ahead of EITHER rate
  // limiter below. normalizeResumeCode PASSES THROUGH anything that isn't 6
  // characters, so without this the lookup ran on arbitrary client input (a
  // paste, a probe, a whole sentence) — and, now that this route also draws on
  // the SHARED host bucket (see below), garbage that could never be a real
  // code must never get to spend that shared budget either. A code that
  // cannot exist is a 400, decided here — before the database and before
  // either limiter is touched.
  if (!isResumeCodeShape(code)) return fail(400, "invalid_code");

  if (!rateLimit(`open:${clientIp(req)}`, 20, 60_000)) {
    return fail(429, "rate_limited");
  }
  // H5: this route is unauthenticated-until-the-DB-lookup AND the best
  // host-code brute-force oracle in the app — it searches EVERY tournament,
  // including one row per casual game — so a well-shaped guess also counts
  // against the shared host bucket that override/absent/extend/kick use, not
  // just this route's own tighter 20/min cap.
  const limited = hostRateLimit(req);
  if (limited) return limited;

  const t = await openTournamentByHostCode(code);
  if (!t) return fail(404, "not_found");
  return ok({ id: t.id });
}
