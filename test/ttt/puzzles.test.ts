// The puzzle pack is DATA; this file is the engine's opinion of it. Nothing in
// lib/ttt/puzzles.ts is trusted here — every claim a puzzle makes about itself
// (which board it belongs on, whose move it is, what the answer is, that the
// answer is the ONLY one) is re-derived from lib/ttt/win.ts and lib/ttt/state.ts.
//
// The uniqueness half is the load-bearing one: PuzzleCard grades a tap by
// comparing cell indices, which is only honest if no other cell would have done
// the job. A second right answer would show a child a red ✗ for a correct move.

import { describe, expect, it } from "vitest";
import { PUZZLES, opponentOf, puzzlesForVariant, type TttPuzzle } from "@/lib/ttt/puzzles";
import { variantById, VARIANTS, type MnkVariant } from "@/lib/ttt/variants";
import { completesLine, findWin } from "@/lib/ttt/win";
import { isValidState, turnFromState, markFor } from "@/lib/ttt/state";

/** Every empty cell on which `mark` would complete k in a row. */
function winningCells(board: string, v: MnkVariant, mark: string): number[] {
  const b = board.split("");
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== ".") continue;
    b[i] = mark;
    if (completesLine(b, v.m, v.n, v.k, i)) out.push(i);
    b[i] = ".";
  }
  return out;
}

function counts(board: string): { x: number; o: number } {
  let x = 0;
  let o = 0;
  for (const ch of board) {
    if (ch === "x") x++;
    else if (ch === "o") o++;
  }
  return { x, o };
}

describe("puzzle pack", () => {
  it("has unique ids", () => {
    const ids = PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every shipped variant", () => {
    for (const v of VARIANTS) {
      expect(
        PUZZLES.filter((p) => p.variantId === v.id).length,
        `no puzzles for ${v.id}`,
      ).toBeGreaterThan(0);
    }
  });

  it("has both kinds on every variant", () => {
    for (const v of VARIANTS) {
      const mine = PUZZLES.filter((p) => p.variantId === v.id);
      expect(mine.some((p) => p.kind === "win"), `${v.id}: no win puzzle`).toBe(true);
      expect(mine.some((p) => p.kind === "block"), `${v.id}: no block puzzle`).toBe(true);
    }
  });

  for (const p of PUZZLES as TttPuzzle[]) {
    describe(p.id, () => {
      // A variantId nobody knows would silently degrade to 3×3 in variantById
      // and then "pass" every geometric check below against the wrong board.
      const known = VARIANTS.some((v) => v.id === p.variantId);
      const v = variantById(p.variantId);

      it("names a real variant and a legal position", () => {
        expect(known, `${p.variantId} is not a shipped variant`).toBe(true);
        expect(isValidState(p.board, v.m * v.n)).toBe(true);
        // A position with a line already on it is over — nothing to solve.
        expect(findWin(p.board, v.m, v.n, v.k)).toBeNull();
      });

      it("is consistent about whose move it is", () => {
        const { x, o } = counts(p.board);
        // X opens, so either the marks are level (X to move) or X is one ahead.
        expect(x - o === 0 || x - o === 1, `x=${x} o=${o}`).toBe(true);
        expect(markFor(turnFromState(p.board))).toBe(p.toMove);
      });

      it("has a solution on an empty cell", () => {
        expect(p.solution.length).toBeGreaterThan(0);
        for (const cell of p.solution) {
          expect(Number.isInteger(cell)).toBe(true);
          expect(cell).toBeGreaterThanOrEqual(0);
          expect(cell).toBeLessThan(v.m * v.n);
          expect(p.board[cell]).toBe(".");
        }
      });

      if (p.kind === "win") {
        it("the solution wins, and no other cell does", () => {
          expect(winningCells(p.board, v, p.toMove).sort((a, b) => a - b)).toEqual(
            [...p.solution].sort((a, b) => a - b),
          );
        });
      } else {
        it("has no win of its own to take instead", () => {
          // Otherwise "block!" would be the wrong lesson: you'd just win.
          expect(winningCells(p.board, v, p.toMove)).toEqual([]);
        });

        it("blocks the opponent's ONLY winning cell", () => {
          expect(winningCells(p.board, v, opponentOf(p)).sort((a, b) => a - b)).toEqual(
            [...p.solution].sort((a, b) => a - b),
          );
        });

        it("actually removes the threat", () => {
          const opp = opponentOf(p);
          for (const cell of p.solution) {
            const after = p.board.slice(0, cell) + p.toMove + p.board.slice(cell + 1);
            expect(winningCells(after, v, opp)).toEqual([]);
          }
        });
      }
    });
  }
});

describe("puzzlesForVariant", () => {
  it("returns only that variant's puzzles", () => {
    for (const v of VARIANTS) {
      const hits = puzzlesForVariant(v.id);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((p) => p.variantId === v.id)).toBe(true);
    }
  });

  it("falls back to the whole pack for an unknown or missing id", () => {
    expect(puzzlesForVariant("9x9")).toEqual(PUZZLES);
    expect(puzzlesForVariant(undefined)).toEqual(PUZZLES);
  });
});
