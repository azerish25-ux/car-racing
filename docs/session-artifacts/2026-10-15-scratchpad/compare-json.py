import json
import re
import sys

SKIP = re.compile(r'sha256|wall|elapsed|ms$|Ms$|generatedAt|timestamp|duration', re.I)


def diff(a, b, path=''):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if SKIP.search(k):
                continue
            if k not in a or k not in b:
                out.append(f'{path}.{k}: key only in one')
                continue
            out += diff(a[k], b[k], f'{path}.{k}')
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f'{path}: length {len(a)} vs {len(b)}')
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, f'{path}[{i}]')
    elif a != b:
        out.append(f'{path}: {a!r} vs {b!r}')
    return out


for name in sys.argv[3:]:
    a = json.load(open(f'{sys.argv[1]}/{name}'))
    b = json.load(open(f'{sys.argv[2]}/{name}'))
    d = diff(a, b)
    print(name, 'identical (ignoring hashes and timing)' if not d else f'{len(d)} differences')
    for line in d[:8]:
        print('   ', line)
