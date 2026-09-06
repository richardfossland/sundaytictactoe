"use client";

// Local persistence of bearer identities for crash-recovery (spec §2). Only the
// resume/host code lives here — never authoritative game state, which is always
// refetched from the server on mount.
//
// ## Why student sessions are keyed PER TOURNAMENT (R6, port of sundaychess#105)
//
// The old layout was a single `ttt:player` slot: one student session per
// browser. That is wrong in the one place it matters — a class that plays two
// tournaments on the same shared iPad, or a student who scans a new PIN while
// the old tournament is still running. Joining B overwrote A's resume code
// with no warning, and A was then only recoverable from the paper the student
// (probably) didn't write it down on.
//
// So: one record per tournament under `ttt:player:<tournamentId>`, plus a
// `ttt:player:last` pointer naming the tournament the bare `/play` entry
// should resume, plus a `ttt:player:index` list so `allPlayers()` can
// enumerate sessions without walking localStorage key-by-key (every access in
// this app goes through the safe helpers in lib/client/storage.ts, which
// deliberately expose get/set/remove and nothing else).
//
// No cookie. The plan floated an HttpOnly companion cookie against Safari ITP's
// 7-day script-storage eviction; tournaments are same-day classroom events, so
// the eviction window never bites and the cookie would be server surface with
// no symptom behind it.

import { safeGet, safeRemove, safeSet } from "@/lib/client/storage";
import { clampSkill, INITIAL_RATING, type RatingState } from "@/lib/ttt/skill";

const HOST_KEY = (id: string) => `ttt:host:${id}`;
const PLAYER_KEY = (tournamentId: string) => `ttt:player:${tournamentId}`;
/** Which tournament the bare `/play` entry resumes. */
const LAST_KEY = "ttt:player:last";
/** Tournament ids that have a stored session, oldest write first. */
const INDEX_KEY = "ttt:player:index";
/** Pre-R6 single-slot key. Read once, migrated, deleted — never written again. */
const LEGACY_PLAYER_KEY = "ttt:player";
const SOLO_RATING_KEY = "ttt:solo-rating"; // adaptive solo difficulty, per device

/** `last` and `index` live in the same `ttt:player:` namespace as the
 *  per-tournament records. Real ids are UUIDs so they can never collide, but a
 *  corrupt/hostile id must not be able to overwrite the pointer either. */
const RESERVED_IDS = new Set(["last", "index"]);

function isStorableId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 100 &&
    !RESERVED_IDS.has(id) &&
    !id.includes(":")
  );
}

export interface StoredPlayer {
  tournamentId: string;
  playerId: string;
  resumeCode: string;
  displayName: string;
}

function isStoredPlayer(v: unknown): v is StoredPlayer {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<StoredPlayer>;
  return (
    isStorableId(p.tournamentId) &&
    typeof p.playerId === "string" &&
    p.playerId.length > 0 &&
    typeof p.resumeCode === "string" &&
    typeof p.displayName === "string"
  );
}

/** Read the record filed under one tournament. A record whose own
 *  `tournamentId` disagrees with the key it was found under is corrupt, not a
 *  session — treat it as absent rather than resuming into the wrong game. */
function readPlayer(tournamentId: string): StoredPlayer | null {
  if (!isStorableId(tournamentId)) return null;
  const raw = safeGet(PLAYER_KEY(tournamentId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredPlayer(parsed) || parsed.tournamentId !== tournamentId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readIndex(): string[] {
  const raw = safeGet(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStorableId);
  } catch {
    return [];
  }
}

/** Move `tournamentId` to the end of the index (most recently written last). */
function indexAdd(tournamentId: string): void {
  const ids = readIndex().filter((id) => id !== tournamentId);
  ids.push(tournamentId);
  safeSet(INDEX_KEY, JSON.stringify(ids));
}

function indexRemove(tournamentId: string): void {
  const ids = readIndex().filter((id) => id !== tournamentId);
  if (ids.length === 0) safeRemove(INDEX_KEY);
  else safeSet(INDEX_KEY, JSON.stringify(ids));
}

function writePlayer(p: StoredPlayer): boolean {
  return safeSet(PLAYER_KEY(p.tournamentId), JSON.stringify(p));
}

/**
 * Pre-R6 devices carry one `ttt:player` blob. Fold it into the new layout the
 * first time anything reads or writes an identity, then delete it — a student
 * mid-tournament when the deploy lands must keep their seat.
 *
 * Runs on every accessor rather than once per page load: it is one `getItem` of
 * a key that is absent on every device that has already migrated, and a memo
 * would make the migration depend on which accessor ran first.
 */
function migrateLegacy(): void {
  const raw = safeGet(LEGACY_PLAYER_KEY);
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isStoredPlayer(parsed)) {
      // Never clobber a record the new layout already holds for that
      // tournament: the new one was written by newer code and is fresher.
      if (!readPlayer(parsed.tournamentId)) writePlayer(parsed);
      indexAdd(parsed.tournamentId);
      if (!isStorableId(safeGet(LAST_KEY))) safeSet(LAST_KEY, parsed.tournamentId);
    }
  } catch {
    // A corrupt legacy blob carries no session — dropping it IS the migration.
  }
  safeRemove(LEGACY_PLAYER_KEY);
}

