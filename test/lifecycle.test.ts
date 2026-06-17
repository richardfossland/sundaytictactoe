import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Tournament } from "@/lib/types";

const { store } = vi.hoisted(() => ({
  store: {
    listGames: vi.fn(),
    finishIfActive: vi.fn(),
  },
}));
vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));

import {
  STALE_MS,
  autoFinishEligible,
  isStale,
  lastActivityMs,
  maybeAutoFinishStale,
} from "@/lib/server/lifecycle";

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
    created_at: "2020-01-01T00:00:00.000Z",
    ...over,
  };
}
function game(updatedAt: string): Game {
  return {
    id: "g",
    tournament_id: "t",
    round_id: "r",
    white_player_id: "p1",
    black_player_id: "p2",
    fen: "",
    pgn: "",
    status: "live",
    result_source: null,
    turn: "w",
    draw_offered_by: null,
    slot: 0,
    updated_at: updatedAt,
  };
}

describe("lastActivityMs", () => {
  it("falls back to created_at when there are no games", () => {
    const t = tournament({ created_at: "2024-06-01T10:00:00.000Z" });
    expect(lastActivityMs(t, [])).toBe(Date.parse("2024-06-01T10:00:00.000Z"));
  });
  it("uses the freshest game updated_at when newer than created_at", () => {
    const t = tournament({ created_at: "2024-06-01T10:00:00.000Z" });
    const games = [game("2024-06-01T10:05:00.000Z"), game("2024-06-01T10:30:00.000Z")];
    expect(lastActivityMs(t, games)).toBe(Date.parse("2024-06-01T10:30:00.000Z"));
  });
  it("ignores unparseable timestamps", () => {
    const t = tournament({ created_at: "2024-06-01T10:00:00.000Z" });
    expect(lastActivityMs(t, [game("not-a-date")])).toBe(
      Date.parse("2024-06-01T10:00:00.000Z"),
    );
  });
});

describe("isStale", () => {
  const now = Date.parse("2024-06-02T00:00:00.000Z");
  it("is true past the 12h threshold", () => {
    expect(isStale(now - STALE_MS - 1000, now)).toBe(true);
  });
  it("is false within the threshold", () => {
    expect(isStale(now - STALE_MS + 1000, now)).toBe(false);
    expect(isStale(now - 60_000, now)).toBe(false);
  });
});

describe("autoFinishEligible", () => {
  it("only league and playoff are eligible", () => {
    expect(autoFinishEligible("league")).toBe(true);
    expect(autoFinishEligible("playoff")).toBe(true);
    expect(autoFinishEligible("lobby")).toBe(false);
    expect(autoFinishEligible("finished")).toBe(false);
  });
});

describe("maybeAutoFinishStale", () => {
  beforeEach(() => {
    store.listGames.mockReset();
    store.finishIfActive.mockReset();
  });

  it("finishes a stale league tournament and returns the updated row", async () => {
    const t = tournament({ status: "league", created_at: "2020-01-01T00:00:00.000Z" });
    store.finishIfActive.mockResolvedValue({ ...t, status: "finished" });
    const res = await maybeAutoFinishStale(t, [game("2020-01-01T00:10:00.000Z")]);
    expect(store.finishIfActive).toHaveBeenCalledWith("t");
    expect(res.status).toBe("finished");
  });

  it("stays quiet (returns finished view) when a concurrent caller already finished it", async () => {
    const t = tournament({ status: "league", created_at: "2020-01-01T00:00:00.000Z" });
    store.finishIfActive.mockResolvedValue(null); // someone else won the race
    const res = await maybeAutoFinishStale(t, [game("2020-01-01T00:10:00.000Z")]);
    expect(store.finishIfActive).toHaveBeenCalledWith("t");
    expect(res.status).toBe("finished");
  });

  it("leaves a fresh tournament untouched", async () => {
    const fresh = new Date().toISOString();
    const t = tournament({ status: "playoff", created_at: fresh });
    const res = await maybeAutoFinishStale(t, [game(fresh)]);
    expect(store.finishIfActive).not.toHaveBeenCalled();
    expect(res).toBe(t);
  });

  it("is a no-op for non-active statuses even when old", async () => {
    const t = tournament({ status: "lobby", created_at: "2020-01-01T00:00:00.000Z" });
    const res = await maybeAutoFinishStale(t, []);
    expect(store.listGames).not.toHaveBeenCalled();
    expect(store.finishIfActive).not.toHaveBeenCalled();
    expect(res).toBe(t);
  });

  it("fetches games itself when not supplied", async () => {
    const t = tournament({ status: "league", created_at: "2020-01-01T00:00:00.000Z" });
    store.listGames.mockResolvedValue([game("2020-01-01T00:10:00.000Z")]);
    store.finishIfActive.mockResolvedValue({ ...t, status: "finished" });
    const res = await maybeAutoFinishStale(t);
    expect(store.listGames).toHaveBeenCalledWith("t");
    expect(res.status).toBe("finished");
  });
});
