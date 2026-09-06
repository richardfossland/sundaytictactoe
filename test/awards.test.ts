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

// ---------------------------------------------------------------------------
// The four board-reading awards. Every fixture below is a real, hand-checked
// 3×3 (or 4×4) game written as the cell list the app actually stores, so the
// assertions test the replay rather than a mock of it.
// ---------------------------------------------------------------------------

/**
 * X opens in the CENTRE, has to save the game once, and wins anyway.
 *
 *   ply 0  ✕4   centre opening
 *   ply 1  ◯0
 *   ply 2  ✕8
 *   ply 3  ◯3   ◯ now has 0+3 and threatens 6 (left column)
 *   ply 4  ✕6   forced block — and it forks: ✕ threatens 2 and 7
 *   ply 5  ◯2   forced block (◯ can only answer one), which threatens 1
 *   ply 6  ✕7   completes 6-7-8 → ✕ wins with ◯'s threat still on the board
 */
const COMEBACK_WIN = "4 0 8 3 6 2 7";

/** A full 9-ply draw with two forced blocks each way (0-1-2 and 2-5-8 for ✕;
 * 1-4-7 and 3-4-5 for ◯). Opens on a corner, not the centre. */
const DRAW_GAME = "0 4 2 1 7 6 8 5 3";

/** ✕ wins by playing the one cell that ALSO blocks ◯'s 2-5-8. */
const WIN_THAT_BLOCKS = "0 5 1 8 2";

/** 4×4: ✕ opens on cell 5 — one of the four middle squares of an even board,
 * and emphatically not the centre of a 3×3. Ends 4-5-6-7 for ✕. */
const CENTRE_4X4 = "5 0 6 1 7 2 4";

const V4 = { id: "4x4", m: 4, n: 4, k: 4, label: "4×4" };

describe("centre_opener", () => {
  it("credits the player who opened in the middle most often", () => {
    const awards = computeAwards([
      game({ id: "a", pgn: COMEBACK_WIN, blackPlayerId: "B1" }),
      game({ id: "b", pgn: COMEBACK_WIN, blackPlayerId: "B2" }),
    ]);
    const centre = awards.find((a) => a.key === "centre_opener");
    expect(centre).toBeDefined();
    expect(centre!.playerIds).toEqual(["W"]);
    expect(centre!.value).toBe(2);
  });

  it("needs more than one centre opening", () => {
    const awards = computeAwards([game({ pgn: COMEBACK_WIN })]);
    expect(awards.find((a) => a.key === "centre_opener")).toBeUndefined();
  });

  it("reads the centre from the VARIANT, not from 3×3", () => {
    const games = [
      game({ id: "a", pgn: CENTRE_4X4, blackPlayerId: "B1" }),
      game({ id: "b", pgn: CENTRE_4X4, blackPlayerId: "B2" }),
    ];
    // Cell 5 is one of 4×4's four middle squares …
    const on4x4 = computeAwards(games, V4).find((a) => a.key === "centre_opener");
    expect(on4x4).toBeDefined();
    expect(on4x4!.playerIds).toEqual(["W"]);
    expect(on4x4!.value).toBe(2);
    // … and is not the centre of a 3×3, whose only middle cell is 4.
    expect(computeAwards(games).find((a) => a.key === "centre_opener")).toBeUndefined();
  });
});

describe("comeback", () => {
  it("credits a winner who faced an open k−1 line on their own turn", () => {
    const awards = computeAwards([game({ pgn: COMEBACK_WIN })]);
    const c = awards.find((a) => a.key === "comeback");
    expect(c).toBeDefined();
    expect(c!.playerIds).toEqual(["W"]);
    expect(c!.value).toBe(1);
  });

  it("counts games, so the most-often survivor wins it", () => {
    const c = computeAwards([
      game({ id: "a", pgn: COMEBACK_WIN, blackPlayerId: "B1" }),
      game({ id: "b", pgn: COMEBACK_WIN, blackPlayerId: "B2" }),
      game({ id: "c", pgn: COMEBACK_WIN, whitePlayerId: "X", blackPlayerId: "Y" }),
    ]).find((a) => a.key === "comeback");
    expect(c!.playerIds).toEqual(["W"]);
    expect(c!.value).toBe(2);
  });

  it("is not given for a draw — nobody turned anything around", () => {
    const awards = computeAwards([game({ pgn: DRAW_GAME, status: "draw" })]);
    expect(awards.find((a) => a.key === "comeback")).toBeUndefined();
  });
});

describe("blocker", () => {
  it("counts forced blocks and finds the busiest defender", () => {
    // Each COMEBACK_WIN has exactly one forced block per side; playing it twice
    // as White puts W on 2 and the two opponents on 1 each.
    const b = computeAwards([
      game({ id: "a", pgn: COMEBACK_WIN, blackPlayerId: "B1" }),
      game({ id: "b", pgn: COMEBACK_WIN, blackPlayerId: "B2" }),
    ]).find((a) => a.key === "blocker");
    expect(b).toBeDefined();
    expect(b!.playerIds).toEqual(["W"]);
    expect(b!.value).toBe(2);
  });

  it("does not count the winning move, even when it also blocks", () => {
    // ✕ plays cell 2: it completes 0-1-2 AND takes the cell ◯ needed for
    // 2-5-8. That is a win, not a save.
    const awards = computeAwards([game({ pgn: WIN_THAT_BLOCKS })]);
    expect(awards.find((a) => a.key === "blocker")).toBeUndefined();
    expect(awards.find((a) => a.key === "fastest_win")!.value).toBe(5);
  });
});

describe("draw_king", () => {
  it("needs at least two draws", () => {
    const one = computeAwards([game({ pgn: DRAW_GAME, status: "draw" })]);
    expect(one.find((a) => a.key === "draw_king")).toBeUndefined();

    const two = computeAwards([
      game({ id: "a", pgn: DRAW_GAME, status: "draw" }),
      game({ id: "b", pgn: DRAW_GAME, status: "draw" }),
    ]).find((a) => a.key === "draw_king");
    expect(two).toBeDefined();
    expect([...two!.playerIds].sort()).toEqual(["B", "W"]);
    expect(two!.value).toBe(2);
  });

  it("drops an award that too many players share", () => {
    // Four players on two draws each: nothing is being distinguished, so the
    // card is not shown at all rather than listing the whole class.
    const awards = computeAwards([
      game({ id: "a", pgn: DRAW_GAME, status: "draw", whitePlayerId: "P1", blackPlayerId: "P2" }),
      game({ id: "b", pgn: DRAW_GAME, status: "draw", whitePlayerId: "P1", blackPlayerId: "P2" }),
      game({ id: "c", pgn: DRAW_GAME, status: "draw", whitePlayerId: "P3", blackPlayerId: "P4" }),
      game({ id: "d", pgn: DRAW_GAME, status: "draw", whitePlayerId: "P3", blackPlayerId: "P4" }),
    ]);
    expect(awards.find((a) => a.key === "draw_king")).toBeUndefined();
  });
});

describe("award replay robustness", () => {
  it("survives a corrupt move list instead of throwing", () => {
    for (const pgn of ["0 abc 4", "0 0 0", "99 1", "   ", "-1 4"]) {
      expect(() => computeAwards([game({ pgn })])).not.toThrow();
    }
  });
});
