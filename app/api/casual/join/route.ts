import { joinCasualGame } from "@/lib/server/casual";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { isValidPin } from "@/lib/codes";

// POST /api/casual/join — join a casual 1v1 by code as the second player; the
// game auto-starts and the gameId is returned.
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[casual/join]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`casualjoin:${clientIp(req)}`, 60, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{ pin?: string; name?: string }>(req);
  const pin = (body?.pin ?? "").toString().trim();
  const name = (body?.name ?? "").toString().trim();
  if (!isValidPin(pin)) return fail(400, "invalid_pin");
  if (name.length < 1) return fail(400, "missing_name");

  const res = await joinCasualGame(pin, name.slice(0, 40));
  if (!res.ok) {
    const map = {
      not_found: [404, "invalid_pin"],
      not_casual: [409, "not_casual"],
      full: [409, "full"],
    } as const;
    const [status, code] = map[res.reason];
    return fail(status, code);
  }
  return ok(res);
}
