"use client";

import { useEffect, useState } from "react";

/** True while this tab is in the background (Page Visibility API), kept live
 * across visibilitychange. Used to slow a poll's cadence instead of skipping
 * it entirely while backgrounded — a backgrounded tab that lost its Realtime
 * channel should still heal within a bounded time on return, not only at the
 * next visible poll (R11). Safe during SSR (no `document` yet → starts
 * false; the browser corrects it on mount before any interval is set up). */
export function useTabHidden(): boolean {
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return hidden;
}
