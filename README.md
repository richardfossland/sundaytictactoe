# SundayTicTacToe

A big-screen classroom tic-tac-toe ("bondesjakk") tournament. A live Swiss
league (3–7 rounds) with an optional knockout playoff. Students join with a PIN;
the teacher runs a projector "board". Part of the **Sunday Suite**, deployed at
**`tictactoe.sundaysuite.app`**.

The rules are **server-authoritative**: the client only sends a move *intent* (a
cell index); the server replays it against the stored board, commits atomically,
and broadcasts the new position. Whose turn it is is server state, never
negotiated between clients.

Selectable board variants per tournament: classic **3×3** (3-in-a-row), **4×4**
(4-in-a-row), and **5×5** (4-in-a-row) — larger boards make draws far rarer, so a
tournament between evenly-matched players stays interesting.

## Stack

- **Next.js 16** (App Router, TypeScript) — UI + Route Handlers (`/api/*`)
- **Supabase** — Postgres (authoritative store, dedicated `tictactoe` schema on
  the shared Sunday project) + Realtime Broadcast (position nudges / lobby)
- **`lib/ttt/`** — the m,n,k game engine (rules, win detection, minimax bot).
  No external game library; the board is a hand-rolled CSS grid (`MnkBoard`).

## Develop

```bash
npm install
cp .env.example .env.local   # fill in Supabase keys (see docs/RIG-TEST.md)
npm run dev                  # http://localhost:3000
```

Quality gate (run before committing):

```bash
npm run test       # Vitest — pure logic + route integration
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # next build
```

## Layout

- `lib/ttt/` — `variants` (m,n,k presets), `validateMove` (apply/legality),
  `win` (k-in-a-row), `ply`, `bot` (minimax + difficulty levels)
- `lib/tournament/` — `pair` (Swiss), `score` (Buchholz/standings), `bracket`
- `lib/server/` — `store` (DB), `league` / `playoff` (engines), `auth`,
  `broadcast`, `gameEvents`, `http`
- `app/host/` — teacher: wizard, lobby, league board, bracket, podium, live grid
- `app/play/` — student: join/resume, waiting room, playable board
- `app/solo/` — practice vs the computer; `app/versus/` — casual 1v1
- `supabase/migrations/` — `0000_schema_init` (creates the `tictactoe` schema),
  `0001_schema` (tables + RLS), `0002_move_apply` (atomic `apply_move` /
  `resolve_game` RPCs), …

## Deploy

```bash
npx opennextjs-cloudflare build && npx opennextjs-cloudflare deploy
# then once: npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

**Before the deployed app works**, add `tictactoe` to the shared Supabase
project's Exposed schemas (Dashboard → Project Settings → API), and run the
migrations against the `tictactoe` schema.
