// The trust model behind every Realtime payload (see lib/realtime.ts, §7).
// Port of sundaychess#101, adapted to the m,n,k board string.
//
// WHY THIS FILE EXISTS
//
// Realtime is reached with the PUBLIC anon key — every student's browser holds
// it — and every topic name is derivable from the unauthenticated
// `GET /api/tournament/[id]` payload, which lists every game id. So the app has
// no way to tell a broadcast the SERVER sent from one a classmate typed into a
// console. `lib/realtime.ts` has always said broadcasts are "hints to refetch
// authoritative state, never the source of truth"; these helpers are what makes
// that true in the consumers rather than only in the comment.
//
// THE RULE, in three parts:
//
//   1. SHAPE FIRST. A payload that is not exactly the shape the server sends is
//      dropped whole, so nothing downstream has to defend against a board that
//      is an object or a status that is a number.
//   2. `status` IS NEVER READ FROM A PAYLOAD. A game ends when an authoritative
//      fetch says it ended, and only then. A forged `result` used to end a
//      classmate's game permanently — the poll stops the moment status leaves
//      "live", so nothing ever healed it.
//   3. A `position` MAY BE APPLIED for snappiness, but what it produces is
//      PROVISIONAL: the next authoritative fetch ISSUED AFTER it wins, whatever
//      ply the broadcast claimed. The monotonic ply guard arbitrates only
//      between two AUTHORITATIVE sources (a fetch vs. a fetch, a fetch vs. the
//      player's own optimistic move) — never between a fetch and a broadcast.
//      Without part 3 a forged `position` carrying a very high ply would be
//      accepted by the guard and then BLOCK the real position from ever being
//      adopted again.

import type { GameStatus, Turn } from "@/lib/types";
import { isValidState } from "@/lib/ttt/state";
import { plyOf } from "@/lib/ttt/ply";

export const GAME_STATUSES: readonly GameStatus[] = [
  "live",
  "white_win",
  "black_win",
  "draw",
  "bye",
  "aborted",
];

// --- primitive shape checks -------------------------------------------------

export function isTurn(v: unknown): v is Turn {
  return v === "w" || v === "b";
}

export function isGameStatus(v: unknown): v is GameStatus {
  return typeof v === "string" && (GAME_STATUSES as string[]).includes(v);
}

/** A board this app could actually be playing on: exactly `cells` characters of
 * `.`/`x`/`o` (lib/ttt/state.ts owns that rule), with a mark count that a real
 * game can produce.
 *
 * `cells` is the variant's m·n and comes from OUR side — the tournament config
 * the consumer already holds — never from the payload, which carries no variant
 * field at all. That is the point: a broadcast cannot talk a 3×3 board into
 * rendering 25 cells by claiming a different variant.
 *
 * The X/O balance is the TTT analogue of chess's "every rank accounts for eight
 * files": X plays first and the sides alternate, so a legitimate board always
 * has as many X's as O's or exactly one more. Anything else is not a position
 * the server can have committed, whatever its length. */
export function isBoardString(v: unknown, cells: number): v is string {
  if (typeof v !== "string") return false;
  if (!Number.isInteger(cells) || cells <= 0) return false;
  if (!isValidState(v, cells)) return false;
  let xs = 0;
  let os = 0;
  for (const ch of v) {
    if (ch === "x") xs++;
    else if (ch === "o") os++;
  }
  return xs - os === 0 || xs - os === 1;
}

/** The cell index a `lastMove` may name — a highlight hint, so it only has to
 * be a real square on this board. */
function isLastMoveWire(v: unknown, cells: number): v is { cell: number } {
  if (typeof v !== "object" || v === null) return false;
  const cell = (v as Record<string, unknown>).cell;
  return typeof cell === "number" && Number.isInteger(cell) && cell >= 0 && cell < cells;
}

// --- payload validators -----------------------------------------------------

/** What the game channel's `position` event carries. NOTE the deliberate
 * absence of `status` from what consumers may USE: the server does put one on
 * the wire, and it is validated here so a malformed payload is still dropped
 * whole, but rule 2 above forbids reading it. (Unlike chess there is no clock —
 * SundayTicTacToe times the ROUND, not the move.) */
export interface PositionPayload {
  fen: string;
  turn: Turn;
  status: GameStatus;
  lastMove?: { cell: number } | null;
}

export function isValidPositionPayload(
  v: unknown,
  cells: number,
): v is PositionPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (!isBoardString(p.fen, cells) || !isTurn(p.turn) || !isGameStatus(p.status)) {
    return false;
  }
  // A TTT board string has no side-to-move field; whose turn it is is DERIVED
  // from the ply (lib/ttt/ply.ts — even ⇒ X/w, odd ⇒ O/b, the rule
  // lib/ttt/state.ts's turnFromState encodes). So a payload whose `turn`
  // disagrees with its own board is not something the server can produce — the
  // chess port's "the FEN's own side to move must match `turn`" check, in the
  // units this app has.
  if ((plyOf(p.fen) % 2 === 0 ? "w" : "b") !== p.turn) return false;
  if (p.lastMove != null && !isLastMoveWire(p.lastMove, cells)) return false;
  return true;
}

