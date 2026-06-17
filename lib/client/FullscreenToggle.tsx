"use client";

import { useEffect, useState } from "react";

/** Small fixed-corner button to enter/exit fullscreen — for a distraction-free
 * projector or play view. Uses the Fullscreen API on the document root; the
 * click is the required user gesture. Sits just above the sound toggle. */
export function FullscreenToggle() {
  const [isFull, setIsFull] = useState(false);

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

  return (
    <button
      className="fullscreen-toggle"
      aria-label={isFull ? "Avslutt fullskjerm" : "Fullskjerm"}
      title={isFull ? "Avslutt fullskjerm" : "Fullskjerm"}
      onClick={toggle}
    >
      {isFull ? "🡼" : "⛶"}
    </button>
  );
}
