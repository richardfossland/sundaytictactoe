"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { GameDetail } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";
import { api, ApiError, NON_JSON } from "@/lib/client/api";
import { apiKind, errDetail, report } from "@/lib/client/telemetry";
import { applyMove } from "@/lib/ttt/validateMove";
import { variantById } from "@/lib/ttt/variants";
import { findWinLine } from "@/lib/ttt/win";
import { plyOf } from "@/lib/ttt/ply";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { MnkBoard } from "@/lib/client/MnkBoard";
import { sameDetail } from "@/lib/client/equal";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import { useActiveTab } from "@/lib/client/useActiveTab";
import { useTabHidden } from "@/lib/client/useTabHidden";
import type { StoredPlayer } from "@/lib/client/identity";
import { Confetti, initials } from "@/lib/client/Confetti";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { sound } from "@/lib/client/sound";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import {
  ReactionBar,
  ReactionOverlay,
  type ReactionHandle,
} from "@/lib/client/Reactions";
import { MoveList, sansFromPgn } from "@/lib/client/MoveList";
import { no } from "@/lib/locale/no";

/** Hard ceiling on how long the optimistic-move `pending` lock may stay set.
 * Must exceed the API timeout (8 s) so the normal timeout/catch always wins
 * first; this only fires if something truly wedges the request. */
const PENDING_CEILING_MS = 11000;

type Color = "white" | "black";

/** A player's side panel (avatar, name, mark, active dot). */
function MarkChip({ color, label }: { color: Color; label: string }) {
  return (
    <span className={`color-chip color-chip-${color}`}>
      <span className="color-chip-glyph">{color === "white" ? "✕" : "◯"}</span>
      {label}
    </span>
  );
}

function SidePanel({
  name,
  color,
  colorLabel,
  isMe,
  active,
}: {
  name: string;
  color: Color;
  colorLabel: string;
  isMe: boolean;
  active: boolean;
}) {
  return (
    <div className={`card player-card player-card-${color}`} style={{ padding: 15 }}>
      <div className="row" style={{ gap: 10 }}>
        <span
          className="avatar-lg"
          style={
            isMe
              ? undefined
              : {
                  background: "linear-gradient(180deg, var(--ink-soft), #1c212b)",
                  color: "var(--txt)",
                  border: "1px solid var(--ink-line-strong)",
                }
          }
        >
          {initials(name)}
        </span>
        <div style={{ lineHeight: 1.3, minWidth: 0, flex: 1 }}>
          <b>{name}</b>
          <div style={{ marginTop: 3 }}>
            <MarkChip color={color} label={colorLabel} />
          </div>
        </div>
        {/* Always mounted, reserved 9x9 — toggling `active` only changes
            visibility/animation, never removes the element, so its own
            width/gap can't come and go and nudge the row (L2). */}
        <span
          style={{
            width: 9,
            height: 9,
            flexShrink: 0,
            borderRadius: "50%",
            background: "var(--turn)",
            visibility: active ? "visible" : "hidden",
            boxShadow: "0 0 0 0 color-mix(in srgb, var(--turn) 70%, transparent)",
            animation: active ? "ping 1.6s var(--ease-out) infinite" : "none",
          }}
        />
      </div>
    </div>
  );
}

/** L5 port (sundaychess#84): `memo`'d. WaitingRoom is this component's
 * always-mounted parent and re-renders on board polls, presence events and its
 * own state — none of which the board cares about. Every prop below is a
 * primitive or a stable reference (see the derivation block in WaitingRoom),
 * so the default shallow comparison is enough; `<MnkBoard>` inside is a SECOND
 * memo boundary that additionally absorbs GameView's own re-renders (toasts,
 * the reconnecting badge, the `pending` flip on every move). */
