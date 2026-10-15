#!/bin/bash
# Download every landscape file named in plan.tsv (column 2) into src/landscape/,
# reusing the asset-scout copies. Writes src/manifest.tsv in the asset-scout
# format (category, status, bytes, url, path) for build-third-party --reuse.
set -u
VEG=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/veg
SCOUT=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/asset-scout/models/mmp_pbrt-v4-scenes/landscape
BASE=https://raw.githubusercontent.com/mmp/pbrt-v4-scenes/30cf4a0346ae5a80a2d7a530a3ef7d0fa4f70572/landscape
OUT=$VEG/src/landscape
mkdir -p "$OUT/geometry" "$OUT/textures"
: > "$VEG/src/manifest.tsv.tmp"
for rel in $(cut -f2 "$VEG/plan.tsv" | sort -u) geometry/geometry.pbrt; do
  dest="$OUT/$rel"
  if [ ! -s "$dest" ]; then
    if [ -s "$SCOUT/$rel" ]; then
      cp "$SCOUT/$rel" "$dest"
    else
      curl -sSfL --retry 3 -o "$dest" "$BASE/$rel" || echo "FAILED $rel"
    fi
  fi
  bytes=$(stat -c %s "$dest" 2>/dev/null || echo 0)
  printf 'landscape\t200\t%s\t%s\t%s\n' "$bytes" "$BASE/$rel" "$dest" >> "$VEG/src/manifest.tsv.tmp"
done
mv "$VEG/src/manifest.tsv.tmp" "$VEG/src/manifest.tsv"
du -sh "$OUT"
