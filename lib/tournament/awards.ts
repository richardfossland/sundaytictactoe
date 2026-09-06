// Tournament awards ("utmerkelser") computed from finished games. Pure +
// client-safe: derives everything from the stored move list (pgn = space-
// separated cell indices), so no game engine is needed. Returns data only;
// display strings live in the locale.
//
// Two awards read the move COUNT alone (fastest_win, longest_game). The four
// added later read what actually happened on the board, by replaying the cell
// list move by move — the pgn is a complete record, so a replay costs nothing
// and needs no extra column:
//
//   centre_opener — opened in the centre most often (who grabs the best square)
//   comeback      — won a game in which the opponent had a live k−1 threat
//   blocker       — most forced blocks (took the cell that was about to lose it)
//   draw_king     — most draws, and only with at least two of them
//
// Board GEOMETRY is needed for all four (which cell is the centre, which cells
// form a line), so `computeAwards` takes the tournament's variant. It defaults
// to the classic 3×3 — the same degrade-don't-throw rule variantById follows,
// and what keeps the two original awards callable with one argument.

import { completesLine } from "@/lib/ttt/win";
import { DEFAULT_VARIANT, type MnkVariant } from "@/lib/ttt/variants";

export interface AwardGame {
  id: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  status: string; // white_win | black_win | draw | ...
  pgn: string;
}

export type AwardKey =
  | "fastest_win"
  | "longest_game"
  | "centre_opener"
  | "comeback"
  | "blocker"
  | "draw_king";

export interface Award {
  key: AwardKey;
  playerIds: string[];
  /** key-specific number: plies for the two timing awards, a count for the
   * four tallying ones (centre openings / comebacks / blocks / draws). */
  value: number;
}

/**
 * How many players may share one of the TALLYING awards before it is dropped.
 *
 * The two original awards tie on an exact coincidence (the same number of
 * plies), which is rare and worth showing. A count over a handful of games in
 * a class ties constantly — in a 3-round tournament half the room can finish
 * on "2 blocks" — and an award everybody wins distinguishes nobody, besides
 * rendering as a wall of names on the projector. So a tally that spreads wider
 * than this is simply not shown.
 */
const MAX_SHARE = 3;

function plies(pgn: string): number {
  return pgn.trim() ? pgn.trim().split(/\s+/).filter(Boolean).length : 0;
}

/** The move list as cell indices. Anything unparsable ends the list rather
 * than poisoning the replay with NaN. */
function moves(pgn: string, size: number): number[] {
  const out: number[] = [];
  for (const tok of pgn.trim().split(/\s+/)) {
    if (!tok) continue;
    const cell = Number(tok);
    if (!Number.isInteger(cell) || cell < 0 || cell >= size) break;
    out.push(cell);
  }
  return out;
}

function winnerOf(g: AwardGame): string | null {
  if (g.status === "white_win") return g.whitePlayerId;
  if (g.status === "black_win") return g.blackPlayerId;
  return null;
}

// --------------------------------------------------------------- board tables

/** The centre cell(s): the ones nearest the middle. Exactly one on an odd
 * board (3×3, 5×5); the four middle squares on an even one, since 4×4 has no
 * single centre and all four are equally "the middle". Built once per board
 * shape — a whole tournament shares one variant — and keyed by shape rather
 * than object identity, because a caller may hand us an equivalent literal
 * instead of the module constant. */
const centreCache = new Map<string, Set<number>>();

function centreCells(v: MnkVariant): Set<number> {
  const key = `${v.m}x${v.n}`;
  const hit = centreCache.get(key);
  if (hit) return hit;

  const { m, n } = v;
  const cr = (m - 1) / 2;
  const cc = (n - 1) / 2;
  // Manhattan distance to the middle; the minimum is 0 on an odd board and 1
  // on an even one, where four cells share it.
  const dist: number[] = [];
  let best = Infinity;
  for (let i = 0; i < m * n; i++) {
    const d = Math.abs(((i / n) | 0) - cr) + Math.abs((i % n) - cc);
    dist.push(d);
    if (d < best) best = d;
  }
  const centre = new Set(dist.flatMap((d, i) => (d === best ? [i] : [])));
  centreCache.set(key, centre);
  return centre;
}

/** Empty cells on which `mark` would complete k in a row right now. Mutates
 * `board` in place and restores it. Each such cell IS an open k−1 line for
 * `mark`: k−1 of its marks, none of the opponent's, and the last cell free. */
function winningCells(board: string[], v: MnkVariant, mark: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== ".") continue;
    board[i] = mark;
    if (completesLine(board, v.m, v.n, v.k, i)) out.push(i);
    board[i] = ".";
  }
  return out;
}

// ------------------------------------------------------------------- tallying

