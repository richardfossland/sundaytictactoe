// Tic-tac-toe bot: negamax + alpha-beta with difficulty levels. Perfect (and
// instant) on 3×3; depth-limited with a window heuristic on the larger boards
// where a full search is too big.
//
// Pure + rng-injectable (no Date/Math.random captured at module scope) so the
// "easy makes mistakes at rate X" behaviour is unit-testable.
//
// The search itself runs off the main thread in the browser — see
// lib/ttt/bot.worker.ts and lib/client/engine.ts. This module stays pure and
// DOM-free precisely so it can be imported from either side.
//
// PERFORMANCE (L6). The search semantics are unchanged — same nodes, same
// ordering, same scores, same move for a given position — but the per-node
// constant factor was cut by keeping the hot loop allocation-free:
//   • terminal test: `completesLine` through the one cell just played (O(8k))
//     instead of `findWin`'s full-board rescan (O(m·n·k)) of a freshly joined
//     string. Sound because a node differs from its parent by one mark.
//   • move order: the centre-first cell order is computed ONCE per variant and
//     the empty cells are read off it, instead of `[...empties].sort()` per node.
//   • the leaf heuristic walks a precomputed list of k-windows once, scoring
//     BOTH sides in that single pass, rather than sweeping the board twice.
//   • no `board.join("")`, no per-node empties array, no per-node result object:
//     the board is one mutable char array threaded through the recursion.

import { emptyCells, markFor, otherMark, turnFromState, type Mark } from "@/lib/ttt/state";
import { completesLine, findWin } from "@/lib/ttt/win";
import { DEFAULT_VARIANT, type MnkVariant } from "@/lib/ttt/variants";

export type BotLevel = "easy" | "medium" | "hard" | "impossible";

const WIN = 1_000_000;

/** Search depth cap by level and board size. 3×3 is searched in full (perfect
 * play); larger boards are bounded so the bot stays snappy. */
function maxDepth(level: BotLevel, v: MnkVariant): number {
  const size = v.m * v.n;
  if (level === "medium") return 2;
  if (level === "hard") return size <= 9 ? 9 : size <= 16 ? 4 : 3;
  // impossible
  return size <= 9 ? 9 : size <= 16 ? 6 : 4;
}

// ---------------------------------------------------------------- variant tables

interface VariantTables {
  /** every cell index, centre-first; ties broken by ascending index */
  order: number[];
  /** every k-window on the board, flattened: k cell indices per window */
  windows: Int32Array;
  /** number of k-windows on this board */
  windowCount: number;
  /** windows touching each cell, CSR-style: the windows of cell `c` are
   * cellWindows[cellStart[c] … cellStart[c + 1]) */
  cellWindows: Int32Array;
  cellStart: Int32Array;
  k: number;
}

const RAY_DR = [0, 1, 1, 1];
const RAY_DC = [1, 0, 1, -1];

// Variants are module constants, but a caller may hand us an equivalent literal,
// so key by shape rather than identity.
const tableCache = new Map<string, VariantTables>();

/** Build (once per board shape) the two tables the search reads on every node. */
function tablesFor(v: MnkVariant): VariantTables {
  const key = `${v.m}x${v.n}x${v.k}`;
  const hit = tableCache.get(key);
  if (hit) return hit;

  const { m, n, k } = v;
  const size = m * n;

  // Centre-first order. Stronger first moves improve alpha-beta pruning and make
  // the bot play natural-looking openings. The `|| a - b` tie-break reproduces
  // exactly what sorting the ascending-index empty list used to give.
  const cr = (m - 1) / 2;
  const cc = (n - 1) / 2;
  const distOf = (cell: number) =>
    Math.abs(((cell / n) | 0) - cr) + Math.abs((cell % n) - cc);
  const order = Array.from({ length: size }, (_, i) => i);
  order.sort((a, b) => distOf(a) - distOf(b) || a - b);

  // Every length-k segment that fits on the board, in the same order the old
  // double loop visited them (row, col, then ray).
  const windows: number[] = [];
  const byCell: number[][] = Array.from({ length: size }, () => []);
  let windowCount = 0;
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      for (let d = 0; d < 4; d++) {
        const dr = RAY_DR[d];
        const dc = RAY_DC[d];
        const endR = r + dr * (k - 1);
        const endC = c + dc * (k - 1);
        if (endR < 0 || endR >= m || endC < 0 || endC >= n) continue;
        for (let s = 0; s < k; s++) {
          const cell = (r + dr * s) * n + (c + dc * s);
          windows.push(cell);
          byCell[cell].push(windowCount);
        }
        windowCount++;
      }
    }
  }

  // Invert to CSR so a move can find its windows without allocating.
  const cellStart = new Int32Array(size + 1);
  for (let c = 0; c < size; c++) cellStart[c + 1] = cellStart[c] + byCell[c].length;
  const cellWindows = new Int32Array(cellStart[size]);
  for (let c = 0, at = 0; c < size; c++) for (const w of byCell[c]) cellWindows[at++] = w;

  const tables: VariantTables = {
    order,
    windows: Int32Array.from(windows),
    windowCount,
    cellWindows,
    cellStart,
    k,
  };
  tableCache.set(key, tables);
  return tables;
}

