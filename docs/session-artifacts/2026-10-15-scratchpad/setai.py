import re


def setai(path, vid, vals):
    s = open(path).read()
    i = s.index(f"  id: '{vid}',\n")
    j = s.index('  ai: {', i)
    k = s.index('\n  },', j)
    block = s[j:k]
    for key, v in vals.items():
        block, n = re.subn(rf"(\n    {key}: )[-0-9.e]+,", rf"\g<1>{v},", block)
        assert n == 1, (vid, key)
    s = s[:j] + block + s[k:]
    open(path, 'w').write(s)


setai('src/simulation/vehicle-catalogue/prototypes.ts', 'sp71', {
    'lateralBase': '10.33', 'lateralAero': '0.00074', 'brakingBase': '13.04',
    'brakingAero': '0.00074', 'topSpeed': '93'})
setai('src/simulation/vehicle-catalogue/experimental.ts', 'xt1', {
    'lateralBase': '12.69', 'lateralAero': '0.00324', 'brakingBase': '15.76',
    'brakingAero': '0.0036', 'topSpeed': '99'})
print('ok')