/** Running max-with-ties over a per-player tally. */
class Tally {
  private counts = new Map<string, number>();
  add(playerId: string, by = 1) {
    this.counts.set(playerId, (this.counts.get(playerId) ?? 0) + by);
  }
  /** Leaders and their score, or null when nobody reaches `min` — or when so
   * many players tie that the award says nothing (see MAX_SHARE). */
  leaders(min: number): { playerIds: string[]; value: number } | null {
    let best = 0;
    for (const n of this.counts.values()) if (n > best) best = n;
    if (best < min) return null;
    const playerIds = [...this.counts.entries()]
      .filter(([, n]) => n === best)
      .map(([id]) => id);
    if (playerIds.length > MAX_SHARE) return null;
    return { playerIds, value: best };
  }
}

/** What one replayed game contributes to the board-reading awards. */
interface Replay {
  /** the opener (white) put their first mark in the centre */
  centreOpening: boolean;
  /** forced blocks, by player id */
  blocks: Map<string, number>;
  /** the winner won a game in which the loser had an open k−1 line */
  comebackWinner: string | null;
}

function replayGame(g: AwardGame, v: MnkVariant, white: string, black: string): Replay {
  const size = v.m * v.n;
  const cells = moves(g.pgn, size);
  const board = new Array<string>(size).fill(".");
  const blocks = new Map<string, number>();
  const winner = winnerOf(g);
  let survivedThreat = false;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (board[cell] !== ".") break; // corrupt list — stop rather than guess
    const mark = i % 2 === 0 ? "x" : "o";
    const oppMark = mark === "x" ? "o" : "x";
    const mover = i % 2 === 0 ? white : black;

    // The cells the player NOT moving could win on right now — i.e. their open
    // k−1 lines. One list, read by both awards below.
    const threats = winningCells(board, v, oppMark);

    // Snuoperasjonen: the eventual WINNER, at their own turn, faced a board on
    // which the loser was one cell from k in a row — and won anyway. Checked at
    // the winner's turn rather than at any point in the game, because that is
    // the moment the threat had to be answered; a threat that only appears in
    // the final position is one the winner already beat to the punch.
    if (winner !== null && mover === winner && threats.length > 0) survivedThreat = true;

    board[cell] = mark;
    const won = completesLine(board, v.m, v.n, v.k, cell);

    // A forced block: the opponent was one cell from k in a row and the mover
    // took that cell. A move that COMPLETES the mover's own line instead is a
    // win, not a save, and is not counted — otherwise the winning move of every
    // race would read as defence.
    if (!won && threats.includes(cell)) {
      blocks.set(mover, (blocks.get(mover) ?? 0) + 1);
    }
  }

  return {
    centreOpening: cells.length > 0 && centreCells(v).has(cells[0]),
    blocks,
    comebackWinner: survivedThreat ? winner : null,
  };
}

// -------------------------------------------------------------------- awards

export function computeAwards(
  games: AwardGame[],
  variant: MnkVariant = DEFAULT_VARIANT,
): Award[] {
  const decided = games.filter(
    (g) =>
      g.blackPlayerId &&
      (g.status === "white_win" || g.status === "black_win" || g.status === "draw"),
  );

  // Ties share an award.
  let fastestWin: { playerIds: string[]; plies: number } | null = null;
  let longest: { ids: string[]; plies: number } | null = null;
  const centre = new Tally();
  const comeback = new Tally();
  const blocker = new Tally();
  const draws = new Tally();

  for (const g of decided) {
    const p = plies(g.pgn);
    if (p === 0) continue;
    const black = g.blackPlayerId as string;

    const winner = winnerOf(g);
    if (winner) {
      if (!fastestWin || p < fastestWin.plies) {
        fastestWin = { playerIds: [winner], plies: p };
      } else if (p === fastestWin.plies && !fastestWin.playerIds.includes(winner)) {
        fastestWin.playerIds.push(winner);
      }
    }

    if (!longest || p > longest.plies) {
      longest = { ids: [g.whitePlayerId, black], plies: p };
    }

    if (g.status === "draw") {
      draws.add(g.whitePlayerId);
      draws.add(black);
    }

    const r = replayGame(g, variant, g.whitePlayerId, black);
    if (r.centreOpening) centre.add(g.whitePlayerId);
    if (r.comebackWinner) comeback.add(r.comebackWinner);
    for (const [id, n] of r.blocks) blocker.add(id, n);
  }

  const awards: Award[] = [];
  if (fastestWin) {
    awards.push({ key: "fastest_win", playerIds: fastestWin.playerIds, value: fastestWin.plies });
  }
  if (longest && longest.plies >= 6) {
    awards.push({ key: "longest_game", playerIds: longest.ids, value: longest.plies });
  }

  // Thresholds: one of anything is a coincidence, not a habit. Draws get the
  // explicit "at least two" the spec asks for; the others use the same bar.
  const push = (key: AwardKey, hit: { playerIds: string[]; value: number } | null) => {
    if (hit) awards.push({ key, playerIds: hit.playerIds, value: hit.value });
  };
  push("centre_opener", centre.leaders(2));
  push("comeback", comeback.leaders(1));
  push("blocker", blocker.leaders(2));
  push("draw_king", draws.leaders(2));

  return awards;
}
