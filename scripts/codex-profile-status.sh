#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./codex-profile-lib.sh
source "$script_dir/codex-profile-lib.sh"

printf 'Checking Codex profile "%s" with CODEX_HOME=%s\n' "$profile_id" "$CODEX_HOME"
exec "$CODEX_BIN" login status
