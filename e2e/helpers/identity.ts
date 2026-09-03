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

/** `identity.savePlayer` / `identity.player()` — one student session per browser. */
export const PLAYER_KEY = "ttt:player";

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

/** Put a student's bearer identity on the device, before the first byte of app code. */
export function seedPlayer(context: BrowserContext, player: StoredPlayer): Promise<void> {
  return seed(context, [[PLAYER_KEY, JSON.stringify(player)]]);
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

/** The stored student identity as the app would read it back. null when absent. */
export async function readIdentity(page: Page): Promise<StoredPlayer | null> {
  const raw = await page.evaluate((key: string) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, PLAYER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPlayer;
  } catch {
    return null;
  }
}
