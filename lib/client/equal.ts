import type { GameDetail } from "@/lib/dto";

/**
 * L5 port (sundaychess#84): equality helpers whose ONLY job is to keep a
 * reference stable when the value behind it did not change.
 *
 * Every one of these sits in front of a `setState` that used to fire
 * unconditionally on a timer. React bails out of a re-render when the next
 * state is `Object.is`-equal to the current one, so returning `prev` from the
 * updater is what actually stops the render — not the comparison itself.
 *
 * They are all deliberately CONSERVATIVE: a false negative (saying "changed"
 * when nothing did) only reproduces today's behaviour — an extra render. A
 * false positive would drop a real update, so every comparison below covers
 * the whole value the UI reads, and errs towards "changed" when unsure.
 */

/** Membership equality for a presence key set (order-independent).
 *
 * `channelRegistry.presentKeys()` builds a FRESH `Set` on every presence
 * sync/join/leave in the whole class — one student's phone waking up handed
 * every other client a new object and re-rendered their whole tree. */
export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/** Structural equality via `JSON.stringify`.
 *
 * Used for `BoardState`, which is a few KB of plain JSON parsed straight off
 * the wire — stringifying it is far cheaper than the React re-render (plus the
 * whole board grid) it prevents every 5 s, and both sides come from
 * `JSON.parse` of the same server shape, so key ORDER is deterministic. If it
 * ever weren't, the comparison would simply say "changed" and we'd render
 * exactly as we do today. Values our API never emits (functions, `undefined`
 * inside objects, cycles) are out of scope by construction. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // `JSON.stringify(undefined)` is `undefined`, not a string — so nullish
  // values must be settled by identity before we get to stringifying.
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Field equality for the game detail GameView actually reads.
 *
 * The 3 s `load()` re-fetches the whole `GameDetail`; between two moves every
 * field is identical, so adopting the new object only churned identities. The
 * ply-guarded `setFen`/`setTurn`/… writes below it are untouched and stay
 * authoritative — this only decides whether `detail` ITSELF is a new object.
 *
 * TTT's `GameDetail` carries no clock (no per-side timers, only the optional
 * shared round `timer` fed from `WaitingRoom`, which GameView never mutates)
 * and `lastMove` is a single `{ cell }` rather than chess's `{from,to,san}`.
 *
 * `?? null` on every optional field so `undefined` (absent) and `null`
 * (explicitly none) compare equal — the API omits `drawOfferedBy` entirely on
 * some routes and sends `null` on others. */
export function sameDetail(a: GameDetail | null, b: GameDetail | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.fen === b.fen &&
    a.pgn === b.pgn &&
    a.status === b.status &&
    a.turn === b.turn &&
    (a.drawOfferedBy ?? null) === (b.drawOfferedBy ?? null) &&
    a.white.id === b.white.id &&
    a.white.name === b.white.name &&
    (a.black?.id ?? null) === (b.black?.id ?? null) &&
    (a.black?.name ?? null) === (b.black?.name ?? null) &&
    (a.lastMove?.cell ?? null) === (b.lastMove?.cell ?? null)
  );
}
