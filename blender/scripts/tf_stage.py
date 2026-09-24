
import bpy, math, random
from mathutils import Vector
sc=bpy.context.scene
old=bpy.data.collections.get("TF_Stage")
if old:
    for o in list(old.objects): bpy.data.objects.remove(o)
    bpy.data.collections.remove(old)
st=bpy.data.collections.new("TF_Stage"); sc.collection.children.link(st)
arm=bpy.data.objects["TF_Rig"]
# ground
me=bpy.data.meshes.new("TF_Ground"); import bmesh
bm=bmesh.new(); bmesh.ops.create_grid(bm,x_segments=1,y_segments=1,size=300); bm.to_mesh(me); bm.free()
g=bpy.data.objects.new("TF_Ground",me); st.objects.link(g); g.location=(0,4,0)
gm=bpy.data.materials.get("TF_GroundMat") or bpy.data.materials.new("TF_GroundMat"); gm.use_nodes=True
b=gm.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value=(0.02,0.021,0.024,1); b.inputs["Roughness"].default_value=0.55
me.materials.append(gm)
# lights
def light(name,typ,energy,loc,rot,color=(1,1,1),size=1):
    ld=bpy.data.lights.new(name,typ); ld.energy=energy; ld.color=color
    if typ=='AREA': ld.size=size
    if typ=='SUN': ld.angle=math.radians(3)
    o=bpy.data.objects.new(name,ld); st.objects.link(o); o.location=loc; o.rotation_euler=[math.radians(r) for r in rot]; return o
light("TF_Key",'SUN',6.0,(5,-6,10),(50,0,35),(1,0.96,0.9))
light("TF_Rim",'AREA',4000,(-4,9,6),(-60,0,200),(0.5,0.75,1.0),size=6)
light("TF_Fill",'AREA',900,(-7,-3,3),(80,0,-60),(0.8,0.85,1.0),size=5)
w=sc.world or bpy.data.worlds.new("World"); sc.world=w; w.use_nodes=True
bg=w.node_tree.nodes.get("Background")
if bg: bg.inputs["Color"].default_value=(0.05,0.06,0.08,1); bg.inputs["Strength"].default_value=1.5
old_light=bpy.data.objects.get("Light")
if old_light: old_light.hide_render=True; old_light.hide_set(True)
# camera rig
piv=bpy.data.objects.new("TF_CamPivot",None); st.objects.link(piv)
c=piv.constraints.new('COPY_LOCATION'); c.target=arm; c.subtarget='root'
tgt=bpy.data.objects.new("TF_CamTarget",None); st.objects.link(tgt)
c=tgt.constraints.new('COPY_LOCATION'); c.target=arm; c.subtarget='pelvis'; c.use_offset=True
cd=bpy.data.cameras.new("TF_Cam"); cd.lens=35; cd.clip_end=500
cam=bpy.data.objects.new("TF_Cam",cd); st.objects.link(cam); cam.parent=piv; cam.location=(0,-8.5,3.0)
tc=cam.constraints.new('TRACK_TO'); tc.target=tgt; tc.track_axis='TRACK_NEGATIVE_Z'; tc.up_axis='UP_Y'
sc.camera=cam
for fr,deg in ((1,-28),(40,10),(70,55),(100,105),(150,150),(200,290),(250,335)):
    piv.rotation_euler=(0,0,math.radians(deg)); piv.keyframe_insert("rotation_euler",frame=fr)
for fr,d in ((1,12.5),(60,12.0),(100,10.0),(150,10.0),(210,12.0),(250,12.5)):
    cam.location=(0,-d,2.4); cam.keyframe_insert("location",frame=fr)
# shake on ignition and landing
random.seed(3)
tgt.location=(0,0,0); tgt.keyframe_insert("location",frame=86)
for fr in range(88,100,1):
    a=0.12*(1-(fr-88)/12)
    tgt.location=(random.uniform(-a,a),random.uniform(-a,a),random.uniform(-a,a)); tgt.keyframe_insert("location",frame=fr)
tgt.location=(0,0,0); tgt.keyframe_insert("location",frame=100)
tgt.location=(0,0,0); tgt.keyframe_insert("location",frame=205)
for fr in range(207,215):
    a=0.07*(1-(fr-207)/8)
    tgt.location=(0,0,random.uniform(-a,a)); tgt.keyframe_insert("location",frame=fr)
tgt.location=(0,0,0); tgt.keyframe_insert("location",frame=216)
sc.render.resolution_x=1920; sc.render.resolution_y=1080; sc.render.fps=24
