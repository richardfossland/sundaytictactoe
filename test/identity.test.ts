import { afterEach, beforeEach, describe, expect, it } from "vitest";

// vitest runs in the node environment (no jsdom), so provide a minimal
// window + localStorage. identity goes through lib/client/storage.ts, which
// gates on `typeof window`, so `window` must exist too — pointing it at
// globalThis itself (as it is in a real browser) makes `window.localStorage`
// resolve to the same stub. identity reads it lazily inside each call, so
// setting it per test is enough.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  (globalThis as unknown as { window: unknown }).window = globalThis;
});
afterEach(() => {
  delete (globalThis as unknown as { localStorage?: MemStorage }).localStorage;
  delete (globalThis as unknown as { window?: unknown }).window;
});

import { identity } from "@/lib/client/identity";

const ADA = { tournamentId: "t1", playerId: "p1", resumeCode: "ABCD-EF", displayName: "Ada" };
const BO = { tournamentId: "t2", playerId: "p2", resumeCode: "KOLE-7F", displayName: "Bo" };

describe("identity", () => {
  it("round-trips a stored player and clears it", () => {
    identity.savePlayer(ADA);
    expect(identity.player()).toEqual(ADA);
    identity.clearPlayer();
    expect(identity.player()).toBeNull();
  });

  it("stores one session PER TOURNAMENT — joining B keeps A's resume code", () => {
    identity.savePlayer(ADA);
    identity.savePlayer(BO);

    expect(identity.playerFor("t1")).toEqual(ADA);
    expect(identity.playerFor("t2")).toEqual(BO);
    expect(identity.playerFor("t3")).toBeNull();
    // …and they really are separate keys, not one slot.
    expect(localStorage.getItem("ttt:player:t1")).toBeTruthy();
    expect(localStorage.getItem("ttt:player:t2")).toBeTruthy();
  });

  it("player() follows the `last` pointer to the tournament joined most recently", () => {
    identity.savePlayer(ADA);
    expect(identity.player()).toEqual(ADA);
    identity.savePlayer(BO);
    expect(identity.player()).toEqual(BO);
    expect(localStorage.getItem("ttt:player:last")).toBe("t2");
    // Re-saving the OLDER session points back at it (a resume on /play).
    identity.savePlayer(ADA);
    expect(identity.player()).toEqual(ADA);
  });

  it("clearPlayer(tid) forgets only that tournament", () => {
    identity.savePlayer(ADA);
    identity.savePlayer(BO);

    identity.clearPlayer("t1");
    expect(identity.playerFor("t1")).toBeNull();
    expect(identity.playerFor("t2")).toEqual(BO);
    // The pointer named t2, so it survives untouched.
    expect(identity.player()).toEqual(BO);
  });

  it("clearPlayer() with no argument forgets the pointed-at session only", () => {
    identity.savePlayer(ADA);
    identity.savePlayer(BO); // pointer → t2

    identity.clearPlayer();
    expect(identity.player()).toBeNull(); // pointer cleared with it
    expect(identity.playerFor("t2")).toBeNull();
    expect(identity.playerFor("t1")).toEqual(ADA); // untouched
  });

  it("a dangling pointer reads as no session and is pruned", () => {
    identity.savePlayer(ADA);
    localStorage.removeItem("ttt:player:t1"); // record lost, pointer left behind

    expect(identity.player()).toBeNull();
    expect(localStorage.getItem("ttt:player:last")).toBeNull();
  });

  it("allPlayers() lists every stored session, most recent first", () => {
    expect(identity.allPlayers()).toEqual([]);
    identity.savePlayer(ADA);
    identity.savePlayer(BO);
    expect(identity.allPlayers()).toEqual([BO, ADA]);

    identity.clearPlayer("t2");
    expect(identity.allPlayers()).toEqual([ADA]);
  });

  it("allPlayers() self-heals an index entry whose record vanished", () => {
    identity.savePlayer(ADA);
    identity.savePlayer(BO);
    localStorage.removeItem("ttt:player:t1");

    expect(identity.allPlayers()).toEqual([BO]);
    expect(JSON.parse(localStorage.getItem("ttt:player:index")!)).toEqual(["t2"]);
  });

  it("migrates a pre-R6 `ttt:player` blob on first read, then deletes it", () => {
    localStorage.setItem("ttt:player", JSON.stringify(ADA));

    expect(identity.player()).toEqual(ADA);
    expect(identity.playerFor("t1")).toEqual(ADA);
    expect(localStorage.getItem("ttt:player")).toBeNull(); // never re-applied
    expect(localStorage.getItem("ttt:player:last")).toBe("t1");
    expect(identity.allPlayers()).toEqual([ADA]);
  });

  it("migrates on a WRITE too, and never clobbers a newer record", () => {
    identity.savePlayer(ADA); // new layout, fresh
    const stale = { ...ADA, resumeCode: "OLD-111", displayName: "Ada (old)" };
    localStorage.setItem("ttt:player", JSON.stringify(stale));

    identity.savePlayer(BO);
    expect(localStorage.getItem("ttt:player")).toBeNull();
    expect(identity.playerFor("t1")).toEqual(ADA); // the fresh one won
  });

  it("refuses a malformed player, and ids that would collide with the pointer", () => {
    identity.savePlayer({ tournamentId: "", playerId: "p", resumeCode: "A", displayName: "X" });
    identity.savePlayer({ tournamentId: "last", playerId: "p", resumeCode: "A", displayName: "X" });
    expect(identity.player()).toBeNull();
    expect(identity.allPlayers()).toEqual([]);
    expect(localStorage.getItem("ttt:player:last")).toBeNull();
  });

  it("stores host codes per tournament", () => {
    identity.saveHostCode("t1", "WXYZ-12");
    expect(identity.hostCode("t1")).toBe("WXYZ-12");
    expect(identity.hostCode("t2")).toBeNull();
  });

  it("drops a corrupt legacy blob instead of resurrecting it", () => {
    localStorage.setItem("ttt:player", "{not json");
    expect(identity.player()).toBeNull();
    expect(localStorage.getItem("ttt:player")).toBeNull();
  });
});
