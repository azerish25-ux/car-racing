#!/bin/bash
# Bake + preview every species listed in the arguments.
cd /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/veg/scripts || exit 1
for s in "$@"; do
  echo "=== $s"
  FACING=${FACING:-0.5} node --max-old-space-size=10000 --experimental-transform-types preview.ts ../src/landscape ../out "$s" 2>&1 | grep -v -i 'experimental\|trace-warnings'
done
