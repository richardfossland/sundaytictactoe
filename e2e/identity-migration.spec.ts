import { expect, test, type BrowserContext } from "@playwright/test";

import { createMatch, openAs } from "./fixtures/match";
import {
  INDEX_KEY,
  LAST_KEY,
  LEGACY_PLAYER_KEY,
  playerKey,
  readIdentity,
  readStorage,
} from "./helpers/identity";

// R6 made student sessions per-tournament (`ttt:player:<tournamentId>` + a
// `ttt:player:last` pointer). Every device in a classroom that is mid-
// tournament when that deploy lands is carrying the OLD single-slot
// `ttt:player` blob instead.
//
// The migration is therefore not a nicety: get it wrong and a student in the
// middle of round 2 comes back from a page reload to the join screen, with a
// resume code they never wrote down. There is no way to unit-test the thing
// that actually matters here — that the REAL page, on the REAL bundle, resumes
// from a legacy key — so it is asserted where it lives, in the browser.

test("a pre-R6 device keeps its seat: legacy key resumes, then is gone", async ({
  browser,
  request,
}) => {
  const match = await createMatch(request, { white: "Ada", black: "Bo" });
  let ctx: BrowserContext | null = null;
  try {
    ctx = await browser.newContext();

    // `legacy: true` seeds ONLY `ttt:player`, exactly as pre-R6 code wrote it.
    // openAs then walks the real path — /play → attemptResume → WaitingRoom
    // latches the live game → GameView — and returns only once the board and
    // its cells are on screen. Reaching the board at all is the migration
    // working.
    const page = await openAs(ctx, match.white, { legacy: true });

    // The old key is gone: a migration that leaves it behind would re-apply
    // forever and could resurrect a stale session over a newer one.
    expect(
      await readStorage(page, LEGACY_PLAYER_KEY),
      "the legacy ttt:player key survived the migration",
    ).toBeNull();

    // …and the session is in the new layout, under its own tournament.
    const record = await readStorage(page, playerKey(match.tournamentId));
    expect(record, "no per-tournament record was written").toBeTruthy();
    expect(await readStorage(page, LAST_KEY)).toBe(match.tournamentId);
    expect(JSON.parse((await readStorage(page, INDEX_KEY)) ?? "[]")).toContain(
      match.tournamentId,
    );

    // The resume code came through intact — the whole reason the record exists.
    const stored = await readIdentity(page);
    expect(stored?.resumeCode).toBe(match.white.resumeCode);
    expect(stored?.playerId).toBe(match.white.playerId);
  } finally {
    await ctx?.close();
  }
});
