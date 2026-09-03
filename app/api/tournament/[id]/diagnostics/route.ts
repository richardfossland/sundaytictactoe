import { authHost } from "@/lib/server/auth";
import { listClientEvents } from "@/lib/server/store";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";
import type { DiagnosticsResult } from "@/lib/dto";

// POST /api/tournament/[id]/diagnostics — teacher-only (host code). The read
// half of the client beacon (T5, port of sundaychess#87): what actually
// happened to the students in this tournament, so "det funka ikke" can be
// answered after the lesson.
//
// Gated EXACTLY like the sibling codes route (same host auth, same per-IP
// throttle, same malformed-id guard) — the events carry opaque player ids, and
// pairing those with the roster is a teacher's business, nobody else's.
//
// Degrades: while migration 0012 has not been run the table does not exist, and
// that is a normal state, not an outage → `unavailable: true`, never a 503.
export const dynamic = "force-dynamic";

/** How many events the modal shows. One class, one lesson, comfortably. */
const LIMIT = 200;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePost(req, ctx);
  } catch (err) {
    console.error("[diagnostics]", err);
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
  // Same malformed-id guard as every sibling route: a bad shape must answer
  // "no such tournament", not throw Postgres 22P02 into a false 503.
  if (!isUuid(id)) return fail(404, "not_found");
  const body = await readJson<{ hostCode?: string }>(req);

  const t = await authHost(id, body?.hostCode);
  if (!t) return fail(401, "unauthorized");

  const rows = await listClientEvents(id, LIMIT);
  if (rows === null) {
    // Table not created yet — an answer, not an error.
    const empty: DiagnosticsResult = { events: [], counts: {}, unavailable: true };
    return ok(empty);
  }

  const byKind: Record<string, number> = {};
  const byPlayer: Record<string, number> = {};
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    const p = r.player_id ?? "?";
    byPlayer[p] = (byPlayer[p] ?? 0) + 1;
  }

  const result: DiagnosticsResult = {
    events: rows.map((r) => ({
      id: r.id,
      at: r.at,
      kind: r.kind,
      playerId: r.player_id,
      gameId: r.game_id,
      detail: r.detail ?? {},
      sid: r.sid,
      uaClass: r.ua_class,
    })),
    counts: { byKind, byPlayer },
  };
  return ok(result);
}
