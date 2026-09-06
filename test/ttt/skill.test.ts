// Adaptive solo difficulty. Two things are being pinned here:
//
//   1. the RAMP's endpoints and its smoothness. The whole point of the feature
//      is that there is no longer a cliff between "throws away three moves in
//      five" and "cannot be beaten", so a test that only checked the middle
//      value would miss the regression that matters.
//   2. the rating's CONVERGENCE. An Elo update is easy to get subtly wrong
//      (sign, K, clamping) and the symptom — a bot that drifts to one end and
//      stays there — takes a child a whole lesson to notice.

import { describe, expect, it } from "vitest";
import {
  botSkillForPlayer,
  clampSkill,
  DEFAULT_SKILL,
  expectedScore,
  FLOOR_RANDOM_MOVE_PROB,
  INITIAL_RATING,
  kFactor,
  MAX_SKILL,
  MIN_SKILL,
  outcomeToScore,
  skillToParams,
  updateRating,
  type RatingState,
} from "@/lib/ttt/skill";
import { chooseMove, fullDepth } from "@/lib/ttt/bot";
import { VARIANTS, variantById, variantStartState } from "@/lib/ttt/variants";

/** Same deterministic generator the bot tests use. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("skillToParams endpoints", () => {
  it("bottoms out at exactly today's 'Lett'", () => {
    for (const v of VARIANTS) {
      expect(skillToParams(MIN_SKILL, v)).toEqual({
        maxDepth: 1,
        randomMoveProb: FLOOR_RANDOM_MOVE_PROB,
      });
    }
  });

  it("tops out at exactly today's 'Uslåelig'", () => {
    for (const v of VARIANTS) {
      expect(skillToParams(MAX_SKILL, v)).toEqual({
        maxDepth: fullDepth(v),
        randomMoveProb: 0,
      });
    }
  });

  it("never exceeds the board's search ceiling", () => {
    for (const v of VARIANTS) {
      for (let s = MIN_SKILL; s <= MAX_SKILL; s += 25) {
        const p = skillToParams(s, v);
        expect(p.maxDepth).toBeGreaterThanOrEqual(1);
        expect(p.maxDepth).toBeLessThanOrEqual(fullDepth(v));
        expect(p.randomMoveProb).toBeGreaterThanOrEqual(0);
        expect(p.randomMoveProb).toBeLessThanOrEqual(FLOOR_RANDOM_MOVE_PROB);
      }
    }
  });

  it("defaults to the 3×3 ceiling when no variant is given", () => {
    expect(skillToParams(MAX_SKILL)).toEqual(skillToParams(MAX_SKILL, VARIANTS[0]));
  });
});

describe("skillToParams has no cliff", () => {
  // The regression this feature exists to prevent: easy→medium used to change
  // the blunder rate by 40 percentage points in one click.
  it("moves gradually, in both knobs, over the whole range", () => {
    for (const v of VARIANTS) {
      let prev = skillToParams(MIN_SKILL, v);
      for (let s = MIN_SKILL + 50; s <= MAX_SKILL; s += 50) {
        const cur = skillToParams(s, v);
        expect(cur.maxDepth - prev.maxDepth, `depth jump at ${s} on ${v.id}`)
          .toBeLessThanOrEqual(1);
        expect(cur.maxDepth).toBeGreaterThanOrEqual(prev.maxDepth); // monotonic
        expect(prev.randomMoveProb - cur.randomMoveProb, `blunder jump at ${s}`)
          .toBeLessThan(0.05);
        expect(cur.randomMoveProb).toBeLessThanOrEqual(prev.randomMoveProb);
        prev = cur;
      }
    }
  });

  it("puts a brand-new player strictly between the two old extremes", () => {
    const p = skillToParams(DEFAULT_SKILL);
    expect(p.randomMoveProb).toBeGreaterThan(0);
    expect(p.randomMoveProb).toBeLessThan(FLOOR_RANDOM_MOVE_PROB);
    expect(p.maxDepth).toBeGreaterThanOrEqual(1);
    expect(p.maxDepth).toBeLessThan(fullDepth(VARIANTS[0]));
  });
});

describe("clampSkill", () => {
  it("holds the range and survives nonsense", () => {
    expect(clampSkill(-5)).toBe(MIN_SKILL);
    expect(clampSkill(99_999)).toBe(MAX_SKILL);
    expect(clampSkill(1234)).toBe(1234);
    expect(clampSkill(Number.NaN)).toBe(DEFAULT_SKILL);
    expect(clampSkill(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SKILL);
  });

  it("clamps inside skillToParams too", () => {
    expect(skillToParams(-1000)).toEqual(skillToParams(MIN_SKILL));
    expect(skillToParams(1e9)).toEqual(skillToParams(MAX_SKILL));
  });
});

describe("Elo pieces", () => {
  it("scores outcomes from the player's side", () => {
    expect(outcomeToScore("win")).toBe(1);
    expect(outcomeToScore("draw")).toBe(0.5);
    expect(outcomeToScore("loss")).toBe(0);
  });

  it("expects an even score against an equal opponent", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 10);
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.5);
    expect(expectedScore(1000, 1400)).toBeLessThan(0.5);
  });

  it("calibrates fast, then settles", () => {
    expect(kFactor(0)).toBe(80);
    expect(kFactor(4)).toBe(80);
    expect(kFactor(5)).toBe(48);
    expect(kFactor(14)).toBe(48);
    expect(kFactor(15)).toBe(32);
    expect(kFactor(500)).toBe(32);
  });
});

describe("updateRating", () => {
  const even: RatingState = { rating: 1000, games: 20 }; // K = 32

  it("moves up on a win and down on a loss, by the same amount", () => {
    const won = updateRating(even, 1000, 1);
    const lost = updateRating(even, 1000, 0);
    expect(won.rating).toBe(1016); // 1000 + 32 * (1 - 0.5)
    expect(lost.rating).toBe(984);
    expect(won.games).toBe(21);
  });

  it("leaves a draw against an equal bot where it was", () => {
    expect(updateRating(even, 1000, 0.5).rating).toBe(1000);
  });

  it("stays inside the range however lopsided the run", () => {
    let low = INITIAL_RATING;
    let high = INITIAL_RATING;
    // Long enough to overshoot both ends: a mirror bot only ever moves the
    // rating by K/2 a game, so the clamp is what has to stop it, not the loop.
    for (let i = 0; i < 100; i++) {
      low = updateRating(low, botSkillForPlayer(low), 0);
      high = updateRating(high, botSkillForPlayer(high), 1);
    }
    expect(low.rating).toBe(MIN_SKILL);
    expect(high.rating).toBe(MAX_SKILL);
  });

  it("auto-tunes the bot toward the player it keeps beating", () => {
    let st = INITIAL_RATING;
    const before = skillToParams(botSkillForPlayer(st));
    for (let i = 0; i < 30; i++) st = updateRating(st, botSkillForPlayer(st), 1);
    const after = skillToParams(botSkillForPlayer(st));
    expect(st.rating).toBeGreaterThan(DEFAULT_SKILL);
    expect(after.maxDepth).toBeGreaterThan(before.maxDepth);
    expect(after.randomMoveProb).toBeLessThan(before.randomMoveProb);
  });

  it("holds a rating steady for a player who wins half", () => {
    let st: RatingState = { rating: 1200, games: 40 };
    for (let i = 0; i < 40; i++) {
      st = updateRating(st, botSkillForPlayer(st), i % 2 === 0 ? 1 : 0);
    }
    // The bot mirrors the player every game, so alternating results should
    // leave the rating essentially where it started.
    expect(Math.abs(st.rating - 1200)).toBeLessThanOrEqual(20);
  });
});

describe("chooseMove with params", () => {
  it("plays EXACTLY like 'Uslåelig' at the top of the ramp", () => {
    // The ramp's ceiling is not merely 'close to' the old top level: same
    // win/block short-circuit, same depth, no blunder roll, so the same move.
    for (const v of VARIANTS) {
      const params = skillToParams(MAX_SKILL, v);
      const boards = [
        variantStartState(v),
        variantStartState(v).replace(".", "x"),
        v.id === "3x3" ? "xx..o...." : variantStartState(v).slice(0, -2) + "xo",
      ];
      for (const state of boards) {
        expect(
          chooseMove(state, v, "impossible", seeded(7), params),
          `${v.id} / ${state}`,
        ).toBe(chooseMove(state, v, "impossible", seeded(7)));
      }
    }
  });

  it("blunders at the rate it is given", () => {
    const v = variantById("3x3");
    // rng always returns 0 → below any positive probability → random cell.
    const always = chooseMove("xx..o....", v, "impossible", () => 0, {
      maxDepth: 9,
      randomMoveProb: 1,
    });
    // With the blunder roll turned off the same position is a forced win on 2.
    const never = chooseMove("xx..o....", v, "impossible", () => 0, {
      maxDepth: 9,
      randomMoveProb: 0,
    });
    expect(never).toBe(2);
    expect(always).toBe(2 /* rng()=0 picks the first empty cell, which is 2 */);
    // …so prove the blunder branch was taken with a position whose first empty
    // cell is NOT the winning one.
    const blunder = chooseMove(".x.x.o...", v, "impossible", () => 0, {
      maxDepth: 9,
      randomMoveProb: 1,
    });
    expect(blunder).toBe(0);
  });

  it("still refuses a finished or full board", () => {
    const v = variantById("3x3");
    const p = skillToParams(DEFAULT_SKILL, v);
    expect(chooseMove("xxxoo....", v, "impossible", Math.random, p)).toBeNull();
    expect(chooseMove("xoxxoooxx", v, "impossible", Math.random, p)).toBeNull();
  });

  it("never returns an occupied cell, at any skill on any board", () => {
    for (const v of VARIANTS) {
      const state = variantStartState(v).replace("..", "xo");
      for (let s = MIN_SKILL; s <= MAX_SKILL; s += 200) {
        const cell = chooseMove(state, v, "impossible", seeded(s), skillToParams(s, v));
        expect(cell).not.toBeNull();
        expect(state[cell as number]).toBe(".");
      }
    }
  });
});
