"""Render the saved original GP shell without rebuilding or overwriting it.
blender -b --factory-startup -t 2 --python this_file.py -- --source MODEL.blend --out DIRECTORY
These are bodywork-only Blender inspections, not game screenshots.
"""
import argparse
from pathlib import Path
import sys
import bpy
from mathutils import Vector

p=argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
a.out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(a.source.resolve()))
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.resolution_x=1000
scene.render.resolution_y=700
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.18,.18,.18,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.25
bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.51))
floor=bpy.context.object
floor.name='Inspection floor (not a runtime asset)'
m=bpy.data.materials.new('Inspection neutral surface');m.diffuse_color=(.09,.09,.095,1);m.use_nodes=True
m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.09,.09,.095,1)
m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.7
floor.data.materials.append(m)
for name, position, power, size in [
 ('Key', (2,-3,4), 550, 3.0), ('Fill',(-3,-1,2),330,2.5), ('Rim',(0,3,3),620,2.0)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size
 o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=position
 o.rotation_euler=(Vector((0,0,.1))-o.location).to_track_quat('-Z','Y').to_euler()
c=bpy.data.cameras.new('Saved-shell inspection camera');c.lens=60
cam=bpy.data.objects.new('Saved-shell inspection camera',c);scene.collection.objects.link(cam);scene.camera=cam
for name, eye, target in [
 ('gp-r5-bodywork-front',(1.85,-2.5,1.25),(0,-.05,.02)),
 ('gp-r5-bodywork-rear',(-1.9,2.45,1.1),(0,0,.02))]:
 cam.location=eye;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=str((a.out/(name+'.png')).resolve())
 bpy.ops.render.render(write_still=True)
print('SAVED_SOURCE_REVIEW_COMPLETE',a.source)
