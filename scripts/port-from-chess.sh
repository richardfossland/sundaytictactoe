#!/usr/bin/env bash
# Port one or more sundaychess commits onto SundayTicTacToe, stripping every
# chess-only path listed in scripts/port-exclude.txt along the way.
#
# Usage:
#   scripts/port-from-chess.sh <sha> [<sha> ...]
#
# For each <sha> (in the order given):
#   1. `git cherry-pick -x <sha>`     — commits immediately, so the message
#                                       carries the real "(cherry picked from
#                                       commit ...)" provenance trailer
#   2. restore every path matching scripts/port-exclude.txt to its
#      pre-cherry-pick (HEAD~1) state (tracked paths: `git checkout HEAD~1
#      -- <path>`; paths newly added by the commit: `git rm -f`)
#   3. grep the remaining diff against HEAD~1 for chess-flavoured leakage
#      and print a WARNING per hit (does not abort — for a human to judge)
#   4a. if the exclusions left no difference from HEAD~1 at all, the commit
#       was chess-only end to end — drop it (`git reset --hard HEAD~1`)
#   4b. otherwise `git commit --amend --no-edit` — same message (provenance
#       trailer intact), tree now excludes the chess-only paths
#   5. `npm run check`                — once, after the whole batch
#
# A cherry-pick conflict is left exactly as git left it, for a human to
# resolve (`git cherry-pick --continue` or `--abort`) — the script does not
# touch it further and exits non-zero. A `npm run check` failure after
# porting also exits non-zero.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=./lib/port-common.sh
source "$SCRIPT_DIR/lib/port-common.sh"

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <sha> [<sha> ...]" >&2
  exit 2
fi

cd "$REPO_ROOT"

# Chess-flavoured strings that should never survive into a TTT commit even
# after path exclusion (e.g. a shared file that mentions chess inline).
LEAK_PATTERN='sjakk:|sundaychess|chess\.sundaysuite|CHESS_ADMIN|lib/chess|app/host/\['

port::ensure_chess_remote
port::load_exclude_patterns

overall_status=0
ported=()
skipped_empty=()
failed=()

for input_sha in "$@"; do
  full_sha="$(git rev-parse --verify "${input_sha}^{commit}" 2>/dev/null || true)"
  if [[ -z "$full_sha" ]]; then
    echo "== $input_sha: not a known commit (even after fetching $CHESS_REMOTE_NAME) — skipping" >&2
    failed+=("$input_sha")
    overall_status=1
    continue
  fi

  subject="$(git log -1 --format='%s' "$full_sha")"
  echo "== porting $full_sha: $subject"

  if ! git cherry-pick -x "$full_sha"; then
    echo "!! cherry-pick of $full_sha conflicted." >&2
    echo "   Resolve by hand (restore any port-exclude.txt paths yourself), then either:" >&2
    echo "     git cherry-pick --continue" >&2
    echo "   or give up on this one with:" >&2
    echo "     git cherry-pick --abort" >&2
    failed+=("$full_sha")
    overall_status=1
    break # a cherry-pick is now in progress; further picks would just fail too
  fi

  # Restore every excluded path to its state at HEAD~1 (i.e. before this
  # commit). The commit now sitting at HEAD is our working copy — we edit its
  # tree in place via checkout/rm below, then amend.
  restored=()
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if port::is_excluded "$path"; then
      restored+=("$path")
      if git cat-file -e "HEAD~1:$path" 2>/dev/null; then
        # Existed before this commit — put it back exactly as it was.
        git checkout HEAD~1 -- "$path"
      else
        # Newly added by this commit — drop it entirely.
        git rm -f --ignore-unmatch -- "$path" >/dev/null
      fi
    fi
  done < <(git diff --name-only HEAD~1 HEAD)

  if [[ "${#restored[@]}" -gt 0 ]]; then
    echo "   excluded ${#restored[@]} path(s):"
    printf '     %s\n' "${restored[@]}"
  fi

  # Warn (don't abort) on chess-flavoured leakage in what's left.
  leak_hits="$(git diff --cached HEAD~1 | grep -aEin "$LEAK_PATTERN" || true)"
  if [[ -n "$leak_hits" ]]; then
    echo "WARNING: possible chess leakage survived exclusion in $full_sha:" >&2
    while IFS= read -r hit; do echo "    $hit" >&2; done <<< "$leak_hits"
  fi

  if git diff --cached --quiet HEAD~1; then
    echo "   nothing left to port after exclusions — dropping this commit"
    git reset --hard --quiet HEAD~1
    skipped_empty+=("$full_sha")
    continue
  fi

  git commit --amend --no-edit --quiet
  ported+=("$full_sha")
done

echo
echo "== summary =="
echo "ported: ${#ported[@]}"
[[ "${#ported[@]}" -gt 0 ]] && printf '  %s\n' "${ported[@]}"
echo "fully excluded (nothing to port): ${#skipped_empty[@]}"
[[ "${#skipped_empty[@]}" -gt 0 ]] && printf '  %s\n' "${skipped_empty[@]}"
echo "failed: ${#failed[@]}"
[[ "${#failed[@]}" -gt 0 ]] && printf '  %s\n' "${failed[@]}"

if [[ "${#ported[@]}" -gt 0 ]]; then
  echo
  echo "== npm run check =="
  if ! npm run check; then
    echo "!! npm run check failed after porting — fix before opening a PR" >&2
    overall_status=1
  fi
fi

exit "$overall_status"
