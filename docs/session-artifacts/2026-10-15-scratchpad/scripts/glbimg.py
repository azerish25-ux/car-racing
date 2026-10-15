import sys, json, struct, os, io
from PIL import Image
out=sys.argv[1]
for p in sys.argv[2:]:
    with open(p,'rb') as f:
        f.read(12); clen,_=struct.unpack('<II',f.read(8)); j=json.loads(f.read(clen)); blen,_=struct.unpack('<II',f.read(8)); bin_=f.read(blen)
    for i,img in enumerate(j.get('images',[])[:2]):
        if 'bufferView' not in img: continue
        bv=j['bufferViews'][img['bufferView']]; data=bin_[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']]
        try:
            im=Image.open(io.BytesIO(data)); im=im.convert('RGB'); im.thumbnail((256,256)); im.save(os.path.join(out, os.path.basename(p)+f'_{i}.png'))
        except Exception as e: print('fail',p,i,e)
