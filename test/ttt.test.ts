import { describe, it, expect } from "vitest";
import { applyMove, legalDestinations } from "@/lib/ttt/validateMove";
import { completesLine, findWin, findWinLine } from "@/lib/ttt/win";
import { plyOf } from "@/lib/ttt/ply";
import { chooseMove, scoreWindows, type BotLevel } from "@/lib/ttt/bot";
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

// completesLine is the search's hot-path terminal test: it must agree with the
// full-board findWin on every board reachable by placing one more mark.
describe("completesLine", () => {
  it("sees a line through the cell just filled, from either end and the middle", () => {
    expect(completesLine("xxx......", 3, 3, 3, 0)).toBe(true);
    expect(completesLine("xxx......", 3, 3, 3, 1)).toBe(true);
    expect(completesLine("xxx......", 3, 3, 3, 2)).toBe(true);
    expect(completesLine("x...x...x", 3, 3, 3, 4)).toBe(true);
    expect(completesLine("..x.x.x..", 3, 3, 3, 4)).toBe(true);
  });
  it("is false for an empty cell and for a short run", () => {
    expect(completesLine(".........", 3, 3, 3, 4)).toBe(false);
    expect(completesLine("xx.......", 3, 3, 3, 1)).toBe(false);
  });
  it("does not wrap around a row edge", () => {
    // cols 2 and 3 are adjacent indices but on different rows.
    expect(completesLine("..xx.....", 3, 3, 3, 2)).toBe(false);
  });
  it("agrees with findWin on every one-mark-added board", () => {
    for (const v of VARIANTS) {
      const size = v.m * v.n;
      const rng = seeded(v.m * 1000 + v.n);
      for (let trial = 0; trial < 300; trial++) {
        // Random half-filled board with no line yet.
        let s = ".".repeat(size);
        for (let p = 0; p < Math.floor(size / 2); p++) {
          const empties = [...s].flatMap((ch, i) => (ch === "." ? [i] : []));
          const cell = empties[Math.floor(rng() * empties.length)];
          const next = s.slice(0, cell) + (p % 2 ? "o" : "x") + s.slice(cell + 1);
          if (findWin(next, v.m, v.n, v.k)) break;
          s = next;
        }
        if (findWin(s, v.m, v.n, v.k)) continue;
        for (let cell = 0; cell < size; cell++) {
          if (s[cell] !== ".") continue;
          for (const mark of ["x", "o"] as const) {
            const next = s.slice(0, cell) + mark + s.slice(cell + 1);
            expect(completesLine(next, v.m, v.n, v.k, cell)).toBe(
              findWin(next, v.m, v.n, v.k) === mark,
            );
          }
        }
      }
    }
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
    // Was 2000 ms — i.e. this suite used to accept two seconds of frozen main
    // thread. After L6 the same search is ~0.25 ms here; 300 ms leaves room for
    // a cold JIT and a loaded CI box while still failing loudly if the inner
    // loop regresses.
    expect(dt).toBeLessThan(300);
  });
  it("is responsive on the deepest search (4×4 impossible, depth 6)", () => {
    // The real worst case is NOT the biggest board: 4×4 "umulig" searches 6 ply
    // where 5×5 searches 4.
    const t0 = Date.now();
    const cell = chooseMove(variantStartState(V4), V4, "impossible");
    expect(cell).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(300);
  });
  it("covers all variants", () => {
    expect(VARIANTS.map((v) => v.id)).toEqual(["3x3", "4x4", "5x5"]);
    void V4;
  });
});

