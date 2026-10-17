"""Original Solvane Coast detail kit. Blender 5.2.2, metres, no external assets.

blender -b -t 4 --factory-startup --python-exit-code 1 \
  --python authoring/solvane/build_detail_kit.py -- --output-root .

The editable .blend is authoritative; --source reopens it and exports again.
Names, seams, bevels, separated airfoil/flap pivots and two geometry LODs are
retained. References inform construction, not logos or copied vehicle shapes.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys

import bpy
from mathutils import Vector

P = argparse.ArgumentParser()
P.add_argument('--output-root', default='.')
P.add_argument('--source')
P.add_argument('--render', action='store_true')
A = P.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
ROOT = Path(A.output_root).resolve()
OUT = ROOT / 'public/models/solvane'
EDIT = ROOT / 'authoring/solvane'
OUT.mkdir(parents=True, exist_ok=True)
EDIT.mkdir(parents=True, exist_ok=True)
TAU = math.tau
CURRENT = None
MATERIALS = {}


def mat(name, color, roughness, metal=0, coat=0, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metal
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = .14
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    m.use_backface_culling = True
    MATERIALS[name] = m
    return m


def mesh(name, vertices, faces, material, smooth=False, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.materials.append(MATERIALS[material])
    data.update()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.parent = CURRENT
    if smooth:
        for p in data.polygons:
            p.use_smooth = True
    if bevel:
        mod = ob.modifiers.new('Manufactured edge radius', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        mod.affect = 'EDGES'
        mod.limit_method = 'ANGLE'
        weighted = ob.modifiers.new('Weighted planar highlights', 'WEIGHTED_NORMAL')
        weighted.keep_sharp = True
        for p in data.polygons:
            p.use_smooth = True
    return ob


def box(name, loc, dims, material, bevel=.006):
    x, y, z = (v * .5 for v in dims)
    vertices = [(a*x, b*y, c*z) for a,b,c in
                [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),
                 (1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    faces = [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]
    ob = mesh(name, vertices, faces, material, bevel=bevel)
    ob.location = loc
    return ob


def rod(name, a, b, radius, material, sides=10, radius_end=None):
    # Authoring axes are deliberately Y-up; glTF export converts Blender Z-up
    # through a single root transform (see export), not ad-hoc per-part swaps.
    a, b = Vector(a), Vector(b)
    t = (b-a).normalized()
    n = t.cross(Vector((0,1,0)) if abs(t.y) < .9 else Vector((1,0,0))).normalized()
    v = t.cross(n)
    r2 = radius if radius_end is None else radius_end
    vertices = [tuple(p + (n*math.cos(i*TAU/sides)+v*math.sin(i*TAU/sides))*r)
                for p,r in [(a,radius),(b,r2)] for i in range(sides)]
    faces = [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
    faces += [tuple(range(sides-1,-1,-1)), tuple(range(sides,sides*2))]
    return mesh(name, vertices, faces, material, smooth=True)


def tube(name, points, r, material, sides=8):
    # Continuous tube, parallel-transported tangent frame, no sphere bead chain.
    points = [Vector(p) for p in points]
    vertices, faces = [], []
    for j,p in enumerate(points):
        tangent = (points[min(j+1,len(points)-1)]-points[max(j-1,0)]).normalized()
        ref = Vector((0,1,0)) if abs(tangent.y) < .95 else Vector((1,0,0))
        n = tangent.cross(ref).normalized()
        b = tangent.cross(n)
        vertices += [tuple(p+(n*math.cos(i*TAU/sides)+b*math.sin(i*TAU/sides))*r)
                     for i in range(sides)]
        if j:
            a = j*sides
            faces += [(a+i-sides,a+(i+1)%sides-sides,a+(i+1)%sides,a+i)
                      for i in range(sides)]
    faces += [tuple(range(sides-1,-1,-1)),
              tuple(range((len(points)-1)*sides,len(points)*sides))]
    return mesh(name, vertices, faces, material, smooth=True)


def ring(name, center, radius, tube_r, material, segments=32, sides=8, plane='xy'):
    cx,cy,cz = center
    pts=[]
    for i in range(segments+1):
        a=i*TAU/segments
        pts.append((cx+radius*math.cos(a),cy+radius*math.sin(a),cz) if plane=='xy'
                   else (cx+radius*math.cos(a),cy,cz+radius*math.sin(a)))
    return tube(name,pts,tube_r,material,sides)


def leaf(name, loc, radius, material, sides=16):
    x,y,z=loc
    vertices=[(x,y+radius,z),(x,y-radius,z)]
    for j in range(1,8):
        a=math.pi*j/8
        for i in range(sides):
            b=TAU*i/sides
            vertices.append((x+radius*math.sin(a)*math.cos(b),y+radius*math.cos(a),z+radius*math.sin(a)*math.sin(b)))
    faces=[]
    for i in range(sides):
        faces.append((0,2+i,2+(i+1)%sides))
        faces.append((1,2+6*sides+(i+1)%sides,2+6*sides+i))
    for j in range(6):
        for i in range(sides):
            a=2+j*sides+i;b=2+j*sides+(i+1)%sides
            faces.append((a,a+sides,b+sides,b))
    return mesh(name,vertices,faces,material,smooth=True)


def template(name, refs):
    global CURRENT
    CURRENT=bpy.data.objects.new(name,None)
    bpy.context.collection.objects.link(CURRENT)
    CURRENT['reference_ids']=refs
    CURRENT['units']='metres'
    CURRENT['asset_name']=name
    return CURRENT


def bay(lod):
    template(f'frontage_{lod}', [12,26,30,38,39,56,59,80,81,82,83,89,91,96,97])
    fine=lod=='near'
    # Each bay matches the town's 3.3 m grid and remains within 0.26 m of the
    # collision-backed wall. No low obstacles are inserted in a driveable lane.
    box('Recess backing',(0,1.32,.022),(3.10,2.53,.032),'interior',0)
    box('Granite plinth',(0,.105,.13),(3.25,.21,.25),'stone',.013 if fine else 0)
    for side in [-1,1]:
        x=side*1.51
        box('Masonry jamb',(x,1.4,.08),(.19,2.38,.16),'stone',.012 if fine else 0)
        box('Jamb plinth',(x,.27,.16),(.27,.19,.30),'stone',.015 if fine else 0)
        box('Jamb capital',(x,2.46,.13),(.29,.13,.25),'stone',.008 if fine else 0)
        if fine:
            for dx in [-.041,0,.041]:
                rod('Fluted pilaster',(x+dx,.39,.176),(x+dx,2.29,.176),.013,'stone',8)
    # One central entrance, two display windows, and recessed solid joinery.
    for x,w in [(-.93,.88),(0,.88),(.93,.88)]:
        box('Oiled joinery',(x,1.2,.063),(w,1.91,.08),'timber',.008 if fine else 0)
        box('Shadowed interior',(x,1.52,.11),(w-.09,1.22,.025),'interior',0)
        # Real geometry behind the front glass produces parallax without
        # pretending the opaque city shell is a traversable interior.
        for h in ([.86,1.22,1.63] if fine else [1.2]):
            box('Display shelf',(x,h,.12),(w-.16,.035,.10),'timber',.003 if fine else 0)
        if fine:
            for i in range(4):
                box('Display object',(x-.23+i*.15,1.06+(i%2)*.07,.126),(.09,.2+(i%2)*.14,.048),'linen' if i%2 else 'teal',.012)
        # Opaque coated glass avoids fragile transparent sorting on 100s of
        # instances. Its changing reflection and narrow mullions give depth.
        for a in [-1,1]:
            box('Optical pane',(x+a*(w-.10)/4,1.71,.174),((w-.11)/2-.016,.57,.022),'glass',.003 if fine else 0)
            box('Lower pane',(x+a*(w-.10)/4,1.11,.174),((w-.11)/2-.016,.53,.022),'glass',.002 if fine else 0)
        for dx in [-w/2,0,w/2]:
            box('Bronze upright',(x+dx,1.43,.201),(.028,1.46,.036),'metal',.004 if fine else 0)
        for h in [.70,1.40,2.16]:
            box('Bronze crossrail',(x,h,.205),(w+.035,.035,.040),'metal',.004 if fine else 0)
        # Recessed fielded wood panel, not a flat coloured rectangle.
        box('Door raised field',(x,.44,.132),(w-.15,.34,.042),'timber',.014 if fine else 0)
        if fine:
            rod('Door pull',(x+.29,.97,.25),(x+.29,1.23,.25),.012,'metal',12)
            for yy in [.98,1.22]:
                rod('Pull standoff',(x+.29,yy,.2),(x+.29,yy,.25),.011,'metal',8)
        box('Transom glass',(x,2.34,.14),(w-.025,.22,.035),'glass',0)
    for h,w,d in [(2.53,3.22,.22),(2.60,3.3,.27),(2.67,3.26,.23)]:
        box('Moulded lintel',(0,h,d/2),(w,.075,d),'stone',.011 if fine else 0)
    # Scalloped roll edge under the existing sign. A cloth silhouette has
    # depth at close range while staying in the established facade setback.
    if fine:
        for i in range(14):
            x=-1.46+i*.225
            pts=[(x-.10,2.73,.11),(x-.075,2.68,.24),(x,2.655,.255),(x+.075,2.68,.24),(x+.10,2.73,.11)]
            tube('Canvas scallop seam',pts,.009,'linen',6)
        for side in [-1,1]:
            tube('Scrolled lamp bracket',[(side*1.39,2.87,.10),(side*1.39,2.91,.2),(side*1.39,2.84,.29)],.013,'metal',8)
            box('Warm shop lamp',(side*1.39,2.8,.24),(.075,.14,.07),'lamp',.01)


def balcony(lod):
    template(f'balcony_{lod}', [11,12,26,27,30,38,39,56,80,83,89,91,96,97])
    fine=lod=='near'
    box('Projecting stone sill',(0,.035,.19),(1.95,.12,.40),'stone',.015 if fine else 0)
    for x in [-.72,.72]:
        box('Corbel',(x,-.08,.11),(.13,.14,.2),'stone',.014 if fine else 0)
    for y,r in [(.13,.018),(.83,.028),(.92,.032)]:
        rod('Forged horizontal rail',(-.91,y,.40),(.91,y,.40),r,'metal',10 if fine else 6)
    for x in [-.91,.91]:
        rod('Wall return rail',(x,.92,0),(x,.92,.40),.026,'metal',10 if fine else 6)
    for i in range(10 if fine else 7):
        x=-.88+1.76*i/(9 if fine else 6)
        rod('Iron baluster',(x,.10,.4),(x,.92,.4),.012,'metal',8 if fine else 5)
        if fine:
            for sign in [-1,1]:
                pts=[]
                for j in range(16):
                    a=j/15*math.pi*1.6
                    r=.071*(1-j/19)
                    pts.append((x+sign*(.01+r*math.sin(a)),.47+.11*sign+r*math.cos(a),.401))
                tube('Handworked scroll',pts,.008,'metal',6)
    if fine:
        for x in [-.91,.91]:
            # Seat each finial on a pin crossing the top/return rail junction;
            # a decorative sphere alone leaves a visible manufacturing gap.
            rod('Finial mounting pin',(x,.90,.40),(x,1.0,.40),.018,'metal',8)
            leaf('Finial',(x,1.0,.4),.035,'metal',12)


def launch(lod):
    template(f'launch_{lod}',[12,28,39,87])
    fine=lod=='near'
    # Eight chine stations, flared topsides, a swept stem and a closed transom.
    stations=[(-4.4,1.11,1.05),(-3.4,1.47,1.08),(-2.0,1.59,1.12),(-.4,1.62,1.16),(1.3,1.48,1.24),(2.8,1.07,1.40),(3.8,.50,1.64),(4.55,.035,1.83)]
    cross=[(-1,1),(-.97,.60),(-.82,.10),(-.49,-.63),(0,-.92),(.49,-.63),(.82,.10),(.97,.60),(1,1)]
    verts=[]
    for z,w,sheer in stations:
        for x,h in cross:
            verts.append((x*w,h*sheer if h>0 else h,z))
    faces=[]
    for s in range(1,len(stations)):
        for k in range(len(cross)-1):
            i=s*len(cross)+k
            faces.append((i-len(cross),i-len(cross)+1,i+1,i))
    faces += [tuple(range(8,-1,-1)),tuple(range((len(stations)-1)*9,len(stations)*9))]
    hull=mesh('Chine-defined planked hull',verts,faces,'cream',smooth=True)
    # Separate 3D rubbing strakes, brass stanchions and sheer-following rail.
    for side in [-1,1]:
        for dy,r,m in [(0,.057,'timber'),(-.30,.045,'teal'),(-.64,.022,'metal')]:
            tube('Sheer rubbing strake',[(side*w,y+dy,z) for z,w,y in stations],r,m,10 if fine else 6)
        tube('Safety rail',[(side*w*.94,y+.68,z) for z,w,y in stations[:-1]]+[(0,2.29,4.42)],.022,'metal',10 if fine else 6)
        for z,w,y in stations[:-1]:
            rod('Deck stanchion',(side*w*.94,y,z),(side*w*.94,y+.68,z),.021,'metal',8)
    # Closed cambered deck with longitudinal planks and realistic working clutter.
    deck=[]
    for z,w,y in stations:
        deck += [(-w*.94,y-.065,z),(0,y+.02,z),(w*.94,y-.065,z)]
    faces=[]
    for s in range(1,len(stations)):
        for k in range(2):
            i=s*3+k; faces.append((i-3,i,i+1,i-2))
    mesh('Cambered timber deck',deck,faces,'timber')
    if fine:
        for x in [-1.2,-.9,-.6,-.3,0,.3,.6,.9,1.2]:
            pts=[(x,y+.027,z) for z,w,y in stations if w>abs(x)+.12]
            if len(pts)>1: tube('Deck plank caulk',pts,.007,'rubber',4)
    # Sloped wheelhouse rather than a box cabin: aperture frame loops give
    # convincing thickness, glass is dark but not mirror-chrome.
    levels=[(.98,1.14,-.3,1.76),(1.80,1.12,-.34,1.53),(2.65,.98,-.26,1.28),(2.91,1.05,-.33,1.42)]
    vs=[]
    for h,w,zr,zf in levels:vs += [(-w,h,zr),(w,h,zr),(w,h,zf),(-w,h,zf)]
    fs=[]
    for j in range(1,len(levels)):
        for i in range(4):fs.append(((j-1)*4+i,(j-1)*4+(i+1)%4,j*4+(i+1)%4,j*4+i))
    fs.append((12,13,14,15))
    mesh('Sloped wheelhouse',vs,fs,'cream',bevel=.025 if fine else 0)
    for side in [-1,1]:
        for z in [.02,.57,1.08]:
            glass=box('Wheelhouse side glazing',(side*1.079,2.21,z),(.023,.64,.40),'glass',.017 if fine else 0)
            glass.rotation_euler.z=side*.15
        box('Cabin lower trim',(side*1.141,1.30,.50),(.035,.22,1.80),'teal',.012 if fine else 0)
    for x in [-.67,0,.67]:
        g=box('Pilot windscreen',(x,2.20,1.438),(.60,.67,.035),'glass',.015 if fine else 0)
        g.rotation_euler.x=-.285
        if fine:rod('Windscreen wiper',(x-.12,1.95,1.55),(x+.13,2.36,1.435),.012,'rubber',6)
    box('Wheelhouse roof cap',(0,2.94,.54),(2.28,.13,2.02),'teal',.05 if fine else .01)
    # Mast, fishing boom, rigging and the working character of the harbour.
    rod('Mast',(0,2.98,.60),(0,5.24,.60),.055,'metal',12 if fine else 6,.025)
    rod('Boom',(-1.95,4.10,.60),(1.95,4.10,.60),.029,'metal',10 if fine else 6)
    for side in [-1,1]:
        tube('Mast stay',[(side*1.3,1.22,-2.7),(0,4.95,.60),(side*1.1,1.38,2.8)],.009,'rope',6 if fine else 4)
        if fine:
            for i in range(4):
                z=-3.2+i*.66
                f=leaf('Hanging rubber fender',(side*1.52,.85,z),.22,'rubber',16)
                f.scale=(.8,1.6,.8)
                rod('Fender rope',(side*1.46,1.84,z),(side*1.52,1.1,z),.011,'rope',6)
    if fine:
        ring('Life ring',(1.112,2.1,-.32),.31,.055,'orange',40,8)
        for i in range(4):
            a=i*math.pi/2
            ob=box('Life ring reflective bands',(1.112+.30*math.cos(a),2.1+.30*math.sin(a),-.331),(.095,.12,.035),'linen',.006)
            ob.rotation_euler.z=a
        # Open-slat fish crates and a rope coil, no branded labels.
        for q,(x,z) in enumerate([(-.62,-2.8),(.60,-2.45),(-.55,-1.94)]):
            for yy in [1.22,1.42,1.62]:
                for side in [-1,1]:
                    box('Fish crate slat',(x,yy,z+side*.27),(.69,.09,.035),'teal',.006)
                    box('Fish crate end',(x+side*.35,yy,z),(.036,.09,.56),'teal',.006)
            for a in [-1,1]:
                for b in [-1,1]:box('Crate upright',(x+a*.32,1.44,z+b*.25),(.065,.56,.06),'teal',.005)
        for i in range(5):ring('Coiled rope',(.72,1.22+i*.021,-3.33),.27+i*.013,.013,'rope',32,6,'xz')
        for x in [-.72,.72]:
            rod('Stern cleat stem',(x,1.14,-3.96),(x,1.29,-3.96),.045,'metal',12)
            rod('Stern cleat horns',(x-.17,1.29,-3.96),(x+.17,1.29,-3.96),.037,'metal',12)
    # Navigation lamps are separated into an emissive material, not point
    # lights, so three boats do not add six unbounded scene lights.
    for side,material in [(-1,'redlamp'),(1,'greenlamp')]:
        box('Navigation light',(side*1.10,3.06,.55),(.12,.14,.16),material,.018 if fine else 0)


def flag(lod):
    template(f'gate_{lod}',[25,34,40,41,42,46,47,48,49,76,77,78,79])
    fine=lod=='near'
    box('Weighted base',(0,.065,0),(.53,.13,.53),'rubber',.035 if fine else 0)
    rod('Telescoping mast',(0,.1,0),(0,4.95,0),.031,'metal',12 if fine else 6,.018)
    for y in [.14,1.76,3.28]:ring('Mast sleeve',(0,y,0),.031,.009,'metal',16,6,'xz')
    # A tensioned feather-flag with a rounded tapered head and sewn hem.
    rows=28 if fine else 10
    columns=6 if fine else 2
    v=[];fs=[]
    for j in range(rows+1):
        t=j/rows
        width=.60*(1-.78*max(0,(t-.72)/.28)**2)
        for i in range(columns+1):
            u=i/columns
            v.append((.034+u*width,1.07+t*3.70,math.sin(t*7.1+u*2)*.038*u))
            if j and i:
                a=j*(columns+1)+i;fs.append((a-columns-2,a-columns-1,a,a-1))
    ob=mesh('Sewn feather cloth',v,fs,'fabric',smooth=True)
    solid=ob.modifiers.new('Cloth thickness','SOLIDIFY');solid.thickness=.0012
    if fine:
        edge=[v[j*(columns+1)+columns] for j in range(rows+1)]
        tube('Stitched outer hem',edge,.007,'linen',5)
    # Three raised non-branded directional chevrons and high-contrast headband.
    for j in range(3):
        y=2.1+j*.44
        vertices=[(.12,y+.14,.056),(.36,y-.02,.06),(.52,y+.15,.056),(.52,y+.04,.056),(.36,y-.14,.06),(.12,y+.02,.056)]
        mesh('Directional chevron',vertices,[(0,1,2,3,4,5)],'linen')


def foil(name, span, chord, thickness, sweep, material, flap=False, far=False):
    # Cambered NACA-like section with finite trailing edge, swept tips and
    # support-friendly central span. Circumferential topology, not a cube.
    ns,nc=(8,8) if far else (32,20)
    verts=[];faces=[]
    for i in range(ns+1):
        s=-1+2*i/ns
        local=chord*(1-.19*abs(s)**3)
        for k in range(nc*2):
            upper=k<nc
            j=k if upper else nc*2-k-1
            u=.5-.5*math.cos(math.pi*j/(nc-1))
            th=5*thickness*(.2969*math.sqrt(max(0,u))-.1260*u-.3516*u*u+.2843*u**3-.1015*u**4)
            camber=.035*local*math.sin(math.pi*u)
            y=camber+local*(th if upper else -th)+.022*abs(s)**3
            z=(u-.34)*local+sweep*abs(s)**2
            verts.append((s*span/2,y,z))
        if i:
            a=i*nc*2
            for k in range(nc*2):
                faces.append((a-nc*2+k,a+k,a+(k+1)%(nc*2),a-nc*2+(k+1)%(nc*2)))
    faces.append(tuple(range(nc*2-1,-1,-1)))
    faces.append(tuple(range(ns*nc*2,(ns+1)*nc*2)))
    return mesh(name,verts,faces,material,smooth=True)


def aero():
    template('aero_main',[1,2,5,7,13,15,18,23,24,35,57,58,74,94,99])
    foil('Swept pressure-recovery airfoil',1.81,.285,.15,.042,'carbon')
    for side in [-1,1]:
        # Shaped endplates, sloping back rather than rectangular billboards.
        x=side*.905
        verts=[(x-.004,-.012,-.10),(x-.004,.094,-.068),(x-.004,.122,.17),(x-.004,.025,.235),
               (x+.004,-.012,-.10),(x+.004,.094,-.068),(x+.004,.122,.17),(x+.004,.025,.235)]
        mesh('Swept endplate',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'carbon',bevel=.004)
    template('aero_flap',[5,13,15,18,24,35,57,58,74,94,99,100])
    foil('Articulated trailing flap',1.68,.13,.10,.028,'carbon',True)
    template('aero_support',[2,4,5,7,10,13,15,24,35,74,94,99])
    for side in [-1,1]:
        x=side*.60
        vertices=[(x-.025,-.15,-.048),(x-.025,-.11,.052),(x-.025,.012,.10),(x-.025,.022,.018),
                  (x+.025,-.15,-.048),(x+.025,-.11,.052),(x+.025,.012,.10),(x+.025,.022,.018)]
        mesh('Swan-neck support',vertices,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'metal',bevel=.006)
        for z in [-.017,.03]:
            rod('Visible fixing',(x,-.148,z),(x,-.156,z),.013,'metal',12)
    template('aero_flap_far',[15,18,24,74,99])
    foil('Far integrated airfoil',1.80,.35,.12,.03,'carbon',far=True)


def bake_modifiers_and_uvs():
    # UVs are analytic planar projections; per-object generated maps never
    # depend on a random packing layout or require external font/texture files.
    for ob in list(bpy.data.objects):
        if ob.type!='MESH':continue
        bpy.context.view_layer.objects.active=ob
        for mod in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        data=ob.data
        uv=data.uv_layers.new(name='Surface metres') if not data.uv_layers else data.uv_layers.active
        for poly in data.polygons:
            n=poly.normal
            axis=max(range(3),key=lambda k:abs(n[k]))
            axes=([1,2] if axis==0 else [0,2] if axis==1 else [0,1])
            for li in poly.loop_indices:
                p=data.vertices[data.loops[li].vertex_index].co
                uv.data[li].uv=(p[axes[0]],p[axes[1]])


def consolidate():
    # One mesh per material per template; scene details stay in editable
    # mesh islands. This caps draw calls independently of the part count.
    roots=[o for o in bpy.context.scene.objects if o.type=='EMPTY' and o.parent is None]
    for root in roots:
        by={}
        for ob in list(root.children):
            if ob.type=='MESH':by.setdefault(ob.data.materials[0].name,[]).append(ob)
        for material,obs in by.items():
            bpy.ops.object.select_all(action='DESELECT')
            for ob in obs:ob.select_set(True)
            bpy.context.view_layer.objects.active=obs[0]
            bpy.ops.object.join()
            ob=bpy.context.object
            ob.name=f'{root.name}__{material}'
            ob['asset_role']=root.name
            ob['material_role']=material
            ob.data.name=ob.name
            # Correct the author's convenient Y-up meshes into Blender's Z-up
            # native file. glTF reverses this once, preserving the game axes.
            from mathutils import Matrix
            ob.data.transform(ob.matrix_local)
            ob.matrix_local.identity()
            ob.data.transform(Matrix.Rotation(math.pi/2,4,'X'))
            ob.data.update()
        root['authoring_up']='Z'
        root['runtime_up']='Y'


def export_assets():
    bpy.ops.object.select_all(action='DESELECT')
    roots=[o for o in bpy.context.scene.objects if o.type=='EMPTY' and o.parent is None and o.get('asset_name')]
    for root in roots:
        root.select_set(True)
        for ob in root.children_recursive:ob.select_set(True)
    target=OUT/'detail-kit.glb'
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,
                            export_yup=True,export_apply=False,export_extras=True,
                            export_texcoords=True,export_normals=True,export_materials='EXPORT',
                            export_animations=False,export_cameras=False,export_lights=False,
                            export_keep_originals=False)
    report={'schema':1,'tool':bpy.app.version_string,'units':'metres','runtimeAxes':'+Y up, +Z forward',
            'source':'authoring/solvane/detail-kit.blend','file':'public/models/solvane/detail-kit.glb',
            'license':'Original project-authored geometry; no screenshot, logo, licensed car or third-party font is embedded.',
            'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'templates':{}}
    for root in sorted(roots,key=lambda r:r.name):
        tris=0;bounds=[]
        for ob in root.children_recursive:
            if ob.type!='MESH':continue
            ob.data.calc_loop_triangles();tris+=len(ob.data.loop_triangles)
            for v in ob.data.vertices:
                w=ob.matrix_world@v.co
                bounds.append((w.x,w.z,-w.y))
        report['templates'][root.name]={'triangles':tris,'draws':len(root.children),
            'references':list(root['reference_ids']),
            'bounds':[[round(min(p[k] for p in bounds),5) for k in range(3)],
                      [round(max(p[k] for p in bounds),5) for k in range(3)]]}
    (OUT/'detail-kit.manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print('SOLVANE_ASSET_REPORT',json.dumps(report,separators=(',',':')))


def preview():
    # Render a native Blender view for asset inspection. These are NOT game
    # screenshots; production WebGL screenshots are validated separately.
    original=[o for o in bpy.context.scene.objects if o.get('asset_name')]
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=32
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1200;scene.render.resolution_y=850;scene.render.resolution_percentage=100
    scene.world.color=(.20,.20,.20)
    world=scene.world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.19,.24,.30,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.5
    scene.view_settings.view_transform='AgX'
    def light(name,loc,power,size):
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
        ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=loc
        ob.rotation_euler=(Vector((0,0,1))-ob.location).to_track_quat('-Z','Y').to_euler()
    light('Soft key',(4,-5,9),1700,7);light('Rim',(-5,3,7),2200,5);light('Fill',(5,5,3),700,6)
    data=bpy.data.cameras.new('Look development');cam=bpy.data.objects.new('Look development',data);scene.collection.objects.link(cam);scene.camera=cam;data.lens=52
    renders=ROOT/'docs/production/solvane-blender-evidence';renders.mkdir(parents=True,exist_ok=True)
    for name,pos,target in [('frontage_near',(4,-7,3.3),(0,-.10,1.4)),('launch_near',(10,-12,8),(0,0,1.5)),('aero_main',(2.3,-2.4,1.4),(0,0,0)),('balcony_near',(2.7,-3.8,2.1),(0,-.15,.5)),('gate_near',(5,-9,5.2),(0,0,2.5))]:
        for r in original:
            show=r.name==name or (name=='aero_main' and r.name in ['aero_flap','aero_support'])
            for ob in r.children_recursive:ob.hide_render=not show
            if name=='aero_main' and r.name=='aero_flap':r.location.y=-.20
        cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(renders/f'blender-{name}.png')
        bpy.ops.render.render(write_still=True)
    for r in original:
        r.location=(0,0,0)
        for ob in r.children_recursive:ob.hide_render=False


if A.source:
    bpy.ops.wm.open_mainfile(filepath=str(Path(A.source).resolve()))
else:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    mat('stone',(.46,.405,.325),.78)
    mat('metal',(.18,.215,.20),.35,.72)
    mat('timber',(.145,.073,.036),.63)
    mat('interior',(.014,.025,.025),.86)
    mat('glass',(.055,.112,.12),.12,.36,.32)
    mat('teal',(.036,.165,.156),.37,.1,.35)
    mat('linen',(.82,.73,.54),.86)
    mat('cream',(.74,.66,.48),.38,.07,.35)
    mat('rubber',(.023,.028,.027),.87)
    mat('rope',(.36,.26,.145),.9)
    mat('orange',(.74,.15,.025),.57)
    mat('fabric',(.025,.31,.245),.98)
    mat('carbon',(.017,.023,.029),.31,.1,.5)
    mat('lamp',(1,.67,.31),.32,emission=1.0)
    mat('redlamp',(.9,.008,.002),.29,emission=1.3)
    mat('greenlamp',(.008,.62,.21),.29,emission=1.3)
    for lod in ['near','far']:bay(lod);balcony(lod);launch(lod);flag(lod)
    aero();bake_modifiers_and_uvs();consolidate()
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.context.scene['description']='Solvane Coast / original Blender production detail kit. No font or screenshot assets.'
    bpy.ops.wm.save_as_mainfile(filepath=str(EDIT/'detail-kit.blend'),compress=True)
export_assets()
if A.render:preview()
