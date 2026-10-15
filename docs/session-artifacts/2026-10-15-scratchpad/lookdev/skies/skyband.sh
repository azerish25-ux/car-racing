#!/bin/bash
cd /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/lookdev/skies || exit 1
mkdir -p skyband
K=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/asset-scout/hdri-kubric/x
D=dl/x
node --experimental-transform-types skyband.ts skyband \
  "$K/kiara_5_noon/kiara_5_noon_4k.hdr@10" "$D/goegap/environment_4k.hdr@0" "$D/quarry_02/environment_4k.hdr@16" \
  "$K/rural_landscape/rural_landscape_4k.hdr@9" "$D/waterbuck_trail/environment_4k.hdr@7" "$D/cannon/environment_4k.hdr@12" \
  "$K/mud_road/mud_road_4k.hdr@3" "$D/kloppenheim_01/environment_4k.hdr@3" "$D/winter_lake_01/environment_4k.hdr@4" \
  "$K/table_mountain_1/table_mountain_1_4k.hdr@0" "$K/kiara_8_sunset/kiara_8_sunset_4k.hdr@0" \
  "$K/syferfontein_0d_clear/syferfontein_0d_clear_4k.hdr@0" "$K/kloppenheim_02/kloppenheim_02_4k.hdr@3" \
  "$K/kloppenheim_04/kloppenheim_04_4k.hdr@0" 2>&1 | grep -vi warn
cd skyband || exit 1
montage sky-kiara_5_noon.ppm sky-goegap.ppm sky-quarry_02.ppm sky-rural_landscape.ppm sky-waterbuck_trail.ppm -tile 1x -geometry 1024x+0+4 m1.jpg
montage sky-cannon.ppm sky-mud_road.ppm sky-kloppenheim_01.ppm sky-winter_lake_01.ppm sky-table_mountain_1.ppm -tile 1x -geometry 1024x+0+4 m2.jpg
montage sky-kiara_8_sunset.ppm sky-syferfontein_0d_clear.ppm sky-kloppenheim_02.ppm sky-kloppenheim_04.ppm -tile 1x -geometry 1024x+0+4 m3.jpg
