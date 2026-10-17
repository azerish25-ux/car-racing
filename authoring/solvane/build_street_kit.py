"""Original, editable street service / canvas / drainage kit, in metres.

blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python authoring/solvane/build_street_kit.py -- --output-root /tmp/street-kit

--source reopens a saved .blend, without regenerating or overwriting it.
The production GLB and manifest are exported from the same saved meshes.
No fonts, downloaded textures, reference screenshots or trademarks are used.
"""
from pathlib import Path
import argparse
import hashlib
import gzip
import json
import math
import sys
import bpy
from mathutils import Vector, Matrix

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output-root', default='.')
p.add_argument('--source')
p.add_argument('--render', action='store_true')
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
root = Path(a.output_root).resolve()
edit = root / 'authoring/solvane'
out = root / 'public/models/solvane'
edit.mkdir(parents=True, exist_ok=True)
out.mkdir(parents=True, exist_ok=True)
mats = {}
current = None


def material(name, color, rough, metal=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    n = m.node_tree.nodes.get('Principled BSDF')
    n.inputs['Base Color'].default_value = (*color, 1)
    n.inputs['Roughness'].default_value = rough
    n.inputs['Metallic'].default_value = metal
    m.use_backface_culling = True
    mats[name] = m


def mesh(name, verts, faces, mat, smooth=False, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mats[mat])
    data.update()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.parent = current
    for f in data.polygons:
        f.use_smooth = smooth
    if bevel:
        mod = ob.modifiers.new('Rounded sheet-metal seams', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
        norm = ob.modifiers.new('Weighted planar normals', 'WEIGHTED_NORMAL')
        norm.keep_sharp = True
    return ob


def box(name, loc, size, mat, bevel=0):
    x, y, z = (v/2 for v in size)
    verts = [(u*x, v*y, w*z) for u,v,w in
             [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),
              (1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    faces = [(0,4,6,2),(1,3,7,5),(0,1,5,4), (2,6,7,3),(0,2,3,1),(4,5,7,6)]
    ob = mesh(name, verts, [tuple(reversed(f)) for f in faces], mat, False, bevel)
    ob.location = loc
    return ob


def tube(name, points, radius, mat, sides=8):
    pts = [Vector(x) for x in points]
    verts, faces = [], []
    for j,pt in enumerate(pts):
        tangent = (pts[min(j+1,len(pts)-1)] - pts[max(0,j-1)]).normalized()
        axis = Vector((0,1,0)) if abs(tangent.y)<.9 else Vector((1,0,0))
        n = tangent.cross(axis).normalized()
        b = tangent.cross(n)
        verts += [tuple(pt + radius * (n*math.cos(i*math.tau/sides) + b*math.sin(i*math.tau/sides))) for i in range(sides)]
        if j:
            t = j*sides
            faces += [(t+i-sides, t+(i+1)%sides-sides, t+(i+1)%sides, t+i) for i in range(sides)]
    faces += [tuple(range(sides-1,-1,-1)), tuple(range((len(pts)-1)*sides, len(pts)*sides))]
    return mesh(name, verts, faces, mat, True)


def ring(name, x, y, z, radius, tube_r, mat, segments):
    return tube(name, [(x+radius*math.cos(t*math.tau/segments),y+radius*math.sin(t*math.tau/segments),z) for t in range(segments+1)], tube_r, mat, 6)


def template(name, refs):
    global current
    current = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(current)
    current['street_template'] = name
    current['reference_ids'] = refs
    return current


def service(lod):
    near = lod == 'near'
    template('service_'+lod, [14,30,38,53,80,81,82,83])
    box('Folded compressor shell', (0,0,.24), (.91,.61,.39), 'enamel', .014 if near else 0)
    box('Recess behind fan', (-.11,0,.442), (.55,.49,.012), 'recess')
    box('Service cover', (.325,0,.448), (.19,.53,.014), 'enamel', .008 if near else 0)
    # Fan is a real dished hub and three curved blades, not a printed circle.
    if near:
        for angle in [0, math.tau/3, math.tau*2/3]:
            verts = []
            for j in range(6):
                t=j/5
                r=.032+t*.166
                aa=angle+.48*t
                for side in [-1,1]:
                    ab=aa+side*(.12+.12*t)
                    verts.append((-.11+r*math.cos(ab),r*math.sin(ab),.457+.024*t*(1-t)))
            mesh('Swept fan blade', verts, [(2*j,2*j+2,2*j+3,2*j+1) for j in range(5)], 'metal', True)
        tube('Motor hub', [(-.11,0,.448),(-.11,0,.477)], .047, 'metal', 16)
    for r in ([.07,.12,.17,.219] if near else [.21]):
        ring('Safety grille ring', -.11,0,.484,r,.005 if near else .009,'metal',32 if near else 16)
    for j in range(8 if near else 4):
        angle=j*math.tau/(8 if near else 4)
        tube('Grille radial spoke', [(-.11,0,.488),(-.11+.217*math.cos(angle),.217*math.sin(angle),.488)], .0045 if near else .007,'metal',6)
    if near:
        for j in range(7):
            box('Cover ventilation louvre',(.326,-.16+j*.049,.46),(.128,.015,.013),'recess')
        for x in [-.398,.408]:
            for y in [-.248,.248]:
                tube('Captive screw', [(x,y,.444),(x,y,.457)], .011,'metal',8)
        tube('Insulated return line',[(.459,-.14,.23),(.58,-.14,.23),(.62,-.19,.21),(.62,-.48,.10),(.60,-.56,.07)],.019,'recess')
        tube('Rigid refrigerant line',[(.459,-.20,.29),(.55,-.20,.29),(.58,-.23,.28),(.58,-.54,.055)],.009,'metal')
    for x in [-.31,.31]:
        box('Wall mounting channel',(x,-.19,.026),(.058,.65,.052),'metal')
        box('Load-bearing support',(x,-.337,.246),(.061,.045,.49),'metal',.003 if near else 0)
        if near:
            tube('Triangular mounting brace',[(x,-.49,.047),(x,-.35,.415)],.015,'metal')


def awning(lod):
    near = lod == 'near'
    template('awning_'+lod,[14,30,34,38,53,80,81,82,83,86])
    nx, nz = (18,6) if near else (6,2)
    verts, faces = [], []
    for j in range(nz+1):
        t=j/nz
        for i in range(nx+1):
            u=i/nx
            y=-.04-.30*t-.046*math.sin(math.pi*t)
            if near: y-=.011*math.sin(u*math.pi*12)**2*math.sin(math.pi*t)
            verts.append(((u-.5)*3.4,y,.075+t*1.16))
    for j in range(nz):
        for i in range(nx):
            k=j*(nx+1)+i
            faces.append((k,k+nx+1,k+nx+2,k+1))
    canopy = mesh('Tensioned woven canopy',verts,faces,'canvas',True)
    solid = canopy.modifiers.new('Four millimetre canvas edge', 'SOLIDIFY')
    solid.thickness = .004
    solid.offset = 0
    # Valance is manufactured scalloped cloth with visible thickness at lips.
    vs=[]
    for i in range(nx+1):
        u=i/nx;bottom=-.52-(.038*math.sin(u*math.pi*12)**2 if near else 0)
        vs += [((u-.5)*3.4,-.341,1.235),((u-.5)*3.4,bottom,1.245)]
    valance = mesh('Hanging canvas valance',vs,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(nx)],'canvas',True)
    solid = valance.modifiers.new('Three millimetre canvas valance', 'SOLIDIFY')
    solid.thickness = .003
    solid.offset = 0
    for x in [-1.58,1.58]:
        box('Wall plate',(x,-.19,.028),(.10,.40,.046),'metal',.006 if near else 0)
        tube('Folding support arm',[(x,-.32,.055),(x,-.23,.61),(x,-.345,1.214)],.018,'metal')
        tube('Canopy side rail',[(x,-.036,.065),(x,-.344,1.218)],.013,'metal')
    tube('Front edge tube',[(-1.7,-.344,1.232),(1.7,-.344,1.232)],.025,'metal',12 if near else 6)
    box('Wall roller cassette',(0,.018,.062),(3.49,.125,.138),'enamel',.018 if near else 0)
    if near:
        for x in [-1.133,-.566,0,.566,1.133]:
            points=[(x,-.035-.30*j/6-.046*math.sin(math.pi*j/6),.075+j/6*1.16) for j in range(7)]
            tube('Stitched cloth panel seam',points,.0028,'canvas',5)


def pipe(lod):
    near = lod=='near'
    template('pipe_'+lod,[14,30,34,38,53,80,82,83])
    tube('Rainwater downpipe',[(0,3.12,.08),(0,2.98,.08),(0,2.85,.19),
                             (0,.22,.19),(0,.10,.23),(0,.055,.33)],.042,'metal',12 if near else 6)
    for y in [.37,1.54,2.75]:
        box('Stand-off clamp',(0,y,.105),(.11,.075,.18),'metal',.006 if near else 0)
        if near:
            for x in [-.068,.068]:
                tube('Clamp fastener',[(x,y,.052),(x,y,.12)],.009,'enamel',6)
    if near:
        for y in [.34,1.65,2.79]:
            # A short enlarged sleeve; geometry, not a floating ring decal.
            tube('Slip joint collar',[(0,y-.04,.19),(0,y+.04,.19)],.047,'metal',12)


def finish_meshes():
    for ob in list(bpy.data.objects):
        if ob.type!='MESH':continue
        bpy.context.view_layer.objects.active=ob
        for modifier in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    for r in [o for o in bpy.data.objects if o.get('street_template')]:
        groups={}
        for ob in list(r.children): groups.setdefault(ob.data.materials[0].name,[]).append(ob)
        for name,obs in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for ob in obs: ob.select_set(True)
            bpy.context.view_layer.objects.active=obs[0]
            bpy.ops.object.join()
            ob=bpy.context.object
            ob.data.transform(ob.matrix_local)
            ob.matrix_local.identity()
            ob.data.transform(Matrix.Rotation(math.pi/2,4,'X'))
            ob.data.update()
            ob.name=f'{r.name}__{name}'
            ob.data.name=ob.name
            ob['material_role']=name
        r['units']='metres'
        r['native_up']='Z'
        r['runtime_up']='Y'


def export():
    roots=sorted([o for o in bpy.data.objects if o.get('street_template')],key=lambda x:x.name)
    expected={f'{kind}_{lod}' for kind in ['service','awning','pipe'] for lod in ['near','far']}
    if {r.name for r in roots}!=expected: raise RuntimeError('Street template interface mismatch')
    bpy.ops.object.select_all(action='DESELECT')
    for r in roots:
        r.select_set(True)
        for ob in r.children_recursive: ob.select_set(True)
    glb=out/'street-kit.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,
                             export_yup=True,export_apply=False,export_extras=True,
                             export_texcoords=False,export_normals=True,export_materials='EXPORT',
                             export_animations=False,export_cameras=False,export_lights=False)
    data = glb.read_bytes()
    transport = gzip.compress(data, compresslevel=9, mtime=0)
    (out/'street-kit.bin').write_bytes(transport)
    report = {'schema': 1, 'source': 'authoring/solvane/street-kit.blend',
              'authoring': 'Blender '+bpy.app.version_string, 'units': 'metres',
              'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
              'gzip': {'bytes': len(transport), 'sha256': hashlib.sha256(transport).hexdigest()},
              'templates': {}}
    for r in roots:
        vertices, triangles, draws = [], 0, 0
        for ob in r.children_recursive:
            if ob.type != 'MESH': continue
            ob.data.calc_loop_triangles()
            triangles += len(ob.data.loop_triangles)
            draws += len(ob.data.materials)
            # Saved native geometry is Z-up; glTF converts it to Y-up.
            vertices.extend([(v.co.x, v.co.z, -v.co.y) for v in ob.data.vertices])
        report['templates'][r.name] = {
            'triangles': triangles, 'draws': draws, 'referenceIds': list(r['reference_ids']),
            'bounds': {'min': [round(min(v[i] for v in vertices), 6) for i in range(3)],
                       'max': [round(max(v[i] for v in vertices), 6) for i in range(3)]}}
    (out/'street-kit.manifest.json').write_text(json.dumps(report, indent=2)+'\n')
    print('STREET_KIT_EXPORT', json.dumps(report))


def inspection_renders():
    # These are native component inspections, never presented as game captures.
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = 960, 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    if scene.world is None: scene.world = bpy.data.worlds.new('Inspection world')
    scene.world.color = (.35, .35, .35)
    scene.view_settings.view_transform = 'AgX'
    previews = root/'evidence/native-street'
    previews.mkdir(parents=True, exist_ok=True)
    cam_data = bpy.data.cameras.new('Inspection camera')
    cam = bpy.data.objects.new('Inspection camera', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.type = 'ORTHO'
    for name, loc, power, size in [('Key', (3,-4,5), 750, 4), ('Fill', (-4,-2,2), 430, 4), ('Rim', (0,2,5), 650, 3)]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.shape, light.size = power, 'DISK', size
        ob = bpy.data.objects.new(name, light)
        scene.collection.objects.link(ob)
        ob.location = loc
        ob.rotation_euler = (Vector((0,0,1))-ob.location).to_track_quat('-Z','Y').to_euler()
    for kind in ['awning','service','pipe']:
        for ob in bpy.data.objects:
            if ob.type == 'MESH': ob.hide_render = not ob.name.startswith(kind+'_near__')
        objects = [ob for ob in bpy.data.objects if ob.type == 'MESH' and not ob.hide_render]
        points = [ob.matrix_world @ Vector(p) for ob in objects for p in ob.bound_box]
        lo = Vector([min(v[i] for v in points) for i in range(3)])
        hi = Vector([max(v[i] for v in points) for i in range(3)])
        centre = (lo+hi)/2
        cam.location = centre + Vector((2.9,-5.5,2.5))
        cam.rotation_euler = (centre-cam.location).to_track_quat('-Z','Y').to_euler()
        cam_data.ortho_scale = max(hi-lo)*1.3
        scene.render.filepath = str(previews/(kind+'.png'))
        bpy.ops.render.render(write_still=True)


if a.source:
    source = Path(a.source).resolve()
    if not source.is_file(): raise FileNotFoundError(source)
    bpy.ops.wm.open_mainfile(filepath=str(source))
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0
    material('enamel', (.63,.64,.57), .39, .1)
    material('recess', (.014,.018,.021), .76, .05)
    material('metal', (.15,.17,.18), .43, .7)
    material('canvas', (.115,.28,.275), .86, 0)
    for kind in [awning, service, pipe]:
        for lod in ['near','far']: kind(lod)
    finish_meshes()
    bpy.context.scene['authoring_description'] = 'Original Solvane street service library; no external assets'
    bpy.ops.wm.save_as_mainfile(filepath=str(edit/'street-kit.blend'), compress=True)
export()
if a.render: inspection_renders()
