import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimiter } from "@/lib/server/http";

// Same chainable query-builder stub the store tests use: every method returns
// the builder, and the builder itself is awaitable and resolves to the
// configured PostgREST-shaped { data, error }.
const { makeDb, state } = vi.hoisted(() => {
  const state: {
    table: string;
    ops: [string, ...unknown[]][];
    result: unknown;
    throwOnCreate: boolean;
  } = { table: "", ops: [], result: { data: [], error: null }, throwOnCreate: false };
  function makeDb() {
    if (state.throwOnCreate) throw new Error("Supabase env missing");
    const builder: Record<string, unknown> = {};
    const method =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === "from") {
          state.table = args[0] as string;
          state.ops = [];
        } else {
          state.ops.push([name, ...args]);
        }
        return builder;
      };
    for (const m of ["from", "select", "limit"]) builder[m] = method(m);
    builder.then = (resolve: (v: unknown) => unknown) => resolve(state.result);
    return builder;
  }
  return { makeDb, state };
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => makeDb(),
}));

import { GET, HEAD } from "@/app/api/health/route";

function req(path = "/api/health", ip = "1.2.3.4"): Request {
  return new Request(`http://x${path}`, { headers: { "x-forwarded-for": ip } });
}

beforeEach(() => {
  __resetRateLimiter();
  state.table = "";
  state.ops = [];
  state.result = { data: [{ id: "t1" }], error: null };
  state.throwOnCreate = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/health", () => {
  it("answers 200 without touching the database", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.app).toBe("sundaytictactoe");
    expect(typeof body.ts).toBe("string");
    expect(Number.isNaN(Date.parse(body.ts as string))).toBe(false);
    // No db key on the bare probe — a DB outage must stay distinguishable.
    expect(body).not.toHaveProperty("db");
    expect(state.table).toBe("");
  });

  it("?db=1 runs the lightest possible read and reports ok", async () => {
    const res = await GET(req("/api/health?db=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, app: "sundaytictactoe", db: "ok" });
    expect(typeof body.ms).toBe("number");
    expect(state.table).toBe("tournaments");
    expect(state.ops).toEqual([
      ["select", "id"],
      ["limit", 1],
    ]);
  });

  it("?db=1 returns 503 when PostgREST returns an error", async () => {
    state.result = { data: null, error: { message: "boom" } };
    const res = await GET(req("/api/health?db=1"));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false, db: "error" });
  });

  it("?db=1 returns 503 (never throws) when the client cannot be built", async () => {
    state.throwOnCreate = true;
    const res = await GET(req("/api/health?db=1"));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false, db: "error" });
  });

  it("throttles only the db branch, per IP", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await GET(req("/api/health?db=1"))).status).toBe(200);
    }
    expect((await GET(req("/api/health?db=1"))).status).toBe(429);
    // The bare probe is unaffected by the exhausted db bucket…
    expect((await GET(req())).status).toBe(200);
    // …and another IP still has its own budget.
    expect((await GET(req("/api/health?db=1", "9.9.9.9"))).status).toBe(200);
  });
});

describe("HEAD /api/health", () => {
  it("mirrors GET's status with no body", async () => {
    const res = await HEAD(req());
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("mirrors GET's failure status", async () => {
    state.throwOnCreate = true;
    const res = await HEAD(req("/api/health?db=1"));
    expect(res.status).toBe(503);
    expect(res.body).toBeNull();
  });
});
