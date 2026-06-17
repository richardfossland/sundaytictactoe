# SundayChess — Tournament Robustness Plan (headless)

Goal: survive a real, large tournament stress-test. Fix every instability/bug
that is fixable **headless** (code-only, no physical multi-device rig). Each item
below has been (or will be) **verified against the actual code** before fixing —
the source audit produced both real findings and false positives, so nothing
here is taken on faith.

Status legend: ✅ verified-real · 🔎 needs-verification-before-fix · ❌ discarded
(false positive). Severity: P0 (breaks/desyncs live play) · P1 (degrades/confuses)
· P2 (polish/edge). Risk: 🟢 low (client-only) · 🟡 medium · 🔴 shared-prod-DB migration.

---

## ✅ DONE in this branch (`feat/tournament-robustness`) — gates green: typecheck · lint · 139 tests

**Implemented (Tier 1/2/4):** singleton Supabase browser client; host projector keeps the
last-good board on a transient error + retry on initial-load failure + a "reconnecting"
badge; `plyOf` extracted to `lib/chess/ply.ts` and used in GameView's position handler so a
stale broadcast can't roll the board back (terminal status still honoured); all draw/resign
actions reconcile via `load()` on error through a shared `runMeta` helper + double-fire guard;
GameView shows an error card (retry/back) instead of an infinite spinner on load failure;
WaitingRoom drops a vanished latched game; player resume explains an expired session. New
tests: `plyOf` (6) + `colorCounts` (2) — 132 → 139.

**Implemented (Tier 3, DB):** migration `0008_team_join_atomic.sql` — atomic, advisory-locked
balanced team assignment (`join_team_player`), with a JS fallback in `addPlayer` so deploy
order vs. the migration doesn't matter. **Docker-verified**: all migrations apply + 0008
idempotent; 2-team 5/5, 3-team 3/3/3, tie→declared order, no-team→null, resume-code uniqueness
held; and **20 truly-parallel joins → exactly 10/10** (proves the lock kills the race).
⚠️ NOT applied to prod — run `0008` in the shared Supabase project's SQL editor when ready
(the code already runs correctly with or without it).

**Discarded as false positives (verified against the code):** `useCountdown` "interval leak"
(already clears it); `LiveGamesView` fenMap "unbounded growth" (already pruned every poll);
`resolve_game` "last-write-wins race" (row-locked + `require_live`; teacher-override winning
is intentional). Deferred: round-advance crash-atomicity (double-click already handled; full
fix needs a big refactor) and hard realtime re-subscribe on iOS background (existing focus/
online/visibility resync covers data correctness; true verification needs a device).

---

## Baseline — verified by running (the engine is NOT the weak point)

- `tsc --noEmit` clean · **132 tests pass** (18 files) · eslint clean · `next build` OK (23 routes).
- Server-authoritative core is solid: moves via atomic `apply_move` RPC (row lock +
  optimistic FEN check), draws DB-backed (migration 0003), round-advance guarded by a
  unique constraint with graceful 23505 recovery, all writes server-only (anon RLS denies
  direct table access). Migrations 0001–0007 applied.
- The real exposure for a live stress-test is **client/realtime resilience** and a few
  **concurrency edges**, not the chess/scoring logic.

---

## Tier 1 — P0 client/realtime robustness · 🟢 low risk, no DB migration

1. **Single shared Supabase browser client (singleton).** ✅
   `lib/supabase/client.ts` + `lib/client/useChannel.ts:31` — `createClient()` builds a new
   `createBrowserClient` on every call; `useChannel` calls it per subscription. Over a
   multi-hour projector session with hundreds of games this can accumulate WebSockets/clients.
   (`@supabase/ssr` may memoize internally depending on version — making it an explicit
   module-level singleton is cheap insurance either way.)
   *Fix:* cache one instance at module scope; all channels share one RealtimeClient.

2. **Host projector must never go dark.** ✅
   `app/host/[tournamentId]/BoardClient.tsx:16-19` — on `error` it renders only a banner; no
   retry, and the live view disappears. `refresh()` is already in scope.
   *Fix:* error UI with a "Prøv igjen" button → `refresh()`, and keep the last-good board
   visible instead of unmounting it. (Confirm whether `useBoardState` keeps polling during
   the error — if it does, also make the banner non-destructive.)

3. **Don't let stale/out-of-order broadcasts regress the board.** ✅
   `app/play/GameView.tsx:295` sets `fen` from an incoming "position" event unconditionally.
   `LiveGamesView` already guards with `plyOf(incoming) >= plyOf(current)` (lines 44, 59-60).
   *Fix:* reuse `plyOf` in GameView's position handler; ignore older positions. (GameView
   already has reconnect re-sync at :227, a 3 s poll at :243, and `confirmedFen` rollback —
   this closes the last gap.)

