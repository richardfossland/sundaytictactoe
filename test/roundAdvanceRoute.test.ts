import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// Verify the advance route's guards + the double-fire (23505) recovery: a second
// concurrent "Neste runde" must not 500 — the first already advanced, so answer
// 200 with the fresh status. Real auth, mocked store, so the uuid guard is
// exercised for real rather than through an authHost stub.
const getTournament = vi.fn();
const advanceRound = vi.fn();
const currentRoundResolved = vi.fn();
const advancePlayoff = vi.fn();
const playoffRoundResolved = vi.fn();
const isUniqueViolation = vi.fn();

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
  getPlayer: vi.fn(), // imported by lib/server/auth
  isUniqueViolation: (...a: unknown[]) => isUniqueViolation(...a),
}));

import { POST } from "@/app/api/round/advance/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";
const HOST = "HOST-01";

const tournament = (over: Partial<Tournament> = {}): Tournament =>
  ({
    id: T_ID,
    join_pin: "123456",
    host_code: HOST,
    host_user_id: null,
    title: null,
    status: "league",
    config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 1,
    created_at: "",
    ...over,
  }) as Tournament;

const req = (body: unknown) =>
  new Request("http://x/api/round/advance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { tournamentId: T_ID, hostCode: HOST };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getTournament.mockResolvedValue(tournament());
  currentRoundResolved.mockResolvedValue(true);
});

describe("POST /api/round/advance", () => {
  it("401 without host auth", async () => {
    expect((await POST(req({ tournamentId: T_ID, hostCode: "ZZZZ-99" }))).status).toBe(401);
  });

  it("409 round_unresolved when the current round isn't done", async () => {
    currentRoundResolved.mockResolvedValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("round_unresolved");
  });

  it("advances normally and returns the new status", async () => {
    advanceRound.mockResolvedValue("league");
    isUniqueViolation.mockReturnValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("league");
  });

  it("recovers from a double-fire (23505) with 200 + the fresh status", async () => {
    advanceRound.mockRejectedValue({ code: "23505" });
    isUniqueViolation.mockReturnValue(true);
    // 1st call = the auth lookup, 2nd = the post-conflict re-read.
    getTournament
      .mockResolvedValueOnce(tournament())
      .mockResolvedValueOnce(tournament({ status: "playoff" }));
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("playoff");
  });

  it("401s JSON on a malformed tournamentId, without ever querying Postgres", async () => {
    const res = await POST(req({ tournamentId: "next", hostCode: HOST }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getTournament).not.toHaveBeenCalled();
  });

  // H1: authHost ran BEFORE the try, so a transient DB error there escaped the
  // handler and Cloudflare served an HTML 500/1102 instead of our JSON.
  it("returns a structured 503 (never throws) when the auth lookup fails", async () => {
    getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
