// Board-string helpers. The board is a length m*n string of '.'/'x'/'o' read
// row-major: index i → row = floor(i/n), col = i%n. There is no explicit "turn"
// field in the string (unlike chess FEN) — whose turn it is is DERIVED from the
// number of marks placed (X plays first). The DB column games.turn stays the
// authoritative copy; deriving here is only for client hints + bot logic.

import type { Turn } from "@/lib/types";

export type Mark = "x" | "o";

/** Whose turn it is from the filled-cell count: even ⇒ X (w), odd ⇒ O (b). */
export function turnFromState(state: string): Turn {
  let filled = 0;
  for (const ch of state) if (ch === "x" || ch === "o") filled++;
  return filled % 2 === 0 ? "w" : "b";
}

/** The mark a given side places. X = white (first), O = black (second). */
export function markFor(turn: Turn): Mark {
  return turn === "w" ? "x" : "o";
}

/** The side that owns a mark. */
export function turnForMark(mark: Mark): Turn {
  return mark === "x" ? "w" : "b";
}

export function otherMark(mark: Mark): Mark {
  return mark === "x" ? "o" : "x";
}

/** Indices of empty cells. */
export function emptyCells(state: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.length; i++) if (state[i] === ".") out.push(i);
  return out;
}

/** Count of placed marks. */
export function filledCount(state: string): number {
  let n = 0;
  for (const ch of state) if (ch === "x" || ch === "o") n++;
  return n;
}

/** A valid board string for the given size has the right length and only legal
 * chars. Cheap guard before trusting an externally-supplied board. */
export function isValidState(state: string, size: number): boolean {
  if (state.length !== size) return false;
  for (const ch of state) if (ch !== "." && ch !== "x" && ch !== "o") return false;
  return true;
}
