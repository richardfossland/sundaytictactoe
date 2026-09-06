import { addPlayer, getTournamentByPin } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { isValidPin } from "@/lib/codes";

// POST /api/join — student joins a tournament by PIN with a display name.
// Returns the resume code (a bearer token) in the body ONLY (never a URL).
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[join]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  // Generous per-IP cap: an entire class joins from ONE school NAT IP,
  // often inside the same minute (plus typo retries).
  if (!rateLimit(`join:${clientIp(req)}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{ pin?: string; displayName?: string }>(req);
  const pin = (body?.pin ?? "").toString().trim();
  const displayName = (body?.displayName ?? "").toString().trim();

  if (!isValidPin(pin)) return fail(400, "invalid_pin");
  if (displayName.length < 1) return fail(400, "missing_name");

  const t = await getTournamentByPin(pin);
  if (!t) return fail(404, "invalid_pin");
  if (t.status !== "lobby") return fail(409, "already_started");

  try {
    const player = await addPlayer(t.id, displayName, t.config.teams ?? []);
    // M1: the roster nudge is a hint layer (clients also poll/refetch), so it
    // runs after the response instead of holding the new player's join up.
    defer(
      () => broadcast(channels.lobby(t.id), events.roster, { joined: player.id }),
      "join:roster",
    );
    return ok({
      tournamentId: t.id,
      playerId: player.id,
      resumeCode: player.resume_code,
      displayName: player.display_name,
      team: player.team ?? null,
    });
  } catch (err) {
    console.error("[join]", err);
    return fail(500, "join_failed");
  }
}
