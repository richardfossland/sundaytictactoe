import { beforeEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({
  store: {
    createTournament: vi.fn(),
    addPlayer: vi.fn(),
    getTournament: vi.fn(),
    getTournamentByPin: vi.fn(),
    listPlayers: vi.fn(),
    listGames: vi.fn(),
    listRounds: vi.fn(),
    createRound: vi.fn(),
    createGame: vi.fn(),
    updateTournament: vi.fn(),
  },
}));
vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));

import { createCasualGame, joinCasualGame, rematchCasual } from "@/lib/server/casual";

beforeEach(() => {
  vi.clearAllMocks();
  store.createRound.mockResolvedValue({ id: "r1" });
  store.createGame.mockResolvedValue({ id: "g1" });
  store.updateTournament.mockResolvedValue(undefined);
});

describe("createCasualGame", () => {
  it("creates a casual tournament and adds the challenger", async () => {
    store.createTournament.mockResolvedValue({ id: "t1", join_pin: "123456" });
    store.addPlayer.mockResolvedValue({ id: "pa", resume_code: "AAAA-AA", display_name: "Ada" });
    const r = await createCasualGame("Ada");
    expect(store.createTournament).toHaveBeenCalledWith(
      "Vennekamp",
      expect.objectContaining({ casual: true }),
    );
    expect(r).toMatchObject({
      tournamentId: "t1",
      joinPin: "123456",
      playerId: "pa",
      resumeCode: "AAAA-AA",
      displayName: "Ada",
    });
  });
});

describe("joinCasualGame", () => {
  it("adds the second player and auto-starts one game (both colours filled)", async () => {
    store.getTournamentByPin.mockResolvedValue({ id: "t1", config: { casual: true } });
    // First read = capacity check (challenger only); second read = post-join seat
    // check (now includes the joiner, in join order).
    store.listPlayers
      .mockResolvedValueOnce([
        { id: "pa", resume_code: "AAAA-AA", display_name: "Ada" },
      ])
      .mockResolvedValue([
        { id: "pa", resume_code: "AAAA-AA", display_name: "Ada" },
        { id: "pb", resume_code: "BBBB-BB", display_name: "Bo" },
      ]);
    store.addPlayer.mockResolvedValue({ id: "pb", resume_code: "BBBB-BB", display_name: "Bo" });

    const res = await joinCasualGame("123456", "Bo");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.gameId).toBe("g1");
      expect(res.playerId).toBe("pb");
      expect(res.resumeCode).toBe("BBBB-BB");
    }
    expect(store.createGame).toHaveBeenCalledTimes(1);
    const g = store.createGame.mock.calls[0][0];
    expect(new Set([g.whitePlayerId, g.blackPlayerId])).toEqual(new Set(["pa", "pb"]));
    expect(store.updateTournament).toHaveBeenCalledWith("t1", {
      status: "league",
      current_round: 1,
    });
  });

  it("rejects an unknown code", async () => {
    store.getTournamentByPin.mockResolvedValue(null);
    expect(await joinCasualGame("000000", "Bo")).toEqual({ ok: false, reason: "not_found" });
    expect(store.createGame).not.toHaveBeenCalled();
  });

  it("rejects a non-casual tournament code", async () => {
    store.getTournamentByPin.mockResolvedValue({ id: "t1", config: {} });
    expect(await joinCasualGame("123456", "Bo")).toEqual({ ok: false, reason: "not_casual" });
  });

  it("rejects when the match is already full", async () => {
    store.getTournamentByPin.mockResolvedValue({ id: "t1", config: { casual: true } });
    store.listPlayers.mockResolvedValue([{ id: "pa" }, { id: "pb" }]);
    expect(await joinCasualGame("123456", "Cy")).toEqual({ ok: false, reason: "full" });
    expect(store.addPlayer).not.toHaveBeenCalled();
  });

  it("rejects a racing over-join with a clean 'full' (no duplicate game)", async () => {
    store.getTournamentByPin.mockResolvedValue({ id: "t1", config: { casual: true } });
    // Capacity check passes (1 seat free), but a concurrent joiner took seat 1
    // first — by the post-join re-read this joiner is seat 2 → full, no game.
    store.listPlayers
      .mockResolvedValueOnce([{ id: "pa" }])
      .mockResolvedValue([{ id: "pa" }, { id: "pb" }, { id: "pc" }]);
    store.addPlayer.mockResolvedValue({ id: "pc", resume_code: "CCCC-CC", display_name: "Cy" });
    expect(await joinCasualGame("123456", "Cy")).toEqual({ ok: false, reason: "full" });
    expect(store.createGame).not.toHaveBeenCalled();
  });
});

describe("rematchCasual", () => {
  it("creates a new game with the colours swapped", async () => {
    store.getTournament.mockResolvedValue({ id: "t1", config: { casual: true } });
    store.listPlayers.mockResolvedValue([{ id: "pa" }, { id: "pb" }]);
    store.listGames.mockResolvedValue([
      { id: "g1", status: "white_win", white_player_id: "pa", black_player_id: "pb" },
    ]);
    store.listRounds.mockResolvedValue([{ number: 1 }]);
    store.createRound.mockResolvedValue({ id: "r2" });
    store.createGame.mockResolvedValue({ id: "g2" });

    const res = await rematchCasual("t1", "pa");
    expect(res).toEqual({ ok: true, gameId: "g2" });
    expect(store.createRound).toHaveBeenCalledWith("t1", 2, "league", "live");
    const g = store.createGame.mock.calls[0][0];
    expect(g.whitePlayerId).toBe("pb"); // old black is now white
    expect(g.blackPlayerId).toBe("pa");
  });

  it("is idempotent: returns the already-live rematch", async () => {
    store.getTournament.mockResolvedValue({ id: "t1", config: { casual: true } });
    store.listPlayers.mockResolvedValue([{ id: "pa" }, { id: "pb" }]);
    store.listGames.mockResolvedValue([
      { id: "gLive", status: "live", white_player_id: "pb", black_player_id: "pa" },
    ]);
    const res = await rematchCasual("t1", "pb");
    expect(res).toEqual({ ok: true, gameId: "gLive" });
    expect(store.createGame).not.toHaveBeenCalled();
  });

  it("rejects someone who isn't in the session", async () => {
    store.getTournament.mockResolvedValue({ id: "t1", config: { casual: true } });
    store.listPlayers.mockResolvedValue([{ id: "pa" }, { id: "pb" }]);
    expect(await rematchCasual("t1", "px")).toEqual({ ok: false, reason: "not_player" });
  });
});
