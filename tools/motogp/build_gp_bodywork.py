"""Original MotoBound GP aero/bodywork, metres, +Z forward in the game.
Blender 5.2 headless: blender -b --python build_gp_bodywork.py -- --out DIR
The baked indexed geometry is loaded synchronously by Three.js; no network,
GLTF decoder or asynchronous loading race is introduced during a race.
Reference principles: supplied REF 001,004,018,022,027,049,056,060,071,073,087,098.
No source image, manufacturer geometry, logo or livery is embedded.
"""
import bpy, math, json, argparse, sys
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--out',default='gp-bodywork'); opt=p.parse_args(args)
out=Path(opt.out).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
# Three.js (x,y,z) -> Blender (x,-z,y); exporter converts back to Y-up.
def xyz(v): return (v[0],-v[2],v[1])
def material(name,col,metal=0,rough=.35):
    m=bpy.data.materials.new(name);m.diffuse_color=(*col,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*col,1);bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
    if name in ('paint','secondary','accent'): bs.inputs['Coat Weight'].default_value=.95;bs.inputs['Coat Roughness'].default_value=.12
    return m
mats={
'paint':material('paint',(.38,.018,.026)),
'secondary':material('secondary',(.015,.026,.034)),
'accent':material('accent',(.88,.89,.83)),
'carbon':material('carbon',(.024,.026,.03),.08,.38),
'dark':material('dark',(.008,.009,.011),.05,.65),
'aluminium':material('aluminium',(.43,.45,.47),.9,.32),
'seat':material('seat',(.013,.014,.015),0,.82),
}
objects=[]
def mesh(name,verts,faces,mat,uvs=None):
    d=bpy.data.meshes.new(name);d.from_pydata([xyz(v) for v in verts],[],faces);d.update()
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);d.materials.append(mats[mat]);objects.append(o)
    for f in d.polygons: f.use_smooth=True
    layer=d.uv_layers.new(name='UVMap')
    # UVs are physically stable per vertex where supplied; no random unwrap.
    for poly in d.polygons:
        for li in poly.loop_indices:
            vi=d.loops[li].vertex_index
            if uvs: layer.data[li].uv=uvs[vi]
            else:
                q=verts[vi];layer.data[li].uv=(q[2]*2,q[1]*2)
    return o

def pchip(xs,ys,x):
    n=len(xs);ds=[(ys[i+1]-ys[i])/(xs[i+1]-xs[i]) for i in range(n-1)]
    tangent=[ds[0]]
    for i in range(1,n-1):
        if ds[i-1]*ds[i]<=0:tangent.append(0)
        else:
            hp=xs[i]-xs[i-1];hn=xs[i+1]-xs[i];w1=2*hn+hp;w2=hn+2*hp
            tangent.append((w1+w2)/(w1/ds[i-1]+w2/ds[i]))
    tangent.append(ds[-1]);i=next((j for j in range(n-1) if xs[j+1]>=x),n-2)
    h=xs[i+1]-xs[i];t=max(0,min(1,(x-xs[i])/h));t2=t*t;t3=t2*t
    return (2*t3-3*t2+1)*ys[i]+(t3-2*t2+t)*h*tangent[i]+(-2*t3+3*t2)*ys[i+1]+(t3-t2)*h*tangent[i+1]

def loft(name,sections,mat,n=36,sides=40,exponent=2.55,caps=True):
    # [z, centre y, width, top radius, bottom radius, top width factor]
    sections=sorted(sections);xs=[s[0] for s in sections];verts=[];uv=[];faces=[]
    e=2/exponent
    for i in range(n+1):
        z=xs[0]+(xs[-1]-xs[0])*i/n;s=[pchip(xs,[q[k] for q in sections],z) for k in range(1,6)]
        cy,w,top,bottom,tw=s
        for j in range(sides):
            a=j/sides*2*math.pi;c=math.cos(a);si=math.sin(a)
            x=math.copysign(abs(c)**e,c)*w*(1-(1-tw)*max(0,si))
            y=cy+math.copysign(abs(si)**e,si)*(top if si>0 else bottom)
            verts.append((x,y,z));uv.append((j/sides,(z-xs[0])/(xs[-1]-xs[0])))
    for i in range(n):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides;c=(i+1)*sides+(j+1)%sides;d=(i+1)*sides+j
            faces.append((a,b,c,d))
    if caps:
        faces.append(tuple(reversed(range(sides))));faces.append(tuple(n*sides+j for j in range(sides)))
    return mesh(name,verts,faces,mat,uv)

