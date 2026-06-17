import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Round, Tournament } from "@/lib/types";

// Mock the DB + side-effect boundary; keep the REAL pair() + scoring. Verifies
// the round-lifecycle branching for §6 (advance to next league round vs finish).
// vi.hoisted ensures the mock vars exist before the hoisted vi.mock factories.
const { store, maybeStartPlayoff } = vi.hoisted(() => ({
  store: {
    listRounds: vi.fn(),
    setRoundStatus: vi.fn(),
    listPlayers: vi.fn(),
    listGames: vi.fn(),
    listGamesForRound: vi.fn(),
    createRound: vi.fn(),
    createGame: vi.fn(),
    recomputeScores: vi.fn(),
    updateTournament: vi.fn(),
  },
  maybeStartPlayoff: vi.fn(),
}));

vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/gameEvents", () => ({ afterGameResolved: vi.fn() }));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("@/lib/server/playoff", () => ({ maybeStartPlayoff }));

import { advanceRound, currentRoundResolved, startLeague } from "@/lib/server/league";

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: "t",
    join_pin: "000000",
    host_code: "AAAA-AA",
    host_user_id: null,
    title: null,
    status: "league",
    config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 1,
    created_at: "",
    ...over,
  };
}
function players(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    tournament_id: "t",
    display_name: `P${i + 1}`,
    resume_code: "AAAA-AA",
    score: 0,
    tiebreak: 0,
    status: "active" as const,
    seed: null,
    joined_at: "",
  }));
}
const round = (number: number): Round => ({
  id: `r${number}`,
  tournament_id: "t",
  number,
  phase: "league",
  status: "live",
  started_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  store.createRound.mockResolvedValue(round(99));
  store.createGame.mockResolvedValue({});
  store.listPlayers.mockResolvedValue(players(4));
  store.listGames.mockResolvedValue([]);
});

describe("startLeague", () => {
  it("pairs round 1 and flips status to league", async () => {
    await startLeague(tournament({ status: "lobby", current_round: 0 }));
    expect(store.createRound).toHaveBeenCalledWith("t", 1, "league", "live");
    // 4 players → 2 games created.
    expect(store.createGame).toHaveBeenCalledTimes(2);
    expect(store.updateTournament).toHaveBeenCalledWith("t", {
      status: "league",
      current_round: 1,
    });
  });
});

describe("advanceRound", () => {
  it("pairs the next league round when rounds remain", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    const status = await advanceRound(tournament({ current_round: 1 }));
    expect(status).toBe("league");
    expect(store.setRoundStatus).toHaveBeenCalledWith("r1", "done");
    expect(store.createRound).toHaveBeenCalledWith("t", 2, "league", "live");
    expect(store.updateTournament).toHaveBeenCalledWith("t", { current_round: 2 });
    expect(maybeStartPlayoff).not.toHaveBeenCalled();
  });

  it("finishes after the last round when no playoff", async () => {
    store.listRounds.mockResolvedValue([round(3)]);
    maybeStartPlayoff.mockResolvedValue(false);
    const status = await advanceRound(tournament({ current_round: 3 }));
    expect(status).toBe("finished");
    expect(maybeStartPlayoff).toHaveBeenCalledOnce();
    expect(store.updateTournament).toHaveBeenCalledWith("t", { status: "finished" });
  });

  it("transitions to playoff after the last round when configured", async () => {
    store.listRounds.mockResolvedValue([round(3)]);
    maybeStartPlayoff.mockResolvedValue(true);
    const status = await advanceRound(
      tournament({
        current_round: 3,
        config: { leagueRounds: 3, playoff: true, playoffSize: 4, roundTimerSec: null },
      }),
    );
    expect(status).toBe("playoff");
  });

  it("finishes instead of pairing an empty round when <2 active remain", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.listPlayers.mockResolvedValue(players(1)); // everyone else left
    const status = await advanceRound(tournament({ current_round: 1 }));
    expect(status).toBe("finished");
    expect(store.updateTournament).toHaveBeenCalledWith("t", { status: "finished" });
    expect(store.createGame).not.toHaveBeenCalled(); // no empty round created
  });
});

describe("currentRoundResolved", () => {
  it("is false for an empty (0-game) round (not vacuously resolved)", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.listGamesForRound.mockResolvedValue([]);
    expect(await currentRoundResolved(tournament({ current_round: 1 }))).toBe(false);
  });

  it("is true when the round has games and none are live", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.listGamesForRound.mockResolvedValue([{ status: "white_win" }, { status: "bye" }]);
    expect(await currentRoundResolved(tournament({ current_round: 1 }))).toBe(true);
  });
});
