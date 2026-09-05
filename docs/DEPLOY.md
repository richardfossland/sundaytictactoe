# Deploy — tictactoe.sundaysuite.app

SundayTicTacToe is its **own** deployment on the subdomain
`tictactoe.sundaysuite.app` (the `sundaysuite.app` zone is already on
Cloudflare). The main SundaySuite site is static HTML and cannot host a
Next.js route segment, so there is no `/tictactoe` subpath proxy — `basePath`
stays root.

## Cloudflare Workers via OpenNext (verified pipeline)

Next 16 SSR is deployed to a **Cloudflare Worker** (name `sundaytictactoe`)
using `@opennextjs/cloudflare` (supports `next >=16.2.6`). Config lives in
`open-next.config.ts` + `wrangler.jsonc`.

```bash
# deps (already in package.json): @opennextjs/cloudflare, esbuild, wrangler

# 1. Build the worker (.open-next/worker.js).
#    NEXT_PUBLIC_* are inlined at build time → real Supabase URL/anon key must
#    be in .env.local (or the shell) BEFORE building.
npx opennextjs-cloudflare build

# 2. Deploy the worker.
#    ⚠️ MUST be `opennextjs-cloudflare deploy`, NOT a bare `wrangler deploy`:
#    the prerendered-page cache lives in `.open-next/cache/` after `build` and is
#    only copied into `.open-next/assets/cdn-cgi/_next_cache/` by the adapter's
#    populateCache step, which `deploy` (and `upload`/`preview`) runs and
#    `wrangler deploy` does not. Deploy without it and the static-assets
#    incremental cache is empty → every prerendered page silently falls back to a
#    full SSR render on every request (the exact cost this config removes).
npx opennextjs-cloudflare deploy        # = wrangler deploy + populateCache

# 3. Server-only runtime secret (NOT inlined):
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# 4. Attach the custom domain (sundaysuite.app zone is on this account):
#    wrangler.jsonc `routes`, or Dashboard → Workers → sundaytictactoe →
#    Domains → add tictactoe.sundaysuite.app
```

Env summary:
- **Build-time (inlined):** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_BASE_URL=https://tictactoe.sundaysuite.app`
- **Runtime secret:** `SUPABASE_SERVICE_ROLE_KEY` (`wrangler secret put`)

## Before the deployed app works: the shared Supabase project

SundayTicTacToe uses a dedicated schema (`tictactoe`) on the **shared** Sunday
Supabase project (the same project SundayChess and others live on) — not its
own project. That means the schema has to be wired up by hand once, in **two
separate steps**, both required:

1. **Expose the schema.** Dashboard → Project Settings → API → Exposed
   schemas → add `tictactoe`. This only makes PostgREST aware the schema
   exists; it does **not** grant any role access to it.
2. **Apply the grants migration.** `supabase/migrations/0011_grants.sql` grants
   `usage`/`select`/etc. on the `tictactoe` schema to the PostgREST API roles
   (`anon`, `authenticated`, `service_role`) — a schema created via raw SQL
   (migration `0000_schema_init.sql`) is **not** auto-granted, even once
   exposed. Skipping this step is the classic gotcha: the app looks fully
   deployed, but the service-role client gets `permission denied for schema
   tictactoe` (Postgres `42501`) and every `/api/*` route returns 500.

Run all migrations against the `tictactoe` schema (`0000` through the latest,
`0011_grants.sql` included) — see `docs/RIG-TEST.md` for the provisioning
steps.

👤 **Run `0013_revoke_cleanup_exec_casual_guard.sql` after `0012_client_events.sql`.**
It revokes the anon/authenticated `EXECUTE` grant that 0011's blanket
`grant all on all routines in schema tictactoe to anon, authenticated` handed
`tictactoe.cleanup_old_tournaments()` / `tictactoe.cleanup_client_events()`
(both `security definer`, both otherwise callable via
`POST /rest/v1/rpc/cleanup_old_tournaments` with the public anon key), and
re-defines `cleanup_old_tournaments()` so a casual 1v1 session is never
deleted while one of its games is still `live`, with the casual retention
window raised from 1 day to 7. See the migration file's header comment for the
full findings.

> Note: the in-memory rate-limiter and draw-offer store assume a single
> instance. Cloudflare may run multiple isolates — see the hardening notes in
> `lib/server/http.ts` before relying on them at scale.

## Fallback — Vercel

`vercel` (or connect the repo), set the same env vars, then CNAME
`tictactoe.sundaysuite.app` at Vercel. The app is platform-agnostic; use this
if the Worker runtime surfaces an incompatibility.

## Uptime monitor

A GitHub Actions cron (`.github/workflows/uptime.yml`, every 10 min) probes
`tictactoe.sundaysuite.app` from an external vantage point — catching
edge-level drops a Worker cron can't see itself failing. Targets/budgets live
in `.github/uptime-targets.json`; run it locally with `npm run probe`. A
breach files/updates a GitHub issue labelled `uptime`; recovery closes it.

## Optional: teacher accounts via suite auth

`tournaments.host_user_id` is a ready seam for a real Supabase-Auth teacher
account (so a teacher can reopen a tournament later without the host code). It
is intentionally **not** wired to the church-based suite SSO — schoolteachers
are not church members. Wire it to this project's own Supabase Auth if
desired.
