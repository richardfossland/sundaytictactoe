# Rig-test checklist (needs Richard + the shared Supabase project)

Everything in the codebase compiles, type-checks, lints, and passes the unit +
route-integration tests (`npm run check`). The items below **cannot be
verified headless** — they need the real, shared Supabase project (realtime +
Postgres) and, ideally, two devices.

This file was last touched 2026-08-30 (`chore: retarget smoke scripts +
docs to TicTacToe`, #21), right after L1 landed and before almost everything
below it. §0 and §1 are new as of 2026-09-03, extending — not replacing — the
rest of this file for the stability program that landed since (ported from
SundayChess; see `docs/PORTING.md` for how the port works and why `docs/**`
is deliberately excluded from it, which is why this file needed a manual
pass rather than an automatic one). There is no `ROBUSTNESS-BACKLOG.md` in
this repo — it was deleted on purpose when the repo was cloned; findings and
their fixes live in the PR history (`git log --oneline`) instead.

## 0. What the rig no longer needs to prove

`e2e/smoke.spec.ts` runs headless on every PR + nightly, against a production
build and a real local Supabase (`docs/E2E.md`): two students, two contexts,
✕ then ◯ seen on both boards. That's the one automated browser check today —
unlike SundayChess, the fuller layout-stability/reconnect/server-errors/
two-tabs/game-end/lobby-rejoin specs have not been ported yet (`npm run
port:status` will show it once the chess PR that adds them, sundaychess#83,
is available to port). Until then, everything in §1 below is this app's
*only* coverage for those scenarios — treat it as load-bearing, not optional.

## 1. Manual scenarios, by device class (2026-09-03 stability program)

The commits behind these (see `git log --oneline`, tagged `L*`/`R*`/`T*
port`) are direct ports of the same fixes in SundayChess, adapted to the
`mnk`-board (`lib/client/MnkBoard.tsx`) instead of `react-chessboard`. Run
these with the actual hardware named — a Chromebook from the school cart
behaves differently from a developer laptop.

### Chromebook (student device, the common case)

- [ ] **Board never jumps on move / capture-equivalent / premove / game
  end.** Play a full 3×3 game to a 3-in-a-row, including one premove (tap
  your move before the opponent's finishes) and the winning move. The board,
  move list, and page scroll position must not visibly shift — reserved
  layout slots around the board, a `position: fixed` toast, and the draw
  offer as a `ConfirmDialog` modal (not an inline banner) are what make this
  hold.
- [ ] **Teacher reloads the arranger page mid-lobby → nobody is removed.**
  With 3+ students in the lobby, hard-refresh the arranger tab. The lobby
  sweep is gated on the arranger being both `SUBSCRIBED` and visible, so a
  reload must not mass-stamp everyone as "last seen now" and sweep them a
  moment later — watch the roster for 60+ seconds after the reload.
- [ ] **Draw offer dialog.** Offer a draw from one board; confirm the
  opponent sees a modal dialog, and accept/decline resolves cleanly on both
  sides.

### Phone (iPhone and Android — do both if you have them)

- [ ] **Phone locked 4 minutes in the lobby → back in with no action from the
  student.** Join the lobby, lock the phone (side button, not just
  backgrounding the tab), wait 4 minutes, unlock. The arranger's ghost-sweep
  will have removed the student (their heartbeat runs in a Web Worker, which
  stops when the OS suspends the tab); on unlock the client auto-calls `POST
  /api/lobby/rejoin` and the student should reappear without tapping
  anything. Only once pairings have started should they instead see "Fjernet
  fra lobbyen" / "Du ble fjernet fra turneringen" and need to rejoin by PIN.
- [ ] **Tap a cell on touch.** Tap a cell, including a short accidental touch
  wobble. `touch-action: manipulation` on the board and each `mnk-cell`
  should mean no double-tap-zoom or delayed-tap ghost-click, and ordinary
  taps should register immediately.
- [ ] **Wifi off 30 s mid-game → badge → recovers.** Toggle Airplane Mode for
  30 seconds mid-game, then back on. Expect the "Kobler til igjen …" badge
  after a run of failed background syncs, an "Oppdater" button after 3
  consecutive failures, and the board to resync on its own once the network
  returns.

### PC / Mac (two browser windows, one player)

- [ ] **Two tabs → "Spill her" → close one → the other takes over in ≤3 s.**
  Open the same player's resume link in two tabs. The second should show a
  passive "spill her" prompt while the first stays live. Close the *active*
  tab (or kill its process) — the passive tab must take over within ~3 s
  (heartbeat/TTL re-election), not hang forever waiting for a `release` a
  killed tab never sent.
- [ ] **Solo bot at 4× CPU throttle → no freeze.** Open Chrome DevTools →
  Performance → CPU throttling → 4×, then play a solo game against the bot on
  each variant (3×3, 4×4, 5×5). The bot runs in `lib/ttt/bot.worker.ts`
  precisely so this can't block the main thread — the board must keep
  responding to input the whole time, on the largest (5×5) board especially,
  where the bot's search space is biggest.

### Projector (arranger view)

- [ ] **Win celebration reads from the back of the room.** Finish a game and
  confirm the confetti/win banner is legible at a distance. (SundayTicTacToe
  has no eval bar — that's chess-only, deliberately excluded from the port —
  so there is nothing to read moment-to-moment beyond the live grid itself.)
- [ ] **Live grid stays legible under load.** With several games live at once
  on the arranger's live-grid view, confirm boards update without visible
  flicker or reflow across variants (the grid's boards are memoized so an
  unrelated game's move can't re-render the whole grid).

## 2. Wire up the `tictactoe` schema on the shared Supabase project

Unlike some other Sunday Suite apps, SundayTicTacToe does **not** get its own
Supabase project — it lives in a dedicated `tictactoe` schema on the **shared**
Sunday Supabase project (the same project SundayChess and others live on).
Locally, `supabase/config.toml` already exposes `tictactoe` for
`supabase start`; against the real project this needs two manual steps:

1. **Expose the schema.** Dashboard → Project Settings → API → Exposed
   schemas → add `tictactoe`.
2. **Apply the grants migration.** `supabase/migrations/0011_grants.sql` must
   be applied — exposing the schema alone is not enough (raw-SQL schemas
   aren't auto-granted to the API roles; see `docs/DEPLOY.md`).

```bash
supabase link --project-ref <shared-project-ref>
supabase db push        # applies every migration in supabase/migrations/, 0011 included
```

Or run locally first: `supabase start` (Docker) then `supabase db reset`.

Fill `.env.local` from `.env.example`:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only — never shipped to the client)
- `NEXT_PUBLIC_BASE_URL=https://tictactoe.sundaysuite.app` (for the join QR)

## 3. Core game flow (spec §4 "Done when") — the critical path

Use the test seam to spin up a 1v1 without the lobby (dev/local only — it 404s
in a production build):

```bash
curl -XPOST http://localhost:3000/api/dev/quickmatch \
  -H 'content-type: application/json' -d '{"white":"Ada","black":"Bo"}'
# → { gameId, white:{playerId,resumeCode}, black:{playerId,resumeCode}, ... }
```

Then verify (classic 3×3, 3-in-a-row):
- [ ] Two browser tabs can play a full legal game to a **3-in-a-row win**; the
      board reflects every move on both sides within ~50 ms.
- [ ] A hand-crafted illegal move (POST `/api/move` with a bogus/occupied/
      out-of-range `cell`) is **rejected server-side** (400), even bypassing
      the UI.
- [ ] Playing out of turn is rejected (403 `not_your_turn`).
- [ ] **Kill a tab mid-game**, reopen `/play`, resume with the code → exact
      board + correct turn restored (the latch + `GET /api/game/[id]`).
- [ ] Rapid double-submit of the same move never corrupts state (the second
      hits `apply_move`'s optimistic board-state check → a 409 conflict).
- [ ] Resign and draw-offer/accept resolve the game and update both clients.
- [ ] The larger variants (4×4 and 5×5, both 4-in-a-row) play correctly —
      win detection isn't hardcoded to the 3×3 board.

## 4. Lobby & league (spec §1, §6)

- [ ] 3 phones join a PIN and appear on the projector in realtime; a resume
      code re-enters the lobby.
- [ ] A 5-round / 9-player league pairs correctly each round with one rotating
      bye, correct standings, and "Neste runde" is gated until all games
      resolve.
- [ ] Teacher override + "tving fullføring" (force draws) work.

## 5. Playoff (spec §6)

- [ ] An 8-player bracket seeds by (score, Buchholz) and resolves to a single
      champion; a drawn playoff game blocks advance until the teacher
      overrides it.

## 6. Deploy (see docs/DEPLOY.md)

- [ ] `tictactoe.sundaysuite.app` serves the app; env vars set on the
      `sundaytictactoe` Worker; realtime works over the deployed origin.

## 7. Uptime monitor and the live smoke scripts

- **Uptime monitor**: `.github/workflows/uptime.yml` probes
  `tictactoe.sundaysuite.app` from GitHub Actions every 10 minutes and
  files/updates a GitHub issue labelled `uptime` on a breach (`docs/DEPLOY.md`).
  Run it locally with `npm run probe`.
- **Live smoke scripts**: once deployed, `npm run smoke:live` and `npm run
  smoke:features` exercise the public flow (create → join → round/start →
  play/override) against the real Worker + shared Supabase project.
  `scripts/smoke-cup.mjs`, `scripts/smoke-predict.mjs`, and
  `scripts/smoke-stability.mjs` cover cup mode, tipping, and concurrency edges
  the same way — run them with `node scripts/<name>.mjs`. Each creates
  throwaway tournaments; the retention cron cleans them up. Run
  `smoke:live` once after any production deploy to confirm the *deployed*
  bundle behaves correctly, not just `main`.

## Hardening backlog (documented, not blocking)

- **Rate limiting** is in-memory/per-process (`lib/server/http.ts`). For a
  multi-instance deploy, move to Upstash/edge KV.
- **Realtime channel authorization**: broadcast/presence channels use the anon
  key with default (open) auth. Tighten with Supabase Realtime Authorization
  (RLS on `realtime.messages`) if classrooms share an origin.
- **Draw offers** are tracked in the `games.draw_offered_by` column — already
  DB-backed (not in-process), so this is safe across isolates as-is.
