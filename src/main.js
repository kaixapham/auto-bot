import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { TexturePass } from 'three/examples/jsm/postprocessing/TexturePass.js';
import { WebGLPathTracer, DenoiseMaterial } from 'three-gpu-pathtracer';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { createPanel, slider } from './panel.js';

const meta = await (await fetch('/anim.json')).json();
const FPS = meta.fps;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);
// ground fades into the background instead of ending on a hard, bright horizon
scene.fog = new THREE.Fog(0x0b0d10, 22, 70);
const pmrem = new THREE.PMREMGenerator(renderer);
// studio environment as a real cube texture: the rasterizer PMREMs it, the path tracer converts it to equirect
const studioRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
new THREE.CubeCamera(0.1, 100, studioRT).update(renderer, new RoomEnvironment());
const roomEnv = studioRT.texture;
scene.environment = roomEnv;

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 500);
camera.position.set(6, 4, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.6, 0);
controls.enableDamping = true;

const key = new THREE.DirectionalLight(0xfff4e6, 2.2); key.position.set(5, 10, 6); key.castShadow = true; scene.add(key, key.target);
const KEY_OFFSET = new THREE.Vector3(5, 10, 6);
Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
const rim = new THREE.DirectionalLight(0x88bbff, 1.4); rim.position.set(-6, 5, -8); scene.add(rim);
const hemi = new THREE.HemisphereLight(0xdde8ff, 0x202020, 0); scene.add(hemi);

// ---------- sun: directional light + disk/corona at "infinity" + screen-space lens flare ----------
const sun = new THREE.DirectionalLight(0xfff1dc, 0); sun.visible = false; scene.add(sun, sun.target);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 60 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
const sunDir = new THREE.Vector3();
const SUN_DIST = 450, DISK_FRAC = 0.1;   // disk radius as a fraction of the corona quad
const sunU = { uCol: { value: new THREE.Color(0xfff1dc) }, uInt: { value: 1 }, uCorona: { value: 1 }, uDisk: { value: DISK_FRAC } };
const sunDisk = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: sunU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 uCol; uniform float uInt, uCorona, uDisk; varying vec2 vUv;
    void main() {
      float r = length(vUv - 0.5) * 2.0;
      float disk = 1.0 - smoothstep(uDisk * 0.92, uDisk, r);
      float corona = pow(max(0.0, 1.0 - r), 4.0) * 0.9 + pow(max(0.0, 1.0 - r), 14.0) * 3.0;
      float a = atan(vUv.y - 0.5, vUv.x - 0.5);
      float rays = (0.75 + 0.25 * sin(a * 12.0) * sin(a * 7.0 + 0.6)) * pow(max(0.0, 1.0 - r), 2.0);
      vec3 c = uCol * (disk * 6.0 + (corona * 0.5 + rays * 0.2) * uCorona) * uInt;
      gl_FragColor = vec4(c, 1.0);
    }`,
}));
sunDisk.frustumCulled = false; sunDisk.renderOrder = -1; scene.add(sunDisk);

// lens flare ghosts drawn over the final image in a tiny ortho scene
const flareScene = new THREE.Scene();
const flareCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
function flareTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (kind === 'glow') { grad.addColorStop(0, '#fff'); grad.addColorStop(0.2, 'rgba(255,255,255,.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); }
  else if (kind === 'ring') { grad.addColorStop(0.7, 'rgba(255,255,255,0)'); grad.addColorStop(0.86, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { grad.addColorStop(0, 'rgba(255,255,255,.55)'); grad.addColorStop(0.75, 'rgba(255,255,255,.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); }
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const FLARE_TEX = { glow: flareTexture('glow'), ghost: flareTexture('ghost'), ring: flareTexture('ring') };
// [position along sun→centre line (0 sun, 1 centre, 2 mirrored), size (screen heights), texture, colour, alpha]
const FLARE_DEF = [
  [0, 0.55, 'glow', 0xfff4e0, 0.55], [0.35, 0.05, 'ghost', 0x9fc4ff, 0.35], [0.6, 0.09, 'ghost', 0xffd2a0, 0.25],
  [1.15, 0.035, 'ghost', 0xb0ffd0, 0.4], [1.4, 0.16, 'ring', 0x8fb8ff, 0.18], [1.7, 0.07, 'ghost', 0xff9f80, 0.3], [2.0, 0.24, 'ring', 0xffe0a0, 0.12],
];
const flares = FLARE_DEF.map(([t, size, tex, col, alpha]) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: FLARE_TEX[tex], color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  flareScene.add(m); return { m, t, size, alpha };
});
// Lambert = diffuse only: the Standard floor mirrored the (very bright) studio env at grazing angles and read light grey-blue
const groundMat = new THREE.MeshLambertMaterial({ color: 0x15171b });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ---------- post ----------
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 2 });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.5, 0.85);
// very hot additive pixels overflow the half-float buffer (Inf/NaN) and bloom smears them into black blocks
const sanitize = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() { vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a); }`,
});
composer.addPass(renderPass); composer.addPass(gtao); composer.addPass(sanitize); composer.addPass(bloom);
composer.addPass(new OutputPass());
// filmic finish (display-referred): grain, vignette, chromatic aberration
const filmic = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0 }, uVig: { value: 0 }, uCA: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig, uCA; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 off = d * r2 * uCA * 0.06;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= mix(1.0, smoothstep(0.85, 0.15, r2 * 2.2), uVig);
      c += (hash(vUv * 1000.0) - 0.5) * uGrain * 0.12;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(filmic);

// ---------- path tracing ("Cycles"): three-gpu-pathtracer, progressive while nothing moves ----------
// its linear HDR output goes through the same bloom / tone mapping / filmic passes as the rasterizer
const pt = new WebGLPathTracer(renderer);
Object.assign(pt, { renderToCanvas: false, minSamples: 1, renderDelay: 0, fadeDuration: 0, dynamicLowRes: false });
pt.tiles.set(1, 1);   // whole frame per sample: more samples/sec (UI stays usable at the lower render scales)
const ptComposer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType }));
const ptTexPass = new TexturePass(null);
const denoise = new DenoiseMaterial(); denoise.toneMapped = false;
const denoisePass = new ShaderPass(denoise, 'map');
ptComposer.addPass(ptTexPass); ptComposer.addPass(denoisePass); ptComposer.addPass(sanitize); ptComposer.addPass(bloom);
ptComposer.addPass(new OutputPass()); ptComposer.addPass(filmic);
let ptReady = false, ptBuilding = false, ptBuildTimer = 0;

// ---------- textures (baked from the Blender procedural armor) ----------
const tl = new THREE.TextureLoader();
function tex(p, srgb) {
  const t = tl.load(p); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.5, 0.5);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
