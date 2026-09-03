import { afterEach, describe, expect, it, vi } from "vitest";

// The quickmatch seam is the ONLY route that can mint a tournament, two players
// and a live game in one unauthenticated call. In production it must be shut,
// and it may only reopen for the e2e process that explicitly asks for it.
//
// The gate is two conditions and both matter:
//   * NODE_ENV === "production"  — inlined by the compiler, so a shipped bundle
//     carries the literal; nothing at runtime can flip it back to development.
//   * E2E_SEAM !== "1"           — an ordinary server env var, read per request.
//
// These tests pin the FAIL-CLOSED half: production with no E2E_SEAM, and
// production with an E2E_SEAM that isn't exactly "1" (a half-set variable, a
// "true", a "0" — all of them must stay 404). The open case is asserted last so
// a regression that shuts the seam permanently is caught too.

// The store is never reached on the 404 path; stubbing it keeps the open-seam
// case DB-free (and proves the route got past the gate).
const store = vi.hoisted(() => ({
  createTournament: vi.fn(),
  updateTournament: vi.fn(),
  addPlayer: vi.fn(),
  createRound: vi.fn(),
  createGame: vi.fn(),
}));

vi.mock("@/lib/server/store", () => ({
  DEFAULT_CONFIG: {},
  createTournament: store.createTournament,
  updateTournament: store.updateTournament,
  addPlayer: store.addPlayer,
  createRound: store.createRound,
  createGame: store.createGame,
}));

import { POST } from "@/app/api/dev/quickmatch/route";

function req(body: unknown = {}): Request {
  return new Request("http://x/api/dev/quickmatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/dev/quickmatch — production gate", () => {
  it("404s in a production build when E2E_SEAM is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_SEAM", undefined);
    const res = await POST(req());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
    // The gate must return BEFORE any store call — a 404 that still wrote rows
    // would be a seam in everything but the status code.
    expect(store.createTournament).not.toHaveBeenCalled();
  });

  // Fails closed on anything but the exact opt-in. "0"/"false" are the obvious
  // ones; "" and "true" are the ones a truthiness check would get wrong in
  // opposite directions.
  it.each(["0", "", "true", "yes", "2", "1 ", " 1", "TRUE", "on"])(
    '404s in a production build when E2E_SEAM is %j (only "1" opens it)',
    async (value) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("E2E_SEAM", value);
      const res = await POST(req());
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "not_found" });
      expect(store.createTournament).not.toHaveBeenCalled();
    },
  );

  it("opens for the e2e process: production + E2E_SEAM=1 reaches the store", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_SEAM", "1");
    store.createTournament.mockResolvedValue({ id: "t1", host_code: "HC" });
    store.updateTournament.mockResolvedValue(undefined);
    store.addPlayer
      .mockResolvedValueOnce({ id: "w1", resume_code: "WWW" })
      .mockResolvedValueOnce({ id: "b1", resume_code: "BBB" });
    store.createRound.mockResolvedValue({ id: "r1" });
    store.createGame.mockResolvedValue({ id: "g1" });

    const res = await POST(req({ white: "Ada", black: "Bo" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      tournamentId: "t1",
      gameId: "g1",
      hostCode: "HC",
      white: { playerId: "w1", resumeCode: "WWW" },
      black: { playerId: "b1", resumeCode: "BBB" },
    });
    expect(store.addPlayer).toHaveBeenNthCalledWith(1, "t1", "Ada");
    expect(store.addPlayer).toHaveBeenNthCalledWith(2, "t1", "Bo");
  });

  it("stays open in development without any E2E_SEAM", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_SEAM", undefined);
    store.createTournament.mockResolvedValue({ id: "t2", host_code: "HC2" });
    store.updateTournament.mockResolvedValue(undefined);
    store.addPlayer
      .mockResolvedValueOnce({ id: "w2", resume_code: "W2" })
      .mockResolvedValueOnce({ id: "b2", resume_code: "B2" });
    store.createRound.mockResolvedValue({ id: "r2" });
    store.createGame.mockResolvedValue({ id: "g2" });

    const res = await POST(req());
    expect(res.status).toBe(200);
  });
});
