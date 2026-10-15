#!/bin/bash
# capture.sh OUT_NAME SESSIONS [PRESET] [PORT]
SP=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad
OUT=$SP/lookdev/ground/$1
SESSIONS=$2
PRESET=${3:-ultra}
PORT=${4:-5392}
cd $SP/showcase || exit 1
export CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
xvfb-run -a -s '-screen 0 1920x1080x24' node --experimental-transform-types showcase.mjs \
  --repo /home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-2 \
  --url http://127.0.0.1:$PORT/ --out "$OUT" --size 1280x720 --preset "$PRESET" --backend mesa \
  --sessions "$SESSIONS"
echo "CAPTURE EXIT $?"