const armor = {
  map: tex('/textures/armor_basecolor.png', true),
  roughnessMap: tex('/textures/armor_roughness.png'),
  normalMap: tex('/textures/armor_normal.png'),
  emissiveMap: tex('/textures/armor_emission.png', true),
};

// ---------- model ----------
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
const gltf = await loader.loadAsync('/models/autobot.glb');
const model = gltf.scene; scene.add(model);

// ---------- VFX shaders (soft additive glow instead of flat unlit cones/rings) ----------
const U = {
  time: { value: 0 },
  flameInt: { value: 1 }, flameSoft: { value: 1.5 },
  flameCol: { value: new THREE.Color(0xff8a2a) }, coreCol: { value: new THREE.Color(0xfff0c8) },
  shockInt: { value: 1 }, shockCol: { value: new THREE.Color(0xffc080) },
  flashInt: { value: 1 },
};
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
const FRES = /* glsl */`
  float fres(vec3 n, vec3 v) { float l = length(n) * length(v); return l > 1e-6 ? clamp(abs(dot(n, v)) / l, 0.0, 1.0) : 0.0; }
`;
const fresnelVS = /* glsl */`
  uniform float uLen; varying vec3 vN; varying vec3 vV; varying float vT; varying vec3 vP;
  void main() {
    vP = position; vT = clamp(position.z / uLen, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz; vN = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }`;
function flameMaterial(len, core) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uLen: { value: len }, uCol: core ? U.coreCol : U.flameCol, uInt: U.flameInt, uSoft: U.flameSoft, uTime: U.time, uBoost: { value: core ? 2.2 : 1.2 } },
    vertexShader: fresnelVS,
    fragmentShader: FRES + /* glsl */`
      uniform vec3 uCol; uniform float uInt, uSoft, uTime, uBoost; varying vec3 vN; varying vec3 vV; varying float vT;
      void main() {
        float edge = pow(fres(vN, vV), uSoft);
        float fall = pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.06, vT + 0.02);
        float flick = 0.82 + 0.18 * sin(uTime * 47.0 - vT * 24.0) * sin(uTime * 23.0 + vT * 9.0);
        vec3 c = mix(uCol * 1.4, uCol * vec3(1.0, 0.55, 0.35), vT);
        gl_FragColor = vec4(c * uBoost, edge * fall * flick * uInt);
      }`,
  });
}
function shockMaterial(rIn, rOut) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uLen: { value: 1 }, uIn: { value: rIn }, uOut: { value: rOut }, uCol: U.shockCol, uInt: U.shockInt, uFade: { value: 1 } },
    vertexShader: fresnelVS,
    fragmentShader: FRES + /* glsl */`
      uniform vec3 uCol; uniform float uIn, uOut, uInt, uFade; varying vec3 vP;
      void main() {
        float t = clamp((length(vP.xz) - uIn) / max(uOut - uIn, 1e-4), 0.0, 1.0);
        float band = pow(smoothstep(0.0, 0.7, t) * smoothstep(1.0, 0.7, t), 1.5);
        float a = atan(vP.z, vP.x);
        float streak = 0.65 + 0.35 * sin(a * 37.0) * sin(a * 11.0 + 1.3);
        gl_FragColor = vec4(uCol * 1.6, band * streak * uInt * uFade);
      }`,
  });
}
function flashMaterial() {
  return new THREE.ShaderMaterial({
    ...additive, side: THREE.FrontSide,
    uniforms: { uLen: { value: 1 }, uInt: U.flashInt },
    vertexShader: fresnelVS,
    fragmentShader: FRES + /* glsl */`
      uniform float uInt; varying vec3 vN; varying vec3 vV;
      void main() { float f = pow(fres(vN, vV), 2.5); gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * 3.0, f * uInt); }`,
  });
}

const emissiveMats = new Map();   // material -> base emissiveIntensity
// every body material becomes MeshPhysicalMaterial (one shared instance per glTF material) so the
// "spacecraft" looks can use clearcoat / anisotropy / iridescence; `base` keeps the exported values
const physCache = new Map(), physMats = [];
function toPhysical(m) {
  if (!m || physCache.has(m)) return physCache.get(m) ?? m;
  let p = m;
  if (!m.isMeshPhysicalMaterial) { p = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(p, m); p.name = m.name; }
  p.userData.base = { color: p.color.clone(), roughness: p.roughness, metalness: p.metalness, clearcoat: p.clearcoat, clearcoatRoughness: p.clearcoatRoughness, env: p.envMapIntensity };
  physCache.set(m, p); physMats.push(p); return p;
}
const flames = [], shocks = [], flashes = [], engines = [];
const workbenchMat = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.55, metalness: 0 });
const bodyMeshes = [];
model.traverse(o => {
  if (!o.isMesh) return;
  // skinned parts move far from their bind pose; the cached bounds would cull them near the camera
  o.frustumCulled = false;
  o.castShadow = o.receiveShadow = true;
  if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
  if (o.name.startsWith('VFX_')) {
    o.castShadow = o.receiveShadow = false;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (/Shock/.test(o.name)) {
      const p = o.geometry.attributes.position; let rIn = Infinity, rOut = 0;
      for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); rIn = Math.min(rIn, r); rOut = Math.max(rOut, r); }
      o.material = shockMaterial(rIn, rOut); shocks.push(o);
    } else if (/Flash/.test(o.name)) { o.material = flashMaterial(); flashes.push(o); }
    else { o.material = flameMaterial(bb.max.z || 1, /Core|Diamond/.test(o.name)); flames.push(o); }
    return;
  }
  o.material = Array.isArray(o.material) ? o.material.map(toPhysical) : toPhysical(o.material);
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  mats.forEach(m => {
    if (!m) return;
    if (m.name === 'TF_Armor') {
      Object.assign(m, armor);
      m.normalScale = new THREE.Vector2(0.6, 0.6);
      m.emissive = new THREE.Color(0x40ff20); m.emissiveIntensity = 3;
      m.needsUpdate = true;
    }
    if (m.emissive && m.emissive.getHex() !== 0 && !emissiveMats.has(m)) emissiveMats.set(m, { i: m.emissiveIntensity, c: m.emissive.clone() });
  });
  o.userData.mat = o.material; bodyMeshes.push(o);
});
// engine glow lights on the main nozzles only (each point light adds per-pixel cost to every mesh),
// driven by the animated scale of the VFX empty
model.traverse(o => {
  if (/^VFX_Engine[LR]$/.test(o.name)) {
    const l = new THREE.PointLight(0xff8a3a, 0, 6, 2); l.position.set(0, 0, 0.35); o.add(l); engines.push({ o, l });
  }
});
// shockwave fade: normalise by the largest scale the clip reaches
const shockMax = {};
gltf.animations.forEach(c => c.tracks.forEach(t => {
  const m = t.name.match(/^(VFX_Shockwave\d*)\.scale$/);
  if (m) { let mx = 0; for (let i = 0; i < t.values.length; i += 3) mx = Math.max(mx, t.values[i]); shockMax[m[1]] = mx || 1; }
}));

