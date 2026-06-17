"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Single-active-tab coordination across tabs of the SAME player, over a
// BroadcastChannel. Why: two tabs sharing one player identity both POST moves,
// and the server's optimistic-FEN check rejects the loser as "not your turn" —
// which surfaces as "I can't move my pieces". Only the most-recently-claimed tab
// stays active; the others go passive and show a "play here" prompt.

export interface Claim {
  tabId: string;
  ts: number;
}

/** Is claim `a` more senior (should win) than claim `b`? Newest timestamp wins;
 * ties (same-ms opens) break deterministically by tabId so two tabs never both
 * end up passive. Pure — exported for tests. */
export function moreSenior(a: Claim, b: Claim): boolean {
  return a.ts > b.ts || (a.ts === b.ts && a.tabId > b.tabId);
}

/** Returns whether THIS tab is the active one for `key` (e.g. tournament:player),
 * and a `claim()` to take over from another tab ("play here"). Degrades to always
 * active when BroadcastChannel is unavailable or `key` is null. */
export function useActiveTab(key: string | null): {
  active: boolean;
  claim: () => void;
} {
  const [active, setActive] = useState(true);
  const chanRef = useRef<BroadcastChannel | null>(null);
  const myIdRef = useRef<string>("");
  const seniorRef = useRef<Claim>({ tabId: "", ts: 0 });

  const claim = useCallback(() => {
    const c: Claim = { tabId: myIdRef.current, ts: Date.now() };
    seniorRef.current = c;
    setActive(true);
    chanRef.current?.postMessage({ type: "claim", claim: c });
  }, []);

  useEffect(() => {
    if (!key || typeof BroadcastChannel === "undefined") {
      return; // no coordination available → stay active (the default)
    }
    const tabId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    myIdRef.current = tabId;
    const ch = new BroadcastChannel(`ttt-tab:${key}`);
    chanRef.current = ch;

    ch.onmessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; claim?: Claim } | null;
      if (d?.type === "claim" && d.claim) {
        if (moreSenior(d.claim, seniorRef.current)) {
          seniorRef.current = d.claim;
          setActive(d.claim.tabId === myIdRef.current);
        }
      } else if (d?.type === "who") {
        // A newcomer is asking — the current senior re-announces itself.
        if (seniorRef.current.tabId === myIdRef.current) {
          ch.postMessage({ type: "claim", claim: seniorRef.current });
        }
      }
    };

    // Claim on mount (newest tab wins) and ask any existing tabs to announce.
    // `active` already defaults to true, so we just record + broadcast the claim
    // here (no setState in the effect body); other tabs flip to passive via their
    // message handler, and this tab flips only if a more-senior claim arrives.
    const mine: Claim = { tabId, ts: Date.now() };
    seniorRef.current = mine;
    ch.postMessage({ type: "claim", claim: mine });
    ch.postMessage({ type: "who" });

    return () => {
      ch.close();
      chanRef.current = null;
    };
  }, [key]);

  return { active, claim };
}
