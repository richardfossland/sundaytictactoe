import { defineConfig, devices } from "@playwright/test";

// The BROWSER tier. Deliberately separate from `npm run check` (lint +
// typecheck + vitest), which stays node-only and fast.
//
// ## What is under test
//
// The PRODUCTION build, served by `next start` — not `next dev`, and not
// wrangler. `npm run e2e:server` starts it with `E2E_SEAM=1` so
// `/api/dev/quickmatch` can mint two players and a live game in one call (see
// that route's comment: the variable must NEVER be set on the Worker).
// Testing the dev server would leave the shipped bundle — the one with inlined
// NODE_ENV, minified chunks and real code-splitting — with no coverage at all.
//
// ## No timing overrides
//
// The app's timings are shipped constants: an 8 s fetch timeout
// (lib/client/api.ts), an 11 s pending watchdog and a 3 s game poll
// (app/play/GameView.tsx), a 5 s board poll (lib/client/useBoardState.ts).
// Specs assert against THOSE numbers with explicit budgets rather than asking
// the app to hurry up — a suite that shortens the intervals it is meant to
// prove is testing a build nobody ships.
//
// ## Serial by default
//
// `fullyParallel: false` and one worker locally: every spec writes to the same
// Supabase instance, and the seam mints real rows. Two CI workers is the
// ceiling that still keeps file-level isolation cheap.

// WebKit is opt-in: it is the engine iPhone Safari actually runs, but installing
// it costs minutes on every CI run. `E2E_WEBKIT=1 npm run e2e` turns it on for
// the mobile-layout work that needs it.
const WEBKIT = process.env.E2E_WEBKIT === "1";

const mobileWebkit = WEBKIT
  ? [{ name: "mobile-webkit", use: { ...devices["iPhone 13"] } }]
  : [];

export default defineConfig({
  testDir: "e2e",

  // Generous: a spec that waits out the 11 s watchdog plus a poll cycle is a
  // legitimate assertion here, not a hang.
  timeout: 90_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 1 : 0,
  // CI also writes the HTML report: it is what the workflow uploads on failure,
  // and it is the only thing that turns the trace/video files in test-results/
  // into something you can open (`npx playwright show-report`). `open: "never"`
  // because a runner has no browser to open it in.
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The classroom's real second device. The iPhone 13 descriptor carries the
      // 390×844 viewport, deviceScaleFactor and hasTouch — `browserName` swaps
      // the engine for Chromium so the default run needs no WebKit download.
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    ...mobileWebkit,
  ],

  webServer: {
    command: "npm run e2e:server",
    // /api/health is `force-dynamic` and dependency-free on the bare probe (only
    // `?db=1` touches Supabase), so it answers as soon as the server is really
    // serving — a plain "/" would go green on a static shell that cannot yet run
    // a route handler.
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    // `next start` on a cold production build plus first-request compile.
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
