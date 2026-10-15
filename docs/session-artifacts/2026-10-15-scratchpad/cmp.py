import json, sys
a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))


def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items()
                if not any(x in k.lower() for x in ['ms', 'wall', 'elapsed', 'sha', 'resident'])}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


sa, sb = strip(a), strip(b)
print('identical (excluding timing/hashes):', sa == sb)
if sa != sb:
    def walk(x, y, path=''):
        if type(x) != type(y):
            print(path, x, y); return
        if isinstance(x, dict):
            for k in set(x) | set(y):
                walk(x.get(k), y.get(k), path + '.' + k)
        elif isinstance(x, list):
            for i, (p, q) in enumerate(zip(x, y)):
                walk(p, q, f'{path}[{i}]')
            if len(x) != len(y): print(path, 'len', len(x), len(y))
        elif x != y:
            print(path, x, '->', y)
    walk(sa, sb)
