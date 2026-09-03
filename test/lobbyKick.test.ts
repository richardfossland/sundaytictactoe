import { describe, expect, it } from "vitest";
import {
  recordPresence,
  sweepCandidates,
  type LobbyBooks,
  type SweepInput,
} from "@/lib/client/lobbyKick";

const WINDOW = 3 * 60 * 1000; // AUTO_KICK_MS — the owner-set policy, unchanged.

function books(over: Partial<LobbyBooks> = {}): LobbyBooks {
  return {
    seen: new Set<string>(),
    leftAt: new Map<string, number>(),
    kicked: new Set<string>(),
    ...over,
  };
}

function input(over: Partial<SweepInput> = {}): SweepInput {
  return {
    active: [{ id: "a" }, { id: "b" }],
    present: new Set<string>(),
    seen: new Set<string>(),
    leftAt: new Map<string, number>(),
    kicked: new Set<string>(),
    hostSubscribed: true,
    visible: true,
    now: 1_000_000,
    windowMs: WINDOW,
    ...over,
  };
}

/** A player seen, then gone for longer than the window — the ONE shape that is
 * supposed to be kicked. Every test below varies one thing away from it. */
function overdue(over: Partial<SweepInput> = {}): SweepInput {
  return input({
    seen: new Set(["a"]),
    leftAt: new Map([["a", 1_000_000 - WINDOW - 1]]),
    ...over,
  });
}

describe("sweepCandidates", () => {
  it("kicks a player who connected and then stayed gone past the window", () => {
    expect(sweepCandidates(overdue())).toEqual(["a"]);
  });

  it("kicks NOBODY while the host channel is not subscribed", () => {
    // The mass-kick guard: a host socket that is re-joining sees an empty
    // presence set that says nothing about the class.
    expect(sweepCandidates(overdue({ hostSubscribed: false }))).toEqual([]);
  });

  it("kicks NOBODY while the host tab is hidden", () => {
    expect(sweepCandidates(overdue({ visible: false }))).toEqual([]);
  });

  it("never kicks a player who was never seen online", () => {
    expect(
      sweepCandidates(
        input({ leftAt: new Map([["a", 0]]), seen: new Set<string>() }),
      ),
    ).toEqual([]);
  });

  it("does not kick before the window has elapsed", () => {
    expect(
      sweepCandidates(
        overdue({ leftAt: new Map([["a", 1_000_000 - WINDOW + 1]]) }),
      ),
    ).toEqual([]);
  });

  it("does not kick exactly AT the window (strictly greater)", () => {
    expect(
      sweepCandidates(overdue({ leftAt: new Map([["a", 1_000_000 - WINDOW]]) })),
    ).toEqual([]);
  });

  it("does not kick a player who is present again", () => {
    expect(sweepCandidates(overdue({ present: new Set(["a"]) }))).toEqual([]);
  });

  it("does not kick a player already kicked", () => {
    expect(sweepCandidates(overdue({ kicked: new Set(["a"]) }))).toEqual([]);
  });

  it("does not kick a player who is no longer on the active roster", () => {
    expect(sweepCandidates(overdue({ active: [{ id: "b" }] }))).toEqual([]);
  });

  it("kicks every overdue player in one pass", () => {
    expect(
      sweepCandidates(
        input({
          seen: new Set(["a", "b"]),
          leftAt: new Map([
            ["a", 0],
            ["b", 0],
          ]),
        }),
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("recordPresence", () => {
  it("records who is online and clears their absence clock", () => {
    const b = books({ seen: new Set(["a"]), leftAt: new Map([["a", 5]]) });
    recordPresence(b, new Set(["a"]), 100, true);
    expect(b.leftAt.has("a")).toBe(false);
    expect(b.seen.has("a")).toBe(true);
  });

  it("stamps a seen player who is now absent", () => {
    const b = books({ seen: new Set(["a"]) });
    recordPresence(b, new Set<string>(), 100, true);
    expect(b.leftAt.get("a")).toBe(100);
  });

  it("keeps the ORIGINAL absence timestamp across later snapshots", () => {
    const b = books({ seen: new Set(["a"]) });
    recordPresence(b, new Set<string>(), 100, true);
    recordPresence(b, new Set<string>(), 999, true);
    expect(b.leftAt.get("a")).toBe(100);
  });

  it("an EMPTY presence set right after a resubscribe stamps NOBODY", () => {
    // The bug this exists for: the host's channel re-joins, Realtime hands us an
    // empty presence_state, and the whole class gets stamped at the same instant
    // → a mass kick one window later.
    const b = books({ seen: new Set(["a", "b", "c"]) });
    recordPresence(b, new Set<string>(), 100, /* stampAbsent */ false);
    expect(b.leftAt.size).toBe(0);
    // …and the sweep therefore has nothing to act on.
    expect(
      sweepCandidates(
        input({
          active: [{ id: "a" }, { id: "b" }, { id: "c" }],
          seen: b.seen,
          leftAt: b.leftAt,
        }),
      ),
    ).toEqual([]);
  });

  it("a player who comes back is removed from `kicked` (a later exit still counts)", () => {
    const b = books({
      seen: new Set(["a"]),
      kicked: new Set(["a"]),
      leftAt: new Map([["a", 5]]),
    });
    recordPresence(b, new Set(["a"]), 100, true);
    expect(b.kicked.has("a")).toBe(false);

    // Gone again, and overdue again → kickable again.
    recordPresence(b, new Set<string>(), 200, true);
    expect(
      sweepCandidates(
        input({
          active: [{ id: "a" }],
          seen: b.seen,
          leftAt: b.leftAt,
          kicked: b.kicked,
          now: 200 + WINDOW + 1,
        }),
      ),
    ).toEqual(["a"]);
  });
});
