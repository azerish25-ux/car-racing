#!/bin/bash
# pair.sh <a.png> <labelA> <b.png> <labelB> <out.jpg>: two labelled frames side by side, 1600 px wide JPEG.
set -e
tmp=$(mktemp -d)
convert "$1" -resize 800x -gravity NorthWest -fill white -undercolor '#000000a0' -pointsize 20 -annotate +8+6 "$2" "$tmp/a.png"
convert "$3" -resize 800x -gravity NorthWest -fill white -undercolor '#000000a0' -pointsize 20 -annotate +8+6 "$4" "$tmp/b.png"
convert "$tmp/a.png" "$tmp/b.png" +append -strip -quality 84 -sampling-factor 4:2:0 "$5"
rm -rf "$tmp"
ls -la "$5"
