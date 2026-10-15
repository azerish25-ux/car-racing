#!/bin/bash
cd /home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1
L=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/offroad-suite
for s in test:offroad validate:content test:vehicles test:bikes test:physics build; do
  npm run $s > $L-$s.log 2>&1
  echo "$s exit $?" >> $L-summary.log
done
npm test -- --reporter=dot > $L-test.log 2>&1
echo "test exit $?" >> $L-summary.log
echo "ALL DONE" >> $L-summary.log
