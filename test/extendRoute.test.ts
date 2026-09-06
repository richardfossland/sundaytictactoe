import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// Real auth, mocked store: the malformed-id case below therefore proves the
// guard, not the mock.
const getTournament = vi.fn();
const listRounds = vi.fn();
const extendRoundRpc = vi.fn();
const setRoundStartedAt = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  getPlayer: vi.fn(), // imported by lib/server/auth
  listRounds: (...a: unknown[]) => listRounds(...a),
  extendRoundRpc: (...a: unknown[]) => extendRoundRpc(...a),
  setRoundStartedAt: (...a: unknown[]) => setRoundStartedAt(...a),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));

import { POST } from "@/app/api/round/extend/route";
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

function req(body: unknown = { tournamentId: T_ID, hostCode: HOST }): Request {
  return new Request("http://x/api/round/extend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getTournament.mockResolvedValue(tournament());
  listRounds.mockResolvedValue([
    {
      id: "r1",
      tournament_id: T_ID,
      number: 1,
      phase: "league",
      status: "live",
      started_at: "2026-01-01T10:00:00.000Z",
    },
  ]);
});

describe("POST /api/round/extend", () => {
  it("uses the atomic RPC and leaves started_at alone", async () => {
    extendRoundRpc.mockResolvedValue(120_000);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).extendedMs).toBe(120_000);
    expect(extendRoundRpc).toHaveBeenCalledWith("r1");
    // the whole point: chess-clock t0 (started_at) must NOT move
    expect(setRoundStartedAt).not.toHaveBeenCalled();
  });

  it("falls back to shifting started_at when 0007 is not migrated", async () => {
    extendRoundRpc.mockRejectedValue(new Error("function not found"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).extendedMs).toBeNull();
    expect(setRoundStartedAt).toHaveBeenCalledWith(
      "r1",
      "2026-01-01T10:01:00.000Z",
    );
  });

  it("409 when no live round exists", async () => {
    listRounds.mockResolvedValue([]);
    const res = await POST(req());
    expect(res.status).toBe(409);
  });

  it("401s JSON on a malformed tournamentId, without ever querying Postgres", async () => {
    const res = await POST(req({ tournamentId: "abc", hostCode: HOST }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getTournament).not.toHaveBeenCalled();
  });

  // H1: this handler had NO try/catch at all except around the RPC — a
  // transient failure in auth, listRounds or the broadcast escaped as a
  // platform 500/1102 HTML page.
  it("returns a structured 503 (never throws) when the auth lookup fails", async () => {
    getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("returns a structured 503 when listRounds fails", async () => {
    listRounds.mockRejectedValue(new Error("db down"));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("returns a structured 503 when the started_at fallback write fails", async () => {
    // M3: setRoundStartedAt now THROWS on a failed write instead of reporting
    // an extension that never happened.
    extendRoundRpc.mockRejectedValue(new Error("not migrated"));
    setRoundStartedAt.mockRejectedValue(new Error("db down"));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
