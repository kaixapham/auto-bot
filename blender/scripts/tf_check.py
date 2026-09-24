
import bpy, bmesh
from mathutils.bvhtree import BVHTree
def _meshes(dg):
    out={}
    for o in bpy.data.collections["Transformer"].objects:
        if o.type=='MESH' and not o.hide_viewport: out.setdefault(o.name[3:],[]).append(o)
    det=bpy.data.collections.get("TF_Detail")
    if det:
        for o in det.objects:
            if o.type=='MESH' and o.get("tf_bone"): out.setdefault(o["tf_bone"],[]).append(o)
    return out
def _bm(objs,dg):
    bm=bmesh.new()
    for o in objs:
        e=o.evaluated_get(dg); me=e.to_mesh(); tmp=bmesh.new(); tmp.from_mesh(me); tmp.transform(o.matrix_world)
        me2=bpy.data.meshes.new("_tmp"); tmp.to_mesh(me2); tmp.free(); bm.from_mesh(me2); bpy.data.meshes.remove(me2); e.to_mesh_clear()
    return bm
def overlaps(frame):
    sc=bpy.context.scene; sc.frame_set(frame)
    dg=bpy.context.evaluated_depsgraph_get()
    trees={}
    for k,objs in _meshes(dg).items():
        bm=_bm(objs,dg); trees[k]=BVHTree.FromBMesh(bm); bm.free()
    names=sorted(trees); res={}
    for i,a in enumerate(names):
        for b in names[i+1:]:
            n=len(trees[a].overlap(trees[b]))
            if n: res[a+" x "+b]=n
    return res

def gaps(frame,pairs,tol=0.015):
    sc=bpy.context.scene; sc.frame_set(frame)
    dg=bpy.context.evaluated_depsgraph_get()
    data={}
    for k,objs in _meshes(dg).items():
        bm=_bm(objs,dg); data[k]=(BVHTree.FromBMesh(bm),[v.co.copy() for v in bm.verts]); bm.free()
    res={}
    for c,p in pairs:
        if c not in data or p not in data: continue
        tc,vc=data[c]; tp,vp=data[p]
        if tc.overlap(tp): continue
        d=min(tp.find_nearest(v)[3] for v in vc[::max(1,len(vc)//2500)])
        if d>tol: res[c+"->"+p]=round(d,3)
    return res
