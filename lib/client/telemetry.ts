"use client";

// Client beacon (T5, port of sundaychess#87). The ONE place the browser
// reports "something went wrong" so the teacher can read afterwards WHY a
// student was thrown out or a board froze. Everything here is deliberately
// tiny and deliberately anonymous.
//
// PRIVACY CONTRACT (docs/TELEMETRY.md is the human version):
//   sends  → the opaque UUIDs this app already minted (tournament/player/game),
//            a fixed `kind`, a small flat `detail` of status/error codes, a
//            per-page-load random `sid`, and the literal string "mobile" or
//            "desktop".
//   never  → display names, resume codes, host codes, PINs, IP addresses,
//            user-agent strings, URLs, or anything the student typed.
//
// RULES this module must never break:
//   * it must NEVER throw — a broken beacon must not break a game.
//   * it must NEVER report a failure of the beacon itself (no recursion, and
//     no telemetry about /api/telemetry).
//   * it must be a no-op on the server (it is imported from client components
//     that also render during SSR).

import { identity } from "@/lib/client/identity";
import { ApiError, NON_JSON } from "@/lib/client/api";
import { isUuid } from "@/lib/codes";

/** The allow-list. Mirrors the CHECK constraint in migration 0012 — adding a
 * kind here without adding it there means the row is rejected by Postgres. */
export type TelemetryKind =
  | "kick"
  | "watchdog"
  | "channel_error"
  | "api_timeout"
  | "api_network"
  | "api_5xx"
  | "move_rollback"
  | "game_vanished"
  | "tab_passive"
  | "js_error";

const ENDPOINT = "/api/telemetry";
const APP = "sundaytictactoe";

/** Kinds that are ABOUT a student's tournament session, and may therefore carry
 * the tournament/player ids.
 *
 * Everything else stays anonymous — notably `js_error`, which fires from every
 * screen in the app (a crash in /solo, /arranger, /versus or the root layout goes
 * through the same error boundary). Stamping the stored identity onto those was
 * the R6 mis-attribution bug: the teacher's readout showed a student's ids on
 * events that had nothing to do with that student's game, and a device that had
 * ONCE joined a tournament kept attributing crashes to it forever. */
const ATTRIBUTED_KINDS: ReadonlySet<TelemetryKind> = new Set<TelemetryKind>([
  "kick",
  "watchdog",
  "channel_error",
  "api_timeout",
  "api_network",
  "api_5xx",
  "move_rollback",
  "game_vanished",
  "tab_passive",
]);

/** May an event of this kind carry the student's ids? */
export function withIdentity(kind: TelemetryKind): boolean {
  return ATTRIBUTED_KINDS.has(kind);
}

/** Is this page a tournament page? `/play` is the ONLY screen that acts on a
 * stored student session; /solo, /versus and /arranger have identities of their own
 * (or none at all) and must never borrow one. Belt-and-braces with the kind list
 * above: a kind can only be attributed if BOTH agree. */
function onTournamentPage(): boolean {
  try {
    const path = window.location?.pathname ?? "";
    return path === "/play" || path.startsWith("/play/");
  } catch {
    return false;
  }
}

/** The ids to stamp on this event, or nothing.
 *
 * `tournamentId` may be carried explicitly in the detail bag (lifted into its
 * own column, exactly like `gameId`); otherwise it is derived from the session
 * this page is playing. A carried id that has no stored session still names the
 * tournament — the player half is simply omitted. */
function attribution(
  kind: TelemetryKind,
  carriedTournamentId: unknown,
): { tournamentId?: string; playerId?: string } {
  if (!withIdentity(kind) || !onTournamentPage()) return {};
  const me = isUuid(carriedTournamentId)
    ? identity.playerFor(carriedTournamentId)
    : identity.player();
  const tid: unknown = me?.tournamentId ?? carriedTournamentId;
  const pid: unknown = me?.playerId;
  return {
    // Opaque ids only, and only when they are genuinely UUIDs.
    tournamentId: isUuid(tid) ? tid : undefined,
    playerId: isUuid(pid) ? pid : undefined,
  };
}

/** Per-tab ceiling. A pathological loop (a channel flapping, a render error
 * firing on every frame) must cost the network 30 beacons a minute, not 3000.
 * The server has its own per-IP limit; this one protects the student's phone. */
const MAX_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;

/** Identical events inside this window are one event. The hooks sit on paths
 * that legitimately fire in bursts (a poll failing three times, a rollback that
 * re-syncs and fails again); the first one is the interesting one. */
const DEDUPE_MS = 5_000;

/** Cheap free-text guard applied before anything leaves the browser. The server
 * clamps again (it cannot trust us), but truncating here means a long stack
 * message never even travels. */
const MAX_STRING = 200;

let sid: string | null = null;
let sentInWindow = 0;
let windowStartedAt = 0;
const recent = new Map<string, number>();

/** Stable per-page-load correlation id. Random, meaningless on its own; it only
 * lets the readout say "these five events came from the same tab". */
function sessionId(): string {
  if (sid) return sid;
  try {
    sid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    sid = `${Date.now().toString(36)}`;
  }
  return sid;
}

