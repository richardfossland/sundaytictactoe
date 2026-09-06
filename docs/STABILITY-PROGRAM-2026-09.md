# Stability program — 2026-09 (TTT view)

The stability/quality program was designed and run against SundayChess first;
this app carries it via `scripts/port-from-chess.sh` (see `docs/PORTING.md`
for how the port mechanics work — cherry-pick, exclude, ignore, the `Port of
sundaychess#<NN>` convention). This page is the TTT-side index: which chess
fix landed in which TTT PR, plus the handful of things this app built for
itself that chess doesn't have. `docs/ROBUSTNESS-BACKLOG.md` does not exist
here — deleted on purpose at clone time; findings live in PR history instead
(`git log --oneline`).

## Runde 1 (through 2026-09-03) — the R/L/T port

Chess's own `docs/STABILITY-PROGRAM-2026-09.md` has the root-cause detail
behind every one of these letters (layout `L`, realtime/resilience `R`,
tooling/telemetry `T`). This table is just the port mapping.

| Chess code | Port PR | What |
| --- | --- | --- |
| L1 | #20 | Move list scrolls only itself, not the page. |
| R2 | #22 | Every `localStorage` access guarded. |
| R1 | #24 | Static-assets cache, JSON 404 catch-all, `/api/health`. |
| T1 | #25 | Synthetic uptime probe. |
| R8 | #26 | Move route responds first; broadcast/score via `after()`. |
| R3 + R7 | #27 | Only our own `invalid_code`/`not_found` ends a session; "reconnecting" badge. |
| R1b | #28 | Malformed ids answer 404/400, not 503. |
| L2 | #29 | Reserved layout slots around the board. |
| R4 | #30 | Presence heartbeat in a Web Worker; sweep bugfixes; rejoin. |
| L3 | #31 | Top-aligned board screens; fixed toast; notice slot; draw-offer dialog. |
| R5 | #32 | Active-tab claim/heartbeat/release + TTL re-election. |
| L4 | #33 | `touch-action: manipulation` on the board and each cell. |
| R11 | #34 | `CLOSED` channel recreated with backoff; hidden-tab poll cadence. |
| L5 | #40 | Board insulated from unrelated re-renders (stable identities, memoized `MnkBoard`). |
| T2 + T4 | #37 | Playwright rig + CI e2e job against local Supabase. |
| T3 | #42 | `layout-stability`, `reconnect`, `server-errors`, `two-tabs`, `game-end`, `public-flow`, `lobby-rejoin` specs. |
| T5 | #43 | Client telemetry beacon + host "🩺 Diagnostikk" modal. |
| — | #44 | `docs/RIG-TEST.md` rewrite for the program (this file didn't exist yet). |
| L8 (remainder) | #45 | Spectate move list always mounted — no layout shift on the first move. |

**TTT-only, no chess code** (this app's own fixes, not ports):
- #21 — retarget smoke scripts + docs to TicTacToe, consolidated `check` script, dependabot ignore.
- #23, #38, #39 — dependency/tooling fixes independent of chess (undici bump, IP-pinning fetch fix, lockfile audit).
- **#35 (`L6`)** — the solo bot moved into `lib/ttt/bot.worker.ts`, 10× faster inner loop. Chess has no equivalent letter for this: chess's engine work is `L7`/`R10` (coach advice + eval bar off the move path, run through an already-external UCI-style engine), not "move the bot itself off the main thread" — TTT's own minimax bot needed that pass, chess's didn't.
- #36 — the port tooling itself (`scripts/port-from-chess.sh`, `port-status.sh`, `port-exclude.txt`, `docs/PORTING.md`'s first version). This is chess's `T7`, credited there; here it's the thing this whole table depends on.
- #41 — uptime cron re-registered with offset minutes (same fix as chess's own #88, done independently the same day — see `docs/PORTING.md`'s port-ignore notes).

## Runde 2 (05.–06.09) — ports #47–#57 (+ #45/#46 carried over from the 09-05 boundary)

Three adversarial audits ran against chess's `main` first (UX/a11y, kodehelse/
sikkerhet, produkt); each fix was then ported here, plus TTT's own product
audit found three things chess doesn't have at all (puzzles, awards,
adaptive difficulty) and a copy pass this fork specifically needed.

