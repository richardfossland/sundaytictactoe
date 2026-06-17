import { describe, it, expect } from "vitest";
import { applyMove, legalDestinations } from "@/lib/ttt/validateMove";
import { findWin, findWinLine } from "@/lib/ttt/win";
import { plyOf } from "@/lib/ttt/ply";
import { chooseMove } from "@/lib/ttt/bot";
import { variantById, variantStartState, VARIANTS } from "@/lib/ttt/variants";
import { turnFromState } from "@/lib/ttt/state";

const V3 = variantById("3x3");
const V4 = variantById("4x4");
const V5 = variantById("5x5");

describe("win detection", () => {
  it("finds a horizontal 3-in-a-row", () => {
    expect(findWin("xxx......", 3, 3, 3)).toBe("x");
    const line = findWinLine("xxx......", 3, 3, 3);
    expect(line?.cells).toEqual([0, 1, 2]);
  });
  it("finds a vertical line", () => {
    expect(findWin("o..o..o..", 3, 3, 3)).toBe("o");
  });
  it("finds the main diagonal", () => {
    expect(findWin("x...x...x", 3, 3, 3)).toBe("x");
  });
  it("finds the anti-diagonal", () => {
    expect(findWin("..x.x.x..", 3, 3, 3)).toBe("x");
  });
  it("no false positive across a row wrap", () => {
    // x at cols 2,3-wrap would be index 2 and 3; not a real horizontal line
    expect(findWin("..xx.....", 3, 3, 3)).toBeNull();
  });
  it("4-in-a-row on a 5×5 board", () => {
    const b = ".".repeat(25).split("");
    b[6] = "x"; b[7] = "x"; b[8] = "x"; b[9] = "x"; // row 1, cols 1-4
    expect(findWin(b.join(""), 5, 5, 4)).toBe("x");
  });
});

describe("applyMove", () => {
  it("places the right mark and flips the turn", () => {
    const r = applyMove(variantStartState(V3), { cell: 4 }, "", V3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fen).toBe("....x....");
    expect(r.turn).toBe("b");
    expect(r.san).toBe("4");
    expect(r.status).toBe("live");
  });
  it("appends to the pgn move list", () => {
    const r = applyMove("....x....", { cell: 0 }, "4", V3);
    expect(r.ok && r.pgn).toBe("4 0");
  });
  it("rejects an occupied cell", () => {
    const r = applyMove("....x....", { cell: 4 }, "4", V3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("illegal");
  });
  it("rejects out-of-range", () => {
    const r = applyMove(variantStartState(V3), { cell: 9 }, "", V3);
    expect(!r.ok && r.reason).toBe("illegal");
  });
  it("rejects a bad board length", () => {
    const r = applyMove("....", { cell: 0 }, "", V3);
    expect(!r.ok && r.reason).toBe("bad_fen");
  });
  it("detects a win → white_win", () => {
    const r = applyMove("xx.oo....", { cell: 2 }, "0 3 1 4", V3);
    expect(r.ok && r.status).toBe("white_win");
    expect(r.ok && r.endReason).toBe("k_in_row");
  });
  it("detects a full-board draw", () => {
    // x o x / x o o / o x .  → X plays the last cell (8); no line forms.
    const r = applyMove("xoxxooox.", { cell: 8 }, "", V3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("draw");
    expect(r.endReason).toBe("board_full");
  });
  it("rejects moves after game over", () => {
    const r = applyMove("xxxoo....", { cell: 5 }, "", V3);
    expect(!r.ok && r.reason).toBe("game_over");
  });
});

describe("legalDestinations & ply", () => {
  it("returns empty cells", () => {
    expect(legalDestinations("x...o....")).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });
  it("plyOf counts filled cells", () => {
    expect(plyOf("x...o....")).toBe(2);
    expect(plyOf(".........")).toBe(0);
  });
  it("turnFromState alternates", () => {
    expect(turnFromState(".........")).toBe("w");
    expect(turnFromState("x........")).toBe("b");
    expect(turnFromState("xo.......")).toBe("w");
  });
});

// Deterministic rng for reproducible bot tests.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe("bot", () => {
  it("takes an immediate winning move (3×3)", () => {
    // x at 0,1; cell 2 wins for x
    expect(chooseMove("xx.oo....", V3, "impossible")).toBe(2);
  });
  it("blocks an immediate opponent win (3×3)", () => {
    // o to move; x threatens 0,1 -> must block at 2
    expect(chooseMove("xx..o....", V3, "impossible")).toBe(2);
  });
  it("perfect vs perfect on 3×3 is always a draw", () => {
    let state = variantStartState(V3);
    let guard = 0;
    while (guard++ < 9) {
      const win = findWin(state, 3, 3, 3);
      if (win) throw new Error(`perfect play produced a win: ${state}`);
      const cell = chooseMove(state, V3, "impossible");
      if (cell === null) break;
      const r = applyMove(state, { cell }, "", V3);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      state = r.fen;
    }
    expect(findWin(state, 3, 3, 3)).toBeNull();
  });
  it("impossible never loses on 3×3 against a random opponent", () => {
    for (let trial = 0; trial < 40; trial++) {
      const rng = seeded(trial + 1);
      let state = variantStartState(V3);
      // bot is O (second). random plays X (first).
      let turn: "x" | "o" = "x";
      let guard = 0;
      while (guard++ < 9) {
        if (findWin(state, 3, 3, 3) || legalDestinations(state).length === 0) break;
        let cell: number | null;
        if (turn === "x") {
          const empties = legalDestinations(state);
          cell = empties[Math.floor(rng() * empties.length)];
        } else {
          cell = chooseMove(state, V3, "impossible", rng);
        }
        if (cell === null) break;
        const r = applyMove(state, { cell }, "", V3);
        if (!r.ok) break;
        state = r.fen;
        turn = turn === "x" ? "o" : "x";
      }
      // X (random) must never win.
      expect(findWin(state, 3, 3, 3)).not.toBe("x");
    }
  });
  it("easy makes mistakes (does not always block)", () => {
    // With the seeded rng, easy should at least sometimes fail to block.
    let failedToBlock = 0;
    for (let trial = 0; trial < 50; trial++) {
      const rng = seeded(trial + 100);
      // o to move, x threatens at 2 (0,1 filled)
      const cell = chooseMove("xx..o....", V3, "easy", rng);
      if (cell !== 2) failedToBlock++;
    }
    expect(failedToBlock).toBeGreaterThan(0);
  });
  it("is responsive on the largest board", () => {
    const state = variantStartState(V5);
    const t0 = Date.now();
    const cell = chooseMove(state, V5, "impossible");
    const dt = Date.now() - t0;
    expect(cell).not.toBeNull();
    expect(dt).toBeLessThan(2000);
  });
  it("covers all variants", () => {
    expect(VARIANTS.map((v) => v.id)).toEqual(["3x3", "4x4", "5x5"]);
    void V4;
  });
});
