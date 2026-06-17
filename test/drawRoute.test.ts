import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player } from "@/lib/types";

const { store } = vi.hoisted(() => ({
  store: {
    getGame: vi.fn(),
    resolveGameRpc: vi.fn(),
    setDrawOffer: vi.fn(),
  },
}));
const authPlayer = vi.fn();

vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/auth", () => ({ authPlayer: (...a: unknown[]) => authPlayer(...a) }));
vi.mock("@/lib/server/gameEvents", () => ({ afterGameResolved: vi.fn() }));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));

import { POST } from "@/app/api/game/draw/route";

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
    tournament_id: "t",
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
  };
}
const player = (id: string): Player => ({
  id,
  tournament_id: "t",
  display_name: id,
  resume_code: "AAAA-AA",
  score: 0,
  tiebreak: 0,
  status: "active",
  seed: null,
  joined_at: "",
});
function req(body: unknown): Request {
  return new Request("http://x/api/game/draw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resolveGameRpc.mockResolvedValue({ ok: true, status: "draw" });
  store.setDrawOffer.mockResolvedValue(undefined);
});

describe("POST /api/game/draw", () => {
  it("returns a structured 503 (never throws) when an internal call fails", async () => {
    // The route-resilience sweep: an unexpected throw must not become a platform
    // 500/1102 HTML page (which the client mis-renders).
    authPlayer.mockResolvedValue(player("white"));
    store.getGame.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ gameId: "g1", playerId: "white", resumeCode: "AAAA-AA", action: "offer" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("offer records the pending offer", async () => {
    authPlayer.mockResolvedValue(player("white"));
    store.getGame.mockResolvedValue(makeGame());
    const res = await POST(req({ gameId: "g1", playerId: "white", resumeCode: "AAAA-AA", action: "offer" }));
    expect(res.status).toBe(200);
    expect(store.setDrawOffer).toHaveBeenCalledWith("g1", "white");
  });

  it("accept WITHOUT a pending offer does NOT draw", async () => {
    authPlayer.mockResolvedValue(player("black"));
    store.getGame.mockResolvedValue(makeGame({ draw_offered_by: null }));
    const res = await POST(req({ gameId: "g1", playerId: "black", resumeCode: "AAAA-AA", action: "accept" }));
    expect(res.status).toBe(409);
    expect(store.resolveGameRpc).not.toHaveBeenCalled();
  });

  it("accept of your OWN offer does NOT draw", async () => {
    authPlayer.mockResolvedValue(player("white"));
    store.getGame.mockResolvedValue(makeGame({ draw_offered_by: "white" }));
    const res = await POST(req({ gameId: "g1", playerId: "white", resumeCode: "AAAA-AA", action: "accept" }));
    expect(res.status).toBe(409);
    expect(store.resolveGameRpc).not.toHaveBeenCalled();
  });

  it("accept of the OPPONENT's offer resolves a draw (require_live)", async () => {
    authPlayer.mockResolvedValue(player("black"));
    store.getGame.mockResolvedValue(makeGame({ draw_offered_by: "white" }));
    const res = await POST(req({ gameId: "g1", playerId: "black", resumeCode: "AAAA-AA", action: "accept" }));
    expect(res.status).toBe(200);
    expect(store.resolveGameRpc).toHaveBeenCalledWith("g1", "draw", "play", true);
  });
});
