"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { useCountdown } from "@/lib/client/useCountdown";
import { JoinChip } from "@/lib/client/JoinChip";
import { computeTeamStandings, teamColor } from "@/lib/tournament/teams";
import { OverrideModal } from "./OverrideModal";
import { CodesModal } from "./CodesModal";

function resultLabel(g: PublicGame, name: (id: string | null) => string): string {
  switch (g.status) {
    case "live":
      return no.host.inProgress;
    case "white_win":
      return `${name(g.whitePlayerId)} ✓`;
    case "black_win":
      return `${name(g.blackPlayerId)} ✓`;
    case "draw":
      return no.host.draw;
    case "bye":
      return no.host.bye;
    case "aborted":
      return no.host.abort;
    default:
      return "";
  }
}

export function LeagueView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players, games, standings, rounds, tipping } = state;
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideGame, setOverrideGame] = useState<PublicGame | null>(null);
  const [showCodes, setShowCodes] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHostCode(identity.hostCode(tournament.id));
  }, [tournament.id]);

  const nameById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.displayName]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : no.host.bye);
  }, [players]);

  const teamRows = useMemo(
    () => computeTeamStandings(tournament.config.teams ?? [], players),
    [tournament.config.teams, players],
  );
  const teamById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.team]));
    return (id: string) => m.get(id) ?? null;
  }, [players]);

  const currentRound = useMemo(
    () =>
      rounds.find(
        (r) => r.number === tournament.currentRound && r.phase === "league",
      ),
    [rounds, tournament.currentRound],
  );
  const roundGames = useMemo(
    () => games.filter((g) => g.roundId === currentRound?.id),
    [games, currentRound],
  );

  const liveCount = roundGames.filter((g) => g.status === "live").length;
  const allResolved = roundGames.length > 0 && liveCount === 0;
  const isLastRound = tournament.currentRound >= tournament.config.leagueRounds;

  const timerSec = tournament.config.roundTimerSec;
  const timerEndMs =
    timerSec && currentRound?.startedAt
      ? new Date(currentRound.startedAt).getTime() +
        timerSec * 1000 +
        (currentRound.extendedMs ?? 0)
      : null;
  const { expired: timeUp } = useCountdown(timerEndMs);

  async function addMinute() {
    if (!hostCode) return setError(no.host.missingHostCode);
    setBusy(true);
    setError(null);
    try {
      await api.extendRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (!hostCode) return setError(no.host.missingHostCode);
    setBusy(true);
    setError(null);
    try {
      await api.advanceRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function force() {
    if (!hostCode) return setError(no.host.missingHostCode);
    if (!confirm(no.host.forceResolveConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      await api.forceResolve(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap" style={{ padding: "28px 24px 64px" }}>
      <header className="spread" style={{ marginBottom: 24 }}>
        <span className="brandmark">
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </span>
        <span className="badge badge-live">
          {no.host.round} {tournament.currentRound} / {tournament.config.leagueRounds}
        </span>
        {timerSec && currentRound && (
          <div className="row" style={{ gap: 10 }}>
            <RoundTimer
              startedAt={currentRound.startedAt}
              durationSec={timerSec}
              extendedMs={currentRound.extendedMs ?? 0}
            />
            <button
              className="btn btn-ghost"
              style={{ padding: "8px 12px" }}
              disabled={busy}
              onClick={addMinute}
            >
              {busy ? <span className="spin" /> : no.host.addMinute}
            </button>
          </div>
        )}
        <span className="grow" />
        <JoinChip pin={tournament.joinPin} />
        <button className="btn btn-ghost" onClick={() => setShowCodes(true)}>
          {no.host.showCodes}
        </button>
      </header>

      <div className="board-grid split-league">
        {/* Standings */}
        <section className="card">
          <h2 style={{ fontSize: 22, marginBottom: 12 }}>{no.host.standings}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{no.host.rank}</th>
                <th>{no.host.name}</th>
                <th className="num">{no.host.score}</th>
                <th className="num">{no.host.tiebreak}</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={s.playerId}>
                  <td>
                    <span className={`rankpill ${s.rank <= 3 ? "r" + s.rank : ""}`}>
                      {s.rank}
                    </span>
                  </td>
                  <td>
                    {s.displayName}
                    {teamById(s.playerId) && (
                      <span
                        className="team-dot"
                        title={teamById(s.playerId) ?? ""}
                        style={{
                          background: teamColor(teamById(s.playerId) ?? ""),
                          display: "inline-block",
                          marginLeft: 7,
                        }}
                      />
                    )}
                  </td>
                  <td className="num"><b>{s.score}</b></td>
                  <td className="num muted">{s.tiebreak}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* lagstilling — sum of each team's player scores */}
          {teamRows.length > 0 && (
            <div className="stack" style={{ gap: 8, marginTop: 20 }}>
              <p className="eyebrow">{no.teams.standings}</p>
              <div className="stack" style={{ gap: 6 }}>
                {teamRows.map((r, i) => (
                  <div className="spread" key={r.team} style={{ fontSize: 15 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="muted">{i + 1}.</span>
                      <span className="team-chip">
                        <span className="team-dot" style={{ background: teamColor(r.team) }} />
                        {r.team}
                      </span>
                      <span className="faint" style={{ fontSize: 12 }}>
                        {r.players} {no.teams.members}
                      </span>
                    </span>
                    <b style={{ color: "var(--gold)", fontSize: 16 }}>{r.score}</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* tipping leaderboard — appears once anyone has earned a point */}
          {(tipping?.length ?? 0) > 0 && (
            <div className="stack" style={{ gap: 8, marginTop: 20 }}>
              <p className="eyebrow">🎯 {no.predict.leaderboard}</p>
              <div className="stack" style={{ gap: 4 }}>
                {(tipping ?? []).slice(0, 5).map((t, i) => (
                  <div className="spread" key={t.playerId} style={{ fontSize: 14 }}>
                    <span>
                      <span className="muted">{i + 1}.</span>{" "}
                      {nameById(t.playerId)}
                    </span>
                    <b style={{ color: "var(--gold)" }}>
                      {t.points} {no.predict.points}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Games grid */}
        <section className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 22 }}>{no.host.games}</h2>
            <span className="badge">
              {roundGames.length - liveCount} / {roundGames.length}
            </span>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            {roundGames.map((g) => (
              <button
                key={g.id}
                className="spread"
                onClick={() => g.status !== "bye" && setOverrideGame(g)}
                style={{
                  textAlign: "left",
                  background: "var(--ink-soft)",
                  border: "1px solid var(--ink-line)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  cursor: g.status === "bye" ? "default" : "pointer",
                  color: "inherit",
                  font: "inherit",
                }}
              >
                <span>
                  <b>{nameById(g.whitePlayerId)}</b>
                  {g.blackPlayerId ? (
                    <>
                      {" "}
                      <span className="muted">{no.player.vs}</span>{" "}
                      <b>{nameById(g.blackPlayerId)}</b>
                    </>
                  ) : null}
                </span>
                <span
                  className={`badge ${g.status === "live" ? "badge-live" : "badge-done"}`}
                >
                  {resultLabel(g, nameById)}
                </span>
              </button>
            ))}
          </div>

          {timeUp && liveCount > 0 && (
            <div
              className="banner"
              style={{
                marginTop: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                background: "color-mix(in srgb, var(--warn) 18%, var(--ink-2))",
                border: "1px solid color-mix(in srgb, var(--warn) 50%, transparent)",
                color: "#f3d9c4",
              }}
            >
              <span>⏰ {no.host.timeUpSuggestion}</span>
              <button className="btn btn-danger" disabled={busy} onClick={force} style={{ flexShrink: 0 }}>
                {busy ? <span className="spin" /> : no.host.endRound}
              </button>
            </div>
          )}

          <div className="row" style={{ marginTop: 18 }}>
            <button
              className="btn btn-primary grow"
              disabled={busy || !allResolved}
              onClick={advance}
            >
              {busy ? <span className="spin" /> : isLastRound ? "Fullfør" : no.host.nextRound}
            </button>
            {liveCount > 0 && (
              <button className="btn btn-danger" disabled={busy} onClick={force}>
                {busy ? <span className="spin" /> : no.host.forceResolve}
              </button>
            )}
          </div>
          {!allResolved && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Alle partier må være ferdige før neste runde.
            </p>
          )}
          {error && <div className="banner banner-error" style={{ marginTop: 10 }}>{error}</div>}
        </section>
      </div>

      {overrideGame && (
        <OverrideModal
          gameId={overrideGame.id}
          hostCode={hostCode ?? ""}
          white={{ id: overrideGame.whitePlayerId, name: nameById(overrideGame.whitePlayerId) }}
          black={
            overrideGame.blackPlayerId
              ? { id: overrideGame.blackPlayerId, name: nameById(overrideGame.blackPlayerId) }
              : null
          }
          onClose={() => setOverrideGame(null)}
          onDone={() => {
            setOverrideGame(null);
            onChanged();
          }}
        />
      )}

      {showCodes && (
        <CodesModal
          tournamentId={tournament.id}
          hostCode={hostCode ?? ""}
          onClose={() => setShowCodes(false)}
        />
      )}
    </main>
  );
}
