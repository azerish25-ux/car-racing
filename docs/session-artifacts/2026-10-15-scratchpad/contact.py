import sys, os
from PIL import Image, ImageDraw, ImageFont

d = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(d, 'contact-sheet.png')
names = ['01-cockpit-pit-exit.png', '02-chase-main-straight.png', '03-side-by-side.png',
         '04-wet-braking-turn1.png', '05-sunset-into-sun.png', '06-night-traffic.png',
         '07-pit-service.png', '08-replay-broadcast-as-seen.png', '08-replay-broadcast.png',
         '09-close-photo.png', '10-neon-city-night.png', '11-festival-town-golden-hour.png']
W, H = 480, 270
sheet = Image.new('RGB', (W * 3, H * 4), (0, 0, 0))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11)
except Exception:
    font = ImageFont.load_default()
for i, n in enumerate(names):
    x, y = (i % 3) * W, (i // 3) * H
    p = os.path.join(d, n)
    if os.path.exists(p):
        im = Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS)
        sheet.paste(im, (x, y))
    draw.rectangle([x, y, x + 200, y + 15], fill=(0, 0, 0))
    draw.text((x + 3, y + 1), n, fill=(255, 255, 255), font=font)
sheet.save(out)
print(out)
