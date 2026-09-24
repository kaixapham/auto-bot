
import bpy, bmesh, math
from mathutils import Matrix, Vector, Euler, Quaternion
D2R = math.pi/180
def T(*v):
    if len(v)==1: v=v[0]
    return Matrix.Translation(Vector(v))
def Rx(d): return Matrix.Rotation(d*D2R,4,'X')
def Ry(d): return Matrix.Rotation(d*D2R,4,'Y')
def Rz(d): return Matrix.Rotation(d*D2R,4,'Z')
def S(k): return Matrix.Diagonal((k,k,k,1))
R_BODY = Rx(-90)
def J(p): return Vector((p[0], p[2]-2.9, 3.0-p[1]))

def _tag(bm,n,mat):
    for f in bm.faces:
        if f not in n: f.material_index=mat
def box(bm,c,s,mat=0,top=(1,1),bot=(1,1),rot=None):
    n=set(bm.faces); r=bmesh.ops.create_cube(bm,size=1.0)
    M=T(c)@(rot.to_matrix().to_4x4() if rot else Matrix())
    for v in r['verts']:
        tx,ty = top if v.co.z>0 else bot
        v.co = M@Vector((v.co.x*s[0]*tx, v.co.y*s[1]*ty, v.co.z*s[2]))
    _tag(bm,n,mat)
def cyl(bm,c,r,d,axis='Z',mat=0,r2=None,seg=32):
    n=set(bm.faces)
    A={'Z':Matrix(),'X':Ry(90),'Y':Rx(-90)}[axis]
    bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,segments=seg,radius1=r,radius2=(r if r2 is None else r2),depth=d,matrix=T(c)@A)
    _tag(bm,n,mat)
def sph(bm,c,r,mat=1,seg=24):
    n=set(bm.faces); bmesh.ops.create_uvsphere(bm,u_segments=seg,v_segments=seg//2+1,radius=r,matrix=T(c)); _tag(bm,n,mat)
def hull(bm,pts,mat=0):
    n=set(bm.faces); vs=[bm.verts.new(Vector(p)) for p in pts]
    r=bmesh.ops.convex_hull(bm,input=vs)
    dead=[v for v in vs if v.is_valid and not v.link_faces]
    if dead: bmesh.ops.delete(bm,geom=dead,context='VERTS')
    _tag(bm,n,mat)



def cbox(bm,c,s,mat=0,ch=0.03,top=(1,1),bot=(1,1),rot=None):
    hx,hy,hz=s[0]/2,s[1]/2,s[2]/2
    ch=min(ch,hx*0.45,hy*0.45,hz*0.45)
    M=T(c)@(rot.to_matrix().to_4x4() if rot else Matrix())
    pts=[]
    for sx in (1,-1):
        for sy in (1,-1):
            for sz in (1,-1):
                tx,ty=top if sz>0 else bot
                for (ax,ay,az) in ((hx,hy-ch,hz-ch),(hx-ch,hy,hz-ch),(hx-ch,hy-ch,hz)):
                    pts.append(tuple(M@Vector((sx*ax*tx,sy*ay*ty,sz*az))))
    hull(bm,pts,mat)
def cyl_ab(bm,a,b,r,mat=1,seg=16,r2=None):
    a=Vector(a); b=Vector(b); d=b-a; L=d.length
    q=Vector((0,0,1)).rotation_difference(d.normalized())
    n=set(bm.faces)
    bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,segments=seg,radius1=r,radius2=(r if r2 is None else r2),depth=L,matrix=T((a+b)/2)@q.to_matrix().to_4x4())
    _tag(bm,n,mat)
def bolt(bm,c,axis,r=0.011,mat=9):
    a=Vector(axis).normalized(); c=Vector(c)
    cyl_ab(bm,c-a*0.004,c+a*0.007,r,mat,seg=6)
def bolts(bm,pts,axis,r=0.011,mat=9):
    for p in pts: bolt(bm,p,axis,r,mat)
def piston(bm,a,b,r=0.022):
    a=Vector(a); b=Vector(b); d=(b-a).normalized(); m=a.lerp(b,0.52)
    cyl_ab(bm,a,m+d*0.01,r,1,seg=16)
    cyl_ab(bm,m-d*0.02,b,r*0.5,10,seg=12)
    cyl_ab(bm,a-d*0.015,a+d*0.015,r*1.25,9,seg=16)
    cyl_ab(bm,b-d*0.012,b+d*0.012,r*0.9,9,seg=16)
def vents(bm,c,w,h,n,axis_out,mat=1):
    # slats across a panel; axis_out: 'Y-','Y+','X+','X-'
    c=Vector(c)
    for i in range(n):
        z=c.z-h/2+h*(i+0.5)/n
        if axis_out[0]=='Y': box(bm,(c.x,c.y,z),(w,0.012,h/n*0.45),mat)
        else: box(bm,(c.x,c.y,z),(0.012,w,h/n*0.45),mat)


PEC_BACK=[(0.2,3.82),(0.33,3.26),(0.61,3.28),(1.36,3.77),(1.34,3.97),(1.29,4.29),(1.16,4.44)]
PEC_TOP=[(0.2,3.82),(0.56,3.40),(0.80,3.52),(1.29,4.29),(1.16,4.44)]
PEC_XH=0.72; PEC_YB=-0.595; PEC_YM=-0.635; PEC_YF=-0.665; PEC_YA=-0.685
def _clipx(poly,x0,ge):
    out=[]; n=len(poly)
    for i in range(n):
        a=poly[i]; b=poly[(i+1)%n]
        ina=(a[0]>=x0) if ge else (a[0]<=x0); inb=(b[0]>=x0) if ge else (b[0]<=x0)
        if ina: out.append(a)
        if ina!=inb:
            u=(x0-a[0])/(b[0]-a[0]); out.append((x0,a[1]+u*(b[1]-a[1])))
    return out
def slab(bm,poly,yb,yf,mat,ch=0.012,sx=1,off=(0,0,0)):
    cx=sum(p[0] for p in poly)/len(poly); cz=sum(p[1] for p in poly)/len(poly); pts=[]
    for (x,z) in poly:
        dx,dz=cx-x,cz-z; L=(dx*dx+dz*dz)**0.5 or 1
        xi,zi=x+dx/L*ch,z+dz/L*ch
        pts+=[(sx*x-off[0],yb-off[1],z-off[2]),(sx*x-off[0],yf+ch-off[1],z-off[2]),(sx*xi-off[0],yf-off[1],zi-off[2])]
    hull(bm,pts,mat)


def ring(bm,c,r0,r1,z0,z1,mat,seg=36):
    import math as _m
    n=set(bm.faces); V=[]
    for i in range(seg):
        a=2*_m.pi*i/seg; ca,sa=_m.cos(a),_m.sin(a)
        V.append([bm.verts.new((c[0]+r*ca,c[1]+r*sa,z)) for (r,z) in ((r0,z0),(r1,z0),(r1,z1),(r0,z1))])
    new=[]
    for i in range(seg):
        a=V[i]; b=V[(i+1)%seg]
        for q in range(4): new.append(bm.faces.new((a[q],b[q],b[(q+1)%4],a[(q+1)%4])))
    bmesh.ops.recalc_face_normals(bm,faces=new)
    for f in new: f.material_index=mat
def leaf(bm,a,b,w,z0,z1,mat=1):
    a=Vector(a); b=Vector(b); d=(b-a); d.z=0; d.normalize(); p=Vector((-d.y,d.x,0))*w
    hull(bm,[tuple(q+Vector((0,0,z))) for q in (a+p,a-p,b+p,b-p) for z in (z0,z1)],mat)


def joint(bm,c,ax,R,L,mat=0,rim=10,lens=2,ticks=True,seg=48):
    import math as _m
    c=Vector(c); ax=Vector(ax).normalized()
    M=T(c)@Vector((0,0,1)).rotation_difference(ax).to_matrix().to_4x4()
    h=L/2; ch=min(0.12*R,0.3*L); Ri=0.6*R; dep=min(0.42*L,0.5*R)
    g0=-h+0.3*L; g1=g0+0.16*L
    P=[(R-ch,-h),(R,-h+ch),(R,g0),(R*0.93,g0),(R*0.93,g1),(R,g1),(R,h-ch),(R-ch,h),(R*0.86,h),(R*0.82,h),(Ri+ch*0.6,h),(Ri,h-ch*0.6),(Ri,h-dep)]
    SM=[mat,mat,rim,1,rim,mat,mat,mat,rim,mat,rim,1]
    rings=[]
    for i in range(seg):
        a=2*_m.pi*i/seg; ca,sa=_m.cos(a),_m.sin(a)
        rings.append([bm.verts.new(M@Vector((r*ca,r*sa,z))) for (r,z) in P])
    cb=bm.verts.new(M@Vector((0,0,-h))); ct=bm.verts.new(M@Vector((0,0,h-dep)))
    for i in range(seg):
        A=rings[i]; B=rings[(i+1)%seg]
        for k in range(len(P)-1):
            f=bm.faces.new((A[k],B[k],B[k+1],A[k+1])); f.material_index=SM[k]
        f=bm.faces.new((B[0],A[0],cb)); f.material_index=mat
        f=bm.faces.new((A[-1],B[-1],ct)); f.material_index=1
    # lens + hub at recess bottom
    n=set(bm.faces)
    bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,segments=32,radius1=Ri*0.7,radius2=Ri*0.7,depth=0.008,matrix=M@T(0,0,h-dep+0.002))
    bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,segments=24,radius1=Ri*0.3,radius2=Ri*0.3,depth=0.02,matrix=M@T(0,0,h-dep+0.008))
    k=0
    for f in bm.faces:
        if f not in n: f.material_index=lens if k<34 else 9; k+=1
    if ticks:
        zm=(g0+g1)/2; nt=24
        for i in range(nt):
            if i==0: continue
            a=2*_m.pi*i/nt; n=set(bm.faces)
            bmesh.ops.create_cube(bm,size=1.0,matrix=M@Matrix.Rotation(a,4,'Z')@T(R*0.965,0,zm)@Matrix.Diagonal((0.07*R,0.02*R,(0.12 if i%3==0 else 0.07)*L,1)))
            for f in bm.faces:
                if f not in n: f.material_index=rim
        # index marker triangle on face
        n=set(bm.faces)
        bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=True,segments=3,radius1=0.06*R,radius2=0.06*R,depth=0.006,matrix=M@T(R*0.9-0.06*R,0,h))
        for f in bm.faces:
            if f not in n: f.material_index=lens

# ---------- part geometry (local, pivot at origin) ----------
def g_pelvis(bm,s):
    for k in (1,-1): cyl(bm,(k*0.4,0,-0.1),0.1,0.03,'X',2,seg=32)
    box(bm,(0,-0.305,-0.06),(0.08,0.01,0.08),2)
    hull(bm,[(x,y,z) for x in (0.2,-0.2) for (y,z) in ((-0.25,0.12),(-0.3,0.05))]+[(x,y,z) for x in (0.1,-0.1) for (y,z) in ((-0.22,-0.3),(-0.28,-0.25))],0)
    box(bm,(0,-0.3,-0.12),(0.08,0.015,0.03),2)
    for k in (1,-1):
        box(bm,(k*0.15,-0.28,0.09),(0.12,0.03,0.04),1,rot=Euler((0,k*0.3,0)))
        joint(bm,(k*0.445,0,-0.1),(k,0,0),0.17,0.08,0)
    cbox(bm,(0,0,0.03),(0.8,0.5,0.5),0,ch=0.1,bot=(0.8,0.85))
    for k in (1,-1):
        bolts(bm,[(k*0.17,-0.281,0.11),(k*0.25,-0.212,-0.11)],(0,-1,0),r=0.009)
        # recessed intake grille, framed and bolted flush on the flat hip face
        cx,cz,W,H=k*0.255,0.095,0.09,0.12
        box(bm,(cx,-0.252,cz),(W-0.01,0.008,H-0.01),1)
        for zz in (cz+H/2-0.009,cz-H/2+0.009): cbox(bm,(cx,-0.261,zz),(W,0.024,0.018),0,ch=0.006)
        for xx in (cx-W/2+0.009,cx+W/2-0.009): cbox(bm,(xx,-0.261,cz),(0.018,0.024,H),0,ch=0.006)
        for q in range(4): cbox(bm,(cx,-0.258,cz-0.036+q*0.024),(W-0.03,0.014,0.008),9,ch=0.002,rot=Euler((0.35,0,0)))
        bolts(bm,[(cx+dx,-0.273,cz+dz) for dx in (-W/2+0.009,W/2-0.009) for dz in (-H/2+0.009,H/2-0.009)],(0,-1,0),r=0.005)
    box(bm,(0,-0.275,-0.08),(0.2,0.05,0.2),1,bot=(0.6,1))
    for k in (1,-1): cyl(bm,(k*0.33,0,-0.1),0.15,0.12,'X',1)
    box(bm,(0,-0.26,0.12),(0.3,0.03,0.04),2)
