"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HEARTBEAT_MS,
  TICK_MS,
  VISIBLE_GRACE_MS,
  isActive,
  mount,
  parseTabMessage,
  reduceTab,
  selfClaim,
  type TabMessage,
  type TabState,
} from "./activeTab";

// I/O driver for the single-active-tab protocol. All the rules live in
// ./activeTab.ts (pure, documented, tested); this file only owns the
// BroadcastChannel, the timers and the page-lifecycle events.

export { moreSenior } from "./activeTab";
export type { Claim } from "./activeTab";

/** Returns whether THIS tab is the active one for `key` (e.g. tournament:player),
 * and a `claim()` to take over from another tab ("play here"). Degrades to always
 * active when BroadcastChannel is unavailable or `key` is null. */
export function useActiveTab(key: string | null): {
  active: boolean;
  claim: () => void;
} {
  // The flag is stamped with the key it was decided for, so `active` derives
  // back to true the moment `key` changes — no setState in the effect body
  // (which would cascade renders) and no stale "passive" left over from the
  // previous player's channel.
  const [flag, setFlag] = useState<{ key: string | null; active: boolean }>({
    key: null,
    active: true,
  });
  const active = flag.key === key ? flag.active : true;

  const chanRef = useRef<BroadcastChannel | null>(null);
  const stateRef = useRef<TabState | null>(null);

  const setActive = useCallback(
    (a: boolean) => setFlag({ key, active: a }),
    [key],
  );

  const post = useCallback((msgs: TabMessage[]) => {
    const ch = chanRef.current;
    if (!ch) return;
    for (const m of msgs) {
      if (m.type === "tick") continue; // local-only, never on the wire
      try {
        ch.postMessage(m);
      } catch {
        // Channel already closed (unmount race) — nothing to do.
      }
    }
  }, []);

  /** Fold one message into the state and flush whatever it wants broadcast. */
  const apply = useCallback(
    (msg: TabMessage) => {
      const st = stateRef.current;
      if (!st) return;
      const r = reduceTab(st, msg, Date.now());
      stateRef.current = r.state;
      setActive(r.active);
      post(r.post);
    },
    [post, setActive],
  );

  const claim = useCallback(() => {
    const st = stateRef.current;
    if (!st) return; // no coordination available → we are already the board
    const r = selfClaim(st, Date.now());
    stateRef.current = r.state;
    setActive(r.active);
    post(r.post);
  }, [post, setActive]);

  useEffect(() => {
    if (!key || typeof BroadcastChannel === "undefined") {
      stateRef.current = null;
      return; // no coordination available → `active` derives to true
    }
    const tabId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const ch = new BroadcastChannel(`ttt-tab:${key}`);
    chanRef.current = ch;

    // Claim on mount (newest tab wins) and ask any existing tab to announce.
    const boot = mount(tabId, Date.now());
    stateRef.current = boot.state;
    post(boot.post); // `boot.active` is true, which is what `active` already derives to

    ch.onmessage = (e: MessageEvent) => {
      const msg = parseTabMessage(e.data);
      if (msg) apply(msg);
    };

    // Proof of life, senior only. Runs for the effect's lifetime and no-ops in
    // the wrong role, so flipping active/passive never restarts the timers.
    const beat = setInterval(() => {
      const st = stateRef.current;
      if (!st || !isActive(st)) return;
      post([{ type: "heartbeat", claim: st.senior }]);
    }, HEARTBEAT_MS);

    // TTL watchdog, passive only — the guarantee that a passive tab cannot be
    // stranded when the senior dies without releasing.
    const tick = setInterval(() => {
      const st = stateRef.current;
      if (!st || isActive(st)) return;
      apply({ type: "tick" });
    }, TICK_MS);

    // Hand the board over deliberately when we go away. `pagehide` is the one
    // that fires on iOS Safari, where `beforeunload` does not.
    const release = () => {
      const st = stateRef.current;
      if (!st || !isActive(st)) return; // only the senior has anything to hand over
      post([{ type: "release", claim: st.senior }]);
    };
    window.addEventListener("pagehide", release);

    // Coming back to the foreground, a passive tab asks whether the senior still
    // exists. Silence for VISIBLE_GRACE_MS means it was discarded while we were
    // backgrounded (iOS) — take over now instead of waiting out the TTL.
    let grace: ReturnType<typeof setTimeout> | null = null;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const st = stateRef.current;
      if (!st || isActive(st)) return;
      const seenBefore = st.lastSeniorSeen;
      post([{ type: "who" }]);
      if (grace) clearTimeout(grace);
      grace = setTimeout(() => {
        grace = null;
        const cur = stateRef.current;
        if (!cur || isActive(cur)) return;
        if (cur.lastSeniorSeen > seenBefore) return; // somebody answered
        const r = selfClaim(cur, Date.now());
        stateRef.current = r.state;
        setActive(r.active);
        post(r.post);
      }, VISIBLE_GRACE_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", onVisibility);
      if (grace) clearTimeout(grace);
      clearInterval(beat);
      clearInterval(tick);
      release(); // best effort, before the channel goes
      ch.onmessage = null;
      ch.close();
      chanRef.current = null;
      stateRef.current = null;
    };
  }, [key, apply, post, setActive]);

  return { active, claim };
}
