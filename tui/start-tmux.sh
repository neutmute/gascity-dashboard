#!/usr/bin/env bash
# Launch the Gas City TUI inside tmux so the live-peek split (enter) works.
#
#   ./tui/start-tmux.sh <city>        # or set GC_CITY_NAME
#   npm --workspace tui run start:tmux -- <city>
#
# If you are already inside tmux, it runs directly (peek splits the current
# window). Otherwise it creates/attaches a dedicated `gc-tui` session so the
# TUI has a tmux to split into.
set -euo pipefail

city="${1:-${GC_CITY_NAME:-}}"
city_flag=""
[ -n "$city" ] && city_flag="-- --city=$city"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
run="cd '$root' && npm --workspace tui run start $city_flag"

if [ -n "${TMUX:-}" ]; then
  # Already in tmux — run directly; enter-peek splits the current window.
  eval "$run"
else
  # Not in tmux — start a CLEAN dedicated session: kill any stale `gc-tui`
  # (orphan peek panes from a previous run) first, then create fresh.
  tmux kill-session -t gc-tui 2>/dev/null || true
  exec tmux new-session -s gc-tui "$run"
fi
