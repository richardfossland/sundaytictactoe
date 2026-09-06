# End-to-end tests (Playwright)

The browser tier. `npm run check` (lint + typecheck + vitest) stays node-only
and fast; this is where the rendered app, two real devices and the network in
between get their coverage.

Ported from SundayChess (`sundaychess#71` + `#74`) — same rig, same test-id
vocabulary, same workflow shape. The board is the only thing that differs: a
`role="grid"` of `mnk-cell` buttons instead of react-chessboard's squares.

## What runs

Two axes: **which browser** (Playwright projects) and **which server** (the
thing under them).

### Browsers

`playwright.config.ts` defines three projects. Two run by default (CI's PR gate
and a plain `npm run e2e`); the third is opt-in:

| project            | engine   | viewport | why                                   | runs by default?    |
| ------------------ | -------- | -------- | -------------------------------------- | ------------------- |
| `desktop-chromium` | Chromium | 1440×900 | the teacher's laptop                   | yes                  |
| `mobile-chromium`  | Chromium | 390×844  | the borrowed phone (touch, iPhone 13)  | yes                  |
| `mobile-webkit`    | WebKit   | 390×844  | Safari-class engine on iOS             | no — see below       |

`mobile-webkit` is opt-in because the WebKit download costs minutes and a plain
`npm run e2e` must not pay for it. There are two ways in, and they are
equivalent:

* `E2E_WEBKIT=1 npm run e2e` — the local switch;
* `npx playwright test --project=mobile-webkit` — **asking for the project by
  name is consent enough.** Only an explicit `--project` counts; a default run
  still gets the two Chromium projects and nothing else.

The second exists because the nightly lane is expressed as a project list, and
without it `--project=mobile-webkit` would fail with `Project(s)
"mobile-webkit" not found` unless every caller also remembered the env var.

**What WebKit buys.** Chromium at 390×844 proves the *layout*; it does not prove
the *engine*, and the classroom's second device is an iPhone more often than
not. WebKit is where a `:has()` selector, an `Intl` difference, a flexbox
resolution or a missing web API actually diverges. Two of the app's client
features are simply absent there and that is fine — they are written as
progressive enhancement:

* `Notification` — `lib/client/NotifyToggle.tsx` renders nothing when the API is
  missing, and `lib/client/turnCue.ts`'s notification step is skipped;
* `navigator.vibrate` — the turn cue's haptic is a no-op on iOS Safari;
* `PerformanceObserver({ type: "layout-shift" })` — WebKit has no such entry
  type, so `e2e/helpers/cls.ts` swallows it and `__cls` stays 0. **CLS
  assertions are therefore vacuous on `mobile-webkit`** — assert CLS on
  Chromium, which is where `layout-stability.spec.ts` really lands.

`BroadcastChannel` (the R5 one-tab-is-the-board protocol, `lib/client/activeTab.ts`)
*is* supported in WebKit, so `two-tabs.spec.ts` is a real test there.

**One spec file does not run on WebKit: `reconnect.spec.ts`.** Not an app
difference — a harness one. `context.setOffline(true)` is emulation, and the
engines emulate different amounts of "offline". Measured against a local
WebSocket server pushing a frame every 300 ms, with `setOffline(true)` at t=0:

| engine | `navigator.onLine` | `fetch` | frames still arriving after 2 s |
| ------ | ------------------ | ------- | -------------------------------- |
| Chromium | `false` | fails | **0** |
| WebKit | `false` | fails | **7** |

Chromium's CDP `Network.emulateNetworkConditions` severs sockets that are
already open; WebKit's `Network.setEmulateOfflineState` blocks new HTTP loads and
flips `navigator.onLine` but leaves an established WebSocket delivering. This
app's live updates arrive on exactly such a socket (Supabase Realtime, opened
when the board mounts), so on WebKit the opponent's move lands on a device the
test believes is offline. The premise cannot be established, so the file is
`test.skip`ped there with that reason — the assertions are not softened, because
a real iPhone losing its network has the OS tear the socket down and Chromium is
the faithful model of that. `lobby-rejoin.spec.ts` uses `setOffline` too and
*does* run on WebKit: it closes the page straight afterwards, which severs the
socket for real.

### Servers

