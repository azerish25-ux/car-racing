"""Original MOTOBOUND motocross apparel and track-pad meshes.

Run with Blender 5.2:
  blender -b --factory-startup --python authoring/motocross/build_kit.py -- \
    --output src/rendering/assets/mx-authored-kit.mesh.json \
    --blend /mnt/data/motocross-authored-kit.blend

Coordinates exported in metres, Y up, +Z forward, with the unchanged Rider
IK anchors. Source images are visual references only; no third-party pixels,
logos, meshes, or textures are embedded. The editable .blend retains the
original quad cages and live subdivision modifiers. The runtime uses baked
high/mid meshes, not a Blender executable or an extra asynchronous loader.
"""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
import bmesh
from mathutils import Vector

TAU = math.tau
# y, centre Z, half width, front depth, back depth. The jersey has a rib cage,
# waist, shoulder saddle and neck opening, rather than a scaled capsule.
TORSO = [
    (-.062, -.008, .139, .100, .100),
    (-.025, -.006, .151, .111, .110),
    (.060, -.006, .157, .111, .111),
    (.155, .004, .149, .105, .100),
    (.260, .011, .166, .119, .104),
    (.350, .013, .187, .126, .106),
    (.430, .014, .202, .115, .097),
    (.474, .017, .180, .090, .084),
    (.510, .022, .124, .067, .061),
    (.539, .027, .067, .058, .055),
]
LIMBS = {
    'upper-arm': (.29, [
        (-.11, 0, .006, .006, .006), (0, 0, .047, .044, .050),
        (.18, -.002, .056, .051, .058), (.39, -.002, .052, .049, .053),
        (.65, .001, .045, .041, .043), (.9, .003, .038, .037, .037),
        (1.0, .002, .036, .034, .036), (1.105, 0, .004, .004, .004)]),
    'forearm': (.28, [
        (-.12, 0, .004, .004, .004), (0, -.003, .040, .039, .042),
        (.18, -.003, .047, .049, .048), (.38, -.005, .043, .046, .045),
        (.68, -.003, .035, .037, .036), (.9, 0, .029, .031, .030),
        (1.0, 0, .028, .030, .029), (1.1, 0, .003, .003, .003)]),
    'thigh': (.44, [
        (-.1, 0, .009, .009, .009), (-.02, 0, .067, .075, .070),
        (.15, .003, .084, .089, .080), (.35, .005, .079, .085, .075),
        (.60, .005, .066, .072, .062), (.85, .003, .054, .060, .051),
        (1.0, .002, .052, .052, .049), (1.11, 0, .004, .004, .004)]),
    'shin': (.44, [
        (-.10, .003, .004, .004, .004), (0, .004, .050, .054, .048),
        (.2, -.006, .048, .046, .056), (.4, -.011, .050, .045, .060),
        (.66, -.007, .041, .039, .048), (.9, -.003, .033, .034, .036),
        (1.0, 0, .033, .034, .034), (1.10, 0, .004, .004, .004)]),
}


def smooth_profile(rows, y, axis):
    i = 0
    while i < len(rows) - 2 and y > rows[i + 1][0]:
        i += 1
    a, b = rows[i], rows[i + 1]
    left, right = rows[max(0, i - 1)], rows[min(len(rows) - 1, i + 2)]
    d = b[0] - a[0]
    t = max(0, min(1, (y - a[0]) / d))
    m0 = (b[axis] - left[axis]) / (b[0] - left[0])
    m1 = (right[axis] - a[axis]) / (right[0] - a[0])
    value = ((2*t**3 - 3*t*t + 1) * a[axis] + (t**3-2*t*t+t)*d*m0
             + (-2*t**3 + 3*t*t)*b[axis] + (t**3-t*t)*d*m1)
    return min(max(a[axis], b[axis]), max(min(a[axis], b[axis]), value))


def to_blender(p):
    return (p[0], -p[2], p[1])


