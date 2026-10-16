"""MotoBound original MotoGP side-outlet art. Blender 5.2 headless.
blender -b --python tools/motogp/author_gp_cooling_louvers.py -- --out /tmp/gp-louvers
Original design informed by REF 001/003/018/022/049/056/060/073; no licensed game assets.
"""
import argparse, bpy, math, sys
from pathlib import Path
cmd=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
parser=argparse.ArgumentParser();parser.add_argument('--out',default='gp-louvers')
out=Path(parser.parse_args(cmd).out);out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def point(x,y,z):return (x,-z,y)
def piece(name,verts,faces,color):
    me=bpy.data.meshes.new(name)
    me.from_pydata([point(*p) for p in verts],[],faces);me.update()
    obj=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(obj)
    mat=bpy.data.materials.get(color) or bpy.data.materials.new(color)
    mat.diffuse_color=(.022,.026,.032,1) if color=='Carbon' else (.48,.52,.55,1)
    me.materials.append(mat)
    for face in me.polygons:face.use_smooth=True
    return obj
p=[];faces=[]
for side in (-1,1):
    for layer in range(4):
        y=-.065+layer*.065/3;base=len(p)
        for k in range(11):
            t=k/10;x=side*(.2415+.0028*math.sin(math.pi*t)+.001*(1-t))
            z=.231+.114*t;chord=.012*(.75+.25*math.sin(math.pi*t))
            slope=.0022*(t-.5)
            p.extend(((x+side*.0018,y-chord/2+slope,z),
                      (x+side*.003,y+chord*.32+slope,z),
                      (x-side*.0018,y+chord*.5+slope,z),
                      (x-side*.003,y-chord*.44+slope,z)))
        for k in range(10):
            for c in range(4):
                q=(base+4*k+c,base+4*k+(c+1)%4,
                   base+4*(k+1)+(c+1)%4,base+4*(k+1)+c)
                faces.append(q if side>0 else tuple(reversed(q)))
        start=tuple(base+i for i in range(4))
        end=tuple(base+40+i for i in range(4))
        faces.extend((tuple(reversed(start)) if side>0 else start,
                      end if side>0 else tuple(reversed(end))))
piece('Swept GP-R1 cooling vanes',p,faces,'Carbon')
p=[];faces=[]
for side in (-1,1):
    for y in (-.086,.021):
        for z in (.23,.347):
            base=len(p)
            for r,x in ((.004,side*.246),(.0032,side*.2472)):
                for k in range(10):
                    a=2*math.pi*k/10;p.append((x,y+r*math.cos(a),z+r*math.sin(a)))
            for k in range(10):
                q=(base+k,base+(k+1)%10,base+10+(k+1)%10,base+10+k)
                faces.append(q if side>0 else tuple(reversed(q)))
            faces.append(tuple(base+10+k for k in range(10)))
piece('Flush titanium fasteners',p,faces,'Titanium')
bpy.ops.wm.save_as_mainfile(filepath=str(out/'gp-cooling-louvers.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out/'gp-cooling-louvers.glb'),export_format='GLB',export_apply=True,export_yup=True)
print('MotoGP original cooling outlets saved in',out)
