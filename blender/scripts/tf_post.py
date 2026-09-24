
import bpy
from bpy_extras import anim_utils
cg=bpy.data.materials["TF_CoreGlow"].node_tree
if cg.animation_data: cg.animation_data_clear()
inp=cg.nodes["Principled BSDF"].inputs["Emission Strength"]
for fr,v in ((1,9),(28,9),(40,0.2),(184,0.2),(196,12),(204,9),(250,9)):
    inp.default_value=v; inp.keyframe_insert("default_value",frame=fr)
def shift_ad(idb):
    ad=getattr(idb,'animation_data',None)
    if not ad or not ad.action: return 0
    act=ad.action; n=0
    try:
        cb=anim_utils.action_get_channelbag_for_slot(act, ad.action_slot); fcs=cb.fcurves if cb else []
    except Exception: fcs=getattr(act,'fcurves',[])
    for fc in fcs:
        for kp in sorted(fc.keyframe_points,key=lambda k:-k.co.x):
            if 22<=kp.co.x<=110:
                kp.co.x+=14; kp.handle_left.x+=14; kp.handle_right.x+=14; n+=1
        fc.update()
    return n
cnt=0
for o in list(bpy.data.collections["TF_VFX"].objects)+list(bpy.data.collections["TF_Stage"].objects):
    cnt+=shift_ad(o)
    if o.type=='LIGHT': cnt+=shift_ad(o.data)
    if o.type=='MESH':
        for m in o.data.materials:
            if m and m.node_tree and m.name.startswith("VFX"): cnt+=shift_ad(m.node_tree)
for mn in ("TF_Exhaust","TF_CoreGlow"):
    cnt+=shift_ad(bpy.data.materials[mn].node_tree)
