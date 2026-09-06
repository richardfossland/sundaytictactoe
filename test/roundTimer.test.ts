import { describe, expect, it } from "vitest";
import { roundTimeUp, roundTimerEndMs } from "@/lib/tournament/roundTimer";

const START = "2026-01-01T00:00:00.000Z";
const START_MS = new Date(START).getTime();

describe("roundTimerEndMs", () => {
  it("is null when there is no timer configured", () => {
    expect(roundTimerEndMs({ startedAt: START }, null)).toBeNull();
    expect(roundTimerEndMs({ startedAt: START }, 0)).toBeNull();
    expect(roundTimerEndMs({ startedAt: START }, undefined)).toBeNull();
  });

  it("is null when the round hasn't started", () => {
    expect(roundTimerEndMs({ startedAt: null }, 60)).toBeNull();
    expect(roundTimerEndMs(null, 60)).toBeNull();
    expect(roundTimerEndMs(undefined, 60)).toBeNull();
  });

  it("adds duration and accumulated extensions to the start time", () => {
    expect(roundTimerEndMs({ startedAt: START }, 60)).toBe(START_MS + 60_000);
    expect(roundTimerEndMs({ startedAt: START, extendedMs: 30_000 }, 60)).toBe(
      START_MS + 60_000 + 30_000,
    );
  });
});

describe("roundTimeUp", () => {
  it("is false before the deadline, true at and after it", () => {
    const round = { startedAt: START };
    const endMs = START_MS + 60_000;
    expect(roundTimeUp(round, 60, endMs - 1)).toBe(false);
    expect(roundTimeUp(round, 60, endMs)).toBe(true);
    expect(roundTimeUp(round, 60, endMs + 1)).toBe(true);
  });

  it("is false when there is no timer or the round hasn't started", () => {
    expect(roundTimeUp({ startedAt: START }, null, START_MS + 999_999)).toBe(false);
    expect(roundTimeUp({ startedAt: null }, 60, START_MS + 999_999)).toBe(false);
  });

  it("respects accumulated +1 min extensions", () => {
    const round = { startedAt: START, extendedMs: 60_000 };
    const originalEndMs = START_MS + 60_000;
    // would have expired without the extension …
    expect(roundTimeUp(round, 60, originalEndMs)).toBe(false);
    // … but not yet, with it applied.
    expect(roundTimeUp(round, 60, originalEndMs + 60_000)).toBe(true);
  });
});
