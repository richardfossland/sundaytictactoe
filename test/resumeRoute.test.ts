import { beforeEach, describe, expect, it, vi } from "vitest";

// R1b regression: POST /api/resume with a non-UUID tournamentId made
// getTournament throw Postgres 22P02, which the route's catch-all mapped to a
// false 503 — a fatal bug here specifically, because the client's resume
// catch WIPES the stored session on anything it can't classify as transient.
const getTournament = vi.fn();
const getTournamentByPin = vi.fn();
const getPlayerByResume = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  getTournamentByPin: (...a: unknown[]) => getTournamentByPin(...a),
  getPlayerByResume: (...a: unknown[]) => getPlayerByResume(...a),
}));
vi.mock("@/lib/server/lifecycle", () => ({
  maybeAutoFinishStale: (t: unknown) => Promise.resolve(t),
}));

import { POST } from "@/app/api/resume/route";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

function req(body: unknown): Request {
  return new Request("http://x/api/resume", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `1.2.3.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/resume", () => {
  it("400s a malformed (non-UUID) tournamentId without ever calling getTournament", async () => {
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: "probe" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("404s a valid-shaped tournamentId that doesn't exist (unchanged behavior)", async () => {
    getTournament.mockResolvedValue(null);
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: VALID_ID }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(getTournament).toHaveBeenCalledWith(VALID_ID);
  });

  it("resumes a real session by tournamentId", async () => {
    getTournament.mockResolvedValue({ id: VALID_ID, status: "league" });
    getPlayerByResume.mockResolvedValue({ id: "p1", display_name: "Ada" });
    const res = await POST(req({ resumeCode: "AAAA-AA", tournamentId: VALID_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      tournamentId: VALID_ID,
      playerId: "p1",
      displayName: "Ada",
      tournamentStatus: "league",
    });
  });

  it("still resumes by pin when tournamentId is omitted", async () => {
    getTournamentByPin.mockResolvedValue({ id: VALID_ID, status: "lobby" });
    getPlayerByResume.mockResolvedValue({ id: "p1", display_name: "Ada" });
    const res = await POST(req({ resumeCode: "AAAA-AA", pin: "402815" }));
    expect(res.status).toBe(200);
    expect(getTournamentByPin).toHaveBeenCalledWith("402815");
  });
});
