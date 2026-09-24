
import bpy, bmesh
from mathutils.bvhtree import BVHTree
def islands(tol=0.008, names=None):
    out={}
    objs=[o for o in bpy.data.collections["Transformer"].objects if o.type=='MESH']
    det=bpy.data.collections.get("TF_Detail")
    if det: objs+=[o for o in det.objects if o.type=='MESH']
    for o in objs:
        if names and o.name not in names: continue
        bm=bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
        seen=set(); comps=[]
        for v in bm.verts:
            if v.index in seen: continue
            stack=[v]; comp=[]; seen.add(v.index)
            while stack:
                x=stack.pop(); comp.append(x.index)
                for e in x.link_edges:
                    y=e.other_vert(x)
                    if y.index not in seen: seen.add(y.index); stack.append(y)
            comps.append(comp)
        if len(comps)<2: bm.free(); continue
        vi2c={}
        for ci,c in enumerate(comps):
            for i in c: vi2c[i]=ci
        co=[v.co.copy() for v in bm.verts]
        polys=[[v.index for v in f.verts] for f in bm.faces]
        trees=[]
        for ci in range(len(comps)):
            ps=[p for p in polys if vi2c[p[0]]==ci]
            trees.append(BVHTree.FromPolygons(co,ps) if ps else None)
        N=len(comps); adj=[set() for _ in range(N)]
        for ci in range(N):
            if trees[ci] is None: continue
            for cj in range(ci+1,N):
                if trees[cj] is None: continue
                ok=bool(trees[ci].overlap(trees[cj]))
                if not ok:
                    d1=min(trees[cj].find_nearest(co[i])[3] for i in comps[ci][::max(1,len(comps[ci])//80)])
                    d2=min(trees[ci].find_nearest(co[i])[3] for i in comps[cj][::max(1,len(comps[cj])//80)]) if d1>=tol else d1
                    ok=min(d1,d2)<tol
                if ok: adj[ci].add(cj); adj[cj].add(ci)
        # connected groups; main = group with most verts
        grp=[-1]*N; groups=[]
        for ci in range(N):
            if grp[ci]>=0: continue
            st=[ci]; grp[ci]=len(groups); g=[ci]
            while st:
                x=st.pop()
                for y in adj[x]:
                    if grp[y]<0: grp[y]=grp[ci]; st.append(y); g.append(y)
            groups.append(g)
        if len(groups)>1:
            main=max(range(len(groups)),key=lambda gi:sum(len(comps[c]) for c in groups[gi]))
            bad=[]
            for gi,g in enumerate(groups):
                if gi==main: continue
                vs=[co[i] for c in g for i in comps[c]]
                cen=sum(vs,vs[0]*0)/len(vs)
                bad.append([round(x,2) for x in cen]+[len(g)])
            out[o.name]=bad
        bm.free()
    return out
