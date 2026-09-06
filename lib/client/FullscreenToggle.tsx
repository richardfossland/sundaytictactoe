"use client";

import { useEffect, useState } from "react";
import { no } from "@/lib/locale/no";

/** Small fixed-corner button to enter/exit fullscreen — for a distraction-free
 * projector or play view. Uses the Fullscreen API on the document root; the
 * click is the required user gesture. Sits just above the sound toggle.
 * Renders nothing where the API doesn't exist at all (iPhone Safari has no
 * `Element.requestFullscreen` — showing a button that can never work is worse
 * than no button). */
export function FullscreenToggle() {
  const [isFull, setIsFull] = useState(false);
  // Read once on mount, not at module scope: `document` doesn't exist during
  // SSR, and this component is always "use client" anyway.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(typeof document.documentElement.requestFullscreen === "function");
  }, []);

  useEffect(() => {
    // setState lives in the event handler (not the effect body), so it tracks
    // real fullscreen changes without a render-time mismatch.
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      // Unsupported / blocked (rare on the target browsers) — fail quietly.
      console.warn("[fullscreen] request failed", e);
    }
  };

  if (!supported) return null;

  return (
    <button
      className="fullscreen-toggle"
      aria-label={isFull ? no.common.fullscreenExit : no.common.fullscreenEnter}
      title={isFull ? no.common.fullscreenExit : no.common.fullscreenEnter}
      aria-pressed={isFull}
      onClick={toggle}
    >
      {isFull ? "🡼" : "⛶"}
    </button>
  );
}
