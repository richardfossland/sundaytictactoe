import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament, TournamentStatus } from "@/lib/types";

const { store, deferred } = vi.hoisted(() => ({
  store: {
    getTournament: vi.fn(),
    setPlayerStatus: vi.fn(),
  },
  // The roster hint is handed to defer() and runs after the response.
  deferred: [] as Array<() => Promise<void>>,
}));
const authPlayer = vi.fn();
const broadcast = vi.fn();

vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/auth", () => ({
  authPlayer: (...a: unknown[]) => authPlayer(...a),
}));
vi.mock("@/lib/server/broadcast", () => ({
  broadcast: (...a: unknown[]) => broadcast(...a),
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

import { POST } from "@/app/api/lobby/rejoin/route";
import { __resetRateLimiter } from "@/lib/server/http";

const player = (over: Partial<Player> = {}): Player => ({
  id: "p1",
  tournament_id: "t1",
  display_name: "Ada",
  resume_code: "AAAA-AA",
  score: 0,
  tiebreak: 0,
  status: "left",
  seed: null,
  joined_at: "",
  ...over,
});

const tournament = (status: TournamentStatus): Tournament =>
  ({
    id: "t1",
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
  return new Request("http://x/api/lobby/rejoin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const good = { tournamentId: "t1", playerId: "p1", resumeCode: "AAAA-AA" };

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  __resetRateLimiter();
  store.setPlayerStatus.mockResolvedValue(undefined);
  broadcast.mockResolvedValue(undefined);
});

describe("POST /api/lobby/rejoin", () => {
  it("401s on a bad resume code, and changes nothing", async () => {
    authPlayer.mockResolvedValue(null);
    const res = await POST(req({ ...good, resumeCode: "WRONG-1" }));
    expect(res.status).toBe(401);
    expect(store.setPlayerStatus).not.toHaveBeenCalled();
  });

  it("400s without a tournamentId/playerId", async () => {
    const res = await POST(req({ resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(400);
    expect(authPlayer).not.toHaveBeenCalled();
  });

  it("403s when the code belongs to ANOTHER tournament's player", async () => {
    authPlayer.mockResolvedValue(player({ tournament_id: "other" }));
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect(store.setPlayerStatus).not.toHaveBeenCalled();
  });

  it("409 not_lobby once the tournament has started", async () => {
    // Re-adding a player mid-tournament would change pairings — the client
    // shows "Du ble fjernet fra turneringen" instead.
    authPlayer.mockResolvedValue(player());
    store.getTournament.mockResolvedValue(tournament("league"));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_lobby");
    expect(store.setPlayerStatus).not.toHaveBeenCalled();
  });

  it("sets the player active and broadcasts the roster AFTER responding", async () => {
    authPlayer.mockResolvedValue(player());
    store.getTournament.mockResolvedValue(tournament("lobby"));
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(store.setPlayerStatus).toHaveBeenCalledWith("p1", "active");
    expect(broadcast).not.toHaveBeenCalled();
    await drainDeferred();
    expect(broadcast).toHaveBeenCalledWith("lobby:t1", "roster", { joined: "p1" });
  });

  it("returns a structured 503 (never throws) when an internal call fails", async () => {
    authPlayer.mockResolvedValue(player());
    store.getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
