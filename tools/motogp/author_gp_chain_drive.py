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
 a=TAU*i/n;r=.103+.0022*math.cos(TEETH*a)
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
# One closed, full-size 520-chain loop with nearly one pin per 15.875 mm.
# The runtime spline rounds the four tangent transitions continuously.
FRONT=.046;REAR=.106
perimeter=2*D+math.pi*(FRONT+REAR)
links=round(perimeter/.015875)
for i in range(links):
  path_s=i*perimeter/links
  if path_s<D:
    t=path_s/D
    yy=FRONT+(REAR-FRONT)*t;zz=-D*t
    ty=(REAR-FRONT)/D;tz=-1
  elif path_s<D+math.pi*REAR:
    a=math.pi/2+(path_s-D)/REAR
    yy=REAR*math.sin(a);zz=-D+REAR*math.cos(a)
    ty=math.cos(a);tz=-math.sin(a)
  elif path_s<2*D+math.pi*REAR:
    t=(path_s-D-math.pi*REAR)/D
    yy=-(REAR+(FRONT-REAR)*t);zz=-D+D*t
    ty=(REAR-FRONT)/D;tz=1
  else:
    a=3*math.pi/2+(path_s-2*D-math.pi*REAR)/FRONT
    yy=FRONT*math.sin(a);zz=FRONT*math.cos(a)
    ty=math.cos(a);tz=-math.sin(a)
  cylinder('Steel chain pin %03d'%i,(X,yy,zz),.004,.016,steel,10)
  for side in [-1,1]:
    o=plate('Forged sideplate %03d %s'%(i,side),(X+side*.009,yy,zz))
    # Local Blender +Y (long side of each plate) follows the belt tangent.
    o.rotation_euler.x=math.atan2(ty,-tz)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'gp-chain-drive.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'gp-chain-drive.glb'),export_format='GLB',export_yup=True,export_apply=True)
print('GP_CHAIN_BUILT',len(bpy.data.objects),'objects,',TEETH,'teeth; output',out)
