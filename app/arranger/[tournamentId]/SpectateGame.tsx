"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  REACTION_EMOJIS,
  ReactionLayer,
  type FloatingReaction,
} from "@/lib/client/Reactions";
import { MoveList, sansFromPgn } from "@/lib/client/MoveList";
import { MnkBoard } from "@/lib/client/MnkBoard";
import { findWinLine } from "@/lib/ttt/win";
import { api } from "@/lib/client/api";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { Confetti, initials } from "@/lib/client/Confetti";
import { sound } from "@/lib/client/sound";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import { createReactionGate } from "@/lib/realtimeTrust";
import type { GameStatus } from "@/lib/types";
import { no } from "@/lib/locale/no";

function SpectatePlayer({ name, side }: { name: string; side: "white" | "black" }) {
  return (
    <div className="spread" style={{ width: "min(92vw, 520px)" }}>
      <div className="row" style={{ gap: 10 }}>
        <span
          className="avatar-lg"
          style={
            side === "black"
              ? {
                  background: "linear-gradient(180deg,var(--ink-soft),#1c212b)",
                  color: "var(--txt)",
                  border: "1px solid var(--ink-line-strong)",
                }
              : undefined
          }
        >
          {initials(name)}
        </span>
        <b style={{ fontSize: 18 }}>
          {side === "white" ? "✕ " : "◯ "}
          {name}
        </b>
      </div>
    </div>
  );
}

/** Big-screen spectator view of one game: large read-only board with player
 * reactions and a subtle move tick. Position is driven by `fen` from the parent
 * (which patches it live); when `result` is set the game just ended → a winner
 * animation. */
export function SpectateGame({
  gameId,
  fen,
  m,
  n,
  k,
  white,
  black,
  senders,
  onClose,
  result,
}: {
  gameId: string;
  fen: string;
  m: number;
  n: number;
  k: number;
  white: string;
  black: string;
  /** Player ids allowed to send a reaction on this channel — the tournament's
   * roster. Reactions are unauthenticated client→client broadcasts, so an
   * unknown `by` is somebody who is not in this room. */
  senders: ReadonlySet<string>;
  onClose: () => void;
  result?: GameStatus | null;
}) {
  const [floats, setFloats] = useState<FloatingReaction[]>([]);
  const floatSeq = useRef(0);

  // FEN-driven (the parent patches `fen` live), so fetch the pgn for the move
  // list when the position changes (one cheap fetch per move).
  const [sans, setSans] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    api
      .game(gameId)
      .then((d) => {
        if (live) setSans(sansFromPgn(d.pgn));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gameId, fen]);

  const addFloat = useCallback((emoji: string) => {
    const id = ++floatSeq.current;
    setFloats((f) => [...f, { id, emoji, x: 12 + Math.random() * 70 }]);
    setTimeout(() => setFloats((f) => f.filter((r) => r.id !== id)), 2600);
  }, []);

  // Reactions only — the position comes from the parent. Gated exactly like the
  // player's board (allowlist + known sender + 5/s, lib/realtimeTrust.ts): this
  // one is on a projector, so a flood here is the most visible of all.
  const reactionGate = useMemo(() => createReactionGate(REACTION_EMOJIS), []);
  useChannel(channels.game(gameId), (event, payload) => {
    if (event !== "reaction") return;
    const emoji = reactionGate(payload, senders);
    if (emoji) addFloat(emoji);
  });

  // subtle tick on each new position (skip the first render)
  const prevFen = useRef<string | null>(null);
  useEffect(() => {
    if (prevFen.current !== null && prevFen.current !== fen) sound.play("tick");
    prevFen.current = fen;
  }, [fen]);

  const decided = result && result !== "live";
  const cheered = useRef(false);
  useEffect(() => {
    if (decided && !cheered.current) {
      cheered.current = true;
      sound.play(result === "draw" ? "draw" : "win");
    }
  }, [decided, result]);

  const winnerText =
    result === "white_win"
      ? `${white} ${no.host.spectateWon}`
      : result === "black_win"
        ? `${black} ${no.host.spectateWon}`
        : result === "draw"
          ? no.host.spectateDraw
          : "";

  const winLine = decided ? findWinLine(fen, m, n, k)?.cells ?? null : null;

  return (
    <main className="center-screen is-game">
      {(result === "white_win" || result === "black_win") && <Confetti count={140} />}
      <div className="stack" style={{ alignItems: "center", gap: 14 }}>
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onClose}>
          ← {no.host.liveToggle}
        </button>

        <SpectatePlayer name={black} side="black" />

        <div className="board-frame">
          <div style={{ width: "min(78vh, 620px)", maxWidth: "92vw" }}>
            <MnkBoard state={fen} m={m} n={n} winLine={winLine} size="lg" />
          </div>
          <ReactionLayer items={floats} />
          {decided && (
            <div className="result-overlay" style={{ position: "absolute", borderRadius: 8 }}>
              <div className="result-card stack" style={{ alignItems: "center", gap: 8 }}>
                <div className="result-emoji">{result === "draw" ? "🤝" : "🏆"}</div>
                <h2 style={{ fontSize: "clamp(28px,5vw,48px)", textAlign: "center" }}>
                  {winnerText}
                </h2>
              </div>
            </div>
          )}
        </div>

        <SpectatePlayer name={white} side="white" />

        {/* Always mounted (L8): the list is a fixed-height block, so it must not
            appear on the first move and push the projector layout around. */}
        <MoveList sans={sans} />
      </div>

      <SoundToggle />
      <FullscreenToggle />
    </main>
  );
}
