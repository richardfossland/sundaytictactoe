import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// POST /api/tournament/[id]/config — the two escape hatches this route covers:
//  - leagueRounds: finish the league early (lower it, never raise it, never
//    below the round already in progress/just finished).
//  - notes: the teacher's private reminder, allowed in any status, never
//    broadcast (it never reaches students — see lib/dto.ts's
//    toBoardTournament, tested separately in test/tournamentRoute.test.ts).
//
// Real authHost, mocked store — so the uuid/host-code guards are exercised
// for real rather than through an authHost stub (matches
// test/reinstateRoute.test.ts's approach).
const getTournament = vi.fn();
const updateTournamentConfig = vi.fn();
const broadcast = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  updateTournamentConfig: (...a: unknown[]) => updateTournamentConfig(...a),
}));
vi.mock("@/lib/server/broadcast", () => ({
  broadcast: (...a: unknown[]) => broadcast(...a),
}));

// M1: the roster nudge is handed to defer() and runs after the response.
const { deferred } = vi.hoisted(() => ({
  deferred: [] as Array<() => Promise<void>>,
}));
vi.mock("@/lib/server/defer", () => ({
  defer: (task: () => Promise<void>) => {
    deferred.push(task);
  },
}));
async function drainDeferred(): Promise<void> {
  const queue = deferred.splice(0);
  for (const task of queue) await task();
}

import { POST } from "@/app/api/tournament/[id]/config/route";
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
    current_round: 3,
    created_at: "",
    ...over,
  }) as Tournament;

function req(body: unknown, id: string = T_ID): Request {
  return new Request(`http://x/api/tournament/${id}/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function params(id: string = T_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  deferred.length = 0;
  getTournament.mockResolvedValue(tournament());
  broadcast.mockResolvedValue(undefined);
});

const good = { hostCode: HOST, leagueRounds: 3 };

describe("POST /api/tournament/[id]/config — auth + shape guards", () => {
  it("404s a malformed (non-UUID) id without ever calling authHost", async () => {
    const res = await POST(req(good, "probe"), params("probe"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("401s on a wrong host code", async () => {
    const res = await POST(req({ ...good, hostCode: "WRONG" }), params());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(updateTournamentConfig).not.toHaveBeenCalled();
  });

  it("neither leagueRounds nor notes given: reads the current config back without changing anything", async () => {
    getTournament.mockResolvedValue(
      tournament({ config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null, notes: "7A" } }),
    );
    const res = await POST(req({ hostCode: HOST }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leagueRounds: 5, notes: "7A" });
    expect(updateTournamentConfig).not.toHaveBeenCalled();
  });

  it("returns a structured 503 (never throws) when the tournament lookup fails", async () => {
    getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good), params());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});

describe("POST /api/tournament/[id]/config — leagueRounds (finish early)", () => {
  it("409s when the tournament isn't in the league phase", async () => {
    getTournament.mockResolvedValue(tournament({ status: "lobby" }));
    const res = await POST(req(good), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_league");
    expect(updateTournamentConfig).not.toHaveBeenCalled();
  });

  it("400s a non-integer leagueRounds", async () => {
    const res = await POST(req({ hostCode: HOST, leagueRounds: 2.5 }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(updateTournamentConfig).not.toHaveBeenCalled();
  });

  it("400s RAISING the round count above what's configured", async () => {
    // config.leagueRounds is 5, current_round is 3 — asking for 6 is a raise.
    const res = await POST(req({ hostCode: HOST, leagueRounds: 6 }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_lower");
    expect(updateTournamentConfig).not.toHaveBeenCalled();
  });

  it("400s a no-op (same value as the current configured rounds)", async () => {
    const res = await POST(req({ hostCode: HOST, leagueRounds: 5 }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_lower");
  });

  it("400s BELOW the round currently in progress/just finished", async () => {
    // current_round is 3 — asking for 2 would un-happen an already-played round.
    const res = await POST(req({ hostCode: HOST, leagueRounds: 2 }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("too_low");
    expect(updateTournamentConfig).not.toHaveBeenCalled();
  });

  it("happy path: lowers leagueRounds to the current round, persists it, and defers a roster hint", async () => {
    updateTournamentConfig.mockResolvedValue(
      tournament({ config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null } }),
    );
    const res = await POST(req(good), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leagueRounds: 3, notes: null });
    expect(updateTournamentConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: T_ID }),
      { leagueRounds: 3 },
    );
    expect(broadcast).not.toHaveBeenCalled();
    await drainDeferred();
    expect(broadcast).toHaveBeenCalledWith(`ttt:lobby:${T_ID}`, "tournament", {
      leagueRoundsChanged: T_ID,
    });
  });

  it("allows lowering all the way down to exactly the current round", async () => {
    updateTournamentConfig.mockResolvedValue(tournament());
    const res = await POST(req({ hostCode: HOST, leagueRounds: 3 }), params());
    expect(res.status).toBe(200);
    expect(updateTournamentConfig).toHaveBeenCalledWith(expect.anything(), {
      leagueRounds: 3,
    });
  });
});

describe("POST /api/tournament/[id]/config — notes (teacher's private reminder)", () => {
  it("is allowed outside the league phase (a private note, not a tournament-state change)", async () => {
    getTournament.mockResolvedValue(tournament({ status: "lobby" }));
    updateTournamentConfig.mockResolvedValue(
      tournament({ status: "lobby", config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null, notes: "7A" } }),
    );
    const res = await POST(req({ hostCode: HOST, notes: "7A" }), params());
    expect(res.status).toBe(200);
    expect(updateTournamentConfig).toHaveBeenCalledWith(expect.anything(), { notes: "7A" });
  });

  it("trims whitespace and caps notes at 280 characters", async () => {
    const long = "x".repeat(400);
    updateTournamentConfig.mockResolvedValue(
      tournament({ config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null, notes: "x".repeat(280) } }),
    );
    await POST(req({ hostCode: HOST, notes: `  ${long}  ` }), params());
    expect(updateTournamentConfig).toHaveBeenCalledWith(expect.anything(), {
      notes: "x".repeat(280),
    });
  });

  it("400s a non-string notes value", async () => {
    const res = await POST(req({ hostCode: HOST, notes: 123 }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(updateTournamentConfig).not.toHaveBeenCalled();
  });

  it("never broadcasts for a notes-only update — it never reaches students", async () => {
    updateTournamentConfig.mockResolvedValue(
      tournament({ config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null, notes: "hi" } }),
    );
    await POST(req({ hostCode: HOST, notes: "hi" }), params());
    await drainDeferred();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("both fields at once: validates+applies each independently in one patch", async () => {
    updateTournamentConfig.mockResolvedValue(
      tournament({ config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null, notes: "hi" } }),
    );
    const res = await POST(req({ hostCode: HOST, leagueRounds: 3, notes: "hi" }), params());
    expect(res.status).toBe(200);
    expect(updateTournamentConfig).toHaveBeenCalledWith(expect.anything(), {
      leagueRounds: 3,
      notes: "hi",
    });
  });
});
