"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { applyMove } from "@/lib/ttt/validateMove";
import type { BotLevel } from "@/lib/ttt/bot";
import {
  botSkillForPlayer,
  INITIAL_RATING,
  outcomeToScore,
  skillToParams,
  updateRating,
  type RatingState,
} from "@/lib/ttt/skill";
import { identity } from "@/lib/client/identity";
import { requestBotMove } from "@/lib/client/engine";
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

/** The four fixed rungs, plus the one that picks its own. */
type SoloLevel = BotLevel | "adaptive";

const LEVELS: { key: SoloLevel; label: string }[] = [
  { key: "adaptive", label: no.solo.adaptive },
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
  // "Tilpasset" is where a new player starts: it is the only setting that does
  // not ask a child to guess, in advance, how good they are.
  const [level, setLevel] = useState<SoloLevel>("adaptive");
  const [variant, setVariant] = useState<MnkVariant>(VARIANTS[0]);
  const [playerColor, setPlayerColor] = useState<Color>("white");

  const [state, setState] = useState(variantStartState(VARIANTS[0]));
  const [history, setHistory] = useState<string[]>([]);
  const [lastCell, setLastCell] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Bumped whenever the position the bot was asked about stops being the
  // position on screen (new game, undo, variant switch). A reply carrying an old
  // number is dropped — the search runs off-thread now, so it can land after the
  // board it was thinking about is gone.
  const gameSeq = useRef(0);

  // --- adaptive difficulty ---------------------------------------------------
  //
  // The rating is READ FROM STORAGE IN AN EFFECT, not in the useState
  // initializer, because this page is prerendered: the server has no
  // localStorage, so an initializer would render 800 into the HTML and then a
  // different number on hydration. Starting both sides at INITIAL_RATING and
  // correcting on mount keeps the first paint honest.
  //
  // `ratingRef` is the source of truth for the update after a game; `rating`
  // exists only to render the chip. The three refs below are frozen at the
  // moment a game STARTS: the bot must not change strength halfway through
  // because the previous result moved the rating, and a game must be scored
  // against the bot it was actually played against.
  const ratingRef = useRef<RatingState>(INITIAL_RATING);
  const [rating, setRating] = useState<RatingState>(INITIAL_RATING);
  const gameSkill = useRef(botSkillForPlayer(INITIAL_RATING));
  const gameLevel = useRef<SoloLevel>("adaptive");
  /** the gameSeq already scored — one rating update per game, never two */
  const ratedSeq = useRef(-1);

  useEffect(() => {
    const stored = identity.soloRating();
    ratingRef.current = stored;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRating(stored);
  }, []);

  /** Move the rating after an adaptive game. The bot mirrors the player, so a
   * win pushes the next bot up and a loss pushes it down — that is the whole
   * auto-tune. Fixed levels are deliberately NOT scored: losing ten in a row to
   * "Uslåelig" says nothing about the player, and would drag the adaptive bot
   * down to a level they have already outgrown. */
  function rate(oc: Outcome) {
    if (gameLevel.current !== "adaptive") return;
    if (ratedSeq.current === gameSeq.current) return;
    ratedSeq.current = gameSeq.current;
    const next = updateRating(ratingRef.current, gameSkill.current, outcomeToScore(oc));
    ratingRef.current = next;
    identity.saveSoloRating(next);
    setRating(next);
  }

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
    rate(oc);
    sound.play(oc === "win" ? "win" : oc === "loss" ? "lose" : "draw");
    return true;
  }

  // The bot replies. The search is dispatched to a Web Worker IMMEDIATELY and
  // raced against a 320 ms floor: the floor keeps the reply feeling deliberate
  // (and lets the player's own mark render first), while the search runs off the
  // main thread, so "Datamaskinen tenker …" actually animates instead of the tab
  // locking up behind it. On a browser without workers the gateway falls back to
  // the same synchronous search and this behaves exactly as it used to.
  async function botPlay(board: string) {
    const seq = gameSeq.current;
    setThinking(true);
    setHistory((h) => [...h, board]);
    try {
      // On "Tilpasset" the knobs replace the level entirely (chooseMove ignores
      // `level` whenever params are present); "impossible" is passed only
      // because the worker's request validator insists on a real level.
      const lvl = gameLevel.current;
      const [cell] = await Promise.all([
        requestBotMove(
          board,
          variant,
          lvl === "adaptive" ? "impossible" : lvl,
          lvl === "adaptive" ? skillToParams(gameSkill.current, variant) : undefined,
        ),
        new Promise((r) => setTimeout(r, 320)),
      ]);
      if (seq !== gameSeq.current) return; // this game is over; drop the reply
      if (cell === null) return;
      const res = applyMove(board, { cell }, undefined, variant);
      if (!res.ok) return;
      setState(res.fen);
      setLastCell(cell);
      settleFrom(res.status);
    } finally {
      // Only if we are still the current game — a newer botPlay may already own
      // the thinking flag.
      if (seq === gameSeq.current) setThinking(false);
    }
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
    void botPlay(res.fen);
  }

  function start() {
    gameSeq.current++;
    // Freeze the opponent for this game before anything can move the rating.
    gameLevel.current = level;
    gameSkill.current = botSkillForPlayer(ratingRef.current);
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
    if (color === "black") void botPlay(s); // computer (X) opens
  }

  function undo() {
    if (thinking || history.length === 0) return;
    // Undoing a FINISHED game carries its "already scored" mark to the new
    // sequence number, so taking a loss back and playing the same game to a win
    // cannot be scored twice. Undo before the end (the normal case) leaves the
    // game unscored and still scorable.
    const wasRated = ratedSeq.current === gameSeq.current;
    gameSeq.current++;
    if (wasRated) ratedSeq.current = gameSeq.current;
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
                  onClick={() => {
                    gameSeq.current++;
                    setVariant(v);
                  }}
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
            {level === "adaptive" && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="badge">{no.solo.levelChip(rating.rating)}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {no.solo.adaptiveNote}
                </span>
              </div>
            )}
            {variant.id === "3x3" && (
              <span className="muted" style={{ fontSize: 12 }}>
                {no.solo.unbeatable3x3Note}
              </span>
            )}
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
    <main className="center-screen is-game">
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

        {/* Turn banner — always mounted (L2, same pattern as GameView and
            LocalVersus), visibility:hidden once the game ends instead of
            unmounted, so it doesn't vanish out from under the board while
            .result-overlay (translucent, fades in over 0.3s) reveals
            whatever is happening underneath it. */}
        <div className="turn-slot" style={outcome ? { visibility: "hidden" } : undefined}>
          <div
            className={`banner ${isMyTurn ? "banner-turn" : "banner-wait"}`}
            style={{ width: "min(92vw,560px)" }}
            role="status"
            aria-live="polite"
          >
            <span className="banner-line">
              {thinking
                ? no.solo.thinking
                : isMyTurn
                  ? `${playerColor === "white" ? "✕" : "◯"} ${no.solo.yourTurn}`
                  : no.solo.waiting}
            </span>
          </div>
        </div>

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
            {/* `level` cannot change while a game is on screen (it is only
                settable in setup), so this is the level that was played. */}
            {level === "adaptive" && (
              <span className="badge">{no.solo.levelChip(rating.rating)}</span>
            )}
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
