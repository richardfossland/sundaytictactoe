import { describe, expect, it } from "vitest";
import { pair, pairKey, type PairablePlayer } from "@/lib/tournament/pair";
import type { Rng } from "@/lib/codes";

const constRng = (v: number): Rng => () => v;

function players(n: number, scores?: number[]): PairablePlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    score: scores?.[i] ?? 0,
    tiebreak: 0,
  }));
}

describe("pairKey", () => {
  it("is order-independent", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});

describe("round 1 pairing", () => {
  it("pairs everyone and gives no bye when even", () => {
    const result = pair({ players: players(8), round: 1, rng: constRng(0) });
    const byes = result.filter((g) => g.blackId === null);
    expect(byes).toHaveLength(0);
    expect(result).toHaveLength(4);
    const seen = new Set<string>();
    for (const g of result) {
      seen.add(g.whiteId);
      if (g.blackId) seen.add(g.blackId);
    }
    expect(seen.size).toBe(8);
  });

  it("gives exactly one bye when odd", () => {
    const result = pair({ players: players(9), round: 1, rng: constRng(0) });
    const byes = result.filter((g) => g.blackId === null);
    expect(byes).toHaveLength(1);
    // 4 real games + 1 bye
    expect(result).toHaveLength(5);
  });
});

describe("round >=2 pairing", () => {
  it("pairs equal-score players together", () => {
    // p1,p2 on 1 point; p3,p4 on 0. Should pair p1-p2 and p3-p4.
    const result = pair({
      players: players(4, [1, 1, 0, 0]),
      round: 2,
      rng: constRng(0),
    });
    const keys = result.map((g) => pairKey(g.whiteId, g.blackId!));
    expect(keys).toContain(pairKey("p1", "p2"));
    expect(keys).toContain(pairKey("p3", "p4"));
  });

  it("avoids a rematch when an alternative exists", () => {
    const met = new Set([pairKey("p1", "p2")]);
    const result = pair({
      players: players(4, [1, 1, 1, 1]),
      round: 2,
      metBefore: met,
      rng: constRng(0),
    });
    const keys = result.map((g) => pairKey(g.whiteId, g.blackId!));
    expect(keys).not.toContain(pairKey("p1", "p2"));
  });

  it("avoids an avoidable rematch that naive greedy would force", () => {
    // p3 & p4 already met; a top-down greedy pairs p1-p2 then strands p3-p4
    // into a rematch. The backtracking matcher finds p1-p3 / p2-p4 instead.
    const met = new Set([pairKey("p3", "p4")]);
    const result = pair({
      players: players(4, [1, 1, 1, 1]),
      round: 2,
      metBefore: met,
      rng: constRng(0),
    });
    const keys = result.map((g) => pairKey(g.whiteId, g.blackId!));
    expect(keys).not.toContain(pairKey("p3", "p4"));
    expect(result.every((g) => !g.rematch)).toBe(true);
  });

  it("gives the bye to the lowest scorer without one", () => {
    // p5 lowest score → should get the bye.
    const result = pair({
      players: players(5, [4, 3, 2, 1, 0]),
      round: 2,
      rng: constRng(0),
    });
    const bye = result.find((g) => g.blackId === null);
    expect(bye?.whiteId).toBe("p5");
  });

  it("does not give the same player a second bye if avoidable", () => {
    const hadBye = new Set(["p5"]);
    const result = pair({
      players: players(5, [4, 3, 2, 1, 0]),
      round: 3,
      hadBye,
      rng: constRng(0),
    });
    const bye = result.find((g) => g.blackId === null);
    expect(bye?.whiteId).not.toBe("p5");
    expect(bye?.whiteId).toBe("p4"); // next lowest without a bye
  });

  it("spreads a repeat bye to the player with the FEWEST byes", () => {
    // Everyone has had a bye, but p5 has had two — it must not get a third.
    const result = pair({
      players: players(5, [4, 3, 2, 1, 0]),
      round: 4,
      byeCounts: new Map([
        ["p1", 1],
        ["p2", 1],
        ["p3", 1],
        ["p4", 1],
        ["p5", 2],
      ]),
      rng: constRng(0),
    });
    const bye = result.find((g) => g.blackId === null);
    expect(bye?.whiteId).not.toBe("p5"); // not a third free point
    expect(bye?.whiteId).toBe("p4"); // lowest-ranked among the fewest-bye players
  });
});

describe("full 9-player / 5-round league simulation", () => {
  it("produces valid pairings every round with a rotating bye", () => {
    const ids = players(9);
    const scores = new Map(ids.map((p) => [p.id, 0]));
    const met = new Set<string>();
    const byes = new Set<string>();
    const rng = constRng(0.42);

    for (let round = 1; round <= 5; round++) {
      const pool: PairablePlayer[] = ids.map((p) => ({
        id: p.id,
        score: scores.get(p.id)!,
        tiebreak: 0,
      }));
      const result = pair({
        players: pool,
        round,
        metBefore: met,
        hadBye: byes,
        rng,
      });

      // Exactly one bye each round (odd count), everyone appears once.
      const appear = new Set<string>();
      let byeCount = 0;
      for (const g of result) {
        expect(appear.has(g.whiteId)).toBe(false);
        appear.add(g.whiteId);
        if (g.blackId === null) {
          byeCount++;
          byes.add(g.whiteId);
          scores.set(g.whiteId, scores.get(g.whiteId)! + 1);
        } else {
          expect(appear.has(g.blackId)).toBe(false);
          appear.add(g.blackId);
          met.add(pairKey(g.whiteId, g.blackId));
          // Deterministic result: white wins, to spread scores.
          scores.set(g.whiteId, scores.get(g.whiteId)! + 1);
        }
      }
      expect(byeCount).toBe(1);
      expect(appear.size).toBe(9);
    }

    // Bye rotated to distinct players across 5 rounds.
    expect(byes.size).toBe(5);
  });
});

describe("hard edges", () => {
  it("forces a rematch (with the flag) when every pair has already met", () => {
    const ps = players(4, [2, 1.5, 1, 0.5]);
    const met = new Set<string>();
    for (const a of ps) for (const b of ps) if (a.id < b.id) met.add(pairKey(a.id, b.id));
    const result = pair({ players: ps, round: 4, metBefore: met, rng: constRng(0) });
    expect(result).toHaveLength(2);
    // pairing must still be complete and some game must carry the rematch flag
    const ids = new Set(result.flatMap((g) => [g.whiteId, g.blackId]));
    expect(ids.size).toBe(4);
    expect(result.some((g) => g.rematch)).toBe(true);
  });

  it("pairs cleanly after a player leaves mid-tournament (6 → 5 pool)", () => {
    const ps = players(6, [2, 2, 1, 1, 0, 0]).slice(0, 5); // p6 left
    const result = pair({
      players: ps,
      round: 3,
      hadBye: new Set(["p5"]), // lowest scorer already had one
      rng: constRng(0),
    });
    const byes = result.filter((g) => g.blackId === null);
    expect(byes).toHaveLength(1);
    expect(byes[0].whiteId).not.toBe("p5"); // bye respects hadBye
    const ids = new Set(result.flatMap((g) => (g.blackId ? [g.whiteId, g.blackId] : [g.whiteId])));
    expect(ids.size).toBe(5);
  });

  it("survives a single remaining player (bye only)", () => {
    const result = pair({ players: players(1), round: 2, rng: constRng(0) });
    expect(result).toHaveLength(1);
    expect(result[0].blackId).toBeNull();
  });
});
