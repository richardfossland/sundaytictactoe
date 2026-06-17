"use client";

import type { CSSProperties } from "react";

export interface MnkBoardProps {
  /** board string, length m*n of '.'/'x'/'o' */
  state: string;
  m: number;
  n: number;
  /** click handler for an empty cell (omit for read-only) */
  onCell?: (i: number) => void;
  /** disable all input (not your turn / pending / game over) */
  disabled?: boolean;
  /** highlight the most recently played cell */
  lastCell?: number | null;
  /** highlight the winning line */
  winLine?: number[] | null;
  size?: "sm" | "md" | "lg";
}

/** A pure CSS-grid m×n board. Replaces react-chessboard everywhere — far simpler
 * (no SSR dance, no piece sprites). X and O are rendered as glyphs. */
export function MnkBoard({
  state,
  m,
  n,
  onCell,
  disabled,
  lastCell,
  winLine,
  size = "md",
}: MnkBoardProps) {
  const winSet = winLine ? new Set(winLine) : null;
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${n}, 1fr)`,
    aspectRatio: `${n} / ${m}`,
  };
  return (
    <div className={`mnk mnk-${size}`} style={style} role="grid" aria-label="Brett">
      {Array.from({ length: m * n }, (_, i) => {
        const mark = state[i];
        const filled = mark === "x" || mark === "o";
        const clickable = !!onCell && !disabled && !filled;
        return (
          <button
            key={i}
            type="button"
            className={[
              "mnk-cell",
              filled ? `mnk-${mark}` : "mnk-empty",
              winSet?.has(i) ? "mnk-win" : "",
              lastCell === i ? "mnk-last" : "",
              clickable ? "mnk-clickable" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={clickable ? () => onCell!(i) : undefined}
            disabled={!clickable}
            aria-label={
              filled ? (mark === "x" ? "X" : "O") : `Tom rute ${i + 1}`
            }
          >
            <span className="mnk-glyph">{mark === "x" ? "✕" : mark === "o" ? "◯" : ""}</span>
          </button>
        );
      })}
    </div>
  );
}
