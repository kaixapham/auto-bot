
import bpy, re
arm=bpy.data.objects["TF_Rig"]
sc=bpy.context.scene
det=bpy.data.collections.get("TF_Detail")
if not det:
    det=bpy.data.collections.new("TF_Detail"); sc.collection.children.link(det)
bones=set(b.name for b in arm.data.bones)
report={"bound":[],"unknown":[]}
covered=set()
for o in det.objects:
    if o.type!='MESH': continue
    m=re.match(r"D_([A-Za-z0-9]+(?:\.[LR])?)",o.name)
    bone=m.group(1) if m else None
    if bone not in bones: report["unknown"].append(o.name); continue
    if not o.get("tf_bound"):
        # bake object transform into mesh (modelled in bind/rest pose, world space)
        mw=o.matrix_world.copy(); o.parent=None; o.data.transform(mw); o.matrix_world=o.matrix_world.Identity(4)
        o.vertex_groups.clear(); vg=o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))),1.0,'REPLACE')
        for md in list(o.modifiers):
            if md.type=='ARMATURE': o.modifiers.remove(md)
        am=o.modifiers.new("Armature",'ARMATURE'); am.object=arm
        o.parent=arm; o["tf_bound"]=1; o["tf_bone"]=bone
    covered.add(bone); report["bound"].append(o.name+" -> "+bone)
# hide blockout parts that now have detail meshes
for o in bpy.data.collections["Transformer"].objects:
    if o.type=='MESH':
        hid=o.name[3:] in covered
        o.hide_viewport=hid; o.hide_render=hid
report["covered"]=sorted(covered)
