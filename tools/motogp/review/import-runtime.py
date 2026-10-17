"""Open actual production GLB exchange as editable Blender objects.

This preserves the assembled colour-visible geometry and hierarchy. It does not
convert game IK, custom GLSL or physics into a Blender rig. Inspection lighting
is named separately and is not part of the runtime asset.
"""
import argparse,sys,json,hashlib
from pathlib import Path
import bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--render',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);a.out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((a.input/'manifest.json').read_text());receipts=[]
for item in manifest['assets']:
 ident=item['id'];source=a.input/f'{ident}-runtime.glb';raw=source.read_bytes()
 assert hashlib.sha256(raw).hexdigest()==item['sha256']
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(source.resolve()))
 objects=[o for o in bpy.data.objects if o.type=='MESH']; triangles=0
 for obj in objects:
  obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
 assert triangles==item['visibleTriangles'],(ident,triangles,item['visibleTriangles'])
 assert len(objects)==item['visibleMeshes'],(ident,len(objects),item['visibleMeshes'])
 scene=bpy.context.scene
 scene['asset_boundary']='Actual production model exchange. Held pose; game IK, physics and custom GLSL are retained in TypeScript, not converted to Blender animation.'
 scene['source_glb_sha256']=item['sha256'];scene['source_visible_triangles']=triangles
 scene['source_visible_mesh_objects']=len(objects)
 # Put only the inspection camera/lights/floor in a separate collection.
 review=bpy.data.collections.new('INSPECTION ONLY - not a game asset');scene.collection.children.link(review)
 def review_object(obj):
  for collection in list(obj.users_collection):collection.objects.unlink(obj)
  review.objects.link(obj)
 bpy.ops.mesh.primitive_plane_add(size=100,location=(0,0,-.002));floor=bpy.context.object;floor.name='Inspection floor';review_object(floor)
 mat=bpy.data.materials.new('Inspection floor');mat.use_nodes=True
 principled=mat.node_tree.nodes.get('Principled BSDF');principled.inputs['Base Color'].default_value=(.045,.055,.062,1);principled.inputs['Roughness'].default_value=.68
 floor.data.materials.append(mat)
 scene.world=bpy.data.worlds.new('Inspection world');scene.world.use_nodes=True
 scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.18,.20,.23,1)
 scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.35
 target=Vector((0,0,.7))
 for name,xyz,power,size in [('Key',(-3,-2.5,4),1050,3),('Fill',(3,-1,2.4),450,2.5),('Rim',(1,3,3.5),1300,2.8)]:
  light=bpy.data.lights.new(name,'AREA');light.energy=power;light.shape='DISK';light.size=size
  obj=bpy.data.objects.new(name,light);review.objects.link(obj);obj.location=xyz
  obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler()
 camera=bpy.data.cameras.new('Inspection camera');camera.lens=55
 obj=bpy.data.objects.new('Inspection camera',camera);review.objects.link(obj);scene.camera=obj
 obj.location=(-2.8,-3.35,1.65);obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler()
 scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=True
 scene.render.resolution_x=1200;scene.render.resolution_y=800;scene.render.resolution_percentage=100
 scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
 bpy.ops.file.pack_all()
 output=a.out/f'{ident}-assembled-inspection.blend';bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()),compress=True)
 record={'id':ident,'meshObjects':len(objects),'triangles':triangles,'materials':len(bpy.data.materials)-1,'packedImages':sum(1 for x in bpy.data.images if x.packed_file),'glbSha256':item['sha256'],'blendSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'blendBytes':output.stat().st_size,'boundary':scene['asset_boundary']}
 if a.render:
  scene.render.filepath=str((a.out/f'{ident}-native-inspection.png').resolve());bpy.ops.render.render(write_still=True)
 receipts.append(record)
(a.out/'native-exchange-verification.json').write_text(json.dumps({'assets':receipts},indent=2)+'\n')
print('ASSEMBLED_RUNTIME_EXCHANGE_VERIFIED',json.dumps(receipts))
