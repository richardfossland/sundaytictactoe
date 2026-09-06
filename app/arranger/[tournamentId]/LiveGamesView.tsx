"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardState } from "@/lib/dto";
import type { GameStatus } from "@/lib/types";
import { channels } from "@/lib/realtime";
import {
  isValidSpectatePosition,
  isValidSpectateResult,
} from "@/lib/realtimeTrust";
import { useChannel } from "@/lib/client/useChannel";
import { no } from "@/lib/locale/no";
import { variantById } from "@/lib/ttt/variants";
import { plyOf } from "@/lib/ttt/ply";
import { MnkBoard } from "@/lib/client/MnkBoard";
import { SpectateGame } from "./SpectateGame";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { Confetti } from "@/lib/client/Confetti";

/** The spectate feed is unauthenticated like every other topic (lib/realtimeTrust.ts):
 * anyone holding the public anon key can send a `position` for any game id in
 * the tournament. So a broadcast here is an OVERLAY on the authoritative board
 * poll, never a merge into it — it fills the gap between two polls and stops
 * counting the moment the poll reaches the same ply, or this long after it
 * arrived, whichever comes first. Longer than a refetch round-trip so a real
 * move never flickers back off the projector; short enough that a forged
 * position is gone while the teacher is still looking at it. */
const PATCH_TTL_MS = 4000;

/** How long a burst of spectate broadcasts is coalesced into one board refetch.
 * A round with fifteen boards emits a lot of these; without the window every
 * move in the room would be its own GET. */
const PATCH_REFETCH_MS = 1000;

/** A board a broadcast claims for one game, pending the next board poll. */
type Patch = { fen: string; ply: number; at: number };

/** Column min-width for the responsive grid: fewer live games ⇒ bigger boards
 * so the projector stays readable as a round winds down. (1 game is special-
 * cased to a single large board.) */
function gridMin(liveCount: number): number {
  if (liveCount <= 3) return 440;
  if (liveCount <= 6) return 320;
  return 220;
}

/** Names + clocks shrink at the same tiers as the boards (gridMin above) —
 * otherwise the header text stays board-agnostic and starts to crowd or
 * overflow its card once a round packs many small boards onto one screen. */
function headerFontSize(liveCount: number): number {
  if (liveCount <= 3) return 16;
  if (liveCount <= 6) return 14;
  return 12;
}

/** Boards shown at once before "Vis alle" is needed — a busy first round can
 * have well over a dozen games live simultaneously, and a projector grid that
 * dense stops being readable from across a classroom. */
