import { expect, type Locator, type Page } from "@playwright/test";

import { no } from "@/lib/locale/no";

// The player's board, addressed the way the DOM actually exposes it.
//
// MnkBoard (lib/client/MnkBoard.tsx) renders a `role="grid"` of
// `<button class="mnk-cell">`, one per cell, each carrying `data-cell="<index>"`
// and `data-mark="x" | "o" | ""`. Those two attributes are the whole contract
// this page object needs — no class names, no aria-label copy, nothing that a
// restyle or a wording pass would move. (The aria-labels are Norwegian prose —
// "Tom rute 5" — and are exactly the kind of thing that gets rewritten.)

/** Cell index, 0-based, row-major: 0..(m*n-1). 3×3 board ⇒ 0..8. */
export type Cell = number;

/** A cell's contents as MnkBoard writes it. `null` for an empty cell. */
export type Mark = "x" | "o";

export class BoardPage {
  constructor(readonly page: Page) {}

  /** The board's outer box — the element every geometry assertion measures. */
  shell(): Locator {
    return this.page.getByTestId("board-shell");
  }

  cell(i: Cell): Locator {
    // Scoped to the board: the host grid and the bracket render their own
    // MnkBoards, and an unscoped `[data-cell]` would match those too.
    return this.shell().locator(`[data-cell="${i}"]`);
  }

  /**
   * Play a cell by CLICK — the only input path a TTT board has (there is no
   * drag equivalent of a chess move), and the tap a student on a school iPad
   * actually makes. GameView's `onCell` → `tryMove` runs from here.
   */
  async clickCell(i: Cell): Promise<void> {
    await this.cell(i).click();
  }

  /** The mark standing on cell `i`, or null when the cell is empty. */
  async markAt(i: Cell): Promise<Mark | null> {
    const value = await this.cell(i).getAttribute("data-mark");
    // MnkBoard writes `data-mark=""` for an empty cell — present, but empty.
    // A missing attribute means the cell is not there at all, which is a
    // different failure and is left to the caller's own assertion.
    return value === "x" || value === "o" ? value : null;
  }

  /**
   * Record every value `data-mark` takes on cell `i` from now on, in order.
   *
   * `markAt()` SAMPLES; this WATCHES, and the difference matters exactly once:
   * a move made into a dead network is rendered optimistically and taken back
   * again within a few milliseconds — `fetch` rejects with
   * ERR_INTERNET_DISCONNECTED long before the 3 s poll, let alone before
   * Playwright can round-trip a query — so `expect.poll(markAt)` is a coin
   * flip there. (Proved: it passed one CI run and failed the next, on both
   * projects.) A MutationObserver installed BEFORE the click sees the whole
   * sequence, so "rendered, then rolled back" becomes assertable rather than
   * lucky. MnkBoard gives each cell a stable `key={i}`, so React MUTATES the
   * attribute on the same node instead of replacing it — which is what makes
   * an attribute observer the right instrument.
   *
   * Returns a reader; the array keeps growing behind it, so read it before the
   * next move rather than at the end of the test. Consecutive duplicates are
   * collapsed: a re-render that writes the same value is not an event.
   */
  async watchMark(i: Cell): Promise<() => Promise<string[]>> {
    const handle = await this.cell(i).evaluateHandle((el) => {
      const seen: string[] = [el.getAttribute("data-mark") ?? ""];
      new MutationObserver(() => {
        const value = el.getAttribute("data-mark") ?? "";
        if (value !== seen[seen.length - 1]) seen.push(value);
      }).observe(el, { attributes: true, attributeFilter: ["data-mark"] });
      return seen;
    });
    return () => handle.jsonValue();
  }

  /** All cells' marks, board order — handy for a whole-position assertion. */
  async marks(): Promise<(Mark | null)[]> {
    const values = await this.shell()
      .locator("[data-cell]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-mark")));
    return values.map((v) => (v === "x" || v === "o" ? v : null));
  }

  /** The single fixed banner slot: your turn / opponent's turn. */
  turnBanner(): Locator {
    return this.page.getByTestId("turn-banner");
  }

  /** The transient error toast (2.2 s in GameView — read it promptly). */
  toast(): Locator {
    return this.page.getByTestId("toast");
  }

  /** Move-list panel. TTT notation is the cell index, so its entries read
   *  "0", "4", … — see lib/ttt/validateMove.ts (`san = String(cell)`). */
  moveList(): Locator {
    return this.page.getByTestId("movelist");
  }

  /** The played half-moves, in order, as the panel shows them. */
  async moves(): Promise<string[]> {
    const texts = await this.moveList().locator(".movelist-san").allTextContents();
    return texts.map((t) => t.trim()).filter(Boolean);
  }

  /** End-of-game card. */
  resultCard(): Locator {
    return this.page.getByTestId("result-card");
  }

  /** The board's bounding box — for "does it fit / did it jump" assertions. */
  async boardBox(): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await this.shell().boundingBox();
    expect(box, "board-shell has no bounding box").toBeTruthy();
    return box!;
  }

  /** Current vertical scroll offset. The board must never push the page down. */
  scrollY(): Promise<number> {
    return this.page.evaluate(() => window.scrollY);
  }

  /**
   * Height of the slot that RESERVES the turn banner's line (`.turn-slot`,
   * min-height 57px in globals.css).
   *
   * Addressed as `turn-banner`'s parent rather than by class name: the testid is
   * the stable hook, and the slot is only ever the element wrapping it. At game
   * end the banner is hidden with `visibility` and never unmounted (L2), so this
   * number must be the same before and after the winning move — a slot that
   * collapses to 0 is exactly the shift the reservation exists to prevent.
   */
  turnSlotHeight(): Promise<number> {
    // Measured in the page rather than with `boundingBox()`: at game end the
    // slot carries `visibility: hidden`, and an API that treats invisible as
    // boxless would report the very collapse this assertion exists to deny.
    return this.turnBanner()
      .locator("xpath=..")
      .evaluate((el) => el.getBoundingClientRect().height);
  }

  /**
   * Is the move list scrolled to its OWN bottom, i.e. is the latest move
   * actually on screen?
   *
   * The 1 px slack absorbs sub-pixel scroll heights. An empty or non-overflowing
   * list is trivially pinned (scrollTop 0, clientHeight === scrollHeight), which
   * is correct: the last row is visible either way. On a 3×3 board that is in
   * fact the only case — nine plies are five rows and `.movelist` is a fixed
   * 132 px, so it never overflows — which is precisely why the layout spec
   * asserts `scrollY` alongside this and not instead of it: on this app the
   * page-level half is the one that catches a `scrollIntoView` regression.
   */
  movelistPinned(): Promise<boolean> {
    return this.moveList().evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    );
  }

  /** The resign button — `disabled` exactly while an optimistic move is pending
   *  (GameView: `disabled={pending || acting || ended}`), which makes it the one
   *  honest read-out of the pending lock from outside the component. */
  resignButton(): Locator {
    return this.page.getByRole("button", { name: no.player.resign, exact: true });
  }
}
