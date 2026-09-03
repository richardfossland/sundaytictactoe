#!/usr/bin/env bash
# List sundaychess commits (since the TTT clone date) that touch at least one
# non-excluded path and have not yet been ported into this repo. This is the
# real backlog of un-ported chess infra work.
#
# "Already ported" is recognised two ways, since a port PR body can carry
# either form:
#   - a `(cherry picked from commit <sha>)` trailer — written automatically
#     by `git cherry-pick -x`, which scripts/port-from-chess.sh uses;
#   - a `Port of sundaychess#<NN>` line, where NN is a sundaychess PR number.
#     NN is mapped to the chess squash-merge commit via
#     `git log --grep "(#NN)"` against the chess remote (chess merges PRs
#     with GitHub's default squash subject "<subject> (#NN)").
# Both are looked for anywhere in this repo's history on origin/main.
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

port_pr_shas=()
while IFS= read -r pr_no; do
  [[ -z "$pr_no" ]] && continue
  sha="$(git log "$CHESS_MAIN" --format='%H %s' \
           | grep -F -- "(#${pr_no})" | head -1 | cut -d' ' -f1)"
  [[ -n "$sha" ]] && port_pr_shas+=("$sha")
done < <(git log "$TTT_HISTORY_REF" --format=%B \
           | grep -Eo 'Port of sundaychess#[0-9]+' \
           | grep -Eo '[0-9]+')

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
  subject="$(git log -1 --format=%s "$sha")"
  echo "* ${sha:0:9}  $commit_date  $subject"
  printf '    %s\n' "${non_excluded[@]}"
  echo
done < <(git log "$CHESS_MAIN" --since="$TTT_CLONE_DATE" --reverse --format=%H)

echo "Total un-ported: $backlog_count"
