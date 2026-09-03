"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { useBoardState } from "@/lib/client/useBoardState";
import { usePresence } from "@/lib/client/usePresence";
import { channels } from "@/lib/realtime";
import { api } from "@/lib/client/api";
import { identity, type StoredPlayer } from "@/lib/client/identity";
import { initials } from "@/lib/client/Confetti";
import { PredictPanel } from "@/lib/client/PredictPanel";
import { BracketBoard } from "@/lib/client/BracketBoard";
import { computeTeamStandings, teamColor } from "@/lib/tournament/teams";
import { no } from "@/lib/locale/no";
import { GameView } from "./GameView";

/** The player's own end-of-tournament card: placement, top 3, winning team. */
function FinalResults({ state, playerId }: { state: BoardState; playerId: string }) {
  const { standings, tournament, players } = state;
  const mine = standings.find((s) => s.playerId === playerId);
  const top = standings.slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const teamRows = computeTeamStandings(tournament.config.teams ?? [], players);

  return (
    <div className="card stack" style={{ padding: 18, width: "100%", maxWidth: 420, gap: 10 }}>
      <p className="eyebrow" style={{ fontSize: 11 }}>🏁 {no.player.finalTitle}</p>
      {mine && (
        <p style={{ fontSize: 17 }}>
          {no.player.youPlaced} <b style={{ color: "var(--gold)", fontSize: 22 }}>{mine.rank}</b>{" "}
          {no.player.of} {standings.length} · {mine.score} {no.host.score.toLowerCase()}
        </p>
      )}
      <div className="stack" style={{ gap: 4 }}>
        {top.map((s, i) => (
          <div
            className="spread"
            key={s.playerId}
            style={{ fontSize: 14, fontWeight: s.playerId === playerId ? 700 : 400 }}
          >
            <span>
              {medals[i]} {s.displayName}
            </span>
            <span className="muted">{s.score}</span>
          </div>
        ))}
      </div>
      {teamRows.length > 0 && (
        <div className="spread" style={{ marginTop: 4 }}>
          <span className="muted" style={{ fontSize: 13 }}>{no.teams.winner}</span>
          <span className="team-chip">
            <span className="team-dot" style={{ background: teamColor(teamRows[0].team) }} />
            🏆 {teamRows[0].team} · <b>{teamRows[0].score}</b>
          </span>
        </div>
      )}
    </div>
  );
}

/** Find the player's most relevant game in the current board state. */
function myGame(state: BoardState, playerId: string): PublicGame | null {
  const mine = state.games.filter(
    (g) => g.whitePlayerId === playerId || g.blackPlayerId === playerId,
  );
  if (mine.length === 0) return null;
  return mine.find((g) => g.status === "live") ?? mine[mine.length - 1];
}

/** Is the player OUT of the tournament (vs merely waiting for the next round)?
 *  - status "left": marked absent / walkover, or removed from the lobby.
 *  - playoff: eliminated = not present in any game of the CURRENT playoff round
 *    (once the round has advanced past them). */
function isOut(state: BoardState, playerId: string): boolean {
  const meP = state.players.find((p) => p.id === playerId);
  if (meP?.status === "left") return true;
  if (state.tournament.status !== "playoff") return false;
  const cur = state.rounds.find(
    (r) => r.phase === "playoff" && r.number === state.tournament.currentRound,
  );
  if (!cur) return false;
  const inRound = state.games.some(
    (g) =>
      g.roundId === cur.id &&
      (g.whitePlayerId === playerId || g.blackPlayerId === playerId),
  );
  return !inRound;
}