def g_chest(bm,s):
    import math as _m
    for i in range(6):
        a=i*_m.pi/3+_m.pi/6
        box(bm,(0.26*_m.cos(a),-0.397,0.72+0.26*_m.sin(a)),(0.12,0.015,0.018),2,rot=Euler((0,-a,0)))
    for k in (1,-1):
        for j in range(3): box(bm,(k*(0.4225+0.284*(0.1+j*0.14)+0.005),0,0.45+j*0.14),(0.04,0.5,0.05),1)
        cyl(bm,(k*0.3,0.44,1.3),0.08,0.36,'Z',1)
        cyl(bm,(k*0.3,0.44,1.47),0.065,0.04,'Z',1)
    cbox(bm,(0,-0.33,1.18),(0.36,0.07,0.03),0,ch=0.012)
    for j in range(4): box(bm,(-0.105+j*0.07,-0.366,1.18),(0.045,0.004,0.012),1)
    for j in range(3):
        for k in (1,-1): cbox(bm,(k*0.09,-0.215,0.07+j*0.1),(0.14,0.03,0.075),0,ch=0.012)
    box(bm,(0,0.215,0.15),(0.04,0.02,0.3),2)
    cbox(bm,(0,0,0.06),(0.6,0.42,0.14),1,ch=0.04)
    for k in (1,-1):
        box(bm,(0,k*0.15,0.26),(0.6,0.12,0.26),1)
        box(bm,(k*0.195,0,0.26),(0.21,0.18,0.26),1)
    sph(bm,(0,0,0),0.13,1,seg=32)
    box(bm,(0,-0.215,0.1),(0.2,0.02,0.03),2)
    def hw(z): return 0.4225+0.284*(z-0.35)
    def hd(z): return 0.3+0.09375*(z-0.35)
    Z0,Z1,Z2=0.35,0.43,1.17
    for k in (1,-1):
        hull(bm,[(x*hw(z),yy,z) for z in (Z0,Z1) for x in (1,-1) for yy in (k*hd(z),k*0.09)],0)
        hull(bm,[(xx,y,z) for z in (Z0,Z1) for xx in (k*0.09,k*hw(z)) for y in (0.09,-0.09)],0)
    ring(bm,(0,0),0.07,0.088,0.13,0.43,1,seg=32)
    cyl(bm,(0,0,0.125),0.09,0.01,'Z',1,seg=32)
    ring(bm,(0,0),0.086,0.13,0.43,0.445,9,seg=32)
    import math as _mw
    for a in range(8):
        aa=a*_mw.pi/4+_mw.pi/8; bolt(bm,(0.112*_mw.cos(aa),0.112*_mw.sin(aa),0.445),(0,0,1),r=0.008)
    for k in (1,-1):
        cyl_ab(bm,(k*0.2,-0.2,0.44),(k*0.2,0.2,0.44),0.012,10,seg=10)
        cyl_ab(bm,(k*0.2,0.2,0.44),(k*0.13,0.2,0.44),0.012,10,seg=10)
    hull(bm,[(x*hw(z),yy,z) for z in (Z1,Z2) for x in (1,-1) for yy in (-hd(z),-0.26)],0)
    hull(bm,[(x*hw(z),yy,z) for z in (Z1,Z2) for x in (1,-1) for yy in (0.26,hd(z))],0)
    for k in (1,-1):
        hull(bm,[(k*xx,y,z) for z in (Z1,Z2) for xx in (0.27,hw(z)) for y in (-0.26,0.26)],0)
        box(bm,(k*0.26,0.02,0.8),(0.02,0.08,0.73),1)
    box(bm,(0,0.37,1.21),(0.22,0.08,0.1),1)
    cyl(bm,(0,0.4,1.24),0.035,0.24,'X',1,seg=16)
    for k in (1,-1):
        box(bm,(k*0.17,-0.43,0.5),(0.22,0.04,0.04),2,rot=Euler((0,k*0.6,0)))
    cbox(bm,(0,-0.36,0.72),(1.02,0.06,0.62),1,ch=0.025)
    import math as _mb
    for a in range(12):
        aa=a*_mb.pi/6+_mb.pi/12
        bolt(bm,(0.29*_mb.cos(aa),-0.39,0.72+0.29*_mb.sin(aa)),(0,-1,0),r=0.009)
    bolts(bm,[(x,-0.39,z) for x in (0.47,-0.47) for z in (0.45,0.99)],(0,-1,0),r=0.011)
    cyl(bm,(0,-0.41,0.72),0.06,0.08,'Y',1,seg=24)
    cyl(bm,(0,-0.39,0.72),0.23,0.03,'Y',1,seg=48)
    for zc in (0.455,0.985):
        box(bm,(0,-0.49,zc),(1.03,0.03,0.025),1)
    for k in (1,-1):
        box(bm,(k*0.5,-0.43,0.72),(0.03,0.13,0.56),1)
        box(bm,(k*0.3,-0.41,1.14),(0.22,0.07,0.04),1)
    for j in range(4): box(bm,(0,-0.207,0.07+j*0.085),(0.06,0.02,0.025),2)
    box(bm,(0,-0.42,0.38),(0.05,0.05,0.3),2)
    box(bm,(0,-0.44,1.02),(0.32,0.08,0.22),6,top=(0.7,0.7))
    cbox(bm,(0,0.44,0.72),(0.75,0.18,0.72),1,ch=0.07)
    for k in (1,-1):
        piston(bm,(k*0.25,0.535,0.42),(k*0.25,0.535,1.0),r=0.02)
        bolts(bm,[(k*0.33,0.53,z) for z in (0.45,0.72,0.99)],(0,1,0),r=0.01)
    for k in (1,-1): box(bm,(k*0.385,0.5,0.72),(0.03,0.06,0.7),2)
    for k in (1,-1):
        cyl(bm,(k*0.66,0,0.85),0.08,0.3,'X',1,seg=32)
        cbox(bm,(k*0.575,0,0.85),(0.04,0.32,0.34),1,ch=0.03)
        joint(bm,(k*0.61,0,0.85),(k,0,0),0.12,0.05,1)
        import math as _mm
        for a in range(8):
            aa=a*_mm.pi/4+_mm.pi/8
            bolt(bm,(k*0.597,0.14*_mm.cos(aa),0.85+0.14*_mm.sin(aa)),(k,0,0),r=0.01)
        box(bm,(k*0.71,0,1.17),(0.16,0.26,0.1),1)
    # ---- pectoral armor (fixed inner plates, standoffs, hinge knuckles) ----
    XH=PEC_XH; YB,YM,YF,YA=PEC_YB,PEC_YM,PEC_YF,PEC_YA; O=(0,0,2.9)
    ib=_clipx(PEC_BACK,XH-0.05,False); it=_clipx(PEC_TOP,XH-0.05,False)
    for k in (1,-1):
        o=(0,0,2.9)
        slab(bm,ib,YB,YM,8,0.01,k,o); slab(bm,it,YM,YF,0,0.012,k,o)
        cyl_ab(bm,(k*0.27,YF-0.003,3.77-2.9),(k*0.54,YF-0.003,3.455-2.9),0.008,2,seg=8)
        cyl_ab(bm,(k*0.575,YF-0.003,3.45-2.9),(k*0.66,YF-0.003,3.49-2.9),0.008,2,seg=8)
        bolts(bm,[(k*0.40,YM,3.33-2.9),(k*0.55,YM,3.34-2.9)],(0,-1,0),r=0.01)
        bolts(bm,[(k*0.45,YF,3.85-2.9),(k*0.62,YF,3.98-2.9)],(0,-1,0),r=0.01)
        # pec detail (inner plate): ring disc, seams, vents, bolts
        joint(bm,(k*0.45,YF-0.002,3.72-2.9),(0,-1,0),0.055,0.012,1,ticks=False)
        for (a,b) in (((0.3,3.87),(0.62,3.52)),((0.32,3.86),(0.46,3.94))):
            cyl_ab(bm,(k*a[0],YF-0.001,a[1]-2.9),(k*b[0],YF-0.001,b[1]-2.9),0.0035,1,seg=6)
        for q in range(3): box(bm,(k*(0.56+q*0.018),YF-0.003,3.66-2.9),(0.008,0.006,0.04),1)
        bolts(bm,[(k*0.36,YF,3.72-2.9),(k*0.6,YF,3.62-2.9)],(0,-1,0),r=0.007)
        for z0,z1 in ((3.47,3.55),(3.74,3.92)):
            cyl(bm,(k*XH,YA,(z0+z1)/2-2.9),0.045,z1-z0,'Z',9,seg=24)
            box(bm,(k*(XH-0.0275),-0.67,(z0+z1)/2-2.9),(0.055,0.02,z1-z0),9)
        cyl_ab(bm,(k*0.55,-0.36,4.0-2.9),(k*0.55,-0.60,4.0-2.9),0.022,1,seg=16)
        cyl_ab(bm,(k*0.40,-0.29,3.30-2.9),(k*0.40,-0.60,3.30-2.9),0.02,1,seg=16)
        cyl_ab(bm,(k*0.575,-0.15,3.72-2.9),(k*0.62,-0.60,3.72-2.9),0.022,1,seg=16)
    # ---- back-top vents + raised plates (face up in jet mode, beside the nose) ----
    for k in (1,-1):
        for zc,zh in ((0.62,0.2),(0.94,0.24)):
            z0,z1=zc-zh/2,zc+zh/2; x0,x1=0.40,0.58
            hull(bm,[(k*x,hd(z)-0.012,z) for x in (x0,x1) for z in (z0,z1)]+[(k*x,hd(z)+0.022,z) for x in (x0+0.012,x1-0.012) for z in (z0+0.012,z1-0.012)],0)
            for q in range(5):
                zq=z0+0.03+q*(zh-0.06)/4
                box(bm,(k*(x0+x1)/2,hd(zq)+0.028,zq),(x1-x0-0.05,0.014,0.012),1)
            bolts(bm,[(k*x,hd(z)+0.022,z) for x in (x0+0.018,x1-0.018) for z in (z0+0.018,z1-0.018)],(0,1,0),r=0.006)
        hull(bm,[(k*x,y,z) for x in (0.4,0.58) for y in (0.37,0.40) for z in (1.08,1.15)],0)
        box(bm,(k*0.49,0.405,1.115),(0.14,0.008,0.012),2)
    for q in range(6): box(bm,(0,0.535,0.52+q*0.06),(0.22,0.02,0.018),9)
    cbox(bm,(0,0.525,0.67),(0.28,0.03,0.38),1,ch=0.01)
def _face_mask(bm,mat=8):
    import math as _m
    n0=set(bm.faces)
    Z0,Z1=0.075,0.47; NU,NZ=26,90
    def hw(z):
        t=(z-Z0)/(Z1-Z0)
        return 0.055+0.075*min(1.0,max(0.0,t)/0.42)**0.6-0.012*max(0.0,(t-0.8)/0.2)
    def G(x,z,cx,cz,sx,sz): return _m.exp(-((x-cx)/sx)**2-((z-cz)/sz)**2)
    def F(u,z):
        x=u*hw(z)
        f=0.19-0.075*u*u
        f-=0.035*max(0.0,(z-0.41)/0.06)**2
        f-=0.012*max(0.0,(0.13-z)/0.055)**2
        for k in (1,-1):
            f+=0.012*G(x,z,k*0.05,0.378,0.042,0.012)
            f-=0.02*G(x,z,k*0.052,0.335,0.03,0.018)
            f+=0.012*G(x,z,k*0.088,0.295,0.03,0.025)
            f-=0.012*G(x,z,k*0.072,0.205,0.022,0.035)
            f+=0.01*G(x,z,k*0.022,0.225,0.011,0.011)
        if z>0.2:
            prof=min(1.0,(0.355-z)/0.12) if z>0.235 else (z-0.2)/0.035
            f+=0.034*max(0.0,prof)*_m.exp(-(x/0.015)**2)
        f+=0.01*G(x,z,0,0.186,0.035,0.011)
        f-=0.014*G(x,z,0,0.169,0.042,0.0045)
        f+=0.008*G(x,z,0,0.153,0.03,0.009)
        f-=0.007*G(x,z,0,0.135,0.035,0.008)
        f+=0.016*G(x,z,0,0.1,0.034,0.025)
        return f
    YB=-0.03; front=[]; back=[]
    for j in range(NZ+1):
        z=Z0+(Z1-Z0)*j/NZ; rf=[]; rb=[]
        for i in range(NU+1):
            u=-1+2*i/NU; x=u*hw(z)
            rf.append(bm.verts.new((x,-F(u,z),z))); rb.append(bm.verts.new((x,YB,z)))
        front.append(rf); back.append(rb)
    for j in range(NZ):
        for i in range(NU):
            bm.faces.new((front[j][i],front[j][i+1],front[j+1][i+1],front[j+1][i]))
            bm.faces.new((back[j][i+1],back[j][i],back[j+1][i],back[j+1][i+1]))
        a,b_,c,d=front[j][0],front[j+1][0],back[j+1][0],back[j][0]; bm.faces.new((a,b_,c,d))
        a,b_,c,d=front[j][NU],front[j+1][NU],back[j+1][NU],back[j][NU]; bm.faces.new((d,c,b_,a))
    for i in range(NU):
        bm.faces.new((front[0][i],back[0][i],back[0][i+1],front[0][i+1]))
        bm.faces.new((front[NZ][i+1],back[NZ][i+1],back[NZ][i],front[NZ][i]))
    for f in bm.faces:
        if f not in n0: f.material_index=mat
    return F,hw
