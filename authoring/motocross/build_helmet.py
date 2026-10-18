"""Original MOTOBOUND MX helmet, in metres, authored and exported in Blender.

Build: blender -b --factory-startup --python authoring/motocross/build_helmet.py
A real open eye-port, projecting ventilated chin bar, separate curved lens and
rubber seal replace the road-helmet-derived silhouette. Reference photographs
are never embedded. Native quad meshes and thickness modifiers remain editable.
The transport is local, quantized and dependency-free: the game does not need a
GLTF loader or a network round trip to assemble riders.
"""
from __future__ import annotations
import argparse, hashlib, json, math, pathlib, sys
import bpy
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'src/rendering/assets/mx-helmet.mesh.json'
NATIVE = ROOT / 'authoring/motocross/mx-helmet.blend'
SCALE = 100000
NORMAL_SCALE = 10000
UV_SCALE = 10000
TAU = math.tau

def smooth(a, b, x):
    t = max(0., min(1., (x-a)/(b-a)))
    return t*t*(3.-2.*t)

def to_blender(p):
    x,y,z=p
    return (x,-z,y)

def to_game(p):
    return (p.x,p.z,-p.y)

MATERIALS={}
for role,color,rough,metal in [
    ('shell',(0.76,0.78,0.75,1),.29,0.),
    ('frame',(.065,.075,.081,1),.49,0.),
    ('rubber',(.018,.022,.026,1),.9,0.),
    ('lens',(.065,.14,.17,1),.17,.25),
    ('accent',(.53,.075,.026,1),.4,0.),
    ('hardware',(.28,.31,.32,1),.37,.7),
]:
    m=bpy.data.materials.new('MX '+role);m.diffuse_color=color;m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=color
    bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
    if role in ('shell','lens'):bs.inputs['Coat Weight'].default_value=.55;bs.inputs['Coat Roughness'].default_value=.18
    MATERIALS[role]=m

