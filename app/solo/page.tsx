"use client";

import { useState } from "react";
import Link from "next/link";
import { applyMove } from "@/lib/ttt/validateMove";
import { chooseMove, type BotLevel } from "@/lib/ttt/bot";
import { findWinLine } from "@/lib/ttt/win";
import { VARIANTS, variantStartState, type MnkVariant } from "@/lib/ttt/variants";
import { Confetti } from "@/lib/client/Confetti";
import { MnkBoard } from "@/lib/client/MnkBoard";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";

type Phase = "setup" | "game";
type Color = "white" | "black"; // white = X (first), black = O (second)
type Outcome = "win" | "loss" | "draw";

const LEVELS: { key: BotLevel; label: string }[] = [
  { key: "easy", label: no.solo.easy },
  { key: "medium", label: no.solo.medium },
  { key: "hard", label: no.solo.hard },
  { key: "impossible", label: no.solo.impossible },
];

function turnOf(state: string): "w" | "b" {
  return [...state].filter((c) => c !== ".").length % 2 === 0 ? "w" : "b";
}

export default function Solo() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [colorPref, setColorPref] = useState<"white" | "black" | "random">("white");
  const [level, setLevel] = useState<BotLevel>("medium");
  const [variant, setVariant] = useState<MnkVariant>(VARIANTS[0]);
  const [playerColor, setPlayerColor] = useState<Color>("white");

  const [state, setState] = useState(variantStartState(VARIANTS[0]));
  const [history, setHistory] = useState<string[]>([]);
  const [lastCell, setLastCell] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const myLetter = playerColor === "white" ? "w" : "b";
  const turn = turnOf(state);
  const isMyTurn = !thinking && !outcome && turn === myLetter;

  function settleFrom(status: string): boolean {
    if (status === "live") return false;
    let oc: Outcome;
    if (status === "draw") oc = "draw";
    else {
      const winnerColor: Color = status === "white_win" ? "white" : "black";
      oc = winnerColor === playerColor ? "win" : "loss";
    }
    setOutcome(oc);
    sound.play(oc === "win" ? "win" : oc === "loss" ? "lose" : "draw");
    return true;
  }

  // The bot replies. chooseMove runs on the main thread (microseconds-to-ms even
  // on the largest board), wrapped in a short delay so the player's mark renders
  // first and the reply feels deliberate.
  function botPlay(board: string) {
    setThinking(true);
    setHistory((h) => [...h, board]);
    setTimeout(() => {
      const cell = chooseMove(board, variant, level);
      if (cell === null) {
        setThinking(false);
        return;
      }
      const res = applyMove(board, { cell }, undefined, variant);
      if (!res.ok) {
        setThinking(false);
        return;
      }
      setState(res.fen);
      setLastCell(cell);
      setThinking(false);
      settleFrom(res.status);
    }, 320);
  }

  function tryMove(cell: number) {
    if (!isMyTurn) return;
    const res = applyMove(state, { cell }, undefined, variant);
    if (!res.ok) return;
    setHistory((h) => [...h, state]);
    setState(res.fen);
    setLastCell(cell);
    sound.play("move");
    if (settleFrom(res.status)) return;
    botPlay(res.fen);
  }

  function start() {
    const color: Color =
      colorPref === "random" ? (Math.random() < 0.5 ? "white" : "black") : colorPref;
    setPlayerColor(color);
    const s = variantStartState(variant);
    setState(s);
    setHistory([]);
    setLastCell(null);
    setOutcome(null);
    setThinking(false);
    setPhase("game");
    sound.play("start");
    if (color === "black") botPlay(s); // computer (X) opens
  }

  function undo() {
    if (thinking || history.length === 0) return;
    const back = history.length >= 2 ? 2 : 1;
    setState(history[history.length - back]);
    setHistory(history.slice(0, history.length - back));
    setOutcome(null);
    setLastCell(null);
  }

  // ---------- setup ----------
  if (phase === "setup") {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack scale-in" style={{ alignItems: "stretch" }}>
          <div className="brandmark" style={{ justifyContent: "center" }}>
            <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
          </div>
          <div className="text-center stack" style={{ gap: 4 }}>
            <p className="eyebrow">{no.solo.title}</p>
            <p className="faint" style={{ fontSize: 13 }}>{no.solo.subtitle}</p>
          </div>

          <div className="field">
            <label>{no.solo.chooseColor}</label>
            <div className="row">
              {(["white", "black", "random"] as const).map((c) => (
                <button
                  key={c}
                  className={`btn grow ${colorPref === c ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setColorPref(c)}
                >
                  {c === "white" ? `✕ ${no.solo.white}` : c === "black" ? `◯ ${no.solo.black}` : no.solo.random}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{no.solo.variant}</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 8 }}>
              {VARIANTS.map((v) => (
                <button
                  key={v.id}
                  className={`btn ${variant.id === v.id ? "btn-primary" : "btn-ghost"}`}
                  style={{ padding: "10px 8px" }}
                  onClick={() => setVariant(v)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{no.solo.difficulty}</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 8 }}>
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  className={`btn ${level === l.key ? "btn-primary" : "btn-ghost"}`}
                  style={{ padding: "10px 8px" }}
                  onClick={() => setLevel(l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary btn-block btn-lg" onClick={start}>
            {no.solo.start} →
          </button>
          <Link href="/" className="btn btn-ghost btn-block">
            {no.solo.back}
          </Link>
        </div>
      </main>
    );
  }

  // ---------- game ----------
  const outText =
    outcome === "win" ? no.solo.youWon : outcome === "loss" ? no.solo.youLost : no.solo.draw;
  const outSub =
    outcome === "win" ? no.solo.wonSub : outcome === "loss" ? no.solo.lostSub : no.solo.drawSub;
  const winLine = outcome && outcome !== "draw"
    ? findWinLine(state, variant.m, variant.n, variant.k)?.cells ?? null
    : null;

  return (
    <main className="center-screen">
      {outcome === "win" && <Confetti count={120} />}
      <div className="stack" style={{ alignItems: "center", width: "100%", maxWidth: 600, gap: 16 }}>
        <div className="spread" style={{ width: "min(92vw,560px)" }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="avatar-lg">{no.solo.you[0]}</span>
            <b>{no.solo.you}</b>
          </div>
          <span className="faint" style={{ fontStyle: "italic" }}>vs</span>
          <div className="row" style={{ gap: 10 }}>
            <b>{no.solo.computer}</b>
            <span
              className="avatar-lg"
              style={{ background: "linear-gradient(180deg,var(--ink-soft),#1c212b)", color: "var(--txt)", border: "1px solid var(--ink-line-strong)" }}
            >
              🤖
            </span>
          </div>
        </div>

        {!outcome && (
          <div
            className={`banner ${isMyTurn ? "banner-turn" : "banner-wait"}`}
            style={{ width: "min(92vw,560px)" }}
            role="status"
            aria-live="polite"
          >
            {thinking ? no.solo.thinking : isMyTurn ? `✕ ${no.solo.yourTurn}` : no.solo.waiting}
          </div>
        )}

        <div className="board-frame">
          <div className="board-shell">
            <MnkBoard
              state={state}
              m={variant.m}
              n={variant.n}
              onCell={tryMove}
              disabled={!isMyTurn}
              lastCell={lastCell}
              winLine={winLine}
              size="lg"
            />
          </div>
        </div>

        <div className="row">
          <button className="btn btn-ghost" onClick={undo} disabled={thinking}>
            ↶ {no.solo.undo}
          </button>
          <button className="btn" onClick={start} disabled={thinking}>
            {no.solo.newGame}
          </button>
          <Link href="/" className="btn btn-ghost">
            {no.solo.back}
          </Link>
        </div>
      </div>

      {outcome && (
        <div className="result-overlay">
          <div className="result-card stack" style={{ alignItems: "center", gap: 12 }}>
            <div className="result-emoji">
              {outcome === "win" ? "🎉" : outcome === "draw" ? "🤝" : "🤖"}
            </div>
            <h1 style={{ fontSize: "clamp(34px,8vw,60px)" }}>{outText}</h1>
            <p className="muted">{outSub}</p>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn btn-primary btn-lg" onClick={start}>
                {no.solo.newGame}
              </button>
              <Link href="/" className="btn btn-lg">
                {no.solo.back}
              </Link>
            </div>
          </div>
        </div>
      )}

      <SoundToggle />
    </main>
  );
}
