// k-in-a-row detection on an m×n board (row-major string). Scans every cell as
// the start of four rays — E (→), S (↓), SE (↘), SW (↙) — which together cover
// all horizontal, vertical and both diagonal lines exactly once. O(m*n*k).

import type { Mark } from "@/lib/ttt/state";

export interface WinLine {
  mark: Mark;
  /** the k cell indices that form the winning line */
  cells: number[];
}

const RAYS: [number, number][] = [
  [0, 1], // east
  [1, 0], // south
  [1, 1], // south-east
  [1, -1], // south-west
];

/** The winning line on the board, or null if no side has k in a row. Returns the
 * FIRST line found (sufficient — a board has at most one winner in normal play). */
export function findWinLine(
  board: string,
  m: number,
  n: number,
  k: number,
): WinLine | null {
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      const start = r * n + c;
      const mark = board[start];
      if (mark !== "x" && mark !== "o") continue;
      for (const [dr, dc] of RAYS) {
        const endR = r + dr * (k - 1);
        const endC = c + dc * (k - 1);
        if (endR < 0 || endR >= m || endC < 0 || endC >= n) continue;
        const cells = [start];
        let ok = true;
        for (let step = 1; step < k; step++) {
          const idx = (r + dr * step) * n + (c + dc * step);
          if (board[idx] !== mark) {
            ok = false;
            break;
          }
          cells.push(idx);
        }
        if (ok) return { mark: mark as Mark, cells };
      }
    }
  }
  return null;
}

/** The winning mark, or null. */
export function findWin(
  board: string,
  m: number,
  n: number,
  k: number,
): Mark | null {
  return findWinLine(board, m, n, k)?.mark ?? null;
}
