import { defineConfig, devices } from "@playwright/test";

// The BROWSER tier. Deliberately separate from `npm run check` (lint +
// typecheck + vitest), which stays node-only and fast.
//
// ## What is under test
//
// The PRODUCTION build. By default it is served by `next start` — not
// `next dev`: testing the dev server would leave the shipped bundle (inlined
// NODE_ENV, minified chunks, real code-splitting) with no coverage at all.
//
// `E2E_SERVER=worker` swaps that server for the OpenNext bundle running under
// workerd (`wrangler dev`, see `npm run e2e:server:worker` and
// wrangler.e2e.jsonc). That is the SHIPPED runtime, and three things exist only
// there: `after()` backed by `ctx.waitUntil` (lib/server/defer.ts — the whole
// R8 respond-first mechanism), the `staticAssetsIncrementalCache` interception
// configured in open-next.config.ts, and `nodejs_compat` semantics under the
// pinned compatibility date. Under `next start` all three are Node's own
// behaviour instead, so a break in any of them is invisible until deploy.
//
// Either server is started with `E2E_SEAM=1` so `/api/dev/quickmatch` can mint
// two players and a live game in one call (see that route's comment: the
// variable must NEVER be set on the DEPLOYED Worker).
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

// WebKit is opt-in: it is the engine iPhone Safari actually runs, but the
// browser download costs minutes, so a bare `npm run e2e` must not pay for it.
//
// Two ways in, and the second is why this reads argv at all:
//
//   * `E2E_WEBKIT=1 npm run e2e` — the local switch, unchanged.
//   * `npx playwright test --project=mobile-webkit` — ASKING for the project by
//     name is consent enough. Without this, `--project=mobile-webkit` matched a
//     project that the config had not defined, and Playwright's answer to that
//     is `Error: Project(s) "mobile-webkit" not found` — i.e. the nightly
//     WebKit lane could not be expressed as a project list at all, and every
//     caller would have had to remember the env var as well.
//
// Only an EXPLICIT `--project` counts. A default run (no `--project` at all)
// still gets the two Chromium projects and nothing else.
//
// ⚠️ THE ARGV SNIFF MUST PUBLISH ITSELF INTO process.env, and that line is the
// load-bearing one. This config is re-loaded from scratch in EVERY worker
// process, and a worker is `child_process.fork`ed with no arguments of its own
// (playwright/lib/runner/index.js: `fork(entryScript, { env: {...process.env} })`).
// So a worker's `process.argv` carries no `--project`, the sniff below comes up
// empty there, the project list it builds is one shorter than the one the main
// process planned — and every WebKit test dies on
//   `Error: Project "mobile-webkit" not found in the worker process.`
// A config decision derived from argv only survives the fork if it is turned
// into an environment variable first: `env` is inherited, argv is not.
const argv = process.argv.slice(2);
const explicitProjects = new Set<string>();
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--project" && argv[i + 1]) explicitProjects.add(argv[i + 1]);
  else if (arg.startsWith("--project=")) explicitProjects.add(arg.slice(10));
}
if (explicitProjects.has("mobile-webkit")) process.env.E2E_WEBKIT = "1";

const WEBKIT = process.env.E2E_WEBKIT === "1";

const mobileWebkit = WEBKIT
  ? [{ name: "mobile-webkit", use: { ...devices["iPhone 13"] } }]
  : [];

// Which server the suite is pointed at. `worker` means the OpenNext bundle under
// workerd; anything else (including unset) means `next start`. Both listen on
// :3000 and both answer /api/health, so nothing below this line has to know.
const WORKER = process.env.E2E_SERVER === "worker";

export default defineConfig({
  testDir: "e2e",

  // Generous: a spec that waits out the 11 s watchdog plus a poll cycle is a
  // legitimate assertion here, not a hang.
  timeout: 90_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Two CI workers is the ceiling that still keeps file-level isolation cheap —
  // except on the worker lane, which is served by `wrangler dev`: a
  // single-process LOCAL DEV server, not the edge. Two spec files in parallel is
  // four browser contexts against it, and this lane is about runtime semantics,
  // not about how much load a dev server takes.
  workers: WORKER ? 1 : process.env.CI ? 2 : 1,
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
    command: WORKER ? "npm run e2e:server:worker" : "npm run e2e:server",
    // /api/health is `force-dynamic` and dependency-free on the bare probe (only
    // `?db=1` touches Supabase), so it answers as soon as the server is really
    // serving — a plain "/" would go green on a static shell that cannot yet run
    // a route handler.
    // Under the worker lane it proves more: a route handler answering here means
    // the OpenNext bundle booted inside workerd, not just that assets are served.
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    // `next start` on a cold production build plus first-request compile. The
    // worker lane's command builds first (`next build` + the OpenNext bundling
    // pass + the cache-population copy), so it needs several minutes before
    // anything is listening at all.
    timeout: WORKER ? 600_000 : 180_000,
    // The worker lane's stdout carries the build it is doing during that silence,
    // and wrangler's boot errors; on the `next start` lane it is noise.
    stdout: WORKER ? "pipe" : "ignore",
    stderr: "pipe",
  },
});