/** COARSE device class — never the user-agent string, which is a fingerprint.
 * `(pointer: coarse)` is the honest question ("is this a finger?"); touch points
 * are the fallback for browsers that don't answer it. */
export function uaClass(): "mobile" | "desktop" {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      if (window.matchMedia("(pointer: coarse)").matches) return "mobile";
    }
    if (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0) {
      return "mobile";
    }
  } catch {
    // matchMedia can throw in exotic embeddings — fall through to the default.
  }
  return "desktop";
}

/** Which telemetry kind does this failed API call deserve? Shared by every
 * call site so the three api_* kinds always mean the same thing. */
export function apiKind(err: unknown): "api_timeout" | "api_network" | "api_5xx" {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.code === "timeout" ? "api_timeout" : "api_network";
    if (err.status >= 500) return "api_5xx";
  }
  return "api_network";
}

/** Error/status pair for a `detail`, with no message text. `NON_JSON` is kept
 * because "the reply wasn't even our API" is exactly the kind of thing the
 * teacher's readout should distinguish from a real rejection. */
export function errDetail(err: unknown): { code: string; status: number } {
  if (err instanceof ApiError) return { code: err.code || NON_JSON, status: err.status };
  return { code: "unknown", status: 0 };
}

/** Flatten + clamp a detail object: primitives only, strings truncated. Nested
 * structures are dropped rather than serialised, which keeps the payload small
 * AND makes it impossible to smuggle a whole object (a board state, a player
 * row) into telemetry by accident. */
function clampDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!detail) return out;
  for (const [k, v] of Object.entries(detail)) {
    if (v === undefined) continue;
    if (typeof v === "string") out[k] = v.slice(0, MAX_STRING);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    // anything else (object, array, function, symbol) is deliberately dropped
  }
  return out;
}

/** Rate cap + dedupe, in one decision. */
function allow(kind: string, detailKey: string, now: number): boolean {
  if (now - windowStartedAt >= RATE_WINDOW_MS) {
    windowStartedAt = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= MAX_PER_MINUTE) return false;

  const key = `${kind}|${detailKey}`;
  const last = recent.get(key);
  if (last !== undefined && now - last < DEDUPE_MS) return false;

  // Self-bounding: the map is keyed by (kind, detail) which is low-cardinality
  // in practice, but a detail carrying e.g. a changing status could still grow
  // it. Sweep expired entries whenever it gets silly.
  if (recent.size > 200) {
    for (const [k, t] of recent) if (now - t >= DEDUPE_MS) recent.delete(k);
  }
  recent.set(key, now);
  sentInWindow++;
  return true;
}

/** Report one client event. Fire-and-forget, never throws, no-op on the server.
 *
 * `detail.gameId` (and `detail.tournamentId`) are lifted into the row's own
 * columns when they are UUIDs (so the readout can group by game); everything
 * else in `detail` stays a flat bag of codes.
 *
 * The tournament/player ids are attached only when this is a tournament page
 * AND the kind is one that is about a session — see `attribution()`. */
export function report(
  kind: TelemetryKind,
  detail?: Record<string, unknown>,
): void {
  try {
    if (typeof window === "undefined") return; // server render — nothing to do

    const clamped = clampDetail(detail);
    // Lift a game id out of the detail bag into its own column.
    const rawGameId = clamped.gameId;
    let gameId: string | undefined;
    if (isUuid(rawGameId)) gameId = rawGameId;
    delete clamped.gameId;
    // …and a tournament id, which a call site may name explicitly when the page
    // is not the one whose session is stored last.
    const rawTournamentId = clamped.tournamentId;
    delete clamped.tournamentId;

    // Both lifted ids are part of the dedupe key: they are exactly what
    // distinguishes "the same failure, twice" from "the same failure in two
    // different games / tournaments", and they are no longer in `detail`.
    const detailKey = JSON.stringify(clamped);
    const named = typeof rawTournamentId === "string" ? rawTournamentId : "";
    if (!allow(kind, `${detailKey}|${gameId ?? ""}|${named}`, Date.now())) return;

    const { tournamentId, playerId } = attribution(kind, rawTournamentId);
    const payload = {
      app: APP,
      kind,
      detail: clamped,
      sid: sessionId(),
      uaClass: uaClass(),
      tournamentId,
      playerId,
      gameId,
    };
    const body = JSON.stringify(payload);

    // sendBeacon(url, string) sends text/plain and survives the page unloading —
    // which matters, because the most interesting events happen right before a
    // student's tab goes away. The route accepts text/plain for exactly this.
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(ENDPOINT, body)
    ) {
      return;
    }

    // Fallback (sendBeacon absent, or it refused because its queue is full).
    // `keepalive` gives the same "survives unload" property.
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      keepalive: true,
    }).catch(() => {
      // A failed beacon is NOT reportable — reporting it would recurse.
    });
  } catch {
    // Absolutely nothing here may reach the caller.
  }
}

/** Test-only: forget the rate window, the dedupe memory and the session id. */
export function __resetTelemetry(): void {
  sid = null;
  sentInWindow = 0;
  windowStartedAt = 0;
  recent.clear();
}
