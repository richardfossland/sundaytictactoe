"use client";

// Local persistence of bearer identities for crash-recovery (spec §2). Only the
// resume/host code lives here — never authoritative game state, which is always
// refetched from the server on mount.

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
    try {
      localStorage.setItem(HOST_KEY(tournamentId), hostCode);
    } catch (e) {
      // Persistence lost (private mode / quota) → crash-recovery won't work for
      // this device. Surface it instead of failing silently.
      console.warn("[identity] localStorage write failed", e);
    }
  },
  hostCode(tournamentId: string): string | null {
    try {
      return localStorage.getItem(HOST_KEY(tournamentId));
    } catch {
      return null;
    }
  },
  savePlayer(p: StoredPlayer) {
    try {
      localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
    } catch (e) {
      // Persistence lost (private mode / quota) → crash-recovery won't work for
      // this device. Surface it instead of failing silently.
      console.warn("[identity] localStorage write failed", e);
    }
  },
  player(): StoredPlayer | null {
    try {
      const raw = localStorage.getItem(PLAYER_KEY);
      return raw ? (JSON.parse(raw) as StoredPlayer) : null;
    } catch {
      return null;
    }
  },
  clearPlayer() {
    try {
      localStorage.removeItem(PLAYER_KEY);
    } catch (e) {
      // Persistence lost (private mode / quota) → crash-recovery won't work for
      // this device. Surface it instead of failing silently.
      console.warn("[identity] localStorage write failed", e);
    }
  },
};