export interface ResultPayload {
  status: GameStatus;
}

export function isValidResultPayload(v: unknown): v is ResultPayload {
  if (typeof v !== "object" || v === null) return false;
  return isGameStatus((v as Record<string, unknown>).status);
}

/** The tournament-wide spectate feed adds the game id (one topic, many games). */
export interface SpectatePositionPayload {
  gameId: string;
  fen: string;
}

export function isValidSpectatePosition(
  v: unknown,
  cells: number,
): v is SpectatePositionPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.gameId !== "string" || p.gameId.length === 0) return false;
  return isBoardString(p.fen, cells);
}

export interface SpectateResultPayload {
  gameId: string;
  status: GameStatus;
}

export function isValidSpectateResult(v: unknown): v is SpectateResultPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.gameId === "string" && p.gameId.length > 0 && isGameStatus(p.status);
}

/** A draw offer / decline names its sender. Only the OPPONENT may raise or
 * withdraw a banner on my screen; anyone else's `by` is somebody poking at the
 * topic. (The 3 s poll reconciles `drawOfferedBy` anyway — this just stops the
 * banner from flickering in at all.) */
export function isValidDrawEvent(
  v: unknown,
  knownPlayers: ReadonlySet<string>,
): v is { by: string } {
  if (typeof v !== "object" || v === null) return false;
  const by = (v as Record<string, unknown>).by;
  return typeof by === "string" && knownPlayers.has(by);
}

// --- provisional state ------------------------------------------------------

/** One monotonic counter for the whole tab. Both sides of the comparison below
 * draw from it, so "was this fetch issued before or after that broadcast?" is
 * an exact question rather than a wall-clock guess. */
let stampCounter = 0;
export function nextStamp(): number {
  return ++stampCounter;
}

/** Marks board state that only an UNTRUSTED broadcast vouches for. */
export interface Provisional {
  /** `nextStamp()` taken at the instant the broadcast was applied. */
  stamp: number;
}

/** May an AUTHORITATIVE response (a `load()` fetch, or our own move's reply)
 * overwrite what the board currently shows?
 *
 * - `current.ply` — ply of the freshest position we are treating as settled.
 * - `incoming.ply` — ply the authoritative response carries.
 * - `incoming.issuedStamp` — `nextStamp()` taken when that request was SENT.
 * - `provisional` — non-null while the shown position came from a broadcast.
 *
 * A request issued after the broadcast landed reads server state at or after
 * the move that broadcast claimed (the server broadcasts only after committing
 * the move), so its answer is the truth about that claim — adopt it whatever
 * its ply. That is what heals a forged position, and it is the ONLY way a
 * lower ply is ever adopted. A response that was already in flight before the
 * broadcast proves nothing about it, so it falls back to the ply guard and
 * cannot roll a legitimate move back off the board. */
export function resolveAuthoritative(
  current: { ply: number },
  incoming: { ply: number; issuedStamp: number },
  provisional: Provisional | null,
): boolean {
  if (provisional && incoming.issuedStamp >= provisional.stamp) return true;
  return incoming.ply >= current.ply;
}

// --- reactions --------------------------------------------------------------

/** Incoming emoji reactions are client→client broadcasts: no server ever sees
 * them, so they are the one payload with NO authoritative version to fall back
 * on. The only defence is the gate below — allowlist, known sender, and a cap
 * on how many may land per second, since the harm here is a screenful of
 * floating emoji over a live board rather than a wrong position.
 *
 * The window is global rather than per-sender on purpose: it is the OVERLAY
 * being protected, and it fills up just as fast from five spoofed senders as
 * from one. */
export const REACTION_RATE_LIMIT_PER_SEC = 5;

export type ReactionGate = (
  payload: unknown,
  senders: ReadonlySet<string>,
) => string | null;

export function createReactionGate(
  allowed: readonly string[],
  limitPerSecond: number = REACTION_RATE_LIMIT_PER_SEC,
  now: () => number = Date.now,
): ReactionGate {
  const recent: number[] = [];
  return (payload, senders) => {
    if (typeof payload !== "object" || payload === null) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.emoji !== "string" || !allowed.includes(p.emoji)) return null;
    if (typeof p.by !== "string" || !senders.has(p.by)) return null;
    const t = now();
    while (recent.length > 0 && t - recent[0] >= 1000) recent.shift();
    if (recent.length >= limitPerSecond) return null;
    recent.push(t);
    return p.emoji;
  };
}
