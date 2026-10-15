import sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def load(p):
    im = Image.open(p).convert('RGB')
    if im.width > 1024:
        im = im.resize((1024, 1024), Image.BILINEAR)
    return np.asarray(im).astype(np.float64) / 255.0 * 2 - 1


def curl(gx, gyup):
    grow = -gyup
    d_grow_dx = np.roll(grow, -1, 1) - np.roll(grow, 1, 1)
    d_gx_drow = np.roll(gx, -1, 0) - np.roll(gx, 1, 0)
    return np.mean(np.abs(d_grow_dx - d_gx_drow))


for p in sys.argv[1:]:
    n = load(p)
    nz = np.clip(n[..., 2], 0.2, 1)
    gx = -n[..., 0] / nz
    gy_up = -n[..., 1] / nz
    gl = curl(gx, gy_up)
    dx = curl(gx, -gy_up)
    print(f"{p.split('/')[-1]}: curl GL={gl:.4f} DX={dx:.4f} -> {'GL' if gl < dx else 'DX'} mean={n.reshape(-1, 3).mean(0).round(3)}")
