"""Reopen the editable MX source and compare every runtime vertex, normal and UV.

Run from the repository root:
  blender -b -t 2 --factory-startup --python-exit-code 1 \
    --python authoring/motocross/verify_saved_kit.py -- --report /tmp/mx-native.json
This verifier does not regenerate the source scene or write to the repository.
"""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import sys
import bpy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--report', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    root = args.root.resolve()
    scene_path = root / 'authoring/motocross/motocross-authored-kit.blend'
    asset_path = root / 'src/rendering/assets/mx-authored-kit.mesh.json'
    source = asset_path.read_bytes()
    expected = json.loads(source)
    if expected['schema'] != 'motobound.mx-authored-kit.v1':
        raise ValueError('Unexpected MX runtime schema')
    if bpy.app.version_string != expected['authoring']['version']:
        raise RuntimeError('Use the Blender version recorded by the runtime mesh')
    bpy.ops.wm.open_mainfile(filepath=str(scene_path), load_ui=False)
    exporter = runpy.run_path(str(root / 'authoring/motocross/build_kit.py'), run_name='mx_verification')
    proof = []
    for part, levels in expected['meshes'].items():
        for level, target in levels.items():
            name = f'safety-pad-{level}' if part == 'safety-pad' else part
            obj = bpy.data.objects.get(name)
            if obj is None or obj.type != 'MESH':
                raise RuntimeError(f'Missing editable mesh: {name}')
            modifier = None
            if part != 'safety-pad':
                modifier = next((m for m in obj.modifiers if m.type == 'SUBSURF'), None)
                if modifier is None:
                    raise RuntimeError(f'Missing editable subdivision cage: {part}')
                previous = modifier.levels
                modifier.levels = 1 if level == 'high' else 0
                bpy.context.view_layer.update()
            try:
                actual = exporter['bake'](obj)
                for attribute in ('position', 'normal', 'uv', 'index'):
                    if actual[attribute] != target[attribute]:
                        raise AssertionError(f'Saved scene differs: {part}/{level}/{attribute}')
            finally:
                if modifier is not None:
                    modifier.levels = previous
                    bpy.context.view_layer.update()
            proof.append({'part': part, 'detail': level, 'triangles': len(target['index']) // 3,
                          'positionsNormalsUVsAndIndicesIdentical': True})
    report = {'blender': bpy.app.version_string,
              'sceneSHA256': hashlib.sha256(scene_path.read_bytes()).hexdigest(),
              'runtimeSHA256': hashlib.sha256(source).hexdigest(),
              'sceneReopened': True, 'sourceSceneRegenerated': False,
              'objectCount': len(bpy.data.objects), 'meshes': proof}
    text = json.dumps(report, indent=2) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text)
    print(text)


if __name__ == '__main__':
    main()