def g_head(bm,s):
    import math as _m
    # ---------- neck ----------
    cyl(bm,(0,-0.03,0.06),0.07,0.12,'Z',1,seg=24)
    for k in (1,-1):
        cyl(bm,(k*0.05,0.06,0.1),0.018,0.12,'Z',1,seg=10)
        cyl_ab(bm,(k*0.03,0.0,0.03),(k*0.045,-0.05,0.13),0.011,10,seg=10)
    # ---------- skull core + dark under-face ----------
    hull(bm,[(x,y,0.06) for x in (0.09,-0.09) for y in (-0.05,0.14)]+[(x,y,0.3) for x in (0.152,-0.152) for y in (-0.07,0.17)]+[(x,y,z) for x in (0.12,-0.12) for (y,z) in ((-0.08,0.47),(0.15,0.49))],1)
    hull(bm,[(0,-0.165,0.44),(0.11,-0.13,0.44),(-0.11,-0.13,0.44),(0.13,-0.11,0.3),(-0.13,-0.11,0.3),
             (0,-0.175,0.3),(0.08,-0.13,0.12),(-0.08,-0.13,0.12),(0,-0.16,0.08),(0.03,-0.14,0.07),(-0.03,-0.14,0.07),
             (0.12,-0.05,0.3),(-0.12,-0.05,0.3),(0.08,-0.05,0.1),(-0.08,-0.05,0.1),(0,-0.05,0.44)],1)
    # ---------- brow plate (angular, V-notched, overhangs the eyes) ----------
    for k in (1,-1):
        hull(bm,[(k*0.006,-0.186,0.43),(k*0.02,-0.19,0.442),(k*0.132,-0.132,0.44),(k*0.134,-0.148,0.385),(k*0.055,-0.2,0.365),(k*0.006,-0.207,0.372),
                 (k*0.006,-0.12,0.44),(k*0.132,-0.09,0.44),(k*0.13,-0.1,0.38),(k*0.006,-0.13,0.37)],0)
        bolt(bm,(k*0.118,-0.141,0.415),(k*0.3,-1,0.1),r=0.006)
    # ---------- eyes: glowing slits in lens housings ----------
    for k in (1,-1):
        R=Euler((0,-k*_m.radians(12),0))
        box(bm,(k*0.058,-0.172,0.334),(0.066,0.014,0.026),1,rot=R)
        box(bm,(k*0.058,-0.181,0.335),(0.052,0.008,0.009),2,rot=R)
        box(bm,(k*0.058,-0.182,0.321),(0.05,0.006,0.004),9,rot=R)
    # ---------- nose: chamfered bridge plate ----------
    hull(bm,[(0.012,-0.2,0.37),(-0.012,-0.2,0.37),(0.024,-0.214,0.255),(-0.024,-0.214,0.255),(0,-0.228,0.25),
             (0.02,-0.202,0.232),(-0.02,-0.202,0.232),(0.015,-0.16,0.37),(-0.015,-0.16,0.37),(0.024,-0.16,0.232),(-0.024,-0.16,0.232)],8)
    for k in (1,-1): box(bm,(k*0.02,-0.205,0.236),(0.012,0.006,0.006),1)
    # ---------- cheek plates ----------
    for k in (1,-1):
        hull(bm,[(k*0.062,-0.185,0.305),(k*0.118,-0.15,0.322),(k*0.134,-0.12,0.24),(k*0.1,-0.155,0.19),(k*0.07,-0.178,0.225),
                 (k*0.062,-0.14,0.3),(k*0.118,-0.1,0.32),(k*0.13,-0.08,0.24),(k*0.1,-0.11,0.19)],8)
        box(bm,(k*0.1,-0.162,0.268),(0.04,0.004,0.004),1,rot=Euler((0,k*0.5,0)))
        bolt(bm,(k*0.118,-0.139,0.3),(k*0.6,-1,0),r=0.006)
    # ---------- mouth: articulated lip plates (philtrum dip) over a dark slot ----------
    for k in (1,-1):
        hull(bm,[(k*0.004,-0.2,0.206),(k*0.012,-0.203,0.212),(k*0.052,-0.19,0.2),(k*0.056,-0.192,0.184),(k*0.004,-0.212,0.181),
                 (k*0.004,-0.15,0.21),(k*0.052,-0.15,0.2),(k*0.056,-0.15,0.18),(k*0.004,-0.15,0.18)],8)
    hull(bm,[(0.046,-0.192,0.165),(-0.046,-0.192,0.165),(0.036,-0.19,0.144),(-0.036,-0.19,0.144),(0,-0.206,0.162),(0,-0.2,0.142),
             (0.046,-0.15,0.167),(-0.046,-0.15,0.167),(0.036,-0.15,0.14),(-0.036,-0.15,0.14)],8)
    box(bm,(0,-0.178,0.173),(0.1,0.02,0.01),1)
    for k in (1,-1): cyl(bm,(k*0.057,-0.178,0.173),0.009,0.014,'X',9,seg=12)
    # ---------- chin + jaw ----------
    hull(bm,[(0.036,-0.188,0.125),(-0.036,-0.188,0.125),(0.03,-0.192,0.085),(-0.03,-0.192,0.085),(0,-0.2,0.1),
             (0.02,-0.17,0.062),(-0.02,-0.17,0.062),(0.04,-0.14,0.13),(-0.04,-0.14,0.13),(0.03,-0.13,0.065),(-0.03,-0.13,0.065)],8)
    for k in (1,-1):
        hull(bm,[(k*0.042,-0.17,0.13),(k*0.1,-0.14,0.175),(k*0.142,-0.09,0.21),(k*0.15,0.0,0.27),(k*0.14,0.06,0.27),
                 (k*0.1,0.05,0.07),(k*0.05,-0.12,0.065),(k*0.03,-0.14,0.1),(k*0.12,-0.05,0.12)],0)
        box(bm,(k*0.146,-0.03,0.2),(0.01,0.07,0.008),2,rot=Euler((0.5,0,0)))
        bolt(bm,(k*0.146,0.02,0.2),(k,0,0),r=0.008)
    # ---------- helmet dome (low, sloped for crest fold) ----------
    c=Vector((0,0.02,0.4)); rx,ry,rz=0.158,0.185,0.2; pts=[]
    for ia in range(28):
        az=2*_m.pi*ia/28
        for eld in (0,12,25,40,55,70,85):
            el=_m.radians(eld)
            p=c+Vector((rx*_m.cos(el)*_m.cos(az),ry*_m.cos(el)*_m.sin(az),rz*_m.sin(el)))
            if p.y<-0.06 and p.z<0.45: continue
            pts.append(tuple(p))
        if _m.sin(az)>0.2:
            for eld in (-20,-40):
                el=_m.radians(eld); pts.append(tuple(c+Vector((rx*_m.cos(el)*_m.cos(az),ry*_m.cos(el)*_m.sin(az),rz*_m.sin(el)))))
    hull(bm,pts,0)
    # center ridge + temple plates
    rp=[]
    for a in range(9):
        th=_m.radians(-60+a*14)
        y=c.y+ry*_m.sin(th); z=c.z+rz*_m.cos(th)
        for x in (0.022,-0.022): rp+=[(x,y,z-0.03),(x,y*1.04,z+0.012)]
    hull(bm,rp,0)
    box(bm,(0,-0.13,0.49),(0.012,0.02,0.02),2)
    for k in (1,-1):
        hull(bm,[(k*0.13,-0.1,0.44),(k*0.155,-0.02,0.44),(k*0.15,0.08,0.45),(k*0.135,-0.08,0.52),(k*0.13,0.06,0.53),
                 (k*0.1,-0.1,0.44),(k*0.1,0.06,0.5)],0)
        box(bm,(k*0.156,0.0,0.465),(0.006,0.12,0.008),2)
    # ---------- ear hubs (ride on the bay rails) + brackets ----------
    for k in (1,-1):
        joint(bm,(k*0.17,0.02,0.3),(k,0,0),0.11,0.06,0)
        for a in range(6):
            aa=a*_m.pi/3
            bolt(bm,(k*0.2,0.02+0.083*_m.cos(aa),0.3+0.083*_m.sin(aa)),(k,0,0),r=0.006)
        box(bm,(k*0.2195,0.02,0.225),(0.059,0.07,0.35),1)
        box(bm,(k*0.19,0.07,0.43),(0.12,0.04,0.04),1)
    # ---------- back modules with red caps ----------
    for k in (1,-1):
        cyl(bm,(k*0.09,0.15,0.42),0.045,0.12,'Y',1,seg=24)
        cyl(bm,(k*0.09,0.215,0.42),0.035,0.012,'Y',3,seg=24)
    # ---------- crest mount ----------
    for v in bm.verts: v.co.y+=0.03
    # ================= samurai kabuto (static parts) =================
    import math as _mk
    cy,cz,RX,RY,RZ=0.05,0.4,0.158,0.185,0.2
    for xi in (-0.105,-0.07,-0.035,0.035,0.07,0.105):
        kk=(1-(xi/RX)**2)**0.5; pts=[]
        for tdeg in range(40,171,10):
            tt=_mk.radians(tdeg); pts.append((xi,cy-RY*kk*_mk.cos(tt)*1.03,cz+RZ*kk*_mk.sin(tt)*1.03))
        for a_,b_ in zip(pts[:-1],pts[1:]): cyl_ab(bm,a_,b_,0.006,9,seg=6)
    for a in range(9):
        az=_mk.radians(15+a*18.75)
        bolt(bm,(RX*0.978*_mk.cos(az),cy+RY*0.978*_mk.sin(az),0.43),(_mk.cos(az),_mk.sin(az),0),r=0.008)
    BR=[(0.165,-0.09),(0.12,-0.175),(0.06,-0.205),(0,-0.215),(-0.06,-0.205),(-0.12,-0.175),(-0.165,-0.09)]
    hull(bm,[(x,y,z) for (x,y) in BR+[(0.12,-0.07),(0,-0.1),(-0.12,-0.07)] for z in (0.448,0.462)],0)
    for (x0,y0),(x1,y1) in zip(BR[:-1],BR[1:]): cyl_ab(bm,(x0,y0-0.002,0.455),(x1,y1-0.002,0.455),0.006,2,seg=6)
    hull(bm,[(x,y,z) for x in (0.03,-0.03) for y in (-0.105,-0.125) for z in (0.455,0.608)],0)
    box(bm,(0,-0.075,0.57),(0.04,0.07,0.02),0)
    for k in (1,-1):
        cyl(bm,(k*0.043,-0.12,0.625),0.012,0.024,'X',9,seg=12)
        box(bm,(k*0.043,-0.12,0.603),(0.026,0.02,0.02),1)
        box(bm,(k*0.035,-0.115,0.6),(0.03,0.02,0.02),1)
        cyl(bm,(k*0.162,-0.075,0.452),0.012,0.02,'Z',9,seg=12)
        box(bm,(k*0.135,-0.075,0.452),(0.06,0.014,0.016),1)
    def tier(z0,z1,r0,r1,a0=35,a1=145,n=6,mat=0):
        for i in range(n):
            A0=_mk.radians(a0+(a1-a0)*i/n); A1=_mk.radians(a0+(a1-a0)*(i+1)/n); P=[]
            for A in (A0,A1):
                for (r,z) in ((r0,z0),(r0+0.014,z0),(r1,z1),(r1+0.014,z1)):
                    P.append((r*_mk.cos(A),0.05+r*_mk.sin(A),z))
            hull(bm,P,mat)
    tier(0.37,0.285,0.166,0.172); tier(0.295,0.205,0.172,0.178); tier(0.215,0.125,0.178,0.184)
    for adeg in (60,90,120):
        A=_mk.radians(adeg)
        cyl_ab(bm,(0.181*_mk.cos(A),0.05+0.181*_mk.sin(A),0.36),(0.195*_mk.cos(A),0.05+0.195*_mk.sin(A),0.13),0.004,1,seg=6)
    # ---- battle-mask hinge knuckles on cheek plates ----
    for k in (1,-1):
        cyl(bm,(k*0.135,-0.17,0.3),0.012,0.24,'Z',9,seg=12)
        leaf(bm,(k*0.13,-0.125,0),(k*0.135,-0.17,0),0.008,0.22,0.38,1)

def g_crest(bm,s):
    cyl(bm,(0,0,0),0.025,0.08,'X',1,seg=16)
    hull(bm,[(x,y,z) for x in (0.035,-0.035) for (y,z) in ((-0.02,-0.02),(0.1,0.05),(0.25,0.03))]+[(x,y,z) for x in (0.02,-0.02) for (y,z) in ((0.4,0.21),(0.38,0.17))]+[(0,0.43,0.22)],0)
    box(bm,(0,0.18,0.06),(0.072,0.12,0.01),2,rot=Euler((0.3,0,0)))
def _nsec(tt):
    k=max(1e-3,1-tt)
    return 0.19*k**0.75, 0.17*k**0.9, 0.12*k**0.9
