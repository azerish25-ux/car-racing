"""Original parametric GP radial-brake caliper; Blender 5.2 LTS.
Generates an editable scene, exportable GLB and a macro product view. No game
screenshots or licensed geometry. Local Y = motorcycle vertical, Z = aft.
"""
import argparse
import math
import os
import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--out', default='/tmp/gp-radial-caliper')
args = parser.parse_args(__import__('sys').argv[__import__('sys').argv.index('--') + 1:] if '--' in __import__('sys').argv else [])
os.makedirs(args.out, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

metal = bpy.data.materials.new('Ceramic blasted magnesium alloy')
metal.diffuse_color = (0.37, 0.39, 0.405, 1)
metal.use_nodes = True
pbr = metal.node_tree.nodes.get('Principled BSDF'); pbr.inputs['Base Color'].default_value = (.37,.39,.405,1); pbr.inputs['Metallic'].default_value=.87; pbr.inputs['Roughness'].default_value=.29
steel = bpy.data.materials.new('Satin titanium fasteners')
steel.diffuse_color = (.65,.66,.69,1);steel.use_nodes = True
pbr=steel.node_tree.nodes.get('Principled BSDF');pbr.inputs['Base Color'].default_value=(.65,.66,.69,1);pbr.inputs['Metallic'].default_value=.92;pbr.inputs['Roughness'].default_value=.24
carbon = bpy.data.materials.new('Carbon friction pads')
carbon.diffuse_color = (.028,.028,.03,1);carbon.use_nodes=True
pbr=carbon.node_tree.nodes.get('Principled BSDF');pbr.inputs['Base Color'].default_value=(.028,.028,.03,1);pbr.inputs['Roughness'].default_value=.85
rubber = bpy.data.materials.new('Black hydraulic hose')
rubber.diffuse_color=(.017,.018,.02,1);rubber.use_nodes=True
pbr=rubber.node_tree.nodes.get('Principled BSDF');pbr.inputs['Base Color'].default_value=(.017,.018,.02,1);pbr.inputs['Roughness'].default_value=.72

caliper=bpy.data.collections.new('GP-R Radial Monobloc Caliper')
bpy.context.scene.collection.children.link(caliper)

def relocate(obj):
    for col in list(obj.users_collection):col.objects.unlink(obj)
    caliper.objects.link(obj)
    return obj

def bevel(obj, size=.003, segments=3):
    m=obj.modifiers.new('Machined radius','BEVEL');m.width=size;m.segments=segments
    n=obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');n.keep_sharp=True
    for p in obj.data.polygons:p.use_smooth=True
    return obj

def cube(name, loc, scale, material, b=.002):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o=relocate(bpy.context.object);o.name=name;o.dimensions=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    if b:bevel(o,b)
    return o

def cylinder(name,loc,r,depth,material,verts=24,orient='x',b=.0006):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=loc)
    o=relocate(bpy.context.object);o.name=name;o.data.materials.append(material)
    if orient=='x':o.rotation_euler.y=math.pi/2
    if orient=='z':o.rotation_euler.x=math.pi/2
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
    if b:bevel(o,b,2)
    return o

def sculpt(name, shift, material):
    # Sculpted silhouette in Y/Z; reference plane of a two-sided monobloc.
    profile=[(-.054,-.040),(-.063,-.015),(-.061,.014),(-.040,.035),(-.016,.039),(.012,.035),(.036,.027),(.052,.014),(.047,-.012),(.042,-.043),(.022,-.049),(-.021,-.050)]
    x=shift
    # closed watertight extruded profile (local X thickness 14mm)
    positions=[(x+a,y,z) for a in [-.007,.007] for y,z in profile]
    n=len(profile)
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    for i in range(n):j=(i+1)%n;faces.append((i,j,n+j,n+i))
    mesh=bpy.data.meshes.new(name+'_mesh');mesh.from_pydata(positions,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);caliper.objects.link(o);o.data.materials.append(material)
    return bevel(o,.0028,3)

