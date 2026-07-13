#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./codex-profile-lib.sh
source "$script_dir/codex-profile-lib.sh"

workspace_path="${2:-$(pwd)}"
mkdir -p "$CODEX_HOME"
chmod 700 "$CODEX_HOME" 2>/dev/null || true
printf 'Opening VS Code with Codex profile "%s" and CODEX_HOME=%s\n' "$profile_id" "$CODEX_HOME"
CODEX_HOME="$CODEX_HOME" code "$workspace_path"
