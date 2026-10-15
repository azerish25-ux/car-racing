#!/bin/bash
# Sweep a numeric field of one catalogue sheet (first occurrence after the id)
# and run the solo AI drive for that vehicle.
# usage: sweepai.sh <file> <id> <field> <circuit> <seconds> <values...>
cd /home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3 || exit 1
file="src/simulation/vehicle-catalogue/$1"
id="$2"
field="$3"
circuit="$4"
seconds="$5"
shift 5
for value in "$@"; do
  python3 - "$file" "$id" "$field" "$value" <<'EOF'
import re, sys
p, vid, field, value = sys.argv[1:5]
s = open(p).read()
i = s.index("id: '%s'" % vid)
head, tail = s[:i], s[i:]
tail = re.sub(r'(\n\s+%s: )[^,\n]+,' % re.escape(field), r'\g<1>%s,' % value, tail, count=1)
open(p, 'w').write(head + tail)
EOF
  echo "== $id $field $value"
  node --experimental-transform-types /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/aisolo.ts "$circuit" "$seconds" "$id" 2>/dev/null
done
