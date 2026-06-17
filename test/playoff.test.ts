import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player, Round, Tournament } from "@/lib/types";

const { store } = vi.hoisted(() => ({
  store: {
    listPlayers: vi.fn(),
    listGames: vi.fn(),
    listRounds: vi.fn(),
    listGamesForRound: vi.fn(),
    setPlayerSeed: vi.fn(),
    setRoundStatus: vi.fn(),
    createRound: vi.fn(),
    createGame: vi.fn(),
    updateTournament: vi.fn(),
  },
}));
vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));

import {
  advancePlayoff,
  maybeStartPlayoff,
  playoffRoundResolved,
  startCup,
} from "@/lib/server/playoff";

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: "t",
    join_pin: "000000",
    host_code: "AAAA-AA",
    host_user_id: null,
    title: null,
    status: "league",
    config: { leagueRounds: 3, playoff: true, playoffSize: 8, roundTimerSec: null },
    current_round: 3,
    created_at: "",
    ...over,
  };
}
function players(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    tournament_id: "t",
    display_name: `P${String(i + 1).padStart(2, "0")}`,
    resume_code: "AAAA-AA",
    score: 0,
    tiebreak: 0,
    status: "active" as const,
    seed: null,
    joined_at: "",
  }));
}
let gid = 0;
function game(
  white: string,
  black: string,
  status: Game["status"],
  slot?: number,
): Game {
  return {
    id: `g${gid++}`,
    tournament_id: "t",
    round_id: "pr1",
    white_player_id: white,
    black_player_id: black,
    fen: "",
    pgn: "",
    status,
    result_source: null,
    turn: "w",
    draw_offered_by: null,
    ...(slot !== undefined ? { slot } : {}),
    updated_at: "",
  };
}
const playoffRound = (number: number): Round => ({
  id: "pr1",
  tournament_id: "t",
  number,
  phase: "playoff",
  status: "live",
  started_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  gid = 0;
  store.createRound.mockResolvedValue(playoffRound(1));
  store.createGame.mockResolvedValue({});
  store.setPlayerSeed.mockResolvedValue(undefined);
});

describe("maybeStartPlayoff", () => {
  it("returns false when playoff is disabled", async () => {
    const t = tournament({ config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null } });
    expect(await maybeStartPlayoff(t)).toBe(false);
  });

  it("seeds top 8 and builds the first round (4 games)", async () => {
    store.listPlayers.mockResolvedValue(players(8));
    store.listGames.mockResolvedValue([]);
    const started = await maybeStartPlayoff(tournament());
    expect(started).toBe(true);
    expect(store.setPlayerSeed).toHaveBeenCalledTimes(8);
    expect(store.createRound).toHaveBeenCalledWith("t", 1, "playoff", "live");
    expect(store.createGame).toHaveBeenCalledTimes(4);
    expect(store.updateTournament).toHaveBeenCalledWith("t", {
      status: "playoff",
      current_round: 1,
    });
  });

  it("shrinks the bracket to fit fewer players (6 → 4)", async () => {
    store.listPlayers.mockResolvedValue(players(6));
    store.listGames.mockResolvedValue([]);
    await maybeStartPlayoff(tournament());
    expect(store.createGame).toHaveBeenCalledTimes(2); // 4-player bracket
  });
});

describe("startCup", () => {
  it("seeds all active players and builds round 1 (8 → 4 games)", async () => {
    store.listPlayers.mockResolvedValue(players(8));
    await startCup(tournament({ status: "lobby", current_round: 0 }));
    expect(store.setPlayerSeed).toHaveBeenCalledTimes(8);
    expect(store.createRound).toHaveBeenCalledWith("t", 1, "playoff", "live");
    expect(store.createGame).toHaveBeenCalledTimes(4);
    expect(store.updateTournament).toHaveBeenCalledWith("t", {
      status: "playoff",
      current_round: 1,
    });
  });

  it("pads a non-power-of-two field with byes (6 → 8-bracket)", async () => {
    store.listPlayers.mockResolvedValue(players(6));
    await startCup(tournament({ status: "lobby", current_round: 0 }));
    expect(store.setPlayerSeed).toHaveBeenCalledTimes(6); // only real players seeded
    expect(store.createGame).toHaveBeenCalledTimes(4); // 8-slot bracket → 4 matches
    const byes = store.createGame.mock.calls.filter((c) => c[0].blackPlayerId === null);
    expect(byes.length).toBe(2); // 8 − 6 = 2 first-round byes
  });

  it("throws when there are too few players", async () => {
    store.listPlayers.mockResolvedValue(players(1));
    await expect(startCup(tournament())).rejects.toThrow("not_enough_players");
  });
});

