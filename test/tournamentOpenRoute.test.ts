import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

const openTournamentByHostCode = vi.fn();

vi.mock("@/lib/server/store", () => ({
  openTournamentByHostCode: (...a: unknown[]) => openTournamentByHostCode(...a),
}));

// H5: this route now draws on BOTH its own `open:` bucket AND the shared host
// bucket (hostRateLimit) — mock both so each can be forced independently.
const { rateLimitMock, hostRateLimitMock } = vi.hoisted(() => ({
  rateLimitMock: vi.fn().mockReturnValue(true),
  hostRateLimitMock: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/http")>();
  return {
    ...actual,
    rateLimit: (...a: unknown[]) => rateLimitMock(...a),
    hostRateLimit: (...a: unknown[]) => hostRateLimitMock(...a),
  };
});

import { POST } from "@/app/api/tournament/open/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";

const tournament = (): Tournament =>
  ({
    id: T_ID,
    join_pin: "123456",
    host_code: "HOST-01",
    host_user_id: null,
    title: null,
    status: "lobby",
    config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 0,
    created_at: "",
  }) as Tournament;

const req = (body: unknown) =>
  new Request("http://x/api/tournament/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  rateLimitMock.mockReturnValue(true);
  hostRateLimitMock.mockReturnValue(null);
  openTournamentByHostCode.mockResolvedValue(tournament());
});

describe("POST /api/tournament/open", () => {
  it("reopens the board and normalises the typed code first", async () => {
    const res = await POST(req({ hostCode: "host 01" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: T_ID });
    expect(openTournamentByHostCode).toHaveBeenCalledWith("HOST-01");
  });

  it("400 missing_code on an empty body", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_code");
    expect(openTournamentByHostCode).not.toHaveBeenCalled();
  });

  // H2: normalizeResumeCode PASSES THROUGH anything that isn't 6 characters, so
  // without the shape check the lookup below ran on arbitrary client input — a
  // paste, a probe, a whole sentence — one DB round-trip per hit.
  it("400 invalid_code on anything that is not a real code shape, before the DB", async () => {
    for (const bad of [
      "nope",
      "hello there, this is not a code",
      "1234-56", // digits in the letter half
      "ABCDE-12",
      "ABC-12",
      "'; drop table tournaments; --",
    ]) {
      const res = await POST(req({ hostCode: bad }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_code");
    }
    expect(openTournamentByHostCode).not.toHaveBeenCalled();
  });

  it("404 not_found on a well-formed code nobody owns", async () => {
    openTournamentByHostCode.mockResolvedValue(null);
    const res = await POST(req({ hostCode: "ZZZZ-99" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("returns a structured 503 (never throws) when the lookup fails", async () => {
    openTournamentByHostCode.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ hostCode: "HOST-01" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  // H5: the shape check must be decided BEFORE either rate limiter is touched,
  // so a garbage guess can never spend budget in the SHARED host bucket that
  // override/absent/extend/kick also draw from.
  it("checks the code SHAPE before touching either rate limiter", async () => {
    const res = await POST(req({ hostCode: "not a real code" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_code");
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(hostRateLimitMock).not.toHaveBeenCalled();
  });

  // H5: own bucket (20/min) — independent of the shared host bucket.
  it("429s on its own `open:` bucket", async () => {
    rateLimitMock.mockReturnValueOnce(false);
    const res = await POST(req({ hostCode: "HOST-01" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(hostRateLimitMock).not.toHaveBeenCalled();
    expect(openTournamentByHostCode).not.toHaveBeenCalled();
  });

  // H5: this route searches EVERY tournament (including one row per casual
  // game) — the best host-code brute-force oracle in the app — so it now
  // ALSO draws on the shared host bucket, even when its own bucket has room.
  it("429s on the SHARED host bucket even when its own bucket has room", async () => {
    hostRateLimitMock.mockReturnValueOnce(
      Response.json({ error: "rate_limited" }, { status: 429 }),
    );
    const res = await POST(req({ hostCode: "HOST-01" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(openTournamentByHostCode).not.toHaveBeenCalled();
  });
});
