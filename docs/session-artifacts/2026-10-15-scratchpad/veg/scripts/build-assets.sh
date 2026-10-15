#!/bin/bash
# Build the vegetation register entries (or the ids given) through the shared pipeline.
S=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad
cd /home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3 || exit 1
ONLY=${1:-tree-linden,tree-chestnut,tree-birch,tree-rowan,tree-fir,tree-fir-b,shrub-flowering,grass-meadow}
node --max-old-space-size=10000 --experimental-transform-types scripts/assets/build-third-party.ts \
  --tools "$S/tools/node_modules" \
  --toktx "$S/tools/ktx/KTX-Software-4.4.2-Linux-x86_64/bin/toktx" \
  --reuse "$S/veg/src" \
  --only "$ONLY" 2>&1 | grep -v 'ExperimentalWarning\|trace-warnings\|reused https'
