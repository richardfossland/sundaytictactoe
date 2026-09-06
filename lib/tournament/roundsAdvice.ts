// Rounds guidance for the arranger wizard's "rounds" step.
//
// Swiss/Monrad pairing (see lib/tournament/pair.ts) can only guarantee no
// repeat pairing while there are enough distinct opponents to go around: once
// the round count exceeds players − 1, every player has already faced every
// other player once, so `greedyMatching` is forced into its "no rematch-free
// matching exists" fallback and hands out a repeat pairing (see the
// `rematch: true` branch there). We surface that ceiling here so the wizard
// (and, later, the lobby — see the PR body) can warn the host before it
// happens, instead of the host discovering it mid-tournament.

import { no } from "@/lib/locale/no";

/** Bounds enforced by the wizard's rounds stepper (Wizard.tsx). */
export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 7;

/**
 * The largest round count that avoids ever forcing a rematch, for a given
 * player count. A round-robin runs out of fresh opponents once every player
 * has played every other player once — i.e. after `players − 1` rounds.
 */
export function maxRoundsWithoutRematch(players: number): number {
  return Math.max(1, players - 1);
}

/**
 * Suggests a sensible default round count for the given player count: enough
 * rounds to produce a meaningful standings table, without exceeding the
 * no-rematch ceiling, and clamped to the wizard's [MIN_ROUNDS, MAX_ROUNDS]
 * control range. Below that ceiling, we simply recommend the ceiling itself —
 * any more would guarantee a rematch.
 */
export function recommendedRounds(players: number): number {
  const ceiling = maxRoundsWithoutRematch(players);
  if (ceiling < MIN_ROUNDS) return ceiling;
  return Math.min(MAX_ROUNDS, ceiling);
}

/**
 * Warns the host when the chosen round count will force at least one
 * rematch for the given player count. Returns null when the roster can
 * support that many rounds without repeating a pairing.
 *
 * Not yet wired into the UI — the wizard runs before anyone has joined, so
 * it has no real player count to check against. The intended consumer is
 * the host lobby (where the actual roster is known), left for a follow-up PR.
 */
export function roundsWarning(players: number, rounds: number): string | null {
  if (players <= 0) return null;
  const ceiling = maxRoundsWithoutRematch(players);
  if (rounds > ceiling) return no.wizard.roundsWarningRematch(rounds, players);
  return null;
}
