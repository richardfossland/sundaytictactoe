// Swiss / Monrad pairing — pure function with injectable RNG.
//
// Pragmatic greedy Monrad (not FIDE-perfect, by design — spec §6):
//  - Round 1: shuffle, pair sequentially, odd one out gets a bye.
//  - Round ≥2: sort by (score desc, tiebreak desc); greedily pair adjacent
//    players who have NOT met before, floating a player down when a score
//    group is odd; bye goes to the lowest-ranked player without one yet.
//  - Colours are balanced (fewer-whites-so-far plays white; ties → higher rank).

import type { Rng } from "@/lib/codes";

export interface PairablePlayer {
  id: string;
  score: number;
  tiebreak: number;
}

export interface ColorCount {
  white: number;
  black: number;
}

export interface PairInput {
  players: PairablePlayer[];
  round: number;
  /** Unordered keys of pairs that already played — see pairKey(). */
  metBefore?: ReadonlySet<string>;
  /** Player ids who already received a bye (legacy; superseded by byeCounts). */
  hadBye?: ReadonlySet<string>;
  /** Per-player bye counts — preferred over hadBye, for even distribution. */
  byeCounts?: ReadonlyMap<string, number>;
  /** Per-player colour history for balancing white/black. */
  colors?: ReadonlyMap<string, ColorCount>;
  rng?: Rng;
}

export interface Pairing {
  whiteId: string;
  blackId: string | null; // null = bye
  /** True when this pair has met before (only set when a rematch was forced). */
  rematch?: boolean;
}

/** Stable unordered key for a pair of player ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function byStandings(a: PairablePlayer, b: PairablePlayer): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.tiebreak !== a.tiebreak) return b.tiebreak - a.tiebreak;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // deterministic
}

/** Decide which of two players takes white, balancing colour history. */
function assignColors(
  hi: string,
  lo: string,
  colors: ReadonlyMap<string, ColorCount> | undefined,
): { whiteId: string; blackId: string } {
  if (colors) {
    const hiW = colors.get(hi)?.white ?? 0;
    const loW = colors.get(lo)?.white ?? 0;
    if (hiW > loW) return { whiteId: lo, blackId: hi };
    if (loW > hiW) return { whiteId: hi, blackId: lo };
  }
  // Default: higher-ranked (passed as `hi`) takes white.
  return { whiteId: hi, blackId: lo };
}

export function pair(input: PairInput): Pairing[] {
  const rng = input.rng ?? Math.random;
  const metBefore = input.metBefore ?? new Set<string>();
  // Unified bye counts: prefer explicit counts, else treat each hadBye id as 1.
  const byeCounts: ReadonlyMap<string, number> =
    input.byeCounts ?? new Map([...(input.hadBye ?? [])].map((id) => [id, 1]));
  const colors = input.colors;

  if (input.players.length === 0) return [];

  // Order the pool: random for round 1, standings otherwise.
  const pool =
    input.round <= 1
      ? shuffle(input.players, rng)
      : input.players.slice().sort(byStandings);

  const pairings: Pairing[] = [];
  let byeId: string | null = null;

  if (pool.length % 2 === 1) {
    if (input.round <= 1) {
      // Round 1: the last shuffled player gets the bye.
      byeId = pool[pool.length - 1].id;
    } else {
      // Fewest byes so far, then lowest-ranked among them (pool is sorted by
      // standings, so iterate from the end). Spreads repeat byes evenly instead
      // of handing the same player a second free point.
      let min = Infinity;
      for (const p of pool) min = Math.min(min, byeCounts.get(p.id) ?? 0);
      for (let i = pool.length - 1; i >= 0; i--) {
        if ((byeCounts.get(pool[i].id) ?? 0) === min) {
          byeId = pool[i].id;
          break;
        }
      }
    }
  }

  const queue = pool.filter((p) => p.id !== byeId);

  if (input.round <= 1) {
    // Round 1: no history — pair the shuffled order sequentially.
    for (let i = 0; i + 1 < queue.length; i += 2) {
      const { whiteId, blackId } = assignColors(queue[i].id, queue[i + 1].id, colors);
      pairings.push({ whiteId, blackId });
    }
  } else {
    // Round ≥2: find a rematch-free perfect matching that keeps similar-scored
    // players together (queue is standings-sorted, so pairing the earliest
    // unpaired player with its nearest legal opponent stays score-local). Fall
    // back to a greedy matching that allows a forced rematch only when no
    // rematch-free matching exists at all.
    const matched =
      findRematchFreeMatching(queue, metBefore) ?? greedyMatching(queue, metBefore);
    for (const m of matched) {
      const { whiteId, blackId } = assignColors(m.hi, m.lo, colors);
      pairings.push(m.rematch ? { whiteId, blackId, rematch: true } : { whiteId, blackId });
    }
  }

  if (byeId !== null) pairings.push({ whiteId: byeId, blackId: null });
  return pairings;
}

interface MatchedPair {
  hi: string; // higher-ranked (earlier in the standings-sorted queue)
  lo: string;
  rematch?: boolean;
}

/** Backtracking search for a perfect matching with NO repeat pairings. Pairs the
 * first unpaired player with each candidate in standings order (nearest first),
 * so a found matching stays score-local. Returns null if none exists. */
function findRematchFreeMatching(
  queue: PairablePlayer[],
  metBefore: ReadonlySet<string>,
): MatchedPair[] | null {
  if (queue.length === 0) return [];
  const [first, ...rest] = queue;
  for (let i = 0; i < rest.length; i++) {
    const cand = rest[i];
    if (metBefore.has(pairKey(first.id, cand.id))) continue;
    const remaining = rest.filter((_, j) => j !== i);
    const sub = findRematchFreeMatching(remaining, metBefore);
    if (sub) return [{ hi: first.id, lo: cand.id }, ...sub];
  }
  return null;
}

/** Greedy matching that allows a forced rematch as a last resort (only used
 * when no rematch-free matching exists). */
function greedyMatching(
  queue: PairablePlayer[],
  metBefore: ReadonlySet<string>,
): MatchedPair[] {
  const used = new Set<string>();
  const out: MatchedPair[] = [];
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (used.has(a.id)) continue;
    used.add(a.id);
    let opp: PairablePlayer | null = null;
    let rematch = false;
    for (let j = i + 1; j < queue.length; j++) {
      if (used.has(queue[j].id)) continue;
      if (!metBefore.has(pairKey(a.id, queue[j].id))) {
        opp = queue[j];
        break;
      }
    }
    if (!opp) {
      for (let j = i + 1; j < queue.length; j++) {
        if (used.has(queue[j].id)) continue;
        opp = queue[j];
        rematch = true;
        break;
      }
    }
    if (opp) {
      used.add(opp.id);
      out.push({ hi: a.id, lo: opp.id, rematch });
    }
  }
  return out;
}
