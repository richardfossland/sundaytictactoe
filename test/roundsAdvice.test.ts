import { describe, expect, it } from "vitest";
import {
  MAX_ROUNDS,
  MIN_ROUNDS,
  maxRoundsWithoutRematch,
  recommendedRounds,
  roundsWarning,
} from "@/lib/tournament/roundsAdvice";

describe("maxRoundsWithoutRematch", () => {
  it("is players - 1 for a normal roster", () => {
    expect(maxRoundsWithoutRematch(8)).toBe(7);
    expect(maxRoundsWithoutRematch(6)).toBe(5);
  });

  it("never goes below 1, even for a tiny or empty roster", () => {
    expect(maxRoundsWithoutRematch(2)).toBe(1);
    expect(maxRoundsWithoutRematch(1)).toBe(1);
    expect(maxRoundsWithoutRematch(0)).toBe(1);
  });
});

describe("recommendedRounds", () => {
  it("stays within the wizard's [MIN_ROUNDS, MAX_ROUNDS] control range when the roster allows it", () => {
    const r = recommendedRounds(20);
    expect(r).toBeGreaterThanOrEqual(MIN_ROUNDS);
    expect(r).toBeLessThanOrEqual(MAX_ROUNDS);
  });

  it("never exceeds the no-rematch ceiling", () => {
    for (const players of [2, 3, 4, 5, 6, 8, 10, 16, 30]) {
      expect(recommendedRounds(players)).toBeLessThanOrEqual(maxRoundsWithoutRematch(players));
    }
  });

  it("recommends the ceiling itself for a small roster, even below MIN_ROUNDS", () => {
    // 3 players ⇒ ceiling 2, which is below the wizard's minimum of 3 rounds —
    // recommending anything higher would guarantee a rematch.
    expect(recommendedRounds(3)).toBe(2);
    expect(recommendedRounds(2)).toBe(1);
  });

  it("matches the wizard's existing default of 5 for a mid-size roster", () => {
    expect(recommendedRounds(6)).toBe(5);
  });
});

describe("roundsWarning", () => {
  it("is null when the roster comfortably supports the chosen round count", () => {
    expect(roundsWarning(8, 5)).toBeNull();
    expect(roundsWarning(8, 7)).toBeNull(); // exactly at the ceiling
  });

  it("warns once the round count exceeds players - 1", () => {
    const msg = roundsWarning(5, 6);
    expect(msg).not.toBeNull();
    expect(msg).toContain("6");
    expect(msg).toContain("5");
  });

  it("is null for a non-positive player count (nothing to warn about yet)", () => {
    expect(roundsWarning(0, 5)).toBeNull();
    expect(roundsWarning(-1, 5)).toBeNull();
  });
});
