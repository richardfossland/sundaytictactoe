import { beforeEach, describe, expect, it, vi } from "vitest";

// Control what the store returns; normalizeResumeCode (from lib/codes) stays real
// so we exercise the actual code-normalisation in the auth comparison.
const { store } = vi.hoisted(() => ({
  store: { getPlayer: vi.fn(), getTournament: vi.fn() },
}));
vi.mock("@/lib/server/store", () => store);

import { authPlayer, authHost } from "@/lib/server/auth";

beforeEach(() => vi.clearAllMocks());

describe("authPlayer", () => {
  it("returns the player when the resume code matches (case/format-insensitive)", async () => {
    store.getPlayer.mockResolvedValue({ id: "p1", resume_code: "ABCD-EF" });
    expect(await authPlayer("p1", "abcd ef")).toEqual({ id: "p1", resume_code: "ABCD-EF" });
  });

  it("rejects a wrong resume code", async () => {
    store.getPlayer.mockResolvedValue({ id: "p1", resume_code: "ABCD-EF" });
    expect(await authPlayer("p1", "ZZZZ-ZZ")).toBeNull();
  });

  it("rejects non-string credentials without touching the store", async () => {
    expect(await authPlayer(123, "ABCD-EF")).toBeNull();
    expect(await authPlayer("p1", null)).toBeNull();
    expect(store.getPlayer).not.toHaveBeenCalled();
  });

  it("rejects when the player does not exist", async () => {
    store.getPlayer.mockResolvedValue(null);
    expect(await authPlayer("nope", "ABCD-EF")).toBeNull();
  });
});

describe("authHost", () => {
  it("returns the tournament when the host code matches", async () => {
    store.getTournament.mockResolvedValue({ id: "t1", host_code: "WXYZ-12" });
    expect(await authHost("t1", "wxyz12")).toEqual({ id: "t1", host_code: "WXYZ-12" });
  });

  it("rejects a wrong host code", async () => {
    store.getTournament.mockResolvedValue({ id: "t1", host_code: "WXYZ-12" });
    expect(await authHost("t1", "0000-00")).toBeNull();
  });

  it("rejects non-string args without touching the store", async () => {
    expect(await authHost(undefined, "WXYZ-12")).toBeNull();
    expect(store.getTournament).not.toHaveBeenCalled();
  });
});
