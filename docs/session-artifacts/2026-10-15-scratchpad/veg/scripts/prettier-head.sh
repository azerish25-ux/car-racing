#!/bin/bash
# For each file: was it prettier-clean at HEAD? (run from the worktree)
cd /home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3 || exit 1
tmp=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/veg/head-check.txt
for f in "$@"; do
  git show "HEAD:$f" > "$tmp" 2>/dev/null || { echo "$f new"; continue; }
  if npx prettier --stdin-filepath "$f" --check < "$tmp" > /dev/null 2>&1; then echo "$f clean-at-HEAD"; else echo "$f unformatted-at-HEAD"; fi
done
