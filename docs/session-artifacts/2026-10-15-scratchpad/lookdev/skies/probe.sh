#!/bin/bash
# usage: probe.sh URL OUT.png [WAIT_SECONDS] [QUERY]
CHROMIUM_PATH="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)"
export CHROMIUM_PATH
cd /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/lookdev/skies || exit 1
exec xvfb-run -a -s '-screen 0 1920x1080x24' node probe.mjs "$@"