def g_nose(bm,s):
    # chined forebody, local +Z forward, top = -Y, bottom = +Y
    n=set(bm.faces); L=1.5; rings=[]
    for i in range(14):
        tt=(i/13)**1.15*0.985; z=tt*L; w,ht,hb=_nsec(tt)
        pts=[(w,0.015),(w*0.72,-ht*0.8),(w*0.3,-ht),(-w*0.3,-ht),(-w*0.72,-ht*0.8),(-w,0.015),(-w*0.55,hb*0.9),(0,hb),(w*0.55,hb*0.9)]
        rings.append([bm.verts.new((x,y,z)) for x,y in pts])
    for a,b in zip(rings[:-1],rings[1:]):
        for q in range(len(a)):
            bm.faces.new((a[q],a[(q+1)%len(a)],b[(q+1)%len(b)],b[q]))
    bm.faces.new(list(reversed(rings[0])))
    tip=bm.verts.new((0,0,L*1.02))
    r=rings[-1]
    for q in range(len(r)): bm.faces.new((r[q],r[(q+1)%len(r)],tip))
    for f in bm.faces:
        if f not in n: f.material_index=0
    # canopy bubble + frame
    n=set(bm.faces)
    bmesh.ops.create_uvsphere(bm,u_segments=24,v_segments=12,radius=1,matrix=T(0,-0.155,0.42)@Matrix.Diagonal((0.105,0.085,0.3,1)))
    for f in bm.faces:
        if f not in n: f.material_index=6
    box(bm,(0,-0.225,0.42),(0.015,0.03,0.5),1)
    box(bm,(0,-0.19,0.2),(0.2,0.05,0.02),1)
    # radome seam + intakes of sensors
    for k in (1,-1): box(bm,(k*0.17,0.02,0.3),(0.02,0.02,0.4),2)
    cyl_ab(bm,(0,0,1.44),(0,0,1.8),0.008,10,seg=10)
    cyl_ab(bm,(0,0,1.44),(0,0,1.5),0.02,9,seg=16)
    sph(bm,(0,-0.075,0.93),0.022,6,seg=16)
    box(bm,(0,-0.135,0.75),(0.1,0.02,0.18),1,top=(0.6,1))
    for k in (1,-1):
        cyl_ab(bm,(k*0.145,0.015,0.45),(k*0.071,0.015,1.1),0.005,1,seg=6)
    # hinge arm to chest (bottom side)
    box(bm,(0,0.26,0.0),(0.1,0.28,0.05),1)
    cyl(bm,(0,0.4,0),0.04,0.13,'X',1,seg=16)
    # gear hinge lug
    box(bm,(0,0.08,0.7),(0.08,0.035,0.08),1)
def g_ngear(bm,s):
    # stowed pose built along -Z from hinge (local origin)
    cyl(bm,(0,0,0),0.03,0.12,'X',1,seg=16)
    cyl(bm,(0,0.0,-0.17),0.022,0.34,'Z',1,seg=16)
    box(bm,(0,0.03,-0.12),(0.02,0.05,0.12),1)
    for k in (1,-1):
        cyl(bm,(k*0.05,0.0,-0.34),0.065,0.045,'X',4,seg=24)
        cyl(bm,(k*0.05,0.0,-0.34),0.03,0.05,'X',1,seg=12)
    cyl(bm,(0,0,-0.34),0.012,0.14,'X',1,seg=8)
def g_wing(bm,s):
    # inner panel (span z 0..1), chord along s*X, thickness Y
    hull(bm,[(s*x,y,0) for y in (0.05,-0.05) for x in (-0.12,0.52)]+[(s*x,y,1.0) for y in (0.035,-0.035) for x in (0.09,0.5)],0)
    box(bm,(s*0.22,0,0.5),(0.05,0.1,0.8),2)
    cyl(bm,(0,-0.07,0),0.1,0.05,'Y',1,seg=32)
    cyl(bm,(0,0.06,0),0.07,0.03,'Y',2,seg=32)
    cyl(bm,(s*0.18,0.04,1.0),0.03,0.2,'X',1,seg=16)
    for sg in (1,-1):
        cyl_ab(bm,(s*0.36,sg*0.049,0.08),(s*0.36,sg*0.036,0.93),0.004,1,seg=6)
        cyl_ab(bm,(s*0.02,sg*0.042,0.55),(s*0.46,sg*0.042,0.55),0.004,1,seg=6)
def g_wingout(bm,s):
    hull(bm,[(s*x,y,1.0) for y in (0.035,-0.035) for x in (0.09,0.67)]+[(s*x,y,2.0) for y in (0.02,-0.02) for x in (0.3,0.62)],0)
    box(bm,(s*0.45,0,1.5),(0.05,0.06,0.8),2)
    for sg in (1,-1):
        cyl_ab(bm,(s*0.25,sg*0.034,1.05),(s*0.42,sg*0.021,1.95),0.0035,1,seg=6)
        cyl_ab(bm,(s*0.15,sg*0.028,1.45),(s*0.6,sg*0.028,1.45),0.0035,1,seg=6)
    cyl(bm,(s*0.45,0.04,1.0),0.03,0.16,'X',1,seg=16)
def g_winglet(bm,s):
    sph(bm,(s*0.655,-0.335,2.0),0.02,(2 if s>0 else 3),seg=12)
    hull(bm,[(s*x,y,z) for x in (0.34,0.6) for y in (-0.02,-0.3) for z in (1.985,2.015)]+[(s*0.66,-0.34,2.0)],0)
    cyl(bm,(s*0.47,-0.01,2.0),0.025,0.26,'X',1,seg=16)
def g_slat(bm,s):
    hull(bm,[(s*x,y,z) for (x,z) in ((-0.185,0.05),(-0.125,0.05),(0.025,0.95),(0.085,0.95)) for y in (0.03,-0.03)],1)
    for zc,le in ((0.25,-0.07),(0.75,0.035)):
        box(bm,(s*(le+0.05),-0.035,zc),(0.2,0.015,0.03),1)
def g_flap(bm,s):
    hull(bm,[(s*x,y,z) for (x,z) in ((0.56,0.03),(0.72,0.03),(0.535,0.97),(0.67,0.97)) for y in (0.03,-0.03)],0)
    cyl(bm,(s*0.537,0,0.5),0.022,0.9,'Z',1,seg=16)
def g_blade(bm,s):
    hull(bm,[(s*x,y,z) for x in (0.24,0.27) for y in (-0.1,0.12) for z in (-0.12,-0.5)]+[(s*0.29,0.2,-0.08),(s*0.26,0.2,-0.08)],0)
    box(bm,(s*0.27,0.02,-0.3),(0.03,0.12,0.02),2)
    cyl(bm,(s*0.25,-0.1,-0.31),0.022,0.38,'Z',1,seg=16)
def g_shoulder(bm,s):
    cbox(bm,(s*0.2,0,0.28),(0.48,0.62,0.36),0,ch=0.09,top=(0.75,0.8))
    box(bm,(s*0.13,-0.135,0.458),(0.18,0.15,0.01),1)
    for (cx,cy,wx,wy) in ((0.13,-0.212,0.2,0.012),(0.13,-0.058,0.2,0.012),(0.035,-0.135,0.012,0.16),(0.225,-0.135,0.012,0.16)):
        box(bm,(s*cx,cy,0.462),(wx,wy,0.016),9)
    for q in range(3): box(bm,(s*(0.08+q*0.05),-0.135,0.462),(0.006,0.14,0.012),9)
    cyl(bm,(s*0.26,0.08,0.475),0.08,0.03,'Z',1,seg=6)
    cyl(bm,(s*0.26,0.08,0.745),0.065,0.51,'Z',0,r2=0.0,seg=4)
    box(bm,(s*0.2,-0.31,0.23),(0.3,0.03,0.04),2)
    cyl(bm,(s*0.12,0.15,0.475),0.05,0.03,'Z',1,seg=6)
    cyl(bm,(s*0.12,0.15,0.67),0.042,0.36,'Z',0,r2=0.0,seg=4)
    box(bm,(s*0.44,0,0.2),(0.02,0.4,0.03),2)
    cyl(bm,(-s*0.02,0,0.27),0.06,0.34,'Y',1,seg=24)
    cbox(bm,(s*0.44,0,0.1),(0.05,0.52,0.3),0,ch=0.018,bot=(1,0.8))
    bolts(bm,[(s*0.465,y,0.2) for y in (-0.2,0.0,0.2)],(s,0,0),r=0.01)
def g_upperarm(bm,s):
    joint(bm,(s*0.15,0,0),(s,0,0),0.12,0.05,0)
    box(bm,(s*0.17,0,-0.1),(0.06,0.32,0.28),0,top=(1,0.8))
    box(bm,(s*0.185,0,-0.1),(0.02,0.2,0.03),2)
    for j in range(3): box(bm,(0,-0.135,-0.2-j*0.13),(0.2,0.02,0.07),0)
    box(bm,(s*0.135,0,-0.4),(0.02,0.04,0.3),2)
    sph(bm,(0,0,0),0.17,1)
    cbox(bm,(0,0,-0.4),(0.27,0.29,0.6),0,ch=0.075,bot=(0.85,0.9))
    piston(bm,(s*0.14,0.07,-0.3),(s*0.13,0.07,-0.68),r=0.016)
    bolts(bm,[(s*0.125,-0.08,z) for z in (-0.3,-0.55)],(s,0,0),r=0.008)
    for kk in (1,-1): joint(bm,(kk*0.06,0,-0.8),(kk,0,0),0.12,0.12,1)
def g_forearm(bm,s):
    cyl(bm,(0,0,-0.58),0.13,0.06,'Z',1)
    cyl(bm,(0,0,-0.683),0.075,0.012,'Z',5,seg=32)
    cyl(bm,(0,0,-0.675),0.1,0.01,'Z',0,seg=32)
    box(bm,(-s*0.18,0,-0.25),(0.02,0.03,0.2),2)
    cyl(bm,(0,-0.13,-0.65),0.035,0.12,'X',1,seg=16)
    cbox(bm,(s*0.04,0,-0.32),(0.46,0.39,0.54),0,ch=0.1,bot=(0.86,0.86))
    # ---- missile launcher pod on back of forearm ----
    cbox(bm,(0,0.205,-0.32),(0.3,0.03,0.42),1,ch=0.01)
    for kx in (1,-1):
        cbox(bm,(kx*0.14,0.255,-0.32),(0.028,0.1,0.42),0,ch=0.01)
        joint(bm,(kx*0.157,0.255,-0.2),(kx,0,0),0.03,0.012,9,ticks=False)
        joint(bm,(kx*0.157,0.255,-0.44),(kx,0,0),0.03,0.012,9,ticks=False)
        box(bm,(kx*0.156,0.255,-0.32),(0.006,0.01,0.12),3)
    cyl_ab(bm,(-0.125,0.24,-0.49),(0.125,0.24,-0.49),0.02,10,seg=16)
    for q in range(14): cyl_ab(bm,(-0.117+q*0.018,0.24,-0.49),(-0.111+q*0.018,0.24,-0.49),0.027,10,seg=16)
    for i,x in enumerate((-0.09,-0.03,0.03,0.09)):
        a=(x,0.235,-0.43); b=(x,0.285,-0.13)
        cyl_ab(bm,a,b,0.027,8,seg=24)
        from mathutils import Vector as _V
        A=_V(a); B=_V(b); d=(B-A).normalized()
        cyl_ab(bm,B-d*0.004,B+d*0.012,0.025,8,seg=24,r2=0.018)
        box(bm,tuple(B+d*0.012+_V((0,0,0.001))),(0.004,0.02,0.004),1)
        cyl_ab(bm,A+(B-A)*0.72,A+(B-A)*0.75,0.0275,3,seg=24)
        cyl_ab(bm,A-d*0.01,A+(B-A)*0.22,0.031,1,seg=24)
        box(bm,tuple(A+(B-A)*0.35+_V((0,0.03,0))),(0.012,0.012,0.1),1,rot=Euler((-0.17,0,0)))
    for yy in (0.07,-0.07): cyl_ab(bm,(-s*0.158,yy,-0.1),(-s*0.135,yy,-0.55),0.012,10,seg=10)
    bolts(bm,[(s*0.268,y,-0.2) for y in (-0.09,0.09)]+[(s*0.247,y,-0.45) for y in (-0.05,0.05)],(s,0,0),r=0.01)
    cbox(bm,(0,-0.172,-0.3),(0.2,0.02,0.36),9,ch=0.008)
    box(bm,(s*0.258,0,-0.33),(0.02,0.05,0.3),2)
    cyl(bm,(0,0,-0.63),0.09,0.1,'Z',1)
def g_hand(bm,s):
    import math as _m
    # wrist joint + palm core
    cyl(bm,(0,0,-0.03),0.06,0.12,'X',1,seg=24)
    box(bm,(0,-0.095,-0.01),(0.05,0.08,0.04),1)
    cyl(bm,(0,-0.13,0),0.03,0.06,'X',1,seg=16)
    hull(bm,[(x,y,z) for x in (0.075,-0.075) for (y,z) in ((-0.06,-0.06),(0.07,-0.06),(-0.065,-0.25),(0.06,-0.25))],1)
    # back-of-hand armor (two layered plates)
    hull(bm,[(x,0.055,z) for x in (0.085,-0.085) for z in (-0.07,-0.24)]+[(x,0.095,z) for x in (0.07,-0.07) for z in (-0.09,-0.22)],0)
    box(bm,(0,0.098,-0.16),(0.1,0.01,0.012),2)
    box(bm,(-s*0.055,-0.07,-0.15),(0.04,0.02,0.14),0)
    # knuckle axle
    cyl(bm,(0,0.0,-0.26),0.028,0.17,'X',1,seg=16)
    # 4 fingers x 3 phalanges, slight curl
    for fi,x in enumerate((-0.058,-0.02,0.02,0.058)):
        L=(0.07,0.055,0.045); z=-0.26; y=0.0; ang=0.0
        for k,l in enumerate(L):
            ang+=_m.radians(12 if k else 6)
            dz=-_m.cos(ang)*l; dy=-_m.sin(ang)*l
            cz=z+dz/2; cy=y+dy/2
            box(bm,(x,cy,cz),(0.03,0.034,l*0.92),1,rot=Euler((-ang,0,0)))
            box(bm,(x,cy+0.012*_m.cos(ang),cz-0.012*_m.sin(ang)*0),(0.032,0.012,l*0.7),0,rot=Euler((-ang,0,0)))
            z+=dz; y+=dy
            cyl(bm,(x,y,z),0.013,0.034,'X',1,seg=10)
    # thumb: base joint on palm side, angled inward/forward
    tb=Vector((-s*0.085,-0.05,-0.1))
    cyl(bm,tuple(tb),0.025,0.05,'X',1,seg=12)
    R=Euler((0.6,0,-s*0.5))
    p=tb.copy()
    for l in (0.06,0.05):
        d=R.to_matrix()@Vector((0,0,-l))
        c=p+d/2
        box(bm,tuple(c),(0.032,0.034,l*0.92),1,rot=R)
        p=p+d; cyl(bm,tuple(p),0.013,0.034,'X',1,seg=10)
        R=Euler((R.x+0.3,R.y,R.z))
