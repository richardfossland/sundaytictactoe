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

## Current backlog (`npm run port:status`, 2026-09-06 snapshot)

Raw output, run from a clean worktree after `npm ci` (chess fetched fresh):

```
Un-ported sundaychess commits touching non-excluded paths
(chess/main since 2026-06-16, checked against origin/main):

* 92747a1ce  2026-06-16  feat(playoff): teacher resolves a knockout draw — rematch or higher seed (Deploy 1) (#37)
* 93ac7e97d  2026-06-16  feat(player): "out of tournament" message + no layout jump on moves (Deploy 2) (#38)
* 937338204  2026-06-16  feat(host): stable live-grid order + fullscreen toggle (Deploy 3) (#39)
* 80640c305  2026-06-16  feat(play): one active tab per player + lighter polling (Deploy 4 / Issue F) (#40)
* 792a5d0bd  2026-06-16  feat: shared cup bracket — visible to players + finished recap (Deploy A) (#41)
* 0b2ad5886  2026-09-05  fix(test): 60 s testTimeout — engine specs are node-budgeted, not time-budgeted (#90)
* b01c74d9d  2026-09-06  fix(host): time-up controls in the playoff bracket; fullscreen on lobby/standings/bracket/podium (#92)
* f574a6cc9  2026-09-06  feat(play): "your turn" cue for backgrounded tabs — title flash, vibration, opt-in notification (#93)
* 4bddb050b  2026-09-06  chore: error boundaries report to telemetry; LLM timeout under the client's; docs/hostname/copy fixes; missing CSS classes; loading.tsx (#94)
* 4c6ea679b  2026-09-06  ci: concurrency group, report artefact on green runs, explicit permissions, setup-cli check; wrangler compatibility_date bump (#96)
* 96f17bfbb  2026-09-06  fix(host): never show host/resume codes on the projector by default; confirm dialogs for kick/force/override (#97)
* 8fd01f908  2026-09-06  feat(coach): 18 verified lessons from piece moves to mate-in-one; progress + retry UX (#100)
* 12eee5042  2026-09-06  fix(realtime): broadcasts are hints — result never applied from payload, position provisional until the authoritative load; chess: topic prefix; presence tracks late subscribers (#101)
* 73917b31b  2026-09-06  feat(host): full results + print on the finished screen; result_source fair-play markers; tiebreak gloss; landing page value prop + /host link (#103)
* 2e1643762  2026-09-06  a11y(dialogs): shared Modal primitive (focus trap, Escape, focus return); no global Enter; draw offer dismiss ≠ decline; promotion Escape cancels; host modals get dialog semantics (#104)
* 45cefb4de  2026-09-06  fix(identity): per-tournament session keys with a last pointer + legacy migration; telemetry attributes only tournament events (#105)
* 319a66a87  2026-09-06  chore(deps): eslint 9 -> 10 (#106)
* b1d06e32d  2026-09-06  a11y: reduced-motion in JS, aria-pressed on toggle groups, 44 px targets, timer announcements, alert roles, undo/new-game guards, landscape + projector layouts (#107)
* 79b12b335  2026-09-06  feat(host): finish the league early (lower round count), teacher notes, solo link for waiting/eliminated students (#110)
* f562c9008  2026-09-06  ci(e2e): WebKit and OpenNext-runtime lanes (nightly) (#109)

Total un-ported: 20
```

**This overstates the real backlog.** Reconciled by hand against every TTT PR
#45–#57's actual squash-merge commit on `main` (`git log -1 --format=%B <sha>`,
not just its GitHub PR description — the two can differ, see below):

**Genuinely open (3):**

- **#105** (per-tournament session keys) — confirmed not ported: `lib/client/identity.ts`
  still keys everything off a single `"ttt:player"` slot per browser, the
  exact design #105 replaced in chess.
