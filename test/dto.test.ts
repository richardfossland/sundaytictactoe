import { describe, expect, it } from "vitest";
import type { Game, ResultSource, Tournament } from "@/lib/types";
import { resultSourceLabel, toBoardTournament, toPublicGame } from "@/lib/dto";

// Port of sundaychess#103 (test/dto.test.ts): fair-play readout on
// PublicGame.resultSource + the pure resultSourceLabel helper. TTT's
// toPublicGame(g: Game) has no `withPgn` option (unlike chess's), so the
// pgn-gating tests from the chess original don't apply here.

const BOARD = "xo.......";

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
    tournament_id: "t",
    round_id: "r",
    white_player_id: "white",
    black_player_id: "black",
    fen: BOARD,
    pgn: "",
    status: "white_win",
    result_source: null,
    turn: "w",
    draw_offered_by: null,
    updated_at: "",
    ...over,
  };
}

describe("toPublicGame — fair-play readout (result_source)", () => {
  it("includes resultSource for a decided game", () => {
    const pub = toPublicGame(makeGame({ status: "white_win", result_source: "walkover" }));
    expect(pub.resultSource).toBe("walkover");
  });

  it("includes resultSource for a draw decided by teacher_override", () => {
    const pub = toPublicGame(makeGame({ status: "draw", result_source: "teacher_override" }));
    expect(pub.resultSource).toBe("teacher_override");
  });

  it("omits resultSource for a live game, even if the row somehow has one", () => {
    const pub = toPublicGame(makeGame({ status: "live", result_source: "walkover" }));
    expect(pub.resultSource).toBeUndefined();
    expect("resultSource" in pub).toBe(false);
  });

  it("omits resultSource when the decided game's row has none", () => {
    const pub = toPublicGame(makeGame({ status: "white_win", result_source: null }));
    expect(pub.resultSource).toBeUndefined();
  });

  it("omits resultSource for an aborted game (not in the `decided` set)", () => {
    const pub = toPublicGame(makeGame({ status: "aborted", result_source: "teacher_override" }));
    expect(pub.resultSource).toBeUndefined();
  });
});

describe("resultSourceLabel — pure marker text for a fair-play readout", () => {
  it("is empty for ordinary play", () => {
    expect(resultSourceLabel("play")).toBe("");
  });

  it("is empty for null/undefined (a live game)", () => {
    expect(resultSourceLabel(null)).toBe("");
    expect(resultSourceLabel(undefined)).toBe("");
  });

  const cases: [ResultSource, string][] = [
    ["walkover", "W.O."],
    ["opponent_absent", "Fraværende"],
    ["teacher_override", "Overstyrt"],
    ["timeout_draw", "Tid ute"],
    ["bye", "Frirunde"],
  ];
  it.each(cases)("maps %s to %s", (source, label) => {
    expect(resultSourceLabel(source)).toBe(label);
  });
});

describe("toBoardTournament — the teacher's private notes never leak to students", () => {
  function makeTournament(over: Partial<Tournament> = {}): Tournament {
    return {
      id: "t1",
      join_pin: "123456",
      host_code: "HOST",
      host_user_id: null,
      title: "7A",
      status: "league",
      config: {
        leagueRounds: 5,
        playoff: false,
        playoffSize: 0,
        roundTimerSec: null,
        notes: "Klasse 7A, time 3 — pass på Kari og Ola",
      },
      current_round: 1,
      created_at: "",
      ...over,
    };
  }

  // GET /api/tournament/[id] is UNAUTHENTICATED and polled every 5s by every
  // connected student device (see app/api/tournament/[id]/route.ts) — the
  // teacher's private reminder must never ride along in its `config`.
  it("strips config.notes from the public board DTO", () => {
    const pub = toBoardTournament(makeTournament());
    expect(pub.config).not.toHaveProperty("notes");
    expect("notes" in pub.config).toBe(false);
  });

  it("leaves every other config field untouched", () => {
    const pub = toBoardTournament(makeTournament());
    expect(pub.config).toMatchObject({
      leagueRounds: 5,
      playoff: false,
      playoffSize: 0,
      roundTimerSec: null,
    });
  });

  it("is safe when there are no notes to begin with", () => {
    const t = makeTournament();
    delete t.config.notes;
    const pub = toBoardTournament(t);
    expect(pub.config).not.toHaveProperty("notes");
  });
});