def g_thigh(bm,s):
    cbox(bm,(0,-0.22,-0.55),(0.3,0.04,0.5),0,ch=0.015,bot=(0.7,1))
    # ---- device-style front panel (screen, buttons, grille, handle rail) ----
    cbox(bm,(0,-0.25,-0.42),(0.2,0.022,0.1),1,ch=0.008)
    box(bm,(0,-0.262,-0.42),(0.16,0.006,0.065),6)
    box(bm,(0,-0.266,-0.43),(0.12,0.004,0.01),2)
    box(bm,(-0.05,-0.266,-0.405),(0.03,0.004,0.008),2)
    for zc in (-0.53,-0.6): cbox(bm,(0.035,-0.25,zc),(0.075,0.016,0.026),1,ch=0.006,rot=Euler((0,0.5,0)))
    sph(bm,(-0.065,-0.244,-0.505),0.011,2,seg=12)
    for q in range(4): box(bm,(0,-0.258,-0.64-q*0.035),(0.13,0.014,0.014),9)
    for (a,b) in (((-0.135,-0.245,-0.32),(-0.135,-0.245,-0.75)),((-0.135,-0.245,-0.32),(-0.09,-0.245,-0.32)),((-0.135,-0.245,-0.75),(-0.09,-0.245,-0.75))):
        cyl_ab(bm,a,b,0.012,1,seg=12)
    bolts(bm,[(x,-0.24,z) for x in (0.12,-0.12) for z in (-0.33,)]+[(x,-0.24,-0.77) for x in (0.08,-0.08)],(0,-1,0),r=0.009)
    box(bm,(0,-0.245,-0.7),(0.16,0.02,0.2),1)
    for j in range(2): box(bm,(-s*0.165,0,-0.45-j*0.2),(0.03,0.3,0.08),1)
    sph(bm,(0,0,0),0.16,1)
    cbox(bm,(0,0,-0.6),(0.38,0.43,0.7),0,ch=0.09,bot=(0.85,0.9))
    piston(bm,(0,0.222,-0.28),(0,0.21,-0.72),r=0.02)
    box(bm,(0,0,-0.2),(0.2,0.2,0.16),1)
    joint(bm,(s*0.19,0.05,-0.6),(s,0,0),0.06,0.06,1,ticks=False)
    box(bm,(0,-0.215,-0.45),(0.05,0.02,0.22),2)
def g_shin(bm,s):
    Hx,Hy=s*(MIS_H[0]-0.3),MIS_H[1]
    for (z0,z1,st) in ((1.24,1.29,(0.14,0.215)),(0.815,0.865,(0.14,0.18))):
        cyl(bm,(Hx,Hy,(z0+z1)/2-1.45),0.03,z1-z0,'Z',9,seg=16)
        leaf(bm,(s*st[0],st[1],0),(Hx,Hy,0),0.015,z0-1.45,z1-1.45,1)
    box(bm,(0,0.2465,1.04-1.45),(0.12,0.073,0.04),1)
    box(bm,(0,0.2665,1.18-1.45),(0.12,0.033,0.04),1)
    cbox(bm,(0,-0.22,-0.18),(0.32,0.06,0.16),0,ch=0.02,top=(0.8,0.8))
    bolts(bm,[(x,-0.251,-0.18) for x in (0.1,-0.1)],(0,-1,0),r=0.009)
    box(bm,(0,-0.245,-0.18),(0.12,0.02,0.03),2)
    for kk in (1,-1): joint(bm,(kk*0.075,0,0),(kk,0,0),0.14,0.15,1)
    box(bm,(0,0,-0.14),(0.28,0.26,0.08),1)
    cbox(bm,(s*0.05,0,-0.555),(0.52,0.49,0.79),0,ch=0.12,bot=(0.87,0.72))
    vents(bm,(-s*0.197,0.02,-0.45),0.16,0.25,5,'X',9)
    box(bm,(0,0.17,-0.92),(0.26,0.1,0.1),1)
    for z in (-0.4,-0.82):
        joint(bm,(s*0.3,0.06,z),(s,0,0),0.06,0.06,1,ticks=False)
    box(bm,(-s*0.06,-0.245,-0.3),(0.05,0.02,0.22),2)
    box(bm,(-s*0.08,-0.2,-0.72),(0.13,0.03,0.22),0,bot=(0.8,1))
    box(bm,(0,0.25,-0.15),(0.26,0.03,0.4),1)
    for k in (1,-1): box(bm,(k*0.155,0,-1.04),(0.03,0.16,0.32),1)
    cyl(bm,(0,0,-1.15),0.05,0.41,'X',1,seg=16)
def g_fin(bm,s):
    sph(bm,(0,-0.005,-0.05),0.04,9,seg=20)
    hull(bm,[(x,-0.004,z) for x in (0.03,-0.03) for z in (-0.3,0.17)]+[(x,-0.6,z) for x in (0.015,-0.015) for z in (-0.38,-0.2)],0)
def g_foot(bm,s):
    sph(bm,(0,0,0),0.12,1,seg=24)
    box(bm,(0,-0.02,-0.1),(0.16,0.12,0.14),1)
    cbox(bm,(0,-0.1,-0.2),(0.4,0.34,0.14),0,ch=0.06)
    cyl(bm,(0,-0.2,-0.06),0.13,0.5,'Y',1,seg=32)
    cyl(bm,(0,-0.2,-0.06),0.145,0.08,'Y',0,seg=32)
    cyl(bm,(0,-0.445,-0.06),0.11,0.02,'Y',5,seg=32)
    box(bm,(0,-0.12,0.0),(0.28,0.26,0.08),0,top=(0.8,0.5))
    for k in (1,-1): box(bm,(k*0.185,-0.1,-0.2),(0.02,0.24,0.06),2)
    import math as _mp
    for i in range(14):
        a=i*2*_mp.pi/14
        if _mp.sin(a)<-0.35: continue
        box(bm,(0.136*_mp.cos(a),-0.43,-0.06+0.136*_mp.sin(a)),(0.05,0.075,0.012),9,rot=Euler((0,-(a+_mp.pi/2),0)))
def g_toe(bm,s):
    cyl(bm,(0,0,0),0.05,0.3,'X',1,seg=16)
    box(bm,(0,-0.1,0),(0.34,0.2,0.12),0,top=(0.9,0.6))
    box(bm,(0,-0.19,-0.04),(0.3,0.04,0.05),1)
def g_heel(bm,s):
    cyl(bm,(0,0,0),0.05,0.24,'X',1,seg=16)
    cbox(bm,(0,-0.05,-0.25),(0.14,0.08,0.4),0,ch=0.02,bot=(1.15,1))
    box(bm,(0,-0.02,-0.05),(0.05,0.03,0.06),1)
    hull(bm,[(x,y,z) for x in (0.13,-0.13) for (y,z) in ((-0.1,-0.48),(-0.1,-0.56),(-0.015,-0.56),(-0.015,-0.43),(-0.055,-0.43))],0)
    box(bm,(0,-0.055,-0.565),(0.24,0.075,0.012),4)
    for kx in (1,-1): joint(bm,(kx*0.14,-0.055,-0.5),(kx,0,0),0.035,0.03,9,ticks=False)
    for kx in (1,-1):
        x=kx*0.105
        cyl_ab(bm,(x,-0.05,-0.07),(x,-0.05,-0.44),0.016,10,seg=12)
        cyl_ab(bm,(x,-0.05,-0.07),(x,-0.05,-0.14),0.026,1,seg=16)
        for q in range(10):
            z=-0.15-q*0.028
            cyl_ab(bm,(x,-0.05,z),(x,-0.05,z-0.009),0.036,10,seg=16)
        cyl_ab(bm,(x,-0.05,-0.43),(x,-0.05,-0.45),0.032,9,seg=16)
        box(bm,(kx*0.08,-0.05,-0.085),(0.05,0.04,0.03),1)
        box(bm,(kx*0.09,-0.05,-0.435),(0.05,0.04,0.03),1)
def g_hatch(bm,s):
    box(bm,(s*0.02,0,0.135),(0.04,0.52,0.27),0)
    box(bm,(s*0.042,0,0.2),(0.005,0.3,0.02),2)
    cyl(bm,(0,0,0),0.02,0.52,'Y',1,seg=16)
def g_core(bm,s):
    import math as _m
    cyl(bm,(0,-0.05,0),0.2,0.03,'Y',1,seg=64)
    cyl(bm,(0,-0.07,0),0.08,0.02,'Y',6,seg=48)
    cyl(bm,(0,-0.075,0),0.04,0.02,'Y',1,seg=32)
    n=set(bm.faces)
    for i in range(18):
        a=i*2*_m.pi/18
        box(bm,(0.15*_m.cos(a),-0.068,0.15*_m.sin(a)),(0.035,0.012,0.018),7,rot=Euler((0,-a,0)))
    for i in range(6):
        a=i*_m.pi/3
        box(bm,(0.105*_m.cos(a),-0.07,0.105*_m.sin(a)),(0.04,0.01,0.008),1,rot=Euler((0,-a,0)))
def g_shutter(bm,s):
    box(bm,(0,0,0),(0.36,0.08,0.5),0)
    for j in range(4): box(bm,(0,-0.045,-0.18+j*0.12),(0.3,0.01,0.03),1)
    box(bm,(-s*0.17,-0.045,0),(0.012,0.01,0.46),2)
    for zc in (-0.24,0.24): box(bm,(0,0.045,zc),(0.3,0.012,0.03),1)
def g_vent(bm,s):
    cyl(bm,(0,0,0),0.02,0.26,'X',1,seg=12)
    box(bm,(0,-0.03,-0.08),(0.26,0.05,0.16),0)
    for j in range(5): box(bm,(0,-0.058,-0.03-j*0.024),(0.22,0.01,0.008),1)
def g_finarm(bm,s):
    cyl(bm,(0,0.2,0),0.028,0.44,'Y',1,seg=20)
    cyl(bm,(0,0.03,0),0.036,0.05,'Y',9,seg=20)
def g_pecflap(bm,s):
    XH=PEC_XH; YB,YM,YF,YA=PEC_YB,PEC_YM,PEC_YF,PEC_YA
    o=(s*XH,YA,3.84)
    fb=_clipx(PEC_BACK,XH+0.05,True); ft=_clipx(PEC_TOP,XH+0.05,True)
    slab(bm,fb,YB,YM,8,0.01,s,o); slab(bm,ft,YM,YF,0,0.012,s,o)
    def L(x,y,z): return (s*x-o[0],y-o[1],z-o[2])
    cyl_ab(bm,L(0.809,YF-0.003,3.58),L(1.199,YF-0.003,4.193),0.008,2,seg=8)
    bolts(bm,[L(0.95,YM,3.62),L(1.2,YM,3.84)],(0,-1,0),r=0.01)
    bolts(bm,[L(1.05,YF,4.1),L(1.15,YF,4.3)],(0,-1,0),r=0.01)
    # pec detail (flap): ring disc, seams, vents, handle loop
    joint(bm,L(0.93,YF-0.002,3.98),(0,-1,0),0.06,0.012,1,ticks=False)
    for (a,b) in (((0.85,3.72),(1.22,4.3)),((0.8,3.9),(1.0,4.25))):
        cyl_ab(bm,L(a[0],YF-0.001,a[1]),L(b[0],YF-0.001,b[1]),0.0035,1,seg=6)
    for q in range(3): box(bm,L(0.86+q*0.018,YF-0.003,4.13),(0.008,0.006,0.04),1)
    for (a,b) in (((1.08,3.95),(1.08,4.05)),((1.08,3.95),(1.11,3.93)),((1.08,4.05),(1.11,4.07))):
        cyl_ab(bm,L(a[0],YF-0.004,a[1]),L(b[0],YF-0.004,b[1]),0.005,10,seg=8)
    for z0,z1 in ((3.555,3.735),(3.925,4.10)):
        cyl(bm,(0,0,(z0+z1)/2-3.84),0.045,z1-z0,'Z',9,seg=24)
        box(bm,(s*0.0275,-0.67-YA,(z0+z1)/2-3.84),(0.055,0.02,z1-z0),9)
def g_kuwa(bm,s):
    cyl(bm,(0,0,0),0.012,0.056,'X',9,seg=16)
    slab(bm,[(-0.028,0.0),(0.028,0.0),(0.062,0.07),(-0.062,0.07)],0.006,-0.01,0,0.004)
    cyl(bm,(0,-0.016,0.04),0.026,0.012,'Y',9,seg=24)
    cyl(bm,(0,-0.024,0.04),0.014,0.006,'Y',2,seg=16)
    for k in (1,-1): cyl(bm,(k*0.042,-0.004,0.07),0.01,0.02,'Y',9,seg=12)
