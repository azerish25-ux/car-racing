"""setfield.py <id> <field> <value> [<id> <field> <value> ...]: set (or insert
after tireGrip) a top-level numeric sheet field for a catalogue vehicle."""
import os
import re
import sys

os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3/src/simulation/vehicle-catalogue')
args = sys.argv[1:]
files = [f for f in os.listdir('.') if f.endswith('.ts')]
for k in range(0, len(args), 3):
    vid, field, value = args[k:k + 3]
    for f in files:
        s = open(f).read()
        key = "id: '%s'" % vid
        if key not in s:
            continue
        i = s.index(key)
        j = s.find("\n  bands:", i)
        block = s[i:j]
        if re.search(r'\n  %s: ' % field, block):
            block = re.sub(r'(\n  %s: )[^,\n]+,' % field, r'\g<1>%s,' % value, block, count=1)
        else:
            block = re.sub(r'(\n  tireGrip: [^,\n]+,)', r'\1\n  %s: %s,' % (field, value), block, count=1)
        s = s[:i] + block + s[j:]
        open(f, 'w').write(s)
        print('set', vid, field, value, 'in', f)
