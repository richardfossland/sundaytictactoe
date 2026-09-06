// Round-progress line for the waiting room (between-rounds / bye screens).
// Pure — no React, no fetching — so it's covered directly by unit tests
// instead of only through the component that renders it.

import type { BoardState } from "@/lib/dto";
import {
  bracketRounds,
  cupBracketSize,
  effectivePlayoffSize,
} from "@/lib/tournament/bracket";

type Round = BoardState["rounds"][number];

export interface WaitingProgress {
  /** "Runde n av N · X partier igjen", or "Venter på at arrangøren starter
   * runde n+1" once every game in the current round is resolved. */
  label: string;
  /** The current round's timer, ready for a compact <RoundTimer>. Null when no
   * timer is configured for the tournament, or the round hasn't started yet. */
  timer: { startedAt: string | null; durationSec: number; extendedMs: number } | null;
}

/** Total rounds for the tournament's CURRENT phase — the denominator in
 * "Runde n av N". League: the wizard's fixed round count. Playoff/cup: derived
 * from the same bracket-size formula the server used to build round 1 (mirrors
 * lib/server/playoff.ts's maybeStartPlayoff/startCup), using the CURRENT
 * active-player count — stable once the bracket has started, since players
 * are never removed from the roster, only excluded from later rounds. */
function totalRounds(state: BoardState): number {
  const { tournament, players } = state;
  if (tournament.status !== "playoff") return tournament.config.leagueRounds;
  const active = players.filter((p) => p.status === "active").length;
  const size =
    tournament.config.format === "cup"
      ? cupBracketSize(active)
      : effectivePlayoffSize(tournament.config.playoffSize, active);
  return bracketRounds(size);
}

/** Is `playerId` out of the running for the CURRENT playoff round — i.e. not
 * present in any of its games? Mirrors WaitingRoom's own (component-local)
 * `isOut`, duplicated rather than imported since that helper lives in a
 * client component and this stays a plain, framework-free module. Always
 * false outside a playoff — league byes/waits are never "eliminated" here. */
function eliminatedFromRound(
  state: BoardState,
  playerId: string,
  round: Round | undefined,
): boolean {
  if (state.tournament.status !== "playoff" || !round) return false;
  return !state.games.some(
    (g) =>
      g.roundId === round.id &&
      (g.whitePlayerId === playerId || g.blackPlayerId === playerId),
  );
}

/** What (if anything) the waiting room should tell `me` about the current
 * round: how far the tournament has gotten, how many games are still live,
 * and — when configured — the round timer. Null when there's nothing to
 * report: the lobby, a finished tournament, a round that hasn't been created
 * yet, or `me` themself is out of the current (playoff) round. */
export function waitingProgress(
  state: BoardState,
  me: { playerId: string },
): WaitingProgress | null {
  const { tournament, rounds, games } = state;
  if (tournament.status === "lobby" || tournament.status === "finished") {
    return null;
  }

  const phase = tournament.status === "playoff" ? "playoff" : "league";
  const round = rounds.find(
    (r) => r.phase === phase && r.number === tournament.currentRound,
  );
  if (!round) return null;
  if (eliminatedFromRound(state, me.playerId, round)) return null;

  const total = totalRounds(state);
  const live = games.filter(
    (g) => g.roundId === round.id && g.status === "live",
  ).length;

  const label =
    live > 0
      ? `Runde ${tournament.currentRound} av ${total} · ${live} partier igjen`
      : `Venter på at arrangøren starter runde ${tournament.currentRound + 1}`;

  const timerSec = tournament.config.roundTimerSec;
  const timer =
    timerSec && round.startedAt
      ? {
          startedAt: round.startedAt,
          durationSec: timerSec,
          extendedMs: round.extendedMs,
        }
      : null;

  return { label, timer };
}

/** Should the waiting room offer "play solo while you wait" (linking out to
 * /solo)? True once there is nothing left for `playerId` to do right now:
 *  - marked "left" (a walkover / lobby ghost-kick that outlived the lobby —
 *    mirrors WaitingRoom's own component-local `isOut`, first branch), or
 *  - eliminated from the CURRENT playoff round (reuses `eliminatedFromRound`
 *    above — same `isOut` second branch; a knockout loss is final, so unlike
 *    the league branch below, "waiting between playoff rounds" alone doesn't
 *    count), or
 *  - in a LEAGUE round: has a bye, or already finished their game while other
 *    boards are still live (their most recent game exists and isn't "live").
 * Always false in the lobby (nothing paired yet) or once the tournament is
 * "finished" (the final-results card owns that screen instead). */
export function offerSoloWhileWaiting(state: BoardState, playerId: string): boolean {
  const { tournament, players, games, rounds } = state;
  if (tournament.status === "lobby" || tournament.status === "finished") {
    return false;
  }

  const me = players.find((p) => p.id === playerId);
  if (me?.status === "left") return true;

  if (tournament.status === "playoff") {
    const round = rounds.find(
      (r) => r.phase === "playoff" && r.number === tournament.currentRound,
    );
    return eliminatedFromRound(state, playerId, round);
  }

  const mine = games.filter(
    (g) => g.whitePlayerId === playerId || g.blackPlayerId === playerId,
  );
  if (mine.length === 0) return false;
  const current = mine.find((g) => g.status === "live") ?? mine[mine.length - 1];
  return current.status !== "live";
}