HORN_K=0.85
def g_horn(bm,s):
    K=HORN_K
    for poly in ([(-0.012,-0.012),(0.03,-0.02),(0.1,0.14),(0.06,0.17),(-0.02,0.03)],[(0.06,0.17),(0.1,0.14),(0.2,0.28),(0.16,0.31)]):
        slab(bm,[(x*K,z*K) for x,z in poly],0.008,-0.008,0,0.004,s)
    cyl(bm,(0,0,0),0.012,0.024,'Y',9,seg=12)
    cyl_ab(bm,(s*0.03*K,0.009,0.02*K),(s*0.17*K,0.009,0.27*K),0.004,2,seg=6)
def g_horntip(bm,s):
    K=HORN_K; o=(s*0.16*K,-0.0095,0.31*K)
    slab(bm,[(x*K,z*K) for x,z in [(0.16,0.31),(0.2,0.28),(0.3,0.4),(0.33,0.46),(0.22,0.43),(0.15,0.36)]],0.008,-0.008,0,0.004,s,o)
    cyl_ab(bm,(s*0.19*K-o[0],0.009-o[1],0.32*K-o[2]),(s*0.3*K-o[0],0.009-o[1],0.43*K-o[2]),0.004,2,seg=6)
def g_fuki(bm,s):
    cyl(bm,(0,0,0),0.012,0.09,'Z',9,seg=12)
    d=Vector((s*0.94,0.34,0)); n=Vector((0.342*s,-0.94,0)); P=[]
    for dd,z0,z1 in ((0.008,-0.044,0.035),(0.1,-0.05,0.07),(0.19,-0.05,0.11)):
        for zz in (z0,z1):
            for tt in (0.0,0.012):
                q=d*dd+n*tt; P.append((q.x,q.y,zz))
    hull(bm,P,0)
    a=d*0.02+n*0.013; b=d*0.19+n*0.013
    cyl_ab(bm,(a.x,a.y,0.04),(b.x,b.y,0.112),0.005,9,seg=6)
    e=d*0.11+n*0.012
    cyl_ab(bm,(e.x,e.y,0.01),(e.x+n.x*0.008,e.y+n.y*0.008,0.01),0.025,2,seg=16)
def g_neckB(bm,s):
    ring(bm,(0,0),0.052,0.062,-0.15,0.15,9,seg=28); ring(bm,(0,0),0.06,0.066,0.135,0.15,1,seg=28)
def g_neckC(bm,s):
    ring(bm,(0,0),0.04,0.05,-0.15,0.15,9,seg=28); ring(bm,(0,0),0.041,0.0503,0.0,0.01,2,seg=28)
def g_neckD(bm,s):
    cyl(bm,(0,0,-0.015),0.036,0.27,'Z',10,seg=24); sph(bm,(0,0,0.145),0.04,9,seg=20)
MIS_H=(0.70,0.30); MIS_R=(0.3,0.42)
def g_mishouse(bm,s):
    import math as _m
    ox,oy,oz=s*MIS_H[0],MIS_H[1],0.95
    cx,cy=s*MIS_R[0]-ox,MIS_R[1]-oy
    ring(bm,(cx,cy),0.112,0.135,0.62-oz,1.28-oz,0,seg=40)
    cyl(bm,(cx,cy,1.29-oz),0.135,0.02,'Z',0,seg=40)
    for zc in (0.695,0.955,1.215): ring(bm,(cx,cy),0.134,0.148,zc-oz,zc+0.03-oz,1,seg=40)
    box(bm,(cx,cy+0.14,0.95-oz),(0.02,0.012,0.4),2)
    d=Vector((cx,cy,0)).normalized()
    for z0,z1 in ((0.87,1.235),(0.64,0.81)):
        cyl(bm,(0,0,(z0+z1)/2-oz),0.03,z1-z0,'Z',9,seg=16)
        _L=Vector((cx,cy,0)).length-0.12
        leaf(bm,(0,0,0),(d.x*_L,d.y*_L,0),0.015,z0-oz,z1-oz,1)
    for k in (1,-1): cyl(bm,(cx-s*0.135,cy+k*0.035,0.62-oz),0.012,0.02,'Y',9,seg=12)
def g_miscap(bm,s):
    cyl(bm,(s*0.135,0,-0.012),0.13,0.02,'Z',0,seg=40)
    cyl(bm,(s*0.135,0,-0.024),0.03,0.004,'Z',2,seg=20)
    cyl(bm,(0,0,0),0.012,0.048,'Y',9,seg=12)
def g_missile(bm,s):
    import math as _m
    cyl(bm,(0,0,0.0),0.1,0.5,'Z',0,seg=40)
    cyl(bm,(0,0,0.2825),0.1,0.065,'Z',0,r2=0.03,seg=40)
    for zc in (0.8,1.0): cyl(bm,(0,0,zc-0.95),0.104,0.012,'Z',9,seg=40)
    cyl(bm,(0,0,1.108-0.95),0.1005,0.015,'Z',2,seg=40)
    for i in range(4):
        a=i*_m.pi/2+_m.pi/4
        box(bm,(0.104*_m.cos(a),0.104*_m.sin(a),0.78-0.95),(0.008,0.01,0.12),9,rot=Euler((0,0,a)))
def g_misnozzle(bm,s):
    import math as _m
    cyl(bm,(0,0,-0.03),0.095,0.06,'Z',1,r2=0.085,seg=40)
    cyl(bm,(0,0,0.07),0.08,0.14,'Z',9,seg=32)
    ring(bm,(0,0),0.07,0.088,-0.064,-0.058,5,seg=32)
    cyl(bm,(0,0,-0.058),0.06,0.004,'Z',5,seg=24)
    for i in range(12):
        a=i*2*_m.pi/12; box(bm,(0.091*_m.cos(a),0.091*_m.sin(a),-0.03),(0.008,0.008,0.012),5,rot=Euler((0,0,a)))
def g_mask(bm,s):
    k=s; o=Vector((k*0.135,-0.17,0.3))
    def yf(x,z):
        u=x/0.13
        return -0.244+0.07*u*u+0.03*max(0.0,(0.14-z)/0.08)**2+0.012*max(0.0,(z-0.40)/0.03)**2
    def L(x,y,z): return (x-o.x,y-o.y,z-o.z)
    mp=[]
    for z in (0.425,0.39,0.34,0.28,0.21,0.15,0.1,0.075):
        w=0.125 if z>0.14 else 0.125-0.5*(0.14-z)
        for f in (0.004,0.4,0.72,1.0):
            xx=k*f*w; mp.append(L(xx,yf(xx,z),z))
        mp.append(L(k*w,-0.19,z)); mp.append(L(k*0.004,yf(0,z)+0.012,z)); mp.append(L(k*0.6*w,yf(0.6*w,z)+0.014,z))
    hull(bm,mp,8)
    def strip(path,w=0.011,out=0.0025,inn=0.007,mat=2):
        for (x0,z0),(x1,z1) in zip(path[:-1],path[1:]):
            dx,dz=x1-x0,z1-z0; l=(dx*dx+dz*dz)**0.5 or 1; px,pz=-dz/l*w/2,dx/l*w/2
            pts=[]
            for (x,z) in ((x0,z0),(x1,z1)):
                for sg in (1,-1):
                    xx,zz=x+sg*px,z+sg*pz; y=yf(xx,zz)
                    pts+=[L(k*xx,y-out,zz),L(k*xx,y+inn,zz)]
            hull(bm,pts,mat)
    # chevron glow channels (flush, inset) like the ref
    strip([(0.004,0.352),(0.055,0.352),(0.068,0.338),(0.112,0.338),(0.121,0.322)])
    strip([(0.004,0.298),(0.045,0.298),(0.062,0.28),(0.104,0.28),(0.115,0.258)])
    strip([(0.004,0.245),(0.03,0.245)],w=0.009)
    strip([(0.108,0.2),(0.112,0.15)],w=0.009)
    # dark recessed frame lines around the glow + panel break
    strip([(0.004,0.372),(0.058,0.372),(0.074,0.358),(0.122,0.358)],w=0.005,out=0.001,inn=0.006,mat=1)
    strip([(0.004,0.185),(0.07,0.185),(0.1,0.21)],w=0.005,out=0.001,inn=0.006,mat=1)
    # hinge knuckles + arm to pivot
    for z0,z1 in ((0.18,0.215),(0.385,0.42)):
        cyl(bm,(0,0,(z0+z1)/2-o.z),0.014,z1-z0,'Z',9,seg=12)
        _b=L(k*0.115,yf(0.115,0.3)+0.004,0)
        leaf(bm,(0,0,0),(_b[0],_b[1],0),0.008,z0-o.z,z1-o.z,1)
def g_wheel(bm,s):
    import math as _m
    for i in range(20):
        a=i*2*_m.pi/20
        box(bm,(0,0.185*_m.cos(a),0.185*_m.sin(a)),(0.1,0.03,0.02),4,rot=Euler((a,0,0)))
    for i in range(5):
        a=i*2*_m.pi/5
        cyl(bm,(s*0.075,0.06*_m.cos(a),0.06*_m.sin(a)),0.012,0.02,'X',2,seg=8)
    cyl(bm,(0,0,0),0.18,0.12,'X',4,seg=24)
    cyl(bm,(s*0.01,0,0),0.1,0.13,'X',1,seg=6)
    for k in range(3):
        box(bm,(s*0.068,0,0),(0.01,0.26,0.03),1,rot=Euler((k*1.047,0,0)))
def g_chestplate(bm,s):
    # hinge at outer edge; plate extends inward (-s*X)
    box(bm,(-s*0.17,-0.05,0),(0.34,0.1,0.5),0,bot=(0.8,1))
    box(bm,(-s*0.12,-0.105,0.12),(0.2,0.02,0.03),2)
    cyl(bm,(0,-0.02,0),0.035,0.5,'Z',1,seg=16)
def g_crest(bm,s):
    box(bm,(0,0.06,0.05),(0.065,0.26,0.09),0,top=(0.4,0.5),rot=Euler((0.4,0,0)))


