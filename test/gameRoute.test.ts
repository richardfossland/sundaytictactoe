import { beforeEach, describe, expect, it, vi } from "vitest";

// R1b regression: GET /api/game/<probe> made the store throw Postgres 22P02
// for a non-UUID id, which the route's catch-all mapped to a false 503.
// Verify the isUuid guard rejects it BEFORE any store call, and that the
// existing (valid-id, not-found) behavior is unchanged.
const getGame = vi.fn();
const getPlayer = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getGame: (...a: unknown[]) => getGame(...a),
  getPlayer: (...a: unknown[]) => getPlayer(...a),
}));

import { GET } from "@/app/api/game/[id]/route";

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const START = ".........";

function req(id: string): Request {
  return new Request(`http://x/api/game/${id}`);
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/game/[id]", () => {
  it("404s a malformed (non-UUID) id without ever calling the store", async () => {
    const res = await GET(req("probe"), params("probe"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_game");
    expect(getGame).not.toHaveBeenCalled();
  });

  it("404s a valid-shaped id that doesn't exist (unchanged behavior)", async () => {
    getGame.mockResolvedValue(null);
    const res = await GET(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_game");
    expect(getGame).toHaveBeenCalledWith(VALID_ID);
  });

  it("200s the game detail for a real game", async () => {
    getGame.mockResolvedValue({
      id: VALID_ID,
      tournament_id: "t",
      round_id: "r",
      white_player_id: "white",
      black_player_id: "black",
      fen: START,
      pgn: "",
      status: "live",
      result_source: null,
      turn: "w",
      draw_offered_by: null,
      updated_at: "",
    });
    getPlayer.mockImplementation(async (id: string) => ({
      id,
      tournament_id: "t",
      display_name: id,
      resume_code: "AAAA-AA",
      score: 0,
      tiebreak: 0,
      status: "active",
      seed: null,
      joined_at: "",
    }));
    const res = await GET(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(VALID_ID);
  });
});
