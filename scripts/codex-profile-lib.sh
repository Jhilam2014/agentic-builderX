#!/usr/bin/env bash
set -euo pipefail

profile_id="${1:-}"
case "$profile_id" in
  *[!A-Za-z0-9._-]*|*..*|*/*|*\\*|"")
    printf 'Invalid profile id: %s\n' "$profile_id" >&2
    exit 2
    ;;
esac

codex_home="${CODEX_PROFILES_ROOT:-$HOME/.codex-profiles}/$profile_id"

case "$codex_home" in
  "~"*) codex_home="$HOME${codex_home#~}" ;;
esac

export CODEX_HOME="$codex_home"
export CODEX_BIN="${CODEX_BIN:-codex}"