export const GameView = memo(function GameView({
  me,
  gameId,
  onFinished,
  timer,
  reactionsEnabled = false,
  variant,
}: {
  me: StoredPlayer;
  gameId: string;
  onFinished: () => void;
  timer?: {
    startedAt: string | null;
    durationSec: number;
    extendedMs?: number;
  } | null;
  reactionsEnabled?: boolean;
  /** the tournament's board variant id ("3x3"/"4x4"/"5x5"); default 3×3 */
  variant?: string;
}) {
  const V = variantById(variant);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [fen, setFen] = useState<string>("");
  const [turn, setTurn] = useState<Turn>("w");
  const [status, setStatus] = useState<GameStatus>("live");
  const [lastCell, setLastCell] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Consecutive failed background syncs (poll / resync / channel-drop / rollback
  // resync) — NOT the mount load above, which has its own loadError gate. Drives
  // the fixed "reconnecting" badge (R7) so a run of quiet `load()` failures is
  // visible instead of the board just appearing to freeze.
  const [syncFailures, setSyncFailures] = useState(0);
  const [incomingDraw, setIncomingDraw] = useState(false);
  const [drawSent, setDrawSent] = useState(false);
  // Live move list. Rebuilt authoritatively from the pgn on load()/end, appended
  // optimistically per move so it tracks play without waiting for a poll.
  const [sans, setSans] = useState<string[]>([]);
  // Imperative handle to the reaction overlay — adding a float never re-renders
  // GameView (and therefore never re-renders the board).
  const reactionRef = useRef<ReactionHandle>(null);

  // Append a move to the list only when it advances exactly one ply — this dedups
  // against the authoritative rebuild (load) and ignores out-of-order / missed
  // updates; the next load() rebuild self-heals any gap.
  const appendSan = useCallback((san: string | undefined, fenAfter: string) => {
    if (!san) return;
    setSans((prev) => (plyOf(fenAfter) === prev.length + 1 ? [...prev, san] : prev));
  }, []);

  // Last server-confirmed board — the rollback target for a failed optimistic move.
  const confirmedFen = useRef<string>("");
  const lastPgn = useRef<string>("");
  // Mirror of `syncFailures` for the telemetry hook in safeLoad — see there.
  const syncFails = useRef(0);

  // game-start jingle (also nudges the AudioContext awake on mount)
  useEffect(() => {
    sound.play("start");
  }, []);

  const myColor: Color = detail?.black?.id === me.playerId ? "black" : "white";
  const myTurnLetter: Turn = myColor === "white" ? "w" : "b";
  const isMyTurn = status === "live" && turn === myTurnLetter;

  // Only one tab per player may be the active board (others POSTing moves with
  // the same identity collide → "can't move"). Passive tabs show a "play here".
  const { active: tabActive, claim: claimTab } = useActiveTab(
    `${me.tournamentId}:${me.playerId}`,
  );

  // T5: this tab just became the PASSIVE one. From the student's seat that looks
  // exactly like "the board stopped working" (it stops polling by design), so
  // it is one of the likeliest things behind a "det hang seg" report — and the
  // only way to tell it apart afterwards is to record it. `tabActive` starts
  // true, so this fires on the flip, never on mount.
  useEffect(() => {
    if (!tabActive) report("tab_passive", { gameId });
  }, [tabActive, gameId]);

  const load = useCallback(async () => {
    const d = await api.game(gameId);
    // Names/pgn are always safe to refresh — but L5 (port of sundaychess#84):
    // only as a NEW object when a field the UI reads actually changed. This
    // runs every 3 s, and between two moves every field is identical;
    // adopting the fetched object anyway re-rendered GameView (and the whole
    // board) for nothing. The ply-guarded position writes below are untouched
    // and remain authoritative.
    setDetail((prev) => (sameDetail(prev, d) ? prev : d));
    // Ply-guard exactly like the broadcast handler: a slow in-flight GET that
    // resolves AFTER a fresher move must not roll the board back to a stale ply.
    const fresh = plyOf(d.fen) >= plyOf(confirmedFen.current || d.fen);
    if (fresh) {
      setFen(d.fen);
      setTurn(d.turn);
      setLastCell(d.lastMove ? d.lastMove.cell : null);
      confirmedFen.current = d.fen;
      if (d.pgn !== lastPgn.current) {
        lastPgn.current = d.pgn;
        setSans(sansFromPgn(d.pgn));
      }
    }
    // A terminal status must be honoured even when the ply didn't advance (a
    // resign / teacher-resolve emits no position move); a stale "live" must
    // never un-end a finished game.
    if (fresh || d.status !== "live") setStatus(d.status);
    // Reconcile draw banners from the authoritative offer state.
    if (d.drawOfferedBy !== undefined) {
      setIncomingDraw(d.drawOfferedBy != null && d.drawOfferedBy !== me.playerId);
      setDrawSent(d.drawOfferedBy === me.playerId);
    }
  }, [gameId, me.playerId]);

  // Fire-and-forget wrapper for every background resync site below: never
  // throws (so callers can call it bare in a setInterval/listener), and counts
  // consecutive failures so the UI can show a "reconnecting" badge instead of
  // silently going stale. A success — including one that follows a string of
  // failures, e.g. after a channel drop — resets the counter immediately.
  const safeLoad = useCallback(() => {
    return load()
      .then(() => {
        syncFails.current = 0;
        setSyncFailures(0);
      })
      .catch((e) => {
        setSyncFailures((n) => n + 1);
        // T5: report the THIRD consecutive failure — the point at which the
        // student sees a stuck board rather than a blink. Counted in a ref, not
        // read from state, so the updater stays pure and `safeLoad`'s identity
        // (and therefore the poll interval) doesn't churn on every failure.
        syncFails.current += 1;
        if (syncFails.current === 3) {
          report(apiKind(e), { ...errDetail(e), gameId });
        }
      });
  }, [load, gameId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
      .then(() => setLoadError(false))
      .catch((e) => {
        console.warn("[game] initial load failed", e);
        setLoadError(true);
      });
  }, [load]);

  // Reconnect hardening: re-sync the authoritative position when the tab regains
  // focus or the network returns (recovers any missed broadcast).
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") safeLoad();
    };
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [safeLoad]);

  // Poll backstop: realtime broadcasts are best-effort, so re-sync on a timer
  // whenever the game is live — even while `pending` is set. Guarantees the board
  // un-freezes within ~3 s no matter how state got stuck.
  // Slower (20 s) while hidden rather than skipped outright (R11): a
  // backgrounded tab whose channel silently died must still come back current
  // within a bounded time, not only at the next visibilitychange→visible
  // refresh — still gated on tabActive, per R5, since a passive tab must never
  // poll at all (it isn't the live board for this player).
  const hidden = useTabHidden();
  useEffect(() => {
    if (status !== "live" || !tabActive) return; // passive tab: don't poll
    const id = setInterval(safeLoad, hidden ? 20000 : 3000);
    return () => clearInterval(id);
  }, [status, safeLoad, tabActive, hidden]);

  // Pending watchdog: an absolute ceiling so the optimistic-move lock can NEVER
  // freeze the board permanently.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      report("watchdog", { gameId, ms: PENDING_CEILING_MS });
      setPending(false);
      safeLoad();
    }, PENDING_CEILING_MS);
    return () => clearTimeout(t);
  }, [pending, safeLoad, gameId]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  // Run a one-shot meta action (offer/accept/decline draw, resign): guard against
  // double-fire, and on failure reconcile to authoritative state via load().
  const runMeta = (action: Promise<unknown>, onOk?: () => void) => {
    if (acting) return;
    setActing(true);
    action
      .then(() => onOk?.())
      .catch(() => {
        flash(no.common.error);
        safeLoad();
      })
      .finally(() => setActing(false));
  };

  // Result sound — fires once when the game flips from live to a result.
  useEffect(() => {
    if (status === "live") return;
    if (status === "bye" || status === "aborted") return;
    const won =
      (status === "white_win" && myColor === "white") ||
      (status === "black_win" && myColor === "black");
    sound.play(status === "draw" ? "draw" : won ? "win" : "lose");
  }, [status, myColor]);

  // On game end, fetch the authoritative final move list once (the live poll has
  // stopped, so detail.pgn may be one move behind).
  useEffect(() => {
    if (status === "live" || status === "bye" || status === "aborted") return;
    let live = true;
    api
      .game(gameId)
      .then((d) => {
        if (!live) return;
        setSans(sansFromPgn(d.pgn));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [status, gameId]);

  // Authoritative updates from the game channel.
  const sendOnGame = useChannel(
    channels.game(gameId),
    (event, payload) => {
      if (event === "position") {
        const p = payload as {
          fen: string;
          turn: Turn;
          status: GameStatus;
          lastMove?: { cell: number } | null;
        };
        // Ignore a delayed / out-of-order broadcast that would roll the board
        // back to an older position.
        const fresh = plyOf(p.fen) >= plyOf(confirmedFen.current || fen);
        if (fresh) {
          if (p.fen !== fen) sound.play("move"); // the opponent moved
          setFen(p.fen);
          setTurn(p.turn);
          confirmedFen.current = p.fen;
          if (p.lastMove) setLastCell(p.lastMove.cell);
          if (p.lastMove) appendSan(String(p.lastMove.cell), p.fen);
          setIncomingDraw(false); // a move supersedes any pending draw offer
          setDrawSent(false);
        }
        if (fresh || p.status !== "live") setStatus(p.status);
      } else if (event === "reaction") {
        const p = payload as { emoji?: string };
        if (typeof p.emoji === "string" && p.emoji.length <= 8)
          reactionRef.current?.add(p.emoji);
      } else if (event === "result") {
        const p = payload as { status: GameStatus };
        setStatus(p.status);
      } else if (event === "draw_offer") {
        const p = payload as { by: string };
        if (p.by !== me.playerId) setIncomingDraw(true);
      } else if (event === "draw_declined") {
        const p = payload as { by: string };
        setIncomingDraw(false);
        if (p.by !== me.playerId) {
          setDrawSent(false);
          flash(no.player.drawDeclined);
        }
      }
    },
    (s) => {
      // Broadcasts silently stopped (channel error/timeout/CLOSED) → refetch
      // truth now; the poll then keeps it fresh until the socket re-joins.
      // channelRegistry recreates the channel itself in the background (R11),
      // but that takes a moment — this immediate fetch catches whatever the
      // drop swallowed instead of waiting for it.
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        report("channel_error", { status: s, gameId });
        safeLoad();
      }
    },
  );

  // Attempt a move: optimistic render, then server reconcile / rollback.
  const tryMove = useCallback(
    async (cell: number) => {
      if (!isMyTurn || pending) return;

      const local = applyMove(fen, { cell }, undefined, V);
      if (!local.ok) return;
      sound.play("move");

      setFen(local.fen);
      setTurn(local.turn);
      setLastCell(cell);
      appendSan(local.san, local.fen);
      setPending(true);

      try {
        const res = await api.move({
          gameId,
          cell,
          playerId: me.playerId,
          resumeCode: me.resumeCode,
        });
        setFen(res.fen);
        setTurn(res.turn);
        setStatus(res.status);
        confirmedFen.current = res.fen;
      } catch (e) {
        // Roll back to the last CONFIRMED position.
        const confirmed = confirmedFen.current || fen;
        setFen(confirmed);
        setTurn(plyOf(confirmed) % 2 === 0 ? "w" : "b");
        const code = e instanceof ApiError ? e.code : "";
        const httpStatus = e instanceof ApiError ? e.status : 0;
        // T5: the move was rolled back. The pair (code, status) is exactly what
        // the teacher's readout needs to tell "the server said no" apart from
        // "the network ate it".
        report("move_rollback", { code, status: httpStatus, gameId });
        if (code === "not_your_turn") flash(no.player.notYourTurn);
        else if (code === "timeout" || code === "network" || code === NON_JSON) {
          // Request hung/dropped — or the reply was never our API's (an HTML
          // edge page / WAF challenge / proxy). A 400 from one of those is not
          // a ruling on the move, so it must not reach the "illegal move"
          // branch below and accuse the student.
          flash(no.player.connection);
        } else if (httpStatus === 400) flash(no.player.illegalMove);
        else if (httpStatus >= 500 || httpStatus === 0) flash(no.player.connection);
        else flash(no.common.error);
        // Always re-sync to authoritative state so the board can't get stuck.
        safeLoad();
      } finally {
        setPending(false);
      }
    },
    [appendSan, fen, gameId, isMyTurn, safeLoad, me.playerId, me.resumeCode, pending, V],
  );

  // Another tab on this device took over this player's session.
  if (!tabActive) {
    return (
      <main className="center-screen" data-testid="passive-tab">
        <div
          className="card card-narrow stack text-center"
          style={{ alignItems: "center", gap: 12 }}
        >
          <div style={{ fontSize: 40 }}>✕◯</div>
          <h2>{no.player.otherTabTitle}</h2>
          <p className="muted">{no.player.otherTabBody}</p>
          <button className="btn btn-primary btn-lg" onClick={claimTab}>
            {no.player.otherTabResume}
          </button>
        </div>
      </main>
    );
  }

  if (!detail) {
    if (loadError) {
      return (
        <main className="center-screen" data-testid="load-error">
          <div className="card card-narrow stack text-center">
            <h2>{no.common.error}</h2>
            <p className="muted">{no.player.gameLoadFailed}</p>
            <div className="row">
              <button
                className="btn btn-primary grow"
                onClick={() =>
                  load()
                    .then(() => setLoadError(false))
                    .catch(() => setLoadError(true))
                }
              >
                {no.common.retry}
              </button>
              <button className="btn grow" onClick={onFinished}>
                {no.common.back}
              </button>
            </div>
          </div>
        </main>
      );
    }
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );
  }

  const opponent = myColor === "white" ? detail.black : detail.white;
  const ended = status !== "live";

  const iWon =
    ended &&
    ((status === "white_win" && myColor === "white") ||
      (status === "black_win" && myColor === "black"));
  let resultText = "";
  if (ended) {
    if (status === "draw") resultText = no.player.drawResult;
    else resultText = iWon ? no.player.youWon : no.player.youLost;
  }

  const winLine =
    ended && fen ? findWinLine(fen, V.m, V.n, V.k)?.cells ?? null : null;

  const oppColor: Color = myColor === "white" ? "black" : "white";

  return (
    <main className="center-screen is-game">
      {iWon && <Confetti count={120} />}
      {syncFailures >= 1 && (
        // Fixed-position, out of document flow: a background sync hiccup must
        // never move the board or block a drag-drop in progress. Escalates to
        // an explicit retry only once it's been failing for a while (>=3) —
        // one blip shouldn't invite a button-mash.
        <div
          className="banner banner-wait"
          style={{
            position: "fixed",
            top: 16,
            left: 20,
            zIndex: 40,
            padding: "6px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
          role="status"
          aria-live="polite"
        >
          {no.player.reconnecting}
          {syncFailures >= 3 && (
            <button className="btn btn-ghost" style={{ padding: "2px 10px" }} onClick={() => safeLoad()}>
              {no.player.refreshNow}
            </button>
          )}
        </div>
      )}
      {/* L3: a true toast — fixed/out of flow (see .toast in globals.css) so a
          transient error message can never change .center-screen's height and
          re-centre (or on /solo, jump) the board underneath it. Auto-clears
          after 2.2s (see `flash`). */}
      {toast && (
        <div className="banner banner-error toast" data-testid="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      <div className="game-grid">
        {/* opponent — left on wide, top on narrow */}
        <div className="game-side panel-opp">
          <SidePanel
            name={opponent?.name ?? "?"}
            color={oppColor}
            colorLabel={oppColor === "white" ? no.player.white : no.player.black}
            isMe={false}
            active={!ended && !isMyTurn}
          />
        </div>

        {/* centre: timer + turn banner + board + actions */}
        <div className="game-center">
          {timer && timer.startedAt && (
            // Kept mounted (visibility, not unmount) once the round timer has
            // ever been present, so its slot's height never disappears out
            // from under the banner/board when the game ends (L2). Never
            // rendered at all when no timer is configured for this round —
            // that's a fixed property of the round, not a mid-game change.
            <div style={ended ? { visibility: "hidden" } : undefined}>
              <RoundTimer
                startedAt={timer.startedAt}
                durationSec={timer.durationSec}
                extendedMs={timer.extendedMs ?? 0}
                compact
              />
            </div>
          )}

          {/* One fixed banner slot, ALWAYS mounted (L2: visibility:hidden at
              game end, never unmounted) so nothing above .board-shell can
              change height mid-game. .turn-slot reserves one line of .banner
              (~57px, see globals.css) and .banner-line clips with an
              ellipsis instead of wrapping to a second line. */}
          <div className="turn-slot" style={ended ? { visibility: "hidden" } : undefined}>
            <div
              className={`banner ${isMyTurn ? "banner-turn" : "banner-wait"}`}
              data-testid="turn-banner"
              style={{ width: "100%" }}
              role="status"
              aria-live="polite"
            >
              <span className="banner-line">
                {isMyTurn ? `✕ ${no.player.yourTurn}` : no.player.opponentTurn}
              </span>
            </div>
          </div>

          <div className="board-frame">
            <div
              className="board-shell"
              data-testid="board-shell"
              role="group"
              aria-label={isMyTurn ? `${no.player.yourTurn} – ${no.player.boardLabel}` : no.player.boardLabel}
            >
              <MnkBoard
                state={fen || ".".repeat(V.m * V.n)}
                m={V.m}
                n={V.n}
                onCell={tryMove}
                disabled={!isMyTurn || pending || ended}
                lastCell={lastCell}
                winLine={winLine}
                size="lg"
              />
            </div>
            <ReactionOverlay ref={reactionRef} />
          </div>

          {/* L3: kept mounted (visibility, not unmount) once reactions are
              enabled for this round, so its removal at game end — which sits
              below the board but above the result overlay's fade-in — can't
              read as a flash beneath the overlay. */}
          {reactionsEnabled && (
            <div style={ended ? { visibility: "hidden" } : undefined}>
              <ReactionBar
                onSend={(emoji) => {
                  reactionRef.current?.add(emoji); // self-broadcast off → show mine locally
                  sendOnGame("reaction", { emoji, by: me.playerId });
                }}
              />
            </div>
          )}

          {/* Always mounted (L2): visibility:hidden at game end instead of
              unmounting, so this row's height never vanishes out from under
              the board while the result overlay fades in. Buttons are also
              explicitly disabled at `ended` — belt-and-braces alongside the
              visibility toggle, matching the existing disabled logic below. */}
          <div className="row" style={ended ? { visibility: "hidden" } : undefined}>
            <button
              className="btn btn-ghost"
              disabled={pending || drawSent || acting || ended}
              onClick={() =>
                runMeta(
                  api.draw(gameId, me.playerId, me.resumeCode, "offer"),
                  () => setDrawSent(true),
                )
              }
            >
              ½ {no.player.offerDraw}
            </button>
            <button
              className="btn btn-danger"
              disabled={pending || acting || ended}
              onClick={() => setConfirmResign(true)}
            >
              {no.player.resign}
            </button>
          </div>

          {/* L3: the "draw offer sent" banner gets its own always-mounted
              fixed-height slot below the action row (see .notice-slot in
              globals.css) — visibility:hidden (never unmounted) once the game
              ends, same as the row above, so the offer going out or being
              declined never changes anything else's height mid-game. */}
          <div className="notice-slot" style={ended ? { visibility: "hidden" } : undefined}>
            {drawSent && (
              <div className="banner banner-wait" style={{ width: "100%" }} role="status" aria-live="polite">
                <span className="banner-line">½ {no.player.drawSent}</span>
              </div>
            )}
          </div>

          {/* Always mounted (L2) — MoveList already renders a "–" placeholder
              for an empty list, and .movelist now has a fixed height, so it's
              the same block from the very first render, not something that
              pops in and grows over the first ~6 moves. */}
          <MoveList sans={sans} />
        </div>

        {/* me — right on wide, bottom on narrow */}
        <div className="game-side panel-me">
          <SidePanel
            name={me.displayName}
            color={myColor}
            colorLabel={`${no.player.youAre} ${myColor === "white" ? no.player.white : no.player.black}`}
            isMe
            active={!ended && isMyTurn}
          />
        </div>
      </div>

      {ended && (
        <div className="result-overlay">
          <div
            className="result-card stack"
            data-testid="result-card"
            style={{ alignItems: "center", gap: 12 }}
          >
            <div className="result-emoji">
              {status === "draw" ? "🤝" : iWon ? "🎉" : "😔"}
            </div>
            <h1 style={{ fontSize: "clamp(36px,9vw,64px)" }}>{resultText}</h1>
            <p className="muted">
              {status === "draw"
                ? "Godt spilt av begge."
                : iWon
                  ? "Sterkt spilt!"
                  : "Bedre lykke neste runde."}
            </p>
            <button className="btn btn-primary btn-lg" style={{ marginTop: 6 }} onClick={onFinished}>
              {no.common.next} →
            </button>
          </div>
        </div>
      )}

      {confirmResign && (
        <ConfirmDialog
          message={no.player.resignConfirm}
          confirmLabel={no.player.resign}
          danger
          onConfirm={() => {
            setConfirmResign(false);
            runMeta(api.resign(gameId, me.playerId, me.resumeCode));
          }}
          onCancel={() => setConfirmResign(false)}
        />
      )}

      {/* L3: was an in-flow card below the board (grew the layout by a whole
          card whenever an offer arrived, sliding the board on a top-aligned
          screen). A modal dialog — same one used for resign — moves it out of
          flow entirely; accept/decline are wired to the same handlers as
          before. */}
      {incomingDraw && !ended && (
        <ConfirmDialog
          message={no.player.drawOfferedByOpponent}
          confirmLabel={no.player.accept}
          cancelLabel={no.player.decline}
          onConfirm={() =>
            runMeta(
              api.draw(gameId, me.playerId, me.resumeCode, "accept"),
              () => setIncomingDraw(false),
            )
          }
          onCancel={() =>
            runMeta(
              api.draw(gameId, me.playerId, me.resumeCode, "decline"),
              () => setIncomingDraw(false),
            )
          }
        />
      )}

      <SoundToggle />
      <FullscreenToggle />
    </main>
  );
});
