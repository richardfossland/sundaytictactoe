import { afterEach, beforeEach, describe, expect, it } from "vitest";

// vitest runs in the node environment (no jsdom), so provide a minimal
// localStorage. identity reads it lazily inside each call, so setting it per
// test is enough.
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
});
afterEach(() => {
  delete (globalThis as unknown as { localStorage?: MemStorage }).localStorage;
});

import { identity } from "@/lib/client/identity";

describe("identity", () => {
  it("round-trips a stored player and clears it", () => {
    const p = { tournamentId: "t1", playerId: "p1", resumeCode: "ABCD-EF", displayName: "Ada" };
    identity.savePlayer(p);
    expect(identity.player()).toEqual(p);
    identity.clearPlayer();
    expect(identity.player()).toBeNull();
  });

  it("stores host codes per tournament", () => {
    identity.saveHostCode("t1", "WXYZ-12");
    expect(identity.hostCode("t1")).toBe("WXYZ-12");
    expect(identity.hostCode("t2")).toBeNull();
  });

  it("returns null for a garbage stored player", () => {
    localStorage.setItem("ttt:player", "{not json");
    expect(identity.player()).toBeNull();
  });
});
