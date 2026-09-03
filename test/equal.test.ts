import { describe, expect, it } from "vitest";
import { sameDetail, sameJson, sameSet } from "@/lib/client/equal";
import type { GameDetail } from "@/lib/dto";

// L5 port (sundaychess#84): these three sit in front of a setState that used
// to fire unconditionally on a timer. A false positive (saying "same" when
// something changed) would DROP a real update, so every field the UI reads
// has to be covered.

describe("sameSet", () => {
  it("is true for the same reference and for equal membership", () => {
    const a = new Set(["p1", "p2"]);
    expect(sameSet(a, a)).toBe(true);
    expect(sameSet(a, new Set(["p1", "p2"]))).toBe(true);
  });

  it("ignores insertion order", () => {
    expect(sameSet(new Set(["p1", "p2"]), new Set(["p2", "p1"]))).toBe(true);
  });

  it("is true for two empty sets", () => {
    expect(sameSet(new Set(), new Set())).toBe(true);
  });

  it("is false when a key joins, leaves or is swapped", () => {
    expect(sameSet(new Set(["p1"]), new Set(["p1", "p2"]))).toBe(false);
    expect(sameSet(new Set(["p1", "p2"]), new Set(["p1"]))).toBe(false);
    // same size, different membership — the size check alone must not pass it
    expect(sameSet(new Set(["p1", "p2"]), new Set(["p1", "p3"]))).toBe(false);
  });
});

describe("sameJson", () => {
  it("is true for deeply equal plain JSON", () => {
    expect(sameJson({ a: 1, b: [1, 2, { c: "x" }] }, { a: 1, b: [1, 2, { c: "x" }] })).toBe(true);
  });

  it("is false when any leaf differs", () => {
    expect(sameJson({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] })).toBe(false);
    expect(sameJson({ a: 1 }, { a: "1" })).toBe(false);
  });

  it("handles null and undefined without stringifying them", () => {
    // JSON.stringify(undefined) is `undefined`, not a string — two different
    // nullish values must never come out equal by accident.
    expect(sameJson(null, null)).toBe(true);
    expect(sameJson(undefined, undefined)).toBe(true);
    expect(sameJson(null, undefined)).toBe(false);
    expect(sameJson(null, {})).toBe(false);
    expect(sameJson({}, null)).toBe(false);
    expect(sameJson(undefined, {})).toBe(false);
  });

  it("is true for identical primitives", () => {
    expect(sameJson(5, 5)).toBe(true);
    expect(sameJson("a", "a")).toBe(true);
    expect(sameJson(5, 6)).toBe(false);
  });
});

const START = ".".repeat(9);

function detail(over: Partial<GameDetail> = {}): GameDetail {
  return {
    id: "g1",
    tournamentId: "t1",
    roundId: "r1",
    fen: START,
    pgn: "",
    status: "live",
    turn: "w",
    white: { id: "w1", name: "Ada" },
    black: { id: "b1", name: "Bo" },
    lastMove: null,
    drawOfferedBy: null,
    ...over,
  };
}

describe("sameDetail", () => {
  it("is true for the same reference and for two identical payloads", () => {
    const d = detail();
    expect(sameDetail(d, d)).toBe(true);
    expect(sameDetail(detail(), detail())).toBe(true);
  });

  it("is false when either side is null", () => {
    expect(sameDetail(null, detail())).toBe(false);
    expect(sameDetail(detail(), null)).toBe(false);
  });

  it("is true for two nulls (first load has not landed yet)", () => {
    expect(sameDetail(null, null)).toBe(true);
  });

  it.each([
    ["id", { id: "g2" }],
    ["fen", { fen: "x" + ".".repeat(8) }],
    ["pgn", { pgn: "4" }],
    ["status", { status: "draw" as const }],
    ["turn", { turn: "b" as const }],
    ["drawOfferedBy", { drawOfferedBy: "w1" }],
    ["white.id", { white: { id: "w9", name: "Ada" } }],
    ["white.name", { white: { id: "w1", name: "Ada B." } }],
    ["black.id", { black: { id: "b9", name: "Bo" } }],
    ["black.name", { black: { id: "b1", name: "Bo C." } }],
    ["black -> null", { black: null }],
    ["lastMove", { lastMove: { cell: 4 } }],
  ])("is false when %s changes", (_label, over) => {
    expect(sameDetail(detail(), detail(over as Partial<GameDetail>))).toBe(false);
  });

  it("compares the cell of lastMove, not just its presence", () => {
    const base = detail({ lastMove: { cell: 4 } });
    expect(sameDetail(base, detail({ lastMove: { cell: 4 } }))).toBe(true);
    expect(sameDetail(base, detail({ lastMove: { cell: 0 } }))).toBe(false);
    expect(sameDetail(base, detail({ lastMove: null }))).toBe(false);
  });

  it("treats an ABSENT optional field the same as an explicit null", () => {
    // The API omits drawOfferedBy on some paths and sends null on others; a
    // shape difference alone must not read as a change.
    const withNull = detail({ drawOfferedBy: null });
    const absent = detail();
    delete (absent as Partial<GameDetail>).drawOfferedBy;
    expect(sameDetail(withNull, absent)).toBe(true);
    expect(sameDetail(absent, withNull)).toBe(true);
  });

  it("still sees a real change when both sides omit the optional field", () => {
    const a = detail();
    const b = detail({ status: "white_win" });
    for (const d of [a, b]) {
      delete (d as Partial<GameDetail>).drawOfferedBy;
    }
    expect(sameDetail(a, b)).toBe(false);
  });
});
