import { expect, type Locator, type Page } from "@playwright/test";

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
}
