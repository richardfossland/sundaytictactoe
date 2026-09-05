#!/usr/bin/env bash
# List sundaychess commits (since the TTT clone date) that touch at least one
# non-excluded path and have not yet been ported into this repo. This is the
# real backlog of un-ported chess infra work.
#
# "Already ported" is recognised three ways, since a port PR body can carry
# any of these forms:
#   - a `(cherry picked from commit <sha>)` trailer — written automatically
#     by `git cherry-pick -x`, which scripts/port-from-chess.sh uses;
#   - a `Port of sundaychess#<NN>` line, where NN is a sundaychess PR number.
#     A single mention can carry more than one NN — "Port of
#     sundaychess#66 and #70", "...#71 (the rig) and sundaychess#74 (the CI
#     job)", "...#64 (ef046d6) + #68" — every NN on that line is read, not
#     just the first (see port::extract_port_pr_refs in port-common.sh).
#     Each NN is mapped to the chess squash-merge commit via
#     `git log --grep "(#NN)"` against the chess remote (chess merges PRs
#     with GitHub's default squash subject "<subject> (#NN)").
#   - a `Port: TTT #<NN>` line in the CHESS-side commit's own body — the
#     mirror convention documented in sundaychess's docs/PORTING.md, for a
#     port that landed here without repeating the chess PR number.
# The first two are looked for anywhere in this repo's history on
# origin/main; the third is looked for directly on the chess commit.
#
# On top of that, scripts/port-ignore.txt is a manual allowlist for commits
# that predate all three conventions above (ported before they existed, or
# already part of TTT from the initial clone) plus a `pattern:` escape
# hatch for whole classes of commit that never need a real port (dependency
# bumps: dependabot runs independently in both repos already).
#
# Usage: scripts/port-status.sh
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=./lib/port-common.sh
source "$SCRIPT_DIR/lib/port-common.sh"

TTT_CLONE_DATE="2026-06-16"
TTT_HISTORY_REF="origin/main"

cd "$REPO_ROOT"

port::ensure_chess_remote
git fetch origin --quiet
port::load_exclude_patterns

CHESS_MAIN="${CHESS_REMOTE_NAME}/main"

port::load_ignore

# --- 1) SHAs referenced by a "(cherry picked from commit <sha>)" trailer ---

cherry_pick_shas=()
while IFS= read -r sha; do
  [[ -z "$sha" ]] && continue
  resolved="$(git rev-parse --verify "${sha}^{commit}" 2>/dev/null || true)"
  [[ -n "$resolved" ]] && cherry_pick_shas+=("$resolved")
done < <(git log "$TTT_HISTORY_REF" --format=%B \
           | grep -Eo '\(cherry picked from commit [0-9a-f]{7,40}\)' \
           | grep -Eo '[0-9a-f]{7,40}')

# --- 2) "Port of sundaychess#<NN>" -> NN mapped to the chess squash SHA ----
# A mention can name more than one NN (combined ports); every one is read.

port_pr_shas=()
while IFS= read -r pr_no; do
  [[ -z "$pr_no" ]] && continue
  sha="$(git log "$CHESS_MAIN" --format='%H %s' \
           | grep -F -- "(#${pr_no})" | head -1 | cut -d' ' -f1)"
  [[ -n "$sha" ]] && port_pr_shas+=("$sha")
done < <(git log "$TTT_HISTORY_REF" --format=%B | port::extract_port_pr_refs)

ported_shas=("${cherry_pick_shas[@]}" "${port_pr_shas[@]}")

port::is_ported() {
  local sha="$1" p
  for p in "${ported_shas[@]}"; do
    [[ "$p" == "$sha" ]] && return 0
  done
  return 1
}

# --- 3) walk chess/main since the TTT clone date, oldest first ------------

echo "Un-ported sundaychess commits touching non-excluded paths"
echo "(chess/main since $TTT_CLONE_DATE, checked against $TTT_HISTORY_REF):"
echo

backlog_count=0
while IFS= read -r sha; do
  [[ -z "$sha" ]] && continue
  port::is_ported "$sha" && continue
  port::chess_self_reports_port "$sha" && continue

  subject="$(git log -1 --format=%s "$sha")"
  port::is_ignored "$sha" "$subject" && continue

  changed_files=()
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    changed_files+=("$f")
  done < <(git show --name-only --pretty=format: "$sha")

  non_excluded=()
  for f in "${changed_files[@]}"; do
    port::is_excluded "$f" || non_excluded+=("$f")
  done
  [[ "${#non_excluded[@]}" -eq 0 ]] && continue

  backlog_count=$((backlog_count + 1))
  commit_date="$(git log -1 --format=%as "$sha")"
  echo "* ${sha:0:9}  $commit_date  $subject"
  printf '    %s\n' "${non_excluded[@]}"
  echo
done < <(git log "$CHESS_MAIN" --since="$TTT_CLONE_DATE" --reverse --format=%H)

echo "Total un-ported: $backlog_count"
