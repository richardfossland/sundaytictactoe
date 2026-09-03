import { createServiceClient } from "@/lib/supabase/service";
import { clientIp, rateLimit } from "@/lib/server/http";
import { isMissingTable } from "@/lib/server/store";
import { isUuid } from "@/lib/codes";

// POST /api/telemetry — the write half of the client beacon (T5, port of
// sundaychess#87).
//
// CONTRACT: this endpoint ALWAYS answers 204 and NEVER throws. Not "usually" —
// always. It is called by `navigator.sendBeacon` from a page that is often in
// the act of unloading, and by a browser that is already having a bad time; an
// error body would be discarded unread, an exception would surface as a Worker
// error page, and a non-2xx would make some browsers retry. So: validate hard,
// insert best-effort, say 204 either way. A rejected event is a lost event, and
// a lost event is fine — this is debugging aid, not bookkeeping.
//
// It is also INERT until migration 0012 has been run: a missing table is a
// normal, expected condition here (warned once per isolate, then silent).
//
// Nothing is trusted from the body. The client clamps too, but this is the side
// that decides what reaches the database.
export const dynamic = "force-dynamic";

/** Mirrors the CHECK constraint in 0012 and the union in lib/client/telemetry.ts.
 * A kind outside this set is dropped here rather than being handed to Postgres,
 * which would answer 23514 and cost a round-trip to learn what we already know. */
const KINDS = new Set([
  "kick",
  "watchdog",
  "channel_error",
  "api_timeout",
  "api_network",
  "api_5xx",
  "move_rollback",
  "game_vanished",
  "tab_passive",
  "js_error",
]);

/** Hard ceiling on the JSON-encoded `detail`. */
const MAX_DETAIL_BYTES = 2048;
/** Per-string clamp applied while building `detail` (a stack message, a code). */
const MAX_STRING = 200;
/** `sid` is a random correlation token; anything longer is not one of ours. */
const MAX_SID = 64;
/** The whole request body. Comfortably above any legitimate beacon (a conforming
 * client sends well under 3 KB), but low enough that a junk payload is rejected
 * instead of parsed. Deliberately NOT tight to MAX_DETAIL_BYTES: a client that
 * ignores its own clamp should have its detail TRUNCATED — losing the one field
 * that was too long — rather than have the whole event silently vanish. */
const MAX_BODY_BYTES = 32_768;

const enc = new TextEncoder();
function byteLength(s: string): number {
  return enc.encode(s).length;
}

/** Warn once per isolate that the table isn't there yet — a Worker isolate can
 * serve thousands of beacons, and this is a KNOWN state (owner hasn't run 0012),
 * not an incident. One line is a reminder; thousands are noise that hides real
 * errors. */
let warnedMissingTable = false;

function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** Flat, primitives-only, size-bounded detail. Strings are truncated, nested
 * structures dropped entirely, and the running JSON size is checked after every
 * key so the result is ALWAYS within MAX_DETAIL_BYTES — a client that ignores
 * its own clamp (or isn't our client at all) cannot push a blob into the DB. */
function sanitizeDetail(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.slice(0, 40);
    let val: unknown;
    if (typeof v === "string") val = v.slice(0, MAX_STRING);
    else if (typeof v === "number" && Number.isFinite(v)) val = v;
    else if (typeof v === "boolean" || v === null) val = v;
    else continue; // objects, arrays, functions, undefined → dropped
    out[key] = val;
    if (byteLength(JSON.stringify(out)) > MAX_DETAIL_BYTES) {
      delete out[key];
      break; // budget spent — keep what fits, drop the rest
    }
  }
  return out;
}

/** A UUID or null — never the raw value. */
function uuidOrNull(v: unknown): string | null {
  return isUuid(v) ? v : null;
}

export async function POST(req: Request): Promise<Response> {
  try {
    // Same shape as every other throttle in the app (x-forwarded-for, first
    // hop). 60/min per IP: a whole classroom behind one school NAT generates a
    // handful of events per lesson, so this only ever bites a loop or an abuser.
    if (!rateLimit(`telemetry:${clientIp(req)}`, 60, 60_000)) return noContent();

    // sendBeacon(url, string) sends `text/plain;charset=UTF-8`; a fetch fallback
    // may send JSON. Read the body as TEXT and parse it ourselves so BOTH work
    // and neither can throw past us.
    const text = await req.text();
    if (!text || byteLength(text) > MAX_BODY_BYTES) return noContent();

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return noContent();
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return noContent();
    const b = body as Record<string, unknown>;

    const kind = typeof b.kind === "string" ? b.kind : "";
    if (!KINDS.has(kind)) return noContent();

    const sid =
      typeof b.sid === "string" && b.sid.trim() ? b.sid.slice(0, MAX_SID) : null;
    // Only the two literals we defined. Anything else (including a smuggled UA
    // string) becomes null rather than being stored.
    const uaClass = b.uaClass === "mobile" || b.uaClass === "desktop" ? b.uaClass : null;

    const { error } = await createServiceClient().from("client_events").insert({
      tournament_id: uuidOrNull(b.tournamentId),
      player_id: uuidOrNull(b.playerId),
      game_id: uuidOrNull(b.gameId),
      kind,
      detail: sanitizeDetail(b.detail),
      sid,
      ua_class: uaClass,
    });

    if (error) {
      if (isMissingTable(error)) {
        if (!warnedMissingTable) {
          warnedMissingTable = true;
          console.warn("[telemetry]", (error as { code?: string }).code ?? "missing_table");
        }
      } else {
        // A real DB error still answers 204 — but it should be findable in the
        // Worker log, because unlike a missing table it is NOT expected.
        console.warn("[telemetry]", (error as { code?: string }).code ?? "insert_failed");
      }
    }
    return noContent();
  } catch (err) {
    // Env missing, DB timeout, malformed request stream — all the same to the
    // caller. Never leak the reason: the beacon is unauthenticated.
    console.warn("[telemetry]", err instanceof Error ? err.name : "error");
    return noContent();
  }
}
