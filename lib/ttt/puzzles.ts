// One-move puzzle pack for waiting players — the m,n,k answer to the chess
// app's mate-in-1 pack (sundaychess lib/puzzles.ts).
//
// Two kinds, both solved by a SINGLE tap:
//   "win"   — the side to move has exactly one cell that completes k in a row.
//   "block" — the side to move has NO immediate win, and the opponent has
//             exactly one cell that would complete k in a row: take it.
//
// Every position here is verified by test/ttt/puzzles.test.ts against the real
// engine (lib/ttt/win.ts), and the verification is deliberately strict:
//
//   * the board is legal for its variant (right length, right characters, mark
//     counts consistent with `toMove`, and no line already on the board), so a
//     puzzle can never show a position that could not occur in a game;
//   * the solution cell does what `kind` claims;
//   * NO OTHER empty cell does — the answer is unique. That is what lets the
//     card grade a tap by comparing cell indices instead of re-deciding the
//     position, and what stops "you were right too" false negatives.
//
// A broken position therefore cannot ship: the pack is data, and the test is
// the engine's own opinion of that data.

import type { Mark } from "@/lib/ttt/state";

export type PuzzleKind = "win" | "block";

export interface TttPuzzle {
  id: string;
  /** board string for the variant: m*n chars of '.'/'x'/'o', row-major */
  board: string;
  /** which board this position belongs on (see lib/ttt/variants.ts) */
  variantId: string;
  /** the side the solver plays */
  toMove: Mark;
  /** the cell(s) that solve it. Unique in the shipped pack — the array is for
   * a future puzzle with genuinely interchangeable answers. */
  solution: number[];
  kind: PuzzleKind;
}

/** Positions harvested from random legal play, then filtered to the ones with
 * exactly one right answer and re-verified by the test suite. Eight per
 * variant: four "win", four "block", each set spanning a row, a column and a
 * diagonal, plus one with ◯ to move so the pack is not all-✕. */
export const PUZZLES: TttPuzzle[] = [
  // ---------------------------------------------------------------- 3×3 (k=3)
  { id: "3x3-win-col", board: "...oxo.x.", variantId: "3x3", toMove: "x", solution: [1], kind: "win" },
  { id: "3x3-win-row", board: ".o..xx.o.", variantId: "3x3", toMove: "x", solution: [3], kind: "win" },
  { id: "3x3-win-diag", board: "....xo.ox", variantId: "3x3", toMove: "x", solution: [0], kind: "win" },
  { id: "3x3-win-o-col", board: "...oxxox.", variantId: "3x3", toMove: "o", solution: [0], kind: "win" },
  { id: "3x3-block-col", board: "...xox.o.", variantId: "3x3", toMove: "x", solution: [1], kind: "block" },
  { id: "3x3-block-row", board: ".x..oo.x.", variantId: "3x3", toMove: "x", solution: [3], kind: "block" },
  { id: "3x3-block-diag", board: "....ox.xo", variantId: "3x3", toMove: "x", solution: [0], kind: "block" },
  { id: "3x3-block-o-col", board: "....xo.x.", variantId: "3x3", toMove: "o", solution: [1], kind: "block" },

  // ---------------------------------------------------------------- 4×4 (k=4)
  { id: "4x4-win-row", board: ".....oooxxx.....", variantId: "4x4", toMove: "x", solution: [11], kind: "win" },
  { id: "4x4-win-col", board: ".....ox..oxo..x.", variantId: "4x4", toMove: "x", solution: [2], kind: "win" },
  { id: "4x4-win-diag", board: ".....ox..xo.x.o.", variantId: "4x4", toMove: "x", solution: [3], kind: "win" },
  { id: "4x4-win-o-row", board: ".....oooxxx..x..", variantId: "4x4", toMove: "o", solution: [4], kind: "win" },
  { id: "4x4-block-row", board: ".....ooo.xx...x.", variantId: "4x4", toMove: "x", solution: [4], kind: "block" },
  { id: "4x4-block-col", board: ".....ox..oxx.o..", variantId: "4x4", toMove: "x", solution: [1], kind: "block" },
  { id: "4x4-block-diag", board: ".....ox..xo..x.o", variantId: "4x4", toMove: "x", solution: [0], kind: "block" },
  { id: "4x4-block-o-row", board: ".....oo.xxx.....", variantId: "4x4", toMove: "o", solution: [11], kind: "block" },

  // ---------------------------------------------------------------- 5×5 (k=4)
  { id: "5x5-win-row", board: ".......o...x.xx..oo......", variantId: "5x5", toMove: "x", solution: [12], kind: "win" },
  { id: "5x5-win-col", board: ".......x....xo.o.x....o..", variantId: "5x5", toMove: "x", solution: [2], kind: "win" },
  { id: "5x5-win-diag", board: "...........oxo...ox.....x", variantId: "5x5", toMove: "x", solution: [6], kind: "win" },
  { id: "5x5-win-o-row", board: "......xx...oo.o..xx......", variantId: "5x5", toMove: "o", solution: [13], kind: "win" },
  { id: "5x5-block-row", board: ".......x..xooo....x......", variantId: "5x5", toMove: "x", solution: [14], kind: "block" },
  { id: "5x5-block-col", board: ".......o....oxx.x.....o..", variantId: "5x5", toMove: "x", solution: [17], kind: "block" },
  { id: "5x5-block-diag", board: ".......ox..ox..o.x.......", variantId: "5x5", toMove: "x", solution: [3], kind: "block" },
  { id: "5x5-block-o-row", board: "..........oxxx...o.......", variantId: "5x5", toMove: "o", solution: [14], kind: "block" },
];

/** The mark the puzzle is played AGAINST — the one being blocked in a "block"
 * puzzle, and the one that loses the race in a "win" puzzle. */
export function opponentOf(p: TttPuzzle): Mark {
  return p.toMove === "x" ? "o" : "x";
}

/** The pack for one board size. Falls back to the WHOLE pack for an unknown or
 * missing variant id, so a card always has something to show — the same
 * degrade-don't-throw rule variantById follows. */
export function puzzlesForVariant(variantId: string | undefined): TttPuzzle[] {
  const hits = PUZZLES.filter((p) => p.variantId === variantId);
  return hits.length > 0 ? hits : PUZZLES;
}

/** Grade a tap. Cell comparison is sound because the pack's answers are unique
 * (enforced by test/ttt/puzzles.test.ts). */
export function isSolution(p: TttPuzzle, cell: number): boolean {
  return p.solution.includes(cell);
}
