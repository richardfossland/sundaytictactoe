"use client";

import { useEffect, useState } from "react";

/** Pure, SSR-safe read of the OS/browser "reduce motion" preference. Exported
 * separately from the hook below so it's testable in plain Node (no DOM) —
 * see test/useReducedMotion.test.ts. Takes an injectable `matchMedia` so the
 * test can feed a fake one; the real hook always calls it with `window`'s.
 * Returns false when `matchMedia` isn't available at all (SSR, or a browser
 * without support) — motion stays on rather than guessing. */
export function readReducedMotion(
  matchMedia?: (query: string) => { matches: boolean },
): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True while the user has asked for reduced motion. globals.css already
 * handles CSS transitions/animations (`@media (prefers-reduced-motion:
 * reduce)`), but two things animate from JS and never see that media query:
 * the canvas confetti (lib/client/Confetti.tsx, 200 rAF frames) and
 * react-chessboard's own piece-slide animation (lib/client/boardOptions.ts
 * `showAnimations`). Both read this hook instead. SSR-safe: starts `false`,
 * corrected on mount before anything has animated; stays live across a
 * mid-session OS setting change via the media query's own `change` event. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    readReducedMotion(typeof window === "undefined" ? undefined : window.matchMedia),
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    onChange(); // correct any SSR/mount-time mismatch immediately
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
