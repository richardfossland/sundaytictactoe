/** Half-move count from a board string — lets us merge poll vs realtime updates
 * without ever regressing to an older position. ply = number of marks placed
 * (cells only ever fill, never clear, so this is monotonic per game). The chess
 * app derived this from a FEN's move counter; the TTT board has no such field, so
 * we count filled cells. Shared by the host live grid and the player's board so a
 * delayed/out-of-order "position" broadcast can never roll the board backwards. */
export function plyOf(state: string): number {
  let n = 0;
  for (const ch of state) if (ch === "x" || ch === "o") n++;
  return n;
}
