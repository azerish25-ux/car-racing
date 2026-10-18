"""Original bevelled architectural joinery. No external assets or fonts.
Run with Blender --background --python-exit-code 1 --python this_file -- --root .
--source reopens a saved .blend and exports without regenerating its meshes.
Runtime coordinates: X across opening, Y up, Z out of wall. X/Y normalized to
opening dimensions, Z remains metres. Native Blender geometry is Z-up.
"""
from pathlib import Path
import argparse, json, sys, math, hashlib
import bpy
from mathutils import Matrix

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', default='.')
p.add_argument('--source')
a = p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
root = Path(a.root).resolve()
edit = root/'authoring/solvane'; edit.mkdir(parents=True, exist_ok=True)
out = root/'src/rendering/assets'; out.mkdir(parents=True, exist_ok=True)
public = root/'public/models/solvane'; public.mkdir(parents=True, exist_ok=True)
colors = {'frame': (0.19,0.22,0.215,1), 'stone': (0.52,0.49,0.43,1), 'shutter': (0.16,0.23,0.205,1)}
refs = [12,13,14,20,26,27,30,31,34,38,53,56,64,66,69,80,81,82,83,86,89,96,97]

if a.source:
    bpy.ops.wm.open_mainfile(filepath=str(Path(a.source).resolve()))
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for role,color in colors.items():
        m=bpy.data.materials.new(role); m.diffuse_color=color; m.use_nodes=True
        bsdf=m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value=color
        bsdf.inputs['Roughness'].default_value=.55 if role=='frame' else .79
        bsdf.inputs['Metallic'].default_value=.12 if role=='frame' else 0
    def box(parent,name,pos,dim,role,bevel=.006,angle=0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
        ob=bpy.context.object; ob.name=name; ob.dimensions=dim
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        if angle: ob.rotation_euler.x=angle
        ob.data.materials.append(bpy.data.materials[role])
        if bevel:
            mod=ob.modifiers.new('Manufactured edge radius','BEVEL');mod.width=bevel;mod.segments=2
            bpy.ops.object.modifier_apply(modifier=mod.name)
        ob.parent=parent
        return ob
    for kind in ['casement','shop','shuttered']:
        parent=bpy.data.objects.new(kind,None);bpy.context.collection.objects.link(parent)
        parent['solvane_joinery']=kind; parent['reference_ids']=refs
        for side in [-1,1]:
            box(parent,'Rebated frame stile',(side*.485,0,-.14),(.032,1.02,.10),'frame')
            box(parent,'Rebated frame rail',(0,side*.485,-.14),(.94,.032,.10),'frame')
        if kind=='shop':
            for u in [-1/6,1/6]: box(parent,'Storefront mullion',(u,0,-.132),(.02,.94,.071),'frame',.004)
            box(parent,'Shop transom',(0,.28,-.132),(.94,.019,.071),'frame',.004)
            box(parent,'Door pull',(.12,-.11,-.075),(.012,.20,.018),'frame',.003)
        else:
            box(parent,'Casement meeting stile',(0,0,-.132),(.024,.94,.074),'frame',.004)
            box(parent,'Casement transom',(0,.13,-.132),(.94,.022,.074),'frame',.004)
        box(parent,'Weathered projecting sill',(0,-.518,-.06),(1.14,.050,.30),'stone',.012)
        # An underside drip groove terminates the projecting sill.
        box(parent,'Drip groove',(0,-.54,.085),(1.07,.008,.012),'frame',.002)
        if kind=='shuttered':
            for side in [-1,1]:
                for u in [side*.58,side*.90]:
                    box(parent,'Shutter stile',(u,0,.039),(.032,1.045,.048),'shutter',.006)
                for v in [-.50,.50]:
                    box(parent,'Shutter rail',(side*.74,v,.039),(.34,.032,.048),'shutter',.006)
                for j in range(11):
                    box(parent,'Tilted timber louvre',(side*.74,-.442+j*.087,.04),(.29,.069,.016),'shutter',.003,math.radians(25))
        # Apply local transforms, merge per material, then convert runtime Y-up
        # to native Z-up once. The saved source is the independent authority.
        for role in colors:
            obs=[o for o in parent.children if o.type=='MESH' and o.data.materials[0].name==role]
            if not obs:continue
            bpy.ops.object.select_all(action='DESELECT')
            for ob in obs:ob.select_set(True)
            bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join()
            ob=bpy.context.object
            ob.data.transform(ob.matrix_local);ob.matrix_local.identity()
            ob.data.transform(Matrix.Rotation(math.pi/2,4,'X'));ob.data.update()
            ob.name=kind+'__'+role;ob.data.name=ob.name
    bpy.context.scene['authoring_note']='Original Solvane joinery; editable material-separated meshes, no baked photos.'
    bpy.ops.wm.save_as_mainfile(filepath=str(edit/'facade-joinery.blend'))

# Export an indexed, quantized copy for synchronous, bounded instancing. Integer
# positions use 0.1 mm in normalized-template space; normals use signed snorm16.
# Exported loops preserve bevel normals and hard edges instead of averaging them.
record={'schema':1,'positionScale':10000,'normalScale':32767,'templates':{}}
parents=sorted([o for o in bpy.data.objects if o.get('solvane_joinery')], key=lambda o:o.name)
assert {o.name for o in parents}=={'casement','shop','shuttered'}
for parent in parents:
    parts=[]
    for ob in sorted(parent.children,key=lambda o:o.name):
        if ob.type!='MESH':continue
        me=ob.data;me.calc_loop_triangles()
        lookup={};vertices=[];normals=[];indices=[]
        for tri in me.loop_triangles:
            for li in tri.loops:
                loop=me.loops[li];co=me.vertices[loop.vertex_index].co
                no=me.corner_normals[li].vector
                pos=tuple(round(v*10000) for v in (co.x,co.z,-co.y))
                normal=tuple(round(v*32767) for v in (no.x,no.z,-no.y))
                key=pos+normal
                if key not in lookup:
                    lookup[key]=len(vertices)//3;vertices.extend(pos);normals.extend(normal)
                indices.append(lookup[key])
        parts.append({'role':me.materials[0].name,'position':vertices,'normal':normals,'index':indices})
    record['templates'][parent.name]=parts
runtime=out/'solvane-joinery.mesh.json'
runtime.write_text(json.dumps(record,separators=(',',':'))+'\n')
bpy.ops.object.select_all(action='DESELECT')
for ob in parents:
    ob.select_set(True)
    for child in ob.children_recursive: child.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(public/'facade-joinery.glb'),export_format='GLB',use_selection=True,
    export_yup=True,export_apply=False,export_extras=True,export_texcoords=False,
    export_normals=True,export_materials='EXPORT',export_animations=False,export_cameras=False,export_lights=False)
report={'version':1,'blender':bpy.app.version_string,'source':'authoring/solvane/facade-joinery.blend',
        'runtime':'src/rendering/assets/solvane-joinery.mesh.json','runtimeSha256':hashlib.sha256(runtime.read_bytes()).hexdigest(),
        'referenceIds':refs,'templates':{k:{'vertices':sum(len(p['position'])//3 for p in parts),'triangles':sum(len(p['index'])//3 for p in parts),'materials':len(parts)} for k,parts in record['templates'].items()}}
(public/'facade-joinery.manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print('JOINERY_EXPORT',json.dumps(report))
