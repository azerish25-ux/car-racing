"""Verify reproducible R5 runtime bytes and unchanged non-GP/crew assets.

Native Blender/GLB files may carry different ordering metadata between exports;
only the JSON consumed by the game is claimed byte reproducible.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import struct

p = argparse.ArgumentParser()
p.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
p.add_argument('--report', type=Path)
a = p.parse_args()
root = a.root.resolve()
sha = lambda b: hashlib.sha256(b).hexdigest()
canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
expected = {
    # New reviewed R5-refined geometry and integer-area normal algorithm.
    # This is NOT an alternate hash accepted for the earlier failed R5 bake.
    'bodywork': '72a7fb6e2e47c2be0abd1b89495f74d1e9c64dc1f4c755540aa8b0983dadd3d4',
    'humanKit': 'e3512bd4cad0fa5b5ae7d67c0cd469da1b9ae928952b2437685ca459f196555e',
    'catalogueCowls': 'b8d58ec356b76850980ede882411ab16b981a2cafc621177b83823d32009fce1',
    'retainedCrew': '5e4bd3a9781c1d104a46815112b9671d8cc51722689fa2ba2b675e0522835216',
}
body_bytes = (root/'src/rendering/assets/gp-bodywork.mesh.json').read_bytes()
human_bytes = (root/'src/rendering/human-kit.json').read_bytes()
body, humans = json.loads(body_bytes), json.loads(human_bytes)
observed = {
    'bodywork': sha(body_bytes),
    'humanKit': sha(human_bytes),
    'catalogueCowls': sha(canonical({k: body[k] for k in ('upperHigh', 'upperMid')})),
    'retainedCrew': sha(canonical({k: v for k, v in humans['meshes'].items()
                                 if not k.startswith('spectator_')})),
}
if observed != expected:
    raise RuntimeError(f'R5 asset identity or retained asset mismatch: {observed}')
if body.get('normalExport') != 'integer-area-decimal-normal-v1':
    raise RuntimeError('Missing deterministic normal export contract')
if body['version'] != 3 or body['unit'] != 'metre' or body['forward'] != '+Z':
    raise RuntimeError('Wrong runtime coordinate contract')
counts = {}
for lod in ('high', 'mid'):
    count = 0
    if len(body[lod]) != 6:
        raise RuntimeError('Unexpected material batch count')
    for part in body[lod]:
        n = len(part['position'])//3
        if not n or len(part['normal']) != n*3 or len(part['uv']) != n*2:
            raise RuntimeError('Mismatched authored vertex attributes')
        for key in ('position', 'normal', 'uv'):
            if not all(math.isfinite(v) for v in part[key]):
                raise RuntimeError('Non-finite authored geometry')
        if len(part['index']) % 3 or not all(isinstance(i, int) and 0 <= i < n for i in part['index']):
            raise RuntimeError('Invalid authored index buffer')
        count += len(part['index'])//3
    counts[lod] = count
if counts != {'high': 16684, 'mid': 4050}:
    raise RuntimeError(f'Unexpected bodywork triangle count {counts}')
spectators = {k: v['triangles'] for k, v in humans['meshes'].items() if k.startswith('spectator_')}
if spectators != {f'spectator_{build}_{lod}': triangles for build in ('a', 'b')
                  for lod, triangles in enumerate((6556, 1408, 624))}:
    raise RuntimeError(f'Spectator LOD budgets changed: {spectators}')
for name, mesh in humans['meshes'].items():
    if name.startswith('spectator_') and min(mesh['min'][1], mesh['standingMin'][1]) < -0.300001:
        raise RuntimeError(f'Spectator shoe below the authored stair tread: {name}')
glb_path = root/'authoring/motogp/motobound-gp-bodywork.glb'
glb = glb_path.read_bytes()
if struct.unpack_from('<4sII', glb) != (b'glTF', 2, len(glb)):
    raise RuntimeError('Invalid GLB header or byte length')
json_length, kind = struct.unpack_from('<I4s', glb, 12)
if kind != b'JSON':
    raise RuntimeError('Missing GLB scene metadata')
scene = json.loads(glb[20:20+json_length])
if len(scene['meshes']) != 38:
    raise RuntimeError('Incomplete native bodywork export')
report = {'passed': True, 'runtimeHashes': observed, 'bodyworkTriangles': counts,
          'spectatorTriangles': spectators, 'nativeMeshes': len(scene['meshes']),
          'nativeGLBSHA256': sha(glb), 'nativeGLBBytes': len(glb),
          'scope': 'Asset identity and geometry contracts, not full-game or hardware acceptance.'}
if a.report:
    a.report.parent.mkdir(parents=True, exist_ok=True)
    a.report.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
