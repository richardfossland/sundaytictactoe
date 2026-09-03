#!/usr/bin/env bash
# Shared helpers for scripts/port-from-chess.sh and scripts/port-status.sh.
# Not executable on its own — sourced by both.

CHESS_REMOTE_NAME="chess"
CHESS_REMOTE_URL="https://github.com/richardfossland/sundaychess.git"

_PORT_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT_EXCLUDE_FILE="$_PORT_COMMON_DIR/../port-exclude.txt"

PORT_EXCLUDE_PATTERNS=()

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