const LIVE_GRID_CAP = 8;

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

  const playerIds = useMemo(() => new Set(players.map((p) => p.id)), [players]);

  // Broadcast overlay per game: realtime patches the projector instantly, the
  // 5 s board poll is what it is checked against. Held SEPARATELY from `games`
  // (rather than merged into a fenMap that then had to be un-merged) so the
  // authoritative board is always one field away — a patch stops applying by
  // itself the moment the poll catches up, and it can never wedge a board.
  const [patch, setPatch] = useState<Record<string, Patch>>({});
  const fenOf = (g: { id: string; fen: string }) => {
    const p = patch[g.id];
    return p && p.ply > plyOf(g.fen) ? p.fen : g.fen;
  };
  const [openId, setOpenId] = useState<string | null>(null);
  // Games we've seen finish this session — drop them from the grid the instant
  // the result event arrives, without waiting for the next board poll.
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  // Result of the currently-open game (drives the winner animation + auto-close).
  const [openResult, setOpenResult] = useState<GameStatus | null>(null);
  // A brief "X vant!" flash over the grid when any game finishes in live mode.
  const [winFlash, setWinFlash] = useState<string | null>(null);
  // Past LIVE_GRID_CAP boards, stay collapsed until the host asks for more.
  const [showAll, setShowAll] = useState(false);

  // Expire the overlay. One timer, armed for the oldest patch — when it fires,
  // everything past its TTL is dropped and the authoritative board shows again.
  // This is what bounds a forged position: no matter what ply it claimed, it is
  // off the projector within PATCH_TTL_MS.
  useEffect(() => {
    const ats = Object.values(patch).map((p) => p.at);
    if (ats.length === 0) return;
    const due = Math.max(0, PATCH_TTL_MS - (Date.now() - Math.min(...ats)));
    const t = setTimeout(() => {
      setPatch((prev) => {
        const now = Date.now();
        const next: Record<string, Patch> = {};
        for (const [id, p] of Object.entries(prev)) {
          if (now - p.at < PATCH_TTL_MS) next[id] = p;
        }
        // Same object when nothing expired — React bails out, and this effect
        // (which depends on `patch`) doesn't re-arm in a loop.
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, due);
    return () => clearTimeout(t);
  }, [patch]);

  useEffect(() => {
    // Self-heal the "finished" veto: the authoritative poll wins.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFinished((s) => {
      if (s.size === 0) return s;
      const liveNow = new Set(games.filter((g) => g.status === "live").map((g) => g.id));
      const present = new Set(games.map((g) => g.id));
      const next = new Set<string>();
      for (const id of s) if (present.has(id) && !liveNow.has(id)) next.add(id);
      return next.size === s.size ? s : next;
    });
  }, [games]);

  // Coalesced board refetch behind a spectate broadcast — the truth every patch
  // below is waiting on.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestBoard = useCallback(() => {
    if (refetchTimer.current !== null) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      onStale?.();
    }, PATCH_REFETCH_MS);
  }, [onStale]);
  useEffect(
    () => () => {
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
    },
    [],
  );

  // See lib/realtimeTrust.ts. The spectate topic is derivable from the public
  // tournament payload and reachable with the public anon key, so nothing that
  // arrives here is trusted: payloads are shape-checked, positions become an
  // expiring overlay on the board poll rather than a merge into it, and a
  // `result` only HIDES a board (a veto the poll already un-does, above) — the
  // standings behind it always come from the refetch.
  useChannel(
    channels.spectate(tournament.id),
    (event, payload) => {
      if (event === "position") {
        if (!isValidSpectatePosition(payload, V.m * V.n)) return;
        const p = payload;
        setPatch((m) => ({
          ...m,
          [p.gameId]: { fen: p.fen, ply: plyOf(p.fen), at: Date.now() },
        }));
        requestBoard();
      } else if (event === "result") {
        if (!isValidSpectateResult(payload)) return;
        const p = payload;
        setFinished((s) => (s.has(p.gameId) ? s : new Set(s).add(p.gameId)));
        if (p.gameId === openId) setOpenResult(p.status);
        // Celebrate the result over the grid (who won / draw) — but only for a
        // game this projector is actually showing, so a made-up id can't put a
        // "X vant!" banner over a round still in play.
        const g = games.find((x) => x.id === p.gameId);
        const flash =
          p.status === "white_win" && g
            ? `${nameById(g.whitePlayerId)} ${no.host.spectateWon}`
            : p.status === "black_win" && g
              ? `${nameById(g.blackPlayerId)} ${no.host.spectateWon}`
              : p.status === "draw" && g
                ? no.host.spectateDraw
                : null;
        if (flash) setWinFlash(flash);
        onStale?.();
      }
    },
    (s) => {
      // Spectate broadcasts silently stopped → refetch the board so the live
      // grid recovers instead of freezing on stale positions. CLOSED included:
      // channelRegistry recreates the channel itself in the background (R11),
      // but the position/result this drop swallowed still needs this fetch.
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") onStale?.();
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
  // What's actually on screen — capped until the host asks to see the rest.
  // Board size/header font are keyed off THIS count, not `live.length`, so the
  // grid never sizes for boards that aren't rendered.
  const visible = showAll ? live : live.slice(0, LIVE_GRID_CAP);

  if (openId) {
    const g = games.find((x) => x.id === openId);
    if (g) {
      return (
        <SpectateGame
          gameId={g.id}
          fen={fenOf(g)}
          m={V.m}
          n={V.n}
          k={V.k}
          white={nameById(g.whitePlayerId)}
          black={nameById(g.blackPlayerId)}
          senders={playerIds}
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
    <div
      className="spread"
      style={{ marginBottom: 8, fontSize: headerFontSize(visible.length), alignItems: "center" }}
    >
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
              <MnkBoard state={fenOf(g)} m={V.m} n={V.n} size="lg" />
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
            {no.host.noLiveGames}
          </p>
        )
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin(visible.length)}px, 1fr))`,
              gap: 20,
              justifyContent: "center",
            }}
          >
            {visible.map((g) => (
              <button
                key={g.id}
                onClick={() => { setOpenId(g.id); setOpenResult(null); }}
                className="card reveal"
                style={{ padding: 12, cursor: "pointer", textAlign: "left", color: "inherit" }}
              >
                {Heads(g)}
                <MnkBoard state={fenOf(g)} m={V.m} n={V.n} size="sm" />
              </button>
            ))}
          </div>
          {live.length > LIVE_GRID_CAP && (
            <div className="text-center" style={{ marginTop: 20 }}>
              <button className="btn btn-ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? no.host.showFewerGames : no.host.showAllGames(live.length)}
              </button>
            </div>
          )}
        </>
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
