#!/bin/bash
# usage: fetch.sh category url [url...]   -> downloads into asset-scout/<category>/<host+path>, logs to manifest.tsv
BASE=/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/asset-scout
cat=$1; shift
for url in "$@"; do
  rel=$(echo "$url" | sed -E 's|https://raw.githubusercontent.com/([^/]+)/([^/]+)/[^/]+/|\1_\2/|; s|https://media.githubusercontent.com/media/([^/]+)/([^/]+)/[^/]+/|\1_\2/|; s|https://registry.npmjs.org/||; s|%20|_|g')
  out="$BASE/$cat/$rel"
  mkdir -p "$(dirname "$out")"
  res=$(curl -sS -L --max-time 600 -o "$out" -w "%{http_code} %{size_download}" "$url" 2>&1)
  code=${res%% *}; size=${res##* }
  head8=$(head -c 40 "$out" 2>/dev/null | tr -c '[:print:]' '.' | cut -c1-24)
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$cat" "$code" "$size" "$url" "$out" "$head8" | tee -a "$BASE/manifest.tsv"
done
