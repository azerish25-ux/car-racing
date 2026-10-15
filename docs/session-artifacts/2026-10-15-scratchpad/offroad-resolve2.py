import re
p='src/simulation/vehicle-classes.ts'
s=open(p).read()
m=re.search(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> claude/peaceful-einstein-dedc7t\n", s, re.S)
assert m and s.count('<<<<<<<')==1
s=s[:m.start()]+m.group(2)+m.group(1)+s[m.end():]
open(p,'w').write(s)

p='src/simulation/tire-families.ts'
s=open(p).read()
assert s.count('<<<<<<<')==2
s=s.replace("""<<<<<<< HEAD
  | 'knobby'
  | 'supermoto';
=======
  | 'historic-slick';
>>>>>>> claude/peaceful-einstein-dedc7t
""","""  | 'historic-slick'
  | 'knobby'
  | 'supermoto';
""")
m=re.search(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> claude/peaceful-einstein-dedc7t\n", s, re.S)
assert m and s.count('<<<<<<<')==1
s=s[:m.start()]+m.group(2)+m.group(1)+s[m.end():]
open(p,'w').write(s)
