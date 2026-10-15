"""3x4 contact sheet of the 12 showcase shots: python3 -I contact_sheet.py OUT.png FILE:CAPTION ..."""
import sys
from PIL import Image, ImageDraw, ImageFont

out, entries = sys.argv[1], sys.argv[2:]
cols, rows = 3, 4
tw, th, cap, pad = 640, 360, 30, 10
sheet = Image.new('RGB', (cols * tw + (cols + 1) * pad, rows * (th + cap) + (rows + 1) * pad), (18, 18, 20))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
except OSError:
    font = ImageFont.load_default()
for i, entry in enumerate(entries[: cols * rows]):
    path, _, caption = entry.partition(':')
    img = Image.open(path).convert('RGB')
    img.thumbnail((tw, th), Image.LANCZOS)
    c, r = i % cols, i // cols
    x, y = pad + c * (tw + pad), pad + r * (th + cap + pad)
    sheet.paste(img, (x + (tw - img.width) // 2, y + (th - img.height) // 2))
    draw.text((x + 4, y + th + 6), caption, fill=(230, 230, 230), font=font)
sheet.save(out)
print(out, sheet.size)
