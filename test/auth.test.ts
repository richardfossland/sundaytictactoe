import { beforeEach, describe, expect, it, vi } from "vitest";

// Control what the store returns; normalizeResumeCode (from lib/codes) stays real
// so we exercise the actual code-normalisation in the auth comparison.
const { store } = vi.hoisted(() => ({
  store: { getPlayer: vi.fn(), getTournament: vi.fn() },
}));
vi.mock("@/lib/server/store", () => store);

import { authPlayer, authHost } from "@/lib/server/auth";

// Real UUIDs — the helpers shape-check the id before touching the store (H2).
const P_ID = "11111111-1111-4111-8111-111111111111";
const T_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => vi.clearAllMocks());

describe("authPlayer", () => {
  it("returns the player when the resume code matches (case/format-insensitive)", async () => {
    store.getPlayer.mockResolvedValue({ id: P_ID, resume_code: "ABCD-EF" });
    expect(await authPlayer(P_ID, "abcd ef")).toEqual({
      id: P_ID,
      resume_code: "ABCD-EF",
    });
  });

  it("rejects a wrong resume code", async () => {
    store.getPlayer.mockResolvedValue({ id: P_ID, resume_code: "ABCD-EF" });
    expect(await authPlayer(P_ID, "ZZZZ-ZZ")).toBeNull();
  });

  it("rejects non-string credentials without touching the store", async () => {
    expect(await authPlayer(123, "ABCD-EF")).toBeNull();
    expect(await authPlayer(P_ID, null)).toBeNull();
    expect(store.getPlayer).not.toHaveBeenCalled();
  });

  it("rejects when the player does not exist", async () => {
    store.getPlayer.mockResolvedValue(null);
    expect(await authPlayer(P_ID, "ABCD-EF")).toBeNull();
  });

  // H2: getPlayer hands the id to Postgres as a uuid. A non-UUID makes PostgREST
  // throw 22P02, which every caller's catch-all turns into a false 503
  // "server_error" — an outage page for what is only a bad client id. The guard
  // lives HERE so all eleven call sites get it, and it must not query at all.
  it("rejects a malformed playerId WITHOUT touching the store (no 22P02 → no false 503)", async () => {
    for (const bad of [
      "nope",
      "p1",
      "",
      "11111111-1111-4111-8111-11111111111", // one char short
      "11111111-1111-4111-8111-111111111111x",
      "'; drop table players; --",
    ]) {
      expect(await authPlayer(bad, "ABCD-EF")).toBeNull();
    }
    expect(store.getPlayer).not.toHaveBeenCalled();
  });
});

describe("authHost", () => {
  it("returns the tournament when the host code matches", async () => {
    store.getTournament.mockResolvedValue({ id: T_ID, host_code: "WXYZ-12" });
    expect(await authHost(T_ID, "wxyz12")).toEqual({
      id: T_ID,
      host_code: "WXYZ-12",
    });
  });

  it("rejects a wrong host code", async () => {
    store.getTournament.mockResolvedValue({ id: T_ID, host_code: "WXYZ-12" });
    expect(await authHost(T_ID, "0000-00")).toBeNull();
  });

  it("rejects non-string args without touching the store", async () => {
    expect(await authHost(undefined, "WXYZ-12")).toBeNull();
    expect(store.getTournament).not.toHaveBeenCalled();
  });

  it("rejects a malformed tournamentId WITHOUT touching the store", async () => {
    for (const bad of ["t1", "probe", "not-a-uuid", 42, null]) {
      expect(await authHost(bad, "WXYZ-12")).toBeNull();
    }
    expect(store.getTournament).not.toHaveBeenCalled();
  });
});