describe("advancePlayoff", () => {
  it("pairs winners into the next round", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listGamesForRound.mockResolvedValue([
      game("p1", "p8", "white_win", 0),
      game("p4", "p5", "white_win", 1),
      game("p2", "p7", "black_win", 2),
      game("p3", "p6", "white_win", 3),
    ]);
    const status = await advancePlayoff(tournament({ current_round: 1 }));
    expect(status).toBe("playoff");
    expect(store.setRoundStatus).toHaveBeenCalledWith("pr1", "done");
    expect(store.createRound).toHaveBeenCalledWith("t", 2, "playoff", "live");
    expect(store.createGame).toHaveBeenCalledTimes(2); // 4 winners → 2 games
    expect(store.updateTournament).toHaveBeenCalledWith("t", { current_round: 2 });
  });

  it("crowns the champion when the final is decided", async () => {
    store.listRounds.mockResolvedValue([playoffRound(3)]);
    store.listGamesForRound.mockResolvedValue([game("p1", "p2", "white_win")]);
    const status = await advancePlayoff(tournament({ current_round: 3 }));
    expect(status).toBe("finished");
    expect(store.updateTournament).toHaveBeenCalledWith("t", { status: "finished" });
    expect(store.createGame).not.toHaveBeenCalled();
  });

  it("pairs by SLOT order even when games resolved out of order", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    // fetch order = resolution order (updated_at), NOT bracket order:
    // slot 2 finished first, then 0, 3, 1. Bracket: slot0 p1v8, slot1 p4v5,
    // slot2 p2v7, slot3 p3v6.
    store.listGamesForRound.mockResolvedValue([
      game("p2", "p7", "white_win", 2),
      game("p1", "p8", "white_win", 0),
      game("p3", "p6", "white_win", 3),
      game("p4", "p5", "white_win", 1),
    ]);
    await advancePlayoff(tournament({ current_round: 1 }));
    expect(store.createGame).toHaveBeenCalledTimes(2);
    // semifinal 1 = winners of slots 0+1 (p1 vs p4); semifinal 2 = slots 2+3
    expect(store.createGame.mock.calls[0][0]).toMatchObject({
      whitePlayerId: "p1",
      blackPlayerId: "p4",
      slot: 0,
    });
    expect(store.createGame.mock.calls[1][0]).toMatchObject({
      whitePlayerId: "p2",
      blackPlayerId: "p3",
      slot: 1,
    });
  });

  it("spawns a tiebreak rematch (colours swapped) for a drawn game", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listPlayers.mockResolvedValue(players(8));
    store.listGamesForRound.mockResolvedValue([
      game("p1", "p8", "white_win", 0),
      game("p4", "p5", "draw", 1), // drawn → rematch
      game("p2", "p7", "black_win", 2),
      game("p3", "p6", "white_win", 3),
    ]);
    const status = await advancePlayoff(tournament({ current_round: 1 }));
    expect(status).toBe("tiebreak");
    expect(store.setRoundStatus).not.toHaveBeenCalled(); // round keeps playing
    expect(store.createRound).not.toHaveBeenCalled(); // no next round yet
    expect(store.updateTournament).not.toHaveBeenCalled(); // didn't advance
    expect(store.createGame).toHaveBeenCalledTimes(1);
    expect(store.createGame.mock.calls[0][0]).toMatchObject({
      roundId: "pr1", // SAME round
      whitePlayerId: "p5", // colours swapped from the drawn original
      blackPlayerId: "p4",
      slot: 1, // same bracket slot as the original
    });
  });

  it("resolveDrawsBySeed sends the higher seed through with NO rematch", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listPlayers.mockResolvedValue(
      players(8).map((p, i) => ({ ...p, seed: i + 1 })), // p1 seed 1 … p8 seed 8
    );
    store.listGamesForRound.mockResolvedValue([
      game("p1", "p8", "white_win", 0),
      game("p4", "p5", "draw", 1), // drawn — would normally spawn a rematch
      game("p2", "p7", "black_win", 2),
      game("p3", "p6", "white_win", 3),
    ]);
    const status = await advancePlayoff(tournament({ current_round: 1 }), {
      resolveDrawsBySeed: true,
    });
    expect(status).toBe("playoff"); // advanced immediately, no tiebreak
    expect(store.setRoundStatus).toHaveBeenCalledWith("pr1", "done");
    expect(store.createGame).toHaveBeenCalledTimes(2); // semifinals, NOT a rematch
    // slot 1's draw resolved to the higher seed p4 (seed 4 < p5 seed 5) → SF1 = p1 vs p4
    expect(store.createGame.mock.calls[0][0]).toMatchObject({
      whitePlayerId: "p1",
      blackPlayerId: "p4",
    });
  });

  it("advances the tiebreak winner once the rematch is decisive", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listPlayers.mockResolvedValue(players(8));
    store.listGamesForRound.mockResolvedValue([
      game("p1", "p8", "white_win", 0),
      game("p4", "p5", "draw", 1), // original draw
      game("p5", "p4", "white_win", 1), // rematch decisive → p5
      game("p2", "p7", "black_win", 2),
      game("p3", "p6", "white_win", 3),
    ]);
    const status = await advancePlayoff(tournament({ current_round: 1 }));
    expect(status).toBe("playoff");
    expect(store.setRoundStatus).toHaveBeenCalledWith("pr1", "done");
    expect(store.createGame).toHaveBeenCalledTimes(2); // semifinals
    // slot1 resolved to the rematch winner p5 → SF1 = p1 vs p5
    expect(store.createGame.mock.calls[0][0]).toMatchObject({
      whitePlayerId: "p1",
      blackPlayerId: "p5",
    });
  });

  it("advances a cup bye straight to the next round", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listGamesForRound.mockResolvedValue([
      game("p1", null as unknown as string, "bye", 0),
      game("p4", "p5", "white_win", 1),
      game("p2", null as unknown as string, "bye", 2),
      game("p3", "p6", "black_win", 3),
    ]);
    await advancePlayoff(tournament({ current_round: 1 }));
    expect(store.createGame.mock.calls[0][0]).toMatchObject({
      whitePlayerId: "p1",
      blackPlayerId: "p4",
    });
    expect(store.createGame.mock.calls[1][0]).toMatchObject({
      whitePlayerId: "p2",
      blackPlayerId: "p6",
    });
  });

  it("uses draw-odds (higher seed) when the tiebreak is also drawn", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    // seed = i+1, so p4 (seed 4) outranks p5 (seed 5).
    store.listPlayers.mockResolvedValue(
      players(8).map((p, i) => ({ ...p, seed: i + 1 })),
    );
    store.listGamesForRound.mockResolvedValue([
      game("p1", "p8", "white_win", 0),
      game("p4", "p5", "draw", 1),
      game("p5", "p4", "draw", 1), // rematch ALSO drawn
      game("p2", "p7", "black_win", 2),
      game("p3", "p6", "white_win", 3),
    ]);
    const status = await advancePlayoff(tournament({ current_round: 1 }));
    expect(status).toBe("playoff");
    expect(store.createGame).toHaveBeenCalledTimes(2);
    // slot1 → p4 (higher seed) advances by draw-odds: SF1 = p1 vs p4
    expect(store.createGame.mock.calls[0][0]).toMatchObject({
      whitePlayerId: "p1",
      blackPlayerId: "p4",
    });
  });

  it("a drawn final spawns a tiebreak, then crowns the higher seed", async () => {
    store.listRounds.mockResolvedValue([playoffRound(3)]);
    store.listPlayers.mockResolvedValue(
      players(8).map((p, i) => ({ ...p, seed: i + 1 })),
    );
    // Pass 1: final drawn → rematch spawned, not finished.
    store.listGamesForRound.mockResolvedValueOnce([game("p1", "p2", "draw", 0)]);
    expect(await advancePlayoff(tournament({ current_round: 3 }))).toBe("tiebreak");
    expect(store.updateTournament).not.toHaveBeenCalled();
    // Pass 2: rematch also drawn → champion is the higher seed (p1).
    store.listGamesForRound.mockResolvedValueOnce([
      game("p1", "p2", "draw", 0),
      game("p2", "p1", "draw", 0),
    ]);
    const status = await advancePlayoff(tournament({ current_round: 3 }));
    expect(status).toBe("finished");
    expect(store.updateTournament).toHaveBeenCalledWith("t", { status: "finished" });
    expect(store.createGame).toHaveBeenCalledTimes(1); // only the pass-1 rematch
  });
});

describe("playoffRoundResolved", () => {
  it("is false while a game is live", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listGamesForRound.mockResolvedValue([game("p1", "p2", "live")]);
    expect(await playoffRoundResolved(tournament({ current_round: 1 }))).toBe(false);
  });
  it("is true when all are resolved", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listGamesForRound.mockResolvedValue([game("p1", "p2", "white_win")]);
    expect(await playoffRoundResolved(tournament({ current_round: 1 }))).toBe(true);
  });
});
