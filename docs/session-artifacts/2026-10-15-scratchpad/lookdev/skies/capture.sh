#!/bin/bash
# usage: capture.sh PORT OUTDIR SESSIONS [PRESET]
set -u
PORT="$1"; OUT="$2"; SESSIONS="$3"; PRESET="${4:-ultra}"
CHROMIUM_PATH="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)"
export CHROMIUM_PATH
cd /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/showcase || exit 1
exec xvfb-run -a -s '-screen 0 1920x1080x24' node --experimental-transform-types showcase.mjs \
  --repo /home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1 \
  --url "http://127.0.0.1:${PORT}/" --out "$OUT" --size 1280x720 --preset "$PRESET" --backend mesa \
  --sessions "$SESSIONS"