export function WaitingRoom({
  me,
  onLeave,
}: {
  me: StoredPlayer;
  onLeave: () => void;
}) {
  const [showCode, setShowCode] = useState(false);
  const [rejoining, setRejoining] = useState(false);
  const [rejoinError, setRejoinError] = useState(false);
  // Latch the active game so the result screen survives board refetches until
  // the student dismisses it.
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const { state, error, errorStatus, errorCode, refresh } = useBoardState(
    me.tournamentId,
  );
  // Advertise that this student is connected (keyed by playerId) so the host can
  // see who's online in the lobby and drop ghosts. Stays active across the
  // waiting view and the in-game child below (this component remains mounted).
  usePresence(channels.presence(me.tournamentId), me.playerId);

  const game = state ? myGame(state, me.playerId) : null;
  const status = state?.tournament.status ?? "lobby";

  useEffect(() => {
    if (game?.status === "live" && activeGameId !== game.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveGameId(game.id);
    }
  }, [game, activeGameId]);

  // If the latched game vanished from a loaded state (host reset the tournament),
  // drop back to the waiting view instead of rendering a board that can't load.
  useEffect(() => {
    if (state && activeGameId && !state.games.some((g) => g.id === activeGameId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveGameId(null);
    }
  }, [state, activeGameId]);

  // --- L5 (port of sundaychess#84): the props handed to <GameView> below ---
  //
  // GameView is `memo`'d, and this component is its ALWAYS-MOUNTED parent: it
  // re-renders on every board poll and every presence event in the class. Both
  // of those are now no-ops when nothing changed (useBoardState / usePresence),
  // but a re-render for any OTHER reason must still not reach the board — so
  // every prop below has to be a primitive or a stable reference.
  //
  // Derived up here, before the early returns, so the hooks run unconditionally
  // (they used to live inside the `if (activeGameId)` branch, where a hook
  // cannot go). `me` is set once in app/play/page.tsx, so it's already stable;
  // `reactionsEnabled` and `variant` below are primitives (boolean/string), so
  // React's default prop comparison already stops them from forcing a render.
  const activeGame = activeGameId
    ? state?.games.find((g) => g.id === activeGameId)
    : undefined;
  const activeRound = activeGame
    ? state?.rounds.find((r) => r.id === activeGame.roundId)
    : undefined;
  // Round timer (league rounds only) — fed to the player's board. Rebuilt only
  // when one of the three primitives it derives from actually changes; it used
  // to be a fresh object literal on every render of this component.
  const timerSec = state?.tournament.config.roundTimerSec ?? null;
  const roundStartedAt = activeRound?.startedAt ?? null;
  const roundExtendedMs = activeRound?.extendedMs ?? 0;
  const timer = useMemo(
    () =>
      timerSec && roundStartedAt
        ? {
            startedAt: roundStartedAt,
            durationSec: timerSec,
            extendedMs: roundExtendedMs,
          }
        : null,
    [timerSec, roundStartedAt, roundExtendedMs],
  );
  // `refresh` is itself a useCallback over [tournamentId], and setActiveGameId
  // is a stable setter, so this closure is stable too.
  const onGameFinished = useCallback(() => {
    setActiveGameId(null);
    refresh();
  }, [refresh]);

  // The tournament itself is gone: OUR API said so (404 + our own `not_found`
  // envelope) and we never got a board. The code check is load-bearing, by this
  // PR's own rule — an HTML 404 from the edge also arrives as status 404, but
  // carries the caller tag "board_failed", and it must NOT put a student in
  // front of a "Logg ut" button that wipes their resume code.
  // Every OTHER error is deliberately left alone here — `error`/`errorStatus`/
  // `errorCode` stay in scope for the reconnecting badge (R7); a blip keeps the
  // last board.
  const tournamentGone =
    error && errorStatus === 404 && errorCode === "not_found" && !state;

  // A transient fetch error while we still have SOME state: never wipe the
  // waiting view (or a latched game below) — just flag the hiccup with a
  // fixed-position badge, exactly like the host board (BoardClient).
  const showReconnectBadge = error && !!state;
  // No state at all, and it's not the "tournament is gone" verdict above: a
  // full connection loss before the first board ever loaded. Give the student
  // something to act on instead of an infinite spinner.
  const showReconnectCard = error && !state && !tournamentGone;

  if (tournamentGone) {
    return (
      <main className="center-screen">
        <div
          className="card card-narrow stack text-center scale-in"
          style={{ alignItems: "center" }}
        >
          <div className="brandmark" style={{ justifyContent: "center" }}>
            <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
          </div>
          <div style={{ fontSize: 40 }}>🏁</div>
          <h2 style={{ fontSize: 22 }}>{no.player.tournamentGone}</h2>
          <p className="muted">{no.player.tournamentGoneBody}</p>
          <button
            className="btn btn-primary btn-lg"
            style={{ marginTop: 6 }}
            onClick={() => {
              identity.clearPlayer();
              onLeave();
            }}
          >
            {no.player.logOut}
          </button>
        </div>
      </main>
    );
  }

  if (showReconnectCard) {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack text-center" style={{ alignItems: "center" }}>
          <h2>{no.common.error}</h2>
          <button className="btn btn-primary btn-lg" onClick={() => refresh()}>
            {no.common.retry}
          </button>
        </div>
      </main>
    );
  }

  // R4: the host's ghost-sweep removed us from the LOBBY (a locked phone stops
  // the presence heartbeat). The old behaviour was to keep saying "venter på at
  // arrangøren starter …" to a student who was no longer in the tournament at
  // all. Say what happened, and offer the one button that undoes it.
  const meRow = state?.players.find((p) => p.id === me.playerId) ?? null;
  if (status === "lobby" && meRow?.status === "left") {
    const rejoin = async () => {
      setRejoining(true);
      setRejoinError(false);
      try {
        await api.rejoin(me.tournamentId, me.playerId, me.resumeCode);
        await refresh();
      } catch {
        setRejoinError(true);
      } finally {
        setRejoining(false);
      }
    };
    return (
      <main className="center-screen">
        <div
          className="card card-narrow stack text-center scale-in"
          style={{ alignItems: "center" }}
        >
          <div className="brandmark" style={{ justifyContent: "center" }}>
            <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
          </div>
          <div style={{ fontSize: 40 }}>👋</div>
          <h2 style={{ fontSize: 22 }}>{no.player.removedLobbyTitle}</h2>
          <p className="muted">{no.player.removedLobbyBody}</p>
          <button
            className="btn btn-primary btn-lg"
            style={{ marginTop: 6 }}
            disabled={rejoining}
            onClick={rejoin}
          >
            {rejoining ? <span className="spin" /> : no.player.rejoinLobby}
          </button>
          {rejoinError && (
            <div className="banner banner-error">{no.player.rejoinFailed}</div>
          )}
        </div>
      </main>
    );
  }

  if (activeGameId) {
    return (
      <GameView
        me={me}
        gameId={activeGameId}
        timer={timer}
        reactionsEnabled={state?.tournament.config.reactions === true}
        variant={state?.tournament.config.variant}
        onFinished={onGameFinished}
      />
    );
  }

  const eliminated = state ? isOut(state, me.playerId) : false;
  let banner: string = no.player.waitingStart;
  if (status !== "lobby") {
    if (status === "finished") banner = "Turneringen er ferdig 🏆";
    else if (eliminated) banner = no.player.outOfTournament;
    else if (game?.status === "bye") banner = no.player.waitingBye;
    else banner = no.player.waitingNext;
  }
  // The spinner means "hang on, more is coming" — drop it once the player is out
  // or the tournament is over, where nothing more is coming for them.
  const showWaitingSpinner = !eliminated && status !== "finished";

  const myTeam = meRow?.team ?? null;

  return (
    <main className="center-screen" data-testid="waiting-room">
      {showReconnectBadge && (
        <div
          className="banner banner-wait"
          style={{ position: "fixed", top: 16, left: 20, zIndex: 40, padding: "6px 12px" }}
          role="status"
          aria-live="polite"
        >
          {no.player.reconnecting}
        </div>
      )}
      <div className="stack" style={{ alignItems: "center", gap: 16, width: "100%", maxWidth: 450 }}>
      <div className="card card-narrow stack text-center scale-in" style={{ alignItems: "center" }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </div>
        <div className="avatar-lg float" style={{ width: 64, height: 64, fontSize: 22, marginTop: 4 }}>
          {initials(me.displayName)}
        </div>
        <h2 style={{ fontSize: 26 }}>{me.displayName}</h2>
        {myTeam && (
          <span className="team-chip" style={{ fontSize: 13 }}>
            <span className="team-dot" style={{ background: teamColor(myTeam) }} />
            {no.teams.yourTeam} {myTeam}
          </span>
        )}

        <div className="banner banner-wait" style={{ marginTop: 2, width: "100%" }}>
          {showWaitingSpinner && (
            <span
              className="spin"
              style={{ display: "inline-block", verticalAlign: "middle", marginRight: 10 }}
            />
          )}
          {banner}
        </div>

        {showCode ? (
          <div className="big-code">{me.resumeCode}</div>
        ) : (
          <button className="btn btn-ghost" onClick={() => setShowCode(true)}>
            Vis koden min
          </button>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          {no.player.resumeHint}
        </p>

        <button
          className="btn btn-ghost"
          style={{ marginTop: 8 }}
          onClick={() => {
            identity.clearPlayer();
            onLeave();
          }}
        >
          {no.player.logOut}
        </button>
      </div>

      {/* the cup ladder — how it's going / how it went (knockout only) */}
      {state && state.rounds.some((r) => r.phase === "playoff") && (
        <div className="card stack" style={{ padding: 14, width: "100%", gap: 8 }}>
          <p className="eyebrow" style={{ fontSize: 11 }}>{no.player.cupProgress}</p>
          <BracketBoard games={state.games} rounds={state.rounds} players={state.players} />
        </div>
      )}

      {/* the player's own final standings once it's all over */}
      {state && status === "finished" && (
        <FinalResults state={state} playerId={me.playerId} />
      )}

      {/* something to chew on while waiting */}
      {state && status !== "lobby" && status !== "finished" && (
        <PredictPanel me={me} state={state} />
      )}
      </div>
    </main>
  );
}
