import { describe, expect, it } from "vitest";
import { waitingProgress } from "@/lib/tournament/progress";
import type { BoardState, PublicGame, PublicPlayer } from "@/lib/dto";
import type { TournamentConfig, TournamentStatus } from "@/lib/types";

const ME = "p1";

function config(over: Partial<TournamentConfig> = {}): TournamentConfig {
  return {
    leagueRounds: 5,
    playoff: false,
    playoffSize: 0,
    roundTimerSec: null,
    ...over,
  };
}

function player(id: string, over: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id,
    displayName: id,
    score: 0,
    tiebreak: 0,
    status: "active",
    seed: null,
    team: null,
    ...over,
  };
}

function game(over: Partial<PublicGame> & Pick<PublicGame, "id" | "roundId">): PublicGame {
  return {
    whitePlayerId: ME,
    blackPlayerId: "opp",
    fen: "",
    status: "live",
    turn: "w",
    ...over,
  };
}

function state(over: {
  status: TournamentStatus;
  currentRound: number;
  config?: Partial<TournamentConfig>;
  players?: PublicPlayer[];
  games?: PublicGame[];
  rounds?: BoardState["rounds"];
}): BoardState {
  return {
    tournament: {
      id: "t1",
      title: null,
      joinPin: "123456",
      status: over.status,
      config: config(over.config),
      currentRound: over.currentRound,
    },
    players: over.players ?? [player(ME), player("opp")],
    games: over.games ?? [],
    standings: [],
    rounds: over.rounds ?? [],
  };
}

describe("waitingProgress", () => {
  it("league — reports the round, total and live games still to finish", () => {
    const s = state({
      status: "league",
      currentRound: 2,
      config: { leagueRounds: 5 },
      rounds: [
        { id: "r2", number: 2, phase: "league", status: "live", startedAt: null, extendedMs: 0 },
      ],
      games: [
        game({ id: "g1", roundId: "r2", status: "live" }),
        game({ id: "g2", roundId: "r2", status: "white_win" }),
      ],
    });
    const p = waitingProgress(s, { playerId: ME });
    expect(p).not.toBeNull();
    expect(p!.label).toBe("Runde 2 av 5 · 1 partier igjen");
    expect(p!.timer).toBeNull(); // no roundTimerSec configured
  });

  it("league — every game in the round resolved: waiting on the organizer", () => {
    const s = state({
      status: "league",
      currentRound: 2,
      config: { leagueRounds: 5 },
      rounds: [
        { id: "r2", number: 2, phase: "league", status: "live", startedAt: null, extendedMs: 0 },
      ],
      games: [
        game({ id: "g1", roundId: "r2", status: "white_win" }),
        game({ id: "g2", roundId: "r2", status: "draw" }),
      ],
    });
    const p = waitingProgress(s, { playerId: ME });
    expect(p!.label).toBe("Venter på at arrangøren starter runde 3");
  });

  it("league — includes the compact timer's fields when a round timer is configured and running", () => {
    const s = state({
      status: "league",
      currentRound: 1,
      config: { leagueRounds: 5, roundTimerSec: 600 },
      rounds: [
        {
          id: "r1",
          number: 1,
          phase: "league",
          status: "live",
          startedAt: "2026-01-01T00:00:00.000Z",
          extendedMs: 60_000,
        },
      ],
      games: [game({ id: "g1", roundId: "r1", status: "live" })],
    });
    const p = waitingProgress(s, { playerId: ME });
    expect(p!.timer).toEqual({
      startedAt: "2026-01-01T00:00:00.000Z",
      durationSec: 600,
      extendedMs: 60_000,
    });
  });

  it("playoff — derives the bracket's total round count from the active player count", () => {
    // 4 active players, default playoffSize (0) but status already "playoff" —
    // exercise the format:"cup" branch, which sizes off cupBracketSize instead.
    const s = state({
      status: "playoff",
      currentRound: 1,
      config: { format: "cup" },
      players: [player("a"), player(ME), player("c"), player("d")],
      rounds: [
        { id: "r1", number: 1, phase: "playoff", status: "live", startedAt: null, extendedMs: 0 },
      ],
      games: [
        game({ id: "g1", roundId: "r1", whitePlayerId: ME, blackPlayerId: "a", status: "live" }),
        game({ id: "g2", roundId: "r1", whitePlayerId: "c", blackPlayerId: "d", status: "live" }),
      ],
    });
    const p = waitingProgress(s, { playerId: ME });
    // cupBracketSize(4) = 4 → bracketRounds(4) = 2 (semis + final).
    expect(p!.label).toBe("Runde 1 av 2 · 2 partier igjen");
  });

  it("playoff — a player eliminated from the current round gets nothing to report", () => {
    const s = state({
      status: "playoff",
      currentRound: 2,
      config: { playoff: true, playoffSize: 4 },
      players: [player("a"), player(ME), player("c"), player("d")],
      rounds: [
        { id: "r1", number: 1, phase: "playoff", status: "done", startedAt: null, extendedMs: 0 },
        { id: "r2", number: 2, phase: "playoff", status: "live", startedAt: null, extendedMs: 0 },
      ],
      // ME isn't in round 2 at all — knocked out in round 1.
      games: [game({ id: "g3", roundId: "r2", whitePlayerId: "c", blackPlayerId: "d", status: "live" })],
    });
    expect(waitingProgress(s, { playerId: ME })).toBeNull();
  });

  it("finished — nothing to report (the final-results card owns that screen)", () => {
    const s = state({
      status: "finished",
      currentRound: 3,
      rounds: [
        { id: "r3", number: 3, phase: "league", status: "done", startedAt: null, extendedMs: 0 },
      ],
    });
    expect(waitingProgress(s, { playerId: ME })).toBeNull();
  });

  it("lobby — nothing to report yet", () => {
    const s = state({ status: "lobby", currentRound: 0 });
    expect(waitingProgress(s, { playerId: ME })).toBeNull();
  });

  it("no rounds created yet for the current number — defensively returns null", () => {
    const s = state({ status: "league", currentRound: 1, rounds: [] });
    expect(waitingProgress(s, { playerId: ME })).toBeNull();
  });
});
