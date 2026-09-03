# Rig-test checklist (needs Richard + the shared Supabase project)

Everything in the codebase compiles, type-checks, lints, and passes the unit +
route-integration tests (`npm run check`). The items below **cannot be
verified headless** — they need the real, shared Supabase project (realtime +
Postgres) and, ideally, two devices.

## 1. Wire up the `tictactoe` schema on the shared Supabase project

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

## 2. Core game flow (spec §4 "Done when") — the critical path

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

## 3. Lobby & league (spec §1, §6)

- [ ] 3 phones join a PIN and appear on the projector in realtime; a resume
      code re-enters the lobby.
- [ ] A 5-round / 9-player league pairs correctly each round with one rotating
      bye, correct standings, and "Neste runde" is gated until all games
      resolve.
- [ ] Teacher override + "tving fullføring" (force draws) work.

## 4. Playoff (spec §6)

- [ ] An 8-player bracket seeds by (score, Buchholz) and resolves to a single
      champion; a drawn playoff game blocks advance until the teacher
      overrides it.

## 5. Deploy (see docs/DEPLOY.md)

- [ ] `tictactoe.sundaysuite.app` serves the app; env vars set on the
      `sundaytictactoe` Worker; realtime works over the deployed origin.

## Live smoke scripts

Once deployed, `npm run smoke:live` and `npm run smoke:features` exercise the
public flow (create → join → round/start → play/override) against the real
Worker + shared Supabase project. `scripts/smoke-cup.mjs`,
`scripts/smoke-predict.mjs`, and `scripts/smoke-stability.mjs` cover cup mode,
tipping, and concurrency edges the same way — run them with `node
scripts/<name>.mjs`. Each creates throwaway tournaments; the retention cron
cleans them up.

## Hardening backlog (documented, not blocking)

- **Rate limiting** is in-memory/per-process (`lib/server/http.ts`). For a
  multi-instance deploy, move to Upstash/edge KV.
- **Realtime channel authorization**: broadcast/presence channels use the anon
  key with default (open) auth. Tighten with Supabase Realtime Authorization
  (RLS on `realtime.messages`) if classrooms share an origin.
- **Draw offers** are tracked in the `games.draw_offered_by` column — already
  DB-backed (not in-process), so this is safe across isolates as-is.
