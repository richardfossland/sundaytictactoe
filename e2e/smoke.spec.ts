import { expect, test, type BrowserContext } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { createMatch, openAs } from "./fixtures/match";
import { BoardPage } from "./pages/board";

// The one journey everything else rests on: two students, two devices, one
// board — and a mark placed on one of them showing up on the other.
//
// Nothing is stubbed. The move goes through /api/move, the server applies it,
// and the opponent learns about it either from the Realtime broadcast or from
// GameView's 3 s poll backstop when that broadcast is lost. The 10 s budget
// below is deliberately larger than one poll cycle and smaller than the 11 s
// pending watchdog: it passes on the broadcast, it still passes on the poll,
// and it fails if the only thing that could have healed it was the watchdog.
//
// Runs on desktop-chromium AND mobile-chromium: the whole point of this app is
// a teacher's laptop and a pile of borrowed phones.

const PROPAGATION = 10_000;

test("two students play the opening moves and each sees the other's", async ({
  browser,
  request,
}) => {
  const match = await createMatch(request, { white: "Ada", black: "Bo" });

  // One context per student: separate localStorage, separate cookie jar,
  // separate `ttt:player`. Sharing a context would trip GameView's passive-tab
  // takeover — two boards for one identity is exactly what that guard exists
  // to stop.
  const contexts: BrowserContext[] = [];
  try {
    const xCtx = await browser.newContext();
    const oCtx = await browser.newContext();
    contexts.push(xCtx, oCtx);

    // Server-side "white" is the ✕ side and moves first.
    const [xPage, oPage] = await Promise.all([
      openAs(xCtx, match.white),
      openAs(oCtx, match.black),
    ]);
    const x = new BoardPage(xPage);
    const o = new BoardPage(oPage);

    // Both boards start empty, and the quickmatch seam posts DEFAULT_CONFIG, so
    // both are the classic 3×3.
    expect(await x.marks()).toEqual(Array(9).fill(null));
    expect(await o.marks()).toEqual(Array(9).fill(null));
    // ✕ moves first, so the banners must disagree from the very first paint.
    await expect(x.turnBanner()).toContainText(no.player.yourTurn);
    await expect(o.turnBanner()).not.toContainText(no.player.yourTurn);

    // ---- 1. ✕ takes the top-left corner (the tap path a school iPad uses) ----
    await x.clickCell(0);
    await expect.poll(() => x.markAt(0), { timeout: PROPAGATION }).toBe("x");

    // …and it reaches the other device.
    await expect.poll(() => o.markAt(0), { timeout: PROPAGATION }).toBe("x");
    await expect(o.turnBanner()).toContainText(no.player.yourTurn);

    // ---- 2. ◯ answers in the centre, and ✕ sees it ----
    await o.clickCell(4);
    await expect.poll(() => o.markAt(4), { timeout: PROPAGATION }).toBe("o");
    await expect.poll(() => x.markAt(4), { timeout: PROPAGATION }).toBe("o");
    await expect(x.turnBanner()).toContainText(no.player.yourTurn);

    // Nothing else moved: two marks placed, seven cells still empty, on BOTH
    // devices. A board that healed by re-fetching a different game would fail
    // here even though the two assertions above passed.
    const expected = ["x", null, null, null, "o", null, null, null, null];
    expect(await x.marks()).toEqual(expected);
    expect(await o.marks()).toEqual(expected);

    // Both notation panels agree on the game that was actually played. TTT's
    // notation is the cell index (lib/ttt/validateMove.ts), so 0 then 4.
    await expect.poll(() => x.moves(), { timeout: PROPAGATION }).toEqual(["0", "4"]);
    await expect.poll(() => o.moves(), { timeout: PROPAGATION }).toEqual(["0", "4"]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
