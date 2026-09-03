import { describe, expect, it } from "vitest";
import { arePropsEqual, type MnkBoardProps } from "@/lib/client/MnkBoard";

// L5 port (sundaychess#84): <MnkBoard> is the memo boundary that stops its
// callers' re-renders (polls, presence events, toasts, the `pending` flip)
// from redoing all m*n cells for nothing.
//
// The truth table below IS the contract: value props gate the render, `onCell`
// identity never does. The reasoning that makes ignoring the handler safe is
// in the header of lib/client/MnkBoard.tsx.

const START = ".".repeat(9);
const AFTER_MOVE = "x" + ".".repeat(8);

function props(over: Partial<MnkBoardProps> = {}): MnkBoardProps {
  return {
    state: START,
    m: 3,
    n: 3,
    disabled: false,
    lastCell: null,
    winLine: null,
    size: "lg",
    onCell: () => {},
    ...over,
  };
}

describe("MnkBoard arePropsEqual", () => {
  it("is true when nothing the board displays changed", () => {
    expect(arePropsEqual(props(), props())).toBe(true);
  });

  it.each([
    ["state", { state: AFTER_MOVE }],
    ["m", { m: 4 }],
    ["n", { n: 4 }],
    ["disabled", { disabled: true }],
    ["lastCell", { lastCell: 0 }],
    ["size", { size: "sm" as const }],
  ])("is false when %s changes", (_label, over) => {
    expect(arePropsEqual(props(), props(over))).toBe(false);
  });

  it("IGNORES onCell identity — new closures alone must not re-render the board", () => {
    // None of the three callers (GameView, solo, LocalVersus) memoize tryMove,
    // so onCell is a new function on EVERY render. If it counted, the memo
    // would never hit.
    const a = props();
    const b = props({ onCell: () => {} });
    expect(b.onCell).not.toBe(a.onCell);
    expect(arePropsEqual(a, b)).toBe(true);
  });

  it("IGNORES winLine identity when the content is the same", () => {
    // Every caller recomputes winLine fresh from `state` each render (never
    // memoized upstream), so a content-equal array must not force a render.
    const a = props({ winLine: [0, 1, 2] });
    const b = props({ winLine: [0, 1, 2] });
    expect(b.winLine).not.toBe(a.winLine);
    expect(arePropsEqual(a, b)).toBe(true);
  });

  it("is false when winLine's content actually differs", () => {
    expect(arePropsEqual(props({ winLine: [0, 1, 2] }), props({ winLine: [3, 4, 5] }))).toBe(
      false,
    );
    expect(arePropsEqual(props({ winLine: [0, 1, 2] }), props({ winLine: null }))).toBe(false);
    expect(arePropsEqual(props({ winLine: null }), props({ winLine: [0, 1, 2] }))).toBe(false);
  });

  it("treats absent and null winLine the same (both mean 'no highlight')", () => {
    const withoutProp = props();
    delete (withoutProp as Partial<MnkBoardProps>).winLine;
    expect(arePropsEqual(withoutProp, props({ winLine: null }))).toBe(true);
  });

  it("sees a change in each value prop independently of the others", () => {
    // Guards against an accidental `||` — every clause must be able to fail alone.
    const changed: Partial<MnkBoardProps>[] = [
      { state: AFTER_MOVE },
      { m: 4 },
      { n: 4 },
      { disabled: true },
      { lastCell: 0 },
      { size: "sm" },
      { winLine: [0, 1, 2] },
    ];
    for (const over of changed) {
      expect(arePropsEqual(props(over), props(over))).toBe(true); // equal to itself
      expect(arePropsEqual(props(), props(over))).toBe(false); // but not to the base
    }
  });
});