// ---------- animation ----------
const mixer = new THREE.AnimationMixer(model);
// the glb holds the rig + VFX tracks; drive every clip on one timeline
const actions = gltf.animations.map(c => { const a = mixer.clipAction(c); a.play(); a.paused = true; return a; });
const rootBone = model.getObjectByName('root');

let playing = false, range = [meta.frameStart, meta.frameEnd], cur = meta.frameStart;
let idle = 0;   // frames since anything moved (drives the Cycles-style accumulation)
let ptSceneDirty = true;   // skinned pose / visibility changed → path tracer BVH must be rebuilt
function setFrame(f) { ptSceneDirty = true; cur = f; const t = (f - 1) / FPS; actions.forEach(a => { a.time = Math.min(t, a.getClip().duration); }); mixer.update(0); }

// ---------- render settings (Blender-like presets) ----------
const DPR = Math.min(devicePixelRatio, 1.5);
const DEFAULTS = {
  engine: 'EEVEE', view: 'AgX', exposure: 1, res: DPR,
  hdri: 'Studio', envInt: 1, envRot: 0, bgMode: 'Màu', bgBlur: 0.4, bgInt: 1, bgColor: '#0b0d10', ground: true, groundColor: '#15171b',
  keyInt: 2.2, keyColor: '#fff4e6', rimInt: 1.4, rimColor: '#88bbff', ambient: 0, shadows: true, shadowRes: 2048,
  glow: 1, glowColor: '#40ff20', armorMaps: true,
  flames: true, flameInt: 1, flameLen: 1, flameSpread: 1, flameSoft: 1.5, flameColor: '#ff8a2a', coreColor: '#fff0c8', flameLight: 1,
  shock: true, shockInt: 0.8, shockColor: '#ffc080', flash: true, flashInt: 1,
  bloom: true, bloomStr: 0.9, bloomRad: 0.5, bloomThr: 1, ao: false, aoInt: 0.8, aoRadius: 0.6,
  look: 'Gốc (Blender)', roughOff: 0, coat: 0, aniso: 0, envRefl: 1, heatTint: false, visorFilm: false,
  grain: 0, vignette: 0, chroma: 0,
  ptQuality: 'Nhanh', ptBounces: 3, ptMaxSamples: 128, ptScale: 0.5, ptFilter: 1, ptDenoise: true, ptDenoiseStr: 5,
  sun: false, sunAz: 35, sunEl: 20, sunInt: 4, sunColor: '#fff1dc', sunSize: 3, sunCorona: 1, sunDiskInt: 1, flare: true, flareInt: 1,
};
// path tracing speed/quality trade-offs (resolution dominates: 50% = 4× fewer rays per sample)
const PT_QUALITY = {
  'Nhanh': { ptScale: 0.5, ptBounces: 3, ptMaxSamples: 128, ptFilter: 1, ptDenoise: true, ptDenoiseStr: 5 },
  'Cân bằng': { ptScale: 0.75, ptBounces: 5, ptMaxSamples: 512, ptFilter: 0.6, ptDenoise: true, ptDenoiseStr: 3 },
  'Đẹp': { ptScale: 1, ptBounces: 8, ptMaxSamples: 2048, ptFilter: 0.3, ptDenoise: false, ptDenoiseStr: 2 },
};
const PRESETS = {
  EEVEE: { view: 'AgX', bloom: true, bloomStr: 0.9, bloomThr: 1, ao: false, shadowRes: 2048, envInt: 1 },
  Cycles: { view: 'AgX', bloom: false, ao: false, envInt: 1 },
  Workbench: { view: 'Standard', bloom: false, ao: true, aoInt: 1, shadowRes: 2048, envInt: 1, hdri: 'Studio', bgMode: 'Màu', bgColor: '#3d3d3d' },
};
const STORE = 'autobot-render-v2';
const S = { ...DEFAULTS };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
if (!(S.engine in PRESETS)) S.engine = 'EEVEE';
delete S.sunOrbit;   // the sun no longer orbits on its own
if (!S.ptQuality) Object.assign(S, { ptQuality: 'Nhanh' }, PT_QUALITY['Nhanh']);   // older saved state: start on the fast profile
const BUILTIN_HDRI = { Studio: roomEnv, 'Không': null };
const hdriTex = { ...BUILTIN_HDRI };
const wantedHdri = S.hdri;   // may be an imported HDRI that is restored from IndexedDB below
if (!(S.hdri in hdriTex)) S.hdri = 'Studio';
const TONE = { AgX: THREE.AgXToneMapping, Filmic: THREE.ACESFilmicToneMapping, Neutral: THREE.NeutralToneMapping, Standard: THREE.NoToneMapping };

