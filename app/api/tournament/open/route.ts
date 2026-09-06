import { openTournamentByHostCode } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
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
  if (!rateLimit(`open:${clientIp(req)}`, 20, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{ hostCode?: string }>(req);
  const code = normalizeResumeCode(body?.hostCode?.toString() ?? "");
  if (!code) return fail(400, "missing_code");
  // normalizeResumeCode PASSES THROUGH anything that isn't 6 characters, so
  // without this the lookup below runs on arbitrary client input (a paste, a
  // probe, a whole sentence). A code that cannot exist is a 400, decided here —
  // before the database is touched at all.
  if (!isResumeCodeShape(code)) return fail(400, "invalid_code");

  const t = await openTournamentByHostCode(code);
  if (!t) return fail(404, "not_found");
  return ok({ id: t.id });
}
