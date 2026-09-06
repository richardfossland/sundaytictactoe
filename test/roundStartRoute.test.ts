import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// The REAL auth module runs here (only the store is mocked), so these tests
// exercise the H2 uuid guard for real: a malformed tournamentId must be turned
// away by authHost BEFORE getTournament is called — otherwise PostgREST throws
// 22P02 and the route answers 503 for a plain client error.
const getTournament = vi.fn();
const listPlayers = vi.fn();
const isUniqueViolation = vi.fn();
const startLeague = vi.fn();
const startCup = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  getPlayer: vi.fn(), // imported by lib/server/auth
  listPlayers: (...a: unknown[]) => listPlayers(...a),
  isUniqueViolation: (...a: unknown[]) => isUniqueViolation(...a),
}));
vi.mock("@/lib/server/league", () => ({
  startLeague: (...a: unknown[]) => startLeague(...a),
}));
vi.mock("@/lib/server/playoff", () => ({
  startCup: (...a: unknown[]) => startCup(...a),
}));

import { POST } from "@/app/api/round/start/route";
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
    status: "lobby",
    config: { format: "league", leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 0,
    created_at: "",
    ...over,
  }) as Tournament;

const req = (body: unknown) =>
  new Request("http://x/api/round/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { tournamentId: T_ID, hostCode: HOST };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getTournament.mockResolvedValue(tournament());
  listPlayers.mockResolvedValue([
    { id: "a", status: "active" },
    { id: "b", status: "active" },
  ]);
  isUniqueViolation.mockReturnValue(false);
});

describe("POST /api/round/start", () => {
  it("starts a league round and returns the new status", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "league" });
    expect(startLeague).toHaveBeenCalledOnce();
  });

  it("starts the cup bracket when format = cup", async () => {
    getTournament.mockResolvedValue(
      tournament({ config: { ...tournament().config, format: "cup" } }),
    );
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "playoff" });
    expect(startCup).toHaveBeenCalledOnce();
  });

  it("401s JSON on a malformed tournamentId, without ever querying Postgres", async () => {
    const res = await POST(req({ tournamentId: "probe", hostCode: HOST }));
    expect(res.status).toBe(401); // NOT 503, and NOT a platform HTML page
    expect((await res.json()).error).toBe("unauthorized");
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("401s on a wrong host code", async () => {
    const res = await POST(req({ tournamentId: T_ID, hostCode: "ZZZZ-99" }));
    expect(res.status).toBe(401);
  });

  it("409 already_started once the tournament has left the lobby", async () => {
    getTournament.mockResolvedValue(tournament({ status: "league" }));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_started");
  });

  it("409 not_enough_players with fewer than two active players", async () => {
    listPlayers.mockResolvedValue([{ id: "a", status: "active" }]);
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_enough_players");
  });

  it("409 already_started when a double-fire hits the rounds unique constraint", async () => {
    startLeague.mockRejectedValue({ code: "23505" });
    isUniqueViolation.mockReturnValue(true);
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_started");
  });

  // H1: authHost + listPlayers used to sit OUTSIDE the try, so a transient DB
  // error there escaped the handler and Cloudflare served a 500/1102 HTML page.
  it("returns a structured 503 (never throws) when the auth lookup fails", async () => {
    getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("returns a structured 503 when listPlayers fails", async () => {
    listPlayers.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
