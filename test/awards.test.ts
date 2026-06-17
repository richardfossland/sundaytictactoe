import { describe, expect, it } from "vitest";
import { computeAwards, type AwardGame } from "@/lib/tournament/awards";

function game(partial: Partial<AwardGame> & { pgn: string }): AwardGame {
  return {
    id: "g1",
    whitePlayerId: "W",
    blackPlayerId: "B",
    status: "white_win",
    ...partial,
  };
}

// pgn = space-separated cell indices (one token per ply).
const QUICK_WIN = "0 3 1 4 2"; // X wins in 5 plies (top row)
const LONG_GAME = "4 0 8 2 6 1 5 3 7"; // a full 9-cell game

describe("computeAwards", () => {
  it("finds the fastest win and credits the winner", () => {
    const awards = computeAwards([
      game({ id: "a", pgn: QUICK_WIN, status: "white_win" }),
      game({ id: "b", pgn: LONG_GAME, status: "black_win", whitePlayerId: "X", blackPlayerId: "Y" }),
    ]);
    const fastest = awards.find((a) => a.key === "fastest_win");
    expect(fastest).toBeDefined();
    expect(fastest!.playerIds).toEqual(["W"]); // 5 plies beats 9
    expect(fastest!.value).toBe(5);
  });

  it("awards longest game to both players", () => {
    const awards = computeAwards([
      game({ id: "a", pgn: LONG_GAME, status: "black_win" }),
      game({ id: "b", pgn: QUICK_WIN, status: "white_win", whitePlayerId: "X", blackPlayerId: "Y" }),
    ]);
    const longest = awards.find((a) => a.key === "longest_game");
    expect(longest).toBeDefined();
    expect(longest!.playerIds).toEqual(["W", "B"]);
    expect(longest!.value).toBe(9);
  });

  it("ignores byes, live and aborted games", () => {
    const awards = computeAwards([
      game({ pgn: QUICK_WIN, status: "live" }),
      game({ pgn: QUICK_WIN, status: "aborted" }),
      game({ pgn: QUICK_WIN, status: "bye", blackPlayerId: null }),
    ]);
    expect(awards).toEqual([]);
  });
});

describe("award ties", () => {
  it("shares fastest win between equal-length winners", () => {
    const awards = computeAwards([
      game({ id: "a", pgn: QUICK_WIN, status: "white_win" }),
      game({ id: "b", pgn: QUICK_WIN, status: "white_win", whitePlayerId: "X", blackPlayerId: "Y" }),
    ]);
    const fastest = awards.find((a) => a.key === "fastest_win");
    expect(fastest!.playerIds.sort()).toEqual(["W", "X"]);
  });
});
