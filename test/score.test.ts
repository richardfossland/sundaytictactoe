import { describe, expect, it } from "vitest";
import {
  colorCounts,
  computeBuchholz,
  computeScores,
  computeStandings,
  hadByeSet,
  metBeforeSet,
  pointsFor,
} from "@/lib/tournament/score";
import type { Game, GameStatus, Player } from "@/lib/types";

let gid = 0;
function game(
  white: string,
  black: string | null,
  status: GameStatus,
): Game {
  return {
    id: `g${gid++}`,
    tournament_id: "t",
    round_id: "r",
    white_player_id: white,
    black_player_id: black,
    fen: "",
    pgn: "",
    status,
    result_source: null,
    turn: "w",
    draw_offered_by: null,
    updated_at: "",
  };
}

function player(id: string, name: string): Player {
  return {
    id,
    tournament_id: "t",
    display_name: name,
    resume_code: "AAAA-AA",
    score: 0,
    tiebreak: 0,
    status: "active",
    seed: null,
    joined_at: "",
  };
}

describe("pointsFor", () => {
  it("scores each terminal status", () => {
    expect(pointsFor("white_win")).toEqual({ white: 1, black: 0 });
    expect(pointsFor("black_win")).toEqual({ white: 0, black: 1 });
    expect(pointsFor("draw")).toEqual({ white: 0.5, black: 0.5 });
    expect(pointsFor("bye")).toEqual({ white: 1, black: 0 });
    expect(pointsFor("aborted")).toEqual({ white: 0, black: 0 });
    expect(pointsFor("live")).toEqual({ white: 0, black: 0 });
  });
});

describe("computeScores", () => {
  it("sums points across games and ignores live games", () => {
    const games = [
      game("a", "b", "white_win"),
      game("a", "c", "draw"),
      game("b", "c", "live"),
      game("a", null, "bye"),
    ];
    const s = computeScores(games);
    expect(s.get("a")).toBe(2.5); // 1 + 0.5 + 1
    expect(s.get("b")).toBe(0);
    expect(s.get("c")).toBe(0.5);
  });
});

describe("computeBuchholz", () => {
  it("sums opponents' total scores, excluding byes", () => {
    // a beats b, a draws c. b's opponents: {a}. a's score = 1.5, c's = 0.5.
    const games = [game("a", "b", "white_win"), game("a", "c", "draw")];
    const buch = computeBuchholz(games);
    // a faced b(0) and c(0.5) → 0.5
    expect(buch.get("a")).toBe(0.5);
    // b faced a(1.5) → 1.5
    expect(buch.get("b")).toBe(1.5);
    // c faced a(1.5) → 1.5
    expect(buch.get("c")).toBe(1.5);
  });
});

describe("computeStandings", () => {
  it("ranks by score then Buchholz", () => {
    const players = [player("a", "Ada"), player("b", "Bo"), player("c", "Cay")];
    const games = [
      game("a", "b", "white_win"),
      game("a", "c", "white_win"),
      game("b", "c", "white_win"),
    ];
    const rows = computeStandings(players, games);
    expect(rows.map((r) => r.playerId)).toEqual(["a", "b", "c"]);
    expect(rows[0].rank).toBe(1);
    expect(rows[0].score).toBe(2);
  });

  it("excludes players who left", () => {
    const left = player("z", "Zed");
    left.status = "left";
    const rows = computeStandings([player("a", "Ada"), left], []);
    expect(rows.map((r) => r.playerId)).toEqual(["a"]);
  });
});

describe("history helpers", () => {
  it("metBeforeSet records real pairings, not byes", () => {
    const set = metBeforeSet([
      game("a", "b", "white_win"),
      game("c", null, "bye"),
    ]);
    expect(set.has("a|b")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("hadByeSet collects bye recipients", () => {
    const set = hadByeSet([game("c", null, "bye"), game("a", "b", "draw")]);
    expect(set.has("c")).toBe(true);
    expect(set.size).toBe(1);
  });
});

describe("colorCounts", () => {
  it("tallies white/black per player and ignores byes", () => {
    const games = [
      game("a", "b", "white_win"),
      game("b", "a", "draw"), // colours swapped next round
      game("a", null, "bye"), // bye carries no colour
      game("c", "a", "black_win"),
    ];
    const c = colorCounts(games);
    // a: white in g0, black in g1, (bye ignored), black in g3 → 1 white / 2 black
    expect(c.get("a")).toEqual({ white: 1, black: 2 });
    // b: black in g0, white in g1 → balanced
    expect(c.get("b")).toEqual({ white: 1, black: 1 });
    // c: white in g3 only
    expect(c.get("c")).toEqual({ white: 1, black: 0 });
    // the bye recipient gained no colour from the bye
    expect(c.get("a")?.white).toBe(1);
  });

  it("is empty for no games", () => {
    expect(colorCounts([]).size).toBe(0);
  });
});
