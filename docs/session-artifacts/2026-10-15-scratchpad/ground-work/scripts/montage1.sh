#!/bin/bash
set -e
W=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/ground-work
S=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/asset-scout/textures
E=$S/npm_aframe-enviropacks-0.10.0/package/asset
montage -label '%f' \
  $S/pmndrs_market-assets/files/materials/grass/Grass001_1K_Color.jpg \
  $E/aerial_grass_rock_2k_jpg/aerial_grass_rock_diff_2k.jpg \
  $E/forrest_ground_03_2k_jpg/forrest_ground_03_diff_2k.jpg \
  $E/sandstone_cracks_2k_jpg/sandstone_cracks_diff_2k.jpg \
  $S/mmp_pbrt-v4-scenes/bistro/textures/Pavement_Ground_Wet_BaseColor.png \
  $S/KhronosGroup_glTF-Sample-Assets/Models/TrafficCone/glTF/asphalt_02_diff_1k.jpg \
  -geometry 600x600+4+4 -tile 3x2 $W/check/candidates1.jpg
montage -label '%f' \
  $S/playcanvas_engine/examples/assets/textures/ground092c/color.webp \
  $E/Snow004_2K-JPG/Snow004_2K_Color.jpg \
  $S/mmp_pbrt-v4-scenes/bistro/textures/MASTER_Concrete_Plaster_BaseColor.png \
  $S/pmndrs_market-assets/files/materials/rock/Rock020_1K_Color.jpg \
  $E/rock_05_2k_jpg/rock_05_diff_2k.jpg \
  $S/TokisanGames_Terrain3D/project/demo/assets/textures/ground037_alb_ht.png \
  -geometry 600x600+4+4 -tile 3x2 $W/check/candidates2.jpg
# crops at native resolution (512 px windows)
convert $S/pmndrs_market-assets/files/materials/grass/Grass001_1K_Color.jpg -crop 512x512+0+0 $W/check/crop-grass001.png
convert $E/aerial_grass_rock_2k_jpg/aerial_grass_rock_diff_2k.jpg -crop 512x512+400+400 $W/check/crop-aerial.png
convert $S/mmp_pbrt-v4-scenes/bistro/textures/Pavement_Ground_Wet_BaseColor.png -crop 512x512+400+400 $W/check/crop-pavement.png
convert $S/KhronosGroup_glTF-Sample-Assets/Models/TrafficCone/glTF/asphalt_02_diff_1k.jpg -crop 512x512+200+200 $W/check/crop-asphalt02.png
montage $W/check/crop-grass001.png $W/check/crop-aerial.png $W/check/crop-pavement.png $W/check/crop-asphalt02.png -geometry 512x512+2+2 -tile 4x1 $W/check/crops1.jpg
