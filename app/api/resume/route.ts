import {
  getPlayerByResume,
  getTournament,
  getTournamentByPin,
} from "@/lib/server/store";
import { maybeAutoFinishStale } from "@/lib/server/lifecycle";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { normalizeResumeCode, isValidPin } from "@/lib/codes";

// POST /api/resume — restore a student session from their resume code.
// Accepts { resumeCode, pin } or { resumeCode, tournamentId }. The resume code
// travels in the body only (it is a bearer token — spec §8).
export async function POST(req: Request) {
  try {
    return await handleResume(req);
  } catch (err) {
    // A throw here used to become a platform 500, and the client's resume catch
    // WIPES the stored session → the student is kicked ("internal server error").
    // Return a structured transient error so the client keeps the session + retries.
    console.error("[resume]", err);
    return fail(503, "server_error");
  }
}

async function handleResume(req: Request): Promise<Response> {
  // Generous per-IP cap: after a wifi blip the whole class resumes at once
  // from one school NAT IP.
  if (!rateLimit(`resume:${clientIp(req)}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{
    resumeCode?: string;
    pin?: string;
    tournamentId?: string;
  }>(req);

  const resumeCode = normalizeResumeCode(body?.resumeCode?.toString() ?? "");
  if (resumeCode.length < 6) return fail(400, "invalid_code");

  const tournament = body?.tournamentId
    ? await getTournament(body.tournamentId)
    : body?.pin && isValidPin(body.pin)
      ? await getTournamentByPin(body.pin.trim())
      : null;

  if (!tournament) return fail(404, "not_found");

  const player = await getPlayerByResume(tournament.id, resumeCode);
  if (!player) return fail(404, "invalid_code");

  // Close a stale (abandoned-overnight) tournament before reporting status, so a
  // student resuming the next morning sees it finished — never a zombie board.
  const fresh = await maybeAutoFinishStale(tournament);

  return ok({
    tournamentId: fresh.id,
    playerId: player.id,
    displayName: player.display_name,
    tournamentStatus: fresh.status,
  });
}
