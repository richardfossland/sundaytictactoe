import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the OPTIONAL Sunday Account host dashboard API wiring:
//   - GET /api/host/tournaments is scoped to the signed-in owner
//   - DELETE /api/host/tournaments/[id] returns 401 / 403 / 200 / 404 correctly
// The store + the session-resolving requireHost are mocked so the route logic is
// exercised without a real Supabase issuer or DB. (isAdminEmail — the allow-list
// authz spot — is covered separately in hostAuth.test.ts with the real module.)

// vi.mock factories are hoisted; build the shared mocks + a real-shaped
// HostAuthError/hostAuthFail with vi.hoisted so the factory can reference them.
const h = vi.hoisted(() => {
  class HostAuthError extends Error {
    status: number;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
    }
  }
  function hostAuthFail(err: unknown): Response | null {
    if (err instanceof HostAuthError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return null;
  }
  return {
    HostAuthError,
    hostAuthFail,
    requireHost: vi.fn(),
    listTournamentsByOwner: vi.fn(),
    deleteTournamentOwned: vi.fn(),
  };
});

vi.mock("@/lib/server/auth", () => ({
  requireHost: (...a: unknown[]) => h.requireHost(...a),
  hostAuthFail: h.hostAuthFail,
  HostAuthError: h.HostAuthError,
}));
vi.mock("@/lib/server/store", () => ({
  listTournamentsByOwner: (...a: unknown[]) => h.listTournamentsByOwner(...a),
  deleteTournamentOwned: (...a: unknown[]) => h.deleteTournamentOwned(...a),
}));

import { GET } from "@/app/api/host/tournaments/route";
import { DELETE } from "@/app/api/host/tournaments/[id]/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/host/tournaments", () => {
  it("401 when not signed in", async () => {
    h.requireHost.mockRejectedValue(new h.HostAuthError(401, "not_signed_in"));
    const res = await GET();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("403 when signed in but not allow-listed", async () => {
    h.requireHost.mockRejectedValue(new h.HostAuthError(403, "not_allowlisted"));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lists only the signed-in owner's tournaments", async () => {
    h.requireHost.mockResolvedValue({ id: "owner-1", email: "h@x.no" });
    h.listTournamentsByOwner.mockResolvedValue([
      { id: "t1", title: "A", status: "lobby", join_pin: "111111", created_at: "x", playerCount: 3 },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(h.listTournamentsByOwner).toHaveBeenCalledWith("owner-1");
    expect((await res.json()).tournaments).toHaveLength(1);
  });
});

describe("DELETE /api/host/tournaments/[id]", () => {
  it("401 when not signed in", async () => {
    h.requireHost.mockRejectedValue(new h.HostAuthError(401, "not_signed_in"));
    const res = await DELETE(new Request("http://x"), ctx("t1"));
    expect(res.status).toBe(401);
    expect(h.deleteTournamentOwned).not.toHaveBeenCalled();
  });

  it("403 when signed in but not allow-listed", async () => {
    h.requireHost.mockRejectedValue(new h.HostAuthError(403, "not_allowlisted"));
    const res = await DELETE(new Request("http://x"), ctx("t1"));
    expect(res.status).toBe(403);
    expect(h.deleteTournamentOwned).not.toHaveBeenCalled();
  });

  it("200 when the owner deletes their own tournament", async () => {
    h.requireHost.mockResolvedValue({ id: "owner-1", email: "h@x.no" });
    h.deleteTournamentOwned.mockResolvedValue(true);
    const res = await DELETE(new Request("http://x"), ctx("t1"));
    expect(res.status).toBe(200);
    expect(h.deleteTournamentOwned).toHaveBeenCalledWith("t1", "owner-1");
    expect((await res.json()).ok).toBe(true);
  });

  it("404 when the id isn't owned by the host (no leak)", async () => {
    h.requireHost.mockResolvedValue({ id: "owner-1", email: "h@x.no" });
    h.deleteTournamentOwned.mockResolvedValue(false);
    const res = await DELETE(new Request("http://x"), ctx("someone-elses"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });
});
