"use client";

// Local persistence of bearer identities for crash-recovery (spec §2). Only the
// resume/host code lives here — never authoritative game state, which is always
// refetched from the server on mount.

import { safeGet, safeRemove, safeSet } from "@/lib/client/storage";
import { clampSkill, INITIAL_RATING, type RatingState } from "@/lib/ttt/skill";

const HOST_KEY = (id: string) => `ttt:host:${id}`;
const PLAYER_KEY = "ttt:player"; // single active student session per browser
const SOLO_RATING_KEY = "ttt:solo-rating"; // adaptive solo difficulty, per device

export interface StoredPlayer {
  tournamentId: string;
  playerId: string;
  resumeCode: string;
  displayName: string;
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
  savePlayer(p: StoredPlayer) {
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeSet(PLAYER_KEY, JSON.stringify(p))) {
      console.warn("[identity] localStorage write failed");
    }
  },
  player(): StoredPlayer | null {
    const raw = safeGet(PLAYER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredPlayer;
    } catch {
      return null;
    }
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
  clearPlayer() {
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeRemove(PLAYER_KEY)) {
      console.warn("[identity] localStorage write failed");
    }
  },
};
