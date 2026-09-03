import { describe, expect, it } from "vitest";
import {
  TTL_MS,
  isActive,
  moreSenior,
  mount,
  parseTabMessage,
  reduceTab,
  selfClaim,
  type Claim,
  type TabMessage,
  type TabState,
} from "@/lib/client/activeTab";

const c = (tabId: string, ts: number): Claim => ({ tabId, ts });

/** A tab that already lost the board to `senior`, last heard from at `seen`. */
const passive = (meTs: number, senior: Claim, seen: number): TabState => ({
  me: c("me", meTs),
  senior,
  lastSeniorSeen: seen,
});

describe("moreSenior", () => {
  it("the newer timestamp wins", () => {
    expect(moreSenior(c("a", 2000), c("b", 1000))).toBe(true);
    expect(moreSenior(c("a", 1000), c("b", 2000))).toBe(false);
  });

  it("breaks same-ms ties deterministically by tabId (so two tabs never both go passive)", () => {
    // For the SAME ts, exactly one ordering is senior — never both, never neither.
    expect(moreSenior(c("b", 1000), c("a", 1000))).toBe(true);
    expect(moreSenior(c("a", 1000), c("b", 1000))).toBe(false);
  });

  it("a claim is not more senior than itself", () => {
    expect(moreSenior(c("a", 1000), c("a", 1000))).toBe(false);
  });
});

describe("mount", () => {
  it("claims the board and asks who else is there", () => {
    const r = mount("me", 1000);
    expect(r.active).toBe(true);
    expect(r.post).toEqual([
      { type: "claim", claim: c("me", 1000) },
      { type: "who" },
    ]);
  });
});

describe("reduceTab — claim", () => {
  it("a newer claim from another tab demotes us", () => {
    const r = reduceTab(mount("me", 1000).state, {
      type: "claim",
      claim: c("other", 2000),
    }, 2000);
    expect(r.active).toBe(false);
    expect(r.state.senior).toEqual(c("other", 2000));
    expect(r.post).toEqual([]);
  });

  it("a STALE re-announce does not demote a newer claim", () => {
    // We took the board at 2000; the tab we displaced answers a `who` with its
    // own original (older) claim. That must not throw us out.
    const me = mount("me", 2000).state;
    const r = reduceTab(me, { type: "claim", claim: c("other", 1000) }, 2100);
    expect(r.active).toBe(true);
    expect(r.state.senior).toEqual(c("me", 2000));
  });

  it("ignores a claim echoed back from ourselves", () => {
    // BroadcastChannel does not echo to the sender, but guard anyway: adopting
    // our own claim through the senior branch would corrupt lastSeniorSeen.
    const st = passive(1000, c("other", 2000), 2000);
    const r = reduceTab(st, { type: "claim", claim: c("me", 9000) }, 9000);
    expect(r.active).toBe(false);
    expect(r.state).toEqual(st);
  });

  it("the reigning senior re-announcing itself counts as proof of life", () => {
    const st = passive(1000, c("other", 2000), 2000);
    const r = reduceTab(st, { type: "claim", claim: c("other", 2000) }, 8000);
    expect(r.active).toBe(false);
    expect(r.state.lastSeniorSeen).toBe(8000);
  });
});

describe("reduceTab — who", () => {
  it("the senior answers with its ORIGINAL claim, never a fresher one", () => {
    const st = mount("me", 1000).state;
    const r = reduceTab(st, { type: "who" }, 50_000);
    // A fresh ts here would let answering steal the board back from a tab that
    // legitimately took over.
    expect(r.post).toEqual([{ type: "claim", claim: c("me", 1000) }]);
    expect(r.active).toBe(true);
  });

  it("a passive tab stays quiet", () => {
    const st = passive(1000, c("other", 2000), 2000);
    expect(reduceTab(st, { type: "who" }, 3000).post).toEqual([]);
  });
});

