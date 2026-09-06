import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// Real auth, mocked store — so the uuid guard (H2) and the handler wrapper (H1)
// are both exercised for real.
const getTournament = vi.fn();
const forceResolveRound = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  getPlayer: vi.fn(), // imported by lib/server/auth
}));
vi.mock("@/lib/server/league", () => ({
  forceResolveRound: (...a: unknown[]) => forceResolveRound(...a),
}));

import { POST } from "@/app/api/round/force/route";
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
  new Request("http://x/api/round/force", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { tournamentId: T_ID, hostCode: HOST };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getTournament.mockResolvedValue(tournament());
  forceResolveRound.mockResolvedValue(undefined);
});

describe("POST /api/round/force", () => {
  it("force-resolves the round", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(forceResolveRound).toHaveBeenCalledOnce();
  });

  it("works in a playoff round too", async () => {
    getTournament.mockResolvedValue(tournament({ status: "playoff" }));
    expect((await POST(req(good))).status).toBe(200);
  });

  it("401s JSON on a malformed tournamentId, without ever querying Postgres", async () => {
    const res = await POST(req({ tournamentId: "../../etc", hostCode: HOST }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("409 not_in_progress while still in the lobby", async () => {
    getTournament.mockResolvedValue(tournament({ status: "lobby" }));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_in_progress");
  });

  // H1: authHost ran OUTSIDE the try — a transient DB error there became a
  // platform 500/1102 HTML page instead of our JSON.
  it("returns a structured 503 (never throws) when the auth lookup fails", async () => {
    getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("still maps a failing resolve to the route's own 500 JSON", async () => {
    forceResolveRound.mockRejectedValue(new Error("boom"));
    const res = await POST(req(good));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("force_failed");
  });
});
