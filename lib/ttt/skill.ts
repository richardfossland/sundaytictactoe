// Adaptive single-player difficulty — the tic-tac-toe port of the chess app's
// lib/chess/skill.ts. Two PURE, unit-tested concerns:
//
//   1. skill → search knobs. One continuous `skill` value (an Elo-like number)
//      drives how strong the bot plays: deeper search and fewer random
//      blunders as it rises. lib/ttt/bot.ts already takes an injectable rng and
//      now takes a params override, so this module only has to choose knobs.
//
//   2. an Elo-style rating update so the bot auto-tunes toward a ~50% win rate.
//      After each solo game the player's rating moves toward/away from the
//      bot's, and the next game's bot is set to the new player rating. A few
//      games converge on an even matchup.
//
// WHY THIS EXISTS AT ALL (the cliff it removes). The four fixed levels step
// like this on the classic 3×3:
//
//     easy         60% random, 1 ply
//     medium       20% random, 2 plies
//     hard          0% random, full search  ← perfect play
//     impossible    0% random, full search  ← perfect play
//
// There is nothing between "throws the game away three times out of five" and
// "cannot be beaten". A child who outgrows Lett has exactly one place to go,
// and it is a wall. The ramp below fills that gap continuously: the blunder
// rate fades out over the lower half of the range while the depth climbs over
// the upper half, so every rating in between is a genuinely different opponent.
//
// Everything here is deterministic given its inputs — no DOM, no storage, no
// RNG — so it is straightforward to test.

import { fullDepth, type BotParams } from "@/lib/ttt/bot";
import { DEFAULT_VARIANT, type MnkVariant } from "@/lib/ttt/variants";

export type { BotParams };

/** Inclusive bounds for a skill / rating value (Elo-like). */
export const MIN_SKILL = 400;
export const MAX_SKILL = 2000;
/** Where a brand-new player starts before any games are recorded. */
export const DEFAULT_SKILL = 800;

/** The blunder rate at the very bottom of the ramp — today's "Lett". */
export const FLOOR_RANDOM_MOVE_PROB = 0.6;

/** Fraction of the range over which the blunder rate fades to zero. Above it
 * the bot never throws a move away and strength comes from depth alone. */
const BLUNDER_FADE = 0.75;

/** Clamp any number into the skill range. */
export function clampSkill(skill: number): number {
  if (!Number.isFinite(skill)) return DEFAULT_SKILL;
  return Math.min(MAX_SKILL, Math.max(MIN_SKILL, skill));
}

/**
 * Map a continuous skill value to concrete search knobs, for one board.
 *
 * The two endpoints are deliberately the two endpoints the app already had, so
 * "Tilpasset" spans the existing difficulty range rather than inventing a new
 * one:
 *
 *   skill = MIN_SKILL  →  { maxDepth: 1, randomMoveProb: 0.6 }   ≡ "Lett"
 *   skill = MAX_SKILL  →  { maxDepth: full, randomMoveProb: 0 }  ≡ "Uslåelig"
 *
 * Both knobs are monotonic in `skill`, and the two curves are deliberately out
 * of phase. Depth is squared, so it stays shallow through the lower half where
 * the fading blunder rate is doing the work, then climbs steeply once blunders
 * are gone — otherwise a mid-range bot would be searching several plies deep
 * AND throwing a third of its moves away, which reads as random rather than as
 * "a bit better than last time".
 *
 * `variant` decides the ceiling: a full search means 9 plies on 3×3 but only 6
 * on 4×4 and 4 on 5×5 (see lib/ttt/bot.ts), because the tree is far wider
 * there and a student's Chromebook has to render a move inside a heartbeat.
 */
export function skillToParams(
  skill: number,
  variant: MnkVariant = DEFAULT_VARIANT,
): BotParams {
  const s = clampSkill(skill);
  // 0 at MIN_SKILL → 1 at MAX_SKILL.
  const t = (s - MIN_SKILL) / (MAX_SKILL - MIN_SKILL);
  const full = fullDepth(variant);

  const maxDepth = Math.max(1, Math.min(full, Math.round(1 + (full - 1) * t * t)));
  const randomMoveProb = Math.max(0, FLOOR_RANDOM_MOVE_PROB * (1 - t / BLUNDER_FADE));

  return { maxDepth, randomMoveProb };
}

// ---------------------------------------------------------------------------
// Elo rating update
// ---------------------------------------------------------------------------

/** A game result from the *player's* perspective. */
export type GameScore = 0 | 0.5 | 1; // loss / draw / win

/** Map an outcome string to an Elo score. */
export function outcomeToScore(outcome: "win" | "loss" | "draw"): GameScore {
  return outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
}

/**
 * Expected score for `playerRating` against `opponentRating` under the
 * standard logistic Elo curve. Returns a value in (0,1).
 */
export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

/**
 * K-factor: larger while a player has few games (fast calibration), settling to
 * a stable value once they have a track record. This is what makes the bot
 * converge quickly toward an even ~50% matchup for a new student — a school
 * hour is maybe a dozen games, so the calibration has to be fast.
 */
export function kFactor(gamesPlayed: number): number {
  if (gamesPlayed < 5) return 80;
  if (gamesPlayed < 15) return 48;
  return 32;
}

/** A persisted, evolving rating for one device identity. */
export interface RatingState {
  rating: number;
  games: number;
}

export const INITIAL_RATING: RatingState = { rating: DEFAULT_SKILL, games: 0 };

/**
 * Update a player's rating after one game against a bot of `opponentRating`.
 * Pure: returns a new RatingState, clamped to the skill range.
 */
export function updateRating(
  state: RatingState,
  opponentRating: number,
  score: GameScore,
): RatingState {
  const k = kFactor(state.games);
  const expected = expectedScore(state.rating, opponentRating);
  const next = state.rating + k * (score - expected);
  return { rating: Math.round(clampSkill(next)), games: state.games + 1 };
}

/**
 * The bot's skill for the next game given the player's current rating. The bot
 * mirrors the player (so the expected score is ~0.5), which is the auto-tune
 * toward a 50% win rate.
 */
export function botSkillForPlayer(state: RatingState): number {
  return clampSkill(state.rating);
}
