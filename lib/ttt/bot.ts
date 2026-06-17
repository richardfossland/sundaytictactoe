// Tic-tac-toe bot: negamax + alpha-beta with difficulty levels. Perfect (and
// instant) on 3×3; depth-limited with a window heuristic on the larger boards
// where a full search is too big. Runs on the main thread — even the deepest
// search here is microseconds-to-milliseconds, so no Web Worker is needed.
//
// Pure + rng-injectable (no Date/Math.random captured at module scope) so the
// "easy makes mistakes at rate X" behaviour is unit-testable.

import { emptyCells, markFor, otherMark, turnFromState, type Mark } from "@/lib/ttt/state";
import { findWin } from "@/lib/ttt/win";
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

/** Order moves centre-first: stronger first moves improve alpha-beta pruning and
 * make the bot play natural-looking openings. */
function orderMoves(cells: number[], v: MnkVariant): number[] {
  const cr = (v.m - 1) / 2;
  const cc = (v.n - 1) / 2;
  return [...cells].sort((a, b) => {
    const da = dist(a, v, cr, cc);
    const db = dist(b, v, cr, cc);
    return da - db;
  });
}

function dist(cell: number, v: MnkVariant, cr: number, cc: number): number {
  const r = Math.floor(cell / v.n);
  const c = cell % v.n;
  return Math.abs(r - cr) + Math.abs(c - cc);
}

/** Heuristic eval (non-terminal cutoff), from `me`'s perspective. Counts open
 * k-windows (segments with no opponent mark) weighted by how many of my marks
 * they already hold — so the bot builds threats and blocks the opponent's. */
function heuristic(board: string, v: MnkVariant, me: Mark): number {
  return windowScore(board, v, me) - windowScore(board, v, otherMark(me));
}

const RAYS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function windowScore(board: string, v: MnkVariant, mark: Mark): number {
  const { m, n, k } = v;
  const opp = otherMark(mark);
  let score = 0;
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      for (const [dr, dc] of RAYS) {
        const endR = r + dr * (k - 1);
        const endC = c + dc * (k - 1);
        if (endR < 0 || endR >= m || endC < 0 || endC >= n) continue;
        let mine = 0;
        let blocked = false;
        for (let s = 0; s < k; s++) {
          const ch = board[(r + dr * s) * n + (c + dc * s)];
          if (ch === opp) {
            blocked = true;
            break;
          }
          if (ch === mark) mine++;
        }
        if (!blocked && mine > 0) score += mine * mine;
      }
    }
  }
  return score;
}

interface SearchResult {
  score: number;
  move: number | null;
}

function negamax(
  board: string[],
  v: MnkVariant,
  toMove: Mark,
  depth: number,
  cap: number,
  alpha: number,
  beta: number,
): SearchResult {
  const joined = board.join("");
  // A win on the board belongs to the side that JUST moved (the opponent of
  // toMove) → a loss for toMove. Prefer losing later: more filled cells = a
  // later loss = less bad.
  if (findWin(joined, v.m, v.n, v.k)) {
    let filled = 0;
    for (const ch of board) if (ch !== ".") filled++;
    return { score: -(WIN - filled), move: null };
  }
  const empties: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === ".") empties.push(i);
  if (empties.length === 0) return { score: 0, move: null }; // draw
  if (depth >= cap) return { score: heuristic(joined, v, toMove), move: null };

  let best = -Infinity;
  let bestMove: number | null = empties[0];
  for (const cell of orderMoves(empties, v)) {
    board[cell] = toMove;
    const child = negamax(board, v, otherMark(toMove), depth + 1, cap, -beta, -alpha);
    board[cell] = ".";
    const sc = -child.score;
    if (sc > best) {
      best = sc;
      bestMove = cell;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // prune
  }
  return { score: best, move: bestMove };
}

/** Place `mark` on each empty cell; return the cell that immediately wins, else null. */
function immediateWin(board: string, v: MnkVariant, mark: Mark): number | null {
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== ".") continue;
    const next = board.slice(0, i) + mark + board.slice(i + 1);
    if (findWin(next, v.m, v.n, v.k) === mark) return i;
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
  if (findWin(state, variant.m, variant.n, variant.k)) return null;

  const me = markFor(turnFromState(state));
  const opp = otherMark(me);
  const pick = (cells: number[]) => cells[Math.floor(rng() * cells.length)];

  if (level === "easy") {
    // Deliberately weak: most of the time a random move; otherwise only the most
    // basic sense (take a win, block an obvious loss). Loses often, on purpose.
    if (rng() < 0.6) return pick(empties);
    return (
      immediateWin(state, variant, me) ??
      immediateWin(state, variant, opp) ??
      pick(empties)
    );
  }

  // Always grab an immediate win and block an immediate loss before searching —
  // cheap, and guarantees no blunders at these obvious moments.
  const win = immediateWin(state, variant, me);
  if (win !== null) return win;
  const block = immediateWin(state, variant, opp);
  if (block !== null) return block;

  if (level === "medium" && rng() < 0.2) return pick(empties);

  const res = negamax(
    state.split(""),
    variant,
    me,
    0,
    maxDepth(level, variant),
    -Infinity,
    Infinity,
  );
  return res.move ?? pick(empties);
}
