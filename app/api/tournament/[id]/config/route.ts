import { authHost } from "@/lib/server/auth";
import { updateTournamentConfig } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";

const MAX_NOTES = 280;

// POST /api/tournament/[id]/config — host-code-gated config patch. ONE route
// for the two small, independent escape hatches a teacher needs mid-lesson,
// rather than two near-identical ones:
//
//  - leagueRounds: finish the league after the CURRENT round instead of the
//    one picked in the wizard (running short on time, or the class is
//    smaller than planned). Only ever DOWN, and only down to the round
//    currently in progress (or just finished) — raising it back up would let
//    a host silently extend a tournament students already believe is
//    ending, and a round below `current_round` has already been paired/
//    played, so there is nothing sensible to "lower" it to.
//  - notes: the teacher's own reminder to self (class, lesson, …). Never
//    shown to students — lib/dto.ts's toBoardTournament strips it from the
//    public board DTO (the SAME endpoint students poll every 5s) — so
//    there is no other way for the host to read back the current value.
//    A body with NEITHER field is therefore a READ, not an error: it
//    answers with the current leagueRounds/notes unchanged. That's also
//    why this stays a POST rather than a GET — the host code is a bearer
//    secret and never belongs in a URL/query string (see lib/server/http.ts's
//    other host-code routes, all POST for the same reason) — and it's what
//    lets NotesModal pre-fill its textarea through this one route instead of
//    a second one.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePost(req, ctx);
  } catch (err) {
    console.error("[tournament/[id]/config]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const limited = hostRateLimit(req);
  if (limited) return limited;
  const { id } = await params;
  // Same malformed-id guard as the sibling GET /api/tournament/[id]/codes: a
  // bad shape must answer "no such tournament", not throw into a false 503.
  if (!isUuid(id)) return fail(404, "not_found");

  const body = await readJson<{
    hostCode?: string;
    leagueRounds?: number;
    notes?: string;
  }>(req);

  const t = await authHost(id, body?.hostCode);
  if (!t) return fail(401, "unauthorized");

  const leagueRounds = body?.leagueRounds;
  const notes = body?.notes;
  if (leagueRounds === undefined && notes === undefined) {
    // Read-only: give the caller the current values without changing
    // anything (see the header comment above for why this beats a GET).
    return ok({ leagueRounds: t.config.leagueRounds, notes: t.config.notes ?? null });
  }

  const patch: { leagueRounds?: number; notes?: string } = {};

  if (leagueRounds !== undefined) {
    // Finishing early only makes sense mid-league — the lobby has no round in
    // progress, a playoff's round count isn't `leagueRounds`, and a finished
    // tournament has nothing left to shorten.
    if (t.status !== "league") return fail(409, "not_league");
    if (typeof leagueRounds !== "number" || !Number.isInteger(leagueRounds)) {
      return fail(400, "bad_request");
    }
    // Never below the round currently in progress/just finished — that round
    // is already committed (paired, maybe played) and can't be un-happened.
    if (leagueRounds < t.current_round) return fail(400, "too_low");
    // Must actually be LOWER than what's configured — this route only ever
    // shortens a tournament, never extends or no-ops one.
    if (leagueRounds >= t.config.leagueRounds) return fail(400, "not_lower");
    patch.leagueRounds = leagueRounds;
  }

  if (notes !== undefined) {
    if (typeof notes !== "string") return fail(400, "bad_request");
    patch.notes = notes.trim().slice(0, MAX_NOTES);
  }

  const updated = await updateTournamentConfig(t, patch);

  // The round count is part of the public board state (the "Runde n / N"
  // label, and whether the next round is the last) — nudge connected clients
  // to refetch it. `notes` never reaches students, so no broadcast for that.
  if (leagueRounds !== undefined) {
    defer(
      () =>
        broadcast(channels.lobby(t.id), events.tournament, {
          leagueRoundsChanged: id,
        }),
      "config:rounds",
    );
  }

  return ok({
    leagueRounds: updated.config.leagueRounds,
    notes: updated.config.notes ?? null,
  });
}
