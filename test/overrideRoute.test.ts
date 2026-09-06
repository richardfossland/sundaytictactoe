import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Tournament } from "@/lib/types";

// Real auth, mocked store.
const getGame = vi.fn();
const getTournament = vi.fn();
const resolveGameRpc = vi.fn();
const afterGameResolved = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getGame: (...a: unknown[]) => getGame(...a),
  getTournament: (...a: unknown[]) => getTournament(...a),
  getPlayer: vi.fn(), // imported by lib/server/auth
  resolveGameRpc: (...a: unknown[]) => resolveGameRpc(...a),
}));
vi.mock("@/lib/server/gameEvents", () => ({
  afterGameResolved: (...a: unknown[]) => afterGameResolved(...a),
}));

import { POST } from "@/app/api/game/override/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";
const G_ID = "11111111-1111-4111-8111-111111111111";
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
  white_player_id: "white",
  black_player_id: "black",
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
  new Request("http://x/api/game/override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { gameId: G_ID, hostCode: HOST, result: "white_win" };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getGame.mockResolvedValue(game());
  getTournament.mockResolvedValue(tournament());
  resolveGameRpc.mockResolvedValue({ ok: true });
  afterGameResolved.mockResolvedValue(undefined);
});

describe("POST /api/game/override", () => {
  it("sets the result from the board", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "white_win" });
    expect(resolveGameRpc).toHaveBeenCalledWith(G_ID, "white_win", "teacher_override");
  });

  // H2: getGame hands the id straight to Postgres — 22P02 used to surface as a
  // 503 "server_error" for what is a bad body field.
  it("400s JSON on a malformed gameId, without ever querying Postgres", async () => {
    const res = await POST(req({ ...good, gameId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(getGame).not.toHaveBeenCalled();
  });

  it("400 on a result outside the allow-list", async () => {
    const res = await POST(req({ ...good, result: "white_resigns_maybe" }));
    expect(res.status).toBe(400);
    expect(getGame).not.toHaveBeenCalled();
  });

  it("401 on a wrong host code", async () => {
    const res = await POST(req({ ...good, hostCode: "ZZZZ-99" }));
    expect(res.status).toBe(401);
    expect(resolveGameRpc).not.toHaveBeenCalled();
  });

  it("404 when the game does not exist", async () => {
    getGame.mockResolvedValue(null);
    expect((await POST(req(good))).status).toBe(404);
  });

  it("409 rather than mis-scoring a bye", async () => {
    getGame.mockResolvedValue(game({ status: "bye" }));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("cannot_override_bye");
  });

  it("returns a structured 503 (never throws) when the game lookup fails", async () => {
    getGame.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
