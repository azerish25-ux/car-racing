import json, sys, math
from PIL import Image, ImageDraw
base = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/'
data = json.load(open(base + 'trace.json'))
ids = [i for i in data.keys() if len(sys.argv) < 2 or i in sys.argv[1].split(',')]
cols = 4
cell = 480
rows = math.ceil(len(ids) / cols)
img = Image.new('RGB', (cols * cell, rows * cell), (250, 250, 248))
d = ImageDraw.Draw(img)
for k, cid in enumerate(ids):
    pts = data[cid]
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    minx, maxx, minz, maxz = min(xs), max(xs), min(zs), max(zs)
    span = max(maxx - minx, maxz - minz) or 1
    sc = (cell - 40) / span
    ox = (k % cols) * cell + 20
    oz = (k // cols) * cell + 20
    P = lambda x, z: (ox + (x - minx) * sc, oz + (maxz - z) * sc)
    d.line([P(x, z) for x, z in pts], fill=(30, 60, 200), width=3)
    x0, z0 = P(*pts[0]); d.ellipse([x0-6, z0-6, x0+6, z0+6], outline=(0, 160, 0), width=3)
    x1, z1 = P(*pts[-1]); d.ellipse([x1-6, z1-6, x1+6, z1+6], outline=(220, 0, 0), width=3)
    d.text(((k % cols) * cell + 6, (k // cols) * cell + 4), f"{cid} span {span:.0f}", fill=(0, 0, 0))
img.save(base + 'trace.png')