// ---------- spacecraft material looks (after Awwwards-style hard-surface references) ----------
// per material group: color / metalness / roughness / clearcoat / anisotropy; baseMap:false drops the dark baked albedo
const MAT_GROUP = { TF_Armor: 'armor', TF_Dark: 'dark', TF_Metal: 'metal', TF_Chrome: 'chrome', TF_Glass: 'glass', TF_Exhaust: 'exhaust', TF_Rubber: 'rubber', TF_Red: 'accent' };
const LOOKS = {
  'Gốc (Blender)': {},
  'Titan xước': {
    armor: { color: '#8e9095', metalness: 0.85, roughness: 0.36, anisotropy: 0.7 },
    dark: { color: '#2c2e33', metalness: 0.8, roughness: 0.42, anisotropy: 0.5 },
    metal: { metalness: 1, roughness: 0.28, anisotropy: 0.8 }, chrome: { roughness: 0.06 },
  },
  'Gốm hull (tàu con thoi)': {
    armor: { color: '#d8d5ce', metalness: 0, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.45, baseMap: false },
    dark: { color: '#18191c', metalness: 0, roughness: 0.88 },
    metal: { metalness: 1, roughness: 0.34 }, accent: { color: '#b3342b', metalness: 0, roughness: 0.5 },
  },
  'Stealth clearcoat': {
    armor: { color: '#15171a', metalness: 0.35, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.05 },
    dark: { color: '#0c0d0f', metalness: 0.2, roughness: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.1 },
  },
  'Chrome gương': {
    armor: { color: '#dfe3ea', metalness: 1, roughness: 0.08, baseMap: false },
    dark: { color: '#5a5f68', metalness: 1, roughness: 0.16 }, metal: { metalness: 1, roughness: 0.05 },
  },
  'Anodized xanh titan': {
    armor: { color: '#3a4b5e', metalness: 0.9, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.15, anisotropy: 0.4 },
    dark: { color: '#1a1f27', metalness: 0.85, roughness: 0.35 }, metal: { metalness: 1, roughness: 0.25, anisotropy: 0.6 },
  },
};
const tmpCol = new THREE.Color();
function applyLook() {
  const look = LOOKS[S.look] || {};
  for (const m of physMats) {
    const b = m.userData.base, grp = MAT_GROUP[m.name], L = (grp && look[grp]) || {};
    const before = `${m.clearcoat > 0}|${m.anisotropy > 0}|${m.iridescence > 0}|${!!m.map}|${!!m.normalMap}`;
    m.color.copy(L.color ? tmpCol.set(L.color) : b.color);
    m.metalness = L.metalness ?? b.metalness;
    m.roughness = THREE.MathUtils.clamp((L.roughness ?? b.roughness) + S.roughOff, 0.02, 1);
    const hull = grp === 'armor' || grp === 'dark';
    m.clearcoat = Math.max(L.clearcoat ?? b.clearcoat, hull ? S.coat : 0);
    m.clearcoatRoughness = L.clearcoatRoughness ?? (b.clearcoatRoughness || 0.08);
    m.anisotropy = Math.min(1, Math.max(L.anisotropy ?? 0, hull || grp === 'metal' ? S.aniso : 0));
    m.envMapIntensity = b.env * S.envRefl;
    // heat-tinted nozzles / gold visor film: thin-film iridescence
    const heat = S.heatTint && (grp === 'exhaust' || grp === 'metal'), visor = S.visorFilm && grp === 'glass';
    m.iridescence = heat || visor ? 1 : 0;
    m.iridescenceIOR = visor ? 1.6 : 1.9;
    m.iridescenceThicknessRange = visor ? [120, 420] : [250, 750];
    if (visor) { m.metalness = 1; m.roughness = 0.04; m.color.set('#caa55a'); }
    if (m.name === 'TF_Armor') {
      const maps = S.armorMaps, albedo = maps && L.baseMap !== false;
      m.map = albedo ? armor.map : null; m.roughnessMap = maps ? armor.roughnessMap : null;
      m.normalMap = maps ? armor.normalMap : null; m.emissiveMap = maps ? armor.emissiveMap : null;
    }
    if (before !== `${m.clearcoat > 0}|${m.anisotropy > 0}|${m.iridescence > 0}|${!!m.map}|${!!m.normalMap}`) m.needsUpdate = true;
  }
}

function apply() {
  const cycles = S.engine === 'Cycles', wb = S.engine === 'Workbench';
  renderer.toneMapping = TONE[S.view]; renderer.toneMappingExposure = S.exposure;
  if (renderer.getPixelRatio() !== S.res) { renderer.setPixelRatio(S.res); composer.setPixelRatio(S.res); }
  // world
  const env = hdriTex[S.hdri];
  scene.environment = env; scene.environmentIntensity = S.envInt;
  scene.environmentRotation.y = scene.backgroundRotation.y = THREE.MathUtils.degToRad(S.envRot);
  if (S.bgMode === 'HDRI' && env) { scene.background = env; scene.backgroundBlurriness = S.bgBlur; scene.backgroundIntensity = S.bgInt; }
  else { scene.background = new THREE.Color(S.bgColor); }
  scene.fog.color.set(S.bgMode === 'HDRI' && env ? S.groundColor : S.bgColor);
  scene.fog.near = S.bgMode === 'HDRI' && env ? 1e4 : 22;
  ground.visible = S.ground; groundMat.color.set(S.groundColor);
  // lights
  key.intensity = S.keyInt; key.color.set(S.keyColor); rim.intensity = S.rimInt; rim.color.set(S.rimColor); hemi.intensity = S.ambient;
  key.castShadow = S.shadows && !S.sun;
  sun.visible = S.sun; sun.castShadow = S.shadows && S.sun; sun.intensity = S.sunInt; sun.color.set(S.sunColor);
  sunDisk.visible = S.sun; sunU.uCol.value.set(S.sunColor); sunU.uCorona.value = S.sunCorona; sunU.uInt.value = S.sunDiskInt;
  for (const l of [key, sun]) if (l.shadow.mapSize.x !== S.shadowRes) { l.shadow.mapSize.set(S.shadowRes, S.shadowRes); l.shadow.map?.dispose(); l.shadow.map = null; }
  // materials
  bodyMeshes.forEach(o => { o.material = wb ? workbenchMat : o.userData.mat; });
  emissiveMats.forEach((b, m) => {
    m.emissiveIntensity = wb ? 0 : b.i * S.glow;
    if (m.name === 'TF_Armor') m.emissive.set(S.glowColor);
  });
  applyLook();
  filmic.enabled = S.grain > 0 || S.vignette > 0 || S.chroma > 0;
  filmic.uniforms.uGrain.value = S.grain; filmic.uniforms.uVig.value = S.vignette; filmic.uniforms.uCA.value = S.chroma;
  // VFX
  U.flameInt.value = S.flameInt; U.flameSoft.value = S.flameSoft; U.flameCol.value.set(S.flameColor); U.coreCol.value.set(S.coreColor);
  flames.forEach(o => { o.visible = S.flames; o.scale.set(S.flameSpread, S.flameSpread, S.flameLen); });
  U.shockInt.value = S.shockInt; U.shockCol.value.set(S.shockColor); shocks.forEach(o => { o.visible = S.shock; });
  U.flashInt.value = S.flashInt; flashes.forEach(o => { o.visible = S.flash; });
  engines.forEach(e => e.l.color.set(S.flameColor));
  // post
  bloom.enabled = S.bloom && !wb; bloom.strength = S.bloomStr; bloom.radius = S.bloomRad; bloom.threshold = S.bloomThr;
  gtao.enabled = S.ao; gtao.blendIntensity = S.aoInt; gtao.updateGtaoMaterial({ radius: S.aoRadius });
  idle = 0;
  ptSync();
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {}
}

