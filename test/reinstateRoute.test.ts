import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/lib/types";

// Real auth, mocked store.
const getTournament = vi.fn();
const getPlayer = vi.fn();
const setPlayerStatus = vi.fn();
const broadcast = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  getPlayer: (...a: unknown[]) => getPlayer(...a),
  setPlayerStatus: (...a: unknown[]) => setPlayerStatus(...a),
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

import { POST } from "@/app/api/game/reinstate/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";
const P_ID = "33333333-3333-4333-8333-333333333333";
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
    current_round: 2,
    created_at: "",
    ...over,
  }) as Tournament;

const player = (over: Partial<Player> = {}): Player => ({
  id: P_ID,
  tournament_id: T_ID,
  display_name: "Ada",
  resume_code: "AAAA-AA",
  score: 0,
  tiebreak: 0,
  status: "left",
  seed: null,
  joined_at: "",
  ...over,
});

const req = (body: unknown) =>
  new Request("http://x/api/game/reinstate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { tournamentId: T_ID, hostCode: HOST, playerId: P_ID };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  deferred.length = 0;
  getTournament.mockResolvedValue(tournament());
  getPlayer.mockResolvedValue(player());
  setPlayerStatus.mockResolvedValue(undefined);
  broadcast.mockResolvedValue(undefined);
});

describe("POST /api/game/reinstate", () => {
  it("sets the player active and tells the roster after responding (M1)", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(setPlayerStatus).toHaveBeenCalledWith(P_ID, "active");
    expect(broadcast).not.toHaveBeenCalled();
    await drainDeferred();
    expect(broadcast).toHaveBeenCalledWith(`ttt:lobby:${T_ID}`, "tournament", {
      playerReinstated: P_ID,
    });
  });

  // H2: getPlayer hands the id straight to Postgres. Before the guard this was
  // a 22P02 → 503 "server_error"; it is a bad body field, so it is a 400.
  it("400s JSON on a malformed playerId, without ever querying Postgres", async () => {
    const res = await POST(req({ ...good, playerId: "p1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(getPlayer).not.toHaveBeenCalled();
  });

  it("400 without the required ids", async () => {
    expect((await POST(req({ hostCode: HOST }))).status).toBe(400);
  });

  it("401s JSON on a malformed tournamentId, without ever querying Postgres", async () => {
    const res = await POST(req({ ...good, tournamentId: "t1" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("401 on a wrong host code", async () => {
    expect((await POST(req({ ...good, hostCode: "ZZZZ-99" }))).status).toBe(401);
    expect(setPlayerStatus).not.toHaveBeenCalled();
  });

  it("404 when the target belongs to ANOTHER tournament", async () => {
    getPlayer.mockResolvedValue(player({ tournament_id: "other" }));
    const res = await POST(req(good));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_player");
    expect(setPlayerStatus).not.toHaveBeenCalled();
  });

  it("409 finished — a finished tournament has no next round to reinstate into", async () => {
    getTournament.mockResolvedValue(tournament({ status: "finished" }));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("finished");
    expect(getPlayer).not.toHaveBeenCalled();
    expect(setPlayerStatus).not.toHaveBeenCalled();
  });

  it("409 not_left — nothing to undo for a player who was never marked away", async () => {
    getPlayer.mockResolvedValue(player({ status: "active" }));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_left");
    expect(setPlayerStatus).not.toHaveBeenCalled();
  });

  it("works from the lobby too (a ghost-kick left them 'left' before it ever started)", async () => {
    getTournament.mockResolvedValue(tournament({ status: "lobby" }));
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(setPlayerStatus).toHaveBeenCalledWith(P_ID, "active");
  });

  it("returns a structured 503 (never throws) when the tournament lookup fails", async () => {
    getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  // M3: setPlayerStatus swallowed its error, so the teacher was told the
  // player was back in when the write never happened.
  it("returns 503 — not success — when the 'active' write fails", async () => {
    setPlayerStatus.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