| `E2E_SERVER` | webServer command       | what it is                                    |
| ------------ | ----------------------- | --------------------------------------------- |
| unset/`next` | `npm run e2e:server`    | the production build under `next start`        |
| `worker`     | `npm run e2e:server:worker` | the OpenNext bundle under `wrangler dev`   |

Both listen on `:3000` and both are waited on at `/api/health`, so no spec knows
which one it is talking to.

**What the worker lane buys.** `next start` is not what we deploy. Three things
exist only inside workerd, and until this lane none of them was ever executed by
a test:

1. **`after()` → `ctx.waitUntil`.** `lib/server/defer.ts` is the whole R8
   respond-first mechanism: the move route commits the position, returns, and
   only then broadcasts and recomputes scores. On Cloudflare that continuation is
   `ctx.waitUntil` via OpenNext's request-context provider. Under `next start`
   it is Node's own `after()`, a different implementation with different
   lifetime rules — a deferred task that workerd would drop keeps running there.
2. **`staticAssetsIncrementalCache` + `enableCacheInterception`**
   (`open-next.config.ts`). The prerendered shells (`/`, `/play`, `/solo`,
   `/versus`, `/arranger`, `/host/login`) are meant to be answered from the
   assets bundle *before* the Next server boots. `next start` serves them from
   `.next` by a completely different path, so a cache key that stopped
   matching — or an interception that started serving the wrong HTML — would be
   invisible.
3. **`nodejs_compat` under the pinned `compatibility_date`.** Every Node API the
   app or its dependencies reach for is polyfilled by the runtime, and the set
   changes with the compat date. The `build` job in `ci.yml` proves the Worker
   *bundles*; only this lane proves it *runs*.

The Worker's config for the lane is **`wrangler.e2e.jsonc`** — a copy of
`wrangler.jsonc` with three deliberate differences:

* no `routes` (the deployed config claims `tictactoe.sundaysuite.app`);
* no `global_fetch_strictly_public` — with it, every subrequest goes out over
  the public internet and the Worker could not reach the local Supabase on
  `127.0.0.1:54321`. Production keeps the flag; that is what stops a Worker from
  being used to probe private addresses;
* `observability` off, and a different `name` (`sundaytictactoe-e2e`) so a stray
  `wrangler deploy -c wrangler.e2e.jsonc` creates an unrouted Worker rather than
  overwriting the live one.

`compatibility_date` and `nodejs_compat` are **identical** to the deployed
values on purpose: a lane running under a different compat date would be testing
a runtime nobody ships.

Specs never shorten the app's timings. The shipped constants are an 8 s fetch
timeout (`lib/client/api.ts`), an 11 s pending watchdog and a 3 s game poll
(`app/play/GameView.tsx`) and a 5 s board poll (`lib/client/useBoardState.ts`);
assertions use `expect.poll` with budgets chosen against those numbers.

## The `E2E_SEAM` variable — read this before deploying anything

`POST /api/dev/quickmatch` mints a tournament, two players and a live game in
one unauthenticated call. It is 404 in a production build **unless**
`E2E_SEAM=1` is in the server process's environment.

Why a second variable at all: `process.env.NODE_ENV` is inlined by the compiler,
so a production bundle carries the literal and nothing at runtime can reopen the
seam. `E2E_SEAM` is an ordinary server env var — Next only inlines `NEXT_PUBLIC_*`
— so it is read per request. That is what lets the suite test the exact bundle we
ship instead of a special test build.

> ⚠️ **`E2E_SEAM` must never be set on the DEPLOYED Worker.** Not in
> `wrangler.jsonc` `vars`, not via `wrangler secret put`, not in the Cloudflare
> dashboard. With the seam open, anyone can create unlimited tournaments,
> players and games. It belongs only to the two e2e server scripts, which are
> local and CI.
>
> The worker lane does set it — on `wrangler dev`, and only from the **command
> line**: `npm run e2e:server:worker` passes `--var E2E_SEAM:1`. Nothing on disk
> carries it. `wrangler.e2e.jsonc` has no `vars` block at all, and the CI job's
> `.dev.vars` holds Supabase values only, so there is no committed file whose
> contents could follow the seam into a deploy.

