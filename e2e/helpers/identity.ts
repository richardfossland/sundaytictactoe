import type { BrowserContext, Page } from "@playwright/test";

import type { StoredPlayer } from "@/lib/client/identity";

// The two bearer identities the app keeps in localStorage, seeded and read the
// way `lib/client/identity.ts` writes them.
//
// Seeding goes in through `context.addInitScript`, so the value is already there
// before ANY app code runs and `/play` (or `/arranger/<id>`) walks its real
// path. Reading is how a spec proves the opposite of a bug: after a 503, a WAF
// 403 or a dropped network, the student's resume code must still be on the
// device.
//
// R6: student sessions are keyed PER TOURNAMENT — `ttt:player:<tournamentId>`
// plus a `ttt:player:last` pointer and a `ttt:player:index` list. The old
// single-slot `ttt:player` is migration input only; `seedLegacyPlayer` writes
// it so one spec can prove a device that was mid-tournament across the deploy
// keeps its seat.

/** `identity.savePlayer` / `identity.playerFor(tid)` — one record per tournament. */
export const playerKey = (tournamentId: string) => `ttt:player:${tournamentId}`;
/** `identity.player()` — which tournament the bare `/play` entry resumes. */
export const LAST_KEY = "ttt:player:last";
/** `identity.allPlayers()` — the tournament ids that have a stored session. */
export const INDEX_KEY = "ttt:player:index";
/** Pre-R6 single-slot key. The app migrates and deletes it; nothing writes it. */
export const LEGACY_PLAYER_KEY = "ttt:player";

/** `identity.saveHostCode(tournamentId, …)` — the teacher's bearer code. */
export const hostKey = (tournamentId: string) => `ttt:host:${tournamentId}`;

async function seed(context: BrowserContext, pairs: [string, string][]): Promise<void> {
  await context.addInitScript((entries: [string, string][]) => {
    // Init scripts also run on the context's initial `about:blank`, where
    // localStorage is an opaque origin and every access throws SecurityError.
    // Unguarded, that throw lands in the trace as a pageError on every run.
    try {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
    } catch {
      // about:blank; the same script runs again on the real document.
    }
  }, pairs);
}

/** Put a student's bearer identity on the device, in the CURRENT layout, before
 *  the first byte of app code. */
export function seedPlayer(context: BrowserContext, player: StoredPlayer): Promise<void> {
  return seed(context, [
    [playerKey(player.tournamentId), JSON.stringify(player)],
    [LAST_KEY, player.tournamentId],
    [INDEX_KEY, JSON.stringify([player.tournamentId])],
  ]);
}

/** The same identity in the PRE-R6 layout: one `ttt:player` blob and nothing
 *  else. The app must migrate it on first read — see e2e/identity-migration.spec.ts. */
export function seedLegacyPlayer(
  context: BrowserContext,
  player: StoredPlayer,
): Promise<void> {
  return seed(context, [[LEGACY_PLAYER_KEY, JSON.stringify(player)]]);
}

/**
 * Put the teacher's host code on the device — exactly what `identity.saveHostCode`
 * writes when the browser created the tournament. `/arranger/<id>` reads it on
 * mount (LobbyView) and every host action (start round, kick) is refused without
 * it, so a spec that asserts the host did NOT kick anyone is vacuous unless this
 * ran first.
 */
export function seedHostCode(
  context: BrowserContext,
  tournamentId: string,
  hostCode: string,
): Promise<void> {
  return seed(context, [[hostKey(tournamentId), hostCode]]);
}

/** One raw localStorage value, or null when absent/unreadable. */
export function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k: string) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  }, key);
}

/** The stored student identity as the app would read it back: follow the
 *  `last` pointer, exactly like `identity.player()`. null when absent. */
export async function readIdentity(page: Page): Promise<StoredPlayer | null> {
  const tournamentId = await readStorage(page, LAST_KEY);
  if (!tournamentId) return null;
  return readIdentityFor(page, tournamentId);
}

/** The stored session for ONE tournament — `identity.playerFor(tid)`. */
export async function readIdentityFor(
  page: Page,
  tournamentId: string,
): Promise<StoredPlayer | null> {
  const raw = await readStorage(page, playerKey(tournamentId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPlayer;
  } catch {
    return null;
  }
}
