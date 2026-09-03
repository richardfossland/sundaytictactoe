import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimiter } from "@/lib/server/http";

// POST /api/tournament/[id]/diagnostics — the teacher's readout of the client
// beacon (T5). It is gated EXACTLY like the sibling codes route, and it must
// answer "unavailable" (not 503) while migration 0012 has not been run.
const authHost = vi.fn();
const listClientEvents = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  authHost: (...a: unknown[]) => authHost(...a),
}));
vi.mock("@/lib/server/store", () => ({
  listClientEvents: (...a: unknown[]) => listClientEvents(...a),
}));

import { POST } from "@/app/api/tournament/[id]/diagnostics/route";

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-9222-222222222222";
const P2 = "33333333-3333-4333-a333-333333333333";

function req(id: string, hostCode = "AAAA-AA", ip = "1.2.3.4"): Request {
  return new Request(`http://x/api/tournament/${id}/diagnostics`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ hostCode }),
  });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    at: "2026-09-03T10:00:00.000Z",
    tournament_id: VALID_ID,
    player_id: P1,
    game_id: null,
    kind: "kick",
    detail: { reason: "resume" },
    sid: "s1",
    ua_class: "mobile",
    ...over,
  };
}

beforeEach(() => {
  __resetRateLimiter();
  vi.clearAllMocks();
});

describe("POST /api/tournament/[id]/diagnostics", () => {
  it("404s a malformed (non-UUID) id without ever calling authHost", async () => {
    const res = await POST(req("probe"), params("probe"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(authHost).not.toHaveBeenCalled();
  });

  it("401s without the host code — the log is teacher-only", async () => {
    authHost.mockResolvedValue(null);
    const res = await POST(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(401);
    expect(listClientEvents).not.toHaveBeenCalled();
  });

  it("returns the events newest-first plus counts by kind and by player", async () => {
    authHost.mockResolvedValue({ id: VALID_ID });
    listClientEvents.mockResolvedValue([
      row({ id: 3, kind: "channel_error", player_id: P2, detail: { status: "TIMED_OUT" } }),
      row({ id: 2, kind: "kick", player_id: P1 }),
      row({ id: 1, kind: "kick", player_id: null, game_id: null }),
    ]);
    const res = await POST(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(listClientEvents).toHaveBeenCalledWith(VALID_ID, 200);
    expect(body.unavailable).toBeUndefined();
    expect(body.events.map((e: { id: number }) => e.id)).toEqual([3, 2, 1]);
    // Camel-cased, and carrying NO display name — the modal joins those itself.
    expect(body.events[0]).toEqual({
      id: 3,
      at: "2026-09-03T10:00:00.000Z",
      kind: "channel_error",
      playerId: P2,
      gameId: null,
      detail: { status: "TIMED_OUT" },
      sid: "s1",
      uaClass: "mobile",
    });
    expect(body.counts.byKind).toEqual({ channel_error: 1, kick: 2 });
    expect(body.counts.byPlayer).toEqual({ [P2]: 1, [P1]: 1, "?": 1 });
  });

  it("says `unavailable` (not 503) when the table does not exist yet", async () => {
    authHost.mockResolvedValue({ id: VALID_ID });
    listClientEvents.mockResolvedValue(null);
    const res = await POST(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [], counts: {}, unavailable: true });
  });

  it("503s a genuine DB error rather than pretending the log is empty", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    authHost.mockResolvedValue({ id: VALID_ID });
    listClientEvents.mockRejectedValue(new Error("boom"));
    const res = await POST(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  it("shares the host brute-force throttle (429 past 90/min per IP)", async () => {
    authHost.mockResolvedValue(null);
    for (let i = 0; i < 90; i++) {
      const res = await POST(req(VALID_ID, "AAAA-AA", "7.7.7.7"), params(VALID_ID));
      expect(res.status).toBe(401);
    }
    const over = await POST(req(VALID_ID, "AAAA-AA", "7.7.7.7"), params(VALID_ID));
    expect(over.status).toBe(429);
  });
});
