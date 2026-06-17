// Tournament awards ("utmerkelser") computed from finished games. Pure +
// client-safe: derives everything from the stored move list (pgn = space-
// separated cell indices), so no game engine is needed. Returns data only;
// display strings live in the locale.

export interface AwardGame {
  id: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  status: string; // white_win | black_win | draw | ...
  pgn: string;
}

export type AwardKey = "fastest_win" | "longest_game";

export interface Award {
  key: AwardKey;
  playerIds: string[];
  /** key-specific number: plies (moves) in the game */
  value: number;
}

function plies(pgn: string): number {
  return pgn.trim() ? pgn.trim().split(/\s+/).filter(Boolean).length : 0;
}

function winnerOf(g: AwardGame): string | null {
  if (g.status === "white_win") return g.whitePlayerId;
  if (g.status === "black_win") return g.blackPlayerId;
  return null;
}

export function computeAwards(games: AwardGame[]): Award[] {
  const decided = games.filter(
    (g) =>
      g.blackPlayerId &&
      (g.status === "white_win" || g.status === "black_win" || g.status === "draw"),
  );

  // Ties share an award.
  let fastestWin: { playerIds: string[]; plies: number } | null = null;
  let longest: { ids: string[]; plies: number } | null = null;

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
  }

  const awards: Award[] = [];
  if (fastestWin) {
    awards.push({ key: "fastest_win", playerIds: fastestWin.playerIds, value: fastestWin.plies });
  }
  if (longest && longest.plies >= 6) {
    awards.push({ key: "longest_game", playerIds: longest.ids, value: longest.plies });
  }
  return awards;
}
