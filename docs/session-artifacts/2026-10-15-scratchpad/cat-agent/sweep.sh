#!/bin/bash
# Sweep a numeric field of one catalogue sheet and print that vehicle's calibration.
# usage: sweep.sh <file> <field> <vehicle-name-grep> <values...>
cd /home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3 || exit 1
file="src/simulation/vehicle-catalogue/$1"
field="$2"
name="$3"
shift 3
for value in "$@"; do
  python3 - "$file" "$field" "$value" <<'EOF'
import re, sys
p, field, value = sys.argv[1:4]
s = open(p).read()
s2 = re.sub(r'(\n\s+%s: )[^,\n]+,' % re.escape(field), r'\g<1>%s,' % value, s, count=1)
open(p, 'w').write(s2)
EOF
  echo "== $field $value"
  node --experimental-transform-types scripts/vehicle-calibration.ts 2>/dev/null | grep -A6 "$name"
done
