
import bpy, bmesh, math, random
from mathutils import Matrix, Vector
sc=bpy.context.scene; coll=bpy.data.collections["Transformer"]
arm=bpy.data.objects["TF_Rig"]
old=bpy.data.collections.get("TF_VFX")
if old:
    for o in list(old.objects): bpy.data.objects.remove(o)
    bpy.data.collections.remove(old)
vc=bpy.data.collections.new("TF_VFX"); sc.collection.children.link(vc)

def flame_mat(name,col,strength,L):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes=True; nt=m.node_tree; nt.nodes.clear()
    o=nt.nodes.new("ShaderNodeOutputMaterial")
    tc=nt.nodes.new("ShaderNodeTexCoord"); sp=nt.nodes.new("ShaderNodeSeparateXYZ")
    mr=nt.nodes.new("ShaderNodeMapRange"); mr.clamp=True
    mr.inputs["From Min"].default_value=0.0; mr.inputs["From Max"].default_value=-L
    mr.inputs["To Min"].default_value=1.0; mr.inputs["To Max"].default_value=0.0
    pw=nt.nodes.new("ShaderNodeMath"); pw.operation='POWER'; pw.inputs[1].default_value=1.6
    em=nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value=(*col,1); em.inputs["Strength"].default_value=strength; em.name="EM"
    tr=nt.nodes.new("ShaderNodeBsdfTransparent"); mx=nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tc.outputs["Object"],sp.inputs[0]); nt.links.new(sp.outputs["Y"],mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"],pw.inputs[0]); nt.links.new(pw.outputs[0],mx.inputs[0])
    nt.links.new(tr.outputs[0],mx.inputs[1]); nt.links.new(em.outputs[0],mx.inputs[2]); nt.links.new(mx.outputs[0],o.inputs[0])
    try: m.surface_render_method='BLENDED'
    except Exception: pass
    m.use_backface_culling=False
    return m
def glow_mat(name,col,strength):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes=True; nt=m.node_tree; nt.nodes.clear()
    o=nt.nodes.new("ShaderNodeOutputMaterial"); em=nt.nodes.new("ShaderNodeEmission"); em.name="EM"
    em.inputs["Color"].default_value=(*col,1); em.inputs["Strength"].default_value=strength
    tr=nt.nodes.new("ShaderNodeBsdfTransparent"); mx=nt.nodes.new("ShaderNodeMixShader"); mx.name="MIX"
    mx.inputs[0].default_value=1.0
    nt.links.new(tr.outputs[0],mx.inputs[1]); nt.links.new(em.outputs[0],mx.inputs[2]); nt.links.new(mx.outputs[0],o.inputs[0])
    try: m.surface_render_method='BLENDED'
    except Exception: pass
    return m
M_OUT=flame_mat("VFX_FlameOuter",(1.0,0.38,0.08),25,1.5)
M_CORE=flame_mat("VFX_FlameCore",(1.0,0.85,0.6),60,0.8)
M_DIA=glow_mat("VFX_Diamond",(0.6,0.8,1.0),40)
M_RING=glow_mat("VFX_Shock",(1.0,0.7,0.4),30)

def cone_y(bm,r1,r2,y0,y1,seg=20):
    d=abs(y1-y0); c=(y0+y1)/2
    bmesh.ops.create_cone(bm,cap_ends=False,segments=seg,radius1=r1,radius2=r2,depth=d,
        matrix=Matrix.Translation((0,c,0))@Matrix.Rotation(math.pi/2,4,'X'))
def mk(name,bm,mat):
    me=bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(mat)
    ob=bpy.data.objects.new(name,me); vc.objects.link(ob); return ob

sc.frame_set(1); bpy.context.view_layer.update()
flames=[]
for s,sx in ((1,'L'),(-1,'R')):
    origin=Vector((s*0.3,-0.455,0.28))
    empty=bpy.data.objects.new("VFX_Engine."+sx,None); vc.objects.link(empty)
    empty.empty_display_type='SINGLE_ARROW'; empty.empty_display_size=0.3
    empty.parent=arm; empty.parent_type='BONE'; empty.parent_bone='foot.'+sx
    bpy.context.view_layer.update()
    empty.matrix_world=Matrix.Translation(origin)
    bm=bmesh.new(); cone_y(bm,0.13,0.02,0,-1.5); outer=mk("VFX_FlameOuter."+sx,bm,M_OUT)
    bm=bmesh.new(); cone_y(bm,0.085,0.01,0,-0.8); core=mk("VFX_FlameCore."+sx,bm,M_CORE)
    bm=bmesh.new()
    for i,y in enumerate((-0.22,-0.45,-0.7)):
        bmesh.ops.create_uvsphere(bm,u_segments=12,v_segments=6,radius=1,matrix=Matrix.Translation((0,y,0))@Matrix.Diagonal((0.06-i*0.012,0.07,0.06-i*0.012,1)))
    dia=mk("VFX_Diamonds."+sx,bm,M_DIA)
    for o in (outer,core,dia): o.parent=empty
    flames.append(empty)
# arm thrusters (wrist nozzles) -> bone-parented to forearms, flame along bone (+Y) = jet rear
for s_,sx_ in ((1,'L'),(-1,'R')):
    ae=bpy.data.objects.new("VFX_ArmEngine."+sx_,None); vc.objects.link(ae)
    ae.empty_display_type='SINGLE_ARROW'; ae.empty_display_size=0.2
    ae.parent=arm; ae.parent_type='BONE'; ae.parent_bone='forearm.'+sx_
    ae.matrix_parent_inverse=Matrix(); ae.location=(0,0.03,0); ae.rotation_euler=(0,0,math.pi)
    bm=bmesh.new(); cone_y(bm,0.075,0.012,0,-0.9); o1=mk("VFX_ArmFlame."+sx_,bm,M_OUT)
    bm=bmesh.new(); cone_y(bm,0.045,0.006,0,-0.45); o2=mk("VFX_ArmCore."+sx_,bm,M_CORE)
    for o in (o1,o2): o.parent=ae
    flames.append(ae)
# missile thrusters on the leg pods
for s_,sx_ in ((1,'L'),(-1,'R')):
    me_=bpy.data.objects.new("VFX_MisEngine."+sx_,None); vc.objects.link(me_)
    me_.empty_display_type='SINGLE_ARROW'; me_.empty_display_size=0.2
    me_.parent=arm; me_.parent_type='BONE'; me_.parent_bone='misnozzle.'+sx_
    me_.matrix_parent_inverse=Matrix(); me_.location=(0,-0.09,0); me_.rotation_euler=(0,0,math.pi)
    bm=bmesh.new(); cone_y(bm,0.07,0.01,0,-0.8); o1=mk("VFX_MisFlame."+sx_,bm,M_OUT)
    bm=bmesh.new(); cone_y(bm,0.045,0.006,0,-0.4); o2=mk("VFX_MisCore."+sx_,bm,M_CORE)
    for o in (o1,o2): o.parent=me_
    flames.append(me_)
# light
lt=bpy.data.lights.new("VFX_EngineLight",'POINT'); lt.color=(1,0.5,0.2); lt.energy=0; lt.shadow_soft_size=0.3
lo=bpy.data.objects.new("VFX_EngineLight",lt); vc.objects.link(lo)
lo.parent=flames[0]; lo.matrix_parent_inverse=Matrix(); lo.location=(-0.3,-0.4,0)
# engine anim: scale along flame (empty scale), flicker
random.seed(7)
def ek(e,fr,k):
    e.scale=(max(k,0.001)*(0.85+0.15*min(k,1)),max(k,0.001),max(k,0.001)*(0.85+0.15*min(k,1)))
    e.keyframe_insert("scale",frame=fr)
for e in flames:
    ek(e,1,0); ek(e,86,0); ek(e,90,1.7); ek(e,94,0.8); ek(e,98,1.05)
    f=100
    while f<146:
        ek(e,f,1.0+random.uniform(-0.12,0.14)); f+=2
    ek(e,148,1.0); ek(e,152,0.3); ek(e,156,0); ek(e,250,0)
def lk(fr,v): lt.energy=v; lt.keyframe_insert("energy",frame=fr)
lk(86,0); lk(90,3000); lk(95,700); f=100
while f<146: lk(f,650+random.uniform(-150,150)); f+=2
lk(150,500); lk(156,0)
# shockwave ring (world space), placed behind the exhausts at jet frame
sc.frame_set(100); bpy.context.view_layer.update()
p=(flames[0].matrix_world.to_translation()+flames[1].matrix_world.to_translation())/2
sc.frame_set(1)
bm=bmesh.new()
bmesh.ops.create_circle(bm,cap_ends=False,segments=48,radius=0.5)
geom=bmesh.ops.extrude_edge_only(bm,edges=bm.edges[:])
for v in [e for e in geom['geom'] if isinstance(e,bmesh.types.BMVert)]: v.co*=1.12
bm.faces.ensure_lookup_table()
ring=mk("VFX_Shockwave",bm,M_RING)
ring.location=p+Vector((0,-0.3,0)); ring.rotation_euler=(math.pi/2,0,0)
bm=bmesh.new(); bmesh.ops.create_uvsphere(bm,u_segments=16,v_segments=8,radius=0.4)
flash=mk("VFX_Flash",bm,glow_mat("VFX_FlashMat",(1.0,0.8,0.55),60)); flash.location=p+Vector((0,-0.2,0))
def keyobj(o,fr,sca,mix,strength):
    o.scale=(sca,sca,sca); o.keyframe_insert("scale",frame=fr)
    nt=o.data.materials[0].node_tree
    nt.nodes["MIX"].inputs[0].default_value=mix; nt.nodes["MIX"].inputs[0].keyframe_insert("default_value",frame=fr)
    nt.nodes["EM"].inputs["Strength"].default_value=strength; nt.nodes["EM"].inputs["Strength"].keyframe_insert("default_value",frame=fr)
for fr,sca,mix,st in ((88,0.01,0,0),(90,0.5,0.9,18),(95,2.6,0.45,8),(104,4.5,0,0)): keyobj(ring,fr,sca,mix,st)
for fr,sca,mix,st in ((88,0.01,0,0),(90,1.2,1,80),(93,0.7,0.5,30),(97,0.01,0,0)): keyobj(flash,fr,sca,mix,st)
# second, smaller ring for the "chiu" echo
ring2=ring.copy(); ring2.data=ring.data.copy(); ring2.animation_data_clear(); vc.objects.link(ring2); ring2.name="VFX_Shockwave2"
ring2.data.materials[0]=M_RING.copy(); ring2.location=p+Vector((0,-0.9,0))
for fr,sca,mix,st in ((91,0.01,0,0),(93,0.4,0.8,14),(99,1.9,0.4,6),(107,3.2,0,0)): keyobj(ring2,fr,sca,mix,st)
# viewport glow via compositor glare
try:
    ng=sc.compositing_node_group
    if ng is None:
        ng=bpy.data.node_groups.new("TF_Comp",'CompositorNodeTree'); sc.compositing_node_group=ng
    ng.nodes.clear()
    gi=ng.nodes.new("NodeGroupInput") if False else None
    rl=ng.nodes.new("CompositorNodeRLayers"); gl=ng.nodes.new("CompositorNodeGlare")
    gl.inputs["Type"].default_value="Bloom"; gl.inputs["Strength"].default_value=0.8; gl.inputs["Size"].default_value=0.7
    out=ng.nodes.new("NodeGroupOutput")
    if not any(i.in_out=='OUTPUT' for i in ng.interface.items_tree): ng.interface.new_socket("Image",in_out='OUTPUT',socket_type='NodeSocketColor')
    ng.links.new(rl.outputs["Image"],gl.inputs["Image"]); ng.links.new(gl.outputs["Image"],out.inputs[0])
    comp="ok"
except Exception as ex:
    comp=str(ex)
for a in bpy.context.screen.areas:
    if a.type=='VIEW_3D':
        try: a.spaces[0].shading.use_compositor='ALWAYS'
        except Exception: pass

_m=bpy.data.materials["TF_Exhaust"]; _i=_m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
for fr,v in ((1,0.6),(80,0.6),(90,18),(150,18),(162,0.6),(250,0.6)):
    _i.default_value=v; _i.keyframe_insert("default_value",frame=fr)