The gate is `!== "1"`, so a half-set variable (`""`, `"0"`, `"true"`) fails
**closed**. `test/quickmatchGate.test.ts` pins that, and runs in `npm run check`.

## Local recipe

Needs Docker (for local Supabase) and the Playwright browsers.

```bash
# 0. one-off
npm ci
npm run e2e:install                       # chromium + its OS deps

# 1. local database — NEVER production credentials
supabase start -x studio,inbucket,imgproxy,edge-runtime,vector,analytics,storage,functions
supabase db reset                         # applies supabase/migrations/*

# 2. point the app at it (values are local-only, printed by the CLI)
eval "$(supabase status -o env |
  sed -e 's/^API_URL=/NEXT_PUBLIC_SUPABASE_URL=/' \
      -e 's/^ANON_KEY=/NEXT_PUBLIC_SUPABASE_ANON_KEY=/' \
      -e 's/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/' |
  sed 's/^/export /')"

# 3. build once, then run the suite (Playwright starts `next start` itself)
npm run e2e:build
npm run e2e
```

This app's tables live in the **`tictactoe` schema**, not `public`. The
migrations are schema-qualified and `supabase/config.toml` already lists
`tictactoe` under `[api] schemas` / `extra_search_path`, so a plain local start
exposes them through PostgREST with nothing to grant by hand.

CI pins the CLI at **2.101.0** (`supabase/setup-cli@v3`, `version:` input). Both
`supabase start`'s service names and the key names in `status -o env` are
CLI-version surface, so bump that pin and this recipe together. (`v3` installs
the CLI from npm and only needs an existing Node 20+ on `PATH` — the workflow's
own `setup-node` step provides that — rather than declaring its own action
runtime the way `v1`'s `runs: using: node20` did, which is what GitHub warned
about. `version:` still takes a fixed CLI release published to npm, so the pin
above carried over unchanged.)

`supabase start`'s `-x` names come from `supabase start --help`; the full set is
`analytics, db, edge-runtime, functions, imgproxy, inbucket, kong, meta,
realtime, rest, storage, studio, vector`. The app needs `db`, `kong`, `rest` and
`realtime` — everything else above is excluded only to start faster. Plain
`supabase start` works too.

`NEXT_PUBLIC_*` values are **inlined at build time**, so step 2 must come before
step 3. Rebuild after repointing at a different database.

Useful variations:

```bash
npm run e2e -- --project=desktop-chromium     # one project
npm run e2e -- --repeat-each=3                # flake hunt
npm run e2e -- --headed --debug               # watch it
E2E_WEBKIT=1 npm run e2e                      # add iPhone Safari's engine
npm run e2e -- --project=mobile-webkit        # …or just ask for it by name
npx playwright test --list                    # config sanity, no browser needed
npx playwright show-report                    # after a failure
```

WebKit needs its own binary once: `npm run e2e:install:webkit`.

### The worker lane, locally

Same Docker/Supabase prerequisites as above, plus one extra file: workerd does
not inherit the shell's environment the way `next start` does, so the server
half of the config has to be handed to wrangler explicitly. `.dev.vars` is what
wrangler reads for that; it is gitignored.

```bash
# steps 0-2 exactly as above (npm ci, supabase start, export the NEXT_PUBLIC_*
# and SUPABASE_SERVICE_ROLE_KEY values) — the NEXT_PUBLIC_* pair is still
# inlined at build time, so it must be exported before the build below.

# 3. the same values again, this time for the Worker's runtime
cat > .dev.vars <<EOF
NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_BASE_URL=http://localhost:3000
EOF

# 4. run it. No `e2e:build` first: `e2e:server:worker` does its own `next build`
#    (the OpenNext build patches the Next config to `output: standalone`, so it
#    needs to drive that build itself).
E2E_SERVER=worker npm run e2e -- --project=desktop-chromium
```

Playwright starts the server itself, as always — here that means
`npm run e2e:server:worker`, i.e.

```
opennextjs-cloudflare build   -c wrangler.e2e.jsonc
opennextjs-cloudflare preview -c wrangler.e2e.jsonc -- --port 3000 --var E2E_SEAM:1
```

