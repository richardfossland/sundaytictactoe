import { expect, test, type BrowserContext } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { openAs, publicFlowMatch } from "./fixtures/match";
import { BoardPage } from "./pages/board";

// The one spec that never touches the test seam.
//
// Every other file gets its board from /api/dev/quickmatch, which mints a
// tournament, two players and a live game in a single unauthenticated call. That
// shortcut is worth having and it is also the suite's biggest blind spot: if the
// real join flow drifted — a changed pairing rule, a join that no longer returns
// a resume code, a round that starts without a live game — the whole suite would
// still be green, because nothing in it walks that road.
//
// So this one does: POST /api/tournament, two POST /api/join on the PIN, POST
// /api/round/start, read the pairing back, and then play. Public routes only,
// exactly as scripts/smoke-features.mjs does it.
//
// ONE tournament per run, deliberately: /api/tournament is rate-limited per IP,
// and in CI every spec shares the runner's address.

test("a tournament created and joined through the public routes reaches a live board", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await publicFlowMatch(request, { white: "Ada", black: "Bo" });

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

    // The pairing decided who got ✕, not the join order; both boards must agree
    // about whose move it is from the very first paint.
    await expect(x.turnBanner()).toContainText(no.player.yourTurn);
    await expect(o.turnBanner()).not.toContainText(no.player.yourTurn);

    // ---- one move each way, on the real path ----
    await x.clickCell(0);
    await expect.poll(() => x.markAt(0), { timeout: 10_000 }).toBe("x");
    await expect
      .poll(() => o.markAt(0), {
        timeout: 10_000,
        message: "a move made on the public flow never reached the other device",
      })
      .toBe("x");
    await expect(o.turnBanner()).toContainText(no.player.yourTurn);

    await o.clickCell(4);
    await expect.poll(() => o.markAt(4), { timeout: 10_000 }).toBe("o");
    await expect.poll(() => x.markAt(4), { timeout: 10_000 }).toBe("o");
    await expect(x.turnBanner()).toContainText(no.player.yourTurn);

    // Both notation panels agree on the game that was actually played. TTT's
    // notation is the cell index (lib/ttt/validateMove.ts), so 0 then 4.
    await expect.poll(() => x.moves(), { timeout: 10_000 }).toEqual(["0", "4"]);
    await expect.poll(() => o.moves(), { timeout: 10_000 }).toEqual(["0", "4"]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
