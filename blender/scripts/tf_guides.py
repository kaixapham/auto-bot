
import bpy, bmesh
from mathutils import Vector
sc=bpy.context.scene; arm=bpy.data.objects["TF_Rig"]
old=bpy.data.collections.get("TF_Guides")
if old:
    for o in list(old.objects): bpy.data.objects.remove(o)
    bpy.data.collections.remove(old)
g=bpy.data.collections.new("TF_Guides"); sc.collection.children.link(g)
ns={}; exec(bpy.data.texts["tf_lib.py"].as_string(), ns); P=ns['spec']()
for p in P:
    ob=bpy.data.objects.get("TF_"+p['name'])
    if not ob: continue
    vs=[v.co for v in ob.data.vertices]
    mn=Vector((min(v.x for v in vs),min(v.y for v in vs),min(v.z for v in vs))); mx=Vector((max(v.x for v in vs),max(v.y for v in vs),max(v.z for v in vs)))
    me=bpy.data.meshes.new("G_"+p['name']); bm=bmesh.new(); r=bmesh.ops.create_cube(bm,size=1.0)
    for v in r['verts']: v.co=Vector(((mn.x+mx.x)/2+v.co.x*(mx.x-mn.x),(mn.y+mx.y)/2+v.co.y*(mx.y-mn.y),(mn.z+mx.z)/2+v.co.z*(mx.z-mn.z)))
    bm.to_mesh(me); bm.free()
    go=bpy.data.objects.new("ENV_"+p['name'],me); g.objects.link(go); go.display_type='WIRE'; go.hide_render=True
    e=bpy.data.objects.new("PIVOT_"+p['name'],None); g.objects.link(e); e.empty_display_type='SPHERE'; e.empty_display_size=0.04; e.location=p['head']; e.hide_render=True
