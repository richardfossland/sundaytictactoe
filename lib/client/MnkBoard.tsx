"use client";

import { memo, useCallback, useEffect, useRef, type CSSProperties } from "react";
import { sameJson } from "@/lib/client/equal";

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

/**
 * L5 port (sundaychess#84): the board, insulated from its parent's re-renders.
 *
 * WHY THIS EXISTS
 * ---------------
 * `MnkBoard` has none of react-chessboard's context-provider problem (chess's
 * `PlayBoard` exists mainly to shield `<Chessboard>` from a fresh context value
 * on every render) — it's a plain CSS grid of `<button>`s we own outright. But
 * its THREE callers (`GameView`, `app/solo/page.tsx`, `LocalVersus`) all
 * re-render for reasons that have nothing to do with the board — polls,
 * presence events, toasts, the `pending` flip, a bot "thinking" spinner — and
 * `onCell` is a fresh closure on every one of those renders (`tryMove` is
 * either a `useCallback` whose deps churn constantly, or, in the two solo
 * modes, a bare function redefined every render). Without a memo boundary,
 * any of that force-rebuilds and re-diffs all `m*n` cells for nothing.
 *
 * So the board must not re-render unless something it DISPLAYS changed. The
 * value props (`state`, `m`, `n`, `disabled`, `lastCell`, `winLine`, `size`)
 * are compared by value; `onCell`'s identity is deliberately IGNORED, because
 * none of its three callers memoize it and none plausibly ever will.
 *
 * WHY IGNORING HANDLER IDENTITY IS SAFE
 * -------------------------------------
 * `onCell` is routed through a ref, refreshed in an effect after every render
 * (the latest-ref pattern from `lib/client/useChannel.ts`). That ref only
 * refreshes when THIS component renders — i.e. when one of the compared props
 * changed — so the argument that must hold is:
 *
 *   every piece of the caller's state `onCell` reads is a function of the
 *   compared props.
 *
 * Checked against all three `tryMove` implementations that plug into `onCell`
 * (`app/play/GameView.tsx`, `app/solo/page.tsx`, `lib/client/LocalVersus.tsx`):
 *
 *   state (the board) → the `state` prop itself, directly.
 *   turn               → derived from `state` alone in all three (a cell
 *                        count's parity / `plyOf` / `turnFromFen`), never
 *                        tracked as independent state. Same `state` ⇒ same
 *                        turn, so it adds nothing the prop doesn't already say.
 *   status / outcome /
 *   ended / thinking   → each caller folds exactly this into the `disabled`
 *                        prop it passes down (`!isMyTurn || pending || ended`
 *                        in GameView, `!isMyTurn` in solo, `!!outcome` in
 *                        LocalVersus) — a real flip of any of them is a flip
 *                        of a compared prop.
 *   pending            → not a prop, and doesn't need to be. The dangerous
 *                        direction is a stale `pending: false` letting a
 *                        second move through: impossible, because every
 *                        `setPending(true)`-equivalent is issued in the same
 *                        batch as a `setState`/`setFen` of a genuinely
 *                        different board (a legal move always fills a cell),
 *                        so `state` changes, the board re-renders and the ref
 *                        refreshes before a second click could exploit the old
 *                        closure. The other direction (stale `true` after
 *                        release on an unchanged board) can only be reached
 *                        with the turn already flipped away — `isMyTurn` false
 *                        in that same stale closure, i.e. `disabled` already
 *                        true — where the click can't even reach `onCell`
 *                        (see below).
 *   gameId, me.playerId,
 *   me.resumeCode      → stable for GameView's lifetime (`me` set once in
 *                        app/play/page.tsx; `gameId` is the component's own
 *                        identity — WaitingRoom keys a fresh mount per game).
 *
 * No exception found across the three call sites: `state` and `disabled`
 * between them cover everything each `tryMove` reads. This is a strictly
 * SIMPLER situation than chess's — there is no `squareStyles`-shaped prop
 * whose identity must be ignored in favour of a derived key; `winLine` is a
 * small array compared by content (`sameJson`) directly, no key needed.
 *
 * There is also a second, independent belt: every cell's own `onClick` is
 * `undefined` (not merely a no-op) whenever `clickable` is false, and
 * `clickable` is recomputed fresh on every ACTUAL render of this component
 * from the very props being compared — so even a hypothetical gap in the
 * argument above could only ever suppress a legal click, never admit an
 * illegal one.
 */

/** Props comparison for the `memo` below. Compares only what the board
 * DISPLAYS; `onCell` identity is ignored on purpose (see the correctness
 * argument in the file header). `winLine` is a fresh array every render in
 * every caller (recomputed from `state`, never memoized upstream), so it is
 * compared by content via `sameJson` rather than by reference. Exported for
 * `test/mnkBoardMemo.test.ts`. */
export function arePropsEqual(
  prev: Readonly<MnkBoardProps>,
  next: Readonly<MnkBoardProps>,
): boolean {
  return (
    prev.state === next.state &&
    prev.m === next.m &&
    prev.n === next.n &&
    prev.disabled === next.disabled &&
    prev.lastCell === next.lastCell &&
    prev.size === next.size &&
    sameJson(prev.winLine ?? null, next.winLine ?? null)
  );
}

/** A pure CSS-grid m×n board. Replaces react-chessboard everywhere — far simpler
 * (no SSR dance, no piece sprites). X and O are rendered as glyphs. */
function MnkBoardImpl({
  state,
  m,
  n,
  onCell,
  disabled,
  lastCell,
  winLine,
  size = "md",
}: MnkBoardProps) {
  // Latest-ref pattern (see lib/client/useChannel.ts): the trampoline below is
  // stable for the life of the component, so a new `onCell` closure from the
  // parent never busts the memo above it — but a click always invokes the
  // newest closure this component last committed with.
  const onCellRef = useRef(onCell);
  useEffect(() => {
    onCellRef.current = onCell;
  });
  const handleCell = useCallback((i: number) => {
    onCellRef.current?.(i);
  }, []);

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
            // Stable test hooks. `data-cell` is the grid index and `data-mark`
            // is "x"/"o"/"" — attributes only, read by e2e/pages/board.ts, so a
            // restyle (class names) or a copy pass (aria-label) cannot move
            // them. `i` is a number: cell 0 renders `data-cell="0"`, not a
            // missing attribute the way a falsy boolean would.
            data-cell={i}
            data-mark={filled ? mark : ""}
            className={[
              "mnk-cell",
              filled ? `mnk-${mark}` : "mnk-empty",
              winSet?.has(i) ? "mnk-win" : "",
              lastCell === i ? "mnk-last" : "",
              clickable ? "mnk-clickable" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={clickable ? () => handleCell(i) : undefined}
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

export const MnkBoard = memo(MnkBoardImpl, arePropsEqual);
