#!/usr/bin/env bash
# Shared helpers for scripts/port-from-chess.sh and scripts/port-status.sh.
# Not executable on its own — sourced by both.

CHESS_REMOTE_NAME="chess"
CHESS_REMOTE_URL="https://github.com/richardfossland/sundaychess.git"

_PORT_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT_EXCLUDE_FILE="$_PORT_COMMON_DIR/../port-exclude.txt"
PORT_IGNORE_FILE="$_PORT_COMMON_DIR/../port-ignore.txt"

PORT_EXCLUDE_PATTERNS=()
PORT_IGNORE_SHAS=()
PORT_IGNORE_PATTERNS=()

# Make sure the read-only `chess` remote exists, then fetch it. We only ever
# read from this remote (fetch) — never add a push URL, never push to it.
port::ensure_chess_remote() {
  if ! git remote get-url "$CHESS_REMOTE_NAME" >/dev/null 2>&1; then
    echo "Adding read-only remote '$CHESS_REMOTE_NAME' -> $CHESS_REMOTE_URL" >&2
    git remote add "$CHESS_REMOTE_NAME" "$CHESS_REMOTE_URL"
    # Belt and suspenders: this remote is fetch-only. Point its push URL at
    # a bogus target so an accidental `git push chess` fails fast instead of
    # actually reaching sundaychess.
    git remote set-url --push "$CHESS_REMOTE_NAME" "DISABLED_read_only_remote_do_not_push"
  fi
  echo "Fetching $CHESS_REMOTE_NAME ..." >&2
  git fetch "$CHESS_REMOTE_NAME" --quiet
}

# Populate the global PORT_EXCLUDE_PATTERNS array from port-exclude.txt,
# skipping blank lines and comments.
port::load_exclude_patterns() {
  shopt -s extglob
  PORT_EXCLUDE_PATTERNS=()
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    # trim leading/trailing whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    PORT_EXCLUDE_PATTERNS+=("$line")
  done < "$PORT_EXCLUDE_FILE"
}

# port::is_excluded <repo-relative-path>
# `*` matches anything including `/`. `[` and `]` are literal (Next.js route
# folders like `[tournamentId]` are real directory names, not a bracket
# expression), so we escape them before handing the pattern to bash's
# `[[ == ]]` matcher.
port::is_excluded() {
  local path="$1" pattern escaped
  for pattern in "${PORT_EXCLUDE_PATTERNS[@]}"; do
    escaped="${pattern//\[/\\[}"
    escaped="${escaped//\]/\\]}"
    # Intentionally unquoted: $escaped must be interpreted as a glob (the
    # whole point is `*` wildcard matching), not compared literally.
    # shellcheck disable=SC2053
    if [[ "$path" == $escaped ]]; then
      return 0
    fi
  done
  return 1
}

# Populate PORT_IGNORE_SHAS (resolved full-length chess SHAs) and
# PORT_IGNORE_PATTERNS (extended regexes tested against a commit *subject*)
# from scripts/port-ignore.txt. Two entry shapes, one per non-comment line:
#   <sha-or-#NN>  free-text comment          (the equivalent-commit case)
#   pattern:<ERE>                            (the whole-class case, e.g.
#                                              dependabot bump commits)
# A `#NN` entry is resolved to the chess squash-merge SHA the same way
# port-status.sh resolves a `Port of sundaychess#NN` reference: by grepping
# `chess/main` for GitHub's default squash subject `... (#NN)`. Requires
# CHESS_MAIN to already be set and the chess remote already fetched.
# A line is a full-line comment only when it starts with "# " (or is bare
# "#") — a line starting "#NN" (no space after the hash) is a PR-number
# entry, since PR-number entries and comments both start with `#`.
port::load_ignore() {
  PORT_IGNORE_SHAS=()
  PORT_IGNORE_PATTERNS=()
  [[ -f "$PORT_IGNORE_FILE" ]] || return 0
  local line token
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    case "$line" in
      '#'|'# '*) continue ;;
      pattern:*)
        PORT_IGNORE_PATTERNS+=("${line#pattern:}")
        continue
        ;;
    esac
    token="${line%%[[:space:]]*}"
    if [[ "$token" == \#* ]]; then
      local nn="${token#\#}" sha
      sha="$(git log "$CHESS_MAIN" --format='%H %s' \
               | grep -F -- "(#${nn})" | head -1 | cut -d' ' -f1)"
      [[ -n "$sha" ]] && PORT_IGNORE_SHAS+=("$sha")
    else
      local resolved
      resolved="$(git rev-parse --verify "${token}^{commit}" 2>/dev/null || true)"
      [[ -n "$resolved" ]] && PORT_IGNORE_SHAS+=("$resolved")
    fi
  done < "$PORT_IGNORE_FILE"
}

# port::is_ignored <chess-sha> <commit-subject>
# True if scripts/port-ignore.txt says this chess commit is a known
# equivalent (already covered by some other TTT commit, so port-status.sh
# should not list it as backlog) — by explicit SHA/#NN, or because its
# subject matches one of the `pattern:` entries.
port::is_ignored() {
  local sha="$1" subject="$2" p
  for p in "${PORT_IGNORE_SHAS[@]}"; do
    [[ "$p" == "$sha" ]] && return 0
  done
  for p in "${PORT_IGNORE_PATTERNS[@]}"; do
    [[ "$subject" =~ $p ]] && return 0
  done
  return 1
}

# port::extract_port_pr_refs <commit-bodies-on-stdin>
# Print every PR number referenced by a `Port of sundaychess#<NN>` mention,
# one per line — including every number in a combined mention such as
# "Port of sundaychess#66 and #70", "...#71 (the rig) and
# sundaychess#74 (the CI job)", or "...#64 (ef046d6) + #68". Only a line
# that literally contains "Port of sundaychess#" is considered; on that
# line, only the part from "sundaychess" onward is scanned, cut at the
# line's first ". " (sentence end) if there is one, so prose that follows
# the port mention on the same line can't leak an unrelated "#NN" in.
port::extract_port_pr_refs() {
  local line after
  while IFS= read -r line; do
    [[ "$line" == *"Port of sundaychess#"* ]] || continue
    after="${line#*sundaychess}"
    after="${after%%. *}"
    grep -Eo '#[0-9]+' <<< "$after" | tr -d '#' || true
  done
}

# port::chess_self_reports_port <chess-sha>
# True if the CHESS-side commit's own body carries the chess-side
# convention (`Port: TTT #<NN>`, see sundaychess's docs/PORTING.md) saying
# it has already been ported here — the mirror of TTT's own `Port of
# sundaychess#<NN>` line. Runs against the chess remote, so it works even
# for a chess commit whose port landed here without repeating its number.
port::chess_self_reports_port() {
  local sha="$1"
  git log -1 --format=%B "$sha" 2>/dev/null | grep -qE 'Port: TTT #[0-9]+'
}
