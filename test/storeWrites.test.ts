import { beforeEach, describe, expect, it, vi } from "vitest";

// M3: eight writes in store.ts used to `await` the PostgREST chain and DROP the
// `error` it resolves with. A failed write therefore returned void — exactly
// what a successful one returns — so the ROUTE answered 200 "ok" for work that
// never happened: a kicked player who stayed, a timer that never moved, scores
// that never recomputed. These now throw, and every caller sits inside a
// try/catch that answers 503 — which is the truth: it failed, retry.
//
// Chainable query-builder stub (same shape as storeOwner.test.ts): each method
// records its call and returns the builder; the builder is awaitable and
// resolves to the configured { data, error }.
const { makeDb, state } = vi.hoisted(() => {
  // `ops` accumulates across `from()` calls (scorePredictions issues TWO
  // chains), and `results` is a queue so a test can let the first await succeed
  // and the second fail; when it runs dry, `result` is used for every await.
  const state: {
    table: string;
    ops: [string, ...unknown[]][];
    result: unknown;
    results: unknown[];
  } = { table: "", ops: [], result: { data: null, error: null }, results: [] };
  function makeDb() {
    const builder: Record<string, unknown> = {};
    const method =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === "from") state.table = args[0] as string;
        state.ops.push([name, ...args]);
        return builder;
      };
    for (const m of ["from", "update", "eq", "neq", "rpc", "select", "limit"]) {
      builder[m] = method(m);
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(state.results.length ? state.results.shift() : state.result);
    return builder;
  }
  return { makeDb, state };
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => makeDb(),
}));

import {
  recomputeScores,
  scorePredictions,
  setDrawOffer,
  setPlayerSeed,
  setPlayerStatus,
  setRoundStartedAt,
  setRoundStatus,
} from "@/lib/server/store";

const ok = { data: null, error: null };
const boom = { data: null, error: new Error("write failed") };

beforeEach(() => {
  state.table = "";
  state.ops = [];
  state.result = ok;
  state.results = [];
});

// [name, run, expected table, one op the write must have issued]
const writes: Array<[string, () => Promise<void>, string, [string, ...unknown[]]]> = [
  ["setPlayerSeed", () => setPlayerSeed("p1", 3), "players", ["update", { seed: 3 }]],
  [
    "setPlayerStatus",
    () => setPlayerStatus("p1", "left"),
    "players",
    ["update", { status: "left" }],
  ],
  [
    "setRoundStatus",
    () => setRoundStatus("r1", "done"),
    "rounds",
    ["update", { status: "done" }],
  ],
  [
    "setRoundStartedAt",
    () => setRoundStartedAt("r1", "2026-01-01T00:00:00Z"),
    "rounds",
    ["update", { started_at: "2026-01-01T00:00:00Z" }],
  ],
  [
    "setDrawOffer",
    () => setDrawOffer("g1", "p1"),
    "games",
    ["update", { draw_offered_by: "p1" }],
  ],
  [
    "scorePredictions",
    () => scorePredictions("g1", "draw"),
    "predictions",
    ["eq", "game_id", "g1"],
  ],
];

describe("store writes surface their errors (M3)", () => {
  for (const [name, run, table, op] of writes) {
    it(`${name} writes to ${table} and RESOLVES when the write succeeds`, async () => {
      await expect(run()).resolves.toBeUndefined();
      expect(state.table).toBe(table);
      expect(state.ops).toContainEqual(op);
    });

    it(`${name} THROWS on a failed write (no silent success)`, async () => {
      state.result = boom;
      await expect(run()).rejects.toThrow("write failed");
    });
  }

  it("recomputeScores calls the RPC and throws when it fails", async () => {
    await expect(recomputeScores("t1")).resolves.toBeUndefined();
    expect(state.ops).toContainEqual([
      "rpc",
      "recompute_scores",
      { p_tournament_id: "t1" },
    ]);
    state.result = boom;
    await expect(recomputeScores("t1")).rejects.toThrow("write failed");
  });

  it("scorePredictions writes nothing for a result that maps to no tip", async () => {
    await scorePredictions("g1", "aborted"); // aborted/bye → predictions stay void
    expect(state.table).toBe("");
    expect(state.ops).toEqual([]);
  });

  it("scorePredictions issues BOTH updates — wrong first, then right", async () => {
    await scorePredictions("g1", "white_win");
    expect(state.ops).toContainEqual(["update", { correct: false }]);
    expect(state.ops).toContainEqual(["neq", "predicted", "white"]);
    expect(state.ops).toContainEqual(["update", { correct: true }]);
    expect(state.ops).toContainEqual(["eq", "predicted", "white"]);
  });

  // The SECOND update is the one that marks the winners, so a swallowed error
  // there loses every correct tip on the game — check it separately from the
  // first, which the shared `boom` case above already covers.
  it("scorePredictions throws when only the SECOND update fails", async () => {
    state.results = [ok, boom];
    await expect(scorePredictions("g1", "black_win")).rejects.toThrow("write failed");
  });
});
