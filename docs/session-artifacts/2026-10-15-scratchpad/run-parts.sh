#!/bin/bash
# Partitioned capture: each part is a fresh browser (the shared host's memory
# cgroup OOM-kills a single long-running llvmpipe GPU process).
S=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad
REPO=/home/user/Experiment-3/.claude/worktrees/wf_ef3f8a4a-fe2-5
export CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)
URL=http://127.0.0.1:37483/
run() {
  local name=$1
  shift
  local out=$S/art/after-parts/$name
  if [ -f "$out/.done" ]; then echo "part $name already done"; return; fi
  rm -rf "$out"
  echo "part $name start $(date +%T)"
  xvfb-run -a -s '-screen 0 1920x1080x24' node --experimental-transform-types $S/live-capture-skip.mjs \
    --repo $REPO --url $URL --out "$out" --backend ${BACKEND:-mesa} "$@" > $S/art/after-parts/$name.log 2>&1
  local code=$?
  echo "part $name exit $code $(date +%T)"
  [ $code -eq 0 ] && touch "$out/.done"
}
mkdir -p $S/art/after-parts
for part in "$@"; do
  case $part in
    dryA) run dryA --sessions dry --skip 06 ;;
    dryB) run dryB --sessions dry --skip 02,07,01,09,08,05 ;;
    rain) run rain --sessions rain ;;
    neon) run neon --sessions neon ;;
    festival) run festival --sessions festival ;;
  esac
done
echo "all parts finished $(date +%T)"
