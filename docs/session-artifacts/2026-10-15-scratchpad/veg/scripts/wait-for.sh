#!/bin/bash
# wait-for.sh FILE PATTERN SECONDS: block until FILE has more lines matching PATTERN than it had
# at start (or SECONDS pass), then print the last matching lines.
file="$1"; pattern="$2"; limit="${3:-600}"
start=$(cat "$file" 2>/dev/null | grep -cE "$pattern")
end=$(( $(date +%s) + limit ))
while [ "$(date +%s)" -lt "$end" ]; do
  now=$(cat "$file" 2>/dev/null | grep -cE "$pattern")
  if [ "$now" -gt "$start" ]; then break; fi
  sleep 5
done
grep -E "$pattern" "$file" | tail -6