// The L6 rewrite of the inner loop (one-cell win test, precomputed centre-first
// order, incremental window score) is a pure speed change: every position must
// still get the exact move the pre-change implementation gave. EXPECTED_MOVES
// below was captured by running the OLD chooseMove over this corpus before the
// rewrite — do not regenerate it from the new code, or the test proves nothing.
describe("bot search regression (pre-L6 parity)", () => {
  const LEVELS: BotLevel[] = ["easy", "medium", "hard", "impossible"];

  /** Deterministic corpus: random legal positions at a spread of fill levels for
   * every variant, each asked at every level. */
  function corpus() {
    const out: { state: string; vi: number; level: BotLevel; seed: number }[] = [];
    for (let vi = 0; vi < VARIANTS.length; vi++) {
      const v = VARIANTS[vi];
      const size = v.m * v.n;
      for (let trial = 0; trial < 30; trial++) {
        const rng = seeded(trial * 7919 + vi * 104729 + 1);
        let s = ".".repeat(size);
        const plies = Math.min(size - 1, Math.floor(rng() * (size - 1)));
        let ok = true;
        for (let p = 0; p < plies; p++) {
          const empties = [...s].flatMap((ch, i) => (ch === "." ? [i] : []));
          if (empties.length === 0) { ok = false; break; }
          const cell = empties[Math.floor(rng() * empties.length)];
          s = s.slice(0, cell) + (p % 2 === 0 ? "x" : "o") + s.slice(cell + 1);
          if (findWin(s, v.m, v.n, v.k)) { ok = false; break; }
        }
        if (!ok) continue;
        for (let li = 0; li < LEVELS.length; li++) {
          out.push({ state: s, vi, level: LEVELS[li], seed: trial * 31 + li + 1 });
        }
      }
    }
    return out;
  }

  const EXPECTED_MOVES =
    "2,4,4,4,1,4,8,8,6,4,4,4,7,6,3,3,7,7,7,7,3,0,3,3,2,2,2,2,0,4,4,4,6,4,4,4,6,6,6,6,0,3," +
    "3,3,0,4,4,4,8,4,4,4,6,4,4,4,3,0,1,1,2,2,5,5,2,4,4,4,8,8,8,8,7,4,7,7,6,6,6,6,1,0,0,0," +
    "4,4,7,7,3,3,3,3,4,4,4,4,2,4,4,4,0,4,4,4,8,4,4,4,12,15,15,15,11,11,11,11,12,5,5,5,9,5" +
    ",5,5,7,10,10,9,4,10,10,5,0,6,13,5,12,0,9,3,12,5,5,11,6,0,0,0,3,3,1,5,0,11,11,9,11,9," +
    "6,6,14,7,7,7,7,0,0,0,2,2,2,2,15,5,5,6,13,5,10,6,10,10,9,10,7,12,12,12,3,10,5,5,1,15," +
    "14,5,14,9,9,9,11,1,9,9,5,1,5,5,3,0,0,0,8,6,6,6,3,12,12,12,24,3,3,3,15,8,8,8,16,6,6,6" +
    ",9,17,17,17,16,12,12,12,12,12,12,12,7,12,12,12,2,12,12,12,22,18,13,13,15,12,12,12,15" +
    ",11,11,11,11,12,12,12,3,6,6,6,24,17,17,17,21,13,13,13,1,12,12,12,21,12,12,12,17,12,1" +
    "2,12,13,19,12,12,6,12,12,18,1,17,7,16,21,12,12,12";

  it("picks the same move as the pre-L6 bot on 308 fixed positions", () => {
    const cases = corpus();
    const got = cases.map((c) =>
      chooseMove(c.state, VARIANTS[c.vi], c.level, seeded(c.seed)),
    );
    expect(got.length).toBe(308);
    expect(got.join(",")).toBe(EXPECTED_MOVES);
  });

  it("never returns an occupied or out-of-range cell", () => {
    for (const c of corpus()) {
      const cell = chooseMove(c.state, VARIANTS[c.vi], c.level, seeded(c.seed));
      if (cell === null) continue;
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(c.state.length);
      expect(c.state[cell]).toBe(".");
    }
  });

  // The search keeps the open-window score incrementally across make/unmake; if
  // that bookkeeping ever drifted from a from-scratch count the heuristic would
  // silently start scoring the wrong positions. scoreWindows is the from-scratch
  // side, pinned here against a naive re-implementation.
  it("scoreWindows matches a naive window sweep", () => {
    const naive = (board: string, m: number, n: number, k: number) => {
      const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      let x = 0;
      let o = 0;
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < n; c++) {
          for (const [dr, dc] of dirs) {
            if (r + dr * (k - 1) >= m || r + dr * (k - 1) < 0) continue;
            if (c + dc * (k - 1) >= n || c + dc * (k - 1) < 0) continue;
            let cx = 0;
            let co = 0;
            for (let s = 0; s < k; s++) {
              const ch = board[(r + dr * s) * n + (c + dc * s)];
              if (ch === "x") cx++;
              else if (ch === "o") co++;
            }
            if (co === 0 && cx > 0) x += cx * cx;
            if (cx === 0 && co > 0) o += co * co;
          }
        }
      }
      return { x, o };
    };
    for (const v of VARIANTS) {
      const rng = seeded(v.m * 31 + v.n);
      for (let trial = 0; trial < 200; trial++) {
        const board = Array.from({ length: v.m * v.n }, () => {
          const r = rng();
          return r < 0.4 ? "." : r < 0.7 ? "x" : "o";
        }).join("");
        expect(scoreWindows(board, v)).toEqual(naive(board, v.m, v.n, v.k));
      }
    }
  });
});
