// Pure m,n,k tic-tac-toe rules. Used on the SERVER as the authority and on the
// CLIENT for optimistic hints. No I/O. The result shape MIRRORS the old chess
// engine's so /api/move and the board UI need only swap the import + the move
// intent ({cell} instead of {from,to}).

import type { GameStatus, Turn } from "@/lib/types";
import {
  emptyCells,
  isValidState,
  markFor,
  turnFromState,
} from "@/lib/ttt/state";
import { findWin } from "@/lib/ttt/win";
import { DEFAULT_VARIANT, type MnkVariant } from "@/lib/ttt/variants";

export interface MoveIntent {
  /** cell index 0..(m*n-1) */
  cell: number;
}

export interface AppliedMove {
  ok: true;
  /** the new board string (stored in games.fen) */
  fen: string;
  /** space-separated cell list (stored in games.pgn) */
  pgn: string;
  /** this move's notation = the cell index as a string (stored in moves.san) */
  san: string;
  turn: Turn;
  /** Outcome status if the game ended on this move, else "live". */
  status: GameStatus;
  endReason: EndReason | null;
}

export interface RejectedMove {
  ok: false;
  reason: "illegal" | "bad_fen" | "game_over";
}

export type MoveResult = AppliedMove | RejectedMove;

export type EndReason = "k_in_row" | "board_full";

/** The colour to move on a board, derived from the filled-cell count. Named to
 * match the chess engine's turnFromFen so call sites read the same. */
export function turnFromFen(state: string): Turn {
  return turnFromState(state);
}

/** Apply a move to a board. Returns the authoritative next state, or a typed
 * rejection. `priorPgn` (the existing move list) is appended to; the board string
 * itself is authoritative for legality. `variant` supplies the board size + win
 * length (defaults to classic 3×3). */
export function applyMove(
  state: string,
  intent: MoveIntent,
  priorPgn?: string,
  variant: MnkVariant = DEFAULT_VARIANT,
): MoveResult {
  const { m, n, k } = variant;
  const size = m * n;

  if (!isValidState(state, size)) return { ok: false, reason: "bad_fen" };

  // Already decided? No moves after a win or a full board.
  if (findWin(state, m, n, k)) return { ok: false, reason: "game_over" };
  if (emptyCells(state).length === 0) return { ok: false, reason: "game_over" };

  const cell = intent.cell;
  if (!Number.isInteger(cell) || cell < 0 || cell >= size) {
    return { ok: false, reason: "illegal" };
  }
  if (state[cell] !== ".") return { ok: false, reason: "illegal" };

  const turn = turnFromState(state);
  const mark = markFor(turn);
  const next = state.slice(0, cell) + mark + state.slice(cell + 1);

  const san = String(cell);
  const pgn = priorPgn && priorPgn.trim().length > 0 ? `${priorPgn} ${san}` : san;

  let status: GameStatus = "live";
  let endReason: EndReason | null = null;

  const winner = findWin(next, m, n, k);
  if (winner) {
    status = winner === "x" ? "white_win" : "black_win";
    endReason = "k_in_row";
  } else if (emptyCells(next).length === 0) {
    status = "draw";
    endReason = "board_full";
  }

  return {
    ok: true,
    fen: next,
    pgn,
    san,
    turn: turn === "w" ? "b" : "w",
    status,
    endReason,
  };
}

/** Legal destination cells (the empty ones) — for client-side hints. Mirrors the
 * chess engine's legalDestinations; no source square is needed in TTT. */
export function legalDestinations(state: string): number[] {
  return findWin(state, DEFAULT_VARIANT.m, DEFAULT_VARIANT.n, DEFAULT_VARIANT.k)
    ? []
    : emptyCells(state);
}
