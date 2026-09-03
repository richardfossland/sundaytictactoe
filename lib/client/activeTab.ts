// Single-active-tab coordination across tabs of the SAME player.
//
// WHY: two tabs sharing one player identity both POST moves, and the server's
// optimistic-FEN check rejects the loser as "not your turn" — which the student
// experiences as "I can't move my pieces". So exactly one tab per player may be
// the live board; the others go passive and show a "play here" prompt.
//
// THE PROTOCOL (over a BroadcastChannel named `sjakk-tab:<key>`)
//
//   claim     {claim}  "I am the board now."  Newest `ts` wins; same-ms ties
//                      break by tabId, so two tabs never both go passive and
//                      never both stay active.
//   who       {}       "Is anyone the board?"  Only the reigning senior answers,
//                      and it re-announces its ORIGINAL claim (same `ts`) — never
//                      a fresher one, so answering can never steal seniority back
//                      from a tab that legitimately took over.
//   heartbeat {claim}  Sent by the senior every HEARTBEAT_MS. Proof of life: it
//                      refreshes `lastSeniorSeen` in every passive tab.
//   release   {claim}  Sent by the senior on pagehide/unmount. The passive tabs
//                      take over immediately instead of waiting out the TTL.
//   tick      {}       Local only, never broadcast. A passive tab feeds itself
//                      one every TICK_MS; if the senior has been silent for more
//                      than TTL_MS, the tab elects itself.
//
// WHY THE TTL: `release` is best effort. A crashed tab, a killed browser, or an
// iOS Safari tab discarded in the background never gets to send one — and before
// re-election existed, the surviving tab stayed passive FOREVER, showing the
// "play here" card with polling disabled. The heartbeat + TTL is the floor: a
// passive tab cannot be stranded for longer than TTL_MS + TICK_MS.
//
// Everything below is PURE (no timers, no channel, no DOM) so the whole
// lifecycle is testable in plain Node — see test/activeTab.test.ts. The I/O
// driver lives in useActiveTab.ts.

/** How long a passive tab tolerates silence from the senior before taking over. */
export const TTL_MS = 30_000;
/** How often the senior broadcasts proof of life. Must be well under TTL_MS. */
export const HEARTBEAT_MS = 10_000;
/** How often a passive tab checks the TTL. */
export const TICK_MS = 5_000;
/** How long a re-foregrounded passive tab waits for an answer to `who`. */
export const VISIBLE_GRACE_MS = 1_500;

export interface Claim {
  tabId: string;
  ts: number;
}

export type TabMessage =
  | { type: "claim"; claim: Claim }
  | { type: "who" }
  | { type: "release"; claim: Claim }
  | { type: "heartbeat"; claim: Claim }
  | { type: "tick" };

export interface TabState {
  /** This tab's own most recent claim. Its `tabId` is this tab's identity. */
  me: Claim;
  /** The claim currently believed to own the board (possibly `me`). */
  senior: Claim;
  /** When we last heard from the senior — the clock the TTL runs against. */
  lastSeniorSeen: number;
}

export interface TabResult {
  state: TabState;
  /** Is THIS tab the board after applying the message? */
  active: boolean;
  /** Messages the driver should broadcast. `tick` never appears here. */
  post: TabMessage[];
}

/** Is claim `a` more senior (should win) than claim `b`? Newest timestamp wins;
 * ties (same-ms opens) break deterministically by tabId so two tabs never both
 * end up passive. Pure — exported for tests. */
export function moreSenior(a: Claim, b: Claim): boolean {
  return a.ts > b.ts || (a.ts === b.ts && a.tabId > b.tabId);
}

/** Does `state` say this tab owns the board? */
export function isActive(state: TabState): boolean {
  return state.senior.tabId === state.me.tabId;
}

const settle = (state: TabState, post: TabMessage[] = []): TabResult => ({
  state,
  active: isActive(state),
  post,
});

/** Initial state for a freshly mounted tab, plus what it must broadcast: a claim
 * (newest wins, so the tab the student just opened becomes the board) and a
 * `who` so it learns about an existing senior. */
export function mount(tabId: string, now: number): TabResult {
  const mine: Claim = { tabId, ts: now };
  return settle({ me: mine, senior: mine, lastSeniorSeen: now }, [
    { type: "claim", claim: mine },
    { type: "who" },
  ]);
}

/** Take the board deliberately: the "Spill her" button, a released senior, or an
 * expired TTL. The new timestamp is forced strictly newer than the senior we are
 * displacing, so the claim cannot lose a same-ms tie-break and leave two tabs
 * each believing they won. */
export function selfClaim(state: TabState, now: number): TabResult {
  const ts = now > state.senior.ts ? now : state.senior.ts + 1;
  const mine: Claim = { tabId: state.me.tabId, ts };
  return settle({ me: mine, senior: mine, lastSeniorSeen: now }, [
    { type: "claim", claim: mine },
  ]);
}

/** The whole single-tab lifecycle as one pure step. */
export function reduceTab(
  state: TabState,
  msg: TabMessage,
  now: number,
): TabResult {
  switch (msg.type) {
    case "claim": {
      // BroadcastChannel never echoes to the sender, but a message that claims
      // to be from us can only be confusion — ignore it either way.
      if (msg.claim.tabId === state.me.tabId) return settle(state);
      if (moreSenior(msg.claim, state.senior)) {
        return settle({ ...state, senior: msg.claim, lastSeniorSeen: now });
      }
      if (
        msg.claim.tabId === state.senior.tabId &&
        msg.claim.ts === state.senior.ts
      ) {
        // The reigning senior answering a `who`: proof of life, not a change.
        return settle({ ...state, lastSeniorSeen: now });
      }
      // An older claim — a stale re-announce from a tab we already displaced.
      // It must NOT demote us.
      return settle(state);
    }

    case "heartbeat": {
      if (msg.claim.tabId === state.me.tabId) return settle(state);
      if (moreSenior(msg.claim, state.senior)) {
        // We missed the claim itself (frozen tab, bfcache restore) — adopt it.
        return settle({ ...state, senior: msg.claim, lastSeniorSeen: now });
      }
      if (msg.claim.tabId === state.senior.tabId) {
        return settle({ ...state, lastSeniorSeen: now });
      }
      return settle(state);
    }

    case "who": {
      if (!isActive(state)) return settle(state);
      // Re-announce the ORIGINAL claim, same ts — answering must never promote.
      return settle(state, [{ type: "claim", claim: state.senior }]);
    }

    case "release": {
      if (msg.claim.tabId === state.me.tabId) return settle(state);
      if (msg.claim.tabId !== state.senior.tabId) return settle(state);
      return selfClaim(state, now);
    }

    case "tick": {
      if (isActive(state)) return settle(state);
      if (now - state.lastSeniorSeen <= TTL_MS) return settle(state);
      // The senior died without releasing. Take over rather than sit here
      // passive and unpollable forever.
      return selfClaim(state, now);
    }
  }
}

/** Narrow an untrusted `MessageEvent.data` to a protocol message. Anything else
 * (a future version, another library on the same channel name) is dropped. */
export function parseTabMessage(data: unknown): TabMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { type?: unknown; claim?: unknown };
  if (d.type === "who") return { type: "who" };
  if (d.type === "claim" || d.type === "release" || d.type === "heartbeat") {
    const c = d.claim as { tabId?: unknown; ts?: unknown } | undefined;
    if (!c || typeof c.tabId !== "string" || typeof c.ts !== "number") {
      return null;
    }
    return { type: d.type, claim: { tabId: c.tabId, ts: c.ts } };
  }
  return null;
}
