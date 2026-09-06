import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Tournament } from "@/lib/types";

// Real auth, mocked store.
const getGame = vi.fn();
const getTournament = vi.fn();
const resolveGameRpc = vi.fn();
const setPlayerStatus = vi.fn();
const afterGameResolved = vi.fn();
const broadcast = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getGame: (...a: unknown[]) => getGame(...a),
  getTournament: (...a: unknown[]) => getTournament(...a),
  getPlayer: vi.fn(), // imported by lib/server/auth
  resolveGameRpc: (...a: unknown[]) => resolveGameRpc(...a),
  setPlayerStatus: (...a: unknown[]) => setPlayerStatus(...a),
}));
vi.mock("@/lib/server/gameEvents", () => ({
  afterGameResolved: (...a: unknown[]) => afterGameResolved(...a),
}));
vi.mock("@/lib/server/broadcast", () => ({
  broadcast: (...a: unknown[]) => broadcast(...a),
}));

import { POST } from "@/app/api/game/absent/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";
const G_ID = "11111111-1111-4111-8111-111111111111";
const WHITE = "33333333-3333-4333-8333-333333333333";
const BLACK = "44444444-4444-4444-8444-444444444444";
const HOST = "HOST-01";

const tournament = (): Tournament =>
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
  }) as Tournament;

const game = (over: Partial<Game> = {}): Game => ({
  id: G_ID,
  tournament_id: T_ID,
  round_id: "r",
  white_player_id: WHITE,
  black_player_id: BLACK,
  fen: "",
  pgn: "",
  status: "live",
  result_source: null,
  turn: "w",
  draw_offered_by: null,
  updated_at: "",
  ...over,
});

const req = (body: unknown) =>
  new Request("http://x/api/game/absent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { gameId: G_ID, hostCode: HOST, absentPlayerId: WHITE };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getGame.mockResolvedValue(game());
  getTournament.mockResolvedValue(tournament());
  resolveGameRpc.mockResolvedValue({ ok: true });
  setPlayerStatus.mockResolvedValue(undefined);
  afterGameResolved.mockResolvedValue(undefined);
  broadcast.mockResolvedValue(undefined);
});

describe("POST /api/game/absent", () => {
  it("gives the present opponent a walkover WIN (not a draw)", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "black_win", scope: "round" });
    expect(resolveGameRpc).toHaveBeenCalledWith(G_ID, "black_win", "walkover", true);
    expect(setPlayerStatus).not.toHaveBeenCalled(); // scope 'round' keeps them
  });

  it("scope 'tournament' also marks the player as left", async () => {
    const res = await POST(req({ ...good, scope: "tournament" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "black_win", scope: "tournament" });
    expect(setPlayerStatus).toHaveBeenCalledWith(WHITE, "left");
    expect(broadcast).toHaveBeenCalledWith(`lobby:${T_ID}`, "tournament", {
      playerLeft: WHITE,
    });
  });

  it("400s JSON on a malformed gameId, without ever querying Postgres", async () => {
    const res = await POST(req({ ...good, gameId: "g1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(getGame).not.toHaveBeenCalled();
  });

  it("400 without the required ids", async () => {
    expect((await POST(req({ hostCode: HOST }))).status).toBe(400);
  });

  it("401 on a wrong host code", async () => {
    expect((await POST(req({ ...good, hostCode: "ZZZZ-99" }))).status).toBe(401);
  });

  it("400 not_in_game when the named player isn't on this board", async () => {
    const res = await POST(req({ ...good, absentPlayerId: BLACK.replace("4444", "5555") }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_in_game");
  });

  it("400 rather than resolving a bye", async () => {
    getGame.mockResolvedValue(game({ black_player_id: null }));
    const res = await POST(req(good));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bye_has_no_opponent");
  });

  it("returns a structured 503 (never throws) when the game lookup fails", async () => {
    getGame.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  // M3: setPlayerStatus swallowed its error, so the teacher was told the player
  // had left the tournament when they had not.
  it("returns 503 — not success — when the 'left' write fails", async () => {
    setPlayerStatus.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ ...good, scope: "tournament" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
