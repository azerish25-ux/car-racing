import numpy as np
from PIL import Image
B = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/'
A = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/after/'
def load(d, n):
    return np.asarray(Image.open(d + n).convert('RGB')).astype(float)
def clipped(a):
    return float((a.min(axis=2) >= 250).mean() * 100)
def lap(a):
    g = a.mean(axis=2)
    l = g[1:-1, 1:-1] * 4 - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return l
for n in ['01-cockpit-pit-exit.png', '02-chase-main-straight.png', '03-side-by-side.png', '04-wet-braking-turn1.png',
          '05-sunset-into-sun.png', '06-night-traffic.png', '07-pit-service.png', '08-replay-broadcast.png',
          '09-close-photo.png', '10-neon-city-night.png', '11-festival-town-golden-hour.png']:
    out = []
    for tag, d in (('before', B), ('after', A)):
        a = load(d, n)
        lum = a @ np.array([0.2126, 0.7152, 0.0722])
        lower = a[300:, :]
        red = float(np.mean(np.clip(lower[..., 0] - lower[..., 1:].max(axis=2), 0, None)))
        out.append(f"{tag}: clip {clipped(a):.2f}% p99.9 luma {np.percentile(lum, 99.9):.0f} mean {lum.mean():.0f} p5 {np.percentile(lum, 5):.0f} redExcessLower {red:.1f}")
    print(n)
    for o in out:
        print('   ', o)
# 08 sharpness: background band (stands/trees y 120-200) and foreground (fence x 600-900, y 380-540)
for tag, d in (('before', B), ('after', A)):
    a = load(d, '08-replay-broadcast.png')
    L = lap(a)
    print('08', tag, 'lap var bg', round(float(L[120:200, 300:900].var()), 1), 'fg', round(float(L[380:530, 550:900].var()), 1), 'pack', round(float(L[230:320, 250:600].var()), 1))
