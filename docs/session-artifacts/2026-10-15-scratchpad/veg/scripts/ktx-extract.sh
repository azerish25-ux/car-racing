#!/bin/bash
# ktx-extract.sh <in.ktx2> <out.png> [level]: transcode one mip level to PNG.
K=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/tools/ktx/KTX-Software-4.4.2-Linux-x86_64
export LD_LIBRARY_PATH=$K/lib
"$K/bin/ktx" extract --level "${3:-0}" --transcode rgba8 "$1" "$2"