def mesh(name, role, verts, faces, uvs=None, thickness=0.):
    g=bpy.data.meshes.new(name);g.from_pydata([to_blender(p) for p in verts],[],faces);g.update()
    ob=bpy.data.objects.new(name,g);bpy.context.collection.objects.link(ob)
    ob.data.materials.append(MATERIALS[role]);ob['material_role']=role
    ob['coordinate_system']='metres; game +Y up, +Z forward'
    layer=g.uv_layers.new(name='UVMap')
    for poly in g.polygons:
        poly.use_smooth=True
        for li in poly.loop_indices:
            vi=g.loops[li].vertex_index
            layer.data[li].uv=uvs[vi] if uvs else ((verts[vi][0]+.2)/.4,(verts[vi][1]-.02)/.31)
    if thickness:
        mod=ob.modifiers.new('Editable moulded wall thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=-1.;mod.use_even_offset=True
    return ob

def tube(name, role, points, radius, sides=6, closed=True):
    verts=[];uvs=[];faces=[];n=len(points)
    for i,p in enumerate(points):
        p=Vector(p)
        prev=Vector(points[(i-1)%n] if closed or i else points[0])
        nex=Vector(points[(i+1)%n] if closed or i<n-1 else points[-1])
        tangent=(nex-prev).normalized();guide=Vector((0,0,1))
        if abs(tangent.dot(guide))>.9:guide=Vector((0,1,0))
        a=tangent.cross(guide).normalized();b=tangent.cross(a).normalized()
        for k in range(sides):
            ang=k*TAU/sides;v=p+radius*(a*math.cos(ang)+b*math.sin(ang))
            verts.append(tuple(v));uvs.append((i/n,k/sides))
    for i in range(n if closed else n-1):
        for k in range(sides):
            ni=(i+1)%n;nk=(k+1)%sides
            faces.append((i*sides+k,i*sides+nk,ni*sides+nk,ni*sides+k))
    if not closed:
        faces.append(tuple(reversed(range(sides))));faces.append(tuple((n-1)*sides+k for k in range(sides)))
    return mesh(name,role,verts,faces,uvs)

def crown_point(phi,t):
    # Forehead rim stays above the goggle opening. Lower side/rear edges cup
    # the jaw/occiput, unlike a clipped sphere with a visor pasted over it.
    edge=abs((phi+math.pi)%TAU-math.pi)
    bottom=.219-.169*smooth(.65,1.65,edge)-.010*smooth(1.65,2.8,edge)
    theta=t*math.acos(max(-.999,min(.999,(bottom-.167)/.149)))
    radial=math.sin(theta)
    x=.140*radial*math.sin(phi)
    y=.167+.149*math.cos(theta)
    z=.016+.153*radial*math.cos(phi)
    # Crown ridges are shallow mouldings rather than a toy sphere.
    y+=.004*math.exp(-((abs(x)-.062)/.019)**2)*smooth(.13,.25,y)
    z-=.010*smooth(1.5,2.7,edge)*smooth(.18,.27,y)
    return (x,y,z)

def chin_point(phi,v):
    side=math.sin(phi)**2
    y=(.032+.016*side)*(1-v)+(.112+.034*side)*v
    x=.132*math.sin(phi)*(1-.055*math.sin(v*math.pi))
    radius=.208-.016*v
    z=.016+radius*math.cos(phi)
    return x,y,z

def lens_point(u,v):
    s=u*2-1;edge=abs(s)
    x=.108*s
    lower=.144+.012*math.exp(-((s/.18)**2))+.004*edge**3
    upper=.211-.013*edge**2
    y=lower+(upper-lower)*v
    z=.183-.043*s*s+.002*math.sin(v*math.pi)
    return x,y,z

def round_outline(n):
    # A superellipse preserves real rounded corners without Catmull-Rom
    # overshoot. Follow the same lens surface so gasket and glass never float.
    out=[]
    for i in range(n):
        a=i*TAU/n;co=math.cos(a);si=math.sin(a)
        x=math.copysign(abs(co)**.55,co);y=math.copysign(abs(si)**.7,si)
        out.append(lens_point((x+1)/2,(y+1)/2))
    return out

def make_lod(detail):
    seg,rings,curve,sides={'high':(48,14,64,6),'mid':(28,9,36,5),'far':(16,6,20,4)}[detail]
    result=[]
    # An opaque fitted liner belongs inside a worn helmet. Without it the
    # real open eye-port would reveal the background through the rider's face.
    n,rows={'high':(16,10),'mid':(12,8),'far':(8,6)}[detail]
    lv=[(0,.297,.022)];lu=[(.5,1.)];lf=[]
    for j in range(1,rows):
        t=j*math.pi/rows
        for i in range(n+1):
            a=-math.pi+i*TAU/n
            lv.append((.115*math.sin(t)*math.sin(a),.165+.132*math.cos(t),.022+.130*math.sin(t)*math.cos(a)))
            lu.append((i/n,1-j/rows))
    bottom=len(lv);lv.append((0,.033,.022));lu.append((.5,0.))
    for i in range(n):lf.append((0,i+1,i+2))
    for j in range(rows-2):
        for i in range(n):
            a=1+j*(n+1)+i;b=a+n+1;lf.append((a,b,b+1,a+1))
    for i in range(n):
        a=1+(rows-2)*(n+1)+i;lf.append((a,bottom,a+1))
    result.append(mesh('MX fitted balaclava liner','rubber',lv,lf,lu))
    v=[crown_point(0,0)];uv=[(.5,1.)];f=[]
    for j in range(1,rings+1):
        for i in range(seg+1):
            phi=-math.pi+i*TAU/seg
            v.append(crown_point(phi,j/rings));uv.append((i/seg,1-j/rings))
    for i in range(seg):f.append((0,1+i,1+i+1))
    for j in range(rings-1):
        for i in range(seg):
            a=1+j*(seg+1)+i;b=a+seg+1;f.append((a,b,b+1,a+1))
    result.append(mesh('MX open-eyeport crown','shell',v,f,uv,.0032))
    # Projecting wraparound jaw cage, with an actual central ventilation hole.
    cols={'high':32,'mid':20,'far':12}[detail];rows=4
    v=[];uv=[];f=[]
    for j in range(rows+1):
        for i in range(cols+1):
            phi=-1.83+i/cols*3.66
            v.append(chin_point(phi,j/rows));uv.append((i/cols,.1+.24*j/rows))
    for j in range(rows):
        for i in range(cols):
            phi=-1.83+(i+.5)/cols*3.66
            if abs(phi)<.32 and 0<j<3:continue
            a=j*(cols+1)+i;b=a+cols+1;f.append((a,a+1,b+1,b))
    result.append(mesh('MX continuous projecting chin guard','shell',v,f,uv,.0036))
    # Recessed black mouthpiece lies behind the opening, not in front of paint.
    vent=[];vf=[]
    for j in range(3):
        for i in range(9):
            x,y,z=chin_point(-.40+i*.10,.19+j*.31)
            vent.append((x,y,z-.006))
    for j in range(2):
        for i in range(8):a=j*9+i;vf.append((a,a+1,a+10,a+9))
    result.append(mesh('MX recessed mouth vent','rubber',vent,vf))
    if detail!='far':
        for line in range(5):
            phi=(line-2)*.127
            pts=[chin_point(phi,.2+j*.07) for j in range(10)]
            result.append(tube('MX mouth grille rib','frame',[(x,y,z-.0015) for x,y,z in pts],.0018,4,False))
        border=[crown_point(-math.pi+i*TAU/curve,1) for i in range(curve)]
        result.append(tube('MX rolled shell opening trim','rubber',border,.0024,sides))
        lower=[chin_point(-1.83+i*3.66/curve,0) for i in range(curve+1)]
        result.append(tube('MX chin lower impact trim','rubber',lower,.0027,sides,False))
    # Curved rounded lens is a radial surface (no rectangular glass corners).
    n=curve;radial=4 if detail=='high' else 2
    outline=round_outline(n);center=Vector(lens_point(.5,.5));v=[tuple(center)];uv=[(.5,.5)];f=[]
    for ring in range(1,radial+1):
        t=ring/radial
        for i in range(n):
            q=Vector(outline[i]);x=center.x+(q.x-center.x)*t;y=center.y+(q.y-center.y)*t
            z=.183-.043*(x/.108)**2+.002*math.sin(t*math.pi)
            v.append((x,y,z));uv.append((x/.216+.5,(y-.14)/.08))
    for i in range(n):f.append((0,1+i,1+(i+1)%n))
    for ring in range(radial-1):
        for i in range(n):
            a=1+ring*n+i;an=1+ring*n+(i+1)%n;b=a+n;bn=an+n
            f.append((a,b,bn,an))
    result.append(mesh('MX curved goggle lens','lens',v,f,uv))
    result.append(tube('MX goggle structural frame','accent',outline,.0040,sides))
    if detail!='far':
        result.append(tube('MX goggle foam gasket','rubber',[(x*1.025,y,z-.0048) for x,y,z in outline],.0065,sides))
    # Woven strap follows the outside of the head on the back and sides.
    v=[];uv=[];f=[];n=seg
    for j in range(2):
        for i in range(n+1):
            phi=.95+i/n*(TAU-1.9);y=.157+(j-.5)*.031
            x=.142*math.sin(phi);z=.016+.154*math.cos(phi)
            v.append((x,y,z));uv.append((i/n*4,j))
    for i in range(n):f.append((i,i+1,n+2+i,n+1+i))
    result.append(mesh('MX woven rear goggle strap','rubber',v,f,uv,.0018))
    # Three dimensional, vented peak. Omit surface cells for two real slots.
    cols=12 if detail=='high' else 8;rows=9 if detail=='high' else 6
    v=[];uv=[];f=[]
    for j in range(rows+1):
        t=j/rows
        for i in range(cols+1):
            s=2*i/cols-1;width=.112+.017*math.sin(t*math.pi)-.024*t*t
            x=s*width
            y=.257+.014*math.sin(t*math.pi*.8)+.007*(1-s*s)+.009*t*t
            z=.031+t*(.255-.018*abs(s))
            v.append((x,y,z));uv.append((i/cols,t))
    for j in range(rows):
        for i in range(cols):
            x=abs(2*(i+.5)/cols-1);t=(j+.5)/rows
            if .20<x<.63 and .24<t<.77:continue
            a=j*(cols+1)+i;b=a+cols+1;f.append((a,b,b+1,a+1))
    result.append(mesh('MX vented swept helmet peak','shell',v,f,uv,.0033))
    if detail!='far':
        for s in (-1,1):
            # Round peak pivots and recessed side extraction vents.
            points=[]
            for i in range(12):
                a=i*TAU/12;points.append((s*.132,.240+.0065*math.cos(a),.054+.0065*math.sin(a)))
            center=(s*.131,.240,.054)
            result.append(mesh('MX peak round pivot','hardware',[center]+points,[(0,i+1,(i+1)%12+1) for i in range(12)]))
            pts=[(s*(.130-.002*i),.125-.008*i,.044+.009*i) for i in range(4)]
            result.append(tube('MX side jaw extraction vent','rubber',pts,.0040,5,False))
    for ob in result:ob['detail']=detail
    return result

def export_parts(objects):
    grouped={}
    deps=bpy.context.evaluated_depsgraph_get()
    for ob in objects:
        role=ob['material_role'];name=ob.name.split('.')[0]
        evaluated=ob.evaluated_get(deps);m=evaluated.to_mesh();m.calc_loop_triangles()
        uv=m.uv_layers.active.data if m.uv_layers.active else None
        # Correct orientation from actual editable Blender surface, preserving
        # split UV seams rather than averaging hard normals across shell walls.
        positions=[];normals=[];tex=[];indices=[];lookup={}
        for tri in m.loop_triangles:
            for li in tri.loops:
                loop=m.loops[li];co=m.vertices[loop.vertex_index].co
                no=m.corner_normals[li].vector
                p=tuple(round(x*SCALE) for x in to_game(co))
                n=tuple(round(x*NORMAL_SCALE) for x in to_game(no))
                t=tuple(round(x*UV_SCALE) for x in uv[li].uv) if uv else (0,0)
                key=(p,n,t)
                if key not in lookup:
                    lookup[key]=len(lookup);positions.extend(p);normals.extend(n);tex.extend(t)
                indices.append(lookup[key])
        evaluated.to_mesh_clear()
        # Grouping keeps logical parts testable while batching by caller can
        # still merge equal materials into a small fixed number of draw calls.
        key=name
        if key in grouped:
            data=grouped[key];offset=len(data['position'])//3
            data['position'].extend(positions);data['normal'].extend(normals);data['uv'].extend(tex)
            data['index'].extend(i+offset for i in indices)
        else:grouped[key]={'material':role,'position':positions,'normal':normals,'uv':tex,'index':indices}
    return grouped

def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    root=bpy.context.scene.collection
    lods={}
    for detail in ('high','mid','far'):
        coll=bpy.data.collections.new('MX helmet / '+detail);root.children.link(coll)
        bpy.context.view_layer.active_layer_collection=bpy.context.view_layer.layer_collection.children[coll.name]
        objects=make_lod(detail)
        # Native face orientation is audited and made consistent before baking.
        for ob in objects:
            bpy.context.view_layer.objects.active=ob;ob.select_set(True)
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');ob.select_set(False)
        lods[detail]=export_parts(objects)
        coll.hide_render=detail!='high';coll.hide_viewport=detail!='high'
    data={'schema':1,'authoring':'Blender 5.2.2 LTS / original MOTOBOUND MX helmet',
          'positionScale':SCALE,'normalScale':NORMAL_SCALE,'uvScale':UV_SCALE,
          'coordinates':'metres; +Y up, +Z forward; head-group origin; shell adapter subtracts (0,0.15,0.02)',
          'referenceOnly':[2,4,5,7,9,11,20,21,29,44,70,95],'lods':lods}
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(data,separators=(',',':'))+'\n')
    NATIVE.parent.mkdir(parents=True,exist_ok=True)
    bpy.context.scene['asset']='Original MOTOBOUND MX Helmet';bpy.context.scene['runtime_transport_sha256']=hashlib.sha256(OUT.read_bytes()).hexdigest()
    bpy.context.scene['reference_policy']='No reference image, commercial logo, ripped mesh or branded texture embedded.'
    bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE),compress=True)
    counts={d:sum(len(p['index'])//3 for p in parts.values()) for d,parts in lods.items()}
    print('MX_HELMET_EXPORTED',json.dumps({'triangles':counts,'bytes':OUT.stat().st_size,'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest()}))

if __name__=='__main__':main()