- **#110** (finish league early / teacher notes / solo link while waiting) —
  confirmed not ported: no `config.leagueRounds`-lowering route, no
  `NotesModal`, no `config.notes` field anywhere in this codebase.
- **#109** (WebKit + OpenNext-runtime nightly lanes) — merged into chess very
  recently, after most of this runde's TTT ports had already landed. TTT's
  own `nightly.yml` (desktop + mobile Chromium) predates and differs from
  what #109 adds; genuinely not reconciled yet.

**Script false positives (9) — already ported, but the port PR's *squash-merge
commit* on `main` doesn't carry the `Port of sundaychess#<NN>` line, only its
GitHub PR description does** (`#92`, `#93`, `#94`, `#96`, `#97`, `#101`,
`#103`, `#104`, `#107`). Each PR's title already names the chess PR inline —
`"... (port of chess #92/#93/#94/#97) (#51)"` — and whoever wrote the commit
seems to have treated that as sufficient, skipping the separate body line
this doc's own convention asks for. `port::extract_port_pr_refs` only matches
the literal substring `Port of sundaychess#`, so a lowercase `(port of chess
#NN)` in the subject line doesn't register. Verified against `main`:

| Chess PR | Ported by (TTT PR) | Commit-message evidence |
| --- | --- | --- |
| #92, #93, #94, #97 | #51 | Title: `"... (port of chess #92/#93/#94/#97) (#51)"`, body: co-author line only — no `Port of sundaychess#` line |
| #96 | #49 | Same pattern |
| #101 | #52 | Same pattern |
| #103, #104, #107 | #57 | Same pattern |

Contrast with #53 (ports chess #98/#99/#102) and #56 (ports chess #108), whose
commits on `main` *do* carry `Port of sundaychess#98, #99, and #102.` / `Port
of sundaychess#108 (dde863d).` in the body — and correctly don't appear in
the script's output at all. **Recommendation for whoever next touches the
tooling:** either keep writing the body line even when the title already
names the chess PR (the safer fix — no script change needed), or extend
`port::extract_port_pr_refs`/`port::chess_self_reports_port` to also
recognise `(port of chess #NN[/#NN...])` in a commit *subject*. Not fixed
here — this is a docs pass, not a script change.

**Closed independently, not a literal port (1):**

- **#106** (eslint 9→10) — TTT #54 applied the identical fix the same day,
  sourced from the sundayquiz pilot recipe (`quiz#28`), not from chess #106.
  Same class as the two entries already in `scripts/port-ignore.txt` (chess
  #85/#88 — each repo's dependency state is its own, so a same-day
  independent fix was never a literal port candidate).

**Deliberately not applicable (1):**

- **#100** (18-lesson chess coach curriculum) — chess-specific content with
  no `m,n,k` equivalent; see `docs/STABILITY-PROGRAM-2026-09.md` §"What was
  deliberately NOT ported".

**Pre-convention bookkeeping gap, not a content gap (5):** chess #37–#41
("Deploy 1"–"Deploy A", all 2026-06-16 — knockout-draw resolution, "out of
tournament" messaging, live-grid order + fullscreen, active-tab lifecycle,
shared cup bracket). Same class as the chess #44–#46/#48–#50 batch
`scripts/port-ignore.txt` already documents (pre-dates both porting
conventions), just never added to the allowlist. TTT already has
`FullscreenToggle.tsx`, `activeTab.ts`/`useActiveTab.ts`, `BracketBoard.tsx`,
and `no.player.outOfTournament`-style copy — strong circumstantial evidence
this functionality already exists (built at or before the 2026-06-16 clone,
same as the #44–#50 batch), but unlike that batch these five were never
individually diffed against a TTT equivalent and added to
`scripts/port-ignore.txt`. Left as backlog for whoever next maintains that
file, rather than asserted here without the file-by-file verification
`port-ignore.txt`'s own header requires.

**Net: the honest current backlog is 3 items (#105, #109, #110), not 20.**
