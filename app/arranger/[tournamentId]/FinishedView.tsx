"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { Confetti, initials } from "@/lib/client/Confetti";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { sound } from "@/lib/client/sound";
import { computeAwards, type Award } from "@/lib/tournament/awards";
import { variantById } from "@/lib/ttt/variants";
import { computeTeamStandings, teamColor } from "@/lib/tournament/teams";
import { BracketBoard } from "@/lib/client/BracketBoard";
import { no } from "@/lib/locale/no";

const AWARD_EMOJI: Record<Award["key"], string> = {
  fastest_win: "⚡",
  longest_game: "⏳",
  centre_opener: "🎯",
  comeback: "🔄",
  blocker: "🧱",
  draw_king: "🤝",
};

function awardDetail(a: Award): string {
  switch (a.key) {
    case "fastest_win":
      return `Seier på ${a.value} ${no.awards.movesUnit}`;
    case "longest_game":
      return `${a.value} ${no.awards.movesUnit}`;
    case "centre_opener":
      return no.awards.openingsUnit(a.value);
    case "comeback":
      return no.awards.comebackUnit(a.value);
    case "blocker":
      return no.awards.blocksUnit(a.value);
    case "draw_king":
      return no.awards.drawsUnit(a.value);
  }
}

function gameWinner(g: PublicGame): string | null {
  if (g.status === "white_win") return g.whitePlayerId;
  if (g.status === "black_win") return g.blackPlayerId;
  return null;
}

// Compact per-round result, for the print-only recap below (no.host has no
// entry for this — it's a plain chess score line, not prose).
function printResultLabel(g: PublicGame): string {
  switch (g.status) {
    case "white_win":
      return "1–0";
    case "black_win":
      return "0–1";
    case "draw":
      return "½–½";
    case "bye":
      return no.host.bye;
    case "aborted":
      return no.host.aborted;
    default:
      return no.host.inProgress;
  }
}

