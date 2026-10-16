"""MotoBound R3.1 original 42-tooth rear sprocket and motorcycle link geometry.
Blender 5.2.2 headless: blender -b --python author_gp_chain_drive.py -- --out DIR
Artist interchange source, not a licensed manufacturer's model; the game
animates equivalent procedural instanced components with replay wheel phase.
"""
import bpy,sys,argparse,math
from pathlib import Path
from mathutils import Vector
cmd=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--out',default='gp-chain-authoring');out=Path(p.parse_args(cmd).out).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
TAU=2*math.pi; TEETH=42; D=.52; X=.115

def m(name,color,metal=.85,rough=.31):
  a=bpy.data.materials.new(name);a.diffuse_color=(*color,1);a.use_nodes=True
  b=a.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=rough
  return a
steel=m('Fine brushed tempered steel',(.36,.38,.41))
alum=m('Machined aluminum sprocket',(.39,.42,.46),.95,.32)
dark=m('Forged outer link plate',(.09,.095,.102),.6,.48)

def xyz(x,y,z): return (x,-z,y)
def piece(name,vertices,faces,mat):
  me=bpy.data.meshes.new(name);me.from_pydata([xyz(*v) for v in vertices],[],faces);me.update()
  obj=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(obj);me.materials.append(mat)
  for f in me.polygons:f.use_smooth=True
  return obj
n=TEETH*8;verts=[];faces=[];z=-D
for i in range(n):
 a=TAU*i/n;r=.102+.0042*math.cos(TEETH*a)
 for x,radius in ((X-.0035,r),(X-.0035,.069),(X+.0035,r),(X+.0035,.069)):
  verts.append((x,math.sin(a)*radius,z+math.cos(a)*radius))
for i in range(n):
 q=4*i;j=4*((i+1)%n)
 faces.extend(((q,q+1,j+1,j),(q+2,j+2,j+3,q+3),(q,j,j+2,q+2),(q+1,q+3,j+3,j+1)))
piece('Original 42-tooth machined rear sprocket',verts,faces,alum)
# The prototype drive-link assembly is repeated along the kinematic path at
# runtime using two InstancedMesh draws (pins and side plates).
# Blender stores a small physically scaled reference pair for artist edits.
def cylinder(name,loc,r,depth,mat,segments=16):
  bpy.ops.mesh.primitive_cylinder_add(vertices=segments,radius=r,depth=depth,location=xyz(*loc))
  o=bpy.context.object;o.name=name;o.rotation_euler[1]=math.pi/2;o.data.materials.append(mat)
  for f in o.data.polygons:f.use_smooth=True
  return o
def plate(name,loc):
  bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(*loc));o=bpy.context.object;o.name=name
  o.dimensions=(.0028,.014,.009);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  o.data.materials.append(dark);mod=o.modifiers.new('Round forged edges','BEVEL');mod.width=.0012;mod.segments=2
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  return o
# Staggered upper and lower drive spans show full-scale pitch and clearances.
for lane in [-1,1]:
 for i in range(24):
  t=i/23
  y=lane*(.046+(.106-.046)*t);zz=-D*t
  cylinder('Steel pin %s %02d' %(lane,i),(X,y,zz),.004,.016,steel,10)
  for side in [-1,1]:plate('Outer link plate %s %02d %s'%(lane,i,side),(X+side*.009,y,zz))
for i in range(27):
 a=math.pi/2+i*math.pi/26
 y=.106*math.sin(a);zz=-D+.106*math.cos(a)
 cylinder('Sprocket arc roller %02d'%i,(X,y,zz),.004,.016,steel,10)
 for side in [-1,1]:plate('Sprocket arc link %02d %s'%(i,side),(X+side*.009,y,zz))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'gp-chain-drive.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'gp-chain-drive.glb'),export_format='GLB',export_yup=True,export_apply=True)
print('GP_CHAIN_BUILT',len(bpy.data.objects),'objects,',TEETH,'teeth; output',out)
