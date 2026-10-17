"""Import the exact runtime drivetrain into Blender for editable inspection.
First run export_gp_drivetrain_review.ts; then:
blender -b --python tools/motogp/review_gp_drivetrain.py -- --input DIR/gp-drivetrain-runtime.json --out DIR --render
The JSON records source identity. No different, higher-detail presentation mesh
is substituted for the runtime geometry. The review stage is excluded from GLB.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    data = json.loads(Path(args.input).read_text())
    if data.get('schema') != 1 or data.get('unit') != 'metre':
        raise ValueError('Expected schema 1 runtime geometry in metres')
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    asset = bpy.data.collections.new('RUNTIME DRIVETRAIN — exact exported geometry')
    scene.collection.children.link(asset)
    basis = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    inverse = basis.inverted()
    materials = []
    for i, source in enumerate(data['materials']):
        mat = bpy.data.materials.new(('Steel rollers', 'Blackened link plates', 'Forged sprocket')[i])
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*source['colour'], 1)
        bsdf.inputs['Roughness'].default_value = source['roughness']
        bsdf.inputs['Metallic'].default_value = source['metalness']
        materials.append(mat)
    total = 0
    for entry in data['meshes']:
        raw = entry['position']
        vertices = [basis.to_3x3() @ Vector(raw[i:i + 3]) for i in range(0, len(raw), 3)]
        indices = entry['index']
        faces = [indices[i:i + 3] for i in range(0, len(indices), 3)]
        mesh = bpy.data.meshes.new(entry['name'])
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        mesh.materials.append(materials[entry['material']])
        uv = mesh.uv_layers.new(name='Runtime UV')
        for loop in mesh.loops:
            k = loop.vertex_index * 2
            uv.data[loop.index].uv = entry['uv'][k:k + 2]
        normals = entry['normal']
        for poly in mesh.polygons:
            poly.use_smooth = True
        mesh.normals_split_custom_set_from_vertices([
            basis.to_3x3() @ Vector(normals[i:i + 3]) for i in range(0, len(normals), 3)
        ])
        for i, values in enumerate(entry['matrices']):
            obj = bpy.data.objects.new(f"{entry['name']} {i:03d}", mesh)
            asset.objects.link(obj)
            transform = Matrix([[values[col * 4 + row] for col in range(4)] for row in range(4)])
            obj.matrix_world = basis @ transform @ inverse
            obj['runtime_source_sha256'] = data['sourceSHA256']
            total += len(faces)
    if total != data['expandedTriangles']:
        raise ValueError(f"Geometry changed in authoring transfer: {total} triangles")
    scene['runtime_source_sha256'] = data['sourceSHA256']
    scene['runtime_triangles'] = total
    scene['runtime_link_count'] = data['links']
    scene.unit_settings.system = 'METRIC'
    bpy.ops.object.select_all(action='DESELECT')
    for obj in asset.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(asset.objects))
    bpy.ops.export_scene.gltf(filepath=str(out / 'gp-drivetrain-r31.glb'), export_format='GLB', use_selection=True, export_yup=True)

    # Separate neutral review stage; none of this becomes a shipping game asset.
    stage = bpy.data.collections.new('REVIEW STAGE — excluded from runtime GLB')
    scene.collection.children.link(stage)
    def stage_object(obj):
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        stage.objects.link(obj)
        return obj
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.124))
    floor = stage_object(bpy.context.object)
    floor.name = 'Review floor'
    mat = bpy.data.materials.new('Neutral studio floor')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.075, 0.085, 0.10, 1)
    bsdf.inputs['Roughness'].default_value = 0.7
    floor.data.materials.append(mat)
    target = Vector((0.115, 0.26, 0.0))
    def aim(obj, at):
        obj.rotation_euler = (Vector(at) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    for name, location, power, size in [
        ('Large key', (1.0, -0.3, 1.6), 100, 1.25),
        ('Soft fill', (-0.4, 0.0, 0.8), 65, 0.8),
        ('Edge light', (0.2, 1.1, 0.8), 110, 0.65),
    ]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.shape, light.size = power, 'DISK', size
        obj = bpy.data.objects.new(name, light)
        stage.objects.link(obj)
        obj.location = location
        aim(obj, target)
    camera = bpy.data.cameras.new('Drivetrain inspection lens')
    obj = bpy.data.objects.new('Drivetrain inspection camera', camera)
    stage.objects.link(obj)
    obj.location = (1.15, 0.63, 0.52)
    aim(obj, target)
    camera.type = 'ORTHO'
    camera.ortho_scale = 0.87
    camera.clip_start, camera.clip_end = 0.01, 100
    scene.camera = obj
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.resolution_percentage = 100
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.25, 0.3, 0.4, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25
    scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.wm.save_as_mainfile(filepath=str(out / 'gp-drivetrain-r31.blend'))
    if args.render:
        scene.render.filepath = str(out / 'gp-drivetrain-r31-blender.png')
        bpy.ops.render.render(write_still=True)
    (out / 'blender-transfer-verification.json').write_text(json.dumps({
        'blender': bpy.app.version_string, 'sourceSHA256': data['sourceSHA256'],
        'expandedTriangles': total, 'links': data['links'],
        'sharedMeshDatablocks': len(data['meshes']), 'runtimeInstances': len(asset.objects),
        'stageIncludedInGLB': False,
    }, indent=2) + '\n')
    print('EXACT_RUNTIME_BLENDER_TRANSFER', data['sourceSHA256'], total)


if __name__ == '__main__':
    main()