`preview` is `wrangler dev` with one thing done first: it copies
`.open-next/cache/*` into `.open-next/assets/cdn-cgi/_next_cache/`. That copy is
what makes `staticAssetsIncrementalCache` real — `build` writes the cache
entries but does not place them where the assets binding can serve them, so a
bare `wrangler dev` would silently re-render every prerendered page and the lane
would not be testing the interception at all. Everything after `--` is passed
through to `wrangler dev` verbatim.

Because the whole build happens inside Playwright's `webServer`, the config
allows it 10 minutes to come up (vs 3 for `next start`) and pipes its stdout —
the several silent minutes before anything listens on `:3000` are the build.

To poke at it by hand instead, run the two commands above yourself and leave the
server up: `reuseExistingServer` is on locally, so a subsequent
`E2E_SERVER=worker npm run e2e` adopts it.

`reuseExistingServer` is on locally: a `next start` already listening on :3000 is
adopted. If you changed app code, rerun `npm run e2e:build` — otherwise the suite
happily tests the previous build.

## In CI

The suite runs on a GitHub runner, against a **real local Supabase** started by
the CLI on that same runner — no hosted project, no shared database, nothing that
outlives the job.

| when | workflow → job | projects | server | job |
| ---- | -------------- | -------- | ------ | --- |
| every PR + push to `main` | `ci.yml` → `e2e` | `desktop-chromium` | `next start` | `needs: check` |
| 03:00 UTC nightly (+ manual) | `nightly.yml` → `e2e` | `desktop-chromium`, `mobile-chromium`, `mobile-webkit` | `next start` | — |
| 03:00 UTC nightly (+ manual) | `nightly.yml` → `e2e-worker` | `desktop-chromium` | `wrangler dev` | — |

All three call the same reusable workflow, `.github/workflows/e2e.yml`, with
different `projects` / `server` inputs. One file, so a service name or an env
mapping cannot drift between the PR gate and the nightly lanes.

**The PR gate is deliberately unchanged.** WebKit's binary and the OpenNext
bundling pass are both minutes, and neither failure mode is one a single PR
usually introduces. They are nightly, where a red run is investigated rather
than rerun.

Three things in `e2e.yml` are driven by those inputs:

* **the browser download.** The set is derived from the project list (a list
  containing `mobile-webkit` installs `chromium webkit`, otherwise `chromium`)
  rather than passed as its own input, so the two can never disagree. The
  Playwright cache key carries the browser set as well as the version — a
  chromium-only cache must not satisfy a run that also needs WebKit.
* **the build step.** Skipped entirely for the worker lane: `e2e:server:worker`
  runs `opennextjs-cloudflare build`, which runs `next build` itself, and doing
  it twice is a second full compile for nothing.
* **`.dev.vars`.** Written for the worker lane only, from the same
  `supabase status -o env` values the `next start` lane gets through
  `$GITHUB_ENV`. workerd sees only what wrangler is told about; OpenNext's init
  template copies the Worker's `env` into `process.env` on the first request,
  which is how `createServiceClient()` finds the service-role key at all.

Artifact names carry the server (`playwright-report-next-…` /
`playwright-report-worker-…`): the two nightly jobs share one run, and
`upload-artifact` fails outright on a duplicate name.

`needs: check` is deliberate: the browser job pays for a Supabase boot, a
production build and a browser download, and none of that is worth spending on a
branch whose `npm run check` is already red.

What the job does, in order — the order is load-bearing:

1. `supabase start -x studio,inbucket,imgproxy,edge-runtime,analytics,vector,functions,storage`.
   First start applies `supabase/migrations/*` and then `supabase/seed.sql`
   (empty on purpose). `db`, `rest`, `realtime`, `kong` and `meta` stay up; the
   browser opens its Realtime socket straight at `127.0.0.1:54321`, because the
   browser and the database are on the same runner.
