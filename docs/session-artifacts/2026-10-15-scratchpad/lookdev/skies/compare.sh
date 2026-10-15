#!/bin/bash
set -e
L=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/lookdev/skies
R=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/showcase/runs
cd "$L"
montage -label 'BEFORE' "$R/b/04-multiclass-pack-aurel.png" -label 'AFTER' after4/04-multiclass-pack-aurel.png \
  -label '' "$R/a/03-gpr1-poggio-alto-lean.png" -label '' after4/03-gpr1-poggio-alto-lean.png \
  -label '' "$R/a/03-gpr1-poggio-alto-trackside.png" -label '' after4/03-gpr1-poggio-alto-trackside.png \
  -tile 2x -geometry 960x540+4+4 -pointsize 22 compare-day.jpg
montage -label 'BEFORE' before-festival/08-festival-port-ilse-golden-hour.png -label 'AFTER' after4/08-festival-port-ilse-golden-hour.png \
  -label '' before-festival/09b-festival-drive-1.png -label '' after4/09b-festival-drive-1.png \
  -label '' "$R/b/06-neon-city-night-gt10m.png" -label '' after4/06-neon-city-night-gt10m.png \
  -tile 2x -geometry 960x540+4+4 -pointsize 22 compare-festival-night.jpg
montage -label 'BEFORE' "$R/b/04-multiclass-pack-aurel-trackside.png" -label 'AFTER' after4/04-multiclass-pack-aurel-trackside.png \
  -label '' "$R/a/10-valley-ridge-mx450-airborne.png" -label '' after4/10-valley-ridge-mx450-airborne.png \
  -tile 2x -geometry 960x540+4+4 -pointsize 22 compare-other.jpg
ls -la compare-*.jpg
