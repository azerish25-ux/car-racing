"""Reopen the retained GP .blend and export its saved meshes, without rebuilding.

blender -b --factory-startup -t 2 --python-exit-code 1 --python \
  tools/motogp/reexport_saved_gp.py -- --source SOURCE.blend --out SEPARATE_DIR
The input file is never saved or overwritten. Preview meshes are excluded.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_gp_geometry import export_geometry, NORMAL_ALGORITHM

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
source, out = args.source.resolve(), args.out.resolve()
if source.parent == out:
    raise ValueError('Use a separate export directory; do not overwrite the retained source')
source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source))
objects = sorted((o for o in bpy.context.scene.objects if 'gp_export_order' in o),
                 key=lambda o: o['gp_export_order'])
legacy = [o for o in bpy.context.scene.objects if o.get('gp_legacy_cowl')]
if len(objects) != 38 or [o['gp_export_order'] for o in objects] != list(range(38)) or len(legacy) != 1:
    raise ValueError('Retained native source-object contract is incomplete')
if bpy.context.scene.get('gp_normal_algorithm') != NORMAL_ALGORITHM:
    raise ValueError('Retained source normal-export convention differs')
for o in objects:
    o.hide_set(False)
high, mid = export_geometry(objects), export_geometry(objects, .22)
asset = {'version': 3, 'unit': 'metre', 'forward': '+Z', 'up': '+Y',
         'high': high, 'mid': mid,
         'upperHigh': export_geometry(legacy, stable_normals=False),
         'upperMid': export_geometry(legacy, .22, stable_normals=False),
         'normalExport': NORMAL_ALGORITHM}
raw = (json.dumps(asset, separators=(',', ':'))+'\n').encode()
(out/'gp-bodywork.mesh.json').write_bytes(raw)
bpy.ops.object.select_all(action='DESELECT')
for o in objects: o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.export_scene.gltf(filepath=str(out/'motobound-gp-bodywork.glb'),
                         export_format='GLB', use_selection=True,
                         export_apply=True, export_yup=True)
if hashlib.sha256(source.read_bytes()).hexdigest() != source_sha:
    raise RuntimeError('Saved-source file was unexpectedly changed')
print('SAVED_GP_REEXPORT', json.dumps({'sourceSHA256': source_sha,
      'runtimeSHA256': hashlib.sha256(raw).hexdigest(), 'runtimeBytes': len(raw),
      'sourceObjects': len(objects), 'sourceFileUnchanged': True}))