4. **Always reconcile to server truth on action error.** 🔎
   Draw offer/accept/decline and resign handlers in `GameView.tsx` have mixed error handling
   (some `.catch(() => {})`, some leave the optimistic banner stuck). Broadcasts are
   fire-and-forget hints, not truth.
   *Fix (verify each path first):* on any action error → `load()` to refetch authoritative
   state; never leave a phantom "draw offered"/"live" banner. Treat draw broadcasts as hints
   and reconcile from `drawOfferedBy` in the fetched detail.

5. **Guard double-fire on action buttons.** 🔎
   resign / accept-draw / decline-draw / "neste runde" can fire twice on rapid taps. The DB is
   already protected (require_live guard, unique constraint), so this is duplicate-request /
   UX hygiene, not corruption.
   *Fix:* set `pending`/disable before the await on each action button.

6. **Recovery UI for dead sessions instead of infinite spinners.** 🔎
   - `app/play/page.tsx` resume with a stale `localStorage` token: show a clear message + drop
     to join, no silent multi-second hang.
   - `WaitingRoom` latched onto a game that no longer exists → reset to the waiting view.
   - `GameView` mount load-failure → error card with a way back, not a forever spinner.
   *Fix:* add explicit error/empty states on these three paths (verify current behavior of each).

---

## Tier 2 — P1 long-session & reconnect · 🟢/🟡 (some need a device to fully verify)

7. **Bound projector memory over hours.** 🔎
   `LiveGamesView` `fenMap` is pruned only when `games` changes. Add a periodic prune of
   non-live entries so a 2-hour session can't grow unbounded. (Verify real growth first.)

8. **Re-subscribe realtime after background/network drop (iOS Safari).** 🔎🟡
   On `visibilitychange`/`online`, tear down and re-create the channel + `load()`. Code is
   headless; the actual iOS-lock behavior needs a device to confirm (rig item).

9. ❌ **`useCountdown` interval leak — DISCARDED.** The hook already returns
   `clearInterval` (`lib/client/useCountdown.ts:11-12`). No bug. (Listed so it isn't re-raised.)

---

## Tier 3 — Tournament-engine concurrency · 🔎🔴 verify first; some need a SHARED-DB migration

These touch the shared Supabase project (chess/market/turnering/quiz/harvest). I will **not**
run a migration here without explicit go-ahead, and would validate via `scripts/test-db.sh`
(throwaway Postgres in Docker) before anything touches prod.

10. **Concurrent-join team balance race.** 🔎 `lib/server/store.ts:138-152` reads team counts
    then inserts non-atomically; simultaneous joins can skew teams. Verify, then move to an
    atomic `add_player_balanced` RPC (or a retry). *(migration)*
11. **Round-advance atomicity beyond the unique constraint.** 🔎 `lib/server/league.ts:117-152`
    does several writes; the double-click case is already caught, but a mid-pairing crash could
    leave a partial round. Verify; consider a "round ready" flag set only after all games exist.
12. **`resolve_game` require_live vs. teacher-override race.** 🔎 A player resolve
    (`require_live=true`) and a teacher override (`require_live=false`) racing can last-write-win.
    Verify lock semantics; consider a result version/lock. *(maybe migration)*
13. **Playoff slot ordering for mixed pre/post-0007 games.** 🔎 Likely moot if current
    tournaments are all post-0007; confirm, else `order by slot nulls last, created_at`.

---

## Tier 4 — Test coverage (pure additions, headless) · 🟢

14. `colorCounts()` white/black balance assertions (fairness).
15. `currentRoundResolved()` edge cases (bye-only round, 0-game round, state drift).
16. Concurrent round-advance 23505 recovery path.
17. `winnerOf(bye_game)` direct unit test.
18. `applyMove` with an invalid promotion char → defaults to queen.

---

## Out of scope for headless (rig / product decisions — not in this pass)

- **Rate limiter → edge KV/Durable Object** for multi-instance Workers (needs infra + load test).
- **Realtime channel authorization** (cross-class eavesdropping) — low for single origin; a decision.
- **Playoff draw tiebreak rule** — currently blocks advancement with "needs_decision". The fix is
  a *product* choice (random winner? armageddon? replay? keep manual override?) — needs your call.
- **The actual multi-device rig stress-test** — the final proof; only you can run it.

---

## Suggested execution order

A. Tier 1 (1→6) + Tier 2 (7) + Tier 4 tests → one PR, all 🟢, `npm run check` must stay green.
B. Tier 2 (8) reconnect — same PR or follow-up; mark rig-verify.
C. Tier 3 — only after verification + your go-ahead; Docker-test the migration before prod.
