#!/bin/bash
# Interleaved A/B of the 20-car physics cost benchmark: integration tip vs
# the merged physics worktree. Usage: phys-a256-ab.sh ROUNDS
S=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad
W=/home/user/Experiment-3/.claude/worktrees/agent-a256258307a3455a8
summary='import json,sys; r=json.load(sys.stdin); print(sys.argv[1], "wall %.3f cpu %.3f vehicle %.3f us/car-substep %.1f retired %d" % (r["medianTickMs"], r["medianCpuTickMs"], r["medianVehicleStepMsPerTick"], r["medianVehicleStepUsPerCarSubstep"], r["retired"]))'
for round in $(seq 1 ${1:-3}); do
  echo "round $round load $(cut -d' ' -f1 /proc/loadavg)"
  node --experimental-transform-types $S/phys-a256-integ/scripts/physics-cost.ts --repeat 1 --seconds 60 2>/dev/null | python3 -c "$summary" integration
  node --experimental-transform-types $W/scripts/physics-cost.ts --repeat 1 --seconds 60 2>/dev/null | python3 -c "$summary" merged
done
