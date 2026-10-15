"""Set AI margins (and optional lineScale) for given ids in the sheets.
Usage: aimargins.py id:lat:slow:brake[:line] ..."""
import re
import sys

files = [
    'src/simulation/vehicle-catalogue/single-seaters.ts',
    'src/simulation/vehicle-catalogue/prototypes.ts',
    'src/simulation/vehicle-catalogue/gt-layouts.ts',
    'src/simulation/vehicle-catalogue/touring-club-2.ts',
    'src/simulation/vehicle-catalogue/dirt-2.ts',
    'src/simulation/vehicle-catalogue/experimental.ts',
    'src/simulation/vehicle-catalogue/road-festival.ts',
]
texts = {f: open(f).read() for f in files}
for arg in sys.argv[1:]:
    parts = arg.split(':')
    vid, lat, slow, brake = parts[:4]
    line = parts[4] if len(parts) > 4 else None
    for f, t in texts.items():
        i = t.find(f"  id: '{vid}',\n")
        if i < 0:
            continue
        j = t.index('  ai: {', i)
        k = t.index('\n  },', j)
        block = t[j:k]
        for key, v in (('lateralMargin', lat), ('slowLateralMargin', slow), ('brakingMargin', brake)):
            block, n = re.subn(rf"(\n    {key}: )[0-9.]+,", rf"\g<1>{v},", block)
            if n == 0:
                block += f"\n    {key}: {v},"
        if line:
            block, n = re.subn(r"(\n    lineScale: )[0-9.]+,", rf"\g<1>{line},", block)
            if n == 0:
                block += f"\n    lineScale: {line},"
        texts[f] = t[:j] + block + t[k:]
        print(vid, 'updated')
        break
    else:
        raise SystemExit(f'{vid} not found')
for f, t in texts.items():
    open(f, 'w').write(t)
