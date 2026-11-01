"use client";

import { useEffect } from "react";

/** Keep the screen from dimming/sleeping while the board is shown (Screen Wake
 * Lock API). The browser drops the lock whenever the tab is hidden, so it is
 * re-requested when the tab becomes visible again. A no-op where the API is
 * missing or refused (low battery, policy) — the board works either way. */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request("screen");
        lock = l;
        // The browser can also drop the lock on its own (battery saver, OS
        // policy) while the tab stays visible — take it back.
        l.addEventListener("release", () => {
          if (!cancelled && lock === l && document.visibilityState === "visible") void acquire();
        });
      } catch {
        lock = null; // refused — try again on the next visibility change
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);
}
