"""Export saved Blender meshes into deterministic, indexed runtime batches.

No geometry is constructed here. The generator and saved-.blend re-export use
this same conversion, with metre/+Y-up/+Z-forward coordinates. Non-GP legacy
cowls retain their earlier export convention explicitly.
"""
import bpy
from deterministic_normals import NORMAL_ALGORITHM, quantized_area_normals


def select(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def export_geometry(objs,ratio=1,stable_normals=True):
    buckets={};duplicates=[]
    for src in objs:
        o=src
        if ratio<1:
            o=src.copy();o.data=src.data.copy();bpy.context.collection.objects.link(o);duplicates.append(o)
            if len(o.data.polygons)>80:
                select(o);dec=o.modifiers.new('Distance LOD','DECIMATE');dec.ratio=ratio;dec.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=dec.name)
        d=o.data;d.calc_loop_triangles();uv=d.uv_layers.active
        normalmatrix=o.matrix_world.to_3x3().inverted().transposed()
        points=[]
        for vertex in d.vertices:
            co=o.matrix_world@vertex.co
            points.append(tuple(round(float(v),6) for v in (co.x,co.z,-co.y)))
        normals=quantized_area_normals(points,[tuple(t.vertices) for t in d.loop_triangles]) if stable_normals else None
        for tri in d.loop_triangles:
            name=d.materials[tri.material_index].name if d.materials else 'paint'
            b=buckets.setdefault(name,{'position':[],'normal':[],'uv':[],'index':[],'lookup':{}})
            for li in tri.loops:
                loop=d.loops[li];point=o.matrix_world@d.vertices[loop.vertex_index].co
                norm=(normalmatrix@d.corner_normals[li].vector).normalized()
                u=uv.data[li].uv if uv else (point.x,point.y)
                pt=points[loop.vertex_index];nn=normals[loop.vertex_index] if normals is not None else (norm.x,norm.z,-norm.y)
                key=tuple(round(float(v),6) for v in (*pt,*nn,float(u[0]),float(u[1])))
                if key not in b['lookup']:
                    b['lookup'][key]=len(b['position'])//3;b['position']+=list(key[:3]);b['normal']+=list(key[3:6]);b['uv']+=list(key[6:])
                b['index'].append(b['lookup'][key])
    for o in duplicates:bpy.data.objects.remove(o,do_unlink=True)
    result=[]
    for name,b in buckets.items():
        del b['lookup'];result.append({'material':name,**b})
    return result
