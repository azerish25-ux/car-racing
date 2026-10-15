import sys
from PIL import Image
B='/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/'
A='/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/after/'
n=sys.argv[1]; x,y,w,h=map(int,sys.argv[2:6]); s=float(sys.argv[6]) if len(sys.argv)>6 else 2
out=sys.argv[7] if len(sys.argv)>7 else 'ad/crop_'+n+'.png'
b=Image.open(B+n+'.png').convert('RGB').crop((x,y,x+w,y+h)); a=Image.open(A+n+'.png').convert('RGB').crop((x,y,x+w,y+h))
W=int(w*s);H=int(h*s)
c=Image.new('RGB',(W,H*2+6),(255,0,255)); c.paste(b.resize((W,H),Image.LANCZOS),(0,0)); c.paste(a.resize((W,H),Image.LANCZOS),(0,H+6)); c.save(out)
print(out)