describe("reduceTab — release", () => {
  it("a release from the senior hands us the board with a fresh claim", () => {
    const st = passive(1000, c("other", 2000), 2000);
    const r = reduceTab(st, { type: "release", claim: c("other", 2000) }, 5000);
    expect(r.active).toBe(true);
    expect(r.state.senior).toEqual(c("me", 5000));
    expect(r.post).toEqual([{ type: "claim", claim: c("me", 5000) }]);
  });

  it("a release from some OTHER tab changes nothing", () => {
    const st = passive(1000, c("other", 2000), 2000);
    const r = reduceTab(st, { type: "release", claim: c("third", 1500) }, 5000);
    expect(r.active).toBe(false);
    expect(r.state).toEqual(st);
  });

  it("ignores our own release echo", () => {
    const st = mount("me", 1000).state;
    const r = reduceTab(st, { type: "release", claim: c("me", 1000) }, 5000);
    expect(r.state).toEqual(st);
    expect(r.post).toEqual([]);
  });
});

describe("reduceTab — tick / TTL", () => {
  it("takes over when the senior has been silent past the TTL", () => {
    // The senior crashed / was discarded by iOS Safari: no release ever came.
    const st = passive(1000, c("other", 2000), 2000);
    const r = reduceTab(st, { type: "tick" }, 2000 + TTL_MS + 1);
    expect(r.active).toBe(true);
    expect(r.post).toEqual([
      { type: "claim", claim: c("me", 2000 + TTL_MS + 1) },
    ]);
  });

  it("waits while the senior is still within the TTL", () => {
    const st = passive(1000, c("other", 2000), 2000);
    const r = reduceTab(st, { type: "tick" }, 2000 + TTL_MS);
    expect(r.active).toBe(false);
    expect(r.post).toEqual([]);
  });

  it("a senior heartbeat prevents the expiry", () => {
    let st = passive(1000, c("other", 2000), 2000);
    // Heartbeat lands late in the TTL window and resets the clock...
    st = reduceTab(st, { type: "heartbeat", claim: c("other", 2000) }, 25_000)
      .state;
    expect(st.lastSeniorSeen).toBe(25_000);
    // ...so a tick well past the ORIGINAL deadline still does not take over.
    const r = reduceTab(st, { type: "tick" }, 2000 + TTL_MS + 1000);
    expect(r.active).toBe(false);
    expect(r.post).toEqual([]);
  });

  it("the senior's own ticks are no-ops", () => {
    const st = mount("me", 1000).state;
    const r = reduceTab(st, { type: "tick" }, 1000 + TTL_MS * 10);
    expect(r.active).toBe(true);
    expect(r.post).toEqual([]);
  });
});

describe("reduceTab — heartbeat", () => {
  it("adopts a heartbeat carrying a claim newer than the one we know", () => {
    // We were frozen (bfcache / backgrounded) and missed the claim itself.
    const st = mount("me", 1000).state;
    const r = reduceTab(st, { type: "heartbeat", claim: c("other", 4000) }, 9000);
    expect(r.active).toBe(false);
    expect(r.state.senior).toEqual(c("other", 4000));
  });

  it("ignores a heartbeat from a tab we already displaced", () => {
    const st = mount("me", 5000).state;
    const r = reduceTab(st, { type: "heartbeat", claim: c("other", 1000) }, 9000);
    expect(r.active).toBe(true);
    expect(r.state.lastSeniorSeen).toBe(st.lastSeniorSeen);
  });

  it("ignores our own heartbeat echo", () => {
    const st = passive(1000, c("other", 2000), 2000);
    const r = reduceTab(st, { type: "heartbeat", claim: c("me", 9000) }, 9000);
    expect(r.state).toEqual(st);
  });
});

describe("selfClaim", () => {
  it("forces a timestamp strictly newer than the senior it displaces", () => {
    // Same-ms takeover: a plain `now` could lose the tabId tie-break and leave
    // both tabs believing they hold the board.
    const st = passive(1000, c("zzz", 5000), 5000);
    const r = selfClaim(st, 5000);
    expect(r.active).toBe(true);
    expect(r.state.senior).toEqual(c("me", 5001));
    expect(moreSenior(r.state.senior, c("zzz", 5000))).toBe(true);
  });
});

