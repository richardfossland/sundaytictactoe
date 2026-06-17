# Rig-test checklist (needs Richard + a real Supabase project)

Everything in the codebase compiles, type-checks, lints, and passes 53 unit +
route-integration tests. The items below **cannot be verified headless** — they
need a real Supabase project (realtime + Postgres) and, ideally, two devices.

## 1. Provision the dedicated Supabase project

Per the plan, SundayChess uses its **own** Supabase project (not the
church-tenant `sundayplan`).

1. Create a new Supabase project (e.g. `sundaysjakk`). Realtime is enabled by
   default (`supabase/config.toml` → `[realtime] enabled = true`).
2. Apply the migrations:
   ```bash
   supabase link --project-ref <ref>
   supabase db push        # applies 0001_schema.sql + 0002_move_apply.sql
   ```
   Or run locally first: `supabase start` (Docker) then `supabase db reset`.
3. Fill `.env.local` from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only — never shipped to the client)
   - `NEXT_PUBLIC_BASE_URL=https://sjakk.sundaysuite.app` (for the join QR)

## 2. Core chess flow (spec §4 "Done when") — the critical path

Use the test seam to spin up a 1v1 without the lobby:

```bash
curl -XPOST http://localhost:3000/api/dev/quickmatch \
  -H 'content-type: application/json' -d '{"white":"Ada","black":"Bo"}'
# → { gameId, white:{playerId,resumeCode}, black:{playerId,resumeCode}, ... }
```

Then verify:
- [ ] Two browser tabs can play a full legal game to **checkmate**; the board
      reflects every move on both sides within ~50 ms.
- [ ] A hand-crafted illegal move (POST `/api/move` with a bogus from/to) is
      **rejected server-side** (400 `illegal`), even bypassing the UI.
- [ ] Playing out of turn is rejected (403 `not_your_turn`).
- [ ] **Kill a tab mid-game**, reopen `/play`, resume with the code → exact
      position + correct turn restored (the latch + `GET /api/game/[id]`).
- [ ] Rapid double-submit of the same move never corrupts state (the second
      hits `apply_move`'s optimistic FEN check → 409 `stale`).
- [ ] Resign and draw-offer/accept resolve the game and update both clients.

## 3. Lobby & league (spec §1, §6)

- [ ] 3 phones join a PIN and appear on the projector in realtime; a resume code
      re-enters the lobby.
- [ ] A 5-round / 9-player league pairs correctly each round with one rotating
      bye, correct standings, and "Neste runde" is gated until all games resolve.
- [ ] Teacher override + "tving fullføring" (force draws) work.

## 4. Playoff (spec §6)

- [ ] An 8-player bracket seeds by (score, Buchholz) and resolves to a single
      winner; a drawn playoff game blocks advance until the teacher overrides it.

## 5. Deploy (see docs/DEPLOY.md)

- [ ] `sjakk.sundaysuite.app` serves the app; env vars set in the Pages project;
      realtime works over the deployed origin.

## Hardening backlog (documented, not blocking)

- **Rate limiting** is in-memory/per-process (`lib/server/http.ts`). For a
  multi-instance deploy, move to Upstash/edge KV.
- **Realtime channel authorization**: broadcast/presence channels use the anon
  key with default (open) auth. Tighten with Supabase Realtime Authorization
  (RLS on `realtime.messages`) if classrooms share an origin.
- **Draw offers** are tracked in-process (`lib/server/drawOffers.ts`) — fine for
  single-instance; move to a table if scaled out.