// ------------------------------------------------------------ window scoring
//
// The heuristic (used at a depth cutoff) counts open k-windows — segments with
// no opponent mark — weighted by how many of my marks they already hold, so the
// bot builds threats and blocks the opponent's. A window is open for at most
// one side, so each contributes to exactly one of the two running totals.
//
// The search keeps those totals INCREMENTALLY: a move changes only the windows
// running through the cell it filled (~2.5 of 10 on 4×4, ~4.5 of 28 on 5×5), so
// make/unmake pays a handful of updates and the leaf eval becomes O(1) instead
// of re-sweeping every window. `scoreWindows` below is the same computation done
// from scratch — the test suite pins the incremental totals against it.

function openScore(mine: number, theirs: number): number {
  return theirs === 0 && mine > 0 ? mine * mine : 0;
}

/** Full recomputation of (x total, o total). Used to seed a search from the root
 * board, and as the reference the incremental updates must keep matching. */
export function scoreWindows(
  board: ArrayLike<string>,
  v: MnkVariant,
): { x: number; o: number } {
  const { windows, k } = tablesFor(v);
  let x = 0;
  let o = 0;
  for (let w = 0; w < windows.length; w += k) {
    let cx = 0;
    let co = 0;
    for (let s = 0; s < k; s++) {
      const ch = board[windows[w + s]];
      if (ch === "x") cx++;
      else if (ch === "o") co++;
    }
    x += openScore(cx, co);
    o += openScore(co, cx);
  }
  return { x, o };
}

// ---------------------------------------------------------------- search

interface SearchCtx {
  /** mutable board, mutated and restored in place — never copied */
  board: string[];
  v: MnkVariant;
  t: VariantTables;
  cap: number;
  /** board.length — the draw test, kept off the variant so an odd-length board
   * behaves the way the old `empties.length === 0` check did */
  size: number;
  /** marks already on the board at the root; filled at depth d is this + d */
  filled0: number;
  /** best move found at the root (only the root's is ever used) */
  rootMove: number | null;
  /** false when the depth cap can never be reached before the board fills (a
   * full search, e.g. 3×3) — then the heuristic is unreachable and the window
   * bookkeeping below would be pure overhead */
  tracking: boolean;
  /** per-window mark counts, and the running open-window totals they imply */
  cntX: Int8Array;
  cntO: Int8Array;
  scoreX: number;
  scoreO: number;
}

/** Fold a mark on/off `cell` into the per-window counts and running totals.
 * `delta` is +1 when placing the mark and -1 when taking it back. */
function updateWindows(ctx: SearchCtx, cell: number, mark: Mark, delta: number): void {
  const { cellWindows, cellStart } = ctx.t;
  const { cntX, cntO } = ctx;
  const isX = mark === "x";
  const end = cellStart[cell + 1];
  for (let i = cellStart[cell]; i < end; i++) {
    const w = cellWindows[i];
    const cx = cntX[w];
    const co = cntO[w];
    ctx.scoreX -= openScore(cx, co);
    ctx.scoreO -= openScore(co, cx);
    const nx = isX ? cx + delta : cx;
    const no = isX ? co : co + delta;
    cntX[w] = nx;
    cntO[w] = no;
    ctx.scoreX += openScore(nx, no);
    ctx.scoreO += openScore(no, nx);
  }
}

/** Negamax with alpha-beta. Returns the score for `toMove`; the root's chosen
 * cell is left in `ctx.rootMove`. `lastCell` is the cell the OPPONENT just
 * played (-1 at the root, whose board is known to be unfinished). */
