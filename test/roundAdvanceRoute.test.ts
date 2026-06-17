import { beforeEach, describe, expect, it, vi } from "vitest";

// Verify the advance route's guards + the double-fire (23505) recovery: a second
// concurrent "Neste runde" must not 500 — the first already advanced, so answer
// 200 with the fresh status.
const authHost = vi.fn();
const advanceRound = vi.fn();
const currentRoundResolved = vi.fn();
const advancePlayoff = vi.fn();
const playoffRoundResolved = vi.fn();
const getTournament = vi.fn();
const isUniqueViolation = vi.fn();

vi.mock("@/lib/server/auth", () => ({ authHost: (...a: unknown[]) => authHost(...a) }));
vi.mock("@/lib/server/league", () => ({
  advanceRound: (...a: unknown[]) => advanceRound(...a),
  currentRoundResolved: (...a: unknown[]) => currentRoundResolved(...a),
}));
vi.mock("@/lib/server/playoff", () => ({
  advancePlayoff: (...a: unknown[]) => advancePlayoff(...a),
  playoffRoundResolved: (...a: unknown[]) => playoffRoundResolved(...a),
}));
vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  isUniqueViolation: (...a: unknown[]) => isUniqueViolation(...a),
}));

import { POST } from "@/app/api/round/advance/route";

const req = (body: unknown) =>
  new Request("http://x/api/round/advance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  authHost.mockResolvedValue({ id: "t", status: "league" });
  currentRoundResolved.mockResolvedValue(true);
});

describe("POST /api/round/advance", () => {
  it("401 without host auth", async () => {
    authHost.mockResolvedValue(null);
    expect((await POST(req({ tournamentId: "t", hostCode: "x" }))).status).toBe(401);
  });

  it("409 round_unresolved when the current round isn't done", async () => {
    currentRoundResolved.mockResolvedValue(false);
    const res = await POST(req({ tournamentId: "t", hostCode: "h" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("round_unresolved");
  });

  it("advances normally and returns the new status", async () => {
    advanceRound.mockResolvedValue("league");
    isUniqueViolation.mockReturnValue(false);
    const res = await POST(req({ tournamentId: "t", hostCode: "h" }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("league");
  });

  it("recovers from a double-fire (23505) with 200 + the fresh status", async () => {
    advanceRound.mockRejectedValue({ code: "23505" });
    isUniqueViolation.mockReturnValue(true);
    getTournament.mockResolvedValue({ id: "t", status: "playoff" });
    const res = await POST(req({ tournamentId: "t", hostCode: "h" }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("playoff");
  });
});
