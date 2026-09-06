import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player } from "@/lib/types";

// Real auth (exercises the uuid guard inside authPlayer), mocked store.
const getGame = vi.fn();
const getPlayer = vi.fn();
const upsertPrediction = vi.fn();
const listPredictionsForPlayer = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getGame: (...a: unknown[]) => getGame(...a),
  getPlayer: (...a: unknown[]) => getPlayer(...a),
  upsertPrediction: (...a: unknown[]) => upsertPrediction(...a),
  listPredictionsForPlayer: (...a: unknown[]) => listPredictionsForPlayer(...a),
}));

import { POST } from "@/app/api/predict/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";
const G_ID = "11111111-1111-4111-8111-111111111111";
const WHITE = "33333333-3333-4333-8333-333333333333";
const BLACK = "44444444-4444-4444-8444-444444444444";
// The tipper is a THIRD player — waiting or eliminated, not in this game.
const TIPPER = "55555555-5555-4555-8555-555555555555";

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

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  tournament_id: T_ID,
  display_name: id,
  resume_code: "AAAA-AA",
  score: 0,
  tiebreak: 0,
  status: "active",
  seed: null,
  joined_at: "",
  ...over,
});

const req = (body: unknown) =>
  new Request("http://x/api/predict", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = {
  playerId: TIPPER,
  resumeCode: "AAAA-AA",
  gameId: G_ID,
  predicted: "white",
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getGame.mockResolvedValue(game());
  getPlayer.mockImplementation(async (id: string) => player(id));
  upsertPrediction.mockResolvedValue(true);
  listPredictionsForPlayer.mockResolvedValue({ [G_ID]: "draw" });
});

describe("POST /api/predict", () => {
  it("stores the tip for a game the player is NOT in", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ predicted: "white" });
    expect(upsertPrediction).toHaveBeenCalledWith(T_ID, G_ID, TIPPER, "white");
  });

  it("action:list returns the player's own tips without needing a gameId", async () => {
    const res = await POST(
      req({ playerId: TIPPER, resumeCode: "AAAA-AA", action: "list" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ predictions: { [G_ID]: "draw" } });
  });

  // H2: a malformed gameId is a bad body field, not an outage (22P02 → 503).
  it("400s JSON on a malformed gameId, without ever querying the game", async () => {
    const res = await POST(req({ ...good, gameId: "g1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(getGame).not.toHaveBeenCalled();
  });

  // H2: the guard lives inside authPlayer — a malformed playerId is a clean 401.
  it("401s JSON on a malformed playerId, without ever querying Postgres", async () => {
    const res = await POST(req({ ...good, playerId: "me" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getPlayer).not.toHaveBeenCalled();
  });

  it("400 bad_prediction on a result that is not white/black/draw", async () => {
    const res = await POST(req({ ...good, predicted: "sideways" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_prediction");
    expect(upsertPrediction).not.toHaveBeenCalled();
  });

  it("403 own_game — you cannot tip a game you are playing in", async () => {
    const res = await POST(req({ ...good, playerId: WHITE }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("own_game");
  });

  it("403 forbidden for a game in ANOTHER tournament", async () => {
    getGame.mockResolvedValue(game({ tournament_id: "other" }));
    expect((await POST(req(good))).status).toBe(403);
  });

  it("409 not_live once the game is decided", async () => {
    getGame.mockResolvedValue(game({ status: "white_win" }));
    expect((await POST(req(good))).status).toBe(409);
  });

  it("returns a structured 503 (never throws) when the game lookup fails", async () => {
    getGame.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