def mesh_object(name, positions, faces, corner_uvs):
    mesh = bpy.data.meshes.new(name + '_quad_cage')
    mesh.from_pydata([to_blender(p) for p in positions], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    layer = mesh.uv_layers.new(name='GarmentUV')
    for poly, uvs in zip(mesh.polygons, corner_uvs):
        poly.use_smooth = True
        for loop, uv in zip(poly.loop_indices, uvs):
            layer.data[loop].uv = uv
    return obj


def apparel(name, rows, cols, rings, subd):
    ys = [r[0] for r in rows]
    lo, hi = ys[0], ys[-1]
    vertices, faces, uvs = [], [], []
    for j in range(rings + 1):
        t = j / rings
        y = lo + (hi - lo) * t
        cz, w, front, back = [smooth_profile(rows, y, k) for k in range(1, 5)]
        for k in range(cols):
            a = k / cols * TAU
            c, s = math.cos(a), math.sin(a)
            if name == 'torso':
                # Tension fans from the armpits, compression at the tucked hem.
                envelope = math.sin(t * math.pi) ** .8
                waist = math.exp(-((t-.19)/.16)**2)
                ribs = math.exp(-((t-.66)/.19)**2)
                fold = envelope * (.0024*math.sin(t*28 + a*3)
                    + .0042*waist*math.sin(t*67 + 1.7*a)
                    + .0023*ribs*math.sin(36*t - 4*a))
                shape = lambda v: math.copysign(abs(v)**.89, v)
            else:
                # Elbow/knee fabric gathers, with quiet taut mid-bone surfaces.
                end = math.exp(-((t-.79)/.17)**2) + .6*math.exp(-((t-.19)/.14)**2)
                fold = math.sin(t*math.pi)**2 * (
                    .0024*end*math.sin(56*t + 3*a) + .0015*math.sin(23*t - 2*a))
                shape = lambda v: v
            vertices.append((shape(c)*(w+fold), y, cz+shape(s)*((front if s>0 else back)+fold)))
    for j in range(rings):
        for i in range(cols):
            n = (i+1) % cols
            faces.append((j*cols+i, (j+1)*cols+i, (j+1)*cols+n, j*cols+n))
            uvs.append(((i/cols,j/rings),(i/cols,(j+1)/rings),((i+1)/cols,(j+1)/rings),((i+1)/cols,j/rings)))
    # Closed caps inside the connected joint/neck make the mesh robust in shadows.
    faces.extend([tuple(range(cols)), tuple(rings*cols+i for i in range(cols-1,-1,-1))])
    # A point UV on a closed cap has a singular texture footprint. Some
    # anisotropic samplers then fetch unrelated decal texels. Map each cap
    # into a small, unprinted hem patch instead of reducing filtering quality.
    for ring, top in [(range(cols), False),
                      (range(rings*cols+cols-1, rings*cols-1, -1), True)]:
        cap = [vertices[i] for i in ring]
        radius_x = max(abs(p[0]) for p in cap)
        centre_z = sum(p[2] for p in cap) / len(cap)
        radius_z = max(abs(p[2]-centre_z) for p in cap)
        uvs.append(tuple((.5 + .018*p[0]/radius_x,
                          (.993 if top else .007) + .006*(p[2]-centre_z)/radius_z)
                         for p in cap))
    obj = mesh_object(name, vertices, faces, uvs)
    modifier = obj.modifiers.new('Cloth surface subdivision', 'SUBSURF')
    modifier.subdivision_type = 'CATMULL_CLARK'
    modifier.levels = subd
    modifier.render_levels = subd
    obj['reference_intent'] = 'Clothed human anatomy, tension folds, unchanged game IK anchors'
    return obj


def safety_pad(detail="high"):
    # Six subdivided faces of a soft, bevelled canvas pad, with compression
    # creases and slight dents. All deformations are INWARD of collision size.
    half = (.34, .29, 1.05)
    bevel = .037
    vertices, faces, uvs = [], [], []
    # p = normal-axis fixed, two varying axes. Positive winding from the cross.
    for axis, sign, uaxis, vaxis in [(0,1,1,2),(0,-1,2,1),(1,1,2,0),(1,-1,0,2),(2,1,0,1),(2,-1,1,0)]:
        nu = (14 if uaxis == 2 else 8) if detail == "high" else (6 if uaxis == 2 else 4)
        nv = (14 if vaxis == 2 else 8) if detail == "high" else (6 if vaxis == 2 else 4)
        base = len(vertices)
        for j in range(nv+1):
            for i in range(nu+1):
                p=[0.,0.,0.]
                p[axis]=sign*half[axis]
                p[uaxis]=(i/nu*2-1)*half[uaxis]
                p[vaxis]=(j/nv*2-1)*half[vaxis]
                inner=[max(-half[k]+bevel,min(half[k]-bevel,p[k])) for k in range(3)]
                ray=Vector(p)-Vector(inner)
                ray.normalize()
                p=[inner[k]+ray[k]*bevel for k in range(3)]
                envelope=math.sin(i/nu*math.pi)*math.sin(j/nv*math.pi)
                # Almost-flat broad canvas with tension creases near the corners.
                dent=.0035*envelope**2*(.5+.5*math.sin(i*1.9+j*.6))
                if axis != 1:
                    dent += .005*envelope**2*math.exp(-((j/nv-.18)/.16)**2)*(1+math.sin(i*2.2))*.5
                dent *= math.sin(i/nu*math.tau)**2
                p[axis]-=sign*dent
                vertices.append(tuple(p))
        for j in range(nv):
            for i in range(nu):
                a=base+j*(nu+1)+i
                faces.append((a,a+1,a+nu+2,a+nu+1))
                # Project the long face in physical axes, so the wordmark is horizontal.
                face_uv = []
                for vi in (a,a+1,a+nu+2,a+nu+1):
                    v = vertices[vi]
                    u = v[2]/(2*half[2])+.5 if axis != 2 else v[0]/(2*half[0])+.5
                    vv = v[1]/(2*half[1])+.5 if axis != 1 else v[0]/(2*half[0])+.5
                    # Each exterior face has a right-handed (U,V,normal) basis.
                    # Opposite long sides and end caps must not mirror the wordmark.
                    if (axis == 0 and sign > 0) or (axis == 2 and sign < 0): u = 1-u
                    if axis == 1 and sign < 0: vv = 1-vv
                    face_uv.append((u,vv))
                uvs.append(tuple(face_uv))
    obj=mesh_object('safety-pad-' + detail,vertices,faces,uvs)
    # Share the rounded edge vertices so the cloth does not acquire six hard
    # box-face normals. Per-corner UV seams remain separate after the weld.
    bm=bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    # Recalculate topology-consistent smooth shading without inflating the pad.
    obj['collision_envelope_m']='0.68 x 0.58 x 2.10; render-only inward surface detail'
    return obj


def bake(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=deps)
    try:
        mesh.calc_loop_triangles()
        uv_layer = mesh.uv_layers.active.data
        positions, normals, uvs, indices, seen = [], [], [], [], {}
        for tri in mesh.loop_triangles:
            for loop_id in tri.loops:
                loop = mesh.loops[loop_id]
                p = mesh.vertices[loop.vertex_index].co
                n = mesh.corner_normals[loop_id].vector
                uv = uv_layer[loop_id].uv
                key = tuple(round(v) for v in (
                    p.x*1e6,p.z*1e6,-p.y*1e6,
                    n.x*32767,n.z*32767,-n.y*32767,
                    uv.x*32767,uv.y*32767))
                if key not in seen:
                    seen[key]=len(positions)//3
                    positions.extend(key[:3]); normals.extend(key[3:6]); uvs.extend(key[6:])
                indices.append(seen[key])
        return {'position':positions,'normal':normals,'uv':uvs,'index':indices}
    finally:
        evaluated.to_mesh_clear()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--blend', type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    assets={}
    for name, rows in [('torso',TORSO)]+[(name,[(t*length,z,w,f,b) for t,z,w,f,b in rows]) for name,(length,rows) in LIMBS.items()]:
        obj=apparel(name,rows,24 if name=='torso' else 16,22 if name=='torso' else 16,1)
        high=bake(obj)
        obj.modifiers[0].levels=0
        mid=bake(obj)
        obj.modifiers[0].levels=1
        assets[name]={'high':high,'mid':mid}
    pad=safety_pad()
    assets['safety-pad']={'high':bake(pad), 'mid':bake(safety_pad('mid'))}
    payload={'schema':'motobound.mx-authored-kit.v1','units':'metres','up':'Y','forward':'+Z',
             'positionScale':1e-6,'normalScale':1/32767,'uvScale':1/32767,
             'authoring':{'software':'Blender','version':bpy.app.version_string,
                          'source':'authoring/motocross/build_kit.py','thirdPartyAssets':False},
             'meshes':assets}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(payload,separators=(',',':'))+'\n')
    if args.blend:
        args.blend.parent.mkdir(parents=True,exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend))
    for name,levels in assets.items():
        print(name,{level:len(mesh['index'])//3 for level,mesh in levels.items()})
    print('MX authored kit:',args.output,args.output.stat().st_size)

if __name__ == '__main__':
    main()
