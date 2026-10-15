import sys, os, struct
from PIL import Image
for p in sys.argv[1:]:
    sz=os.path.getsize(p)
    try:
        if p.lower().endswith('.dds'):
            with open(p,'rb') as f: h=f.read(128)
            H,W=struct.unpack('<II',h[12:20]); fourcc=h[84:88]
            print(f"{W}x{H}\t{sz}\tDDS {fourcc}\t{p}")
            continue
        im=Image.open(p); print(f"{im.size[0]}x{im.size[1]}\t{sz}\t{im.mode}\t{p}")
    except Exception as e:
        print(f"ERR\t{sz}\t{e}\t{p}")