for side in (-1,1):
    outer=sculpt(('Inboard','Outboard')[side>0]+' forged shell',side*.028,metal)
    for y in (-.031,.020):
        cylinder(f'Piston annulus {side:+d} {y:+.3f}',(side*.040,y,-.004),.018,.003,steel)
        cylinder(f'Machined piston boss {side:+d} {y:+.3f}',(side*.0425,y,-.004),.013,.003,metal)
    for y in (-.041,.037):
        cylinder(f'Ribbed fixing stud {side:+d} {y:+.3f}',(side*.042,y,-.028),.007,.008,steel,12)
        cylinder(f'Socket insert {side:+d} {y:+.3f}',(side*.047,y,-.028),.0035,.001,carbon,6,b=0)
# The rotor is between the two jaws, which remain open through the central slot.
for y in (-.046,.042):
    cube('Forged bridge at %0.3f m'%y,(0,y,-.029),(.055,.014,.021),metal,.004)
for side in (-1,1):
    cube(f'Serviceable friction pad carrier {side:+d}',(side*.015,-.006,.015),(.010,.086,.018),carbon,.0018)
# Banjo fitting and hydraulic line, terminating above the upper mounting boss.
cylinder('Hydraulic banjo bolt',(.044,.050,-.024),.008,.018,steel,18)
cube('Copper crush washer',(.051,.050,-.024),(.002,.016,.016),steel,.0005)
curve=bpy.data.curves.new('braided line',type='CURVE');curve.dimensions='3D';curve.bevel_depth=.0027;curve.bevel_resolution=3
s=curve.splines.new('BEZIER');s.bezier_points.add(3)
for p,co in zip(s.bezier_points,[(.044,.05,-.024),(.052,.082,-.013),(.08,.12,.004),(.089,.155,.04)]):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
hose=bpy.data.objects.new('Braided braided-line feed',curve);caliper.objects.link(hose);hose.data.materials.append(rubber)
cylinder('Bleed nipple',(-.043,.051,.014),.003,.015,steel,12)
# Spare rotor placed in a separate reference collection, not exported as part of the caliper.
preview=bpy.data.collections.new('Presentation only - rotor alignment reference')
bpy.context.scene.collection.children.link(preview)
bpy.ops.mesh.primitive_torus_add(major_segments=96,minor_segments=12,location=(0,0,0),major_radius=.148,minor_radius=.021)
rot=bpy.context.object;rot.name='Carbon rotor alignment - not exported';rot.rotation_euler.y=math.pi/2;rot.data.materials.append(carbon)
for c in list(rot.users_collection):c.objects.unlink(rot)
preview.objects.link(rot)

world=bpy.context.scene.world or bpy.data.worlds.new('Photo studio')
bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.17,.2,.24,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.38

def area(loc,power,size):
    d=bpy.data.lights.new('Softbox','AREA');d.energy=power;d.shape='DISK';d.size=size
    o=bpy.data.objects.new('Large diffused highlight',d);bpy.context.scene.collection.objects.link(o);o.location=loc;direction=Vector((0,0,0))-o.location;o.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
area((.45,-.3,.26),2.0,.38);area((-.25,.25,.21),0.9,.3)
cam=bpy.data.cameras.new('100mm close-up');camobj=bpy.data.objects.new('Camera',cam);bpy.context.collection.objects.link(camobj);bpy.context.scene.camera=camobj
camobj.location=(.34,-.20,.33);camobj.rotation_euler=(Vector((0,0,0))-camobj.location).to_track_quat('-Z','Y').to_euler();cam.type='ORTHO';cam.ortho_scale=.41
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1050;scene.render.resolution_y=770;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=os.path.join(args.out,'gp-radial-caliper-review.png')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out,'gp-radial-caliper.blend'))
# Export only the mechanically usable part; exclude camera, lights and rotor.
bpy.ops.object.select_all(action='DESELECT')
for o in caliper.objects:o.select_set(True)
bpy.context.view_layer.objects.active=next(iter(caliper.objects))
bpy.ops.export_scene.gltf(filepath=os.path.join(args.out,'gp-radial-caliper.glb'),export_format='GLB',use_selection=True,export_apply=True)
# Render finished product view from the authored scene.
bpy.ops.render.render(write_still=True)
print('CALIPER_READY objects',len(caliper.objects),'output',args.out)
