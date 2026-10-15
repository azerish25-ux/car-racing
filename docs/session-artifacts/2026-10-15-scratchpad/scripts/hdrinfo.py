import sys, os, re, struct
import numpy as np
from PIL import Image

def read_hdr(path, want_pixels=True):
    with open(path,'rb') as f:
        data=f.read()
    i=0; header=[]
    while True:
        j=data.index(b'\n',i); line=data[i:j]; i=j+1
        if line.startswith(b'-Y') or line.startswith(b'+Y'):
            m=re.match(rb'([-+]Y) (\d+) ([-+]X) (\d+)',line); H=int(m.group(2)); W=int(m.group(4)); break
        header.append(line)
    if not want_pixels: return W,H,None
    img=np.zeros((H,W,4),np.uint8); p=i
    for y in range(H):
        if data[p]==2 and data[p+1]==2 and (data[p+2]<<8|data[p+3])==W:
            p+=4
            for c in range(4):
                x=0
                row=img[y,:,c]
                while x<W:
                    n=data[p]; p+=1
                    if n>128:
                        n-=128; row[x:x+n]=data[p]; p+=1
                    else:
                        row[x:x+n]=np.frombuffer(data,np.uint8,n,p); p+=n
                    x+=n
        else:
            img[y]=np.frombuffer(data,np.uint8,W*4,p).reshape(W,4); p+=W*4
    e=img[...,3].astype(np.int32)
    scale=np.where(e>0, np.ldexp(1.0, e-136), 0.0)
    rgb=img[...,:3].astype(np.float32)*scale[...,None]
    return W,H,rgb

def thumb(rgb, out):
    lum=0.2126*rgb[...,0]+0.7152*rgb[...,1]+0.0722*rgb[...,2]
    key=np.exp(np.mean(np.log(lum+1e-4)))
    x=rgb*(0.18/key)
    x=x/(1+x)
    x=np.clip(x,0,1)**(1/2.2)
    im=Image.fromarray((x*255).astype(np.uint8))
    im.thumbnail((512,256))
    im.save(out)
    return float(key), float(lum.max())

outdir=sys.argv[1]
for p in sys.argv[2:]:
    name=os.path.basename(p)
    sz=os.path.getsize(p)
    if p.endswith('.hdr'):
        W,H,rgb=read_hdr(p)
        key,mx=thumb(rgb, os.path.join(outdir, name+'.png'))
        print(f"{name}\t{W}x{H}\t{sz}\tavgLum={key:.3f}\tpeak={mx:.0f}")
    elif p.endswith('.jpg'):
        im=Image.open(p); print(f"{name}\t{im.size[0]}x{im.size[1]}\t{sz}\tjpeg(gainmap?) app={list(im.applist[:4]) if hasattr(im,'applist') else ''}"[:200])
        im.thumbnail((512,256)); im.save(os.path.join(outdir,name+'.png'))
    elif p.endswith('.exr'):
        with open(p,'rb') as f: d=f.read(4000)
        k=d.find(b'dataWindow'); 
        if k>0:
            v=d[k+len(b'dataWindow\0box2i\0')+4:][:16]; xmin,ymin,xmax,ymax=struct.unpack('<4i',v)
            print(f"{name}\t{xmax-xmin+1}x{ymax-ymin+1}\t{sz}\texr compression={d[d.find(b'compression')+len(b'compression\0compression\0')+4]}")
