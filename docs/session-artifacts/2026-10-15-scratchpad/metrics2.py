import sys
import numpy as np
from PIL import Image
B = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/'
A = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/after/'
def load(d, n):
    return np.asarray(Image.open(d + n).convert('RGB')).astype(float)
W = np.array([0.2126, 0.7152, 0.0722])
def anyclip(a):
    return float((a.max(axis=2) >= 250).mean() * 100)
print('highlight clip (any channel >= 250, %):')
for n in ['02-chase-main-straight.png', '05-sunset-into-sun.png', '08-replay-broadcast.png', '10-neon-city-night.png', '06-night-traffic.png']:
    print('  ', n, round(anyclip(load(B, n)), 2), '->', round(anyclip(load(A, n)), 2))
# 09 pit-box yellow: yellow-ish pixels in the lower half
for tag, d in (('before', B), ('after', A)):
    a = load(d, '09-close-photo.png')[270:, :]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r > 60) & (r > b * 1.35) & (g > b * 1.2) & (abs(r - g) < 45)
    lum = (a @ W)[m]
    print('09 yellow lines', tag, 'pixels', int(m.sum()), 'luma p10/p50/p90', np.percentile(lum, [10, 50, 90]).round(0) if m.sum() else None)
# 04 red fog: share of lower-frame pixels with strong red excess
for tag, d in (('before', B), ('after', A)):
    a = load(d, '04-wet-braking-turn1.png')[300:, :]
    ex = a[..., 0] - a[..., 1:].max(axis=2)
    print('04 red excess > 30 (%)', tag, round(float((ex > 30).mean() * 100), 2))
# 10 windows: bright facade pixels
for tag, d in (('before', B), ('after', A)):
    a = load(d, '10-neon-city-night.png')[:240, :]
    lum = a @ W
    print('10 upper frame luma >= 240 (%)', tag, round(float((lum >= 240).mean() * 100), 2), 'mean', round(float(lum.mean()), 1))
# 08 crowd saturation in the grandstand region
for tag, d in (('before', B), ('after', A)):
    a = load(d, '08-replay-broadcast.png')[150:225, 650:940] / 255
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 0.05, (mx - mn) / np.maximum(mx, 1e-6), 0)
    print('08 stand region saturation mean/p90', tag, round(float(sat.mean()), 3), round(float(np.percentile(sat, 90)), 3))
