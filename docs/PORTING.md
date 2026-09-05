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

"Already ported" is recognised three ways (a port PR body may carry any):

- a `(cherry picked from commit <sha>)` trailer — written automatically by
  `git cherry-pick -x`, which `port-from-chess.sh` uses;
- a `Port of sundaychess#<NN>` line, where `NN` is mapped to the chess
  squash-merge commit via `git log --grep "(#NN)"` against the chess remote.
  A single line can name more than one `NN` for a combined port — `Port of
  sundaychess#66 and #70`, `...#71 (the rig) and sundaychess#74 (the CI
  job)`, `...#64 (ef046d6) + #68` — every number on that line counts, not
  just the first;
- a `Port: TTT #<NN>` line in the **chess-side** commit's own body — the
  mirror convention from sundaychess's own `docs/PORTING.md`, for a port
  that landed here without repeating the chess PR number in a TTT commit.

On top of all three, `scripts/port-ignore.txt` (below) is a manual allowlist
for commits none of the above can catch.

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

## `scripts/port-ignore.txt` — known equivalents, not backlog

Some chess commits touch non-excluded paths and genuinely have nothing left
to port, but none of `port-status.sh`'s three detection methods can see
why: they were ported by hand before either the `Port of sundaychess#<NN>`
or `Port: TTT #<NN>` convention existed, or they were already part of TTT
from the initial clone (e.g. TTT #1–#3, #5–#7 correspond to chess
#44–#46, #48–#50 — same fix, applied before this repo had a porting
convention to write down). `port-ignore.txt` lists those explicitly, one
entry per line:

- `<sha-or-#NN>  free-text comment` — a single chess commit, by its
  chess/main SHA or sundaychess PR number (`NN` resolved to the squash
  commit the same way a `Port of sundaychess#NN` reference is);
- `pattern:<ERE>` — skip every chess commit whose *subject* matches this
  extended regex, for a whole class of commit that never needs a real
  port. Used by default to skip dependabot's own `chore(deps): bump ...`
  commits (dependabot runs independently in both repos, so a chess-side
  bump is never a TTT backlog item) — deliberately scoped to `bump`, not
  the whole `chore(deps)` namespace, so a hand-written `chore(deps)`
  commit that isn't a routine bump (a manual lockfile audit fix, say)
  still surfaces instead of being silently swallowed.

Every SHA entry is verified against TTT's own history/files (identical or
near-identical file list, ideally a matching title) before being added —
it's an audit trail, not a place to silence a commit just because its
subject line looks routine. An entry that isn't a genuine equivalent hides
real backlog.

## Convention: every port PR says what it ported

Every port PR body carries a line of the form:

```
Port of sundaychess#<NN> (<sha>)
```

— `<NN>` is the sundaychess PR number, `<sha>` its squash-merge commit on
`chess/main`. This, together with the `cherry-pick -x` trailer already in
the commit message, is what `port-status.sh` uses to know a chess commit has
already made it across. A combined port (one commit that ports more than one
chess PR at once) names every `<NN>` on the same line — `Port of
sundaychess#66 and #70` — rather than opening one line per PR.

sundaychess mirrors this from its own side: once a chess PR has been ported
here, its PR body (or a follow-up comment) gets a `Port: TTT #<NN>` line
over there. `port-status.sh` checks for that too, directly on the chess
commit, so a port that never got annotated on the TTT side still doesn't
show up as backlog.
