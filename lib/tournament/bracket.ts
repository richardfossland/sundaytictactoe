// Single-elimination playoff bracket. Pure helpers.
//
// Seeding (spec §6): take top N by (score, Buchholz), seed 1..N, pair 1vN,
// 2 v N-1, … so the strongest meet last. N must be a power of two; the wizard
// caps/shrinks the chosen size to ≤ player count, so we also expose that.

export interface SeededPlayer {
  playerId: string;
  seed: number; // 1-based
}

export interface BracketMatch {
  matchId: string; // e.g. "R1-M0"
  round: number; // 1 = first playoff round
  slot: number; // position within the round, 0-based
  topSeed: number | null; // seed number (display); null once decided upstream
  bottomSeed: number | null;
  topPlayerId: string | null;
  bottomPlayerId: string | null;
  winnerPlayerId: string | null;
}

/** Largest power of two ≤ n, clamped to the allowed playoff sizes. */
export function effectivePlayoffSize(
  requested: 0 | 4 | 8 | 16,
  playerCount: number,
): 0 | 2 | 4 | 8 | 16 {
  if (requested === 0) return 0;
  const size = Math.min(requested, playerCount);
  // shrink to nearest power of two ≤ size; allow a 2-player final so small
  // groups (and a 2-student test) still get a real knockout.
  const allowed: (0 | 2 | 4 | 8 | 16)[] = [16, 8, 4, 2];
  for (const a of allowed) if (size >= a) return a;
  return 0;
}

/** Sort games into their bracket-slot order. Pre-0007 rows have no slot
 * (all 0) — Array.prototype.sort is stable, so they keep their fetched order
 * (the old behavior). Single-elim pairing depends on this order. */
export function sortBySlot<T extends { slot?: number | null }>(games: T[]): T[] {
  return games.slice().sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}

/** Cup bracket size: the next power of two ≥ n (players beyond n become
 * first-round byes for the top seeds). Capped at 256 — well beyond any realistic
 * single-organiser event, so a whole grade isn't silently dropped (the old cap
 * of 32 left players 33+ stuck in the waiting room forever). */
export function cupBracketSize(n: number): number {
  if (n < 2) return 0;
  let size = 2;
  while (size < n && size < 256) size *= 2;
  return size;
}

/** Standard seed order for a bracket of size n (n a power of two).
 * Returns pairs of seeds [top, bottom] for round 1 so that 1 meets the lowest
 * seed, and the bracket is balanced (1 and 2 can only meet in the final). */
export function seedOrder(n: number): [number, number][] {
  // Build the canonical bracket seeding recursively.
  let seeds = [1];
  while (seeds.length < n) {
    const rounds = seeds.length * 2;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s);
      next.push(rounds + 1 - s);
    }
    seeds = next;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < seeds.length; i += 2) pairs.push([seeds[i], seeds[i + 1]]);
  return pairs;
}

/** Build the first playoff round from seeded players. `bracketSize` defaults
 * to the player count (league playoff: exact power of two); pass a larger
 * power of two for cup mode — missing bottom seeds become byes (null). */
export function buildFirstRound(
  seeded: SeededPlayer[],
  bracketSize = seeded.length,
): BracketMatch[] {
  const bySeed = new Map(seeded.map((s) => [s.seed, s.playerId]));
  const order = seedOrder(bracketSize);
  return order.map((pair, slot) => ({
    matchId: `R1-M${slot}`,
    round: 1,
    slot,
    topSeed: pair[0],
    bottomSeed: pair[1],
    topPlayerId: bySeed.get(pair[0]) ?? null,
    bottomPlayerId: bySeed.get(pair[1]) ?? null,
    winnerPlayerId: null,
  }));
}

/** Number of playoff rounds for a bracket of size n. */
export function bracketRounds(n: number): number {
  return Math.max(0, Math.round(Math.log2(n)));
}

/** Given completed matches of a round, produce the next round's matches by
 * pairing adjacent winners. Returns [] when only one match (the final) remains. */
export function nextRound(current: BracketMatch[]): BracketMatch[] {
  if (current.length <= 1) return [];
  const round = current[0].round + 1;
  const next: BracketMatch[] = [];
  for (let i = 0; i < current.length; i += 2) {
    const top = current[i];
    const bottom = current[i + 1];
    next.push({
      matchId: `R${round}-M${i / 2}`,
      round,
      slot: i / 2,
      topSeed: top?.winnerPlayerId ? winnerSeed(top) : null,
      bottomSeed: bottom?.winnerPlayerId ? winnerSeed(bottom) : null,
      topPlayerId: top?.winnerPlayerId ?? null,
      bottomPlayerId: bottom?.winnerPlayerId ?? null,
      winnerPlayerId: null,
    });
  }
  return next;
}

function winnerSeed(m: BracketMatch): number | null {
  if (m.winnerPlayerId === null) return null;
  if (m.winnerPlayerId === m.topPlayerId) return m.topSeed;
  if (m.winnerPlayerId === m.bottomPlayerId) return m.bottomSeed;
  return null;
}
