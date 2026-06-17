import { beforeEach, describe, expect, it, vi } from "vitest";

const authHost = vi.fn();
const listRounds = vi.fn();
const extendRoundRpc = vi.fn();
const setRoundStartedAt = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  authHost: (...a: unknown[]) => authHost(...a),
}));
vi.mock("@/lib/server/store", () => ({
  listRounds: (...a: unknown[]) => listRounds(...a),
  extendRoundRpc: (...a: unknown[]) => extendRoundRpc(...a),
  setRoundStartedAt: (...a: unknown[]) => setRoundStartedAt(...a),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));

import { POST } from "@/app/api/round/extend/route";

function req(): Request {
  return new Request("http://x/api/round/extend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tournamentId: "t", hostCode: "AAAA-AA" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authHost.mockResolvedValue({ id: "t", status: "league", current_round: 1 });
  listRounds.mockResolvedValue([
    {
      id: "r1",
      tournament_id: "t",
      number: 1,
      phase: "league",
      status: "live",
      started_at: "2026-01-01T10:00:00.000Z",
    },
  ]);
});

describe("POST /api/round/extend", () => {
  it("uses the atomic RPC and leaves started_at alone", async () => {
    extendRoundRpc.mockResolvedValue(120_000);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).extendedMs).toBe(120_000);
    expect(extendRoundRpc).toHaveBeenCalledWith("r1");
    // the whole point: chess-clock t0 (started_at) must NOT move
    expect(setRoundStartedAt).not.toHaveBeenCalled();
  });

  it("falls back to shifting started_at when 0007 is not migrated", async () => {
    extendRoundRpc.mockRejectedValue(new Error("function not found"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).extendedMs).toBeNull();
    expect(setRoundStartedAt).toHaveBeenCalledWith(
      "r1",
      "2026-01-01T10:01:00.000Z",
    );
  });

  it("409 when no live round exists", async () => {
    listRounds.mockResolvedValue([]);
    const res = await POST(req());
    expect(res.status).toBe(409);
  });
});
