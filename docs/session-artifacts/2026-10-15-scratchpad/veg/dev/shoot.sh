#!/bin/bash
# Screenshot lookdev URLs: shoot.sh <url> <out.png> [<url> <out.png> ...]
CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)
export CHROMIUM_PATH
cd /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/veg/dev || exit 1
exec timeout 900 xvfb-run -a -s '-screen 0 1920x1080x24' node shoot.mjs "$@"
