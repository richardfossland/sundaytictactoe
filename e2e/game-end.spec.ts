import { expect, test, type BrowserContext } from "@playwright/test";

import { createMatch, openAs } from "./fixtures/match";
import { BoardPage } from "./pages/board";

// The end of the game is the last place a board is allowed to jump.
//
// Everything that disappears when the game ends — the turn banner, the
// draw/resign row, the reaction bar, the notice slot — is hidden with
// `visibility` and never unmounted (L2/L3), and the result card is a
// `position: fixed` overlay (as is the winner's confetti canvas). So the
// winning move must change the page's geometry by exactly nothing: the board is
// in the same place, the reserved banner line is still the same height, and the
// page has not scrolled. That is what a student sees behind the blur, and if it
// lurches, the celebration is the first thing they distrust.
//
// The shortest way there is the top row: ✕0 ◯3 ✕1 ◯4 ✕2 — the same five plies
// scripts/smoke-features.mjs plays.

const PROPAGATION = 12_000;
const BOX_TOLERANCE = 0.5;

interface Geometry {
  scrollY: number;
  slotHeight: number;
  box: { x: number; y: number; width: number; height: number };
}

async function geometry(board: BoardPage): Promise<Geometry> {
  return {
    scrollY: await board.scrollY(),
    slotHeight: await board.turnSlotHeight(),
    box: await board.boardBox(),
  };
}

function assertUnchanged(after: Geometry, before: Geometry, who: string) {
  expect(after.scrollY, `${who}: the page scrolled when the game ended`).toBe(
    before.scrollY,
  );
  expect(
    Math.abs(after.slotHeight - before.slotHeight),
    `${who}: the reserved turn-banner slot changed height at game end (${before.slotHeight} → ${after.slotHeight})`,
  ).toBeLessThan(BOX_TOLERANCE);
  for (const side of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(after.box[side] - before.box[side]),
      `${who}: board-shell.${side} moved at game end (${before.box[side]} → ${after.box[side]})`,
    ).toBeLessThan(BOX_TOLERANCE);
  }
}

test("a win lands on both devices without moving the board", async ({
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

    await x.clickCell(0);
    await expect.poll(() => o.markAt(0), { timeout: PROPAGATION }).toBe("x");

    await o.clickCell(3);
    await expect.poll(() => x.markAt(3), { timeout: PROPAGATION }).toBe("o");

    await x.clickCell(1);
    await expect.poll(() => o.markAt(1), { timeout: PROPAGATION }).toBe("x");

    await o.clickCell(4);
    await expect.poll(() => x.markAt(4), { timeout: PROPAGATION }).toBe("o");

    // The snapshot the winning move is measured against — taken with the game
    // still live, on both devices.
    const before = { x: await geometry(x), o: await geometry(o) };

    // ---- ✕2 completes the top row ----
    await x.clickCell(2);

    await expect(x.resultCard(), "the winner never saw a result").toBeVisible({
      timeout: PROPAGATION,
    });
    await expect(
      o.resultCard(),
      "the loser never learned the game had ended",
    ).toBeVisible({ timeout: PROPAGATION });

    assertUnchanged(await geometry(x), before.x, "✕");
    assertUnchanged(await geometry(o), before.o, "◯");

    // The board itself is still there under the overlay, on the winning
    // position — including the third mark of the line that ended it.
    expect(await x.marks()).toEqual([
      "x",
      "x",
      "x",
      "o",
      "o",
      null,
      null,
      null,
      null,
    ]);
    // Polled on the loser's device: the overlay can arrive on a `result`
    // broadcast a beat before the position it belongs to.
    await expect.poll(() => o.markAt(2), { timeout: PROPAGATION }).toBe("x");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
