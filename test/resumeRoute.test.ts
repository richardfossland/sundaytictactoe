import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament, TournamentStatus } from "@/lib/types";

// R1b regression: POST /api/resume with a non-UUID tournamentId made
// getTournament throw Postgres 22P02, which the route's catch-all mapped to a
// false 503 — a fatal bug here specifically, because the client's resume
// catch WIPES the stored session on anything it can't classify as transient.
const { store } = vi.hoisted(() => ({
  store: {
    getPlayerByResume: vi.fn(),
    getTournament: vi.fn(),
    getTournamentByPin: vi.fn(),
  },
}));
const maybeAutoFinishStale = vi.fn();

vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/lifecycle", () => ({
  maybeAutoFinishStale: (...a: unknown[]) => maybeAutoFinishStale(...a),
}));

import { POST } from "@/app/api/resume/route";
import { __resetRateLimiter } from "@/lib/server/http";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const player = (over: Partial<Player> = {}): Player => ({
  id: "p1",
  tournament_id: VALID_ID,
  display_name: "Ada",
  resume_code: "AAAA-AA",
  score: 0,
  tiebreak: 0,
  status: "active",
  seed: null,
  joined_at: "",
  ...over,
});

const tournament = (status: TournamentStatus): Tournament =>
  ({
    id: VALID_ID,
    join_pin: "123456",
    host_code: "HOST-01",
    host_user_id: null,
    title: null,
    status,
    config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 0,
    created_at: "",
  }) as Tournament;

function req(body: unknown): Request {
  return new Request("http://x/api/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  maybeAutoFinishStale.mockImplementation(async (t: Tournament) => t);
});

describe("POST /api/resume", () => {
  // ---- R1b: malformed tournamentId guard ----
  it("400s a malformed (non-UUID) tournamentId without ever calling getTournament", async () => {
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: "probe" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(store.getTournament).not.toHaveBeenCalled();
  });

  it("404s a valid-shaped tournamentId that doesn't exist (unchanged behavior)", async () => {
    store.getTournament.mockResolvedValue(null);
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: VALID_ID }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(store.getTournament).toHaveBeenCalledWith(VALID_ID);
  });

  it("resumes a real session by tournamentId", async () => {
    store.getTournament.mockResolvedValue(tournament("league"));
    store.getPlayerByResume.mockResolvedValue(player());
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: VALID_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      tournamentId: VALID_ID,
      playerId: "p1",
      displayName: "Ada",
      tournamentStatus: "league",
      playerStatus: "active",
    });
  });

  it("still resumes by pin when tournamentId is omitted", async () => {
    store.getTournamentByPin.mockResolvedValue(tournament("lobby"));
    store.getPlayerByResume.mockResolvedValue(player());
    const res = await POST(req({ resumeCode: "AAAA-AA", pin: "402815" }));
    expect(res.status).toBe(200);
    expect(store.getTournamentByPin).toHaveBeenCalledWith("402815");
  });

  // ---- R4: playerStatus reporting + rejoin trigger ----
  it("reports the player's own status so a removed student is TOLD", async () => {
    // Without playerStatus the waiting room went on saying "venter …" forever
    // to a student the lobby sweep had already kicked.
    store.getTournament.mockResolvedValue(tournament("lobby"));
    store.getPlayerByResume.mockResolvedValue(player({ status: "left" }));
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: VALID_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tournamentId: VALID_ID,
      playerId: "p1",
      displayName: "Ada",
      tournamentStatus: "lobby",
      playerStatus: "left",
    });
  });

  it("reports 'active' for a normal resume", async () => {
    store.getTournament.mockResolvedValue(tournament("league"));
    store.getPlayerByResume.mockResolvedValue(player());
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: VALID_ID }));
    expect((await res.json()).playerStatus).toBe("active");
  });

  it("400s on a too-short code without touching the store", async () => {
    const res = await POST(req({ resumeCode: "AB", tournamentId: VALID_ID }));
    expect(res.status).toBe(400);
    expect(store.getTournament).not.toHaveBeenCalled();
  });

  it("returns a structured 503 (never throws) when an internal call fails", async () => {
    store.getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: VALID_ID }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
