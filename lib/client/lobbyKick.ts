"use client";

// The lobby ghost-sweep, as pure functions.
//
// The host auto-removes a student who CONNECTED and then stayed gone past the
// grace window (AUTO_KICK_MS in LobbyView — unchanged at 3 minutes). Getting
// that wrong throws a real child out of a real tournament, so the decision lives
// here, away from React, where every rule is a test:
//
//   * Presence absence is only evidence while the HOST's own socket is healthy.
//     On a re-join the server may hand us an EMPTY presence_state before the
//     class has re-announced itself; treating that as "everyone left" stamps the
//     whole roster at once and mass-kicks it three minutes later.
//   * A host tab that is hidden or disconnected must not kick anyone at all: its
//     view of who is online is stale by construction.
//   * Coming back must fully undo the bookkeeping, so a LATER real departure is
//     still handled (the old one-way `kicked` set silently disabled it).

/** Mutable bookkeeping the lobby keeps between presence snapshots. */
export interface LobbyBooks {
  /** Player ids that have been present at least once (never-seen is never kicked). */
  seen: Set<string>;
  /** When each seen-then-absent player was first noticed gone (ms epoch). */
  leftAt: Map<string, number>;
  /** Players we have already fired a kick for (don't fire twice). */
  kicked: Set<string>;
}

/**
 * Fold ONE presence snapshot into the books.
 *
 * `stampAbsent` is false for the first snapshot after a (re)subscribe: until a
 * fresh sync has actually been observed, an absence is our socket's ignorance,
 * not the student's. Anyone in `present` is recorded as seen and cleared from
 * both `leftAt` and `kicked` regardless — a reappearance is always good news.
 */
export function recordPresence(
  books: LobbyBooks,
  present: ReadonlySet<string>,
  now: number,
  stampAbsent: boolean,
): void {
  for (const id of present) {
    books.seen.add(id);
    books.leftAt.delete(id);
    // They're back: a later, real departure must be kickable again.
    books.kicked.delete(id);
  }
  if (!stampAbsent) return;
  for (const id of books.seen) {
    if (!present.has(id) && !books.leftAt.has(id)) books.leftAt.set(id, now);
  }
}

export interface SweepInput {
  /** The roster the host is showing (status "active"). */
  active: readonly { id: string }[];
  /** Presence keys online right now. */
  present: ReadonlySet<string>;
  seen: ReadonlySet<string>;
  leftAt: ReadonlyMap<string, number>;
  kicked: ReadonlySet<string>;
  /** Is the host's OWN presence channel currently SUBSCRIBED? */
  hostSubscribed: boolean;
  /** Is the host tab visible? */
  visible: boolean;
  now: number;
  windowMs: number;
}

/** Which players should be auto-removed right now. Empty is always a valid —
 * and the safe — answer. */
export function sweepCandidates(input: SweepInput): string[] {
  // A host that isn't subscribed, or isn't even on screen, has no standing to
  // judge who is online.
  if (!input.hostSubscribed || !input.visible) return [];

  const out: string[] = [];
  for (const p of input.active) {
    if (input.present.has(p.id)) continue; // online
    if (!input.seen.has(p.id)) continue; // never connected — leave it
    if (input.kicked.has(p.id)) continue; // already fired
    const leftAt = input.leftAt.get(p.id);
    if (leftAt !== undefined && input.now - leftAt > input.windowMs) out.push(p.id);
  }
  return out;
}