def _arc(bm,s,r0,r1,z0,z1,a0,a1,mat,seg=None):
    import math as _m
    n=set(bm.faces); seg=seg or max(6,int(abs(a1-a0)/6))
    A=[_m.radians(a0+(a1-a0)*i/seg) for i in range(seg+1)]
    def P(r,a,z): return bm.verts.new((s*r*_m.cos(a),-r*_m.sin(a),z))
    rings=[[P(r0,a,z0),P(r1,a,z0),P(r1,a,z1),P(r0,a,z1)] for a in A]
    for a_,b_ in zip(rings[:-1],rings[1:]):
        for q in range(4): bm.faces.new((a_[q],a_[(q+1)%4],b_[(q+1)%4],b_[q]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    for f in bm.faces:
        if f not in n: f.material_index=mat
    if s<0: bmesh.ops.reverse_faces(bm,faces=[f for f in bm.faces if f not in n])
def make_shell(r,z0,z1,a0,a1,ribs=3):
    def g(bm,s):
        _arc(bm,s,r,r+0.03,z0,z1,a0,a1,0)
        for k in range(ribs):
            zc=z0+(z1-z0)*(k+0.5)/ribs
            _arc(bm,s,r+0.03,r+0.045,zc-0.02,zc+0.02,a0+4,a1-4,1)
        _arc(bm,s,r+0.03,r+0.036,(z0+z1)/2-0.004,(z0+z1)/2+0.004,a0+10,a1-10,2)
    return g
def make_rails(r,z0,z1,a0,a1,spokes,inner):
    import math as _m
    def g(bm,s):
        for z in (z0,z1):
            _arc(bm,s,r-0.03,r,z-0.015,z+0.015,a0,a1,1)
            for a in spokes:
                aa=_m.radians(a); rm=(inner+r)/2; L=r-inner
                box(bm,(s*rm*_m.cos(aa),-rm*_m.sin(aa),z),(L,0.03,0.03),1,rot=Euler((0,0,-s*aa)))
    return g

def hinge(p,R):
    p=Vector(p); return T(p)@R@T(-p)
# keys: list of (frame, kind, value): kind 'I' identity, 'F' fraction of jet basis, 'D' explicit delta (world-rest frame)
def spec():
    P=[]; M={}
    def add(n,par,h,t,rest,jet,geo,s,keys):
        d=dict(name=n,parent=par,head=Vector(h),tail=Vector(t),rest=rest,jet=jet,geo=geo,s=s,keys=keys); P.append(d); M[n]=d
    def follow(par,rest,extra=Matrix()):
        return M[par]['jet']@M[par]['rest'].inverted()@extra@rest
    add('root',None,(0,0,0),(0,0,0.6),Matrix(),Matrix(),None,0,[])
    crouch=T(0,-0.03,-0.048)
    add('pelvis','root',(0,0,2.55),(0,0,2.9),T(0,0,2.55),T(J((0,0,2.55)))@R_BODY,g_pelvis,0,
        [(8,'I',0),(18,'D',crouch),(21,'D',crouch),(33,'F',0.45),(58,'F',1.05),(66,'F',1.0)])
    add('chest','pelvis',(0,0,2.9),(0,0,4.05),T(0,0,2.9),T(0,0,3.0)@R_BODY,g_chest,0,[(1,'I',0)])
    M['pelvis']['rev']=[(150,'F',1),(172,'F',1),(200,'F',0.03),(207,'D',T(0,0,-0.16)),(211,'D',T(0,0.02,-0.22)),(220,'D',T(0,0.02,-0.22)),(236,'D',T(0,0.01,-0.05)),(250,'D',T(0,0.01,-0.05))]
    wp_=Vector((0,0,2.9)); lean=hinge(wp_,Rx(10))
    M['chest']['rev']=[(150,'I',0),(205,'I',0),(211,'D',lean),(220,'D',lean),(236,'D',hinge(wp_,Rz(7)@Rx(4))),(250,'D',hinge(wp_,Rz(7)@Rx(4)))]
    np_=Vector((0,0,4.0)); DOWN=T(0,0,-0.63)
    add('head','chest',np_,np_+Vector((0,0,0.5)),T(np_),follow('chest',T(np_),DOWN),g_head,0,
        [(38,'I',0),(48,'D',DOWN),(50,'D',T(0,0,-0.608)),(52,'D',DOWN)])
    M['head']['rev']=[(150,'D',DOWN),(184,'D',DOWN),(194,'D',T(0,0,0.02)),(197,'I',0),(205,'I',0),(211,'D',hinge(np_,Rx(-5))),(220,'D',hinge(np_,Rx(-5))),(236,'I',0),(250,'I',0)]
    HK=Vector((0,-0.12,4.625))
    def KR(a,HK=HK): return hinge(HK,Rx(-a))
    add('kuwa','head',HK,HK+Vector((0,0,0.07)),T(HK),follow('head',T(HK),KR(90)),g_kuwa,0,[(1,'I',0)])
    M['kuwa']['raw']=[(32,'I',0),(38,'D',KR(60)),(42,'D',KR(88)),(44,'D',KR(90))]
    M['kuwa']['rev']=[(150,'D',KR(90)),(198,'D',KR(90)),(203,'D',KR(40)),(207,'D',KR(-2)),(209,'I',0)]
    for s_,sx_ in ((1,'L'),(-1,'R')):
        HP=Vector((s_*0.042,-0.124,4.695))
        def HR(a,HP=HP,s_=s_): return hinge(HP,Ry(-s_*a))
        add('horn.'+sx_,'kuwa',HP,HP+Vector((0,0,0.2)),T(HP),follow('kuwa',T(HP),HR(28)),g_horn,s_,[(1,'I',0)])
        M['horn.'+sx_]['raw']=[(27,'I',0),(31,'D',HR(24)),(33,'D',HR(28))]
        M['horn.'+sx_]['rev']=[(150,'D',HR(28)),(207,'D',HR(28)),(211,'D',HR(-2)),(213,'I',0)]
        PT_=HP+Vector((s_*0.16*HORN_K,-0.0095,0.31*HORN_K)); ax=Vector((s_*0.8,0,-0.6))
        def TR(a,PT_=PT_,ax=ax,s_=s_): return T(PT_)@Matrix.Rotation(D2R*a*s_,4,ax)@T(-PT_)
        add('horntip.'+sx_,'horn.'+sx_,PT_,PT_+Vector((0,0,0.1)),T(PT_),follow('horn.'+sx_,T(PT_),TR(180)),g_horntip,s_,[(1,'I',0)])
        M['horntip.'+sx_]['raw']=[(22,'I',0),(25,'D',TR(90)),(28,'D',TR(180))]
        M['horntip.'+sx_]['rev']=[(150,'D',TR(180)),(210,'D',TR(180)),(213,'D',TR(90)),(216,'I',0)]
        FP=Vector((s_*0.162,-0.075,4.51))
        def FRz(a,FP=FP,s_=s_): return hinge(FP,Rz(s_*a))
        add('fuki.'+sx_,'head',FP,FP+Vector((0,0,0.1)),T(FP),follow('head',T(FP),FRz(70)),g_fuki,s_,[(1,'I',0)])
        M['fuki.'+sx_]['raw']=[(22,'I',0),(25,'D',FRz(60)),(28,'D',FRz(70))]
        M['fuki.'+sx_]['rev']=[(150,'D',FRz(70)),(214,'D',FRz(70)),(219,'D',FRz(-3)),(221,'I',0)]
    for nm,zc,fr in (('neckB',3.45,0.4127),('neckC',3.72,0.8413),('neckD',3.85,1.0)):
        P_=Vector((0,0,zc))
        kk=[(38,'I',0),(48,'D',T(0,0,-0.63*fr))]+([(50,'D',T(0,0,-0.608))] if fr==1.0 else [])+[(52,'D',T(0,0,-0.63*fr))]
        add(nm,'chest',P_,P_+Vector((0,0,0.1)),T(P_),follow('chest',T(P_),T(0,0,-0.63*fr)),globals()['g_'+nm],0,kk)
        M[nm]['rev']=[(150,'D',T(0,0,-0.63*fr)),(184,'D',T(0,0,-0.63*fr)),(194,'D',T(0,0,0.02*fr)),(197,'I',0)]
    for s_,sx_ in ((1,'L'),(-1,'R')):
        MV=Vector((s_*0.135,-0.17,4.3))
        def MR(a,MV=MV,s_=s_): return hinge(MV,Rz(s_*a))
        add('mask.'+sx_,'head',MV,MV+Vector((0,0,0.12)),T(MV),follow('head',T(MV)),g_mask,s_,[(1,'I',0)])
        M['mask.'+sx_]['rev']=[(150,'I',0),(210,'I',0),(213,'D',MR(4)),(217,'D',MR(100)),(225,'D',MR(100)),(229,'D',MR(6)),(231,'D',MR(1.5)),(233,'I',0)]
    cc=Vector((0,-0.40,3.62))
    add('core','chest',cc,cc+Vector((0,-0.2,0)),T(cc),follow('chest',T(cc)),g_core,1,[])
    M['core']['wheel']=[(1,0),(22,700),(34,860),(40,900),(186,900),(200,1060),(250,1900)]
    H=Vector((0,0.4,4.14)); nrest=T(0,0.8,4.14)@Rx(180)
    add('nose','chest',H,H+Vector((0,0,0.3)),nrest,follow('chest',nrest,hinge(H,Rx(180))),g_nose,0,
        [(54,'I',0),(62,'D',hinge(H,Rx(70))),(69,'D',hinge(H,Rx(140))),(75,'D',hinge(H,Rx(180))),(78,'D',hinge(H,Rx(176))),(81,'D',hinge(H,Rx(180)))])
    M['nose']['rev']=[(150,'D',hinge(H,Rx(180))),(156,'D',hinge(H,Rx(180))),(164,'D',hinge(H,Rx(115))),(172,'D',hinge(H,Rx(40))),(176,'D',hinge(H,Rx(-0.01))),(178,'D',hinge(H,Rx(3))),(180,'I',0)]
    GL=Vector((0,0.12,0.7))   # nose-local hinge
    gw=nrest@GL
    grest=nrest@T(GL)
    def dG(a): return (nrest@T(GL)@Rx(a))@grest.inverted()
    add('ngear','nose',gw,gw+Vector((0,0,0.2)),grest,follow('nose',grest),g_ngear,0,[(1,'I',0)])
    M['ngear']['rev']=[(150,'I',0)]
    M['ngear']['keys']=[(1,'I',0),(106,'I',0),(114,'D',dG(60)),(120,'D',dG(95)),(123,'D',dG(90))]
    M['ngear']['rev']=[(150,'D',dG(90)),(151,'D',dG(90)),(154,'D',dG(40)),(156,'I',0)]
    for s_,sx_ in ((1,'L'),(-1,'R')):
        hh_=Vector((s_*0.27,0,4.07)); cl=hinge(hh_,Ry(-s_*89.5))
        add('hatch.'+sx_,'chest',hh_,hh_+Vector((0,0,0.27)),T(hh_),follow('chest',T(hh_),cl),g_hatch,s_,
            [(1,'I',0),(50,'I',0),(56,'D',cl),(58,'D',hinge(hh_,Ry(-s_*87))),(60,'D',cl)])
        M['hatch.'+sx_]['rev']=[(150,'D',cl),(174,'D',cl),(179,'D',hinge(hh_,Ry(-s_*40))),(183,'I',0)]
    for s,sx in ((1,'L'),(-1,'R')):
        wp=Vector((s*0.3,0.6,3.6)); wr=T(wp)@Ry(s*25); wrI=wr.inverted()
        add('wing.'+sx,'chest',wp,(wr@Vector((0,0,1.0))),wr,follow('chest',T(wp)@Ry(s*92)),g_wing,s,
            [(40,'I',0),(56,'F',1.06),(62,'F',1.0)])
        M['wing.'+sx]['rev']=[(150,'F',1),(160,'F',1),(174,'F',-0.06),(180,'I',0)]
        def hl(p,R): return hinge(Vector(p),R)          # wing-local hinge
        FOLD=lambda a: hl((0,0.04,1.0),Rx(-180+a))      # a=0 folded, 180 open
        orest=wr@FOLD(0)
        def dO(a): return (wr@FOLD(a))@orest.inverted()
        hpo=wr@Vector((s*0.3,0.04,1.0))
        add('wingout.'+sx,'wing.'+sx,hpo,hpo+(wr.to_3x3()@Vector((s*0.3,0,0))),orest,follow('wing.'+sx,wr),g_wingout,s,
            [(48,'I',0),(56,'D',dO(90)),(64,'D',dO(186)),(68,'D',dO(180))])
        M['wingout.'+sx]['rev']=[(150,'D',dO(180)),(178,'D',dO(180)),(186,'D',dO(90)),(193,'D',dO(3)),(196,'I',0)]
        WL=lambda b: hl((0,0,2.0),Rx(-90+b))
        lrest=wr@FOLD(0)@WL(0)
        def dL(b): return (wr@FOLD(0)@WL(b))@lrest.inverted()
        hpl=wr@FOLD(0)@Vector((s*0.47,0,2.0))
        add('winglet.'+sx,'wingout.'+sx,hpl,hpl+Vector((0,0,0.2)),lrest,follow('wingout.'+sx,wr@FOLD(0)),g_winglet,s,
            [(60,'I',0),(68,'D',dL(100)),(72,'D',dL(90))])
        M['winglet.'+sx]['rev']=[(150,'D',dL(90)),(154,'D',dL(90)),(160,'I',0)]
        SL=lambda k: wr@T(-s*0.08*k,0,0)@wrI
        hps=wr@Vector((s*-0.05,0,0.5))
        add('slat.'+sx,'wing.'+sx,hps,hps+Vector((0,0,0.2)),wr,follow('wing.'+sx,wr@T(-s*0.08,0,0)),g_slat,s,
            [(62,'I',0),(70,'D',SL(1.0))])
        M['slat.'+sx]['rev']=[(150,'D',SL(1.0)),(152,'D',SL(1.0)),(158,'I',0)]
        fa0=Vector((s*0.548,0,0)); fax=Vector((-s*0.025,0,1.0)).normalized()
        def FL(deg):
            R=Matrix.Rotation(D2R*deg,4,fax); return wr@T(fa0)@R@T(-fa0)@wrI
        # choose flap sign so trailing edge goes to +Y (jet down)
        test=(Matrix.Rotation(D2R*20,4,fax)@(Vector((s*0.72,0,0))-fa0))
        fs=1 if test.y>0 else -1
        hpf=wr@Vector((s*0.52,0,0.5))
        add('flap.'+sx,'wing.'+sx,hpf,hpf+Vector((0,0,0.2)),wr,follow('wing.'+sx,wr@T(fa0)@Matrix.Rotation(D2R*5*fs,4,fax)@T(-fa0)),g_flap,s,
            [(64,'I',0),(70,'D',FL(25*fs)),(78,'D',FL(25*fs)),(84,'F',1.0)])
        M['flap.'+sx]['rev']=[(150,'F',1.0),(154,'D',FL(20*fs)),(160,'I',0)]
        add('shoulder.'+sx,'chest',(s*0.8,0,3.85),(s*1.1,0,4.3),T(s*0.8,0,3.85),follow('chest',T(s*0.8,0,3.85)),g_shoulder,s,[(1,'I',0)])
        ua=Vector((s*0.95,0,3.75)); fa=Vector((s*0.95,0,2.95)); ha=Vector((s*0.95,0,2.3))
        abd=hinge(ua,Ry(-s*9)); wind=hinge(ua,Ry(-s*9)@Rx(14))
        bend=hinge(fa,Rx(-20)@Rz(s*6)); bend2=hinge(fa,Rx(-38))
        hrel=hinge(ha,Rx(-10)@Rz(s*12))
        add('upperarm.'+sx,'chest',ua,fa,T(ua),follow('chest',T(ua)),g_upperarm,s,[(1,'D',abd),(8,'D',abd),(18,'D',wind),(21,'D',wind),(40,'I',0)])
        M['upperarm.'+sx]['rev']=[(150,'I',0),(190,'I',0),(204,'D',abd),(207,'D',wind),(212,'D',wind),(228,'D',abd),(250,'D',abd)]
        add('forearm.'+sx,'upperarm.'+sx,fa,ha,T(fa),follow('upperarm.'+sx,T(fa)),g_forearm,s,[(1,'D',bend),(8,'D',bend),(18,'D',bend2),(21,'D',bend2),(42,'I',0)])
        M['forearm.'+sx]['rev']=[(150,'I',0),(192,'I',0),(206,'D',bend),(209,'D',bend2),(214,'D',bend2),(230,'D',bend),(250,'D',bend)]
        hw=Vector((s*0.95,-0.13,2.3)); flip=hinge(hw,Rx(-180))
        add('hand.'+sx,'forearm.'+sx,ha,(s*0.95,0,1.95),T(ha),follow('forearm.'+sx,T(ha),flip),g_hand,s,
            [(1,'D',hrel),(20,'D',hrel),(34,'I',0),(42,'D',hinge(hw,Rx(-90))),(48,'D',hinge(hw,Rx(-180))),(51,'D',hinge(hw,Rx(-176))),(54,'D',flip)])
        M['hand.'+sx]['rev']=[(150,'D',flip),(158,'D',flip),(166,'D',hinge(hw,Rx(-90))),(174,'I',0),(194,'I',0),(210,'D',hrel),(250,'D',hrel)]
        bh=Vector((s*0.95+s*0.245,-0.1,2.95)); bopen=hinge(bh,Rz(-s*90))
        add('blade.'+sx,'forearm.'+sx,bh,bh+Vector((0,0,-0.3)),T(fa),follow('forearm.'+sx,T(fa),bopen),g_blade,s,
            [(50,'I',0),(58,'D',hinge(bh,Rz(-s*97))),(62,'D',bopen)])
        M['blade.'+sx]['rev']=[(150,'D',bopen),(152,'D',bopen),(160,'I',0)]
        hp=Vector((s*0.3,0,2.45)); kp=Vector((s*0.3,0,1.45)); ap=Vector((s*0.3,0,0.3)); fp=Vector((s*0.4,-0.235,1.0))
        add('thigh.'+sx,'pelvis',hp,kp,T(hp),follow('pelvis',T(hp),T(-s*0.08,0,0)),g_thigh,s,
            [(8,'I',0),(18,'D',hinge(hp,Rx(-12))),(21,'D',hinge(hp,Rx(-12))),(46,'F',1.04),(54,'F',1.0)])
        add('shin.'+sx,'thigh.'+sx,kp,ap,T(kp),follow('thigh.'+sx,T(kp)),g_shin,s,
            [(8,'I',0),(18,'D',hinge(kp,Rx(24))),(21,'D',hinge(kp,Rx(24))),(42,'I',0)])
        PT=Vector((s*0.4,-0.24,0.95)); PE=Vector((s*0.4,-0.60,0.95))
        OPL=Rx(90)@Ry(-s*90); OMID=Ry(-s*90)
        def DF(O,P,PT=PT): return T(P)@O@T(-PT)
        add('fin.'+sx,'shin.'+sx,PT,PT+Vector((0,-0.3,0)),T(fp),follow('shin.'+sx,T(fp),hinge(fp,Rz(s*15))),g_fin,s,
            [(1,'D',DF(OPL,PT)),(21,'D',DF(OPL,PT)),(26,'D',DF(OPL,PE)),(29,'D',DF(OMID,PE)),(32,'I',0),(32,'D',DF(Matrix(),PE)),(36,'I',0),(60,'I',0),(80,'F',1.04),(86,'F',1.0)])
        M['fin.'+sx]['keys']=[k for k in M['fin.'+sx]['keys'] if not (k[0]==32 and k[1]=='I')]
        M['fin.'+sx]['rev']=[(150,'F',1),(152,'F',1),(166,'F',-0.1),(171,'I',0),(176,'D',DF(Matrix(),PE)),(190,'D',DF(Matrix(),PE)),(195,'D',DF(OMID,PE)),(200,'D',DF(OPL,PE)),(205,'D',DF(OPL,PT))]
        ap_=Vector((s*0.4,-0.24,0.95)); EXT=T(0,-0.36,0)
        add('finarm.'+sx,'shin.'+sx,ap_,ap_+Vector((0,-0.2,0)),T(ap_),follow('shin.'+sx,T(ap_)),g_finarm,s,
            [(1,'I',0),(21,'I',0),(26,'D',EXT),(32,'D',EXT),(36,'I',0)])
        M['finarm.'+sx]['rev']=[(150,'I',0),(171,'I',0),(176,'D',EXT),(200,'D',EXT),(205,'I',0)]
        add('foot.'+sx,'shin.'+sx,ap,ap+Vector((0,-0.45,-0.1)),T(ap),follow('shin.'+sx,T(ap),hinge(ap,Rx(90))),g_foot,s,
            [(8,'I',0),(18,'D',hinge(ap,Rx(-12))),(21,'D',hinge(ap,Rx(-12))),(40,'I',0),(52,'I',0),(72,'F',1.06),(78,'F',1.0)])
        tp=Vector((s*0.3,-0.25,0.1))
        add('toe.'+sx,'foot.'+sx,tp,tp+Vector((0,-0.2,0)),T(tp),follow('foot.'+sx,T(tp)),g_toe,s,[(1,'I',0)])
        M['toe.'+sx]['rev']=[(150,'I',0),(207,'D',hinge(tp,Rx(-10))),(211,'I',0)]
        hh=Vector((s*0.3,0.24,0.5)); flip=hinge(hh,Rx(168))
        add('heel.'+sx,'shin.'+sx,hh,hh+Vector((0,0,-0.4)),T(hh),follow('shin.'+sx,T(hh),flip),g_heel,s,
            [(1,'D',hinge(hh,Rx(30))),(44,'D',hinge(hh,Rx(30))),(50,'D',hinge(hh,Rx(95))),(56,'D',flip)])
        M['heel.'+sx]['rev']=[(150,'D',flip),(186,'D',flip),(192,'D',hinge(hh,Rx(95))),(198,'D',hinge(hh,Rx(26))),(201,'D',hinge(hh,Rx(30)))]
        # landing (human-like absorb)
        SPL=lambda d: Ry(-s*d)
        M['thigh.'+sx]['rev']=[(150,'F',1),(178,'F',1),(198,'F',0),(204,'D',hinge(hp,SPL(10))),(208,'D',hinge(hp,SPL(12)@Rx(-18))),(211,'D',hinge(hp,SPL(13)@Rx(-25))),(220,'D',hinge(hp,SPL(13)@Rx(-25))),(236,'D',hinge(hp,SPL(9)@Rx(-4))),(250,'D',hinge(hp,SPL(9)@Rx(-4)))]
        M['shin.'+sx]['rev']=[(150,'I',0),(200,'I',0),(207,'D',hinge(kp,Rx(34))),(211,'D',hinge(kp,Rx(46))),(220,'D',hinge(kp,Rx(46))),(236,'D',hinge(kp,Rx(8))),(250,'D',hinge(kp,Rx(8)))]
        M['foot.'+sx]['rev']=[(150,'F',1),(160,'F',1),(184,'F',-0.05),(190,'I',0),(198,'I',0),(204,'D',hinge(ap,Ry(s*10))),(207,'D',hinge(ap,Ry(s*12)@Rx(-16))),(211,'D',hinge(ap,Ry(s*13)@Rx(-21))),(220,'D',hinge(ap,Ry(s*13)@Rx(-21))),(236,'D',hinge(ap,Ry(s*9)@Rx(-4))),(250,'D',hinge(ap,Ry(s*9)@Rx(-4)))]
        ua_=Vector((s*0.95,0,3.75)); fa_=Vector((s*0.95,0,2.95))
        balance=hinge(ua_,Ry(-s*25)@Rx(-25))
        if s==1:   # left: guard up, forward
            UF=hinge(ua_,Ry(-s*16)@Rx(-38)); FF=hinge(fa_,Rx(-44)@Rz(s*10))
            balance=hinge(ua_,Ry(-s*30)@Rx(-30))
        else:      # right: low, back, ready
            UF=hinge(ua_,Ry(-s*18)@Rx(12)); FF=hinge(fa_,Rx(-28)@Rz(s*8))
            balance=hinge(ua_,Ry(-s*28)@Rx(15))
        M['upperarm.'+sx]['rev']=[(150,'I',0),(190,'I',0),(204,'D',hinge(ua_,Ry(-s*12))),(211,'D',balance),(220,'D',balance),(234,'D',UF),(240,'D',UF),(250,'D',UF)]
        M['forearm.'+sx]['rev']=[(150,'I',0),(192,'I',0),(206,'D',hinge(fa_,Rx(-20))),(211,'D',hinge(fa_,Rx(-35))),(220,'D',hinge(fa_,Rx(-35))),(234,'D',FF),(250,'D',FF)]
        PV=Vector((s*PEC_XH,PEC_YA,3.84)); PFOLD=hinge(PV,Rz(-s*180))
        def FR(a,PV=PV,s=s): return hinge(PV,Rz(-s*a))
        add('pecflap.'+sx,'chest',PV,PV+Vector((0,0,0.3)),T(PV),follow('chest',T(PV),PFOLD),g_pecflap,s,
            [(1,'I',0),(12,'I',0),(15,'D',FR(60)),(18,'D',FR(130)),(19,'D',FR(176)),(20,'D',PFOLD)])
        M['pecflap.'+sx]['rev']=[(150,'D',PFOLD),(222,'D',PFOLD),(226,'D',FR(120)),(230,'D',FR(55)),(233,'D',FR(-2)),(235,'I',0)]
        HN=Vector((s*MIS_H[0],MIS_H[1],0.95)); RP=Vector((s*MIS_R[0],MIS_R[1],0.95))
        def HS(a,HN=HN,s=s): return hinge(HN,Rz(-s*a))
        add('mishouse.'+sx,'shin.'+sx,HN,HN+Vector((0,0,0.3)),T(HN),follow('shin.'+sx,T(HN),HS(180)),g_mishouse,s,[(1,'I',0)])
        M['mishouse.'+sx]['raw']=[(40,'I',0),(46,'D',HS(90)),(51,'D',HS(184)),(53,'D',HS(180))]
        M['mishouse.'+sx]['rev']=[(150,'D',HS(180)),(199,'D',HS(180)),(205,'D',HS(90)),(210,'D',HS(4)),(212,'I',0)]
        CP=Vector((s*(MIS_R[0]-0.135),MIS_R[1],0.62))
        def CR(a,CP=CP,s=s): return hinge(CP,Ry(s*a))
        add('miscap.'+sx,'mishouse.'+sx,CP,CP+Vector((0,0.1,0)),T(CP),follow('mishouse.'+sx,T(CP),CR(108)),g_miscap,s,[(1,'I',0)])
        M['miscap.'+sx]['raw']=[(54,'I',0),(57,'D',CR(60)),(60,'D',CR(112)),(62,'D',CR(108))]
        M['miscap.'+sx]['rev']=[(150,'D',CR(108)),(164,'D',CR(108)),(168,'D',CR(40)),(170,'I',0)]
        add('missile.'+sx,'mishouse.'+sx,RP,RP+Vector((0,0,0.3)),T(RP),follow('mishouse.'+sx,T(RP),T(0,0,-0.3)),g_missile,s,[(1,'I',0)])
        M['missile.'+sx]['raw']=[(60,'I',0),(68,'D',T(0,0,-0.31)),(70,'D',T(0,0,-0.3))]
        M['missile.'+sx]['rev']=[(150,'D',T(0,0,-0.3)),(156,'D',T(0,0,-0.3)),(164,'I',0)]
        NP=Vector((s*MIS_R[0],MIS_R[1],0.70))
        add('misnozzle.'+sx,'missile.'+sx,NP,NP+Vector((0,0,-0.15)),T(NP),follow('missile.'+sx,T(NP),T(0,0,-0.1)),g_misnozzle,s,[(1,'I',0)])
        M['misnozzle.'+sx]['raw']=[(70,'I',0),(76,'D',T(0,0,-0.1))]
        M['misnozzle.'+sx]['rev']=[(150,'D',T(0,0,-0.1)),(152,'D',T(0,0,-0.1)),(156,'I',0)]
        # --- secondary layer ---
        for wn,par,c in (('wheelT','thigh',(s*0.555,0.05,1.85)),('wheelS1','shin',(s*0.675,0.06,1.05)),('wheelS2','shin',(s*0.675,0.06,0.63))):
            c=Vector(c)
            add(wn+'.'+sx,par+'.'+sx,c,c+Vector((s*0.2,0,0)),T(c),follow(par+'.'+sx,T(c)),g_wheel,s,[])
            M[wn+'.'+sx]['wheel']=[(18,0),(90,1080),(160,1080),(216,0)]
        sc_=Vector((s*0.385,-0.53,3.62)); SH=T(-s*0.2,0,0)
        add('chestplate.'+sx,'chest',sc_,sc_+Vector((0,0,0.25)),T(sc_),follow('chest',T(sc_),SH),g_shutter,s,
            [(34,'I',0),(40,'D',T(-s*0.12,0,0)),(42,'D',T(-s*0.11,0,0)),(46,'D',SH)])
        M['chestplate.'+sx]['rev']=[(150,'D',SH),(186,'D',SH),(190,'D',T(-s*0.11,0,0)),(193,'D',T(-s*0.12,0,0)),(198,'I',0)]
        vh=Vector((s*0.3,-0.44,4.04)); vcl=hinge(vh,Rx(-28))
        add('vent.'+sx,'chest',vh,vh+Vector((0,0,-0.16)),T(vh),follow('chest',T(vh),vcl),g_vent,s,
            [(44,'I',0),(50,'D',hinge(vh,Rx(-32))),(53,'D',vcl)])
        M['vent.'+sx]['rev']=[(150,'D',vcl),(182,'D',vcl),(186,'I',0)]
        sp=Vector((s*0.78,0,4.12)); lift=hinge(sp,Ry(-s*38))
        M['shoulder.'+sx]['keys']=[(16,'I',0),(24,'D',lift),(46,'D',lift),(54,'D',hinge(sp,Ry(s*3))),(58,'I',0)]
        M['shoulder.'+sx]['rev']=[(150,'I',0),(182,'I',0),(190,'D',lift),(204,'D',lift),(210,'D',hinge(sp,Ry(s*3))),(214,'I',0)]
    return P