export function FinishedView({ state }: { state: BoardState }) {
  const { standings, players, games, rounds, tournament } = state;

  // victory fanfare, once, when the podium appears
  useEffect(() => {
    sound.play("win");
  }, []);

  const championId = useMemo(() => {
    const playoffRounds = rounds
      .filter((r) => r.phase === "playoff")
      .sort((a, b) => b.number - a.number);
    if (playoffRounds.length > 0) {
      const finalGame = games.find((g) => g.roundId === playoffRounds[0].id);
      const w = finalGame ? gameWinner(finalGame) : null;
      if (w) return w;
    }
    return standings[0]?.playerId ?? null;
  }, [rounds, games, standings]);

  const champion = players.find((p) => p.id === championId);
  const nameById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.displayName]));
    return (id: string) => m.get(id) ?? "?";
  }, [players]);

  const awards = useMemo(
    () =>
      computeAwards(
        games
          .filter((g) => g.pgn)
          .map((g) => ({
            id: g.id,
            whitePlayerId: g.whitePlayerId,
            blackPlayerId: g.blackPlayerId,
            status: g.status,
            pgn: g.pgn as string,
          })),
        // Four of the six awards read the BOARD (centre, lines, blocks), so
        // they need the geometry this tournament was actually played on — a
        // 4×4 has no single centre cell and needs four in a row, not three.
        variantById(tournament.config.variant),
      ),
    [games, tournament.config.variant],
  );

  const teamRows = useMemo(
    () => computeTeamStandings(tournament.config.teams ?? [], players),
    [tournament.config.teams, players],
  );
  const teamById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.team]));
    return (id: string) => m.get(id) ?? null;
  }, [players]);

  // Fair-play readout: games decided without play (walkover/absent/override —
  // NOT ordinary byes or time-forced draws, which aren't a fairness concern).
  const nonPlayCount = useMemo(
    () =>
      games.filter(
        (g) =>
          g.resultSource === "walkover" ||
          g.resultSource === "opponent_absent" ||
          g.resultSource === "teacher_override",
      ).length,
    [games],
  );
  // podium order: 2nd, 1st, 3rd  (champion centre, tallest)
  const top = standings.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const heights: Record<number, number> = { 1: 150, 2: 112, 3: 84 };
  const medals: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

  return (
    <main className="center-screen">
      {/* Confetti is a fixed, pointer-events-none canvas with no class of its
          own — wrap it so @media print can hide it (it would otherwise just
          render blank, but it's still dead weight on the page). */}
      <div className="no-print">
        <Confetti />
      </div>

      {/* Printed page only: a plain title + date the projector never shows. */}
      <div className="print-only">
        <h1 style={{ fontSize: 26, marginBottom: 2 }}>{tournament.title || no.appName}</h1>
        <p style={{ fontSize: 13 }}>
          {new Date().toLocaleDateString("no", { day: "2-digit", month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="stack text-center" style={{ alignItems: "center", maxWidth: 680, gap: 18 }}>
        <span className="brandmark reveal" style={{ ["--i" as string]: 0 } as CSSProperties}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </span>
        <p className="eyebrow reveal" style={{ ["--i" as string]: 1 } as CSSProperties}>
          {no.host.podium}
        </p>

        {champion && (
          <div className="stack" style={{ alignItems: "center", gap: 6 }}>
            <div className="float" style={{ fontSize: 80, lineHeight: 1, filter: "drop-shadow(0 12px 30px rgba(235,184,75,.45))" }}>
              🏆
            </div>
            <h1
              className="scale-in gold-text"
              style={{ fontSize: "clamp(40px,9vw,80px)", background: "var(--gold-grad)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
            >
              {champion.displayName}
            </h1>
            <p className="muted">{no.host.champion}</p>
          </div>
        )}

        {/* podium */}
        <div className="podium" style={{ marginTop: 14 }}>
          {order.map((s) => (
            <div className="podium-col" key={s.playerId}>
              <div className="avatar-lg" style={{ width: 48, height: 48, fontSize: 16 }}>
                {initials(s.displayName)}
              </div>
              <b style={{ fontSize: 15 }}>{s.displayName}</b>
              <span className="badge">{s.score}</span>
              <div
                className={`podium-bar ${s.rank === 1 ? "p1" : ""}`}
                style={{ height: heights[s.rank], animationDelay: `${0.2 + s.rank * 0.12}s`, fontSize: 26 }}
              >
                <span style={{ marginTop: 4 }}>{medals[s.rank]}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Full results — the podium only shows the top 3; ranks 4+ still
            matter to a class projecting this on the wall. */}
        <div className="stack" style={{ alignItems: "stretch", gap: 10, marginTop: 22, width: "100%" }}>
          <p className="eyebrow" style={{ textAlign: "center" }}>{no.host.standings}</p>
          <div className="card" style={{ padding: 0, overflow: "hidden", textAlign: "left" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{no.host.rank}</th>
                  <th>{no.host.name}</th>
                  <th className="num">{no.host.score}</th>
                  <th className="num" title={no.host.tiebreakHelp}>
                    {no.host.tiebreak}
                  </th>
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
          </div>
          <p className="faint" style={{ fontSize: 12, textAlign: "center" }}>
            {no.host.tiebreakHelp}
          </p>
          {nonPlayCount > 0 && (
            <p className="faint" style={{ fontSize: 12, textAlign: "center" }}>
              {no.host.resultSourceLegend(nonPlayCount)}
            </p>
          )}
        </div>

        {teamRows.length > 0 && (
          <div className="stack" style={{ alignItems: "center", gap: 10, marginTop: 12, width: "100%" }}>
            <p className="eyebrow">{no.teams.winner}</p>
            <div className="row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
              {teamRows.map((r, i) => (
                <span
                  key={r.team}
                  className="team-chip"
                  style={{
                    fontSize: i === 0 ? 17 : 14,
                    padding: i === 0 ? "8px 18px" : undefined,
                    borderColor:
                      i === 0
                        ? `color-mix(in srgb, ${teamColor(r.team)} 70%, transparent)`
                        : undefined,
                    boxShadow:
                      i === 0 ? `0 8px 30px -10px ${teamColor(r.team)}` : undefined,
                  }}
                >
                  <span className="team-dot" style={{ background: teamColor(r.team) }} />
                  {i === 0 && "🏆 "}
                  {r.team} · <b>{r.score}</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {awards.length > 0 && (
          <div className="stack" style={{ alignItems: "center", gap: 12, marginTop: 18, width: "100%" }}>
            <p className="eyebrow">{no.awards.title}</p>
            <div className="award-grid">
              {awards.map((a, i) => (
                <div
                  key={a.key}
                  className="card award-card reveal"
                  style={{ ["--i" as string]: 3 + i } as CSSProperties}
                >
                  <span className="award-emoji">{AWARD_EMOJI[a.key]}</span>
                  <b style={{ fontSize: 15 }}>{no.awards[a.key]}</b>
                  <span style={{ fontSize: 14, color: "var(--gold)" }}>
                    {a.playerIds.map(nameById).join(" & ")}
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {awardDetail(a)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* how the knockout went — the full bracket path (cup / playoff only) */}
        {rounds.some((r) => r.phase === "playoff") && (
          <div className="stack no-print" style={{ alignItems: "center", gap: 10, marginTop: 18, width: "100%" }}>
            <p className="eyebrow">{no.host.bracketRecap}</p>
            <BracketBoard games={games} rounds={rounds} players={players} />
          </div>
        )}

        {/* Printed page only: per-round pairings + results (the bracket board
            above is a canvas-y interactive widget, cheap to skip on paper —
            this plain list is the "if cheap" per-round recap instead). */}
        <div className="print-only" style={{ marginTop: 18, width: "100%" }}>
          <p className="eyebrow">{no.host.games}</p>
          {rounds
            .slice()
            .sort((a, b) => a.number - b.number || (a.phase === "playoff" ? 1 : -1))
            .map((r) => {
              const roundGames = games.filter((g) => g.roundId === r.id);
              if (roundGames.length === 0) return null;
              return (
                <div key={r.id} style={{ marginTop: 10 }}>
                  <b>
                    {no.host.round} {r.number}
                    {r.phase === "playoff" ? ` · ${no.host.bracket}` : ""}
                  </b>
                  <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                    {roundGames.map((g) => (
                      <li key={g.id} style={{ fontSize: 13 }}>
                        {nameById(g.whitePlayerId)}
                        {g.blackPlayerId ? ` – ${nameById(g.blackPlayerId)}` : ""}:{" "}
                        {printResultLabel(g)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </div>

        <div className="row no-print" style={{ marginTop: 28, gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/arranger" className="btn btn-primary btn-lg">
            {no.host.newTournament} →
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={() => window.print()}
          >
            🖨️ {no.host.printResults}
          </button>
        </div>
      </div>

      <SoundToggle />
      <FullscreenToggle />
    </main>
  );
}
