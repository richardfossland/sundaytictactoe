# End-to-end tests (Playwright)

The browser tier. `npm run check` (lint + typecheck + vitest) stays node-only
and fast; this is where the rendered app, two real devices and the network in
between get their coverage.

Ported from SundayChess (`sundaychess#71` + `#74`) — same rig, same test-id
vocabulary, same workflow shape. The board is the only thing that differs: a
`role="grid"` of `mnk-cell` buttons instead of react-chessboard's squares.

## What runs

`playwright.config.ts` drives the **production build** through `next start` —
not `next dev`, and not wrangler. Two projects run by default:

| project            | engine   | viewport | why                                   |
| ------------------ | -------- | -------- | ------------------------------------- |
| `desktop-chromium` | Chromium | 1440×900 | the teacher's laptop                  |
| `mobile-chromium`  | Chromium | 390×844  | the borrowed phone (touch, iPhone 13) |
| `mobile-webkit`    | WebKit   | 390×844  | opt-in: `E2E_WEBKIT=1`                |

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

> ⚠️ **`E2E_SEAM` must never be set on the Worker.** Not in `wrangler.jsonc`
> `vars`, not via `wrangler secret put`, not in the Cloudflare dashboard. With
> the seam open, anyone can create unlimited tournaments, players and games.
> It belongs only to `npm run e2e:server`, which is local and CI.

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

CI pins the CLI at **2.101.0** (`supabase/setup-cli@v1`, `version:` input). Both
`supabase start`'s service names and the key names in `status -o env` are
CLI-version surface, so bump that pin and this recipe together. (`setup-cli@v1`
still targets Node 20 and GitHub forces it onto 24 with a warning; newer majors
resolve `version:` differently, so moving is a change of its own.)

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
npx playwright test --list                    # config sanity, no browser needed
npx playwright show-report                    # after a failure
```

`reuseExistingServer` is on locally: a `next start` already listening on :3000 is
adopted. If you changed app code, rerun `npm run e2e:build` — otherwise the suite
happily tests the previous build.

## In CI

The suite runs on a GitHub runner, against a **real local Supabase** started by
the CLI on that same runner — no hosted project, no shared database, nothing that
outlives the job.

| when | workflow | projects | job |
| ---- | -------- | -------- | --- |
| every PR + push to `main` | `ci.yml` → `e2e` | `desktop-chromium` | `needs: check` |
| 03:00 UTC nightly (+ manual) | `nightly.yml` → `e2e` | `desktop-chromium`, `mobile-chromium` | — |

Both call the same reusable workflow, `.github/workflows/e2e.yml`, with a
different `projects` input. One file, so a service name or an env mapping cannot
drift between the PR gate and the nightly.

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

### When it goes red

The job uploads `playwright-report/` and `test-results/` as
`playwright-<run id>-<attempt>` (7 days) on failure only. Download it, unzip, and:

```bash
npx playwright show-report path/to/playwright-report   # report + embedded traces
npx playwright show-trace path/to/test-results/**/trace.zip
```

`trace`, `video` and `screenshot` are all `retain-on-failure`, so a green run
uploads nothing and a red one carries the whole timeline.

A failing step also dumps `supabase status` and the last 120 lines of every
`supabase_*` container — Realtime refusing a join, or PostgREST rejecting the
service key, appears there and nowhere in the Playwright output.

### Not covered yet

The suite drives `next start`. The thing we actually deploy is the OpenNext
Worker, and the `build` job only proves it *bundles*. A second e2e lane against
`wrangler dev` (or a preview deploy) would close that gap — its own follow-up,
because it needs a different `webServer` and a Worker-shaped env, not just
another Playwright project.

## Layout

```
e2e/
  smoke.spec.ts        two students, two contexts, ✕ then ◯ seen on both boards
  fixtures/match.ts    createMatch (seam) · publicFlowMatch (public routes only)
                       · openAs (seed localStorage → /play → real resume path)
  pages/board.ts       BoardPage — clickCell/markAt/marks/turnBanner/boardBox
  helpers/cls.ts       layout-shift accumulator (installCls before goto)
```

`openAs` fakes no screens: it writes `ttt:player` via `addInitScript` and lets
`/play` walk its real path — `attemptResume` → `WaitingRoom` latches the live
game → `GameView` mounts — then waits for `board-shell` and a cell inside it.

`publicFlowMatch` exists so a spec can reach a live board **without** the seam,
mirroring `scripts/smoke-features.mjs`. Nothing uses it yet — the smoke spec
takes the seam — but it is the guard against the seam quietly drifting away from
the real join flow, and the next spec that needs a lobby-shaped setup should take
it.

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
`load-error` · `join-screen` · `resume-retry` · `waiting-room` · `movelist`

Prefer these over class names and copy: a restyle or a wording pass must not
break the suite.
