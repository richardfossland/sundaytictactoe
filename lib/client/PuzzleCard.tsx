"use client";

// One-tap tic-tac-toe trainer for a student who is WAITING — sitting out a bye,
// between rounds, or knocked out. Port of the chess app's lib/client/PuzzleCard
// (mate-in-1 while you wait), with the two differences the game forces:
//
//   * the answer is a CELL, not a from/to move, so grading is an index
//     comparison against a pack whose answers test/ttt/puzzles.test.ts proves
//     unique — there is no second-best "you were right too" case to swallow;
//   * two flavours instead of one: take the win, or block the opponent's.
//
// Everything is client-side. No network, no game engine at runtime: the pack is
// data, and the verification lives in the test suite.
//
// LAYOUT RULE (the L-series house rule). This card mounts BELOW the waiting
// card, so anything that changes its height would shove nothing — but its own
// contents must still not jump under the student's finger between "answer this"
// and "correct!". So the board is a fixed square (all three variants are), and
// the foot below it is a fixed slot: one status line whose VISIBILITY flips,
// and one button that is always there and only changes label/style. Nothing is
// mounted or unmounted in response to a tap.

import { useCallback, useMemo, useState } from "react";
import { MnkBoard } from "@/lib/client/MnkBoard";
import { isSolution, opponentOf, puzzlesForVariant, type TttPuzzle } from "@/lib/ttt/puzzles";
import { variantById } from "@/lib/ttt/variants";
import { findWinLine } from "@/lib/ttt/win";
import { sound } from "@/lib/client/sound";
import { safeGet, safeSet } from "@/lib/client/storage";
import { no } from "@/lib/locale/no";

const SOLVED_KEY = "ttt:puzzles-solved";

const GLYPH = { x: "✕", o: "◯" } as const;

/** Exported for tests. Falls back to 0 on the server, when storage is
 *  unavailable (e.g. Safari "Block All Cookies"), or when the stored value is
 *  missing/unparsable. */
export function readSolved(): number {
  return parseInt(safeGet(SOLVED_KEY) ?? "0", 10) || 0;
}

/** The question this puzzle asks, in the solver's own glyphs. */
export function promptFor(p: TttPuzzle): string {
  return p.kind === "win"
    ? no.puzzle.promptWin(GLYPH[p.toMove])
    : no.puzzle.promptBlock(GLYPH[opponentOf(p)]);
}

export function PuzzleCard({ variantId }: { variantId?: string }) {
  // Only ever the pack for the board this class is actually playing on (the
  // whole pack if that variant is unknown — puzzlesForVariant degrades rather
  // than returning nothing). Fixed for the life of the card: the tournament's
  // variant cannot change mid-tournament.
  const pool = useMemo(() => puzzlesForVariant(variantId), [variantId]);
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * pool.length));
  const [answer, setAnswer] = useState<number | null>(null);
  const [wrong, setWrong] = useState(false);
  const [solvedCount, setSolvedCount] = useState(readSolved);

  const puzzle = pool[idx % pool.length];
  const variant = variantById(puzzle.variantId);
  const solved = answer !== null;

  // The position on screen: the puzzle, or the puzzle WITH the answer played.
  const shown = solved
    ? puzzle.board.slice(0, answer) + puzzle.toMove + puzzle.board.slice(answer + 1)
    : puzzle.board;
  // A solved "win" ends in a line — light it up. A solved "block" does not; the
  // last-cell ring carries it instead.
  const winLine = solved
    ? (findWinLine(shown, variant.m, variant.n, variant.k)?.cells ?? null)
    : null;

  const next = useCallback(() => {
    // Advance by a random non-zero stride so the same position never repeats
    // back-to-back, and a single-puzzle pool still terminates.
    setIdx((i) =>
      pool.length <= 1
        ? i
        : (i + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length,
    );
    setAnswer(null);
    setWrong(false);
  }, [pool.length]);

  function tap(cell: number) {
    if (solved) return;
    if (!isSolution(puzzle, cell)) {
      setWrong(true);
      // The neutral move tick, not the losing jingle (which is what the chess
      // card plays here too): a wrong tap in a puzzle is a try, and a room of
      // twenty-five devices does not need a defeat fanfare every few seconds.
      // The red banner is the feedback.
      sound.play("move");
      return;
    }
    setWrong(false);
    setAnswer(cell);
    sound.play("win");
    const n = readSolved() + 1;
    safeSet(SOLVED_KEY, String(n)); // best-effort; the count stays in memory otherwise
    setSolvedCount(n);
  }

  return (
    <div
      className="card stack"
      style={{ padding: 18, width: "100%", maxWidth: 420, gap: 10 }}
      data-testid="puzzle-card"
    >
      <div className="spread">
        <p className="eyebrow" style={{ fontSize: 11 }}>🧩 {no.puzzle.title}</p>
        {solvedCount > 0 && (
          <span className="badge">
            {solvedCount} {no.puzzle.counter}
          </span>
        )}
      </div>
      <p style={{ fontSize: 14 }}>
        <b>{promptFor(puzzle)}</b>{" "}
        <span className="muted">— {no.puzzle.oneMove}</span>
      </p>

      <div className="puzzle-board">
        <MnkBoard
          state={shown}
          m={variant.m}
          n={variant.n}
          onCell={tap}
          disabled={solved}
          lastCell={answer}
          winLine={winLine}
          size="sm"
        />
      </div>

      {/* fixed-height foot — see the LAYOUT RULE note at the top of the file */}
      <div className="puzzle-foot">
        <div
          className={`banner ${solved ? "banner-turn" : "banner-error"}`}
          style={{ width: "100%", visibility: solved || wrong ? "visible" : "hidden" }}
          role="status"
          aria-live="polite"
        >
          {solved ? no.puzzle.solved : no.puzzle.wrong}
        </div>
        <button
          className={`btn ${solved ? "btn-primary" : "btn-ghost"} btn-block`}
          style={{ fontSize: 13 }}
          onClick={next}
        >
          {no.puzzle.next} →
        </button>
      </div>
    </div>
  );
}
