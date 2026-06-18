"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardState } from "@/lib/dto";
import type { GameStatus } from "@/lib/types";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import { no } from "@/lib/locale/no";
import { variantById } from "@/lib/ttt/variants";
import { plyOf } from "@/lib/ttt/ply";
import { MnkBoard } from "@/lib/client/MnkBoard";
import { SpectateGame } from "./SpectateGame";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { Confetti } from "@/lib/client/Confetti";

/** Column min-width for the responsive grid: fewer live games ⇒ bigger boards
 * so the projector stays readable as a round winds down. (1 game is special-
 * cased to a single large board.) */
function gridMin(liveCount: number): number {
  if (liveCount <= 3) return 440;
  if (liveCount <= 6) return 320;
  return 220;
}

export function LiveGamesView({
  state,
  onStale,
  onExitLive,
}: {
  state: BoardState;
  onStale?: () => void;
  /** Leave live mode back to the arranging view (bracket / league control). */
  onExitLive?: () => void;
}) {
  const { tournament, players, games, rounds } = state;
  const V = variantById(tournament.config.variant);
  const nameById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.displayName]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : no.host.bye);
  }, [players]);

  // Freshest board per game: realtime spectate patches instantly, the 5 s board
  // poll self-heals; merge by ply so we never show an older position.
  const [fenMap, setFenMap] = useState<Record<string, string>>(() =>
    Object.fromEntries(games.map((g) => [g.id, g.fen])),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  // Games we've seen finish this session — drop them from the grid the instant
  // the result event arrives, without waiting for the next board poll.
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  // Result of the currently-open game (drives the winner animation + auto-close).
  const [openResult, setOpenResult] = useState<GameStatus | null>(null);
  // A brief "X vant!" flash over the grid when any game finishes in live mode.
  const [winFlash, setWinFlash] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFenMap((m) => {
      const next = { ...m };
      for (const g of games) {
        if (!next[g.id] || plyOf(g.fen) >= plyOf(next[g.id])) next[g.id] = g.fen;
      }
      const liveIds = new Set(games.filter((g) => g.status === "live").map((g) => g.id));
      for (const id of Object.keys(next)) {
        if (!liveIds.has(id)) delete next[id];
      }
      return next;
    });
    setFinished((s) => {
      if (s.size === 0) return s;
      const liveNow = new Set(games.filter((g) => g.status === "live").map((g) => g.id));
      const present = new Set(games.map((g) => g.id));
      const next = new Set<string>();
      for (const id of s) if (present.has(id) && !liveNow.has(id)) next.add(id);
      return next.size === s.size ? s : next;
    });
  }, [games]);

  useChannel(
    channels.spectate(tournament.id),
    (event, payload) => {
      if (event === "position") {
        const p = payload as { gameId: string; fen: string };
        setFenMap((m) =>
          !m[p.gameId] || plyOf(p.fen) >= plyOf(m[p.gameId])
            ? { ...m, [p.gameId]: p.fen }
            : m,
        );
      } else if (event === "result") {
        const p = payload as { gameId: string; status: GameStatus };
        setFinished((s) => (s.has(p.gameId) ? s : new Set(s).add(p.gameId)));
        if (p.gameId === openId) setOpenResult(p.status);
        const g = games.find((x) => x.id === p.gameId);
        const flash =
          p.status === "white_win" && g
            ? `${nameById(g.whitePlayerId)} ${no.host.spectateWon}`
            : p.status === "black_win" && g
              ? `${nameById(g.blackPlayerId)} ${no.host.spectateWon}`
              : p.status === "draw"
                ? no.host.spectateDraw
                : null;
        if (flash) setWinFlash(flash);
        onStale?.();
      }
    },
    (s) => {
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") onStale?.();
    },
  );

  // Auto-return from a finished spectated game after the winner animation.
  useEffect(() => {
    if (!openResult) return;
    const t = setTimeout(() => {
      setOpenId(null);
      setOpenResult(null);
    }, 4500);
    return () => clearTimeout(t);
  }, [openResult]);

  useEffect(() => {
    if (!winFlash) return;
    const t = setTimeout(() => setWinFlash(null), 3500);
    return () => clearTimeout(t);
  }, [winFlash]);

  const roundOver = useMemo(() => {
    const cur = games.filter((g) => {
      const r = rounds.find((rr) => rr.id === g.roundId);
      return r?.number === tournament.currentRound;
    });
    return cur.length > 0 && cur.every((g) => g.status !== "live");
  }, [games, rounds, tournament.currentRound]);

  // Stable board order: by bracket/pairing slot, then id (the games list is
  // ordered by updated_at, so without this a move would bump its card around).
  const live = games
    .filter((g) => g.status === "live" && g.blackPlayerId && !finished.has(g.id))
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0) || a.id.localeCompare(b.id));

  if (openId) {
    const g = games.find((x) => x.id === openId);
    if (g) {
      return (
        <SpectateGame
          gameId={g.id}
          fen={fenMap[g.id] ?? g.fen}
          m={V.m}
          n={V.n}
          k={V.k}
          white={nameById(g.whitePlayerId)}
          black={nameById(g.blackPlayerId)}
          result={openResult}
          onClose={() => {
            setOpenId(null);
            setOpenResult(null);
          }}
        />
      );
    }
  }

  // The header card markup for one game (names).
  const Heads = (g: (typeof live)[number]) => (
    <div className="spread" style={{ marginBottom: 8, fontSize: 14, alignItems: "center" }}>
      <b>{nameById(g.whitePlayerId)}</b>
      <span className="faint">vs</span>
      <b>{nameById(g.blackPlayerId)}</b>
    </div>
  );

  // 1 game left → one big board that fills the projector.
  if (live.length === 1) {
    const g = live[0];
    return (
      <main className="wrap" style={{ padding: "12px 24px 48px", maxWidth: "min(96vw, 1100px)" }}>
        <button
          onClick={() => { setOpenId(g.id); setOpenResult(null); }}
          className="card reveal"
          style={{ padding: 16, cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
        >
          {Heads(g)}
          <div className="stack" style={{ alignItems: "center" }}>
            <div style={{ width: "min(80vh, 640px)", maxWidth: "100%" }}>
              <MnkBoard state={fenMap[g.id] ?? g.fen} m={V.m} n={V.n} size="lg" />
            </div>
          </div>
        </button>
        <FullscreenToggle />
      </main>
    );
  }

  return (
    <main className="wrap" style={{ padding: "12px 24px 64px", maxWidth: "min(96vw, 1800px)" }}>
      {live.length === 0 ? (
        roundOver && onExitLive ? (
          <div className="result-overlay">
            <Confetti count={120} />
            <div className="result-card stack" style={{ alignItems: "center", gap: 14 }}>
              <div className="result-emoji">🏁</div>
              <h2 style={{ fontSize: "clamp(28px,5vw,46px)", textAlign: "center" }}>
                {no.host.roundOver}
              </h2>
              <button className="btn btn-primary btn-lg" onClick={onExitLive}>
                {no.host.backToArranging} →
              </button>
            </div>
          </div>
        ) : (
          <p className="muted text-center" style={{ padding: 40 }}>
            Ingen partier pågår akkurat nå.
          </p>
        )
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin(live.length)}px, 1fr))`,
            gap: 20,
            justifyContent: "center",
          }}
        >
          {live.map((g) => (
            <button
              key={g.id}
              onClick={() => { setOpenId(g.id); setOpenResult(null); }}
              className="card reveal"
              style={{ padding: 12, cursor: "pointer", textAlign: "left", color: "inherit" }}
            >
              {Heads(g)}
              <MnkBoard state={fenMap[g.id] ?? g.fen} m={V.m} n={V.n} size="sm" />
            </button>
          ))}
        </div>
      )}

      {winFlash && !roundOver && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            zIndex: 55,
          }}
        >
          <Confetti count={90} />
          <div className="result-card stack" style={{ alignItems: "center", gap: 8 }}>
            <div className="result-emoji">🎉</div>
            <h2 style={{ fontSize: "clamp(24px,4.5vw,40px)", textAlign: "center" }}>
              {winFlash}
            </h2>
          </div>
        </div>
      )}
      <FullscreenToggle />
    </main>
  );
}
