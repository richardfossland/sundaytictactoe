import type { Page } from "@playwright/test";

// Cumulative Layout Shift, measured in the page itself.
//
// A board that settles a beat late, a banner that appears and shoves everything
// down, a font that swaps — none of those fail a functional assertion, and all
// of them make a student tap the wrong square. CLS is the one number that
// catches them.
//
// The observer must be installed via `addInitScript` (i.e. BEFORE any app code
// runs) and created with `buffered: true`, so shifts that happen during the very
// first paint — the ones most likely to exist — are counted rather than missed
// while the observer was still being set up.

// Kept as a local cast rather than a `declare global` on Window: this file is
// part of the same TS program as the app, and a global augmentation would let
// application code reference `window.__cls` without an error.
type ClsWindow = Window & { __cls?: number };

/** Install the CLS accumulator. Call BEFORE `page.goto`. */
export async function installCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as ClsWindow;
    w.__cls = 0;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // `hadRecentInput` marks shifts within 500 ms of a real interaction —
          // opening a dialog, tapping a square. Those are the user's doing and
          // are excluded by the Web Vitals definition itself.
          const shift = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          };
          if (!shift.hadRecentInput) w.__cls = (w.__cls ?? 0) + shift.value;
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {
      // WebKit has no layout-shift entry type: __cls stays 0 and CLS assertions
      // are vacuous there rather than throwing. Assert CLS on Chromium.
    }
  });
}

/** Read the accumulated score. 0 when the engine reports no layout-shift. */
export async function readCls(page: Page): Promise<number> {
  return page.evaluate(() => (window as ClsWindow).__cls ?? 0);
}
