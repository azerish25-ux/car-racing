import sys
from PIL import Image
import numpy as np
B='/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/'
A='/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/after/'
names=['01-cockpit-pit-exit','02-chase-main-straight','03-side-by-side','04-wet-braking-turn1','05-sunset-into-sun','06-night-traffic','07-pit-service','08-replay-broadcast','08-replay-broadcast-as-seen','09-close-photo','10-neon-city-night','11-festival-town-golden-hour']
def st(p):
    im=np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
    L=0.2126*im[...,0]+0.7152*im[...,1]+0.0722*im[...,2]
    mx=im.max(-1); mn=im.min(-1)
    sat=np.where(mx>0,(mx-mn)/np.maximum(mx,1),0)
    p=np.percentile(L,[1,5,50,95,99])
    return dict(shape=im.shape[:2],mean=L.mean().round(1),p1=p[0].round(1),p5=p[1].round(1),p50=p[2].round(1),p95=p[3].round(1),p99=p[4].round(1),clip=(mx>=250).mean().round(4),crush=(mx<=8).mean().round(4),sat=sat.mean().round(3),rgb=im.reshape(-1,3).mean(0).round(1),std=L.std().round(1))
for n in names:
    b=st(B+n+'.png'); a=st(A+n+'.png')
    print(n)
    print('  B',b)
    print('  A',a)
