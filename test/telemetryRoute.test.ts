import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimiter } from "@/lib/server/http";

// POST /api/telemetry is the one route in the app with an absolute contract:
// it ALWAYS answers 204 and NEVER throws — it is called by sendBeacon from a
// page that is often unloading, by a browser that is already in trouble, and
// (before migration 0012 is run) against a table that does not exist.
//
// Same chainable query-builder stub as the store/health tests: `insert()`
// records its payload and the builder is awaitable.
const { makeDb, state } = vi.hoisted(() => {
  const state: {
    table: string;
    inserts: unknown[];
    result: unknown;
    throwOnCreate: boolean;
  } = { table: "", inserts: [], result: { error: null }, throwOnCreate: false };
  function makeDb() {
    if (state.throwOnCreate) throw new Error("Supabase env missing");
    const builder: Record<string, unknown> = {};
    builder.from = (t: string) => {
      state.table = t;
      return builder;
    };
    builder.insert = (row: unknown) => {
      state.inserts.push(row);
      return builder;
    };
    builder.then = (resolve: (v: unknown) => unknown) => resolve(state.result);
    return builder;
  }
  return { makeDb, state };
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => makeDb(),
}));

import { POST } from "@/app/api/telemetry/route";

const TID = "11111111-1111-4111-8111-111111111111";
const PID = "22222222-2222-4222-9222-222222222222";
const GID = "33333333-3333-4333-a333-333333333333";

/** How sendBeacon(url, string) actually posts: text/plain, no JSON header. */
function beacon(body: string, ip = "1.2.3.4"): Request {
  return new Request("http://x/api/telemetry", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": ip },
    body,
  });
}

function jsonReq(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("http://x/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const EVENT = {
  app: "sundaytictactoe",
  kind: "kick",
  detail: { reason: "resume", status: 404 },
  sid: "abc123",
  uaClass: "mobile",
  tournamentId: TID,
  playerId: PID,
  gameId: GID,
};

beforeEach(() => {
  __resetRateLimiter();
  state.table = "";
  state.inserts = [];
  state.result = { error: null };
  state.throwOnCreate = false;
  vi.restoreAllMocks();
});

describe("POST /api/telemetry", () => {
  it("accepts a text/plain body (what navigator.sendBeacon sends)", async () => {
    const res = await POST(beacon(JSON.stringify(EVENT)));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(state.table).toBe("client_events");
    expect(state.inserts).toEqual([
      {
        tournament_id: TID,
        player_id: PID,
        game_id: GID,
        kind: "kick",
        detail: { reason: "resume", status: 404 },
        sid: "abc123",
        ua_class: "mobile",
      },
    ]);
  });

  it("accepts an application/json body (the keepalive fetch fallback)", async () => {
    const res = await POST(jsonReq(EVENT));
    expect(res.status).toBe(204);
    expect(state.inserts).toHaveLength(1);
  });

  it("drops a kind outside the allow-list — 204, no insert", async () => {
    const res = await POST(beacon(JSON.stringify({ ...EVENT, kind: "drop_table" })));
    expect(res.status).toBe(204);
    expect(state.inserts).toEqual([]);
  });

  it("drops a malformed body without throwing", async () => {
    for (const body of ["", "not json", "[1,2,3]", '"a string"', "null"]) {
      const res = await POST(beacon(body));
      expect(res.status).toBe(204);
    }
    expect(state.inserts).toEqual([]);
  });

  it("nulls ids that are not UUIDs instead of handing them to Postgres", async () => {
    await POST(
      beacon(
        JSON.stringify({
          ...EVENT,
          tournamentId: "probe",
          playerId: 42,
          gameId: null,
        }),
      ),
    );
    const row = state.inserts[0] as Record<string, unknown>;
    expect(row.tournament_id).toBeNull();
    expect(row.player_id).toBeNull();
    expect(row.game_id).toBeNull();
  });

  it("rejects a smuggled ua_class (e.g. a full user-agent string) → null", async () => {
    await POST(beacon(JSON.stringify({ ...EVENT, uaClass: "Mozilla/5.0 (iPhone…)" })));
    expect((state.inserts[0] as Record<string, unknown>).ua_class).toBeNull();
  });

  it("truncates an oversize detail to <= 2 KB and drops nested structures", async () => {
    const detail: Record<string, unknown> = {
      // A single 5 KB string — must survive only as a 200-char clamp.
      message: "x".repeat(5000),
      nested: { secret: "should never be stored" },
      list: [1, 2, 3],
      status: 500,
    };
    // …plus enough keys to blow the 2 KB budget outright.
    for (let i = 0; i < 60; i++) detail[`k${i}`] = "y".repeat(190);

    await POST(beacon(JSON.stringify({ ...EVENT, detail })));
    const stored = (state.inserts[0] as { detail: Record<string, unknown> }).detail;
    expect(JSON.stringify(stored).length).toBeLessThanOrEqual(2048);
    expect(stored.message).toBe("x".repeat(200));
    expect(stored).not.toHaveProperty("nested");
    expect(stored).not.toHaveProperty("list");
  });

  it("drops a body larger than the hard cap before parsing it", async () => {
    const huge = JSON.stringify({ ...EVENT, detail: { m: "z".repeat(40000) } });
    const res = await POST(beacon(huge));
    expect(res.status).toBe(204);
    expect(state.inserts).toEqual([]);
  });

  it("answers 204 when the table does not exist yet (migration 0012 unrun)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.result = {
      error: { code: "PGRST205", message: "Could not find the table 'tictactoe.client_events' in the schema cache" },
    };
    const res = await POST(beacon(JSON.stringify(EVENT)));
    expect(res.status).toBe(204);
    // Warned — but only once per isolate, however many beacons arrive.
    await POST(beacon(JSON.stringify({ ...EVENT, sid: "second" })));
    await POST(beacon(JSON.stringify({ ...EVENT, sid: "third" })));
    expect(warn.mock.calls.filter((c) => c[0] === "[telemetry]")).toHaveLength(1);
  });

  it("answers 204 when the service client cannot even be created", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.throwOnCreate = true;
    const res = await POST(beacon(JSON.stringify(EVENT)));
    expect(res.status).toBe(204);
  });

  it("answers 204 (and stops inserting) once the per-IP rate limit is hit", async () => {
    for (let i = 0; i < 60; i++) {
      // Vary the sid so the SERVER limit is what stops us, not any dedupe.
      const res = await POST(beacon(JSON.stringify({ ...EVENT, sid: `s${i}` }), "9.9.9.9"));
      expect(res.status).toBe(204);
    }
    expect(state.inserts).toHaveLength(60);

    const over = await POST(beacon(JSON.stringify(EVENT), "9.9.9.9"));
    expect(over.status).toBe(204);
    expect(state.inserts).toHaveLength(60); // no 61st insert

    // A different classroom/IP is unaffected.
    await POST(beacon(JSON.stringify(EVENT), "8.8.8.8"));
    expect(state.inserts).toHaveLength(61);
  });
});
