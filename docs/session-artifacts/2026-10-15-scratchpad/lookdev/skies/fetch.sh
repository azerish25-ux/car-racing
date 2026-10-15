#!/bin/bash
set -eu
cd /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/lookdev/skies/dl
for id in "$@"; do
  curl -sSfo "$id.tar.gz" "https://storage.googleapis.com/kubric-public/assets/HDRI_haven/$id.tar.gz"
  mkdir -p "x/$id"
  tar -xzf "$id.tar.gz" -C "x/$id"
  ls -la "x/$id"
done
