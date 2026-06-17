"use client";

import { useState } from "react";
import { applyMove } from "@/lib/ttt/validateMove";
import { findWinLine } from "@/lib/ttt/win";
import { VARIANTS, variantStartState, type MnkVariant } from "@/lib/ttt/variants";
import { Confetti } from "@/lib/client/Confetti";
import { MnkBoard } from "@/lib/client/MnkBoard";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";

type Turn = "w" | "b";
type Outcome = "white" | "black" | "draw";

/** Same-screen pass-and-play: two humans share one device, taking turns placing
 * X and O. Pure client-side — no server, works offline. */
export function LocalVersus({ onExit }: { onExit: () => void }) {
  const [variant, setVariant] = useState<MnkVariant>(VARIANTS[0]);
  const [state, setState] = useState(variantStartState(VARIANTS[0]));
  const [history, setHistory] = useState<string[]>([]);
  const [lastCell, setLastCell] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const filled = [...state].filter((c) => c !== ".").length;
  const turn: Turn = filled % 2 === 0 ? "w" : "b";

  function tryMove(cell: number) {
    if (outcome) return;
    const res = applyMove(state, { cell }, undefined, variant);
    if (!res.ok) return;
    setHistory((h) => [...h, state]);
    setState(res.fen);
    setLastCell(cell);
    if (res.status === "white_win") {
      setOutcome("white");
      sound.play("win");
    } else if (res.status === "black_win") {
      setOutcome("black");
      sound.play("win");
    } else if (res.status === "draw") {
      setOutcome("draw");
      sound.play("draw");
    } else {
      sound.play("move");
    }
  }

  function newGame(v: MnkVariant = variant) {
    setVariant(v);
    setState(variantStartState(v));
    setHistory([]);
    setLastCell(null);
    setOutcome(null);
    sound.play("start");
  }

  function undo() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setState(prev);
    setOutcome(null);
    setLastCell(null);
  }

  const winLine = outcome && outcome !== "draw"
    ? findWinLine(state, variant.m, variant.n, variant.k)?.cells ?? null
    : null;

  const outText =
    outcome === "white"
      ? no.versus.whiteWon
      : outcome === "black"
        ? no.versus.blackWon
        : no.versus.draw;

  return (
    <main className="center-screen">
      {outcome && outcome !== "draw" && <Confetti count={120} />}
      <div className="stack" style={{ alignItems: "center", width: "100%", maxWidth: 600, gap: 16 }}>
        {/* variant picker (only before the first move) */}
        {filled === 0 && !outcome && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                className={`btn ${v.id === variant.id ? "btn-primary" : "btn-ghost"}`}
                onClick={() => newGame(v)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        {!outcome && (
          <div
            className="banner banner-turn"
            style={{ width: "min(92vw,560px)" }}
            role="status"
            aria-live="polite"
          >
            {turn === "w" ? `✕ ${no.versus.whiteTurn}` : `◯ ${no.versus.blackTurn}`}
          </div>
        )}

        <div className="board-frame">
          <div className="board-shell">
            <MnkBoard
              state={state}
              m={variant.m}
              n={variant.n}
              onCell={tryMove}
              disabled={!!outcome}
              lastCell={lastCell}
              winLine={winLine}
              size="lg"
            />
          </div>
        </div>

        <div className="row">
          <button className="btn btn-ghost" onClick={undo}>
            ↶ {no.solo.undo}
          </button>
          <button className="btn" onClick={() => newGame()}>
            {no.versus.newGame}
          </button>
          <button className="btn btn-ghost" onClick={onExit}>
            {no.versus.back}
          </button>
        </div>
      </div>

      {outcome && (
        <div className="result-overlay">
          <div className="result-card stack" style={{ alignItems: "center", gap: 12 }}>
            <div className="result-emoji">{outcome === "draw" ? "🤝" : "🎉"}</div>
            <h1 style={{ fontSize: "clamp(34px,8vw,60px)" }}>{outText}</h1>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn btn-primary btn-lg" onClick={() => newGame()}>
                {no.versus.newGame}
              </button>
              <button className="btn btn-lg" onClick={onExit}>
                {no.versus.back}
              </button>
            </div>
          </div>
        </div>
      )}

      <SoundToggle />
    </main>
  );
}
