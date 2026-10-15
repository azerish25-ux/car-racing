#!/bin/bash
# usage: rawsize.sh owner/repo ref path...   -> prints http code, content-length, url
repo=$1; ref=$2; shift 2
for p in "$@"; do
  enc=$(python3 -I -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$p")
  url="https://raw.githubusercontent.com/$repo/$ref/$enc"
  out=$(curl -sI -L --max-time 30 "$url" | tr -d '\r')
  code=$(echo "$out" | grep -E "^HTTP" | tail -1 | awk '{print $2}')
  len=$(echo "$out" | grep -i "^content-length" | tail -1 | awk '{print $2}')
  printf "%s %10s %s\n" "$code" "$len" "$url"
done
