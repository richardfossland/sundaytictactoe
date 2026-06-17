import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player } from "@/lib/types";

// Mock the DB + side-effect boundary; keep the REAL ttt validation + route
// logic. This verifies the §4 wiring: auth, turn-ownership, illegal rejection,
// atomic-commit args, conflict mapping, and end-of-game side-effects.
const getGame = vi.fn();
const applyMoveRpc = vi.fn();
const authPlayer = vi.fn();
const afterGameResolved = vi.fn();
const broadcastPosition = vi.fn();
const getTournament = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getGame: (...a: unknown[]) => getGame(...a),
  applyMoveRpc: (...a: unknown[]) => applyMoveRpc(...a),
  getTournament: (...a: unknown[]) => getTournament(...a),
  resolveGameRpc: vi.fn(),
  setDrawOffer: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  authPlayer: (...a: unknown[]) => authPlayer(...a),
}));
vi.mock("@/lib/server/gameEvents", () => ({
  afterGameResolved: (...a: unknown[]) => afterGameResolved(...a),
  broadcastPosition: (...a: unknown[]) => broadcastPosition(...a),
  broadcastSpectate: vi.fn(),
}));

import { POST } from "@/app/api/move/route";

const START = ".........";

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
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
    ...over,
  };
}
function makePlayer(id: string): Player {
  return {
    id,
    tournament_id: "t",
    display_name: id,
    resume_code: "AAAA-AA",
    score: 0,
    tiebreak: 0,
    status: "active",
    seed: null,
    joined_at: "",
  };
}
function req(body: unknown): Request {
  return new Request("http://x/api/move", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `1.2.3.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  applyMoveRpc.mockResolvedValue({ ok: true, ply: 1, status: "live" });
  broadcastPosition.mockResolvedValue(undefined);
  afterGameResolved.mockResolvedValue(undefined);
  getTournament.mockResolvedValue({ id: "t", config: {} });
});

describe("POST /api/move", () => {
  it("401 when the resume code does not authenticate", async () => {
    authPlayer.mockResolvedValue(null);
    const res = await POST(req({ gameId: "g1", cell: 4, playerId: "white", resumeCode: "x" }));
    expect(res.status).toBe(401);
  });

  it("403 when it is not the mover's turn", async () => {
    authPlayer.mockResolvedValue(makePlayer("black"));
    getGame.mockResolvedValue(makeGame({ turn: "w" })); // white to move, black asks
    const res = await POST(req({ gameId: "g1", cell: 4, playerId: "black", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_your_turn");
  });

  it("400 rejects an illegal (occupied) cell server-side", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    // 2 marks → white to move; cell 0 is occupied → illegal.
    getGame.mockResolvedValue(makeGame({ fen: "xo......." }));
    const res = await POST(req({ gameId: "g1", cell: 0, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(400);
    expect(applyMoveRpc).not.toHaveBeenCalled();
  });

  it("returns a structured 503 (never throws) when an internal call fails", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ gameId: "g1", cell: 4, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("applies a legal move atomically and broadcasts", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame());
    const res = await POST(req({ gameId: "g1", cell: 4, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.turn).toBe("b");
    expect(json.san).toBe("4");
    expect(applyMoveRpc).toHaveBeenCalledOnce();
    expect(applyMoveRpc.mock.calls[0][0]).toMatchObject({
      gameId: "g1",
      expectedFen: START,
      byPlayerId: "white",
      newTurn: "b",
      newStatus: "live",
    });
    expect(broadcastPosition).toHaveBeenCalledOnce();
    expect(afterGameResolved).not.toHaveBeenCalled();
  });

  it("maps a stale concurrency conflict to 409", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame());
    applyMoveRpc.mockResolvedValue({ ok: false, conflict: "stale" });
    const res = await POST(req({ gameId: "g1", cell: 4, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale");
  });

  it("detects three-in-a-row and runs resolution side-effects", async () => {
    // x at 0,1; white to move (4 marks) completes the top row at cell 2 → win.
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame({ fen: "xx.oo...." }));
    applyMoveRpc.mockResolvedValue({ ok: true, ply: 5, status: "white_win" });
    const res = await POST(req({ gameId: "g1", cell: 2, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("white_win");
    expect(applyMoveRpc.mock.calls[0][0]).toMatchObject({ newStatus: "white_win" });
    expect(afterGameResolved).toHaveBeenCalledOnce();
    expect(afterGameResolved.mock.calls[0].slice(1)).toEqual(["white_win", "play"]);
  });

  it("404 when the game does not exist", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(null);
    const res = await POST(req({ gameId: "g1", cell: 4, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(404);
  });

  it("honours the tournament variant for the win scan (4×4)", async () => {
    // On a 4×4 board, 3-in-a-row is NOT a win — only 4 is. Top row x at 0,1,2;
    // white to move (6 marks) plays cell 3 → completes 4-in-a-row.
    authPlayer.mockResolvedValue(makePlayer("white"));
    getTournament.mockResolvedValue({ id: "t", config: { variant: "4x4" } });
    getGame.mockResolvedValue(makeGame({ fen: "xxx.ooo........." }));
    const res = await POST(req({ gameId: "g1", cell: 3, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(200);
    expect(applyMoveRpc.mock.calls[0][0]).toMatchObject({ newStatus: "white_win" });
  });
});
