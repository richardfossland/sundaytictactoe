# Completion notes

## 🟢 DEPLOYED & LIVE — https://chess.sundaysuite.app

- **Cloudflare Worker** `sundaysjakk` via OpenNext (Next 16), custom domain
  `chess.sundaysuite.app` (own subdomain of the existing `sundaysuite.app` zone).
- **Dedicated Supabase project** `sundaysjakk` (ref `fwbfhwxgkjelcutwajza`, org
  "Sunday", EU/Stockholm). Migrations `0001_schema` + `0002_move_apply` applied.
- **Verified live** (`scripts/smoke-live.mjs`, 9/9): quickmatch on the cloud DB,
  illegal + out-of-turn rejection, full game to checkmate via the `apply_move`
  RPC, reconnect read, and **cloud realtime broadcast delivery**. Real lobby
  flow (create → join) confirmed 200; dev seam `/api/dev/quickmatch` gated to
  404 in production.
- **Env:** `NEXT_PUBLIC_*` inlined at build; `SUPABASE_SERVICE_ROLE_KEY` is a
  Worker secret. Redeploy: `npx opennextjs-cloudflare build && … deploy`.
- **Remaining real-rig item:** the actual multi-phone classroom UX (several
  students on real devices). The transport is proven; only the in-room feel is
  unverified.

## What was built (phases 0–7)

| Phase | Deliverable | Status |
|------|-------------|--------|
| 0 | Skeleton: Next 16 app, schema + RLS, design tokens, pure-logic libs | ✅ code + 34 tests |
| 1 | Lobby & identity: create/join/resume, PIN+QR, live roster | ✅ code, rig-test realtime |
| 2 | **Server-authoritative chess core** (§4) | ✅ code + 7 route tests |
| 3 | Swiss league: pairing, rounds, standings, override, force | ✅ code + 4 tests |
| 4 | Onboarding wizard → config, lock-on-start | ✅ code |
| 5 | Playoff: seeding, single-elim bracket, podium | ✅ code + 8 tests |
| 6 | Polish: round timer, reconnect hardening, responsive, a11y | ✅ code |
| 7 | Suite integration (subdomain deploy) + docs | ✅ docs; deploy = rig-test |

**Gate:** 53 Vitest tests green · `tsc --noEmit` clean · `eslint` clean ·
`next build` succeeds (18 routes).

## Corrections to the original spec (verified against the suite)

1. The spec's `SundaySuite.app/sjakk` route-segment mount is impossible — the
   suite site is static HTML on Cloudflare Pages. → Own deployment at
   **`sjakk.sundaysuite.app`**.
2. The spec's "reuse the Supabase project" clashes with the church-tenant
   `sundayplan` project. → **Dedicated Supabase project**, code-identity schema,
   no `church_id`.

## Architecture decisions worth knowing

- **Atomic moves:** `chess.js` validates in Node; the `apply_move` Postgres
  function commits under a row lock with an optimistic FEN check, so concurrent
  moves can't both win. Validation never runs in the browser.
- **RLS:** every table has RLS enabled with **no** anon policies — clients never
  touch tables directly. All reads/writes go through Route Handlers using the
  service role; realtime is a separate, data-free hint layer.
- **Reads are public, writes are authenticated:** board/game state contains no
  secrets, so clients read it freely; mutations carry a bearer code (student
  `resumeCode`, teacher `hostCode`) in the POST body only — never a URL.
- **Standings/Buchholz** are recomputed from the immutable games list (single
  tested source); `players.score` is a denormalised cache.

## Open questions / deferred (from spec §11 + build)

- **Promotion UI:** auto-queens for v1 (`promotion: 'q'`). A piece-picker dialog
  is a follow-up.
- **Live boards on the teacher screen** (watch the top game): not built;
  nice-to-have.
- **"Sjakk-oppgave" filler for byed students:** out of scope (plain bye chosen).
- **Reduce rounds live (emergency):** the wizard locks config on start; a live
  round-count *reduction* control (spec §5) is not yet exposed — small follow-up
  (config update endpoint gated by host code).
- **Hardening:** in-memory rate limiting + draw-offer store assume a single
  instance (see RIG-TEST.md).

## Needs Richard (rig-test)

Provision the Supabase project, set env, and run the live checklist in
[RIG-TEST.md](RIG-TEST.md): two-browser game to mate, kill-tab resume, 3-phone
lobby, 9-player league, 8-player bracket, and the Cloudflare deploy.
