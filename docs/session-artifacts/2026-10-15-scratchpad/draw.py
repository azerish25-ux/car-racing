import json
import sys

from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
size = d['size']
img = Image.new('RGB', (size, size), 'white')
g = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
except Exception:
    font = small = ImageFont.load_default()
for l in d['lines']:
    pts = [tuple(p) for p in l['pts']]
    if len(pts) > 1:
        g.line(pts, fill=l['color'], width=l['width'])
for c in d['circles']:
    x, y, r = c['x'], c['y'], c['r']
    if c.get('fill'):
        g.ellipse([x - r, y - r, x + r, y + r], fill=c['color'])
    else:
        g.ellipse([x - r, y - r, x + r, y + r], outline=c['color'], width=3)
for t in d['texts']:
    g.text((t['x'], t['y']), t['text'], fill=t.get('color', 'black'), font=small if t.get('small') else font)
img = img.resize((1100, 1100), Image.LANCZOS)
img.save(out)
