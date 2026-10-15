#!/bin/bash
# Print content-length for landscape PLY meshes in the given index range.
base=https://raw.githubusercontent.com/mmp/pbrt-v4-scenes/30cf4a0346ae5a80a2d7a530a3ef7d0fa4f70572/landscape/geometry
for i in $(seq "$1" "$2"); do
  n=$(printf 'mesh_%05d.ply' "$i")
  len=$(curl -sSI "$base/$n" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)
  echo "$n $len"
done
