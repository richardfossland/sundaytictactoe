import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/lib/types";

const getTournamentByPin = vi.fn();
const addPlayer = vi.fn();
const broadcast = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournamentByPin: (...a: unknown[]) => getTournamentByPin(...a),
  addPlayer: (...a: unknown[]) => addPlayer(...a),
}));
vi.mock("@/lib/server/broadcast", () => ({
  broadcast: (...a: unknown[]) => broadcast(...a),
}));

import { POST } from "@/app/api/join/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";

const tournament = (over: Partial<Tournament> = {}): Tournament =>
  ({
    id: T_ID,
    join_pin: "123456",
    host_code: "HOST-01",
    host_user_id: null,
    title: null,
    status: "lobby",
    config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 0,
    created_at: "",
    ...over,
  }) as Tournament;

const player = (): Player => ({
  id: "33333333-3333-4333-8333-333333333333",
  tournament_id: T_ID,
  display_name: "Ada",
  resume_code: "KOLE-7F",
  score: 0,
  tiebreak: 0,
  status: "active",
  seed: null,
  team: null,
  joined_at: "",
});

const req = (body: unknown) =>
  new Request("http://x/api/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { pin: "123456", displayName: "Ada" };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getTournamentByPin.mockResolvedValue(tournament());
  addPlayer.mockResolvedValue(player());
  broadcast.mockResolvedValue(undefined);
});

describe("POST /api/join", () => {
  it("joins and returns the bearer identity in the BODY", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tournamentId: T_ID,
      playerId: "33333333-3333-4333-8333-333333333333",
      resumeCode: "KOLE-7F",
      displayName: "Ada",
      team: null,
    });
  });

  it("400s a malformed pin without touching the database", async () => {
    for (const pin of ["abc", "12345", "1234567", "", "12 34 56"]) {
      const res = await POST(req({ ...good, pin }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_pin");
    }
    expect(getTournamentByPin).not.toHaveBeenCalled();
  });

  it("400 missing_name without a display name", async () => {
    const res = await POST(req({ pin: "123456", displayName: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_name");
  });

  it("404 on an unknown pin", async () => {
    getTournamentByPin.mockResolvedValue(null);
    const res = await POST(req(good));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("invalid_pin");
  });

  it("409 once the tournament has started", async () => {
    getTournamentByPin.mockResolvedValue(tournament({ status: "league" }));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_started");
  });

  // H1: getTournamentByPin ran BEFORE the try, so a transient DB error there
  // escaped as a platform 500/1102 HTML page — on the very first thing a whole
  // class does at once.
  it("returns a structured 503 (never throws) when the pin lookup fails", async () => {
    getTournamentByPin.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("still maps a failing insert to the route's own 500 JSON", async () => {
    addPlayer.mockRejectedValue(new Error("boom"));
    const res = await POST(req(good));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("join_failed");
  });
});
