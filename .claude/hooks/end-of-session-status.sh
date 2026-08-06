#!/usr/bin/env bash
# Stop hook: once per session, before Claude actually stops, require a short
# status — what changed, verification result, PR URL if one exists. Fires exactly
# once (tracked by a /tmp marker keyed on session_id) so it can't loop: first Stop
# attempt blocks with the reminder, Claude complies and tries to stop again, second
# attempt finds the marker and allows the stop through.
set -euo pipefail

INPUT="$(cat)"
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // "unknown"')"
MARKER="/tmp/claude-stop-status-reminder-${SESSION_ID}"

if [ -f "$MARKER" ]; then
  exit 0
fi
touch "$MARKER"

cat <<'EOF'
{"decision":"block","reason":"Before ending: state (1) what changed, (2) verification result (pass/fail), (3) the PR URL for this branch if one exists — check with `gh pr view --json url -q .url` — or say explicitly there is no PR / nothing was pushed."}
EOF
