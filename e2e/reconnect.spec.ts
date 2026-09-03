import { expect, test, type BrowserContext } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { createMatch, openAs } from "./fixtures/match";
import { readIdentity } from "./helpers/identity";
import { BoardPage } from "./pages/board";

// A phone that loses the network in the middle of a game.
//
// The two failures this locks down are the ones a student actually notices:
//
//   1. The board VANISHES. A failed background poll must never take the game
//      away — no join screen, no "noe gikk galt", no lost resume code. The board
//      simply goes stale, and catches up on its own when the network returns.
//   2. The board FREEZES. An optimistic move whose POST never lands must roll
//      back and release the `pending` lock, so the next tap is accepted. The
//      absolute ceiling on that lock is PENDING_CEILING_MS (11 s, GameView), and
//      a dropped connection should be far quicker than the ceiling — but never
//      slower.
//
// Nothing here shortens a shipped timing: `context.setOffline` is the network
// going away, and every budget below is derived from the app's own constants
// (8 s fetch deadline, 3 s poll, 11 s pending ceiling).

/** Both of these wait on shipped timeouts rather than on the app being quick. */
test.describe.configure({ mode: "serial" });

test("the network drops, the board stays, and it catches up by itself", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Ada", black: "Bo" });
  const contexts: BrowserContext[] = [];
  try {
    const xCtx = await browser.newContext();
    const oCtx = await browser.newContext();
    contexts.push(xCtx, oCtx);

    const [xPage, oPage] = await Promise.all([
      openAs(xCtx, match.white),
      openAs(oCtx, match.black),
    ]);
    const x = new BoardPage(xPage);
    const o = new BoardPage(oPage);

    // A normal first move, so both devices are demonstrably in sync before the
    // network is taken away.
    await x.clickCell(0);
    await expect.poll(() => o.markAt(0), { timeout: 10_000 }).toBe("x");

    // ---- ✕ goes offline; ◯ plays on ----
    await xCtx.setOffline(true);
    await o.clickCell(4);
    await expect.poll(() => o.markAt(4), { timeout: 10_000 }).toBe("o");

    // For four seconds — more than one 3 s poll cycle, so `safeLoad` has
    // certainly failed at least once — ✕ keeps the position it had and keeps
    // the screen it was on.
    for (let i = 0; i < 4; i++) {
      await xPage.waitForTimeout(1000);
      expect(await x.markAt(4), "✕ saw a move it could not have received").toBeNull();
      expect(await x.markAt(0), "✕ lost its own last move").toBe("x");
      await expect(xPage.getByTestId("join-screen")).toHaveCount(0);
      await expect(xPage.getByTestId("load-error")).toHaveCount(0);
      await expect(x.shell()).toBeVisible();
    }

    // The badge is the honest signal that syncing is failing (R7) — the board
    // going quiet without saying so is the bug it replaced.
    await expect(xPage.getByText(no.player.reconnecting)).toBeVisible();

    // ---- and back ----
    await xCtx.setOffline(false);
    // Budget: the `online` listener resyncs immediately; if that event is lost,
    // the 3 s poll backstop still has three cycles inside twelve seconds.
    await expect
      .poll(() => x.markAt(4), {
        timeout: 12_000,
        message: "✕ never caught up after the network returned",
      })
      .toBe("o");
    await expect(xPage.getByText(no.player.reconnecting)).toHaveCount(0);

    // The blip cost the student nothing: same page, same identity.
    expect(new URL(xPage.url()).pathname).toBe("/play");
    const stored = await readIdentity(xPage);
    expect(stored?.playerId, "the resume identity was wiped by a network blip").toBe(
      match.white.playerId,
    );
    expect(stored?.resumeCode).toBe(match.white.resumeCode);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("a move posted into a dead network rolls back and releases the lock", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Cam", black: "Dee" });
  const contexts: BrowserContext[] = [];
  try {
    const xCtx = await browser.newContext();
    const oCtx = await browser.newContext();
    contexts.push(xCtx, oCtx);

    const [xPage, oPage] = await Promise.all([
      openAs(xCtx, match.white),
      openAs(oCtx, match.black),
    ]);
    const x = new BoardPage(xPage);
    const o = new BoardPage(oPage);

    await xCtx.setOffline(true);

    // WATCHED, not sampled. The optimistic render happens in the click handler,
    // before any network call resolves — but with the network gone the POST
    // rejects immediately, so the mark is placed and taken back inside a few
    // milliseconds. `expect.poll(markAt)` on that window is a coin flip; a
    // MutationObserver installed before the click records the whole sequence.
    // (`server-errors.spec.ts` asserts the optimistic render by sampling, and
    // can: there the route HANGS, so the mark stands for the full 8 s deadline.)
    const cell0 = await x.watchMark(0);

    await x.clickCell(0);

    // A word about why. 9 s is inside the 11 s pending ceiling on purpose: the
    // rollback must come from the failed POST (8 s deadline at the very worst),
    // never from the watchdog.
    await expect(x.toast(), "no toast explained the failed move").toBeVisible({
      timeout: 9_000,
    });
    await expect(x.toast()).toContainText(no.player.connection);

    // Placed, then taken back — both halves, in that order, and nothing else.
    await expect
      .poll(() => cell0(), {
        timeout: 9_000,
        message:
          "the move was never rendered optimistically, or was never rolled back",
      })
      .toEqual(["", "x", ""]);

    // `pending` is what would freeze the board, and the resign button is
    // `disabled={pending || …}` — so an enabled button IS a released lock.
    // Asserted inside the ceiling: released BECAUSE the POST settled.
    await expect(
      x.resignButton(),
      "the pending lock outlived PENDING_CEILING_MS",
    ).toBeEnabled({ timeout: 11_000 });

    // …and a SECOND tap is accepted rather than swallowed. `tryMove` returns
    // immediately while `pending` is set, so a swallowed tap would produce no
    // toast and no render at all. Both say the attempt was taken.
    await expect(x.toast(), "the 2.2 s toast never cleared").toHaveCount(0, {
      timeout: 6_000,
    });
    await x.clickCell(0);
    await expect(
      x.toast(),
      "a second move attempt was swallowed — the pending lock is still on",
    ).toBeVisible({ timeout: 9_000 });
    await expect
      .poll(() => cell0(), {
        timeout: 9_000,
        message: "the second tap never reached the board at all",
      })
      .toEqual(["", "x", "", "x", ""]);

    // ---- back online: the move goes through and both boards agree ----
    await xCtx.setOffline(false);
    await expect.poll(() => x.markAt(0), { timeout: 12_000 }).toBeNull();
    await x.clickCell(0);
    await expect.poll(() => x.markAt(0), { timeout: 12_000 }).toBe("x");
    await expect
      .poll(() => o.markAt(0), {
        timeout: 15_000,
        message: "the two devices never converged after the network returned",
      })
      .toBe("x");
    // Exactly ONE mark on the server's board: neither offline attempt left a
    // ghost move behind to be delivered late.
    expect(await o.marks()).toEqual(["x", null, null, null, null, null, null, null, null]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
