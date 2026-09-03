import { beforeEach, describe, expect, it, vi } from "vitest";

// R1b regression: GET /api/tournament/probe (bot scans, stale links) made the
// store throw Postgres 22P02 for a non-UUID id, which the route's catch-all
// mapped to a false 503. Verify the isUuid guard rejects it BEFORE any store
// call, and that the existing (valid-id, not-found) behavior is unchanged.
const getTournament = vi.fn();
const listPlayers = vi.fn();
const listGames = vi.fn();
const listRounds = vi.fn();
const predictionPoints = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  listPlayers: (...a: unknown[]) => listPlayers(...a),
  listGames: (...a: unknown[]) => listGames(...a),
  listRounds: (...a: unknown[]) => listRounds(...a),
  predictionPoints: (...a: unknown[]) => predictionPoints(...a),
}));

import { GET } from "@/app/api/tournament/[id]/route";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

function req(id: string): Request {
  return new Request(`http://x/api/tournament/${id}`);
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  listPlayers.mockResolvedValue([]);
  listGames.mockResolvedValue([]);
  listRounds.mockResolvedValue([]);
  predictionPoints.mockResolvedValue([]);
});

describe("GET /api/tournament/[id]", () => {
  it("404s a malformed (non-UUID) id without ever calling the store", async () => {
    const res = await GET(req("probe"), params("probe"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("404s a valid-shaped id that doesn't exist (unchanged behavior)", async () => {
    getTournament.mockResolvedValue(null);
    const res = await GET(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(getTournament).toHaveBeenCalledWith(VALID_ID);
  });

  it("200s the board state for a real tournament", async () => {
    getTournament.mockResolvedValue({
      id: VALID_ID,
      join_pin: "123456",
      host_code: "AAAA-AA",
      host_user_id: null,
      title: "7A",
      status: "league",
      config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null },
      current_round: 1,
      created_at: "2026-01-01T00:00:00Z",
    });
    const res = await GET(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tournament.id).toBe(VALID_ID);
  });
});