// ---------- persistence: imported HDRI files (IndexedDB) + named setting presets ----------
const idb = (() => {
  let dbp;
  const open = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('autobot', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('hdri');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('hdri', mode); const q = fn(t.objectStore('hdri')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
  return {
    put: (name, file) => tx('readwrite', st => st.put(file, name)).catch(() => {}),
    del: name => tx('readwrite', st => st.delete(name)).catch(() => {}),
    all: async () => { try { const db = await open(); return await new Promise(res => { const out = []; const c = db.transaction('hdri').objectStore('hdri').openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); }; c.onerror = () => res(out); }); } catch (e) { return []; } },
  };
})();
const PRESET_KEY = 'autobot-presets';
const presets = (() => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch (e) { return {}; } })();
const presetUI = { name: Object.keys(presets)[0] || '', draft: '' };
const savePresets = () => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); } catch (e) {} };
// saves under the typed name; with no name typed it overwrites the selected preset (or makes "Preset N")
function savePreset() {
  const name = (presetUI.draft || '').trim() || presetUI.name || `Preset ${Object.keys(presets).length + 1}`;
  presets[name] = { ...S }; presetUI.name = name; presetUI.draft = ''; savePresets(); panel.refresh(); panel.toast(`Đã lưu "${name}"`);
}
function loadPreset(name) {
  if (!presets[name]) return;
  Object.assign(S, DEFAULTS, presets[name]);
  if (!(S.hdri in hdriTex)) S.hdri = 'Studio';
  presetUI.name = name; apply(); panel.refresh(); panel.toast(`Đã tải "${name}"`);
}
function deletePreset() {
  const n = presetUI.name; if (!presets[n]) return;
  delete presets[n]; presetUI.name = Object.keys(presets)[0] || ''; savePresets(); panel.refresh(); panel.toast(`Đã xoá "${n}"`);
}
function exportPreset() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `autobot-render-${presetUI.name || 'settings'}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const hdriFile = { type: 'file', title: 'Import HDRI', hint: 'Kéo thả hoặc bấm · .hdr .exr .jpg .png', accept: '.hdr,.exr,.jpg,.jpeg,.png,.webp', onFile: f => loadHDRI(f) };
const panel = createPanel({
  title: 'Render', state: S, defaults: DEFAULTS, storageKey: 'autobot-panel',
  footerActions: () => [{ label: 'Save', primary: true, title: 'Lưu các setting hiện tại thành preset', onClick: () => savePreset() }],
  onChange: k => {
    if (k === 'engine') Object.assign(S, PRESETS[S.engine]);
    if (k === 'ptQuality') Object.assign(S, PT_QUALITY[S.ptQuality]);
    else if (k.startsWith?.('pt')) S.ptQuality = 'Tuỳ chỉnh';
    apply();
  },
  schema: [
    { type: 'segmented', key: 'engine', large: true, options: [{ value: 'EEVEE', label: 'EEVEE' }, { value: 'Cycles', label: 'Cycles' }, { value: 'Workbench', label: 'Workbench' }] },
    { type: 'section', title: 'Path tracing (Cycles)', open: true, controls: [
      { type: 'segmented', key: 'ptQuality', label: 'Chất lượng', options: Object.keys(PT_QUALITY), when: s => s.engine === 'Cycles' },
      { type: 'slider', key: 'ptMaxSamples', label: 'Số sample tối đa', min: 16, max: 4096, step: 16, when: s => s.engine === 'Cycles' },
      { type: 'slider', key: 'ptBounces', label: 'Số lần nảy tia (bounces)', min: 1, max: 16, step: 1, when: s => s.engine === 'Cycles' },
      { type: 'slider', key: 'ptScale', label: 'Độ phân giải render', min: 0.25, max: 1, step: 0.05, format: v => Math.round(v * 100) + '%', when: s => s.engine === 'Cycles' },
      { type: 'slider', key: 'ptFilter', label: 'Lọc đốm sáng (glossy filter)', min: 0, max: 1, step: 0.01, when: s => s.engine === 'Cycles' },
      { type: 'switch', key: 'ptDenoise', label: 'Khử nhiễu (denoise)', when: s => s.engine === 'Cycles' },
      { type: 'slider', key: 'ptDenoiseStr', label: 'Độ khử nhiễu', min: 1, max: 10, step: 0.1, when: s => s.engine === 'Cycles' && s.ptDenoise },
      { type: 'button', label: 'Bật path tracing (Cycles)', primary: true, when: s => s.engine !== 'Cycles', onClick: () => { S.engine = 'Cycles'; Object.assign(S, PRESETS.Cycles); apply(); panel.refresh(); } },
    ] },
    { type: 'section', title: 'Preset đã lưu', open: true, controls: [
      { type: 'select', label: 'Preset', key: 'name', state: presetUI, options: () => Object.keys(presets).length ? Object.keys(presets) : ['(chưa có preset)'], onPick: v => loadPreset(v) },
      { type: 'text', key: 'draft', state: presetUI, placeholder: 'Tên preset mới (để trống = ghi đè preset đang chọn)', onEnter: () => savePreset() },
      { type: 'buttons', buttons: [{ label: 'Lưu', primary: true, onClick: () => savePreset() }, { label: 'Xoá', confirm: true, confirmLabel: 'Xoá thật?', onClick: () => deletePreset() }, { label: 'Export', onClick: () => exportPreset() }] },
    ] },
    { type: 'section', title: 'Color management', controls: [
      { type: 'segmented', key: 'view', label: 'View transform', options: Object.keys(TONE) },
      { type: 'slider', key: 'exposure', label: 'Exposure', min: 0, max: 3, step: 0.01 },
    ] },
    { type: 'section', title: 'World', open: true, controls: [
      { type: 'select', key: 'hdri', label: 'HDRI', options: () => Object.keys(hdriTex) },
      hdriFile,
      { type: 'button', label: 'Xoá HDRI đang chọn', confirm: true, confirmLabel: 'Bấm lần nữa để xoá', when: s => !(s.hdri in BUILTIN_HDRI), onClick: () => deleteHDRI() },
      { type: 'slider', key: 'envInt', label: 'Strength', min: 0, max: 5, step: 0.01 },
      { type: 'slider', key: 'envRot', label: 'Rotation', min: -180, max: 180, step: 1, unit: '°' },
      { type: 'segmented', key: 'bgMode', label: 'Nền', options: [{ value: 'HDRI', label: 'HDRI' }, { value: 'Màu', label: 'Màu đơn' }] },
      { type: 'slider', key: 'bgBlur', label: 'Background blur', min: 0, max: 1, step: 0.01, when: s => s.bgMode === 'HDRI' },
      { type: 'slider', key: 'bgInt', label: 'Background strength', min: 0, max: 3, step: 0.01, when: s => s.bgMode === 'HDRI' },
      { type: 'color', key: 'bgColor', label: 'Màu nền', when: s => s.bgMode !== 'HDRI' },
      { type: 'switch', key: 'ground', label: 'Mặt đất' },
      { type: 'color', key: 'groundColor', label: 'Màu mặt đất', when: s => s.ground },
    ] },
    { type: 'section', title: 'Mặt trời', open: true, controls: [
      { type: 'switch', key: 'sun', label: 'Bật mặt trời' },
      { type: 'button', label: 'Chế độ vũ trụ (tàu ngoài không gian)', onClick: () => spaceMode() },
      { type: 'slider', key: 'sunAz', label: 'Hướng (azimuth)', min: -180, max: 180, step: 1, unit: '°', when: s => s.sun },
      { type: 'slider', key: 'sunEl', label: 'Độ cao (elevation)', min: -90, max: 90, step: 1, unit: '°', when: s => s.sun },
      { type: 'slider', key: 'sunInt', label: 'Cường độ sáng', min: 0, max: 20, step: 0.1, when: s => s.sun },
      { type: 'color', key: 'sunColor', label: 'Màu nắng', when: s => s.sun },
      { type: 'slider', key: 'sunSize', label: 'Kích thước đĩa', min: 0.3, max: 15, step: 0.1, unit: '°', when: s => s.sun },
      { type: 'slider', key: 'sunDiskInt', label: 'Độ chói đĩa', min: 0, max: 3, step: 0.01, when: s => s.sun },
      { type: 'slider', key: 'sunCorona', label: 'Quầng (corona)', min: 0, max: 3, step: 0.01, when: s => s.sun },
      { type: 'switch', key: 'flare', label: 'Lens flare', when: s => s.sun },
      { type: 'slider', key: 'flareInt', label: 'Độ sáng flare', min: 0, max: 3, step: 0.01, when: s => s.sun && s.flare },
    ] },
    { type: 'section', title: 'Đèn', controls: [
      { type: 'slider', key: 'keyInt', label: 'Key light', min: 0, max: 10, step: 0.05 },
      { type: 'color', key: 'keyColor', label: 'Màu key' },
      { type: 'slider', key: 'rimInt', label: 'Rim light', min: 0, max: 10, step: 0.05 },
      { type: 'color', key: 'rimColor', label: 'Màu rim' },
      { type: 'slider', key: 'ambient', label: 'Ambient', min: 0, max: 3, step: 0.01 },
      { type: 'switch', key: 'shadows', label: 'Bóng đổ' },
      { type: 'segmented', key: 'shadowRes', label: 'Độ nét bóng', options: [{ value: 1024, label: '1K' }, { value: 2048, label: '2K' }, { value: 4096, label: '4K' }], when: s => s.shadows },
    ] },
    { type: 'section', title: 'Vật liệu', controls: [
      { type: 'slider', key: 'glow', label: 'Glow (đèn xanh)', min: 0, max: 5, step: 0.01 },
      { type: 'color', key: 'glowColor', label: 'Màu glow' },
      { type: 'switch', key: 'armorMaps', label: 'Texture giáp' },
    ] },
    { type: 'section', title: 'Chất liệu tàu vũ trụ', open: true, controls: [
      { type: 'select', key: 'look', label: 'Bộ vật liệu', options: Object.keys(LOOKS) },
      { type: 'slider', key: 'roughOff', label: 'Độ nhám (±)', min: -0.5, max: 0.5, step: 0.01 },
      { type: 'slider', key: 'coat', label: 'Clearcoat (lớp phủ bóng)', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'aniso', label: 'Xước kim loại (anisotropy)', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'envRefl', label: 'Phản xạ môi trường', min: 0, max: 3, step: 0.01 },
      { type: 'switch', key: 'heatTint', label: 'Ống xả nhuộm nhiệt (titan cháy)' },
      { type: 'switch', key: 'visorFilm', label: 'Kính phủ vàng (visor)' },
    ] },
    { type: 'section', title: 'Lửa động cơ', controls: [
      { type: 'switch', key: 'flames', label: 'Bật lửa' },
      { type: 'slider', key: 'flameInt', label: 'Độ sáng', min: 0, max: 4, step: 0.01, when: s => s.flames },
      { type: 'slider', key: 'flameLen', label: 'Độ dài', min: 0.2, max: 4, step: 0.01, when: s => s.flames },
      { type: 'slider', key: 'flameSpread', label: 'Độ toả', min: 0.2, max: 4, step: 0.01, when: s => s.flames },
      { type: 'slider', key: 'flameSoft', label: 'Độ mềm viền', min: 0.3, max: 5, step: 0.01, when: s => s.flames },
      { type: 'color', key: 'flameColor', label: 'Màu lửa', when: s => s.flames },
      { type: 'color', key: 'coreColor', label: 'Màu lõi', when: s => s.flames },
      { type: 'slider', key: 'flameLight', label: 'Ánh sáng hắt', min: 0, max: 5, step: 0.01, when: s => s.flames },
    ] },
    { type: 'section', title: 'Shockwave & Flash', controls: [
      { type: 'switch', key: 'shock', label: 'Vòng shockwave' },
      { type: 'slider', key: 'shockInt', label: 'Độ sáng vòng', min: 0, max: 3, step: 0.01, when: s => s.shock },
      { type: 'color', key: 'shockColor', label: 'Màu vòng', when: s => s.shock },
      { type: 'switch', key: 'flash', label: 'Flash đánh lửa' },
      { type: 'slider', key: 'flashInt', label: 'Độ sáng flash', min: 0, max: 3, step: 0.01, when: s => s.flash },
    ] },
    { type: 'section', title: 'Post processing', controls: [
      { type: 'switch', key: 'bloom', label: 'Bloom' },
      { type: 'slider', key: 'bloomStr', label: 'Strength', min: 0, max: 3, step: 0.01, when: s => s.bloom },
      { type: 'slider', key: 'bloomRad', label: 'Radius', min: 0, max: 1, step: 0.01, when: s => s.bloom },
      { type: 'slider', key: 'bloomThr', label: 'Threshold', min: 0, max: 2, step: 0.01, when: s => s.bloom },
      { type: 'slider', key: 'grain', label: 'Film grain', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'chroma', label: 'Chromatic aberration', min: 0, max: 1, step: 0.01 },
      { type: 'switch', key: 'ao', label: 'Ambient occlusion' },
      { type: 'slider', key: 'aoInt', label: 'AO intensity', min: 0, max: 2, step: 0.01, when: s => s.ao },
      { type: 'slider', key: 'aoRadius', label: 'AO distance', min: 0.05, max: 2, step: 0.01, when: s => s.ao },
    ] },
    { type: 'section', title: 'Hiệu năng', controls: [
      { type: 'slider', key: 'res', label: 'Độ phân giải', min: 0.5, max: 2, step: 0.05, format: v => '×' + (+v).toFixed(2) },
    ] },
  ],
});

// one click "ship in space": sun is the only strong light, no ground, near-black ambient
function spaceMode() {
  const custom = S.hdri !== 'Studio' && S.hdri !== 'Không' && hdriTex[S.hdri];
  Object.assign(S, { sun: true, sunInt: 5, ground: false, keyInt: 0, rimInt: 0.25, ambient: 0.02, envInt: custom ? 0.35 : 0.15,
    bgMode: custom ? 'HDRI' : 'Màu', bgColor: '#000000', bgBlur: 0, bloom: true, flare: true });
  apply(); panel.refresh();
}

// jpg/png panoramas → linear float DataTexture (the path tracer builds its importance-sampling CDF from pixel data)
function ldrToData(tex) {
  const img = tex.image, w = Math.min(img.width, 4096), h = Math.round(w * img.height / img.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h * 4);
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {   // canvas rows are top-down, DataTexture rows bottom-up
    const i = (y * w + x) * 4, o = ((h - 1 - y) * w + x) * 4;
    out[o] = lin(px[i]); out[o + 1] = lin(px[i + 1]); out[o + 2] = lin(px[i + 2]); out[o + 3] = 1;
  }
  tex.dispose();
  const d = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.FloatType);
  d.colorSpace = THREE.LinearSRGBColorSpace; d.magFilter = d.minFilter = THREE.LinearFilter; d.generateMipmaps = false; d.needsUpdate = true;
  return d;
}
async function decodeHDRI(file) {
  const url = URL.createObjectURL(file), ext = file.name.split('.').pop().toLowerCase();
  try {
    const t = ext === 'hdr' ? await new HDRLoader().loadAsync(url) : ext === 'exr' ? await new EXRLoader().loadAsync(url) : ldrToData(await tl.loadAsync(url));
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  } finally { URL.revokeObjectURL(url); }
}
async function loadHDRI(file) {
  try {
    const name = file.name.replace(/\.[^.]+$/, '');
    hdriTex[name] = await decodeHDRI(file); S.hdri = name; S.bgMode = 'HDRI';
    await idb.put(name, file);
    apply(); panel.refresh(); panel.toast(`Đã import và lưu HDRI "${name}"`);
  } catch (e) { alert('Không đọc được HDRI: ' + e.message); }
}
function deleteHDRI() {
  const n = S.hdri; if (n in BUILTIN_HDRI) return;
  hdriTex[n]?.dispose(); delete hdriTex[n]; idb.del(n); S.hdri = 'Studio'; apply(); panel.refresh();
}
// restore previously imported HDRIs
idb.all().then(async list => {
  for (const [name, file] of list) { try { hdriTex[name] = await decodeHDRI(file); } catch (e) {} }
  if (wantedHdri in hdriTex) S.hdri = wantedHdri;
  if (list.length) { apply(); panel.refresh(); }
});
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadHDRI(f); });
apply();

// ---------- sound ----------
const listener = new THREE.AudioListener(); camera.add(listener);
const aload = new THREE.AudioLoader();
const buffers = {};
await Promise.all([...new Set(meta.sfx.map(c => c.file))].map(async f => { buffers[f] = await aload.loadAsync('/' + f); }));
const live = [];
function fire(c) {
  const a = new THREE.Audio(listener); a.setBuffer(buffers[c.file]); a.setVolume(c.volume);
  a.play(); live.push(a);
  const dur = (c.end - c.frame) / FPS; setTimeout(() => { try { a.stop(); } catch (e) {} }, dur * 1000);
}
addEventListener('pointerdown', () => listener.context.resume(), { once: true });

// ---------- UI ----------
const $ = id => document.getElementById(id);
const PLAY = '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M4 2.5v9l7.5-4.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M3.5 2.5h2.5v9H3.5zM8 2.5h2.5v9H8z"/></svg>';
const setPlaying = p => { playing = p; $('play').innerHTML = p ? PAUSE : PLAY; $('play').setAttribute('aria-pressed', String(p)); };
function playRange(a, b) { range = [a, b]; setFrame(a); setPlaying(true); }
$('play').onclick = () => { if (!playing && cur >= range[1]) setFrame(range[0]); setPlaying(!playing); };
$('toJet').onclick = () => playRange(...meta.clips.toJet);
$('toRobot').onclick = () => playRange(...meta.clips.toRobot);
let follow = true; $('follow').onclick = () => { follow = !follow; $('follow').setAttribute('aria-pressed', String(follow)); };
const scrub = slider({ min: meta.frameStart, max: meta.frameEnd, step: 1, get: () => cur, set: v => { setPlaying(false); setFrame(v); idle = 0; } });
$('scrub').replaceWith(scrub.el);
setPlaying(false);

// ---------- loop ----------
const clock = new THREE.Timer();
const tmp = new THREE.Vector3();
let fpsN = 0, fpsT = 0;
controls.addEventListener('change', () => { idle = 0; });
setFrame(1);
renderer.setAnimationLoop(() => {
  clock.update(); const dt = Math.min(clock.getDelta(), 0.1);
  U.time.value += dt; filmic.uniforms.uTime.value = U.time.value % 100;
  if (playing) {
    const prev = cur;
    let next = cur + dt * FPS;
    if (next >= range[1]) { next = range[1]; setPlaying(false); }
    meta.sfx.forEach(c => { if (c.frame > prev && c.frame <= next) fire(c); });
    setFrame(next);
    idle = 0;
  }
  scrub.draw(); $('frame').textContent = 'f ' + Math.round(cur);
  fpsN++; fpsT += dt; if (fpsT > 0.5) { panel.setStatus(`${Math.round(fpsN / fpsT)} fps · ${renderer.domElement.width}×${renderer.domElement.height}`); fpsN = fpsT = 0; }
  engines.forEach(e => { e.l.intensity = S.flames ? S.flameLight * 8 * Math.max(e.o.scale.x, e.o.scale.z) * S.flameInt : 0; });
  shocks.forEach(o => { const k = o.scale.x / (shockMax[o.name] || 1); o.material.uniforms.uFade.value = Math.pow(Math.max(0, 1 - k), 1.3); });
  if (rootBone) {
    rootBone.getWorldPosition(tmp);
    key.target.position.copy(tmp); key.position.copy(tmp).add(KEY_OFFSET);
    if (follow) {
      tmp.y += 2.6;
      const d = tmp.clone().sub(controls.target); controls.target.add(d.multiplyScalar(0.08)); camera.position.add(d);
    }
  }
  controls.update();
  if (S.sun) updateSun(dt);
  if (!renderPathTraced()) composer.render();
  if (S.sun && S.flare && flareVis > 0.001) { renderer.autoClear = false; renderer.render(flareScene, flareCam); renderer.autoClear = true; }
});

// ---------- path tracer scene sync ----------
// ShaderMaterial VFX can't be path traced: flames become emissive stand-ins (they light the hull), rings/flash/sun disk are hidden
const ptFlameMats = new Map();
function ptStandIn(o) {
  let m = ptFlameMats.get(o);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: 0x000000 }); ptFlameMats.set(o, m); }
  const core = /Core|Diamond/.test(o.name);
  m.emissive.set(core ? S.coreColor : S.flameColor); m.emissiveIntensity = (core ? 6 : 3) * S.flameInt;
  return m;
}
let ptVisSig = '';
const ptCamPos = new THREE.Vector3(), ptCamQuat = new THREE.Quaternion(), ptSunDir = new THREE.Vector3();
function ptVisibility() { return [S.flames, S.ground, S.engine === 'Workbench', S.look].join('|'); }
function ptBuild() {
  ptBuilding = true; panel.setSubtitle('đang dựng BVH…');
  setTimeout(() => {   // let the subtitle paint before the (blocking) BVH build
    const hide = [...shocks, ...flashes, sunDisk].filter(o => o.visible);
    const swapped = flames.map(o => [o, o.material]);
    hide.forEach(o => { o.visible = false; });
    swapped.forEach(([o]) => { o.material = ptStandIn(o); });
    try { pt.setScene(scene, camera); ptReady = true; }
    catch (e) { console.error("PT build failed: " + e.stack); ptReady = false; }
    finally {
      hide.forEach(o => { o.visible = true; });
      swapped.forEach(([o, m]) => { o.material = m; });
      ptSceneDirty = false; ptBuilding = false; ptVisSig = ptVisibility(); panel.setSubtitle('');
    }
  }, 30);
}
function ptSync() {
  if (!ptReady) return;
  flames.forEach(ptStandIn);
  pt.bounces = S.ptBounces; pt.renderScale = S.ptScale; pt.filterGlossyFactor = S.ptFilter;
  denoise.sigma = S.ptDenoiseStr; denoisePass.enabled = S.ptDenoise;
  if (ptVisibility() !== ptVisSig) { ptSceneDirty = true; return; }
  pt.updateMaterials(); pt.updateEnvironment(); pt.updateLights(); pt.reset();
}
// returns true when the path-traced image was drawn this frame
function renderPathTraced() {
  if (S.engine !== 'Cycles' || playing) return false;
  if (ptSceneDirty && !ptBuilding) {
    clearTimeout(ptBuildTimer); ptBuilding = true;
    ptBuildTimer = setTimeout(() => { ptBuilding = false; ptBuild(); }, 250);   // debounce scrubbing
  }
  if (!ptReady || ptBuilding || ptSceneDirty) return false;
  // restart accumulation only on real changes (follow-cam easing and the light rig nudge values by tiny amounts every frame)
  if (!ptCamPos.equals(camera.position) && ptCamPos.distanceToSquared(camera.position) > 1e-8 || ptCamQuat.angleTo(camera.quaternion) > 1e-5) {
    ptCamPos.copy(camera.position); ptCamQuat.copy(camera.quaternion); pt.updateCamera();
  }
  if (S.sun && ptSunDir.distanceToSquared(sunDir) > 1e-8) { ptSunDir.copy(sunDir); pt.updateLights(); }
  pt.pausePathTracing = pt.samples >= S.ptMaxSamples;
  pt.renderSample();
  if (pt.samples < 1) return false;
  ptTexPass.map = pt.target.texture;
  ptComposer.render();
  panel.setSubtitle(`${Math.floor(pt.samples)}/${S.ptMaxSamples} spp`);
  return true;
}

// ---------- sun update ----------
const rayOrigin = new THREE.Vector3(), sunNDC = new THREE.Vector3(), sphC = new THREE.Vector3(), mTmp = new THREE.Matrix4();
let flareVis = 0;
// each body part is rigid to one bone: its bind-pose bounding sphere follows that bone (cheap occluder for the flare)
const occluders = bodyMeshes.filter(o => o.isSkinnedMesh).map(o => {
  o.geometry.computeBoundingSphere();
  const bi = o.geometry.attributes.skinIndex ? o.geometry.attributes.skinIndex.getX(0) : 0;
  return { o, bone: o.skeleton.bones[bi], inv: o.skeleton.boneInverses[bi], sph: o.geometry.boundingSphere };
});
function sunOccluded() {
  rayOrigin.copy(camera.position);
  if (S.ground && sunDir.y < 0) return 1;
  for (const { o, bone, inv, sph } of occluders) {
    mTmp.multiplyMatrices(o.matrixWorld, o.bindMatrixInverse).multiply(bone.matrixWorld).multiply(inv).multiply(o.bindMatrix);
    sphC.copy(sph.center).applyMatrix4(mTmp);
    const r = sph.radius * 0.75; sphC.sub(rayOrigin);
    const tc = sphC.dot(sunDir); if (tc < 0) continue;
    if (sphC.lengthSq() - tc * tc < r * r) return 1;
  }
  return 0;
}
function updateSun(dt) {
  const az = THREE.MathUtils.degToRad(S.sunAz), el = THREE.MathUtils.degToRad(S.sunEl);
  sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  // light: aimed at the robot so its shadow frustum stays on it
  sun.position.copy(key.target.position).addScaledVector(sunDir, 25); sun.target.position.copy(key.target.position);
  // disk: pinned at a fixed distance from the camera so it behaves like it's at infinity
  sunDisk.position.copy(camera.position).addScaledVector(sunDir, SUN_DIST);
  sunDisk.quaternion.copy(camera.quaternion);
  sunDisk.scale.setScalar(SUN_DIST * Math.tan(THREE.MathUtils.degToRad(S.sunSize) / 2) / DISK_FRAC);
  // flare
  sunNDC.copy(sunDisk.position).project(camera);
  const inFront = sunNDC.z < 1 && sunDir.dot(camera.getWorldDirection(sphC)) > 0;
  const edge = Math.max(Math.abs(sunNDC.x), Math.abs(sunNDC.y));
  const target = inFront ? (1 - THREE.MathUtils.smoothstep(edge, 0.9, 1.4)) * (1 - sunOccluded()) : 0;
  flareVis += (target - flareVis) * Math.min(1, dt * 12);
  const aspect = innerWidth / innerHeight;
  flareCam.left = -aspect; flareCam.right = aspect; flareCam.updateProjectionMatrix();
  flares.forEach(f => {
    f.m.position.set(sunNDC.x * aspect * (1 - f.t), sunNDC.y * (1 - f.t), 0);
    f.m.scale.setScalar(f.size * 2);
    f.m.material.opacity = f.alpha * flareVis * S.flareInt;
  });
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); ptComposer.setSize(innerWidth, innerHeight); gtao.setSize(innerWidth, innerHeight);
  pt.updateCamera();
});
