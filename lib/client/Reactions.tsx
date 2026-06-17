"use client";

// Ephemeral emoji reactions. Sent as client broadcasts on the game channel —
// never stored, never authoritative. Gated by the tournament's `reactions`
// config flag (default off) so the organizer decides if the room can handle it.

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export const REACTION_EMOJIS = ["👍", "👏", "😄", "😮", "🔥"] as const;

export interface FloatingReaction {
  id: number;
  emoji: string;
  /** horizontal position, percent of layer width */
  x: number;
}

/** Overlay of floating, rising emojis. Position the parent `relative`;
 * pointer-events pass through. */
export function ReactionLayer({ items }: { items: FloatingReaction[] }) {
  return (
    <div className="reaction-layer" aria-hidden>
      {items.map((r) => (
        <span key={r.id} className="reaction-float" style={{ left: `${r.x}%` }}>
          {r.emoji}
        </span>
      ))}
    </div>
  );
}

export interface ReactionHandle {
  add: (emoji: string) => void;
}

/** Self-contained floating-emoji overlay: owns its own float state + cleanup
 * timers and exposes an imperative `add(emoji)` via ref. Triggering a reaction
 * therefore NEVER re-renders the parent, so the chess board + clocks don't
 * reconcile on every emoji (a real cost on a Chromebook). Place inside a
 * `position: relative` parent. */
export const ReactionOverlay = forwardRef<ReactionHandle>(
  function ReactionOverlay(_props, ref) {
    const [floats, setFloats] = useState<FloatingReaction[]>([]);
    const seq = useRef(0);
    useImperativeHandle(
      ref,
      () => ({
        add(emoji: string) {
          const id = ++seq.current;
          setFloats((f) => [...f, { id, emoji, x: 12 + Math.random() * 70 }]);
          setTimeout(
            () => setFloats((f) => f.filter((r) => r.id !== id)),
            2600,
          );
        },
      }),
      [],
    );
    return <ReactionLayer items={floats} />;
  },
);

/** Tap-to-send emoji bar. */
export function ReactionBar({ onSend }: { onSend: (emoji: string) => void }) {
  return (
    <div className="reaction-bar" role="group" aria-label="Send en reaksjon">
      {REACTION_EMOJIS.map((e) => (
        <button
          key={e}
          className="reaction-btn"
          aria-label={`Send ${e}`}
          onClick={() => onSend(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
