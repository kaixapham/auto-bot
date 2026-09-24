# Auto-bot — Transformer robot ↔ jet

Blender-built, code-generated hard-surface robot that transforms into a jet and back,
exported to glTF for a Three.js web viewer.

## Layout
- `blender/Transformer_Robot_Jet.blend` — source scene (rig, animation, VFX, SFX strips, camera/stage).
- `blender/scripts/` — the generator scripts (also stored as Text blocks inside the .blend):
  - `tf_lib.py` — all part geometry (`g_*` functions) + `spec()` = bones, rest/jet poses, keyframes per part
    (`keys` = robot→jet, `rev` = jet→robot, `raw` = extra keys, `wheel` = spin keys).
  - `tf_build.py` — builds meshes + armature (1 rigid mesh per bone, Armature modifier FIRST, then Bevel).
  - `tf_anim.py` — resolves keys to pose-bone keyframes; also jump (`JUMP`) + root motion (`RK`).
  - `tf_vfx.py` — jet flames, mach diamonds, shockwave, arm + missile thrusters.
  - `tf_stage.py` — ground, lights, camera rig. `tf_post.py` — time-shift for VFX/stage keys (run once, right after vfx+stage).
  - `tf_swap.py` — swaps in hand-made detail meshes from collection `TF_Detail` (name them `D_<bone>`).
  - `tf_check.py`, `tf_islands.py`, `tf_runcheck.py` — QA: part collisions, gaps to parent, floating islands.
- `public/models/autobot.glb` — Draco-compressed export (all parts, rig, 250-frame animation, VFX meshes).
- `public/sfx/*.mp3` + `public/anim.json` — sound cues (frame-accurate), clip ranges, fps.
- `public/textures/armor_*.png` — armor maps baked from the procedural Blender material (tileable approx., repeat 0.5/m).
- `src/main.js` — Three.js viewer: DRACO, bloom, baked armor maps, additive VFX materials, scrubber, SFX sync, camera follow.

## Rebuild order in Blender (Text Editor → run, or via MCP)
`tf_build` → `tf_anim` → `tf_vfx` → `tf_stage` → `tf_post` → `tf_swap` → save → QA (`tf_islands.islands()`, `tf_runcheck.run(frames)`).
`tf_build` recreates the rig, so `tf_anim` must always follow it.

## Hard rules from the art director (do not break)
1. **No part may float.** Every part must be physically connected to the main body at every frame
   (hinge, rail, telescoping rod, bracket…). If a detail looks detached, add a connector.
2. **No cheating**: no scaling parts to zero, no parts vanishing, no parts passing through other parts.
   Moves must be mechanically logical (slide on rails, rotate on hinges).
3. Jet form must read clearly as an aircraft (nose forward, exhausts rear), no visible robot limbs.
4. Round joints are never plain cylinders: chamfer, recess, rim lines (`joint()` helper).
5. Every change → run island + collision + gap checks across all 250 frames.

## Frame map (24 fps)
1 robot idle · 8–21 crouch · 22–35 one-leg athletic takeoff · 36–114 mid-air transform · 102 ignition ·
114–150 jet hover · 150–200 jet→robot · 205–220 landing · 213–233 battle-mask open/close reveal · 250 end.

## Known gaps / next steps
- Procedural armor (panel lines, green veins) is only approximated by the baked tile maps on the web.
- VFX node materials don't export; `main.js` replaces `VFX_*` materials with additive ones.
- Silhouette still blockier than refs; next step = replace parts with sculpted `D_<bone>` meshes via `tf_swap`.
