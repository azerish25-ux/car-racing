import sys, json, struct, os
for p in sys.argv[1:]:
    with open(p,'rb') as f:
        magic,ver,length=struct.unpack('<4sII',f.read(12)); clen,ctype=struct.unpack('<II',f.read(8)); j=json.loads(f.read(clen))
    acc=j.get('accessors',[]); tris=0; verts=0
    for m in j.get('meshes',[]):
        for pr in m['primitives']:
            if 'indices' in pr: n=acc[pr['indices']]['count']
            else: n=acc[pr['attributes']['POSITION']]['count']
            mode=pr.get('mode',4)
            tris+= n//3 if mode==4 else 0
            verts+=acc[pr['attributes']['POSITION']]['count']
    imgs=j.get('images',[])
    print(os.path.basename(p), '| size', os.path.getsize(p), '| tris', tris, '| verts', verts, '| meshes', len(j.get('meshes',[])), '| mats', len(j.get('materials',[])), '| images', len(imgs), [i.get('mimeType') for i in imgs][:3], '| ext', j.get('extensionsUsed'), '| asset', json.dumps(j.get('asset'))[:400])
