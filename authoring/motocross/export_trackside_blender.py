"""Build editable, metre-scale Blender meshes from the exact runtime buffers.

First run scripts/export-mx-trackside.ts. Then:
blender -b --factory-startup --python authoring/motocross/export_trackside_blender.py -- OUTPUT_DIRECTORY

No assets are downloaded. Welded vertices, corner UVs, linear vertex colours,
and authored split normals are retained. Exports are supplementary to the
synchronous production TypeScript models, not asynchronously loaded replacements.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import sys
import bpy


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def axes(values):
    x, y, z = values
    return x, -z, y


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(args) != 1:
        raise SystemExit('Supply OUTPUT_DIRECTORY after --')
    out = Path(args[0]).resolve()
    source_path = out / 'mx-trackside-source.json'
    source_hash = digest(source_path)
    if source_hash != (out / 'mx-trackside-source.sha256').read_text().strip():
        raise RuntimeError('Runtime source fingerprint differs')
    source = json.loads(source_path.read_text())
    if source['schema'] != 1 or len(source['variants']) != 12:
        raise RuntimeError('Expected six models at two detail levels')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = {}
    for role, params in source['materials'].items():
        material = bpy.data.materials.new('MX trackside / ' + role)
        material.use_nodes = True
        material.use_backface_culling = not params['doubleSided']
        material.diffuse_color = (.48, .52, .45, 1)
        nodes = material.node_tree.nodes
        shader = nodes.get('Principled BSDF')
        shader.inputs['Roughness'].default_value = params['roughness']
        shader.inputs['Metallic'].default_value = params['metalness']
        colour = nodes.new('ShaderNodeVertexColor')
        colour.layer_name = 'Col'
        material.node_tree.links.new(colour.outputs['Color'], shader.inputs['Base Color'])
        materials[role] = material
    receipt = {'sourceSHA256': source_hash, 'blender': bpy.app.version_string, 'variants': []}
    collections = []
    for variant in source['variants']:
        label = variant['model'] + '-' + variant['detail']
        collection = bpy.data.collections.new(label)
        bpy.context.scene.collection.children.link(collection)
        collections.append((collection, variant))
        objects = []
        for part_index, part in enumerate(variant['parts']):
            attributes = part['attributes']
            positions, normals = attributes['position'], attributes['normal']
            if len(positions) % 9 or len(normals) != len(positions):
                raise RuntimeError('Invalid triangle buffers: ' + part['name'])
            vertices, faces, lookup, indices = [], [], {}, []
            for i in range(0, len(positions), 3):
                key = tuple(positions[i:i + 3])
                if key not in lookup:
                    lookup[key] = len(vertices)
                    vertices.append(axes(key))
                indices.append(lookup[key])
            faces = [indices[i:i + 3] for i in range(0, len(indices), 3)]
            mesh = bpy.data.meshes.new(label + ' / ' + part['name'])
            mesh.from_pydata(vertices, [], faces)
            mesh.update()
            uv = mesh.uv_layers.new(name='UVMap')
            colour = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
            split_normals = []
            for polygon in mesh.polygons:
                polygon.use_smooth = True
                for loop in polygon.loop_indices:
                    uv.data[loop].uv = attributes['uv'][loop * 2:loop * 2 + 2]
                    colour.data[loop].color = (*attributes['color'][loop * 3:loop * 3 + 3], 1.)
                    split_normals.append(axes(normals[loop * 3:loop * 3 + 3]))
            mesh.normals_split_custom_set(split_normals)
            obj = bpy.data.objects.new(part['name'], mesh)
            collection.objects.link(obj)
            obj.data.materials.append(materials[part['material']])
            obj['source_part'] = part_index
            obj['source_model'] = variant['model']
            obj['source_detail'] = variant['detail']
            objects.append(obj)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        target = out / (label + '.glb')
        bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB',
                                  use_selection=True, export_yup=True, export_extras=True)
        receipt['variants'].append({'model': variant['model'], 'detail': variant['detail'],
                                    'parts': len(objects), 'triangles': variant['triangles'],
                                    'file': target.name, 'bytes': target.stat().st_size,
                                    'sha256': digest(target)})
    # Arrange the native editing library only after exporting local-origin GLBs.
    names = list(dict.fromkeys(v['model'] for v in source['variants']))
    for collection, variant in collections:
        index = names.index(variant['model'])
        for obj in collection.objects:
            obj.location.x = index % 3 * 7
            obj.location.y = index // 3 * 7
        collection.hide_render = variant['detail'] != 'near'
        collection.hide_viewport = variant['detail'] != 'near'
    bpy.ops.object.select_all(action='DESELECT')
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene['mx_source_sha256'] = source_hash
    scene['mx_model_count'] = 6
    scene['mx_variant_count'] = 12
    scene['asset_policy'] = 'Original runtime models. No imported photographs, logos, or textures.'
    native = out / 'MOTOBOUND_MX_Trackside_Models.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(native), compress=True)
    receipt['native'] = {'file': native.name, 'bytes': native.stat().st_size,
                         'sha256': digest(native), 'meshObjects': len(bpy.data.objects)}
    (out / 'blender-export-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('MX_TRACKSIDE_NATIVE_EXPORT_PASS', json.dumps(receipt))


if __name__ == '__main__':
    main()
