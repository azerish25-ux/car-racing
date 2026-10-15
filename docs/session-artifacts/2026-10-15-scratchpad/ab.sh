#!/bin/bash
# Interleaved A/B of the 20-car physics cost benchmark. Run from the worktree.
S=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad
cp scripts/physics-cost.ts $S/baseline/scripts/physics-cost.ts
summary='import json,sys; r=json.load(sys.stdin); print(sys.argv[1], "wall %.3f cpu %.3f vehicle %.3f us/car-substep %.1f retired %d" % (r["medianTickMs"], r["medianCpuTickMs"], r["medianVehicleStepMsPerTick"], r["medianVehicleStepUsPerCarSubstep"], r["retired"]))'
for round in $(seq 1 ${1:-4}); do
  echo "round $round load $(cut -d' ' -f1 /proc/loadavg)"
  node --experimental-transform-types $S/baseline/scripts/physics-cost.ts --repeat 1 --seconds 60 2>/dev/null | python3 -c "$summary" baseline
  node --experimental-transform-types scripts/physics-cost.ts --repeat 1 --seconds 60 2>/dev/null | python3 -c "$summary" v2
done