export const identity = {
  saveHostCode(tournamentId: string, hostCode: string) {
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeSet(HOST_KEY(tournamentId), hostCode)) {
      console.warn("[identity] localStorage write failed");
    }
  },
  hostCode(tournamentId: string): string | null {
    return safeGet(HOST_KEY(tournamentId));
  },

  /** Store (or refresh) the session for `p.tournamentId` and make it the one the
   *  bare `/play` entry resumes. Sessions for OTHER tournaments are untouched —
   *  that is the whole point of R6. */
  savePlayer(p: StoredPlayer) {
    migrateLegacy();
    if (!isStoredPlayer(p)) {
      console.warn("[identity] refusing to store a malformed player");
      return;
    }
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    const ok = writePlayer(p);
    const pointed = safeSet(LAST_KEY, p.tournamentId);
    indexAdd(p.tournamentId);
    if (!ok || !pointed) {
      console.warn("[identity] localStorage write failed");
    }
  },

  /** The session for ONE tournament. */
  playerFor(tournamentId: string): StoredPlayer | null {
    migrateLegacy();
    return readPlayer(tournamentId);
  },

  /** The session the bare `/play` entry resumes: the last tournament joined or
   *  resumed on this device. A dangling pointer (its record was cleared) is
   *  pruned and reads as "no session" — it deliberately does NOT fall through to
   *  some other stored tournament, because "Logg ut" must not land the student
   *  in a different game. */
  player(): StoredPlayer | null {
    migrateLegacy();
    const last = safeGet(LAST_KEY);
    if (!isStorableId(last)) return null;
    const stored = readPlayer(last);
    if (!stored) {
      safeRemove(LAST_KEY);
      indexRemove(last);
      return null;
    }
    return stored;
  },

  /** Every session on this device, most recently written first. Feeds a future
   *  "Bytt spiller" chooser; also the honest answer to "what is on this iPad?".
   *  Self-healing: index entries whose record is gone are dropped. */
  allPlayers(): StoredPlayer[] {
    migrateLegacy();
    const ids = readIndex();
    const out: StoredPlayer[] = [];
    const alive: string[] = [];
    for (const id of ids) {
      const stored = readPlayer(id);
      if (!stored) continue;
      alive.push(id);
      out.push(stored);
    }
    if (alive.length !== ids.length) {
      if (alive.length === 0) safeRemove(INDEX_KEY);
      else safeSet(INDEX_KEY, JSON.stringify(alive));
    }
    return out.reverse();
  },

  /** The device's adaptive single-player rating (Elo-like). Client-only; never
   *  authoritative, never sent to the server, and deliberately NOT part of the
   *  tournament identity — logging out of a tournament must not reset how well
   *  the solo bot has learned to match this child. Falls back to the initial
   *  rating if absent or corrupt. */
  soloRating(): RatingState {
    const raw = safeGet(SOLO_RATING_KEY);
    if (!raw) return { ...INITIAL_RATING };
    try {
      const parsed = JSON.parse(raw) as Partial<RatingState>;
      const rating = clampSkill(Number(parsed.rating));
      const games = Number.isFinite(parsed.games)
        ? Math.max(0, Math.floor(parsed.games as number))
        : 0;
      return { rating, games };
    } catch {
      return { ...INITIAL_RATING };
    }
  },
  saveSoloRating(state: RatingState) {
    // Best-effort only: a lost write costs a difficulty setting, not a session,
    // so this one does NOT warn the way the identity writes above do.
    safeSet(SOLO_RATING_KEY, JSON.stringify(state));
  },

  /** Forget ONE tournament's session (default: the one `player()` returns). The
   *  pointer is cleared only when it named that tournament, so logging out of A
   *  never touches B. */
  clearPlayer(tournamentId?: string) {
    migrateLegacy();
    const last = safeGet(LAST_KEY);
    const id = tournamentId ?? (isStorableId(last) ? last : null);
    if (!isStorableId(id)) return;
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeRemove(PLAYER_KEY(id))) {
      console.warn("[identity] localStorage write failed");
    }
    indexRemove(id);
    if (last === id) safeRemove(LAST_KEY);
  },
};
