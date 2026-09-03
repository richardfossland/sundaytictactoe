import { expect, test, type BrowserContext } from "@playwright/test";

import { createMatch, openAs } from "./fixtures/match";
import { installCls, readCls } from "./helpers/cls";
import { BoardPage, type Mark } from "./pages/board";

// The spec the whole L-series exists for: a board that does not move.
//
// Eight half-moves of a real game, played alternately on two devices, with
// every single one of them followed by the same four questions on BOTH screens:
//
//   * did the page scroll?                    (window.scrollY)
//   * did the board move or resize?           (board-shell's box, ±0.5 px)
//   * did the opponent's move shift anything? (CLS delta < 0.01)
//   * is the latest move still visible?       (the move list is pinned)
//
// The CLS delta is read only on the WATCHING device, and that is the whole
// point: a shift within 500 ms of your own tap carries `hadRecentInput` and the
// Web Vitals definition excludes it. The move you did not make has no such
// excuse — it is the incoming update that used to shove the board around.
//
// The fourth question is what pins L1. The move list keeps the newest move in
// view by setting its OWN `scrollTop` (lib/client/MoveList.tsx). The bug it
// replaced used `scrollIntoView()`, which scrolls every scrollable ancestor —
// including the document — so the page crept downward under the student's
// fingers on every move. Assert both halves: the row is visible in the list AND
// the page did not scroll. On a 3×3 board `.movelist` (a fixed 132 px) never
// actually overflows, so here the page-level half is the one that bites — see
// `BoardPage.movelistPinned`.
//
// Runs on desktop-chromium AND mobile-chromium: at 390 px the page is taller
// than the viewport, which is precisely where a stray document scroll shows up.

/** One 3 s poll cycle plus room for the broadcast to lose and the poll to win. */
const PROPAGATION = 10_000;

/** Sub-pixel jitter in a fractional layout is not a layout shift. */
const BOX_TOLERANCE = 0.5;

/**
 * Eight plies on the classic 3×3 that DELIBERATELY never make a line.
 *
 * ✕ ends on {0,2,3,7} and ◯ on {1,4,5,6}; cell 8 is still empty, so the game is
 * live for the last assertion as much as for the first. (Checked against
 * lib/ttt/win.ts's eight lines: rows 012/345/678, columns 036/147/258 and
 * diagonals 048/246 — none is monochrome at any point in this sequence.) A
 * game that ended early would swap the board for a result overlay and make
 * every remaining assertion vacuous rather than red, which is the worse
 * failure.
 */
const GAME: { cell: number; mark: Mark; label: string }[] = [
  { cell: 0, mark: "x", label: "1. ✕0" },
  { cell: 1, mark: "o", label: "1… ◯1" },
  { cell: 2, mark: "x", label: "2. ✕2" },
  { cell: 4, mark: "o", label: "2… ◯4" },
  { cell: 3, mark: "x", label: "3. ✕3" },
  { cell: 5, mark: "o", label: "3… ◯5" },
  { cell: 7, mark: "x", label: "4. ✕7" },
  { cell: 6, mark: "o", label: "4… ◯6" },
];

interface Frame {
  scrollY: number;
  box: { x: number; y: number; width: number; height: number };
}

async function frame(board: BoardPage): Promise<Frame> {
  return { scrollY: await board.scrollY(), box: await board.boardBox() };
}

const sameBox = (a: Frame["box"], b: Frame["box"]) =>
  Math.abs(a.x - b.x) < BOX_TOLERANCE &&
  Math.abs(a.y - b.y) < BOX_TOLERANCE &&
  Math.abs(a.width - b.width) < BOX_TOLERANCE &&
  Math.abs(a.height - b.height) < BOX_TOLERANCE;

/**
 * The baseline, taken once the board has stopped settling.
 *
 * MOUNT is allowed to move things (a lazy chunk resolving, a font swapping);
 * this spec is about what happens once the game is underway, so it waits for two
 * identical reads before it starts holding the app to a number.
 */
