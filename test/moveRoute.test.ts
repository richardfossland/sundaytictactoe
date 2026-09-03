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
const broadcastSpectate = vi.fn();
const getTournament = vi.fn();
// R8: side-effects are handed to defer() and run AFTER the response. Capture
// them instead of running them, so a test can assert the response is already
// complete BEFORE any broadcast/scoring happens, then drain the queue and check
// the deferred work got exactly the arguments it used to get inline.
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
  broadcastSpectate: (...a: unknown[]) => broadcastSpectate(...a),
}));

import { POST } from "@/app/api/move/route";

const START = ".........";
// A valid-shaped id for the request body — the route's isUuid guard (R1b)
// checks this BEFORE the (mocked) getGame is ever called, so it must look
// like a real UUID even though the mocked store keys off makeGame()'s own
// "g1" id for its return value and every downstream assertion.
const GAME_ID = "11111111-1111-4111-8111-111111111111";

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
  deferred.length = 0;
  applyMoveRpc.mockResolvedValue({ ok: true, ply: 1, status: "live" });
  broadcastPosition.mockResolvedValue(undefined);
  broadcastSpectate.mockResolvedValue(undefined);
  afterGameResolved.mockResolvedValue(undefined);
  getTournament.mockResolvedValue({ id: "t", config: {} });
});

describe("POST /api/move", () => {
  // R1b: a malformed gameId (bot probe, stale link) is a bad request, not an
  // outage — it must never reach getGame/Postgres (22P02 → false 503).
  it("400 on a malformed (non-UUID) gameId, without ever calling getGame", async () => {
    const res = await POST(
      req({ gameId: "probe", cell: 4, playerId: "white", resumeCode: "AAAA-AA" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(getGame).not.toHaveBeenCalled();
  });

  it("401 when the resume code does not authenticate", async () => {
    authPlayer.mockResolvedValue(null);
    const res = await POST(req({ gameId: GAME_ID, cell: 4, playerId: "white", resumeCode: "x" }));
    expect(res.status).toBe(401);
  });

  it("403 when it is not the mover's turn", async () => {
    authPlayer.mockResolvedValue(makePlayer("black"));
    getGame.mockResolvedValue(makeGame({ turn: "w" })); // white to move, black asks
    const res = await POST(req({ gameId: GAME_ID, cell: 4, playerId: "black", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_your_turn");
  });

  it("400 rejects an illegal (occupied) cell server-side", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    // 2 marks → white to move; cell 0 is occupied → illegal.
    getGame.mockResolvedValue(makeGame({ fen: "xo......." }));
    const res = await POST(req({ gameId: GAME_ID, cell: 0, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(400);
    expect(applyMoveRpc).not.toHaveBeenCalled();
  });

  it("returns a structured 503 (never throws) when an internal call fails", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ gameId: GAME_ID, cell: 4, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("applies a legal move atomically and broadcasts", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame());
    const res = await POST(req({ gameId: GAME_ID, cell: 4, playerId: "white", resumeCode: "AAAA-AA" }));
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
    // R8: the player already has the full answer while NOTHING has broadcast yet.
    expect(broadcastPosition).not.toHaveBeenCalled();
    expect(broadcastSpectate).not.toHaveBeenCalled();

    await drainDeferred();
    expect(broadcastPosition).toHaveBeenCalledOnce();
    expect(broadcastPosition.mock.calls[0]).toEqual([
      "g1",
      json.fen,
      "b",
      "live",
      { cell: 4 },
    ]);
    expect(broadcastSpectate).toHaveBeenCalledOnce();
    expect(broadcastSpectate.mock.calls[0]).toEqual(["t", "g1", json.fen, "b", "live"]);
    expect(afterGameResolved).not.toHaveBeenCalled();
  });

  it("maps a stale concurrency conflict to 409", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame());
    applyMoveRpc.mockResolvedValue({ ok: false, conflict: "stale" });
    const res = await POST(req({ gameId: GAME_ID, cell: 4, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale");
  });

  it("detects three-in-a-row and runs resolution side-effects", async () => {
    // x at 0,1; white to move (4 marks) completes the top row at cell 2 → win.
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame({ fen: "xx.oo...." }));
    applyMoveRpc.mockResolvedValue({ ok: true, ply: 5, status: "white_win" });
    const res = await POST(req({ gameId: GAME_ID, cell: 2, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("white_win");
    expect(applyMoveRpc.mock.calls[0][0]).toMatchObject({ newStatus: "white_win" });
    // R8: the win reaches the player BEFORE recomputeScores + broadcasts.
    expect(afterGameResolved).not.toHaveBeenCalled();

    await drainDeferred();
    expect(broadcastPosition).toHaveBeenCalledOnce();
    expect(broadcastSpectate).toHaveBeenCalledOnce();
    expect(afterGameResolved).toHaveBeenCalledOnce();
    expect(afterGameResolved.mock.calls[0].slice(1)).toEqual(["white_win", "play"]);
  });

  it("404 when the game does not exist", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(null);
    const res = await POST(req({ gameId: GAME_ID, cell: 4, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(404);
  });

  it("honours the tournament variant for the win scan (4×4)", async () => {
    // On a 4×4 board, 3-in-a-row is NOT a win — only 4 is. Top row x at 0,1,2;
    // white to move (6 marks) plays cell 3 → completes 4-in-a-row.
    authPlayer.mockResolvedValue(makePlayer("white"));
    getTournament.mockResolvedValue({ id: "t", config: { variant: "4x4" } });
    getGame.mockResolvedValue(makeGame({ fen: "xxx.ooo........." }));
    const res = await POST(req({ gameId: GAME_ID, cell: 3, playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(200);
    expect(applyMoveRpc.mock.calls[0][0]).toMatchObject({ newStatus: "white_win" });
  });
});
