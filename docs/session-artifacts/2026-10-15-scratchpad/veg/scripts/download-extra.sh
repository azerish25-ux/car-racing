#!/bin/bash
# Fetch the second fir (Abies_concolor_01medium, meshes 1-6) into src/landscape.
VEG=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/veg
BASE=https://raw.githubusercontent.com/mmp/pbrt-v4-scenes/30cf4a0346ae5a80a2d7a530a3ef7d0fa4f70572/landscape
for i in 1 2 3 4 5 6; do
  rel=$(printf 'geometry/mesh_%05d.ply' "$i")
  dest="$VEG/src/landscape/$rel"
  [ -s "$dest" ] || curl -sSfL --retry 3 -o "$dest" "$BASE/$rel" || echo "FAILED $rel"
  printf 'landscape\t200\t%s\t%s\t%s\n' "$(stat -c %s "$dest")" "$BASE/$rel" "$dest" >> "$VEG/src/manifest.tsv"
done
echo done