async function settled(board: BoardPage): Promise<Frame> {
  let prev = await frame(board);
  for (let i = 0; i < 12; i++) {
    await board.page.waitForTimeout(250);
    const next = await frame(board);
    if (next.scrollY === prev.scrollY && sameBox(prev.box, next.box)) return next;
    prev = next;
  }
  throw new Error("board-shell never stopped moving before the first move");
}

function assertFrame(actual: Frame, baseline: Frame, who: string, when: string) {
  expect(actual.scrollY, `${who}: the page scrolled ${when}`).toBe(baseline.scrollY);
  expect(
    sameBox(actual.box, baseline.box),
    `${who}: board-shell moved ${when} — ${JSON.stringify(baseline.box)} → ${JSON.stringify(actual.box)}`,
  ).toBe(true);
}

test("eight half-moves and neither board moves a pixel", async ({
  browser,
  request,
}) => {
  // Eight moves × two propagation budgets sits close enough to the 90 s default
  // to be worth the headroom.
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Ada", black: "Bo" });

  const contexts: BrowserContext[] = [];
  try {
    const xCtx = await browser.newContext();
    const oCtx = await browser.newContext();
    contexts.push(xCtx, oCtx);

    // On the CONTEXT, not the page: `openAs` owns the newPage()/goto() pair, so
    // by the time a page object exists the first paint is already behind us.
    await installCls(xCtx);
    await installCls(oCtx);

    const [xPage, oPage] = await Promise.all([
      openAs(xCtx, match.white),
      openAs(oCtx, match.black),
    ]);
    const x = new BoardPage(xPage);
    const o = new BoardPage(oPage);

    const baseline = { x: await settled(x), o: await settled(o) };

    for (const [i, move] of GAME.entries()) {
      const xToMove = i % 2 === 0;
      const mover = xToMove ? x : o;
      const watcher = xToMove ? o : x;
      const moverName = xToMove ? "✕" : "◯";
      const watcherName = xToMove ? "◯" : "✕";

      // Read the watcher's CLS BEFORE the move: everything it accumulates from
      // here until the move has landed is the incoming update's doing.
      const clsBefore = await readCls(watcher.page);

      await mover.clickCell(move.cell);

      await expect
        .poll(() => mover.markAt(move.cell), {
          timeout: PROPAGATION,
          message: `${move.label} never appeared on the board that played it`,
        })
        .toBe(move.mark);
      await expect
        .poll(() => watcher.markAt(move.cell), {
          timeout: PROPAGATION,
          message: `${move.label} never reached the ${watcherName} device`,
        })
        .toBe(move.mark);

      const clsAfter = await readCls(watcher.page);
      expect(
        clsAfter - clsBefore,
        `${watcherName} saw layout shift while ${move.label} arrived`,
      ).toBeLessThan(0.01);

      assertFrame(await frame(x), baseline.x, "✕", `after ${move.label}`);
      assertFrame(await frame(o), baseline.o, "◯", `after ${move.label}`);

      // The newest move must be visible INSIDE the list — the half of L1 that a
      // page-level scroll assertion cannot see. Polled on the watcher because
      // its list is rebuilt when the update lands, not when the click happened.
      expect(
        await mover.movelistPinned(),
        `the move list on the ${moverName} device is not showing ${move.label}`,
      ).toBe(true);
      await expect
        .poll(() => watcher.movelistPinned(), {
          timeout: PROPAGATION,
          message: `the move list on the ${watcherName} device is not showing ${move.label}`,
        })
        .toBe(true);
    }

    // Both notation panels agree on the game that was actually played — TTT's
    // notation is the cell index (lib/ttt/validateMove.ts).
    const played = GAME.map((m) => String(m.cell));
    await expect.poll(() => x.moves(), { timeout: PROPAGATION }).toEqual(played);
    await expect.poll(() => o.moves(), { timeout: PROPAGATION }).toEqual(played);

    // …and the game really did stay live to the end: one empty cell, no result.
    await expect(x.resultCard()).toHaveCount(0);
    await expect(o.resultCard()).toHaveCount(0);
    expect(await x.markAt(8)).toBeNull();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
