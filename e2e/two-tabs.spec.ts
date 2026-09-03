import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { createMatch, openAs, waitForBoard } from "./fixtures/match";
import { countRequests } from "./helpers/net";
import { BoardPage } from "./pages/board";

// One student, one identity, several tabs — the R5 protocol.
//
// Two live boards for one player is not a cosmetic problem: both tabs POST
// moves with the same bearer pair, the server rejects the loser, and the student
// experiences it as "I can't place my mark". So exactly one tab is the board;
// the rest show "Spill her".
//
// The three things asserted here are the three ways that used to go wrong:
//
//   * a passive tab that keeps polling  → it must make ZERO /api/game/ calls;
//   * a passive tab you cannot get back → "Spill her" must take the board;
//   * a passive tab STRANDED forever    → when the senior goes away it must be
//     promoted by the `release` on pagehide, in seconds, not after the 30 s TTL.

const SETTLE = 1_500; // one VISIBLE_GRACE_MS, the slowest hop in the protocol

/** Open another tab on the SAME device — same context, same localStorage. */
async function openAnotherTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/play");
  return page;
}

test("only the newest tab is the board, and a released one hands it back", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Ada", black: "Bo" });
  const contexts: BrowserContext[] = [];
  try {
    const ctx = await browser.newContext();
    contexts.push(ctx);

    const first = await openAs(ctx, match.white);
    const firstBoard = new BoardPage(first);
    await expect(firstBoard.shell()).toBeVisible();

    // ---- a second tab opens: newest wins ----
    const second = await openAnotherTab(ctx);
    await waitForBoard(second);
    await expect(
      first.getByTestId("passive-tab"),
      "the older tab kept the board when a newer one claimed it",
    ).toBeVisible({ timeout: 10_000 });
    await expect(second.getByTestId("passive-tab")).toHaveCount(0);

    // ---- and it goes quiet: no polling from a tab that is not the board ----
    const polls = countRequests(first, "/api/game/");
    try {
      // Seven seconds is more than two 3 s poll cycles: an unguarded poll would
      // have fired at least twice. No move is played during the window, so a
      // broadcast-driven resync cannot muddy the count either.
      await first.waitForTimeout(7_000);
      expect(
        polls.count(),
        `the passive tab polled the game: ${polls.urls().join(", ")}`,
      ).toBe(0);
    } finally {
      polls.stop();
    }

    // ---- "Spill her" takes it back ----
    await first.getByRole("button", { name: no.player.otherTabResume }).click();
    await waitForBoard(first);
    await expect(
      second.getByTestId("passive-tab"),
      "claiming the board on one tab did not demote the other",
    ).toBeVisible({ timeout: 10_000 });

    // ---- closing a PASSIVE tab changes nothing ----
    await second.close();
    await first.waitForTimeout(SETTLE);
    await expect(firstBoard.shell()).toBeVisible();
    await expect(first.getByTestId("passive-tab")).toHaveCount(0);

    // ---- a third tab takes over, then goes away: the survivor is promoted ----
    const third = await openAnotherTab(ctx);
    await waitForBoard(third);
    await expect(first.getByTestId("passive-tab")).toBeVisible({ timeout: 10_000 });

    // `pagehide` is dispatched explicitly rather than relying on `page.close()`:
    // Playwright closes a Chromium target without guaranteeing that the page's
    // own lifecycle events are delivered first, and a spec that sometimes tests
    // the release path and sometimes tests the 30 s TTL is worse than one that
    // says which it is testing. The handler under test is the app's own
    // (useActiveTab's `release` on pagehide) — only the trigger is synthetic.
    await third.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await third.close();

    // Budget: the promotion is a BroadcastChannel round trip, so ~3 s is
    // generous — and it is far under TTL_MS (30 s) + TICK_MS (5 s), which is
    // what a lost `release` would cost. Failing here means the release was lost.
    await expect(
      firstBoard.shell(),
      "the surviving tab was left passive after the senior went away",
    ).toBeVisible({ timeout: 3_000 });
    await expect(first.getByTestId("passive-tab")).toHaveCount(0);

    // …and it is a working board again, not just a mounted one.
    await firstBoard.clickCell(0);
    await expect.poll(() => firstBoard.markAt(0), { timeout: 10_000 }).toBe("x");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