def select(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def bevel(o,width=.002,segments=2):
    select(o);mod=o.modifiers.new('Machined edge radius','BEVEL');mod.width=width;mod.segments=segments;mod.limit_method='ANGLE';mod.angle_limit=.48
    bpy.ops.object.modifier_apply(modifier=mod.name)

def cube(name,loc,scale,mat,bevelwidth=.006,rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(loc));o=bpy.context.object;o.name=name;o.dimensions=(scale[0],scale[2],scale[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mats[mat]);objects.append(o)
    if rotation:o.rotation_euler=rotation
    if bevelwidth:bevel(o,bevelwidth,3)
    for f in o.data.polygons:f.use_smooth=True
    return o

def cut_ellipse(o,loc,radii,axis='z'):
    # Cutter through the shell, with a recessed dark end wall added separately.
    bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=1,depth=2,location=xyz(loc));c=bpy.context.object
    if axis=='z':c.rotation_euler[0]=math.pi/2;c.scale=(radii[0],radii[1],radii[2])
    else:c.rotation_euler[1]=math.pi/2;c.scale=(radii[2],radii[1],radii[0])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    select(o);mod=o.modifiers.new('Recess / open intake','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=c
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(c,do_unlink=True)

# Continuous, deliberately asymmetric-height cross-sections, not scaled spheres.
upper=loft('GP continuous upper cowl',[
(.365,.020,.240,.285,.190,.64),(.45,.072,.258,.254,.150,.68),(.545,.134,.264,.190,.106,.72),
(.66,.168,.243,.151,.068,.71),(.78,.18,.203,.115,.058,.68),(.882,.165,.132,.079,.047,.67),
(.942,.153,.081,.053,.040,.79),(.974,.150,.060,.035,.032,.94)],'paint',48,48,2.5)
cut_ellipse(upper,(0,.147,.943),(.042,.022,.13))
# The tunnel has actual thickness and a back wall, rather than a black circle sticker.
loft('Ram air duct liner',[(.804,.147,.037,.020,.020,1),(.902,.147,.039,.021,.021,1),(.974,.147,.0417,.0217,.0217,1)],'dark',8,28,2,caps=False)
loft('Ram air dark throat',[(.940,.147,.041,.021,.021,1),(.942,.147,.041,.021,.021,1)],'dark',1,28,2)

lower=loft('GP lower shell and belly pan',[
(-.24,-.369,.112,.06,.074,1),(-.12,-.278,.155,.133,.151,.96),(.015,-.207,.187,.196,.225,.91),
(.15,-.16,.219,.214,.284,.85),(.27,-.128,.234,.228,.294,.85),(.365,-.117,.239,.196,.230,.88),
(.402,-.108,.236,.155,.195,.93)],'paint',40,40,2.65)
loft('GP carbon belly edge',[(-.18,-.434,.107,.008,.012,1),(.0,-.435,.168,.009,.013,1),(.25,-.435,.192,.010,.012,1),(.36,-.35,.183,.007,.009,1)],'carbon',18,24,2.8)
# A recessed side exit, common to both sides; the dark inner radiator remains separate.
# Avoid paper-thin unsupported side vents and avoid moving the tyre/fork envelopes.
for side in [-1,1]:
    vent=cube('GP recessed cooling exit '+str(side),(side*.232,-.030,.288),(.007,.085,.116),'dark',.014)
    # A shaped lip frames the exit at the shell edge, in the paint finish.
    for yy in [-.079,.017]:
        cube('Cooling exit lip',(side*.235,yy,.285),(.008,.007,.116),'paint',.003)
    # Precisely following flank graphics, closed ribbon surface.
    vv=[];ff=[]
    for i in range(25):
        z=-.06+.427*i/24;w=pchip([-.06,.1,.26,.367],[.173,.213,.238,.243],z)
        y=pchip([-.06,.1,.26,.367],[-.12,-.078,-.023,.025],z)
        for dy in [-.009,.009]:vv.append((side*(w+.0018),y+dy,z))
    for i in range(24):
        face=(i*2,i*2+1,i*2+3,i*2+2);ff.append(face if side<0 else tuple(reversed(face)))
    mesh('GP flank identity ribbon '+str(side),vv,ff,'accent')

# Dense lofts preserve curvature in highlights without subdivision at runtime.
loft('GP scalloped tank',[
(-.14,.223,.115,.066,.058,1),(0,.263,.163,.091,.079,.94),(.16,.261,.17,.080,.078,.92),
(.30,.242,.145,.066,.067,.93),(.412,.224,.106,.055,.057,1)],'paint',36,40,2.35)
# Central tank grip panel and distinct matte contact pad.
loft('Tank carbon spine',[
(-.08,.318,.066,.004,.003,1),(.035,.355,.078,.004,.003,1),(.165,.343,.078,.004,.003,1),
(.30,.309,.069,.003,.003,1),(.373,.290,.047,.003,.003,1)],'carbon',24,20,2.2)

loft('GP raised tail shell',[
(-.835,.305,.035,.024,.025,.7),(-.76,.305,.077,.038,.043,.7),(-.63,.283,.108,.065,.072,.74),
(-.49,.233,.13,.076,.106,.80),(-.31,.185,.14,.058,.075,.92),(-.105,.17,.125,.038,.056,1)],'paint',36,40,2.45)
cube('GP contoured seat pad',(0,.24,-.305),(.191,.026,.260),'seat',.012)

# Paired swept biplanes: true aerofoil thickness, taper and negative-space gaps.
def wing(side,tier):
    v=[];uv=[];f=[];span=8;chordsteps=18
    for i in range(span+1):
        t=i/span;x=side*(.198+.143*t);chord=.151-.034*t;sweep=-.026*t
        y=.183-tier*.064-.028*t;z=.790-tier*.026+sweep
        ring=[]
        for j in range(chordsteps*2):
            u=j/chordsteps if j<=chordsteps else (2*chordsteps-j)/chordsteps
            thick=5*.075*(.2969*math.sqrt(max(u,0))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)*chord
            camber=.016*math.sin(u*math.pi)*(1-.18*t)
            yy=y+camber+(thick if j<=chordsteps else -thick)
            ring.append((x,yy,z-u*chord));uv.append((t,u))
        v.extend(ring)
    r=chordsteps*2
    for i in range(span):
        for j in range(r):
            face=(i*r+j,i*r+(j+1)%r,(i+1)*r+(j+1)%r,(i+1)*r+j)
            f.append(face if side>0 else tuple(reversed(face)))
    f.append(tuple(reversed(range(r))) if side>0 else tuple(range(r)))
    f.append(tuple(span*r+j for j in range(r)) if side>0 else tuple(reversed([span*r+j for j in range(r)])))
    return mesh('GP swept wing '+str(side)+' '+str(tier),v,f,'carbon',uv)
for side in [-1,1]:
    for tier in [0,1]:wing(side,tier)
    # Shaped end fence instead of the former sharp rectangular box.
    v=[(side*.339,.143,.745),(side*.340,.165,.756),(side*.341,.174,.697),(side*.339,.125,.627),
       (side*.337,.076,.627),(side*.335,.073,.690)]
    fence=mesh('Rounded aero end fence '+str(side),v,[tuple(range(6)) if side>0 else tuple(reversed(range(6)))],'paint')
    select(fence);mod=fence.modifiers.new('End fence thickness','SOLIDIFY');mod.thickness=.004;bpy.ops.object.modifier_apply(modifier=mod.name);bevel(fence,.0015,2)
    # Twin rear fins, strongly visible in rear chase view but below rider clearance.
    v=[(side*.062,.322,-.798),(side*.074,.365,-.758),(side*.087,.406,-.680),(side*.078,.363,-.624),
       (side*.059,.319,-.655)]
    fin=mesh('GP rear aero fin '+str(side),v,[tuple(range(5)) if side>0 else tuple(reversed(range(5)))],'paint')
    select(fin);mod=fin.modifiers.new('Fin thickness','SOLIDIFY');mod.thickness=.0035;bpy.ops.object.modifier_apply(modifier=mod.name);bevel(fin,.001,2)

# Freeze modifiers, ensure outward normals and triangle-safe export.
for o in objects:
    select(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=o.modifiers.new('Triangle bake','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in o.data.polygons: poly.use_smooth=True
    # Bevel interpolates corner UVs on the thin solidified fins/fences. That
    # interpolation is not bit-stable across runs and feeds the decimator's
    # attribute costs. Restore the same authored planar projection directly
    # from the final vertex positions; leave geometry and normals untouched.
    if o.name.startswith(('Rounded aero end fence', 'GP rear aero fin')):
        uv = o.data.uv_layers.active
        for loop in o.data.loops:
            co = o.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (-float(co.y) * 2, float(co.z) * 2)

# Export grouped geometry in game coordinates. Position+normal+UV vertices are
# deduplicated; material groups stay separate for entrant-specific finishes.
def export_geometry(objs,ratio=1):
    buckets={};duplicates=[]
    for src in objs:
        o=src
        if ratio<1:
            o=src.copy();o.data=src.data.copy();bpy.context.collection.objects.link(o);duplicates.append(o)
            if len(o.data.polygons)>80:
                select(o);dec=o.modifiers.new('Distance LOD','DECIMATE');dec.ratio=ratio;dec.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=dec.name)
        d=o.data;d.calc_loop_triangles();uv=d.uv_layers.active
        normalmatrix=o.matrix_world.to_3x3().inverted().transposed()
        for tri in d.loop_triangles:
            name=d.materials[tri.material_index].name if d.materials else 'paint'
            b=buckets.setdefault(name,{'position':[],'normal':[],'uv':[],'index':[],'lookup':{}})
            for li in tri.loops:
                loop=d.loops[li];point=o.matrix_world@d.vertices[loop.vertex_index].co
                norm=(normalmatrix@d.corner_normals[li].vector).normalized()
                u=uv.data[li].uv if uv else (point.x,point.y)
                pt=(point.x,point.z,-point.y);nn=(norm.x,norm.z,-norm.y)
                key=tuple(round(float(v),6) for v in (*pt,*nn,float(u[0]),float(u[1])))
                if key not in b['lookup']:
                    b['lookup'][key]=len(b['position'])//3;b['position']+=list(key[:3]);b['normal']+=list(key[3:6]);b['uv']+=list(key[6:])
                b['index'].append(b['lookup'][key])
    for o in duplicates:bpy.data.objects.remove(o,do_unlink=True)
    result=[]
    for name,b in buckets.items():
        del b['lookup'];result.append({'material':name,**b})
    return result
high=export_geometry(objects);mid=export_geometry(objects,.22)
asset={'version':1,'unit':'metre','forward':'+Z','up':'+Y','high':high,'mid':mid}
(out/'gp-bodywork.mesh.json').write_text(json.dumps(asset,separators=(',',':'))+'\n')
# Editable native source + standard interchange model, excluding preview stage.
select(objects[0]);bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'motobound-gp-bodywork.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'motobound-gp-bodywork.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True)
stats={'highTriangles':sum(len(x['index'])//3 for x in high),'midTriangles':sum(len(x['index'])//3 for x in mid),'highDrawCalls':len(high),'midDrawCalls':len(mid),'sourceObjects':len(objects)}
(out/'gp-bodywork-stats.json').write_text(json.dumps(stats,indent=2)+'\n');print('GP_BODYWORK',json.dumps(stats))
