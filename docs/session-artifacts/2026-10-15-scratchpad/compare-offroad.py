import json
import sys

base = json.load(open(sys.argv[1]))
mine = json.load(open(sys.argv[2]))


def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if 'wall' not in k.lower()}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


print('equal ignoring wall time:', strip(base) == strip(mine))
