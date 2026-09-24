
import bpy, bmesh, math
ns={}; exec(bpy.data.texts["tf_lib.py"].as_string(), ns)
P=ns['spec']()
sc=bpy.context.scene
old=bpy.data.collections.get("Transformer")
if old:
    for o in list(old.objects): bpy.data.objects.remove(o)
    bpy.data.collections.remove(old)
for a in list(bpy.data.armatures):
    if a.users==0: bpy.data.armatures.remove(a)
for m in list(bpy.data.meshes):
    if m.name.startswith("TF_") and m.users==0: bpy.data.meshes.remove(m)
coll=bpy.data.collections.new("Transformer"); sc.collection.children.link(coll)
if "TF_CoreGlow" not in bpy.data.materials:
    _c=bpy.data.materials["TF_Green"].copy(); _c.name="TF_CoreGlow"
MATS=[bpy.data.materials[n] for n in ("TF_Armor","TF_Dark","TF_Green","TF_Red","TF_Rubber","TF_Exhaust","TF_Glass","TF_CoreGlow","TF_Face","TF_Metal","TF_Chrome")]
ad=bpy.data.armatures.new("TF_Rig"); arm=bpy.data.objects.new("TF_Rig",ad); coll.objects.link(arm)
ad.display_type='OCTAHEDRAL'; arm.show_in_front=True
bpy.context.view_layer.objects.active=arm; arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for p in P:
    eb=ad.edit_bones.new(p['name']); eb.head=p['head']; eb.tail=p['tail']
    if p['parent']: eb.parent=ad.edit_bones[p['parent']]
    eb.use_connect=False
bpy.ops.object.mode_set(mode='OBJECT')
for p in P:
    if not p['geo']: continue
    bm=bmesh.new(); p['geo'](bm,p['s'])
    bmesh.ops.transform(bm,matrix=p['rest'],verts=bm.verts)
    uvl=bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n=f.normal; ax=max(range(3),key=lambda i:abs(n[i]))
        for lp in f.loops:
            c=lp.vert.co
            lp[uvl].uv=((c.y,c.z) if ax==0 else (c.x,c.z) if ax==1 else (c.x,c.y))
    me=bpy.data.meshes.new("TF_"+p['name']); bm.to_mesh(me); bm.free()
    for m in MATS: me.materials.append(m)
    me.polygons.foreach_set('use_smooth',[True]*len(me.polygons))
    ob=bpy.data.objects.new("TF_"+p['name'],me); coll.objects.link(ob)
    vg=ob.vertex_groups.new(name=p['name']); vg.add(list(range(len(me.vertices))),1.0,'REPLACE')
    bv=ob.modifiers.new("Bevel",'BEVEL'); bv.width=0.012; bv.segments=3; bv.harden_normals=True; bv.limit_method='ANGLE'; bv.angle_limit=math.radians(35)
    am=ob.modifiers.new("Armature",'ARMATURE'); am.object=arm
    ob.modifiers.move(len(ob.modifiers)-1,0)
    ob.parent=arm
sc.frame_start=1; sc.frame_end=250; sc.frame_set(1)
