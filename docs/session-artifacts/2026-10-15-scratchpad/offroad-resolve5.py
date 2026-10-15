import re
p='scripts/bike-calibration.ts'
s=open(p).read()
m=re.search(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> claude/peaceful-einstein-dedc7t\n", s, re.S)
assert m and s.count('<<<<<<<')==1
s=s[:m.start()]+m.group(2)+"  },\n"+m.group(1)+s[m.end():]
open(p,'w').write(s)
