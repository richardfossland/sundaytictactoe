import { beforeEach, describe, expect, it, vi } from "vitest";

// R1b regression: POST /api/tournament/<id>/codes with a non-UUID id made
// authHost's getTournament call throw Postgres 22P02, which the route's
// catch-all mapped to a false 503. Verify the isUuid guard rejects it BEFORE
// authHost/the store are ever touched.
const authHost = vi.fn();
const listPlayers = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  authHost: (...a: unknown[]) => authHost(...a),
}));
vi.mock("@/lib/server/store", () => ({
  listPlayers: (...a: unknown[]) => listPlayers(...a),
}));

import { POST } from "@/app/api/tournament/[id]/codes/route";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

function req(id: string, hostCode = "AAAA-AA"): Request {
  return new Request(`http://x/api/tournament/${id}/codes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostCode }),
  });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/tournament/[id]/codes", () => {
  it("404s a malformed (non-UUID) id without ever calling authHost", async () => {
    const res = await POST(req("probe"), params("probe"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(authHost).not.toHaveBeenCalled();
  });

  it("401s a valid-shaped id with the wrong host code (unchanged behavior)", async () => {
    authHost.mockResolvedValue(null);
    const res = await POST(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(401);
    expect(authHost).toHaveBeenCalledWith(VALID_ID, "AAAA-AA");
  });

  it("200s the resume codes for the authenticated host", async () => {
    authHost.mockResolvedValue({ id: VALID_ID, host_code: "AAAA-AA" });
    listPlayers.mockResolvedValue([
      { id: "p1", display_name: "Ada", resume_code: "BBBB-BB", status: "active" },
      { id: "p2", display_name: "Bo", resume_code: "CCCC-CC", status: "left" },
    ]);
    const res = await POST(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.players).toEqual([
      { playerId: "p1", name: "Ada", resumeCode: "BBBB-BB" },
    ]);
  });
});