2. `supabase status -o env` → `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `$GITHUB_ENV`.
   **Before the build**, because `NEXT_PUBLIC_*` are inlined at compile time — a
   build that ran first would ship a bundle pointing at nothing.
3. `npm run e2e:build`, then `npx playwright test --project=…`. Playwright's
   `webServer` starts `npm run e2e:server` itself, so `E2E_SEAM=1` is carried by
   that script and never by the workflow. `reuseExistingServer` is `!CI`, so CI
   always gets a fresh `next start`.

The Playwright browsers are cached on the resolved `@playwright/test` version —
binaries and library are an unsupported pair when they disagree, so a version
bump misses the cache by design. The OS packages (`install-deps`) are reinstalled
every run: they live in the runner image, not in the cache.

`uptime.yml` is untouched by any of this: it probes the deployed hostname from
outside and has nothing to do with the local-Supabase lane.

### Report artefact on every run

The job uploads the HTML report — `playwright-report-<run id>-<attempt>` — on
**every** run, pass or fail (`if: always()`, 7-day retention). Before this, a
green nightly left nothing to diff a suspected regression against; now there is
always a report to compare, even when nothing failed. `test-results/` (the
traces, videos and screenshots) uploads as `playwright-results-<run
id>-<attempt>` on failure only, since `trace`, `video` and `screenshot` are all
`retain-on-failure` and the directory is empty on a green run regardless.
Download either, unzip, and:

```bash
npx playwright show-report path/to/playwright-report   # report + embedded traces (failure only)
npx playwright show-trace path/to/test-results/**/trace.zip
```

A failing step also dumps `supabase status` and the last 120 lines of every
`supabase_*` container — Realtime refusing a join, or PostgREST rejecting the
service key, appears there and nowhere in the Playwright output.

### Not covered yet

* **The Worker on Cloudflare's own network.** The worker lane runs the shipped
  bundle, but in `wrangler dev`'s local workerd. Placement, the real assets CDN,
  cold starts and the account's actual limits are still only exercised by a
  deploy.
* **Realtime through the Worker.** The move broadcasts go browser ↔ Supabase
  directly, so the worker lane says nothing new about them.
* **WebKit on desktop.** `mobile-webkit` is the iPhone viewport. Safari on a
  teacher's Mac is a different layout on the same engine, and nothing runs it.

## Layout

| file | what it holds in place |
| ---- | ---------------------- |
| `smoke.spec.ts` | two students, two contexts, ✕ then ◯ seen on both boards |
| `layout-stability.spec.ts` | **L1/L2.** Eight half-moves, alternating on two devices. After every one, on both: `scrollY` unchanged, `board-shell`'s box unchanged (±0.5 px), the *watching* device's CLS delta < 0.01, and the move list still showing its newest row. |
| `game-end.spec.ts` | **L2/L3.** ✕0 ◯3 ✕1 ◯4 ✕2 — a `result-card` on both devices with the board box, the page scroll and the reserved `.turn-slot` height all unmoved. |
| `reconnect.spec.ts` | **R7.** The network goes away mid-game (board stays, no `join-screen`, no `load-error`, resume code intact, catches up by itself) and mid-move (a dead POST rolls back with a toast, and the `pending` lock is released well inside `PENDING_CEILING_MS`). |
| `server-errors.spec.ts` | **R1/R3.** HTML with a status code is the edge talking, never our API. 503 on every `/api/game/*` poll keeps the board and heals within two poll cycles; a hung `/api/move` settles on the 8 s fetch deadline; 503 and 403 on `/api/resume` keep the session and offer `resume-retry`. Our own `{"error":"invalid_code"}` still ends it. |
| `two-tabs.spec.ts` | **R5.** Newest tab is the board; the passive one makes **zero** `/api/game/` calls in 7 s; «Spill her» takes it back; a senior that goes away hands over in ~3 s via `release`, not after the 30 s TTL. |
| `public-flow.spec.ts` | The only spec that never touches `E2E_SEAM`: create → two joins on the PIN → round start → play. |
| `lobby-rejoin.spec.ts` | **R4.** The ghost-sweep's gate (no `POST /api/lobby/kick` for 45 s — more than one sweep tick — with the host *fully armed*) and the way back (a removed student reloads and is readmitted automatically). |

```
e2e/
  fixtures/match.ts    createMatch (seam) · publicFlowMatch (public routes only)
                       · openAs (seed localStorage → /play → real resume path)
                       · waitForBoard (for tabs openAs did not open)
  pages/board.ts       BoardPage — clickCell/markAt/marks/moves/turnBanner ·
                       boardBox/scrollY/turnSlotHeight/movelistPinned/resignButton
                       · watchMark (records a cell's data-mark over time)
  helpers/cls.ts       layout-shift accumulator (installCls on a page OR context)
  helpers/identity.ts  seedPlayer / seedHostCode / readIdentity (`ttt:player`,
                       `ttt:host:<id>`)
  helpers/net.ts       countRequests (assert something did NOT happen) ·
                       blockRoute (canned reply + its undo) · hangRoute
```

`openAs` fakes no screens: it writes `ttt:player:<tournamentId>` (plus the
`ttt:player:last` pointer) via `addInitScript` and lets `/play` walk its real
path — `attemptResume` → `WaitingRoom` latches the live game → `GameView`
mounts — then waits for `board-shell` and a cell inside it.

`publicFlowMatch` reaches a live board **without** the seam, mirroring
`scripts/smoke-features.mjs`: it is the guard against the seam quietly drifting
away from the real join flow, and `public-flow.spec.ts` is the one spec that
takes it. **One tournament per spec run** — `/api/tournament` is rate-limited per
IP and in CI every spec shares the runner's address.

### Two conventions the specs rely on

**CLS is read on the WATCHING device only.** A shift within 500 ms of your own
tap carries `hadRecentInput`, and the Web Vitals definition excludes it. The move
you did *not* make has no such excuse — the incoming update is what used to shove
the board around.

**A state that only exists for milliseconds is WATCHED, not sampled.** An
optimistic move made into a dead network is rendered and rolled back before
`fetch` even reports the failure, so `expect.poll(markAt)` on that window is a
coin flip — it passed one CI run and failed the next, on both projects.
`BoardPage.watchMark` installs a MutationObserver before the click and records
the whole sequence (`["", "x", ""]`), which is a stronger claim than either
sample. Sampling stays correct where the state STANDS: `server-errors.spec.ts`
hangs the route, so the optimistic mark is there for the full 8 s deadline.

**Both halves of L1, always.** `MoveList` keeps the newest move in view by
setting its **own** `scrollTop`; the bug it replaced used `scrollIntoView()`,
which scrolls every scrollable ancestor including the document. On a 3×3 board
`.movelist` (a fixed 132 px) never actually overflows, so `movelistPinned()` is
trivially true here and `scrollY` is the half that bites — but the pair is what
the assertion is, because a 4×4/5×5 tournament flips which half does the work.

### Two departures from SundayChess's rig, kept on purpose

* **`page.route` cannot block a WebSocket.** Playwright routes HTTP; WebSocket
  frames need `routeWebSocket`. In `lobby-rejoin` the student's phone "goes away"
  the way it actually does — the context goes offline **and** the tab closes.
  Either half alone can leave the Realtime connection half-open, which the server
  only reaps on its own heartbeat timeout, well past a 60 s spec.
* **`pagehide` is dispatched explicitly** before `page.close()` in `two-tabs`.
  Playwright closes a Chromium target without guaranteeing the page's lifecycle
  events are delivered first, and a spec that sometimes tests the release path
  and sometimes tests the 30 s TTL is worse than one that says which it is
  testing. The handler under test is still the app's own.

## The board, addressed

`lib/client/MnkBoard.tsx` renders one `<button class="mnk-cell">` per cell inside
a `role="grid"`. Two attributes are the page object's whole contract:

* `data-cell="<index>"` — 0-based, row-major. Cell 0 is the top-left.
* `data-mark="x" | "o" | ""` — empty string for an empty cell.

Both are attributes and nothing else, so a restyle (class names) or a wording
pass (the `aria-label` is Norwegian prose — "Tom rute 5") cannot move them. The
cell COUNT is the tournament's variant — 9 / 16 / 25 for 3×3 / 4×4 / 5×5 — so no
helper hard-codes it; `openAs` waits for the first cell, not for a count.

Notation is the cell index: `lib/ttt/validateMove.ts` sets `san = String(cell)`,
so a game's move list reads `0 4 …` and `BoardPage.moves()` returns exactly that.

## Test ids

Stable hooks, kebab-case, added only where a spec needs one. The same names are
used by SundayChess, so keep them generic:

`board-shell` · `turn-banner` · `toast` · `result-card` · `passive-tab` ·
`load-error` · `join-screen` · `resume-retry` · `waiting-room` · `movelist` ·
`switch-player`

Prefer these over class names and copy: a restyle or a wording pass must not
break the suite.
