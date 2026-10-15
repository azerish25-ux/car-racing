#!/bin/bash
# Print size/channels/alpha range of each landscape texture and build a montage.
T=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/veg/src/landscape/textures
OUT=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/veg/preview
mkdir -p "$OUT/thumbs"
for f in "$T"/*.png; do
  n=$(basename "$f" .png)
  info=$(identify -format '%wx%h %[channels] %[type]' "$f" 2>/dev/null)
  amin=$(convert "$f" -alpha extract -format '%[fx:minima]' info: 2>/dev/null)
  echo "$n $info alphaMin=$amin"
  convert "$f" -resize 160x160 -background '#808080' -flatten "$OUT/thumbs/$n.png"
done
montage "$OUT"/thumbs/*.png -tile 10x -geometry 160x160+4+14 -pointsize 9 -set label '%t' "$OUT/textures.jpg"
