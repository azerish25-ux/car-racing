"""Original MotoBound GP aero/bodywork, metres, +Z forward in the game.
Blender 5.2 headless: blender -b --python build_gp_bodywork.py -- --out DIR
The baked indexed geometry is loaded synchronously by Three.js; no network,
GLTF decoder or asynchronous loading race is introduced during a race.
Reference principles: supplied REF 001,004,018,022,027,049,056,060,071,073,087,098.
No source image, manufacturer geometry, logo or livery is embedded.
"""
import bpy, bmesh, math, json, argparse, sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_gp_geometry import export_geometry, NORMAL_ALGORITHM
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--out',default='gp-bodywork'); opt=p.parse_args(args)
out=Path(opt.out).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
# Three.js (x,y,z) -> Blender (x,-z,y); exporter converts back to Y-up.
def xyz(v): return (v[0],-v[2],v[1])
def material(name,col,metal=0,rough=.35):
    m=bpy.data.materials.new(name);m.diffuse_color=(*col,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*col,1);bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
    if name in ('paint','secondary','accent'): bs.inputs['Coat Weight'].default_value=.62;bs.inputs['Coat Roughness'].default_value=.21
    return m
mats={
'paint':material('paint',(.3192,.01512,.02184),0,.36),
'secondary':material('secondary',(.015,.026,.034)),
'accent':material('accent',(.88,.89,.83)),
'carbon':material('carbon',(.024,.026,.03),.08,.47),
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

# Retain the previously validated upper cowl for every non-GP-R1 machine.
# This independent geometry is NOT part of the GP-R1 assembly.
legacy_upper = loft('Catalogue instrument cowl (unchanged)',[
(.365,.020,.240,.285,.190,.64),(.45,.072,.258,.254,.150,.68),(.545,.134,.264,.190,.106,.72),
(.66,.168,.243,.151,.068,.71),(.78,.18,.203,.115,.058,.68),(.882,.165,.132,.079,.047,.67),
(.942,.153,.081,.053,.040,.79),(.974,.150,.060,.035,.032,.94)],'paint',48,48,2.5)
cut_ellipse(legacy_upper,(0,.147,.943),(.042,.022,.13))
def cockpit_well(o):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz((0,.405,.49)))
    cutter=bpy.context.object;cutter.name='Instrument well negative volume'
    cutter.dimensions=(.25,.44,.39)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bevel(cutter,.028,3)
    select(o);mod=o.modifiers.new('Open instrument well','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
cockpit_well(legacy_upper)
objects.remove(legacy_upper)

# REF 001/019/022/049/056: a broad, compact race nose. The old narrowing
# ellipse terminated in a long toy-like snout. The new nose retains shoulder
# width over the wheel and a recessed rectangular-oval intake below the number.
upper = loft('GP-R1 compact aero nose',[
(.36,.046,.239,.250,.160,.70),(.47,.080,.247,.233,.127,.74),
(.58,.112,.249,.199,.103,.78),(.69,.133,.249,.161,.079,.82),
(.78,.129,.237,.139,.067,.88),(.856,.128,.214,.095,.053,.94),
(.899,.119,.191,.049,.038,1),(.914,.110,.172,.029,.025,1)],'paint',32,40,3.15)
# A narrow rounded rectangular opening in the actual mesh, not an oval tube
# ending a long snout. The shape leaves a manufactured composite lip.
bpy.ops.mesh.primitive_cube_add(size=1,location=xyz((0,.102,.883)))
cutter=bpy.context.object;cutter.name='GP letterbox intake negative'
cutter.dimensions=(.143,.31,.041)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
bevel(cutter,.011,3)
select(upper);cut=upper.modifiers.new('Recessed ram air aperture','BOOLEAN');cut.operation='DIFFERENCE';cut.solver='EXACT';cut.object=cutter
bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
cockpit_well(upper)
# Hollow intake, with a deep back wall; the face is never a black decal.
duct=loft('Deep ram air inner duct',[(.750,.102,.063,.018,.018,1),(.84,.102,.068,.0195,.0195,1),(.915,.102,.071,.020,.020,1)],'dark',5,24,3.5,caps=False)
bm=bmesh.new();bm.from_mesh(duct.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(duct.data);bm.free()
loft('Ram air recessed throat',[(.748,.102,.063,.018,.018,1),(.750,.102,.063,.018,.018,1)],'dark',1,24,3.5)

# A thin formed carbon/composite sheet. Solidify produces real inside faces
# and a closed rim so a side view no longer resembles a solid plastic block.
def solidify(o,thickness=.0035):
    select(o);mod=o.modifiers.new('Composite shell thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=-1;mod.use_even_offset=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
def swept_panel(name,side,stations,mat,rows=30,columns=10):
    # z, maximum width, top height, bottom height
    xs=[s[0] for s in stations];v=[];uv=[];f=[]
    for i in range(rows+1):
        z=xs[0]+(xs[-1]-xs[0])*i/rows
        w,top,bottom=[pchip(xs,[s[k] for s in stations],z) for k in [1,2,3]]
        for j in range(columns+1):
            t=j/columns;y=bottom+(top-bottom)*t
            # broad face, rounded keel and a turned-in upper shoulder
            factor=.72+.28*math.sin(t*math.pi*.88)**.55
            v.append((side*w*factor,y,z));uv.append(((z+.3)/.72,t))
    for i in range(rows):
        for j in range(columns):
            a=i*(columns+1)+j;b=a+columns+1
            face=(a,a+1,b+1,b);f.append(face if side>0 else tuple(reversed(face)))
    o=mesh(name,v,f,mat,uv);solidify(o);return o
side_stations=[(-.28,.117,-.18,-.365),(-.14,.163,-.025,-.411),(.02,.207,.069,-.441),(.16,.238,.12,-.443),(.29,.246,.115,-.403),(.40,.235,.16,-.288)]
for side in [-1,1]:
    panel=swept_panel('Removable fairing panel '+str(side),side,side_stations,'paint')
    # REF 018/022: open exit through composite, not a raised black rectangle.
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz((side*.245,.001,.268)))
    cutter=bpy.context.object;cutter.dimensions=(.20,.119,.075)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);bevel(cutter,.011,2)
    select(panel);mod=panel.modifiers.new('Open cooling exit','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
    # Thin dark skirt terminates the paint and catches a narrow rim highlight.
    skirt_stations=[(z,w*.984,bottom+.055,bottom+.005) for z,w,top,bottom in side_stations]
    swept_panel('Lower carbon service skirt '+str(side),side,skirt_stations,'carbon',22,3)

# Open-top oil containment pan: there is no filling material between the two sides.
v=[];uv=[];f=[];rows=26;cols=18
for i in range(rows+1):
    z=-.26+.651*i/rows
    w=pchip([-.26,-.12,.1,.29,.391],[.103,.147,.174,.181,.158],z)
    floor=pchip([-.26,-.12,.1,.29,.391],[-.357,-.416,-.451,-.416,-.294],z)
    for j in range(cols+1):
        u=2*j/cols-1
        v.append((u*w,floor+.043*abs(u)**5,z));uv.append((j/cols,i/rows))
for i in range(rows):
    for j in range(cols):
        a=i*(cols+1)+j;b=a+cols+1;f.append((a,b,b+1,a+1))
pan=mesh('Open-top composite oil pan',v,f,'secondary',uv);solidify(pan,.004)

# REF 004/018/073: narrower waist with real knee scallops below tank shoulders.
loft('GP-R1 sculpted tank',[
(-.17,.225,.099,.053,.055,1),(-.09,.247,.129,.077,.075,.91),
(.03,.265,.16,.096,.083,.93),(.16,.264,.173,.090,.08,.93),
(.30,.243,.147,.074,.067,.94),(.407,.223,.105,.052,.053,1)],'paint',28,32,2.15)
loft('Tank carbon contact strip',[
(-.09,.324,.050,.003,.004,1),(.04,.363,.066,.003,.004,1),
(.16,.356,.066,.003,.004,1),(.30,.319,.057,.003,.004,1),(.373,.287,.037,.003,.003,1)],'carbon',16,16,2)
# A machined flush filler ring plus inset cap, only centimetres across.
def cylinder_part(name,loc,radius,depth,mat,vertices=20,axis='y'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=xyz(loc))
    o=bpy.context.object;o.name=name;o.data.materials.append(mats[mat]);objects.append(o)
    if axis=='x':o.rotation_euler[1]=math.pi/2
    if axis=='z':o.rotation_euler[0]=math.pi/2
    bevel(o,.0006,1)
    return o
cylinder_part('Flush alloy fuel filler surround',(0,.363,.10),.036,.003,'aluminium',24)
cylinder_part('Recessed fuel filler cap',(0,.365,.10),.028,.003,'dark',20)
for k in range(6):
    a=math.tau*k/6;cylinder_part('Fuel filler retainer',(math.cos(a)*.032,.3655,.1+math.sin(a)*.032),.0018,.001,'aluminium',6)

# REF 059/071/087: seat is a shallow saddle, tail is compact and tapered, not fins like ears.
loft('GP-R1 compact tail',[
(-.827,.30,.033,.020,.024,.72),(-.766,.309,.072,.035,.039,.76),
(-.635,.289,.099,.055,.062,.79),(-.50,.242,.117,.061,.077,.84),
(-.36,.193,.131,.051,.066,.95),(-.17,.176,.115,.034,.048,1)],'paint',24,28,2.2)
loft('Moulded foam saddle',[
(-.486,.244,.050,.012,.016,1),(-.435,.244,.087,.010,.016,1),
(-.31,.235,.100,.011,.015,1),(-.203,.23,.092,.013,.014,1),
(-.167,.224,.063,.009,.01,1)],'seat',14,24,2.4)

# Swept biplanes with a curved outboard joining channel. Leading edges have a
# rounded aerofoil section and every blade has an independent underside.
def wing(side,tier):
    v=[];uv=[];f=[];span=6;chordsteps=12
    for i in range(span+1):
        t=i/span;x=side*(.17+.181*t);chord=.176-.031*t
        y=.150-tier*.067-.015*t;z=.860-tier*.027-.032*t
        for j in range(chordsteps*2):
            u=j/chordsteps if j<=chordsteps else (2*chordsteps-j)/chordsteps
            thickness=5*.082*(.2969*math.sqrt(max(u,0))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)*chord
            camber=.009*math.sin(math.pi*u)
            v.append((x,y+camber+(thickness if j<=chordsteps else -thickness),z-u*chord));uv.append((t,u))
    r=chordsteps*2
    for i in range(span):
        for j in range(r):
            face=(i*r+j,i*r+(j+1)%r,(i+1)*r+(j+1)%r,(i+1)*r+j);f.append(face if side>0 else tuple(reversed(face)))
    f.append(tuple(reversed(range(r))) if side>0 else tuple(range(r)))
    f.append(tuple(span*r+j for j in range(r)) if side>0 else tuple(reversed([span*r+j for j in range(r)])))
    return mesh('GP-R1 cambered wing '+str(side)+' '+str(tier),v,f,'carbon',uv)
for side in [-1,1]:
    for tier in [0,1]:wing(side,tier)
    # Bowed edge fence, joining the ends without a square tip.
    v=[];uv=[];f=[]
    for i in range(9):
        t=i/8;y=.066+.074*t;x=side*(.347+.006*math.sin(math.pi*t))
        for j in range(5):
            u=j/4;v.append((x,y,.66+.167*u-.018*(1-t)));uv.append((u,t))
    for i in range(8):
        for j in range(4):
            a=i*5+j;b=a+5;face=(a,a+1,b+1,b);f.append(face if side>0 else tuple(reversed(face)))
    end=mesh('Curved wing-tip return '+str(side),v,f,'carbon',uv);solidify(end,.003)
    # Low split rear aerodynamic rails follow the tail, not isolated spikes.
    v=[(side*.056,.332,-.798),(side*.072,.354,-.739),(side*.085,.371,-.668),(side*.088,.339,-.629),(side*.070,.304,-.674)]
    fin=mesh('Tail aero rail '+str(side),v,[tuple(range(5)) if side>0 else tuple(reversed(range(5)))],'carbon');solidify(fin,.003);bevel(fin,.001,1)
    # Service fasteners remain within the shell's real surface envelope.
    for z,y,w in [(-.13,-.15,.157),(.05,-.11,.211),(.345,-.09,.238),(.55,.15,.253),(.76,.17,.226)]:
        cylinder_part('Quarter-turn fairing fixing',(side*(w+.0015),y,z),.0042,.002,'aluminium',8,'x')

# Freeze modifiers, ensure outward normals and triangle-safe export.
for o in objects + [legacy_upper]:
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
high=export_geometry(objects);mid=export_geometry(objects,.22)
asset={'version':3,'unit':'metre','forward':'+Z','up':'+Y','high':high,'mid':mid,
       'upperHigh':export_geometry([legacy_upper],stable_normals=False),'upperMid':export_geometry([legacy_upper],.22,stable_normals=False),
       'normalExport':NORMAL_ALGORITHM}
(out/'gp-bodywork.mesh.json').write_text(json.dumps(asset,separators=(',',':'))+'\n')
# Save a stable source-object ordering; the runtime exporter never depends on
# Blender's database/alphabetic object enumeration after reopening the file.
for order, obj in enumerate(objects):
    obj['gp_export_order'] = order
legacy_upper['gp_legacy_cowl'] = True
bpy.context.scene['gp_normal_algorithm'] = NORMAL_ALGORITHM
# Preserve the non-GP compatibility cowl as a hidden authoring reference.
legacy_upper.hide_render = True
legacy_upper.hide_set(True)
# Editable native source + standard interchange model, excluding preview stage.
select(objects[0]);bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'motobound-gp-bodywork.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'motobound-gp-bodywork.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True)
stats={'highTriangles':sum(len(x['index'])//3 for x in high),'midTriangles':sum(len(x['index'])//3 for x in mid),'highDrawCalls':len(high),'midDrawCalls':len(mid),'sourceObjects':len(objects)}
(out/'gp-bodywork-stats.json').write_text(json.dumps(stats,indent=2)+'\n');print('GP_BODYWORK',json.dumps(stats))
