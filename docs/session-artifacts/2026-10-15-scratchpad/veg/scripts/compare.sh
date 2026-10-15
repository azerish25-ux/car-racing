#!/bin/bash
# compare.sh <before.png> <after.png> <out.jpg> <label>: side-by-side, labelled, 1600 px wide JPEG.
set -e
tmp=$(mktemp -d)
convert "$1" -resize 800x -gravity NorthWest -fill white -undercolor '#000000a0' -pointsize 20 -annotate +8+6 "BEFORE  $4" "$tmp/a.png"
convert "$2" -resize 800x -gravity NorthWest -fill white -undercolor '#000000a0' -pointsize 20 -annotate +8+6 "AFTER  $4" "$tmp/b.png"
convert "$tmp/a.png" "$tmp/b.png" +append -strip -quality 84 -sampling-factor 4:2:0 "$3"
rm -rf "$tmp"
ls -la "$3"