describe("two tabs opened in the same millisecond", () => {
  it("resolve deterministically — exactly one is active", () => {
    const now = 1000;
    const a = mount("tab-a", now);
    const b = mount("tab-b", now);
    // Each hears the other's mount claim.
    const afterA = reduceTab(a.state, { type: "claim", claim: b.state.me }, now);
    const afterB = reduceTab(b.state, { type: "claim", claim: a.state.me }, now);
    expect([afterA.active, afterB.active].filter(Boolean)).toHaveLength(1);
    // ...and they agree on WHICH one (tie-break by tabId: "tab-b" > "tab-a").
    expect(afterA.state.senior).toEqual(afterB.state.senior);
    expect(afterB.active).toBe(true);
  });

  it("converges after a mutual same-ms takeover, whatever the order", () => {
    // Both tabs self-claim at the same instant (e.g. both saw the senior go).
    let a = selfClaim(passive(0, c("gone", 900), 900), 1000).state;
    let b = selfClaim(
      { me: c("me-b", 0), senior: c("gone", 900), lastSeniorSeen: 900 },
      1000,
    ).state;
    a = reduceTab(a, { type: "claim", claim: b.me }, 1000).state;
    b = reduceTab(b, { type: "claim", claim: a.me }, 1000).state;
    expect([isActive(a), isActive(b)].filter(Boolean)).toHaveLength(1);
  });
});

describe("parseTabMessage", () => {
  it("accepts the protocol messages", () => {
    expect(parseTabMessage({ type: "who" })).toEqual({ type: "who" });
    expect(parseTabMessage({ type: "claim", claim: { tabId: "a", ts: 1 } }))
      .toEqual({ type: "claim", claim: c("a", 1) });
    expect(parseTabMessage({ type: "release", claim: { tabId: "a", ts: 1 } }))
      .toEqual({ type: "release", claim: c("a", 1) });
    expect(parseTabMessage({ type: "heartbeat", claim: { tabId: "a", ts: 1 } }))
      .toEqual({ type: "heartbeat", claim: c("a", 1) });
  });

  it("drops anything else on the channel", () => {
    const junk: unknown[] = [
      null,
      undefined,
      "claim",
      42,
      {},
      { type: "tick" }, // local-only, must never arrive over the wire
      { type: "claim" },
      { type: "claim", claim: { tabId: 7, ts: 1 } },
      { type: "claim", claim: { tabId: "a", ts: "1" } },
      { type: "nonsense", claim: { tabId: "a", ts: 1 } },
    ];
    for (const j of junk) expect(parseTabMessage(j)).toBeNull();
  });
});

describe("the whole lifecycle a student sees", () => {
  it("second tab takes over, then closing it returns the board to the first", () => {
    // Tab 1 is the board.
    let one = mount("one", 1000);
    expect(one.active).toBe(true);

    // The student re-scans the QR: tab 2 mounts and claims.
    const two = mount("two", 5000);
    one = reduceTab(one.state, { type: "claim", claim: two.state.me }, 5000);
    expect(one.active).toBe(false); // tab 1 now shows "Spill her"

    // Tab 2 is closed properly → release → tab 1 is the board again, without
    // the student having to touch anything.
    one = reduceTab(one.state, { type: "release", claim: two.state.me }, 6000);
    expect(one.active).toBe(true);
  });

  it("a crashed senior strands nobody — the TTL brings the board back", () => {
    let one = mount("one", 1000);
    const two = mount("two", 5000);
    one = reduceTab(one.state, { type: "claim", claim: two.state.me }, 5000);
    expect(one.active).toBe(false);

    // Tab 2 is discarded by iOS Safari: no release, and its heartbeats stop.
    const beats: TabMessage[] = [
      { type: "heartbeat", claim: two.state.me },
      { type: "heartbeat", claim: two.state.me },
    ];
    let t = 15_000;
    for (const b of beats) {
      one = reduceTab(one.state, b, t);
      t += 10_000;
      expect(one.active).toBe(false);
    }
    // Silence from here. Ticks every 5 s; the TTL expires and tab 1 takes over.
    const lastHeard = one.state.lastSeniorSeen;
    for (t = lastHeard + 5000; t <= lastHeard + TTL_MS; t += 5000) {
      one = reduceTab(one.state, { type: "tick" }, t);
      expect(one.active).toBe(false);
    }
    one = reduceTab(one.state, { type: "tick" }, lastHeard + TTL_MS + 5000);
    expect(one.active).toBe(true);
    expect(one.post).toHaveLength(1);
  });
});
