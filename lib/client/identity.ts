"use client";

// Local persistence of bearer identities for crash-recovery (spec §2). Only the
// resume/host code lives here — never authoritative game state, which is always
// refetched from the server on mount.

import { safeGet, safeRemove, safeSet } from "@/lib/client/storage";

const HOST_KEY = (id: string) => `ttt:host:${id}`;
const PLAYER_KEY = "ttt:player"; // single active student session per browser

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
  clearPlayer() {
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeRemove(PLAYER_KEY)) {
      console.warn("[identity] localStorage write failed");
    }
  },
};
