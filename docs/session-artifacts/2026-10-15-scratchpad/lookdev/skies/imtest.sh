#!/bin/bash
set -eu
mkdir -p /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/lookdev/skies/imtest
cd /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/lookdev/skies/imtest
S=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/asset-scout/textures/google_filament/third_party/textures/Sandy_gravel_01/Sandy_gravel_01_
convert "${S}AO.png" -strip -set colorspace sRGB -channel R -separate +channel -resize '256x256!' r.png
convert "${S}Roughness.png" -strip -set colorspace sRGB -channel R -separate +channel -resize '256x256!' g.png
convert -size 256x256 xc:black -set colorspace sRGB b.png
convert r.png g.png b.png -set colorspace sRGB -combine -strip PNG24:orm.png
python3 -I -c "
from PIL import Image; import numpy as np
o=np.asarray(Image.open('orm.png').convert('RGB')).astype(float); print(o.reshape(-1,3).mean(0)); print(Image.open('orm.png').mode)"
