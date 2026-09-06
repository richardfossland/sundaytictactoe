import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/lib/types";

// Real auth (exercises the uuid guard inside authPlayer), mocked store + casual
// engine — the rematch logic itself is covered by casual.test.ts.
const getPlayer = vi.fn();
const rematchCasual = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getPlayer: (...a: unknown[]) => getPlayer(...a),
}));
vi.mock("@/lib/server/casual", () => ({
  rematchCasual: (...a: unknown[]) => rematchCasual(...a),
}));

import { POST } from "@/app/api/casual/rematch/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";
const P_ID = "33333333-3333-4333-8333-333333333333";
const G_ID = "11111111-1111-4111-8111-111111111111";

const player = (over: Partial<Player> = {}): Player => ({
  id: P_ID,
  tournament_id: T_ID,
  display_name: "Ada",
  resume_code: "AAAA-AA",
  score: 0,
  tiebreak: 0,
  status: "active",
  seed: null,
  joined_at: "",
  ...over,
});

const req = (body: unknown) =>
  new Request("http://x/api/casual/rematch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { tournamentId: T_ID, playerId: P_ID, resumeCode: "AAAA-AA" };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getPlayer.mockResolvedValue(player());
  rematchCasual.mockResolvedValue({ ok: true, gameId: G_ID });
});

describe("POST /api/casual/rematch", () => {
  it("starts the rematch and returns the new game", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, gameId: G_ID });
    expect(rematchCasual).toHaveBeenCalledWith(T_ID, P_ID);
  });

  // H2: rematchCasual hands the tournamentId straight to Postgres. Before the
  // guard a non-UUID threw 22P02 → a false 503; and a missing id read as a 403
  // "forbidden", which says the wrong thing about a malformed body.
  it("400s JSON on a malformed tournamentId, without reaching the engine", async () => {
    for (const bad of ["t1", "", "probe"]) {
      const res = await POST(req({ ...good, tournamentId: bad }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_request");
    }
    expect(rematchCasual).not.toHaveBeenCalled();
  });

  it("400 bad_request when the tournamentId is missing entirely", async () => {
    const res = await POST(req({ playerId: P_ID, resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  // H2: the guard lives inside authPlayer — a malformed playerId is a clean 401.
  it("401s JSON on a malformed playerId, without ever querying Postgres", async () => {
    const res = await POST(req({ ...good, playerId: "p1" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getPlayer).not.toHaveBeenCalled();
  });

  it("401 on a wrong resume code", async () => {
    expect((await POST(req({ ...good, resumeCode: "ZZZZ-99" }))).status).toBe(401);
  });

  it("403 forbidden for a well-formed id belonging to ANOTHER session", async () => {
    const other = "66666666-6666-4666-8666-666666666666";
    const res = await POST(req({ ...good, tournamentId: other }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(rematchCasual).not.toHaveBeenCalled();
  });

  it("maps the engine's refusals to their own statuses", async () => {
    rematchCasual.mockResolvedValue({ ok: false, reason: "not_casual" });
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_casual");
  });

  it("returns a structured 503 (never throws) when the engine fails", async () => {
    rematchCasual.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