function negamax(
  ctx: SearchCtx,
  toMove: Mark,
  depth: number,
  lastCell: number,
  alpha: number,
  beta: number,
): number {
  const { board, v, t } = ctx;
  const filled = ctx.filled0 + depth;

  // A win on the board belongs to the side that JUST moved (the opponent of
  // toMove) → a loss for toMove. Prefer losing later: more filled cells = a
  // later loss = less bad.
  if (lastCell >= 0 && completesLine(board, v.m, v.n, v.k, lastCell)) {
    return -(WIN - filled);
  }
  if (filled >= ctx.size) return 0; // draw — no empty cell left
  if (depth >= ctx.cap) {
    return toMove === "x" ? ctx.scoreX - ctx.scoreO : ctx.scoreO - ctx.scoreX;
  }

  const order = t.order;
  const next = otherMark(toMove);
  const tracking = ctx.tracking;
  let best = -Infinity;
  for (let i = 0; i < order.length; i++) {
    const cell = order[i];
    if (board[cell] !== ".") continue;
    board[cell] = toMove;
    if (tracking) updateWindows(ctx, cell, toMove, 1);
    const sc = -negamax(ctx, next, depth + 1, cell, -beta, -alpha);
    if (tracking) updateWindows(ctx, cell, toMove, -1);
    board[cell] = ".";
    if (sc > best) {
      best = sc;
      if (depth === 0) ctx.rootMove = cell;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // prune
  }
  return best;
}

/** Per-window mark counts for the root board — the starting point the search's
 * incremental updates carry forward. Empty when the search won't need them. */
function countWindowMarks(
  board: ArrayLike<string>,
  t: VariantTables,
  tracking: boolean,
): { x: Int8Array; o: Int8Array } {
  const x = new Int8Array(tracking ? t.windowCount : 0);
  const o = new Int8Array(x.length);
  if (!tracking) return { x, o };
  const { windows, k } = t;
  for (let w = 0, wi = 0; w < windows.length; w += k, wi++) {
    for (let s = 0; s < k; s++) {
      const ch = board[windows[w + s]];
      if (ch === "x") x[wi]++;
      else if (ch === "o") o[wi]++;
    }
  }
  return { x, o };
}

/** Place `mark` on each empty cell; return the cell that immediately wins, else
 * null. Mutates `board` in place and restores it. */
function immediateWin(board: string[], v: MnkVariant, mark: Mark): number | null {
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== ".") continue;
    board[i] = mark;
    const won = completesLine(board, v.m, v.n, v.k, i);
    board[i] = ".";
    if (won) return i;
  }
  return null;
}

/** Choose the bot's move on `state`. Returns a cell index, or null if the board
 * is full / already won. `rng` is injectable for deterministic tests. */
export function chooseMove(
  state: string,
  variant: MnkVariant = DEFAULT_VARIANT,
  level: BotLevel = "impossible",
  rng: () => number = Math.random,
): number | null {
  const empties = emptyCells(state);
  if (empties.length === 0) return null;
  // Establishes the precondition completesLine needs everywhere below: nothing
  // on this board is a win yet, so any line found later was made by the last mark.
  if (findWin(state, variant.m, variant.n, variant.k)) return null;

  const me = markFor(turnFromState(state));
  const opp = otherMark(me);
  const board = state.split("");
  const pick = (cells: number[]) => cells[Math.floor(rng() * cells.length)];

  if (level === "easy") {
    // Deliberately weak: most of the time a random move; otherwise only the most
    // basic sense (take a win, block an obvious loss). Loses often, on purpose.
    if (rng() < 0.6) return pick(empties);
    return (
      immediateWin(board, variant, me) ??
      immediateWin(board, variant, opp) ??
      pick(empties)
    );
  }

  // Always grab an immediate win and block an immediate loss before searching —
  // cheap, and guarantees no blunders at these obvious moments.
  const win = immediateWin(board, variant, me);
  if (win !== null) return win;
  const block = immediateWin(board, variant, opp);
  if (block !== null) return block;

  if (level === "medium" && rng() < 0.2) return pick(empties);

  const t = tablesFor(variant);
  const cap = maxDepth(level, variant);
  const filled0 = state.length - empties.length;
  // The heuristic can only fire if the cap is reached before the board fills;
  // when it can't (3×3 searched in full) skip the window bookkeeping entirely.
  const tracking = cap < board.length - filled0;
  const seed = tracking ? scoreWindows(board, variant) : { x: 0, o: 0 };
  const counts = countWindowMarks(board, t, tracking);

  const ctx: SearchCtx = {
    board,
    v: variant,
    t,
    cap,
    size: board.length,
    filled0,
    rootMove: null,
    tracking,
    cntX: counts.x,
    cntO: counts.o,
    scoreX: seed.x,
    scoreO: seed.o,
  };
  negamax(ctx, me, 0, -1, -Infinity, Infinity);
  return ctx.rootMove ?? pick(empties);
}
