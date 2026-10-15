#!/bin/bash
# Build the ground department's third-party texture sets in the worktree.
set -e
SP=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad
WT=/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-2
cd "$WT"
mkdir -p "$WT/.cache"
if [ ! -e "$WT/.cache/third-party" ] && [ -d /home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1/.cache/third-party ]; then
  cp -r /home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1/.cache/third-party "$WT/.cache/third-party"
fi
ONLY=${1:-ground-lawn,ground-meadow,ground-forest-floor,ground-dry-earth,ground-asphalt,ground-wet-earth,ground-concrete,ground-rock,ground-snow}
node --experimental-transform-types scripts/assets/build-third-party.ts \
  --tools "$SP/tools/node_modules" \
  --reuse "$SP/asset-scout" \
  --toktx "$SP/tools/ktx/KTX-Software-4.4.2-Linux-x86_64/bin/toktx" \
  --only "$ONLY"
