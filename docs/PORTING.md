# Porting infra from SundayChess

SundayTicTacToe was cloned from [SundayChess](https://github.com/richardfossland/sundaychess)
**without shared git history** (this repo's root commit is `chore: initialize
git repository`). Only the rules layer differs — chess's `lib/chess/**` vs.
this repo's `lib/ttt/**` — plus a handful of app-specific files (branding,
`middleware.ts`, `wrangler.jsonc`, migrations, docs). Everything else —
Supabase auth/realtime plumbing, the tournament/host/arranger flow, API error
handling, CI, the client polling/reconnect machinery — is infra both apps
share, and most of those files are still byte-identical or close to it. That
makes `git cherry-pick -x` of a chess commit apply cleanly via a 3-way merge
even with **no common history**: identical blobs hash the same, so git finds
a merge base regardless.

Two scripts make this repeatable instead of manual per port:

## `scripts/port-status.sh` — what's left to port

```bash
npm run port:status
# or: bash scripts/port-status.sh
```

Lists every commit on `chess/main` (since this repo was cloned, 2026-06-16)
that touches at least one path **not** in `scripts/port-exclude.txt`, and
that hasn't already been ported here. That list is the real backlog — run it
before picking what to port next, and paste its current output into a port
PR's description when useful context.

"Already ported" is recognised two ways (a port PR body may carry either):

- a `(cherry picked from commit <sha>)` trailer — written automatically by
  `git cherry-pick -x`, which `port-from-chess.sh` uses;
- a `Port of sundaychess#<NN>` line, where `NN` is mapped to the chess
  squash-merge commit via `git log --grep "(#NN)"` against the chess remote.

## `scripts/port-from-chess.sh` — do a port

```bash
scripts/port-from-chess.sh <sha> [<sha> ...]
```

For each SHA (in the order given): cherry-picks it with `-x` (so the commit
message keeps a `(cherry picked from commit ...)` line), restores every path
matching `scripts/port-exclude.txt` back to how it was before the pick,
greps what's left for chess-flavoured leakage (`sjakk:`, `sundaychess`,
`chess.sundaysuite`, `CHESS_ADMIN`, `lib/chess`, `app/host/[` — printed as a
`WARNING`, doesn't abort) and, if anything survived exclusion, amends the
commit to that trimmed tree. A commit that touches **only** excluded paths
is dropped entirely (nothing to port). Once the whole batch is done, it runs
`npm run check`.

A cherry-pick **conflict** is left exactly as git leaves it — the script
does not try to resolve it. Fix it by hand:

```bash
# resolve the conflict markers, restore any excluded paths yourself, then:
git cherry-pick --continue
# or give up on this one:
git cherry-pick --abort
```

The script also adds a **read-only** `chess` remote
(`https://github.com/richardfossland/sundaychess.git`) the first time it
runs. Never push to it.

## `scripts/port-exclude.txt` — what never travels

One glob per line (`*` matches anything including `/`; `[`/`]` are literal —
Next.js route folders like `[tournamentId]` are real directory names).
Comments at the top of the file explain each group; the short version:

- chess's rules engine, coach, puzzles, and the client components that only
  make sense for a chess board (clock, captured pieces, eval bar, promotion,
  replay, puzzle card, the review feature end to end);
- app identity and deploy config that would otherwise silently rebrand or
  redeploy the wrong app (`middleware.ts`, `wrangler.jsonc`, `.env.example`,
  `README.md`, `LICENSE`, `CONTRIBUTING.md`, `docs/**`, brand CSS);
- Supabase migrations (this repo owns its own schema and numbering);
- the e2e suite and its Playwright config, until that gets ported here in
  its own pass (tracked separately);
- the handful of chess-only test files whose only subject is one of the
  excluded modules above.

If a future chess commit legitimately needs one of these paths ported too
(e.g. once the e2e suite lands here), delete the relevant line(s) first —
don't special-case it in the script.

## Convention: every port PR says what it ported

Every port PR body carries a line of the form:

```
Port of sundaychess#<NN> (<sha>)
```

— `<NN>` is the sundaychess PR number, `<sha>` its squash-merge commit on
`chess/main`. This, together with the `cherry-pick -x` trailer already in
the commit message, is what `port-status.sh` uses to know a chess commit has
already made it across.
