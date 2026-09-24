
import bpy, math
ns={}; exec(bpy.data.texts["tf_lib.py"].as_string(), ns)
Matrix=ns['Matrix']; Vector=ns['Vector']; Quaternion=ns['Quaternion']
P=ns['spec'](); PM={p['name']:p for p in P}
sc=bpy.context.scene; vl=bpy.context.view_layer
arm=bpy.data.objects["TF_Rig"]
if arm.animation_data: arm.animation_data_clear()
for pb in arm.pose.bones: pb.rotation_mode='QUATERNION'; pb.matrix_basis=Matrix()
vl.update()
def basis_for_delta(name,D):
    pb=arm.pose.bones[name]; b=arm.data.bones[name]
    pb.matrix = D @ b.matrix_local; vl.update()
    l,q,s = pb.matrix_basis.decompose(); pb.matrix_basis=Matrix(); vl.update()
    return (l.copy(),q.copy(),s.copy())
def djet(p):
    if p['parent'] is None: return Matrix()
    par=PM[p['parent']]
    return par['rest']@par['jet'].inverted()@p['jet']@p['rest'].inverted()
JB={p['name']:basis_for_delta(p['name'],djet(p)) for p in P if p['parent']}
def frac(tg,f):
    l,q,s=tg
    if q.w<0: q=-q
    ax,ang=q.to_axis_angle()
    return (l*f, Quaternion(ax,ang*f), Vector((1,1,1))+(s-Vector((1,1,1)))*f)
END=250
def key(pb,fr,val):
    pb.location,pb.rotation_quaternion,pb.scale=val
    for dp in ("location","rotation_quaternion","scale"): pb.keyframe_insert(dp,frame=fr)
MODE=globals().get('TF_MODE','anim')
if MODE=='jet':
    for n,tg in JB.items(): arm.pose.bones[n].location,arm.pose.bones[n].rotation_quaternion,arm.pose.bones[n].scale=tg
