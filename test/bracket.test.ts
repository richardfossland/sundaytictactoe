import { describe, expect, it } from "vitest";
import {
  cupBracketSize,
  sortBySlot,
  bracketRounds,
  buildFirstRound,
  effectivePlayoffSize,
  nextRound,
  seedOrder,
  type BracketMatch,
  type SeededPlayer,
} from "@/lib/tournament/bracket";

describe("effectivePlayoffSize", () => {
  it("returns 0 when playoff is off", () => {
    expect(effectivePlayoffSize(0, 20)).toBe(0);
  });
  it("shrinks to nearest power of two <= player count", () => {
    expect(effectivePlayoffSize(8, 8)).toBe(8);
    expect(effectivePlayoffSize(8, 6)).toBe(4);
    expect(effectivePlayoffSize(16, 10)).toBe(8);
    expect(effectivePlayoffSize(16, 3)).toBe(2); // 3 players → a 2-player final
    expect(effectivePlayoffSize(8, 2)).toBe(2); // 2 students → still a final
    expect(effectivePlayoffSize(8, 1)).toBe(0); // 1 player → no playoff
  });
});

describe("seedOrder", () => {
  it("pairs 1vN, 2v(N-1) and balances the bracket", () => {
    expect(seedOrder(4)).toEqual([
      [1, 4],
      [2, 3],
    ]);
    // size 8 — canonical order; seed 1 and 2 only meet in the final.
    const o8 = seedOrder(8);
    expect(o8).toHaveLength(4);
    expect(o8).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
    // every seed 1..8 appears exactly once
    const seen = new Set(o8.flat());
    expect(seen.size).toBe(8);
    // seed 1 (top half) and seed 2 (bottom half) are in opposite halves.
    const topHalf = o8.slice(0, 2).flat();
    const bottomHalf = o8.slice(2).flat();
    expect(topHalf).toContain(1);
    expect(bottomHalf).toContain(2);
  });
});

describe("buildFirstRound + nextRound", () => {
  it("resolves an 8-player bracket to a single winner", () => {
    const seeded: SeededPlayer[] = Array.from({ length: 8 }, (_, i) => ({
      playerId: `p${i + 1}`,
      seed: i + 1,
    }));
    let round = buildFirstRound(seeded);
    expect(round).toHaveLength(4);
    expect(bracketRounds(8)).toBe(3);

    let totalRounds = 0;
    while (round.length >= 1) {
      totalRounds++;
      // Top seed always wins (deterministic).
      round.forEach((m: BracketMatch) => {
        m.winnerPlayerId =
          (m.topSeed ?? 99) <= (m.bottomSeed ?? 99)
            ? m.topPlayerId
            : m.bottomPlayerId;
      });
      const nxt = nextRound(round);
      if (nxt.length === 0) break;
      round = nxt;
    }

    expect(totalRounds).toBe(3);
    expect(round).toHaveLength(1);
    expect(round[0].winnerPlayerId).toBe("p1"); // top seed wins out
  });
});

describe("cupBracketSize", () => {
  it("rounds up to the next power of two", () => {
    expect(cupBracketSize(2)).toBe(2);
    expect(cupBracketSize(3)).toBe(4);
    expect(cupBracketSize(5)).toBe(8);
    expect(cupBracketSize(8)).toBe(8);
    expect(cupBracketSize(19)).toBe(32);
  });
  it("needs at least 2 players, scales past 32, caps at 256", () => {
    expect(cupBracketSize(1)).toBe(0);
    expect(cupBracketSize(60)).toBe(64); // no longer silently capped at 32
    expect(cupBracketSize(200)).toBe(256);
    expect(cupBracketSize(500)).toBe(256); // hard cap (beyond any real event)
  });
});

describe("buildFirstRound with byes (cup)", () => {
  it("gives top seeds byes when the bracket is bigger than the field", () => {
    const seeded = [1, 2, 3, 4, 5].map((s) => ({ playerId: `p${s}`, seed: s }));
    const matches = buildFirstRound(seeded, 8);
    expect(matches).toHaveLength(4);
    // seed order for 8: [1,8] [4,5] [2,7] [3,6] — seeds 6,7,8 are absent
    const byes = matches.filter((m) => m.topPlayerId && !m.bottomPlayerId);
    expect(byes.map((m) => m.topPlayerId).sort()).toEqual(["p1", "p2", "p3"]);
    // the only real round-1 game is 4 vs 5
    const real = matches.filter((m) => m.topPlayerId && m.bottomPlayerId);
    expect(real).toHaveLength(1);
    expect([real[0].topPlayerId, real[0].bottomPlayerId].sort()).toEqual(["p4", "p5"]);
    // no match is ever entirely empty
    expect(matches.every((m) => m.topPlayerId !== null)).toBe(true);
  });
});

describe("sortBySlot", () => {
  it("orders by slot and keeps fetch order for equal slots (stable)", () => {
    const games = [
      { id: "c", slot: 2 },
      { id: "a", slot: 0 },
      { id: "x" }, // legacy, no slot
      { id: "b", slot: 0 },
    ];
    expect(sortBySlot(games).map((g) => g.id)).toEqual(["a", "x", "b", "c"]);
  });
});

describe("cup with 6 players (bracket of 8)", () => {
  it("places byes so round 2 pairs bye-winners with game-winners", () => {
    const seeded = [1, 2, 3, 4, 5, 6].map((s) => ({ playerId: `p${s}`, seed: s }));
    const matches = buildFirstRound(seeded, 8);
    // seedOrder(8): [1,8] [4,5] [2,7] [3,6] → seeds 7,8 missing
    expect(matches.map((m) => [m.topPlayerId, m.bottomPlayerId])).toEqual([
      ["p1", null],
      ["p4", "p5"],
      ["p2", null],
      ["p3", "p6"],
    ]);
    // slot-adjacent pairing: p1 meets w(4,5); p2 meets w(3,6) — 1 and 2 apart
  });
});