| TTT PR | Ports (chess PR) | What |
| --- | --- | --- |
| #47 | chess #91 (own migration `0013`, `tictactoe` schema) | Revokes anon `EXECUTE` on the `security definer` cleanup RPCs (worse here — `0011_grants.sql`'s blanket `grant all on all routines` had already handed every future function, including these, elevated-rights EXECUTE by default); casual-session delete clause never fires while a live game exists; retention 1→7 days. SQL-only, 👤 owner runs by hand after `0012`. |
| #48 | — (TTT-only) | Copy pass: "uavgjort" standardised, drops chess's "½" glyph; corrects `wizard.timerHint` (was implying host-only) and `hostAuth.emailPlaceholder` (church-domain leftover); real ✕/◯ glyph instead of a hardcoded ✕; top bot level renamed "Umulig"→"Uslåelig" with an explicit 3×3 note that perfect play is a draw at best; ~90 lines of dead chess-only locale/CSS pruned. |
| #49 | chess #96 | CI hygiene: `concurrency` group, always-on Playwright report artifact, `supabase/setup-cli` v1→v3, `wrangler.jsonc` `compatibility_date` bump. |
| #50 | chess #95 (H1/H2/M3/M6) | Route try/catch scope fixed on `round/{start,advance,extend,force}` + `join`; uuid guard moved inside `authPlayer`/`authHost`; silent-`void` store writes now throw. |
| #51 | chess #92, #93, #94, #97 | Your-turn cue (title flash + vibration + opt-in `NotifyToggle`) for a backgrounded tab; cup-round time-up banner + "Avslutt runden"; `FullscreenToggle` on more projector screens; masked host/resume codes + themed confirm dialogs; error-boundary telemetry. |
| #52 | chess #101 (M5) | Broadcasts are untrusted hints only — `status` never applied from a payload, `position` provisional until the next authoritative fetch; topics gain a `ttt:` prefix (chess uses `chess:` — same shared Supabase project, previously one flat `game:<uuid>` namespace); late presence subscriber now tracks. |
| #53 | chess #98, #99, #102 (H4/H5/M1) | Waiting-room progress ("Runde n av N · x partier igjen"); ⚡ Rask start quick-create + wizard auto-advance; rate limits on the board poll + player-action POSTs; remaining side-effects (`override`, `absent`, `join`, `lobby/kick`, `round/extend`) moved off the response path. |
| #54 | — (closed independently) | ESLint 9→10, same root cause and recipe as chess #106 and the sundayquiz pilot (`quiz#28`) — each repo hit the same `eslint-plugin-react` `"detect"` removal and fixed it the same way, not a literal port. |
| #55 | — (TTT-only, parity with chess's solo mode) | Puzzle card in the waiting room (24-position pack, 3 variants, uniqueness re-derived from `lib/ttt/win.ts` — nothing a puzzle claims about itself is trusted); four more awards (`centre_opener`, `comeback`, `blocker`, `draw_king`) reading the replayed cell list, geometry-aware per variant; adaptive solo difficulty ("Tilpasset", `lib/ttt/skill.ts`, a port of chess's `skill.ts` rating/K-schedule machinery with `skillToParams(skill, variant)` on top) with a "Nivå ≈ …" chip. |
| #56 | chess #108 | `POST /api/game/reinstate`; "Ute av turneringen (n)" collapsible + "Ta inn igjen"; honest late-join copy. |
| #57 | chess #103, #104, #107 + TTT board a11y (UX audit #13/#31) | Full standings + print/PDF + fair-play markers + tiebreak gloss + landing-page strip; shared `Modal` primitive (focus trap, Escape, focus return) under `ConfirmDialog`/`CodesModal`/`DiagnosticsModal`/`OverrideModal`; draw-offer dismiss ≠ decline ("Svar på tilbudet om uavgjort"); reduced-motion + `aria-pressed` + 44px targets + `RoundTimer` announcer sweep; **MnkBoard a11y** (TTT-only): `aria-disabled` instead of `disabled` so a not-your-turn board stays in the tab order, `role="group"` instead of an unbacked `role="grid"`, `"rad r, kolonne c — ✕/◯/tom"` cell labels, a live-region win announcement. |

Two entries above ride purely on tooling, not a chess fix: #45 (spectate move
list, the L8 remainder — chess's own commit landed 2026-09-03, just after
this repo's port window closed for runde 1) and #46 (`port-status.sh`
false-positive fixes — see `docs/PORTING.md`).

## What was deliberately NOT ported

- **R9 (chess #76, PGN trimmed off the 5 s board poll)** — TTT's board state
  is a short cell list (≤25 characters even on 5×5), not a move-by-move PGN
  string that grows with game length. There is nothing to trim. Recorded in
  `scripts/port-ignore.txt` with that reasoning.
- **L7/R10 (chess's coach advice + eval bar off the move path)** — TTT has no
  chess engine, no eval bar, and no coach. `L6` (above) is this app's
  equivalent problem for its own bot, solved separately.
- **Chess #100 (18-lesson "Lær sjakk" coach curriculum)** — chess-specific
  content (piece moves through mate-in-one) with no `m,n,k` equivalent. TTT's
  own parity feature for "something to do besides play" is the puzzle pack
  (#55), not a lesson curriculum.
- **`docs/E2E.md`, `docs/ROBUSTNESS-BACKLOG.md`, `docs/COMPLETION.md`, chess's
  clock/replay/review/promotion UI** — excluded by design
  (`scripts/port-exclude.txt`); see `docs/PORTING.md`.

## Genuinely open (verified against `main`, not just the port-status script)

- **Chess #105 (per-tournament session keys)** — **not yet ported.**
  `lib/client/identity.ts` still keys the whole app off a single
  `"ttt:player"` slot per browser, the same single-slot design chess #105
  replaced. A shared classroom tablet, or a student scanning a second PIN
  while an earlier tournament is still live, still silently loses the first
  tournament's resume code here.
- **Chess #110 (finish league early / teacher notes / solo link while
  waiting)** — **not yet ported.** No `config.leagueRounds`-lowering route,
  no `NotesModal`, no `config.notes` field exist in this codebase yet.
- **Chess #109 (WebKit + OpenNext-runtime nightly e2e lanes)** — merged into
  chess very recently (after most of this runde's TTT ports landed). TTT's
  own `nightly.yml` already runs `desktop-chromium` + `mobile-chromium`
  nightly; it does not yet have a WebKit lane (`playwright.config.ts` has
  `E2E_WEBKIT=1` wired for a local opt-in run, not for CI) or an
  OpenNext-runtime lane.

See `docs/PORTING.md` for the current `npm run port:status` output and a
line-by-line reconciliation of what it flags versus what's actually still
open (short version: the script's raw count overstates the backlog this
runde — several ports use a commit-title phrasing the script's literal
string match doesn't recognise).