else:
    ALL={}
    T_=ns['T']; Rx=ns['Rx']; Ry=ns['Ry']; Rz=ns['Rz']; hinge=ns['hinge']
    def resolve0(p,kl):
        out=[]
        for fr,kind,v in kl:
            if kind=='I': out.append((fr,(Vector(),Quaternion(),Vector((1,1,1)))))
            elif kind=='F': out.append((fr,frac(JB[p['name']],v)))
            else: out.append((fr,basis_for_delta(p['name'],v)))
        return out
    JUMP={'pelvis':[(28,'I',0),(35,'I',0)]}
    # athletic one-leg takeoff: L = plant/push leg, R = drive knee; arms opposite (L arm fwd-up, R arm back)
    for p in P:
        n=p['name']; s_=p['s']; h=p['head']; drive=(s_<0)
        if n.startswith('thigh'):
            JUMP[n]=[(24,'D',hinge(h,Rx(-72))),(28,'D',hinge(h,Rx(-85))),(34,'D',hinge(h,Rx(-60)))] if drive else [(24,'D',hinge(h,Rx(8))),(28,'D',hinge(h,Rx(14))),(34,'D',hinge(h,Rx(6)))]
        if n.startswith('shin'):
            JUMP[n]=[(24,'D',hinge(h,Rx(60))),(28,'D',hinge(h,Rx(64))),(34,'D',hinge(h,Rx(52)))] if drive else [(24,'D',hinge(h,Rx(4))),(28,'D',hinge(h,Rx(8))),(34,'D',hinge(h,Rx(25)))]
        if n.startswith('foot'):
            JUMP[n]=[(24,'D',hinge(h,Rx(-10))),(34,'D',hinge(h,Rx(10)))] if drive else [(24,'D',hinge(h,Rx(10))),(28,'D',hinge(h,Rx(12))),(34,'D',hinge(h,Rx(8)))]
        if n.startswith('upperarm'):
            JUMP[n]=[(24,'D',hinge(h,Ry(-s_*12)@Rx(-70))),(30,'D',hinge(h,Ry(-s_*16)@Rx(-85))),(34,'D',hinge(h,Ry(-s_*18)@Rx(-75)))] if s_>0 else [(24,'D',hinge(h,Ry(-s_*14)@Rx(22))),(30,'D',hinge(h,Ry(-s_*18)@Rx(26))),(34,'D',hinge(h,Ry(-s_*18)@Rx(15)))]
        if n.startswith('forearm'):
            JUMP[n]=[(24,'D',hinge(h,Rx(-40))),(34,'D',hinge(h,Rx(-30)))] if s_>0 else [(24,'D',hinge(h,Rx(-25))),(34,'D',hinge(h,Rx(-20)))]
        if n.startswith('hand'):
            JUMP[n]=[(24,'D',hinge(h,Rx(-10)@Rz(s_*12))),(34,'D',hinge(h,Rx(-10)@Rz(s_*12)))]
        if n=='chest':
            JUMP[n]=[(24,'D',hinge(h,Rx(12)@Rz(6))),(30,'D',hinge(h,Rx(4)@Rz(4))),(34,'D',hinge(h,Rx(-8)))]
    for p in P:
        if not p['parent'] or 'wheel' in p: continue
        vals=[]; prevq=None
        for fr,kind,v in p['keys']:
            if kind=='I': val=(Vector(),Quaternion(),Vector((1,1,1)))
            elif kind=='F': val=frac(JB[p['name']],v)
            else: val=basis_for_delta(p['name'],v)
            q=val[1]
            if prevq is not None and prevq.dot(q)<0: val=(val[0],-q,val[2])
            prevq=val[1]; vals.append((fr,val))
        vals=[(fr if fr<=21 else fr+14,val) for fr,val in vals]
        J=list(JUMP.get(p['name']) or [])+list(p.get('raw') or [])
        if J:
            extra=[(fr,v) for fr,v in resolve0(p,J)]
            vals=sorted(vals+extra,key=lambda x:x[0])
            # re-fix quaternion hemisphere continuity
            fixed=[]; pq=None
            for fr,val in vals:
                q=val[1]
                if pq is not None and pq.dot(q)<0: val=(val[0],-q,val[2])
                pq=val[1]; fixed.append((fr,val))
            vals=fixed
        ALL[p['name']]=vals
    # ---- distinct return sequence (jet -> robot), frames 150..250 ----
    T_=ns['T']; Rx=ns['Rx']; Rz=ns['Rz']; hinge=ns['hinge']
    crouch=T_(0,-0.03,-0.048)
    def REV(p):
        n=p['name']; s=p['s']
        if 'rev' in p: return p['rev']
        if 'wheel' in p: return []
        if n=='pelvis': return [(150,'F',1),(172,'F',1),(200,'F',0.03),(207,'D',crouch),(212,'D',crouch),(228,'I',0)]
        if n=='head': return [(150,'I',0),(228,'I',0),(236,'D',hinge(p['head'],Rz(18))),(246,'I',0)]
        if n.startswith('thigh'): return [(150,'F',1),(178,'F',1),(200,'F',0),(207,'D',hinge(p['head'],Rx(-12))),(212,'D',hinge(p['head'],Rx(-12))),(228,'I',0)]
        if n.startswith('shin'): return [(150,'I',0),(200,'I',0),(207,'D',hinge(p['head'],Rx(24))),(212,'D',hinge(p['head'],Rx(24))),(228,'I',0)]
        if n.startswith('foot'): return [(150,'F',1),(160,'F',1),(184,'F',-0.05),(190,'I',0),(200,'I',0),(207,'D',hinge(p['head'],Rx(-12))),(212,'D',hinge(p['head'],Rx(-12))),(228,'I',0)]
        if n.startswith('fin'): return [(150,'F',1),(152,'F',1),(166,'F',-0.1),(171,'I',0)]
        if n.startswith('wing'): return [(150,'F',1),(156,'F',1),(174,'F',-0.06),(181,'I',0)]
        if n=='nose': return [(150,'F',1),(166,'F',1),(180,'D',T_(0,0,0.85)),(196,'I',0)]
        if n.startswith('upperarm'): return [(150,'F',1),(178,'F',1),(198,'F',-0.05),(204,'I',0)]
        return [(150,'I',0)] if p['keys'] else []
    def resolve(p,klist):
        vals=[]; prevq=ALL[p['name']][-1][1][1] if ALL.get(p['name']) else None
        for fr,kind,v in klist:
            if kind=='I': val=(Vector(),Quaternion(),Vector((1,1,1)))
            elif kind=='F': val=frac(JB[p['name']],v)
            else: val=basis_for_delta(p['name'],v)
            q=val[1]
            if prevq is not None and prevq.dot(q)<0: val=(val[0],-q,val[2])
            prevq=val[1]; vals.append((fr,val))
        return vals
    RALL={p['name']:resolve(p,REV(p)) for p in P if p['parent'] and 'wheel' not in p}
    for n,vals in ALL.items():
        pb=arm.pose.bones[n]
        for fr,val in vals: key(pb,fr,val)
        if vals and not RALL[n]: key(pb,150,vals[-1][1])
        for fr,val in RALL[n]: key(pb,fr,val)
    for p in P:
        if 'wheel' in p:
            pb=arm.pose.bones[p['name']]; pb.rotation_mode='XYZ'
            for fr,deg in p['wheel']:
                fr2=fr if (fr<=21 or fr>=150) else fr+14
                pb.rotation_euler=(0,math.radians(deg)*p['s'],0); pb.keyframe_insert("rotation_euler",frame=fr2)
    rb=arm.pose.bones['root']
    # root motion (world): leap back-and-up into flight, fly, then descend and land. (x,y,z, roll, pitch)
    RK=((1,0,0,0,0,0),(18,0,-0.05,0,0,0),(21,0,-0.05,0,0,0),(28,0,0.2,1.35,0,0),(35,0,0.45,2.05,0,0),(42,0,0.9,2.15,0,0),
        (54,0,1.6,1.9,0,0),(76,0,2.7,1.5,0,0),(104,0,3.9,1.15,0,0),(114,0,4.4,1.05,0,0),(126,0,5.0,1.2,5,-2),(138,0,5.6,1.0,-4,1.5),(150,0,6.8,1.05,0,0),
        (172,0,7.8,1.1,0,0),(198,0,8.5,0.12,0,0),(207,0,8.6,0.0,0,0),(250,0,8.6,0.0,0,0))
    # root bone points +Z; its local frame == world rotated. Use delta to compute basis.
    for fr,x,y,z,roll,pitch in RK:
        D=ns['T'](x,y,z)@ns['Ry'](roll)@ns['Rx'](pitch)
        rb.matrix = D @ arm.data.bones['root'].matrix_local
        vl.update()
        l,q,sc_=rb.matrix_basis.decompose()
        key(rb,fr,(l.copy(),q.copy(),Vector((1,1,1))))
    rb.matrix_basis=Matrix()
    sc.frame_start=1; sc.frame_end=END
sc.frame_set(sc.frame_current)
