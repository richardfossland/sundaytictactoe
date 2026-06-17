import { openTournamentByHostCode } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { normalizeResumeCode } from "@/lib/codes";

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

  const t = await openTournamentByHostCode(code);
  if (!t) return fail(404, "not_found");
  return ok({ id: t.id });
}
