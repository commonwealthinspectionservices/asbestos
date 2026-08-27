#!/bin/bash
# Loads the project's Supabase credentials from .env.local and runs the
# report sync. Called directly, or on a schedule by the LaunchAgent
# installed alongside this script (see ~/Library/LaunchAgents). Avoids
# `source <(...)` process substitution — confirmed live: macOS's system
# /bin/bash (3.2, ancient) silently drops every variable it "sets" that
# way when run non-interactively as a script file (works fine typed
# directly into an interactive zsh session, which is a different shell
# entirely) — a plain while-read loop works the same everywhere.
set -euo pipefail
cd "$(dirname "$0")/.."

# launchd runs this with a minimal PATH (no nvm shell init), so node/npx
# aren't found unless we add nvm's current bin dir explicitly.
export PATH="/Users/timothyhall/.nvm/versions/node/v24.18.0/bin:$PATH"

set -a
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    [A-Z_]*=*) eval "$line" ;;
  esac
done < .env.local
set +a

exec npx tsx --tsconfig scripts/tsconfig.sync.json scripts/sync-final-reports.mts
