#!/bin/bash
cd /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/lookdev/skies || exit 1
K=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/asset-scout/hdri-kubric/x
D=dl/x
for pair in "mud_road:$K/mud_road/mud_road_4k.hdr" "winter_lake_01:$D/winter_lake_01/environment_4k.hdr" \
  "kloppenheim_01:$D/kloppenheim_01/environment_4k.hdr" "quarry_02:$D/quarry_02/environment_4k.hdr" \
  "waterbuck_trail:$D/waterbuck_trail/environment_4k.hdr" "table_mountain_1:$K/table_mountain_1/table_mountain_1_4k.hdr"; do
  name="${pair%%:*}"; file="${pair#*:}"
  node --experimental-transform-types strip.ts "$file" "strip-$name.ppm" 0.4 >/dev/null 2>&1
  convert "strip-$name.ppm" -crop 1024x182+0+0 +repage "s-$name-1.png"
  convert "strip-$name.ppm" -crop 1024x182+0+182 +repage "s-$name-2.png"
  convert "strip-$name.ppm" -crop 1024x182+0+364 +repage "s-$name-3.png"
  convert "strip-$name.ppm" -crop 1024x182+0+546 +repage "s-$name-4.png"
  montage "s-$name-1.png" "s-$name-2.png" "s-$name-3.png" "s-$name-4.png" -tile 1x -geometry +0+3 "strips-$name.png"
  echo "$name done"
done
