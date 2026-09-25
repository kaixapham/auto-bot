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

// BASE_URL: '/' in dev, './' in the build so it also works from a sub-path (GitHub Pages)
const BASE = import.meta.env.BASE_URL;
// public build (VITE_VIEWER_ONLY=1): watch-only — no settings panels, everyone starts from the shipped presets.json
const VIEWER = import.meta.env.VITE_VIEWER_ONLY === '1';
if (VIEWER) document.body.classList.add('viewer-only');
// ---------- boot screen (markup in index.html): real progress from three's default loading manager ----------
const boot = { el: document.getElementById('boot'), fill: document.getElementById('boot-fill'), msg: document.getElementById('boot-msg'), pct: document.getElementById('boot-pct'),
  loaded: 0, total: 0, idle: true, waits: [], initDone: false, frames: 0, shown: true };
const bootSet = (p, m) => { if (!boot.el) return; boot.fill.style.width = Math.round(p * 100) + '%'; boot.pct.textContent = Math.round(p * 100) + '%'; if (m) boot.msg.textContent = m; };
THREE.DefaultLoadingManager.onStart = () => { boot.idle = false; };
THREE.DefaultLoadingManager.onProgress = (url, loaded, total) => {
  boot.loaded = loaded; boot.total = total; boot.idle = loaded >= total;
  if (boot.shown) bootSet(loaded / Math.max(total, 1) * 0.95, 'Đang tải ' + decodeURIComponent(url.split('/').pop().split('?')[0]).slice(0, 48));
};
THREE.DefaultLoadingManager.onLoad = () => { boot.idle = true; };
function bootFail(e) {
  if (!boot.shown || !boot.el) return;
  boot.msg.textContent = 'Lỗi tải: ' + (e?.message || e || 'không rõ');
  if (!boot.el.querySelector('button')) boot.el.querySelector('.boot-card').append(Object.assign(document.createElement('button'), { textContent: 'Tải lại', onclick: () => location.reload() }));
}
addEventListener('error', e => bootFail(e.error || e.message));
addEventListener('unhandledrejection', e => bootFail(e.reason));
function bootTick() {   // called every frame until the screen is gone
  if (!boot.shown) return;
  boot.frames++;
  if (boot.initDone && boot.idle && boot.frames > 3) {
    boot.shown = false; bootSet(1, 'Sẵn sàng');
    boot.el?.classList.add('done'); setTimeout(() => boot.el?.remove(), 700);
  }
}
setTimeout(() => { if (boot.shown) { boot.initDone = true; boot.idle = true; } }, 45000);   // never trap the page behind the loader

const meta = await (await fetch(BASE + 'anim.json')).json();
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
// studio light directions: azimuth 0° = the robot's front (+Z), 90° = its left side (+X); elevation above the horizon
const dirTmp = new THREE.Vector3();
const lightDir = (az, el, v) => { const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el); return v.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)); };
Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
const rim = new THREE.DirectionalLight(0x88bbff, 1.4); rim.position.set(-6, 5, -8); scene.add(rim, rim.target);
const hemi = new THREE.HemisphereLight(0xdde8ff, 0x202020, 0); scene.add(hemi);
// soft fill from the camera side (no shadow): lifts the dark side and flattens contrast, like a studio bounce card
const fill = new THREE.DirectionalLight(0xffffff, 0); scene.add(fill, fill.target);

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
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0 }, uVig: { value: 0 }, uCA: { value: 0 },
    uBright: { value: 0 }, uContrast: { value: 1 }, uSat: { value: 1 }, uTemp: { value: 0 }, uTint: { value: 0 },
    uShCol: { value: new THREE.Color(0.5, 0.5, 0.5) }, uShAmt: { value: 0 }, uHiCol: { value: new THREE.Color(0.5, 0.5, 0.5) }, uHiAmt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig, uCA, uBright, uContrast, uSat, uTemp, uTint, uShAmt, uHiAmt;
    uniform vec3 uShCol, uHiCol; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 off = d * r2 * uCA * 0.06;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      // grade (Sketchfab-style tone controls + color balance): white balance, contrast about mid grey, saturation,
      // then split toning (shadow / highlight tint)
      c *= vec3(1.0 + 0.12 * uTemp, 1.0 - 0.07 * uTint, 1.0 - 0.12 * uTemp);
      c = (c - 0.5) * uContrast + 0.5 + uBright;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      float lum = clamp(l, 0.0, 1.0);
      c += (uShCol - 0.5) * uShAmt * (1.0 - lum) * (1.0 - lum) + (uHiCol - 0.5) * uHiAmt * lum * lum;
      c = clamp(c, 0.0, 1.0);
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
  map: tex(BASE + 'textures/armor_basecolor.png', true),
  roughnessMap: tex(BASE + 'textures/armor_roughness.png'),
  normalMap: tex(BASE + 'textures/armor_normal.png'),
  emissiveMap: tex(BASE + 'textures/armor_emission.png', true),
};

// ---------- model ----------
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
const gltf = await loader.loadAsync(BASE + 'models/autobot.glb');
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
  p.userData.base = { color: p.color.clone(), roughness: p.roughness, metalness: p.metalness, clearcoat: p.clearcoat, clearcoatRoughness: p.clearcoatRoughness, env: p.envMapIntensity,
    maps: Object.fromEntries(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'].map(k => [k, p[k]])),
    emissive: p.emissive.clone(), emissiveIntensity: p.emissiveIntensity, transparent: p.transparent };
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

// ---------- space cruise: the jet holds its hover pose and flies through streaking stars ----------
// the ship stays put (stars move past it); it banks/bobs gently around its own centre and the wheels idle-spin
let cruise = false, pendingCruise = false, cruiseFade = 0, wheelSpin = 0, swayT = 0;
const cruiseBase = new THREE.Quaternion(), cruiseOrigin = new THREE.Vector3();   // heading + world offset handed over by the launch
const CRUISE_FRAME = meta.clips.hover[0];
const STAR_N = 1800, STAR_HALF = 90;
const starGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(STAR_N * 6), end = new Float32Array(STAR_N * 2), seed = new Float32Array(STAR_N * 2);
  for (let i = 0; i < STAR_N; i++) {
    // keep a clear tube around the ship so no streak crosses the hull
    const r = 5 + Math.pow(Math.random(), 0.7) * 70, a = Math.random() * Math.PI * 2, z = (Math.random() * 2 - 1) * STAR_HALF, k = Math.random();
    for (let j = 0; j < 2; j++) { pos.set([Math.cos(a) * r, Math.sin(a) * r, z], (i * 2 + j) * 3); end[i * 2 + j] = j; seed[i * 2 + j] = k; }
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  starGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
}
// uTravel accumulates on the CPU so changing the speed never makes the stars jump
const starU = { uTravel: { value: 0 }, uLen: { value: 2.2 }, uHalf: { value: STAR_HALF }, uFade: { value: 0 }, uInt: { value: 1 }, uCol: { value: new THREE.Color(0xcfe0ff) } };
const stars = new THREE.LineSegments(starGeo, new THREE.ShaderMaterial({
  uniforms: starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute float aEnd, aSeed; uniform float uTravel, uLen, uHalf, uFade; varying float vA;
    void main() {
      vec3 p = position; float sp = 0.6 + 0.8 * aSeed;
      p.z = mod(p.z - uTravel * sp + uHalf, 2.0 * uHalf) - uHalf - aEnd * uLen * sp;
      vA = (1.0 - aEnd * 0.95) * smoothstep(uHalf, uHalf * 0.6, abs(p.z)) * uFade * (0.35 + 0.65 * aSeed);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: 'uniform vec3 uCol; uniform float uInt; varying float vA; void main() { gl_FragColor = vec4(uCol * 2.2 * uInt, vA); }',
}));
stars.frustumCulled = false; stars.visible = false; scene.add(stars);

let playing = false, range = [meta.frameStart, meta.frameEnd], cur = meta.frameStart;
let idle = 0;   // frames since anything moved (drives the Cycles-style accumulation)
let ptSceneDirty = true;   // skinned pose / visibility changed → path tracer BVH must be rebuilt
// wheel spin axis + direction, measured from the clip itself (the wheels spin between frames 18 and 104)
const wheels = [];
function setFrame(f) { ptSceneDirty = true; cur = f; const t = (f - 1) / FPS; actions.forEach(a => { a.time = Math.min(t, a.getClip().duration); }); mixer.update(0); }

{
  const bones = []; model.traverse(o => { if (o.isBone && /^wheel/i.test(o.name)) bones.push(o); });
  setFrame(40); const q0 = bones.map(b => b.quaternion.clone());
  setFrame(41);
  bones.forEach((b, i) => {
    const d = q0[i].clone().invert().multiply(b.quaternion);
    const axis = new THREE.Vector3(d.x, d.y, d.z);
    if (axis.lengthSq() < 1e-10) return;
    wheels.push({ b, axis: axis.normalize().multiplyScalar(Math.sign(d.w) || 1), base: new THREE.Quaternion() });
  });
}
const qSpin = new THREE.Quaternion();
// the hub (hex cap, cross bars, green lamps) is split off each wheel mesh so it can spin faster than the tyre:
// its own Skeleton shares the bones but gets an extra spin folded into the wheel bone's inverse bind matrix
const HUB_R = 0.14;   // tyre starts at r = 0.18 (g_wheel), hub parts stay inside 0.13
const hubs = [];
{
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const o of [...bodyMeshes]) {
    if (!o.isSkinnedMesh || !o.geometry.index) continue;
    const bi = o.geometry.attributes.skinIndex.getX(0), w = wheels.find(w => w.b === o.skeleton.bones[bi]);
    if (!w) continue;
    m.multiplyMatrices(o.skeleton.boneInverses[bi], o.bindMatrix);   // mesh bind space -> wheel bone rest space
    const P = o.geometry.attributes.position, idx = o.geometry.index.array, hub = [], tyre = [];
    const inHub = i => { v.fromBufferAttribute(P, i).applyMatrix4(m); return v.addScaledVector(w.axis, -v.dot(w.axis)).length() < HUB_R; };
    for (let t = 0; t < idx.length; t += 3) (inHub(idx[t]) && inHub(idx[t + 1]) && inHub(idx[t + 2]) ? hub : tyre).push(idx[t], idx[t + 1], idx[t + 2]);
    if (!hub.length) continue;
    const g = new THREE.BufferGeometry();
    for (const k in o.geometry.attributes) g.setAttribute(k, o.geometry.attributes[k]);
    g.setIndex(hub); o.geometry.setIndex(tyre);
    const sk = new THREE.Skeleton(o.skeleton.bones, o.skeleton.boneInverses.map(b => b.clone()));
    const h = new THREE.SkinnedMesh(g, o.material); h.name = o.name + '_hub';
    h.castShadow = h.receiveShadow = true; h.frustumCulled = false; h.userData.mat = o.material;
    o.parent.add(h); h.position.copy(o.position); h.quaternion.copy(o.quaternion); h.scale.copy(o.scale);
    h.bind(sk, o.bindMatrix);
    bodyMeshes.push(h);
    hubs.push({ sk, bi, axis: w.axis, inv: o.skeleton.boneInverses[bi] });
  }
}
let hubSpin = 0;
const hubM = new THREE.Matrix4();
function setHubSpin(a) { hubs.forEach(h => h.sk.boneInverses[h.bi].copy(hubM.makeRotationAxis(h.axis, a)).multiply(h.inv)); }
const jetC = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), engMid = new THREE.Vector3();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), ZAXIS = new THREE.Vector3(0, 0, 1);
function updateCruise(dt) {
  cruiseFade = Math.min(1, cruiseFade + dt / 1.2);
  starU.uFade.value = cruiseFade * cruiseFade;
  starU.uTravel.value = (starU.uTravel.value + dt * S.spSpeed) % 1e5;
  // hold the hover pose, then layer the idle wheel spin on top
  setFrame(CRUISE_FRAME);
  if (S.spWheels) wheelSpin = (wheelSpin + dt * THREE.MathUtils.degToRad(S.spWheelSpeed) * cruiseFade) % (Math.PI * 2);
  // the mixer only writes a bone when its sampled value changes, so a held frame never resets the wheels:
  // always rebuild from the captured pose instead of stacking rotations frame after frame
  wheels.forEach(w => w.b.quaternion.copy(w.base).multiply(qSpin.setFromAxisAngle(w.axis, S.spWheels ? wheelSpin : 0)));
  hubSpin = (hubSpin + dt * THREE.MathUtils.degToRad(S.spHubSpeed) * cruiseFade) % (Math.PI * 2);
  setHubSpin(hubSpin);
  // ship frame: nose = away from the engines
  model.position.set(0, 0, 0); model.quaternion.identity(); model.updateMatrixWorld(true);
  rootBone.getWorldPosition(jetC);
  engMid.set(0, 0, 0); engines.forEach(e => engMid.add(e.o.getWorldPosition(tmpV)));
  engMid.divideScalar(engines.length || 1);
  fwd.copy(jetC).sub(engMid); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); fwd.normalize();
  fwd.applyQuaternion(cruiseBase);
  side.crossVectors(fwd, up);
  // gentle bank / pitch / yaw + bob, pivoting on the ship's centre
  swayT += dt * S.spSwaySpeed;
  const t = swayT, k = cruiseFade, D = THREE.MathUtils.DEG2RAD;
  qa.setFromAxisAngle(fwd, Math.sin(t * 0.55) * S.spBank * D * k);
  qb.setFromAxisAngle(side, Math.sin(t * 0.4 + 1) * S.spPitch * D * k);
  qc.setFromAxisAngle(up, Math.sin(t * 0.27 + 2) * S.spYaw * D * k);
  model.quaternion.copy(qc).multiply(qb).multiply(qa).multiply(cruiseBase);
  model.position.copy(jetC).sub(tmpV.copy(jetC).applyQuaternion(model.quaternion)).add(cruiseOrigin);
  model.position.y += Math.sin(t * 0.8) * S.spBob * k;
  // stars stream from nose to tail around the ship
  stars.position.copy(jetC).add(cruiseOrigin); stars.quaternion.setFromUnitVectors(ZAXIS, fwd);
}
const tmpV = new THREE.Vector3();

// ---------- robot-form extras: slowly turning chest reactor + battle mask on demand ----------
// both write the bone every frame from the clip's own track (sampled at the current frame) plus an offset,
// so they never stack on a value the mixer left untouched on a held frame
const trackAt = name => { const t = gltf.animations.flatMap(c => c.tracks).find(t => t.name === name); return t && t.createInterpolant(new Float32Array(t.getValueSize())); };
const sampleQ = (it, f, q) => q.fromArray(it.evaluate((f - 1) / FPS));
const reactor = { b: model.getObjectByName('core'), it: trackAt('core.quaternion'), spin: 0 };
const MASK_OPEN_FRAME = 221;   // the reveal clip holds the mask fully open over 217–225
const masks = ['maskL', 'maskR'].map(n => ({ b: model.getObjectByName(n), itQ: trackAt(n + '.quaternion'), itP: trackAt(n + '.position') })).filter(m => m.b && m.itQ);
masks.forEach(m => { m.openQ = sampleQ(m.itQ, MASK_OPEN_FRAME, new THREE.Quaternion()); if (m.itP) m.openP = new THREE.Vector3().fromArray(m.itP.evaluate((MASK_OPEN_FRAME - 1) / FPS)); });
let maskOpen = false, maskAmt = 0;
const exQ = new THREE.Quaternion(), exP = new THREE.Vector3(), YAX = new THREE.Vector3(0, 1, 0);
function updateRobotExtras(dt) {
  const robotForm = !cruise && (cur <= 21 || cur >= 205);
  if (reactor.b && reactor.it) {
    if (robotForm) reactor.spin = (reactor.spin + dt * THREE.MathUtils.degToRad(S.coreSpeed)) % (Math.PI * 2);
    sampleQ(reactor.it, cur, reactor.b.quaternion).multiply(exQ.setFromAxisAngle(YAX, reactor.spin));   // disc turns on its own axle (bone Y)
  }
  const target = maskOpen && robotForm ? 1 : 0;
  maskAmt = THREE.MathUtils.clamp(maskAmt + Math.sign(target - maskAmt) * dt / S.maskTime, 0, 1);   // closes smoothly when leaving robot form
  const e = maskAmt * maskAmt * (3 - 2 * maskAmt);
  masks.forEach(m => {
    sampleQ(m.itQ, cur, m.b.quaternion).slerp(m.openQ, e);
    if (m.itP) m.b.position.fromArray(m.itP.evaluate((cur - 1) / FPS)).lerp(m.openP, e);
  });
}

// ---------- run cycle: procedural robot run in the style of Mixamo's "Running" clip ----------
// forward lean, arms bent ~80° swinging against the legs, high knee in swing, hips bouncing twice per stride.
// Every joint is a hinge rotation on top of the idle pose; the body is lowered so the stance foot stays on the
// ground and moves forward exactly as fast as that foot sweeps back (no foot sliding).
let running = false, pendingRun = false, runFade = 0, runPhase = 0, runZ = 0, runSpeed = 0, runFrame = 1, restSoleY = 0;
let stanceSide = -1, stanceAnchor = 0, shake = 0;
const RJ = Object.fromEntries(['pelvis', 'chest', 'head', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'heelL', 'heelR',
  'upperarmL', 'upperarmR', 'forearmL', 'forearmR', 'shoulderL', 'shoulderR']
  .map(n => [n, model.getObjectByName(n)]).filter(([, b]) => b));
const runBase = new Map(), runBasePos = new Map();
const rEuler = new THREE.Euler(), rQ = new THREE.Quaternion(), ankle = [new THREE.Vector3(), new THREE.Vector3()], contact = [false, false];
// pitch > 0 tips the bone forward (its lower end swings back) — the same sign on every joint here, since all of
// these bones share the world X axis; yaw is only used on pelvis/chest/head (identity rest frames)
function pose(b, pitch, yaw = 0, roll = 0) {
  if (!b) return;
  const D = THREE.MathUtils.DEG2RAD;
  b.quaternion.copy(runBase.get(b)).multiply(rQ.setFromEuler(rEuler.set(pitch * D, yaw * D, roll * D, 'YXZ')));
}
// hinge a bone about another bone's rest pivot (both children of the same parent): R is in parent space
const pvt = new THREE.Vector3();
function poseAbout(b, pivot, R) {
  if (!b) return;
  pvt.copy(runBasePos.get(pivot));
  b.position.copy(runBasePos.get(b)).sub(pvt).applyQuaternion(R).add(pvt);
  b.quaternion.copy(R).multiply(runBase.get(b));
}
const qR = new THREE.Quaternion(), qInv = new THREE.Quaternion(), XAX = new THREE.Vector3(1, 0, 0);
// sole contact points: the bottom vertices of foot / toe / heel parts, kept in their bone's rest space
const SOLE = [];
{
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const o of bodyMeshes) {
    if (!o.isSkinnedMesh) continue;
    const bi = o.geometry.attributes.skinIndex.getX(0), bone = o.skeleton.bones[bi];
    if (!/^(foot|toe|heel)[LR]$/.test(bone.name)) continue;
    m.multiplyMatrices(o.skeleton.boneInverses[bi], o.bindMatrix);
    const P = o.geometry.attributes.position, pts = [];
    for (let i = 0; i < P.count; i++) pts.push(v.fromBufferAttribute(P, i).applyMatrix4(m).clone());
    const toWorld = new THREE.Matrix4();
    SOLE.push({ o, bone, pts: pts.filter((_, i) => i % 2 === 0), toWorld });
  }
}
function soleMinY() {
  let mn = Infinity;
  for (const s of SOLE) {
    s.toWorld.multiplyMatrices(s.o.matrixWorld, s.o.bindMatrixInverse).multiply(s.bone.matrixWorld);
    for (const p of s.pts) mn = Math.min(mn, tmpV.copy(p).applyMatrix4(s.toWorld).y);
  }
  return mn;
}
// ---------- hands: the fingers are part of one rigid mesh, so they curl on the CPU ----------
// hand bone space (from g_hand): fingers run along +Y from the knuckle axle at y = 0.26, palm faces -Z;
// 3 phalanges (0.07 / 0.055 / 0.045) built with a 6° / 18° / 30° rest curl; thumb root at (∓0.085, 0.1, -0.05)
const FINGER = (() => {
  const D = THREE.MathUtils.DEG2RAD, L = [0.07, 0.055, 0.045], A = [6, 18, 30].map(a => a * D);
  const J = [new THREE.Vector2(0.26, 0)];   // (y, z) joint centres
  for (let i = 0; i < 2; i++) J.push(J[i].clone().add(new THREE.Vector2(Math.cos(A[i]), -Math.sin(A[i])).multiplyScalar(L[i])));
  const N = [null, new THREE.Vector2(Math.cos((A[0] + A[1]) / 2), -Math.sin((A[0] + A[1]) / 2)), new THREE.Vector2(Math.cos((A[1] + A[2]) / 2), -Math.sin((A[1] + A[2]) / 2))];
  return { J, N };
})();
const hands = [];
{
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const o of bodyMeshes) {
    if (!o.isSkinnedMesh) continue;
    const bi = o.geometry.attributes.skinIndex.getX(0), bone = o.skeleton.bones[bi], side = /^hand([LR])$/.exec(bone.name)?.[1];
    if (!side) continue;
    const sgn = side === 'L' ? 1 : -1;
    m.multiplyMatrices(o.skeleton.boneInverses[bi], o.bindMatrix);
    const inv = m.clone().invert(), P = o.geometry.attributes.position, Nm = o.geometry.attributes.normal;
    const seg = new Int8Array(P.count).fill(-1), thumb = new Uint8Array(P.count);
    const local = new Float32Array(P.count * 3), nrm = new Float32Array(P.count * 3), nm3 = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); local.set([v.x, v.y, v.z], i * 3);
      v.fromBufferAttribute(Nm, i).applyMatrix3(nm3).normalize(); nrm.set([v.x, v.y, v.z], i * 3);
      const x = local[i * 3], y = local[i * 3 + 1], z = local[i * 3 + 2];
      if (y > 0.255 && Math.abs(x) < 0.09) {
        let k = 0;
        for (let j = 1; j < 3; j++) if ((y - FINGER.J[j].x) * FINGER.N[j].x + (z - FINGER.J[j].y) * FINGER.N[j].y > 0) k = j;
        seg[i] = k;
      } else if (x * sgn < -0.08 && y > 0.06 && y < 0.25 && z < 0.0) thumb[i] = 1;
    }
    hands.push({ o, side, sgn, m: m.clone(), inv, nm3inv: new THREE.Matrix3().getNormalMatrix(inv), local, nrm, seg, thumb, curl: 0, shown: 0 });
  }
}
const hQ = new THREE.Quaternion(), hV = new THREE.Vector3(), hN = new THREE.Vector3(), hP = new THREE.Vector3(), XA = new THREE.Vector3(1, 0, 0), YA = new THREE.Vector3(0, 1, 0);
// c: 0 = modelled pose (loose), 1 = fist; negative opens the hand a little
function curlHand(h, c) {
  if (Math.abs(c - h.shown) < 0.004) return;
  h.shown = c;
  const D = THREE.MathUtils.DEG2RAD, th = [-58 * c * D, -72 * c * D, -52 * c * D], tq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  const P = h.o.geometry.attributes.position, Nm = h.o.geometry.attributes.normal, TB = new THREE.Vector3(-0.085 * h.sgn, 0.1, -0.05);
  for (let i = 0; i < P.count; i++) {
    const k = h.seg[i]; if (k < 0 && !h.thumb[i]) continue;
    hV.fromArray(h.local, i * 3); hN.fromArray(h.nrm, i * 3);
    if (k >= 0) {
      // distal first, each about its rest joint, then carried by the joints nearer the palm
      for (let j = k; j >= 0; j--) {
        hQ.setFromAxisAngle(XA, th[j]); hP.set(0, FINGER.J[j].x, FINGER.J[j].y);
        hV.sub(hP).applyQuaternion(hQ).add(hP); hN.applyQuaternion(hQ);
      }
    } else {
      hQ.setFromAxisAngle(YA, 40 * c * D * h.sgn); hV.sub(TB).applyQuaternion(hQ).add(TB); hN.applyQuaternion(hQ);
    }
    hV.applyMatrix4(h.inv); hN.applyMatrix3(h.nm3inv).normalize();
    P.setXYZ(i, hV.x, hV.y, hV.z); Nm.setXYZ(i, hN.x, hN.y, hN.z);
  }
  P.needsUpdate = Nm.needsUpdate = true;
}
const ARM_STYLE = [
  { amp: 1.0, lag: 0.0, elbow: 70, elbowAmp: 12, out: 8, drift: 0.7, grip: 0.3, gripAmp: 0.28 },    // left: fuller, looser swing, open-handed
  { amp: 0.8, lag: 0.22, elbow: 82, elbowAmp: 6, out: 10, drift: 0.45, grip: 0.5, gripAmp: 0.15 },  // right: tighter, more bent, a touch late, near fist
];
let runClock = 0;
function updateRun(dt) {
  runClock += dt;
  runFade = Math.min(1, runFade + dt / 0.6);
  const k = runFade * runFade * (3 - 2 * runFade);
  runPhase = (runPhase + dt / S.rnCycle * k) % 1;
  const phi = runPhase * Math.PI * 2, A = S.rnStride;
  ['L', 'R'].forEach((side, i) => {
    const p = phi + i * Math.PI;
    const hip = (10 + 32 * Math.sin(p)) * A;                                  // + = thigh forward
    // joint limits measured with the BVH sweep: knee > ~72° folds the missile pod into the thigh,
    // ankle < -45° drives the fin into the foot
    const knee = Math.min(66, 18 + 48 * A * Math.pow(Math.max(0, Math.cos(p - 0.35)), 1.5));
    const toe = 14 * Math.max(0, -Math.sin(p));                                 // toe-off push
    const ankleRel = THREE.MathUtils.clamp(hip - knee + toe, -38, 50);          // keeps the sole level in stance
    pose(RJ['thigh' + side], -hip * k);
    pose(RJ['shin' + side], knee * k);
    pose(RJ['foot' + side], ankleRel * k);
    // the heel guard (on the shin) hinges about the ankle with the foot, so the sole lands flat, never on the heel
    poseAbout(RJ['heel' + side], RJ['foot' + side], qR.setFromAxisAngle(XAX, ankleRel * k * THREE.MathUtils.DEG2RAD));
    // the two arms deliberately differ (amplitude, lag, elbow bend, a slow drift) so the swing isn't mirror-perfect;
    // swing capped to -7..27° (BVH sweep): beyond that the pauldron riding the arm tips into the back wing
    const AS = ARM_STYLE[i], drift = 1 + 0.12 * Math.sin(runClock * AS.drift + i * 2.1);
    const armRaw = S.rnArm * AS.amp * drift * (6 + 26 * Math.sin(p + Math.PI - AS.lag));
    const arm = THREE.MathUtils.clamp(armRaw, -7, 27), elbow = AS.elbow + AS.elbowAmp * Math.sin(p + Math.PI - AS.lag - 0.4);
    pose(RJ['upperarm' + side], -arm * k, 0, (i ? AS.out : -AS.out) * k);      // arms slightly out, clear of the hips
    pose(RJ['forearm' + side], -elbow * k);
    // the shoulder pauldron rides the upper arm about the same shoulder pivot, so the arm never pokes through it
    // hands open on the back swing and close as the arm drives forward, each hand on its own rhythm
    const grip = THREE.MathUtils.clamp(AS.grip + AS.gripAmp * Math.sin(p + Math.PI - AS.lag + 0.6) + 0.05 * Math.sin(runClock * 1.3 + i * 4), -0.1, 0.75);
    hands.filter(h => h.side === side).forEach(h => curlHand(h, grip * k));
    const ua = RJ['upperarm' + side];
    if (ua) poseAbout(RJ['shoulder' + side], ua, qR.copy(ua.quaternion).multiply(qInv.copy(runBase.get(ua)).invert()));
  });
  const twist = 7 * Math.sin(phi);
  pose(RJ.pelvis, 0, -twist * k);
  pose(RJ.chest, S.rnLean * k, twist * 1.6 * k);                               // shoulders counter-rotate
  pose(RJ.head, THREE.MathUtils.clamp(-S.rnLean * 0.4, -10, 10) * k);   // eyes near level; no yaw: the head sits tight between the hatches
  // plant the lower foot on the ground, then add a little air in the flight phase
  model.position.set(0, 0, runZ); model.updateMatrixWorld(true);
  RJ.footL.getWorldPosition(ankle[0]); RJ.footR.getWorldPosition(ankle[1]);
  // stance leg = the one sweeping back (left while cos(phi) < 0); it carries the body, the other foot never dips below it
  const low = Math.cos(phi) < 0 ? 0 : 1;
  model.position.y = restSoleY - soleMinY() + S.rnBounce * 0.12 * Math.pow(Math.max(0, -Math.cos(2 * phi)), 2) * k;
  // the planted foot is pinned to the ground: the body travels exactly as far as that foot sweeps back (never backwards)
  const zRel = ankle[low].z - model.position.z;
  if (low !== stanceSide) stanceAnchor = runZ + zRel;
  const z = Math.max(runZ, stanceAnchor - zRel);
  stanceAnchor = z + zRel; stanceSide = low;
  if (dt > 0) runSpeed += ((z - runZ) / dt - runSpeed) * Math.min(1, dt * 4);
  runZ = z; model.position.z = runZ;
  // footfall = the moment a leg becomes the stance leg
  if (!contact[low] && k > 0.5) { if (S.rnSound) stomp(S.rnStompVol); shake = Math.max(shake, S.rnShake); }
  contact[low] = true; contact[1 - low] = false;
  // keep the run on the ground plane: jump back (camera too) before running off its edge
  if (runZ > 120) { runZ -= 240; model.position.z -= 240; camera.position.z -= 240; controls.target.z -= 240; }
}
// giant footfall: AI-generated stomp samples (public/sfx/stomp1-3.mp3), random take + slight pitch spread
const STOMPS = ['sfx/stomp1.mp3', 'sfx/stomp2.mp3', 'sfx/stomp3.mp3'];
function stomp(vol) {
  const f = STOMPS[Math.floor(Math.random() * STOMPS.length)]; if (!buffers[f]) return;
  const a = new THREE.Audio(listener); a.setBuffer(buffers[f]); a.setVolume(vol); a.setPlaybackRate(0.9 + Math.random() * 0.15);
  a.offset = stompStart(f); a.play(); setTimeout(() => { try { a.stop(); } catch (e) {} }, 2500);
}
// the takes open with a servo whine: start ~0.15 s before the loudest sample so the boom lands on the footfall
const stompOffsets = {};
function stompStart(f) {
  if (f in stompOffsets) return stompOffsets[f];
  const b = buffers[f], d = b.getChannelData(0); let peak = 0, at = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) { peak = v; at = i; } }
  return (stompOffsets[f] = Math.max(0, at / b.sampleRate - 0.15));
}
// ---------- stand: idle robot, hands on hips, glancing around, torso turning a little ----------
// only the chest turns (pelvis and legs stay put, so the feet never twist on the ground). The head is seated in the
// chest collar and cannot yaw even 1° without cutting into it, so the chest carries every glance (free to ±40°)
// and the head only nods (collar clears ±12°)
let standing = false, pendingStand = false, standFade = 0, standT = 0;
const HAND = { L: model.getObjectByName('handL'), R: model.getObjectByName('handR') };
// pelvis-space wrist target: found with the BVH sweep as the spot where the hand rests on the hip plate
// (0.82 keeps the palm off the plate while the arm re-aims as the chest turns); with hands on hips the chest turn is
// capped at ±24°, past ~28° the pauldron riding the arm clips the chest flap
const STAND = { wrist: new THREE.Vector3(0.82, 0.12, 0.02), pole: new THREE.Vector3(1, -0.1, -0.7), yawHips: 24, yawFree: 35 };
const ikS = new THREE.Vector3(), ikW = new THREE.Vector3(), ikE = new THREE.Vector3(), ikU = new THREE.Vector3(), ikN = new THREE.Vector3(),
  ikX = new THREE.Vector3(), ikY = new THREE.Vector3(), ikZ = new THREE.Vector3(), ikM = new THREE.Matrix4(), ikQ = new THREE.Quaternion(), ikQ2 = new THREE.Quaternion();
// analytic two-bone IK in chest space; the elbow hinge is the forearm's local X (flexing toward the upper arm's local -Z)
function armIK(side, k) {
  const s = side === 'L' ? 1 : -1, ua = RJ['upperarm' + side], fa = RJ['forearm' + side], hd = HAND[side];
  if (!ua || !fa || !hd) return;
  const a = fa.position.length(), b = hd.position.length();
  ikS.copy(runBasePos.get(ua));
  // wrist target lives on the pelvis: bring it into the (turning) chest's space
  ikW.set(STAND.wrist.x * s, STAND.wrist.y, STAND.wrist.z);
  ikM.compose(RJ.chest.position, RJ.chest.quaternion, tmpV.set(1, 1, 1)).invert(); ikW.applyMatrix4(ikM);
  ikU.copy(ikW).sub(ikS); const c = Math.min(ikU.length(), a + b - 1e-3); ikU.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  ikN.set(STAND.pole.x * s, STAND.pole.y, STAND.pole.z).addScaledVector(ikU, -ikU.dot(tmpV.set(STAND.pole.x * s, STAND.pole.y, STAND.pole.z))).normalize();
  ikE.copy(ikS).addScaledVector(ikU, a * cosA).addScaledVector(ikN, a * sinA);
  ikY.copy(ikE).sub(ikS).normalize();                                   // upper arm bone axis
  const dirEW = tmpV.copy(ikS).addScaledVector(ikU, c).sub(ikE).normalize();
  ikZ.copy(dirEW).addScaledVector(ikY, -dirEW.dot(ikY)).multiplyScalar(-1).normalize();
  ikX.crossVectors(ikY, ikZ);
  ikQ.setFromRotationMatrix(ikM.makeBasis(ikX, ikY, ikZ));
  ua.quaternion.copy(runBase.get(ua)).slerp(ikQ, k);
  const elbow = Math.acos(THREE.MathUtils.clamp(ikY.dot(dirEW), -1, 1));
  fa.quaternion.copy(runBase.get(fa)).slerp(ikQ2.setFromAxisAngle(XAX, -elbow), k);   // absolute: the idle clip already bends the elbow a little
  poseAbout(RJ['shoulder' + side], ua, qR.copy(ua.quaternion).multiply(qInv.copy(runBase.get(ua)).invert()));
}
function updateStand(dt) {
  standFade = Math.min(1, standFade + dt / 0.9);
  const k = standFade * standFade * (3 - 2 * standFade);
  standT += dt * S.stSpeed;
  const t = standT;
  // glances: two slow incommensurate sines, so the looking-around never visibly repeats
  const look = S.stLook * THREE.MathUtils.clamp(0.75 * Math.sin(t * 0.21) + 0.35 * Math.sin(t * 0.57 + 1.3), -1, 1);
  const twist = S.stTwist * Math.sin(t * 0.33 + 0.5), breathe = 1.2 * Math.sin(t * 1.1);
  const yawMax = S.stHips ? STAND.yawHips : STAND.yawFree;
  pose(RJ.chest, breathe * k, THREE.MathUtils.clamp(twist + look, -yawMax, yawMax) * k);
  pose(RJ.head, THREE.MathUtils.clamp(-1.5 + 4 * Math.sin(t * 0.43 + 2), -8, 8) * k);
  if (S.stHips) { armIK('L', k); armIK('R', k); }
  else ['L', 'R'].forEach(sd => { pose(RJ['upperarm' + sd], 0); pose(RJ['forearm' + sd], -8 * k); });
  hands.forEach(h => curlHand(h, (S.stHips ? 0.55 : 0.2) * k));
}

// ---------- launch: running robot -> leap -> mid-air transform -> climb out -> space cruise ----------
// reuses the authored take-off + transform (frames 22-114) but keeps the run's momentum; the clip leaps backwards
// and the jet's nose points -Z, so the body yaws 180° during the transform to keep flying the way the robot ran
const LAUNCH = { from: 22, to: meta.clips.toJet[1], rate: 1.25, blend: 0.3, climb: 2.6 };
const launchTracks = new Map();
Object.values(RJ).forEach(b => launchTracks.set(b, { q: trackAt(b.name + '.quaternion'), p: trackAt(b.name + '.position') }));
let launching = false;
const LS = { t: 0, phase: '', P: new THREE.Vector3(), v: 0, climbT: 0, fromQ: new Map(), fromP: new Map(), grip: [] };
const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), rootLocal = new THREE.Vector3(), lDir = new THREE.Vector3();
function startLaunch() {
  // freeze the current run pose as the blend source, then hand the rig to the clip
  LS.fromQ.clear(); LS.fromP.clear();
  Object.values(RJ).forEach(b => { LS.fromQ.set(b, b.quaternion.clone()); LS.fromP.set(b, b.position.clone()); });
  LS.grip = hands.map(h => h.shown);
  LS.P.copy(model.position); LS.v = Math.max(runSpeed, 3); LS.t = 0; LS.phase = 'transform';
  running = false; $('run').setAttribute('aria-pressed', 'false');
  launching = true; $('space').setAttribute('aria-pressed', 'true');
  cur = LAUNCH.from; setFrame(cur);
}
function stopLaunch() {
  launching = false; groundMat.transparent = false; groundMat.opacity = 1; groundMat.needsUpdate = true;
}
function placeShip(q) {
  // rotate about the root so the body pivots in place; the root itself rides LS.P
  model.position.set(0, 0, 0); model.quaternion.identity(); model.updateMatrixWorld(true);
  rootBone.getWorldPosition(rootLocal);
  model.quaternion.copy(q);
  model.position.copy(rootLocal).sub(tmpV.copy(rootLocal).applyQuaternion(q)).add(LS.P);
}
function updateLaunch(dt) {
  LS.t += dt;
  if (LS.phase === 'transform') {
    const prev = cur;
    cur = Math.min(LAUNCH.to, cur + dt * FPS * LAUNCH.rate);
    meta.sfx.forEach(c => { if (c.frame > prev && c.frame <= cur) fire(c); });
    setFrame(cur);
    // cross-fade run pose -> clip, sampling the clip directly (the mixer skips bones whose value did not change)
    const w = THREE.MathUtils.smoothstep(LS.t / LAUNCH.blend, 0, 1), time = (cur - 1) / FPS;
    launchTracks.forEach((tr, b) => {
      const q = tr.q ? exQ.fromArray(tr.q.evaluate(time)) : runBase.get(b);
      b.quaternion.copy(LS.fromQ.get(b)).slerp(q, w);
      const p = tr.p ? exP.fromArray(tr.p.evaluate(time)) : runBasePos.get(b);
      b.position.copy(LS.fromP.get(b)).lerp(p, w);
    });
    hands.forEach((h, i) => curlHand(h, LS.grip[i] * (1 - w)));
    // momentum: hold the run speed through the leap, accelerate once the engines light (frame 102)
    LS.v = cur > 102 ? LS.v + dt * 14 : LS.v * (1 - dt * 0.15);
    LS.P.z += LS.v * dt;
    const u = THREE.MathUtils.smoothstep((cur - 36) / (110 - 36), 0, 1);
    placeShip(qYaw.setFromAxisAngle(YAX, Math.PI * u));
    if (cur >= LAUNCH.to) { LS.phase = 'climb'; LS.climbT = 0; groundMat.transparent = true; groundMat.needsUpdate = true; }
  } else {
    // climb out: nose up, then level off as the ground falls away
    LS.climbT += dt;
    const e = Math.min(1, LS.climbT / LAUNCH.climb), pitch = THREE.MathUtils.degToRad(28) * Math.sin(Math.PI * e);
    LS.v += dt * 30;
    lDir.set(0, Math.sin(pitch), Math.cos(pitch));
    LS.P.addScaledVector(lDir, LS.v * dt);
    placeShip(qPitch.setFromAxisAngle(XAX, -pitch).multiply(qYaw.setFromAxisAngle(YAX, Math.PI)));
    groundMat.opacity = 1 - e;
    if (e >= 1) {
      stopLaunch();
      cruiseBase.setFromAxisAngle(YAX, Math.PI); cruiseOrigin.copy(LS.P);
      cur = CRUISE_FRAME; setCruise(true);
    }
  }
}
// ground grid while running, so the motion reads even on the plain floor
const gridTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  g.lineWidth = 1; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(100, 100); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// ---------- render settings (Blender-like presets) ----------
const DPR = Math.min(devicePixelRatio, 1.5);
const DEFAULTS = {
  engine: 'EEVEE', view: 'AgX', exposure: 1, res: DPR,
  hdri: 'Studio', envInt: 1, envRot: 0, bgMode: 'Màu', bgBlur: 0.4, bgInt: 1, bgColor: '#0b0d10', ground: true, groundColor: '#15171b',
  keyInt: 2.2, keyColor: '#fff4e6', rimInt: 1.4, rimColor: '#88bbff', ambient: 0, shadows: true, shadowRes: 2048, shadowSoft: 3, specScale: 1, roughMin: 0, coatSoft: 0, fillInt: 0, fillColor: '#dfe8ff',
  keyAz: 40, keyEl: 52, rimAz: -143, rimEl: 27, fillCam: true, fillAz: -50, fillEl: 10,
  glow: 1, glowColor: '#40ff20', armorMaps: true, texTarget: 'TF_Armor',
  flames: true, flameInt: 1, flameLen: 1, flameSpread: 1, flameSoft: 1.5, flameColor: '#ff8a2a', coreColor: '#fff0c8', flameLight: 1,
  shock: true, shockInt: 0.8, shockColor: '#ffc080', flash: true, flashInt: 1,
  bloom: true, bloomStr: 0.9, bloomRad: 0.5, bloomThr: 1, ao: false, aoInt: 0.8, aoRadius: 0.6,
  look: 'Gốc (Blender)', roughOff: 0, coat: 0, aniso: 0, envRefl: 1, heatTint: false, visorFilm: false,
  grain: 0, vignette: 0, chroma: 0,
  gBright: 0, gContrast: 1, gSat: 1, gTemp: 0, gTint: 0, gShCol: '#5a86a0', gShAmt: 0, gHiCol: '#ffb070', gHiAmt: 0,
  ptQuality: 'Nhanh', ptBounces: 3, ptMaxSamples: 128, ptScale: 0.5, ptFilter: 1, ptDenoise: true, ptDenoiseStr: 5,
  spSpeed: 55, spDensity: 1, spLen: 2.2, spInt: 1, spColor: '#cfe0ff',
  spBank: 4, spPitch: 2, spYaw: 1.7, spBob: 0.12, spSwaySpeed: 1, spWheels: true, spWheelSpeed: 15, spHubSpeed: 540,
  masterVol: 1, camFront: true, camFrontAngle: 25, chatOn: true, chatVol: 0.6, chatEvery: 25, spEngine: true, spEngineVol: 0.5, spEngineTake: 1, stLook: 22, stTwist: 6, stSpeed: 1, stHips: true, coreSpeed: 20, maskTime: 0.5,
  rnCycle: 0.9, rnStride: 1, rnLean: 12, rnArm: 1, rnBounce: 1, rnSound: true, rnStompVol: 1, rnShake: 1, rnGrid: true, rnGridColor: '#2f6b3a',
  sun: false, sunAz: 35, sunEl: 20, sunInt: 4, sunColor: '#fff1dc', sunSize: 3, sunCorona: 1, sunDiskInt: 1, flare: true, flareInt: 1,
};
// path tracing speed/quality trade-offs (resolution dominates: 50% = 4× fewer rays per sample)
const PT_QUALITY = {
  'Nhanh': { ptScale: 0.5, ptBounces: 3, ptMaxSamples: 128, ptFilter: 1, ptDenoise: true, ptDenoiseStr: 5 },
  'Cân bằng': { ptScale: 0.75, ptBounces: 5, ptMaxSamples: 512, ptFilter: 0.6, ptDenoise: true, ptDenoiseStr: 3 },
  'Đẹp': { ptScale: 1, ptBounces: 8, ptMaxSamples: 2048, ptFilter: 0.3, ptDenoise: false, ptDenoiseStr: 2 },
};
// switching engine never rewrites the user's settings: only Workbench (a flat preview mode) overrides a few,
// and only while it is active
const ENGINE_OVERRIDE = {
  EEVEE: {}, Cycles: {},
  Workbench: { view: 'Standard', bloom: false, ao: true, aoInt: 1, shadowRes: 2048, envInt: 1, hdri: 'Studio', bgMode: 'Màu', bgColor: '#3d3d3d' },
};
const STORE = 'autobot-render-v2';
const PRESET_KEY = 'autobot-presets', LAST_PRESET_KEY = 'autobot-preset-last';
const presets = VIEWER ? {} : (() => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch (e) { return {}; } })();
// first visit (nothing saved in this browser): start from the presets shipped with the site
if (!Object.keys(presets).length) Object.assign(presets, await fetch(BASE + 'presets.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})));
const lastPreset = (() => { try { return localStorage.getItem(LAST_PRESET_KEY); } catch (e) { return null; } })();
// startup: the auto-saved working state wins (a reload — incl. every dev hot reload — must never throw away unsaved
// edits); only a browser with no working state yet starts from the last / first preset (shipped presets on a first visit)
const startPreset = lastPreset in presets ? lastPreset : Object.keys(presets)[0];
const workingState = VIEWER ? null : (() => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } })();
const S = { ...DEFAULTS }, SET = S;   // SET: the user's settings, for code that shadows S
if (workingState && Object.keys(workingState).length) Object.assign(S, workingState);
else if (startPreset) Object.assign(S, presets[startPreset]);
if (!(S.engine in ENGINE_OVERRIDE)) S.engine = 'EEVEE';
S.tex = structuredClone(S.tex ?? {});   // per-material texture sets: { [materialName]: { files: { channel: fileName }, ...knobs } }
delete S.sunOrbit;   // the sun no longer orbits on its own
if (!S.ptQuality) Object.assign(S, { ptQuality: 'Nhanh' }, PT_QUALITY['Nhanh']);   // older saved state: start on the fast profile
const BUILTIN_HDRI = { Studio: roomEnv, 'Không': null };
const SHIPPED_HDRI = ['HDR_hazy_nebulae', 'HDR_blue_nebulae_1'];   // public/hdri/<name>.hdr, loaded in the background; not deletable
const hdriTex = { ...BUILTIN_HDRI };
const wantedHdri = S.hdri;   // may be an imported HDRI that is restored from IndexedDB below
if (!(S.hdri in hdriTex)) S.hdri = 'Studio';
const TONE = { AgX: THREE.AgXToneMapping, Filmic: THREE.ACESFilmicToneMapping, Neutral: THREE.NeutralToneMapping, Reinhard: THREE.ReinhardToneMapping,
  Cineon: THREE.CineonToneMapping, Linear: THREE.LinearToneMapping, Standard: THREE.NoToneMapping };
// color-management presets: Blender's AgX looks + Sketchfab-style tone/colour-balance combos. Exposure is left alone
// (it depends on the scene's lights); everything else is set so presets never stack on each other.
const CM_BASE = { gBright: 0, gContrast: 1, gSat: 1, gTemp: 0, gTint: 0, gShAmt: 0, gHiAmt: 0, gShCol: '#5a86a0', gHiCol: '#ffb070' };
const CM_PRESETS = {
  'AgX · Base Contrast': { view: 'AgX' },
  'AgX · Medium High Contrast': { view: 'AgX', gContrast: 1.15, gSat: 1.05 },
  'AgX · High Contrast': { view: 'AgX', gContrast: 1.3, gSat: 1.08 },
  'AgX · Very High Contrast': { view: 'AgX', gContrast: 1.45, gSat: 1.1 },
  'AgX · Medium Low Contrast': { view: 'AgX', gContrast: 0.9 },
  'AgX · Low Contrast': { view: 'AgX', gContrast: 0.8, gSat: 0.95 },
  'AgX · Punchy': { view: 'AgX', gContrast: 1.25, gSat: 1.25, gBright: -0.04 },
  'AgX · Greyscale': { view: 'AgX', gSat: 0 },
  'Khronos PBR Neutral · sản phẩm': { view: 'Neutral' },
  'ACES Filmic · điện ảnh': { view: 'Filmic', gContrast: 1.05 },
  'Sketchfab Filmic': { view: 'Cineon', gContrast: 1.05, gSat: 1.05 },
  'Reinhard · mềm': { view: 'Reinhard', gContrast: 0.95, gSat: 1.05 },
  'Linear · thô': { view: 'Standard' },
  'Teal & Orange · bom tấn': { view: 'AgX', gContrast: 1.2, gSat: 1.1, gTemp: 0.1, gShAmt: 0.35, gShCol: '#2a7a8c', gHiAmt: 0.3, gHiCol: '#ffae5c' },
  'Sci-fi lạnh': { view: 'AgX', gContrast: 1.12, gSat: 0.9, gTemp: -0.35, gShAmt: 0.3, gShCol: '#3a5fa0' },
  'Hoàng hôn ấm': { view: 'AgX', gContrast: 1.05, gSat: 1.1, gTemp: 0.4, gTint: -0.1, gHiAmt: 0.25, gHiCol: '#ffc07a' },
  'Noir · đen trắng gắt': { view: 'Filmic', gContrast: 1.4, gSat: 0, gBright: -0.03 },
  'Bleach bypass · bạc màu': { view: 'AgX', gContrast: 1.3, gSat: 0.55 },
};
const cmUI = { name: '' };

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
  // measured metal F0 colours (physicallybased.info / Poly Haven practice): metals get their tint from base colour,
  // paints are dielectric (metalness 0) under a clear coat; baseMap:false drops the dark baked armor albedo
  'Nhôm phay (brushed aluminium)': {
    armor: { color: '#d4d6d8', metalness: 1, roughness: 0.32, anisotropy: 0.85, baseMap: false },
    dark: { color: '#7d8186', metalness: 1, roughness: 0.4, anisotropy: 0.6 }, metal: { metalness: 1, roughness: 0.25, anisotropy: 0.8 },
  },
  'Thép gunmetal': {
    armor: { color: '#4a4d52', metalness: 1, roughness: 0.38, anisotropy: 0.3, baseMap: false },
    dark: { color: '#26282c', metalness: 1, roughness: 0.45 }, metal: { color: '#9a9ea4', metalness: 1, roughness: 0.3 },
  },
  'Vàng 24K': {
    armor: { color: '#ffc356', metalness: 1, roughness: 0.18, baseMap: false },
    dark: { color: '#3a2a12', metalness: 1, roughness: 0.3 }, metal: { color: '#ffd27a', metalness: 1, roughness: 0.15 },
  },
  'Đồng đỏ (copper)': {
    armor: { color: '#f3a28a', metalness: 1, roughness: 0.28, baseMap: false },
    dark: { color: '#3b2620', metalness: 1, roughness: 0.4 }, metal: { color: '#e8b894', metalness: 1, roughness: 0.25 },
  },
  'Sơn xe metallic đỏ': {
    armor: { color: '#8e1418', metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03, baseMap: false },
    dark: { color: '#141518', metalness: 0.6, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.05 },
  },
  'Sơn quân sự mờ (olive drab)': {
    armor: { color: '#4b5320', metalness: 0, roughness: 0.82, baseMap: false },
    dark: { color: '#23261a', metalness: 0, roughness: 0.9 }, metal: { metalness: 0.9, roughness: 0.55 },
  },
  'Carbon fiber': {
    armor: { color: '#1c1d20', metalness: 0.25, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04, anisotropy: 0.6, baseMap: false },
    dark: { color: '#0e0f11', metalness: 0.2, roughness: 0.4, clearcoat: 0.7 },
  },
  'Nhựa trắng (đồ chơi / studio)': {
    armor: { color: '#e9e9e6', metalness: 0, roughness: 0.42, clearcoat: 0.15, clearcoatRoughness: 0.3, baseMap: false },
    dark: { color: '#2a2b2e', metalness: 0, roughness: 0.55 }, metal: { color: '#b8bcc2', metalness: 1, roughness: 0.35 },
  },
  'Đỏ – lam cổ điển (phe Autobot)': {
    armor: { color: '#a3161c', metalness: 0.4, roughness: 0.34, clearcoat: 0.9, clearcoatRoughness: 0.05, baseMap: false },
    dark: { color: '#15306b', metalness: 0.5, roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.08 },
    metal: { color: '#c5c9cf', metalness: 1, roughness: 0.22 },
  },
  'Xám – tím (phe Decepticon)': {
    armor: { color: '#6c6e74', metalness: 0.9, roughness: 0.4, anisotropy: 0.3, baseMap: false },
    dark: { color: '#3a1d4f', metalness: 0.4, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.08 },
    accent: { color: '#7b2cbf', metalness: 0, roughness: 0.4 },
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
    m.roughness = THREE.MathUtils.clamp(Math.max((L.roughness ?? b.roughness) + S.roughOff, S.roughMin), 0.02, 1);   // roughness floor = satin finish
    const hull = grp === 'armor' || grp === 'dark';
    m.clearcoat = Math.max(L.clearcoat ?? b.clearcoat, hull ? S.coat : 0);
    m.clearcoatRoughness = Math.max(L.clearcoatRoughness ?? (b.clearcoatRoughness || 0.08), S.coatSoft);
    m.specularIntensity = S.specScale;   // dielectric highlight strength (F0 scale)
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
      if (!maps) m.emissiveIntensity = 0;   // the vein glow lives in the emission map: without it the colour would flood the whole plate
    }
    if (before !== `${m.clearcoat > 0}|${m.anisotropy > 0}|${m.iridescence > 0}|${!!m.map}|${!!m.normalMap}`) m.needsUpdate = true;
  }
}

// ---------- user texture sets per material (Sketchfab-style channels, Poly Haven / ambientCG naming) ----------
const TEX_CH = [
  { ch: 'map', label: 'Base color', srgb: true, info: 'Màu và hoa văn bề mặt: sơn, gỉ, vết bẩn. Không nên có bóng đổ hay điểm sáng trong ảnh.' },
  { ch: 'normalMap', label: 'Normal', info: 'Ảnh tím-xanh: tạo gờ, lõm, vết xước, đinh tán giả theo ánh sáng mà không đổi hình khối.' },
  { ch: 'roughnessMap', label: 'Roughness', info: 'Trắng = nhám, phản xạ mờ; đen = bóng, phản xạ sắc như gương. Quyết định giáp bóng hay lì.' },
  { ch: 'metalnessMap', label: 'Metalness', info: 'Trắng = kim loại trần (phản xạ mang màu base color); đen = sơn / phi kim. Vùng xám thường là gỉ, bụi.' },
  { ch: 'aoMap', label: 'Ambient occlusion', info: 'Làm tối các khe, kẽ nơi ánh sáng khó lọt vào, cho bề mặt có chiều sâu.' },
  { ch: 'emissiveMap', label: 'Emission', srgb: true, info: 'Vùng tự phát sáng (đèn, vạch LED), sáng cả khi không có đèn chiếu; bloom sẽ làm vùng này loé.' },
  { ch: 'alphaMap', label: 'Opacity', info: 'Trắng = đặc, đen = trong suốt (lưới, lỗ thủng). Ảnh chụp thường sẽ làm giáp thủng lỗ chỗ.' },
  { ch: 'bumpMap', label: 'Height / bump', info: 'Ảnh đen-trắng độ cao: tạo gờ nổi nhẹ. Tác dụng như normal nhưng yếu hơn, dùng khi không có normal.' },
];
// what each glTF material is on the robot (from scanning which parts use it in autobot.glb)
const MAT_INFO = {
  TF_Armor: { label: 'Giáp chính', where: 'các tấm vỏ ngoài: ngực, vai, cánh, đùi, ống chân, bàn chân, tay, đầu, sừng, hộp tên lửa. Vân xanh phát sáng nằm trong texture của giáp này.' },
  TF_Dark: { label: 'Giáp tối / khung', where: 'các mảng tối: khung trong, khe, viền giữa các tấm giáp, mặt nạ, cánh tà, cổ, vành bánh xe, lõi ngực.' },
  TF_Green: { label: 'Đèn xanh (vật thể)', where: 'các thanh / chấm đèn xanh gắn nổi trên giáp (khác vân xanh in trong texture giáp).' },
  TF_Glass: { label: 'Kính', where: 'kính buồng lái ở mũi jet, ô kính ngực, kính lõi lò phản ứng, kính ở đùi.' },
  TF_Face: { label: 'Mặt', where: 'khuôn mặt robot, mặt nạ, vài tấm nhỏ ở ngực và cẳng tay.' },
  TF_Metal: { label: 'Kim loại cơ khí', where: 'piston, ống, khớp, cổ, vây chân, hộp và đầu tên lửa, chi tiết máy.' },
  TF_Chrome: { label: 'Chrome', where: 'chi tiết mạ bóng nhỏ: vòng khớp, trục, ống ở ngực, đùi, ống chân, cổ.' },
  TF_CoreGlow: { label: 'Lõi lò phản ứng', where: 'đĩa phát sáng giữa ngực (cái xoay nhẹ ở dạng robot).' },
  TF_Exhaust: { label: 'Ống xả', where: 'miệng ống xả động cơ: bàn chân (đuôi jet), tên lửa, cẳng tay.' },
  TF_Red: { label: 'Đèn đỏ', where: 'đèn đỏ ở đầu, cẳng tay và đầu cánh.' },
  TF_Rubber: { label: 'Cao su', where: 'lốp 6 bánh xe ở chân, gót, bánh đáp dưới mũi jet.' },
};
// blink every part that uses a material (cyan, 4 times over ~3 s) so it is obvious where it sits
const hlMat = new THREE.MeshBasicMaterial({ color: 0x27d7ff });
let hl = null;
function highlightMat(name) { hl = { name, t: 0 }; }
function updateHighlight(dt) {
  if (!hl) return;
  hl.t += dt;
  const done = hl.t >= 2.8, on = !done && Math.floor(hl.t / 0.35) % 2 === 0;   // 4 flashes
  bodyMeshes.forEach(o => { if (!Array.isArray(o.userData.mat) && o.userData.mat?.name === hl.name) o.material = on ? hlMat : (S.engine === 'Workbench' ? workbenchMat : o.userData.mat); });
  if (done) hl = null;
}
const TEX_DEF = { rep: 0.5, rot: 0, offX: 0, offY: 0, dx: false, nrm: 1, rough: 1, metal: 1, ao: 1, emis: 1, bump: 1, tint: '#ffffff' };
const ARMOR_CH = new Set(['map', 'roughnessMap', 'normalMap', 'emissiveMap']);   // TF_Armor's baked maps (applyLook) unless replaced
const texCfg = (mat, create) => S.tex[mat] ?? (create ? (S.tex[mat] = { files: {}, ...TEX_DEF }) : null);
// the panel edits the selected material's set through this proxy
const texUI = new Proxy({}, { get: (_, k) => texCfg(S.texTarget)?.[k] ?? TEX_DEF[k], set: (_, k, v) => { texCfg(S.texTarget, true)[k] = v; return true; } });
// file name -> channels, read from the END of the name (sets are "<material>_<map>_<res>": Poly Haven
// "rusty_metal_diff_2k", ambientCG "Metal032_2K-JPG_Color"), so a material called "metal…" is not a metalness map.
// ARM/ORM = packed AO (R) / roughness (G) / metalness (B), which is exactly how three samples them
const MAP_WORDS = [
  [['arm', 'orm', 'occlusionroughnessmetallic', 'occlusionroughnessmetalness'], ['aoMap', 'roughnessMap', 'metalnessMap']],
  [['normal', 'normalgl', 'normaldx', 'nor', 'nrm', 'norm'], ['normalMap']],
  [['roughness', 'rough', 'rgh'], ['roughnessMap']],
  [['metalness', 'metallic', 'metal', 'met', 'mtl'], ['metalnessMap']],
  [['ambientocclusion', 'occlusion', 'ao'], ['aoMap']],
  [['emission', 'emissive', 'emit', 'glow'], ['emissiveMap']],
  [['opacity', 'alpha', 'transparency'], ['alphaMap']],
  [['height', 'displacement', 'disp', 'bump'], ['bumpMap']],
  [['basecolor', 'base', 'color', 'colour', 'albedo', 'diffuse', 'diff', 'col', 'bc', 'd'], ['map']],
];
function detectChannels(fileName) {
  const toks = fileName.toLowerCase().replace(/\.[^.]+$/, '').split(/[\s_\-.]+/)
    .filter(t => t && !/^\d+k$/.test(t) && !/^(jpg|jpeg|png|webp|exr|tif|tiff|gl|dx|directx|opengl|\d+)$/.test(t) || /^(gl|dx|directx|opengl)$/.test(t));
  const dx = toks.some(t => t === 'dx' || t === 'directx') || /normaldx/i.test(fileName);
  for (let i = toks.length - 1; i >= 0; i--) {
    if (/^(gl|dx|directx|opengl)$/.test(toks[i])) continue;
    if (/^gloss/.test(toks[i])) return { chs: [], note: 'gloss (cần đảo thành roughness)' };
    const hit = MAP_WORDS.find(([w]) => w.includes(toks[i]));
    if (hit) return { chs: hit[1], dx: hit[1][0] === 'normalMap' && dx };
  }
  return { chs: [] };
}
const texFiles = {}, texBase = {}, texInst = {};   // file blobs, decoded base textures, per material+channel clones
const texLoader = new THREE.TextureLoader();
// a set imported in this browser (IndexedDB) wins; otherwise the copy shipped with the site (public/textures/user)
function texBaseFor(name) {
  if (!texBase[name]) {
    texBase[name] = { tex: null };
    const blob = texFiles[name], url = blob ? URL.createObjectURL(blob) : `${BASE}textures/user/${encodeURIComponent(name)}`;
    const done = () => { if (blob) URL.revokeObjectURL(url); };
    texLoader.loadAsync(url).then(t => { texBase[name].tex = t; done(); apply(); }).catch(() => { done(); matPanel?.toast(`Không đọc được "${name}"`); });
  }
  return texBase[name].tex;
}
function texFor(mat, ch, name, cfg, srgb) {
  const src = texBaseFor(name); if (!src) return null;
  const key = mat + '|' + ch;
  let t = texInst[key];
  if (!t || t.userData.src !== name) {
    t?.dispose();
    t = texInst[key] = src.clone(); t.userData.src = name;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false; t.anisotropy = 8;   // glTF UV convention
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  }
  t.repeat.set(cfg.rep, cfg.rep); t.offset.set(cfg.offX, cfg.offY); t.center.set(0.5, 0.5); t.rotation = THREE.MathUtils.degToRad(cfg.rot);
  return t;
}
// everything that changes a material's compiled shader: which maps are bound + the optional lobes
const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'];
const shaderSig = m => MAP_KEYS.map(k => m[k] ? 1 : 0).join('') + (m.clearcoat > 0) + (m.anisotropy > 0) + (m.iridescence > 0) + m.transparent;
function applyUserTextures() {
  for (const m of physMats) {
    const cfg = S.tex[m.name], b = m.userData.base, got = {};
    for (const { ch, srgb } of TEX_CH) {
      const name = cfg?.files?.[ch], t = name && texFor(m.name, ch, name, { ...TEX_DEF, ...cfg }, srgb);
      if (t) { m[ch] = t; got[ch] = true; }
      else if (!(m.name === 'TF_Armor' && ARMOR_CH.has(ch))) m[ch] = b.maps[ch] ?? null;
    }
    const c = { ...TEX_DEF, ...cfg };
    if (got.map) m.color.set(c.tint);
    if (got.normalMap) m.normalScale.set(c.nrm, c.dx ? -c.nrm : c.nrm);   // DirectX normals: green channel flipped
    else if (m.name === 'TF_Armor') m.normalScale.set(0.6, 0.6);
    if (got.roughnessMap) m.roughness = Math.max(c.rough, S.roughMin);                            // map × factor, like Sketchfab's channel factor
    if (got.metalnessMap) m.metalness = c.metal;
    m.aoMapIntensity = got.aoMap ? c.ao : 1;
    m.bumpScale = c.bump;
    if (got.emissiveMap) { m.emissive.set('#ffffff'); m.emissiveIntensity = c.emis; }
    else if (!emissiveMats.has(m)) { m.emissive.copy(b.emissive); m.emissiveIntensity = b.emissiveIntensity; }
    m.transparent = b.transparent || !!got.alphaMap;
  }
}
function importTextures(files, onlyCh) {
  const cfg = texCfg(S.texTarget, true), done = [], skipped = [];
  // packed ARM/ORM maps go last and only fill channels no dedicated file in this drop already covers
  const items = files.map(f => ({ f, d: onlyCh ? { chs: [onlyCh], dx: /dx|directx/i.test(f.name) } : detectChannels(f.name) }))
    .sort((a, b) => (a.d.chs.length > 1) - (b.d.chs.length > 1));
  const taken = new Set();
  for (const { f, d } of items) {
    if (!/\.(png|jpe?g|webp|avif)$/i.test(f.name)) { skipped.push(f.name + ' (định dạng)'); continue; }
    if (d.chs.length > 1) d.chs = d.chs.filter(ch => !taken.has(ch));
    if (!d.chs.length) { if (files.length === 1) d.chs = ['map']; else { skipped.push(f.name + (d.note ? ` (${d.note})` : '')); continue; } }
    d.chs.forEach(ch => taken.add(ch));
    texFiles[f.name] = f; delete texBase[f.name]; if (thumbURL[f.name]) { URL.revokeObjectURL(thumbURL[f.name]); delete thumbURL[f.name]; } idb.put(f.name, f, 'tex');
    d.chs.forEach(ch => { cfg.files[ch] = f.name; });
    if (d.chs.includes('normalMap')) cfg.dx = !!d.dx;
    done.push(d.chs.map(ch => TEX_CH.find(c => c.ch === ch).label).join('+') + ' ← ' + f.name);
  }
  apply(); refreshAll();
  matPanel.toast(done.length ? `Đã gán ${done.length} map` + (skipped.length ? ` · bỏ qua ${skipped.length}` : '') : 'Không nhận ra map nào' + (skipped.length ? ': ' + skipped.join(', ') : ''));
  if (done.length) console.info('[textures] ' + S.texTarget + '\n' + done.join('\n') + (skipped.length ? '\nbỏ qua: ' + skipped.join(', ') : ''));
}
// preview tile per channel: the user's file, else (TF_Armor) the baked armor map that is actually in use
const thumbURL = {};
const ARMOR_THUMB = { map: 'armor_basecolor', normalMap: 'armor_normal', roughnessMap: 'armor_roughness', emissiveMap: 'armor_emission' };
function texThumb(ch) {
  const name = texCfg(S.texTarget)?.files?.[ch];
  if (name) return texFiles[name] ? (thumbURL[name] ??= URL.createObjectURL(texFiles[name])) : null;
  if (S.texTarget === 'TF_Armor' && S.armorMaps && ARMOR_THUMB[ch]) {
    const lookDropsAlbedo = ch === 'map' && LOOKS[S.look]?.armor?.baseMap === false;
    return lookDropsAlbedo ? null : `${BASE}textures/${ARMOR_THUMB[ch]}.png`;
  }
  return null;
}
function clearTexChannel(ch) {
  const cfg = texCfg(S.texTarget); if (!cfg?.files?.[ch]) return;
  const label = TEX_CH.find(c => c.ch === ch).label;
  delete cfg.files[ch];
  if (!Object.keys(cfg.files).length) delete S.tex[S.texTarget];   // nothing left: drop the whole set, knobs back to default
  apply(); refreshAll(); matPanel.toast(`Đã gỡ ${label} — về mặc định`);
}
function clearTextures() { delete S.tex[S.texTarget]; apply(); refreshAll(); matPanel.toast(`Đã gỡ texture khỏi ${S.texTarget}`); }

function apply() {
  const S = { ...SET, ...ENGINE_OVERRIDE[SET.engine] };
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
  // HDRI backdrop = no fog; far must stay > near or GLSL smoothstep fogs everything solid
  const noFog = S.bgMode === 'HDRI' && env || cruise;
  scene.fog.near = noFog ? 1e4 : 22; scene.fog.far = noFog ? 2e4 : 70;
  ground.visible = (S.ground || running || launching) && !cruise; groundMat.color.set(S.groundColor);
  const grid = (running || launching) && S.rnGrid;
  if ((groundMat.emissiveMap === gridTex) !== grid) { groundMat.emissiveMap = grid ? gridTex : null; groundMat.needsUpdate = true; }
  groundMat.emissive.set(grid ? S.rnGridColor : '#000000');
  // lights
  fill.intensity = S.fillInt; fill.color.set(S.fillColor);
  key.intensity = S.keyInt; key.color.set(S.keyColor); rim.intensity = S.rimInt; rim.color.set(S.rimColor); hemi.intensity = S.ambient;
  key.castShadow = S.shadows && !S.sun;
  sun.visible = S.sun; sun.castShadow = S.shadows && S.sun; sun.intensity = S.sunInt; sun.color.set(S.sunColor);
  sunDisk.visible = S.sun; sunU.uCol.value.set(S.sunColor); sunU.uCorona.value = S.sunCorona; sunU.uInt.value = S.sunDiskInt;
  key.shadow.radius = sun.shadow.radius = S.shadowSoft;   // PCF blur radius, in shadow-map texels
  for (const l of [key, sun]) if (l.shadow.mapSize.x !== S.shadowRes) { l.shadow.mapSize.set(S.shadowRes, S.shadowRes); l.shadow.map?.dispose(); l.shadow.map = null; }
  // materials
  bodyMeshes.forEach(o => { o.material = wb ? workbenchMat : o.userData.mat; });
  emissiveMats.forEach((b, m) => {
    m.emissiveIntensity = wb ? 0 : b.i * S.glow;
    if (m.name === 'TF_Armor') m.emissive.set(S.glowColor);
  });
  // compare the shader signature across the WHOLE material pass (look + baked armor maps + user textures): comparing
  // inside each step missed toggles whose effect a later step masked, e.g. the armor emission map coming back on
  const sig0 = new Map(physMats.map(m => [m, shaderSig(m)]));
  applyLook();
  applyUserTextures();
  physMats.forEach(m => { if (shaderSig(m) !== sig0.get(m)) m.needsUpdate = true; });
  const graded = S.gBright !== 0 || S.gContrast !== 1 || S.gSat !== 1 || S.gTemp !== 0 || S.gTint !== 0 || S.gShAmt > 0 || S.gHiAmt > 0;
  filmic.enabled = graded || S.grain > 0 || S.vignette > 0 || S.chroma > 0;
  const FU = filmic.uniforms;
  FU.uBright.value = S.gBright; FU.uContrast.value = S.gContrast; FU.uSat.value = S.gSat; FU.uTemp.value = S.gTemp; FU.uTint.value = S.gTint;
  FU.uShCol.value.set(S.gShCol); FU.uShAmt.value = S.gShAmt; FU.uHiCol.value.set(S.gHiCol); FU.uHiAmt.value = S.gHiAmt;
  filmic.uniforms.uGrain.value = S.grain; filmic.uniforms.uVig.value = S.vignette; filmic.uniforms.uCA.value = S.chroma;
  // VFX
  U.flameInt.value = S.flameInt; U.flameSoft.value = S.flameSoft; U.flameCol.value.set(S.flameColor); U.coreCol.value.set(S.coreColor);
  flames.forEach(o => { o.visible = S.flames; o.scale.set(S.flameSpread, S.flameSpread, S.flameLen); });
  U.shockInt.value = S.shockInt; U.shockCol.value.set(S.shockColor); shocks.forEach(o => { o.visible = S.shock && !cruise; });
  U.flashInt.value = S.flashInt; flashes.forEach(o => { o.visible = S.flash && !cruise; });
  engines.forEach(e => e.l.color.set(S.flameColor));
  // space cruise stars
  starU.uLen.value = S.spLen; starU.uInt.value = S.spInt; starU.uCol.value.set(S.spColor);
  starGeo.setDrawRange(0, Math.round(STAR_N * S.spDensity) * 2);
  // post
  bloom.enabled = S.bloom && !wb; bloom.strength = S.bloomStr; bloom.radius = S.bloomRad; bloom.threshold = S.bloomThr;
  gtao.enabled = S.ao; gtao.blendIntensity = S.aoInt; gtao.updateGtaoMaterial({ radius: S.aoRadius });
  idle = 0;
  ptSync();
  try { localStorage.setItem(STORE, JSON.stringify(SET)); } catch (e) {}
}

// ---------- persistence: imported HDRI files (IndexedDB) + named setting presets ----------
const idb = (() => {
  let dbp;
  const open = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('autobot', 2);
    r.onupgradeneeded = () => ['hdri', 'tex'].forEach(n => { if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
  return {
    put: (name, file, store = 'hdri') => tx(store, 'readwrite', st => st.put(file, name)).catch(() => {}),
    del: (name, store = 'hdri') => tx(store, 'readwrite', st => st.delete(name)).catch(() => {}),
    all: async (store = 'hdri') => { try { const db = await open(); return await new Promise(res => { const out = []; const c = db.transaction(store).objectStore(store).openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); }; c.onerror = () => res(out); }); } catch (e) { return []; } },
  };
})();
const presetUI = { name: startPreset || '', draft: '' };
const savePresets = () => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); localStorage.setItem(LAST_PRESET_KEY, presetUI.name); } catch (e) {} };
// saves under the typed name; with no name typed it overwrites the selected preset (or makes "Preset N")
function savePreset() {
  const name = (presetUI.draft || '').trim() || presetUI.name || `Preset ${Object.keys(presets).length + 1}`;
  presets[name] = structuredClone(S); presetUI.name = name; presetUI.draft = ''; savePresets(); refreshAll(); panel.toast(`Đã lưu "${name}"`);
}
function loadPreset(name) {
  if (!presets[name]) return;
  Object.assign(S, DEFAULTS, presets[name]); S.tex = structuredClone(presets[name].tex ?? {});
  if (!(S.hdri in hdriTex)) S.hdri = 'Studio';
  presetUI.name = name; try { localStorage.setItem(LAST_PRESET_KEY, name); } catch (e) {}
  apply(); refreshAll(); panel.toast(`Đã tải "${name}"`);
}
function deletePreset() {
  const n = presetUI.name; if (!presets[n]) return;
  delete presets[n]; presetUI.name = Object.keys(presets)[0] || ''; savePresets(); refreshAll(); panel.toast(`Đã xoá "${n}"`);
}
function exportPreset() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `autobot-render-${presetUI.name || 'settings'}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const hdriFile = { type: 'file', title: 'Import HDRI', hint: 'Kéo thả hoặc bấm · .hdr .exr .jpg .png', accept: '.hdr,.exr,.jpg,.jpeg,.png,.webp', onFile: f => loadHDRI(f) };
// ---------- lighting presets: sun + 3-point studio (key / fill / rim), tuned for a subject on a black space backdrop ----------
// space: one hard sun, shadows near-black, the only fill is a cool bounce from a planet below (earthshine), a rim to part
// the silhouette from the void. studio: key 30-45° off axis, fill 60-90° from the key at 2:1 (product) or 4:1 (drama),
// rim behind. Exposure is part of each preset because the intensities are balanced against it.
const LIGHT_KEYS = ['exposure', 'envInt', 'ambient', 'shadows', 'shadowSoft',
  'sun', 'sunAz', 'sunEl', 'sunInt', 'sunColor', 'sunSize', 'sunCorona', 'sunDiskInt', 'flare', 'flareInt',
  'keyInt', 'keyColor', 'keyAz', 'keyEl', 'fillInt', 'fillColor', 'fillCam', 'fillAz', 'fillEl', 'rimInt', 'rimColor', 'rimAz', 'rimEl'];
const L_OFF = { sun: false, keyInt: 0, fillInt: 0, rimInt: 0, ambient: 0 };
const LIGHT_PRESETS = {
  'Vũ trụ · mặt trời gắt (thực tế NASA)': { ...L_OFF, exposure: 1, envInt: 0.08, shadows: true, shadowSoft: 1,
    sun: true, sunAz: 60, sunEl: 15, sunInt: 6, sunColor: '#fff4e8', sunSize: 0.6, sunCorona: 0.6, sunDiskInt: 1, flare: true, flareInt: 0.5,
    fillInt: 0.15, fillColor: '#6f8fb8', fillCam: false, fillAz: -120, fillEl: -30 },
  'Vũ trụ · mặt trời + ánh hành tinh (earthshine)': { ...L_OFF, exposure: 1, envInt: 0.22, ambient: 0.02, shadows: true, shadowSoft: 2,
    sun: true, sunAz: 45, sunEl: 20, sunInt: 5, sunColor: '#fff1dc', sunSize: 1, sunCorona: 0.8, sunDiskInt: 1, flare: true, flareInt: 0.6,
    fillInt: 0.6, fillColor: '#5c86c7', fillCam: false, fillAz: -135, fillEl: -35,
    rimInt: 1.2, rimColor: '#9fc4ff', rimAz: 180, rimEl: 20 },
  'Vũ trụ · điện ảnh (ánh sáng cạnh, đường terminator)': { ...L_OFF, exposure: 1.05, envInt: 0.12, shadows: true, shadowSoft: 1.5,
    sun: true, sunAz: 100, sunEl: 5, sunInt: 7, sunColor: '#ffe9d0', sunSize: 1.5, sunCorona: 1, sunDiskInt: 1.2, flare: true, flareInt: 0.8,
    fillInt: 0.25, fillColor: '#7a90b0', fillCam: false, fillAz: -90, fillEl: 0,
    rimInt: 2.5, rimColor: '#cfe0ff', rimAz: -170, rimEl: 15 },
  'Vũ trụ · ngược sáng (mặt trời sau lưng)': { ...L_OFF, exposure: 1.1, envInt: 0.15, shadows: true, shadowSoft: 2,
    sun: true, sunAz: 170, sunEl: 8, sunInt: 6, sunColor: '#fff0da', sunSize: 2, sunCorona: 1.4, sunDiskInt: 1.4, flare: true, flareInt: 1,
    keyInt: 0.4, keyColor: '#cfdcff', keyAz: 30, keyEl: 20, fillInt: 0.3, fillColor: '#6a7fa8', fillCam: true },
  'Mặt trời + 3 đèn studio (hero shot)': { ...L_OFF, exposure: 1, envInt: 0.3, ambient: 0.02, shadows: true, shadowSoft: 2.5,
    sun: true, sunAz: 30, sunEl: 25, sunInt: 4, sunColor: '#fff1dc', sunSize: 1.2, sunCorona: 0.8, sunDiskInt: 1, flare: true, flareInt: 0.5,
    keyInt: 1.5, keyColor: '#fff4e6', keyAz: 45, keyEl: 35, fillInt: 0.8, fillColor: '#bcd0ff', fillCam: false, fillAz: -60, fillEl: 10,
    rimInt: 3, rimColor: '#cfe2ff', rimAz: 175, rimEl: 20 },
  'Studio 3 điểm · sản phẩm (key:fill 2:1)': { ...L_OFF, exposure: 1, envInt: 0.5, ambient: 0.05, shadows: true, shadowSoft: 5,
    keyInt: 3, keyColor: '#fff4e6', keyAz: 40, keyEl: 35, fillInt: 1.5, fillColor: '#e8eeff', fillCam: false, fillAz: -50, fillEl: 15,
    rimInt: 2.5, rimColor: '#ffffff', rimAz: 180, rimEl: 30 },
  'Studio 3 điểm · kịch tính (key:fill 4:1)': { ...L_OFF, exposure: 1, envInt: 0.2, shadows: true, shadowSoft: 3,
    keyInt: 3.5, keyColor: '#fff2e0', keyAz: 60, keyEl: 25, fillInt: 0.9, fillColor: '#d8e2ff', fillCam: false, fillAz: -60, fillEl: 5,
    rimInt: 3.5, rimColor: '#a8c8ff', rimAz: 160, rimEl: 25 },
  'Bóng tối · chỉ viền (rim) lạnh': { ...L_OFF, exposure: 1.1, envInt: 0.05, shadows: true, shadowSoft: 2,
    keyInt: 0.25, keyColor: '#9fb6ff', keyAz: 20, keyEl: 30, rimInt: 4, rimColor: '#bfe3ff', rimAz: 180, rimEl: 12 },
};
const lightUI = { name: '' };
let lightUndo = null;
function applyLightPreset(name) {
  const p = LIGHT_PRESETS[name]; if (!p) return;
  lightUndo = Object.fromEntries(LIGHT_KEYS.map(k => [k, S[k]]));
  Object.assign(S, p); apply(); refreshAll(); lightPanel?.toast('Đã áp: ' + name + ' — có thể Hoàn tác');
}
function lightPresetUndo() {
  if (!lightUndo) return;
  Object.assign(S, lightUndo); lightUndo = null; lightUI.name = ''; apply(); refreshAll(); lightPanel?.toast('Đã hoàn tác preset ánh sáng');
}
let matPanel = null;
let lightPanel = null;
function refreshAll() { panel.refresh(); matPanel?.refresh(); lightPanel?.refresh(); }
const panel = createPanel({
  title: 'Render', state: S, defaults: DEFAULTS, storageKey: 'autobot-panel',
  footerActions: () => [{ label: 'Save', primary: true, title: 'Lưu các setting hiện tại thành preset', onClick: () => savePreset() }],
  onChange: k => {
    if (k === 'ptQuality') Object.assign(S, PT_QUALITY[S.ptQuality]);
    else if (k.startsWith?.('pt')) S.ptQuality = 'Tuỳ chỉnh';
    apply(); matPanel?.refresh(); lightPanel?.refresh();
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
      { type: 'button', label: 'Bật path tracing (Cycles)', primary: true, when: s => s.engine !== 'Cycles', onClick: () => { S.engine = 'Cycles'; apply(); refreshAll(); } },
    ] },
    { type: 'section', title: 'Preset đã lưu', open: true, controls: [
      { type: 'select', label: 'Preset', key: 'name', state: presetUI, options: () => Object.keys(presets).length ? Object.keys(presets) : ['(chưa có preset)'], onPick: v => loadPreset(v) },
      { type: 'text', key: 'draft', state: presetUI, placeholder: 'Tên preset mới (để trống = ghi đè preset đang chọn)', onEnter: () => savePreset() },
      { type: 'buttons', buttons: [{ label: 'Lưu', primary: true, onClick: () => savePreset() }, { label: 'Xoá', confirm: true, confirmLabel: 'Xoá thật?', onClick: () => deletePreset() }, { label: 'Export', onClick: () => exportPreset() }] },
      { type: 'button', label: 'Đặt góc camera hiện tại làm mặc định', onClick: () => saveCamView() },
      { type: 'button', label: 'Về góc camera mặc định', when: () => !!S.camOff, onClick: () => { restoreCamView(); panel.toast('Đã về góc camera mặc định'); } },
    ] },
    { type: 'section', title: 'Color management', controls: [
      { type: 'select', key: 'name', state: cmUI, label: 'Preset màu', options: () => ['(chọn preset)', ...Object.keys(CM_PRESETS)],
        onPick: v => { if (!CM_PRESETS[v]) return; Object.assign(S, CM_BASE, CM_PRESETS[v]); apply(); refreshAll(); panel.toast(v); } },
      { type: 'select', key: 'view', label: 'View transform', options: Object.keys(TONE) },
      { type: 'slider', key: 'gContrast', label: 'Contrast', min: 0.5, max: 2, step: 0.01 },
      { type: 'slider', key: 'gBright', label: 'Brightness', min: -0.3, max: 0.3, step: 0.005 },
      { type: 'slider', key: 'gSat', label: 'Saturation', min: 0, max: 2, step: 0.01 },
      { type: 'slider', key: 'gTemp', label: 'Nhiệt màu (lạnh ↔ ấm)', min: -1, max: 1, step: 0.01 },
      { type: 'slider', key: 'gTint', label: 'Tint (xanh lá ↔ hồng)', min: -1, max: 1, step: 0.01 },
      { type: 'slider', key: 'gShAmt', label: 'Nhuộm vùng tối', min: 0, max: 1, step: 0.01 },
      { type: 'color', key: 'gShCol', label: 'Màu vùng tối', when: s => s.gShAmt > 0 },
      { type: 'slider', key: 'gHiAmt', label: 'Nhuộm vùng sáng', min: 0, max: 1, step: 0.01 },
      { type: 'color', key: 'gHiCol', label: 'Màu vùng sáng', when: s => s.gHiAmt > 0 },
      { type: 'slider', key: 'exposure', label: 'Exposure', min: 0, max: 3, step: 0.01 },
    ] },
    { type: 'section', title: 'Bay vũ trụ', open: true, controls: [
      { type: 'button', label: 'Bật / tắt bay vũ trụ', primary: true, onClick: () => $('space').click() },
      { type: 'slider', key: 'spSpeed', label: 'Tốc độ bay', min: 0, max: 250, step: 1, unit: ' m/s' },
      { type: 'slider', key: 'spDensity', label: 'Mật độ sao', min: 0.05, max: 1, step: 0.01, format: v => Math.round(v * 100) + '%' },
      { type: 'slider', key: 'spLen', label: 'Độ dài vệt sao', min: 0, max: 12, step: 0.1, unit: ' m' },
      { type: 'slider', key: 'spInt', label: 'Độ sáng sao', min: 0, max: 4, step: 0.01 },
      { type: 'color', key: 'spColor', label: 'Màu sao' },
      { type: 'slider', key: 'spBank', label: 'Nghiêng cánh (bank)', min: 0, max: 25, step: 0.1, unit: '°' },
      { type: 'slider', key: 'spPitch', label: 'Ngóc mũi (pitch)', min: 0, max: 15, step: 0.1, unit: '°' },
      { type: 'slider', key: 'spYaw', label: 'Lắc hướng (yaw)', min: 0, max: 15, step: 0.1, unit: '°' },
      { type: 'slider', key: 'spBob', label: 'Nhấp nhô', min: 0, max: 1, step: 0.01, unit: ' m' },
      { type: 'slider', key: 'spSwaySpeed', label: 'Nhịp chòng chành', min: 0, max: 4, step: 0.01, format: v => '×' + (+v).toFixed(2) },
      { type: 'switch', key: 'spEngine', label: 'Tiếng động cơ' },
      { type: 'slider', key: 'spEngineVol', label: 'Âm lượng động cơ', min: 0, max: 2, step: 0.01, when: s => s.spEngine },
      { type: 'segmented', key: 'spEngineTake', label: 'Bản tiếng', options: [{ value: 1, label: 'Bản 1' }, { value: 2, label: 'Bản 2' }], when: s => s.spEngine },
      { type: 'switch', key: 'spWheels', label: 'Bánh xe quay' },
      { type: 'slider', key: 'spWheelSpeed', label: 'Tốc độ bánh', min: 0, max: 120, step: 1, unit: '°/s', when: s => s.spWheels },
      { type: 'slider', key: 'spHubSpeed', label: 'Tốc độ lõi bánh', min: 0, max: 1440, step: 1, unit: '°/s' },
    ] },
    { type: 'section', title: 'Âm thanh', open: true, controls: [
      { type: 'slider', key: 'masterVol', label: 'Âm lượng tổng', min: 0, max: 2, step: 0.01, format: v => Math.round(v * 100) + '%' },
      { type: 'switch', key: 'chatOn', label: 'Tiếng robot liên lạc (khi bay vũ trụ)' },
      { type: 'slider', key: 'chatVol', label: 'Âm lượng liên lạc', min: 0, max: 2, step: 0.01, when: s => s.chatOn },
      { type: 'slider', key: 'chatEvery', label: 'Khoảng cách trung bình', min: 5, max: 120, step: 1, unit: ' s', when: s => s.chatOn },
    ] },
    { type: 'section', title: 'Robot', open: true, controls: [
      { type: 'button', label: 'Mở / đóng mặt nạ', primary: true, onClick: () => $('mask').click() },
      { type: 'slider', key: 'maskTime', label: 'Thời gian mở mặt nạ', min: 0.15, max: 2, step: 0.01, unit: ' s' },
      { type: 'slider', key: 'coreSpeed', label: 'Lò phản ứng xoay', min: 0, max: 180, step: 1, unit: '°/s' },
      { type: 'switch', key: 'camFront', label: 'Camera vòng ra trước khi thành robot' },
      { type: 'slider', key: 'camFrontAngle', label: 'Góc lệch khi nhìn trước', min: 0, max: 60, step: 1, unit: '°', when: s => s.camFront },
    ] },
    { type: 'section', title: 'Đứng (idle)', open: true, controls: [
      { type: 'button', label: 'Bật / tắt đứng', primary: true, onClick: () => $('stand').click() },
      { type: 'switch', key: 'stHips', label: 'Chống tay vào eo' },
      { type: 'slider', key: 'stLook', label: 'Ngó quanh', min: 0, max: 40, step: 0.5, unit: '°' },
      { type: 'slider', key: 'stTwist', label: 'Xoay người qua lại', min: 0, max: 15, step: 0.5, unit: '°' },
      { type: 'slider', key: 'stSpeed', label: 'Nhịp', min: 0.2, max: 3, step: 0.01, format: v => '×' + (+v).toFixed(2) },
    ] },
    { type: 'section', title: 'Chạy (robot)', open: true, controls: [
      { type: 'button', label: 'Bật / tắt chạy', primary: true, onClick: () => $('run').click() },
      { type: 'slider', key: 'rnCycle', label: 'Thời gian 1 sải (2 bước)', min: 0.4, max: 2, step: 0.01, unit: ' s' },
      { type: 'slider', key: 'rnStride', label: 'Độ dài sải chân', min: 0.3, max: 1.6, step: 0.01, format: v => '×' + (+v).toFixed(2) },
      { type: 'slider', key: 'rnLean', label: 'Đổ người về trước', min: 0, max: 30, step: 0.5, unit: '°' },
      { type: 'slider', key: 'rnArm', label: 'Vung tay', min: 0, max: 2, step: 0.01, format: v => '×' + (+v).toFixed(2) },
      { type: 'slider', key: 'rnBounce', label: 'Nảy (lúc bay người)', min: 0, max: 3, step: 0.01, format: v => '×' + (+v).toFixed(2) },
      { type: 'switch', key: 'rnSound', label: 'Tiếng dậm chân (uỳnh)' },
      { type: 'slider', key: 'rnStompVol', label: 'Âm lượng dậm', min: 0, max: 3, step: 0.01, when: s => s.rnSound },
      { type: 'slider', key: 'rnShake', label: 'Rung camera mỗi bước', min: 0, max: 3, step: 0.01 },
      { type: 'switch', key: 'rnGrid', label: 'Lưới mặt đất khi chạy' },
      { type: 'color', key: 'rnGridColor', label: 'Màu lưới', when: s => s.rnGrid },
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

// ---------- materials panel: its own window, bottom-left, opened from the corner button ----------
matPanel = createPanel({
  title: 'Vật liệu', state: S, defaults: DEFAULTS, storageKey: 'autobot-mat-panel', className: 'tc-panel--left', resettable: false,
  footerActions: () => [{ label: 'Save', primary: true, title: 'Lưu các setting hiện tại thành preset', onClick: () => savePreset() }],
  onChange: k => { apply(); panel.refresh(); lightPanel?.refresh(); if (k === 'texTarget') highlightMat(S.texTarget); },
  schema: [
    { type: 'section', title: 'Vật liệu', controls: [
      { type: 'slider', key: 'glow', label: 'Glow (đèn xanh)', min: 0, max: 5, step: 0.01 },
      { type: 'color', key: 'glowColor', label: 'Màu glow' },
      { type: 'switch', key: 'armorMaps', label: 'Texture giáp' },
    ] },
    { type: 'section', title: 'Texture vật liệu', open: true, controls: [
      { type: 'select', key: 'texTarget', label: 'Vật liệu', options: () => physMats.map(m => ({ value: m.name, label: MAT_INFO[m.name]?.label ?? m.name })) },
      { type: 'note', text: () => `<b>${S.texTarget}</b> — ${MAT_INFO[S.texTarget]?.where ?? ''}` },
      { type: 'button', label: 'Nhấp nháy vị trí trên robot', onClick: () => highlightMat(S.texTarget) },
      { type: 'file', title: 'Import bộ texture', hint: 'Kéo thả nhiều file · tự nhận Color / Normal (GL/DX) / Roughness / Metal / AO / ARM / Emission / Opacity / Height', accept: '.png,.jpg,.jpeg,.webp,.avif', multiple: true, onFiles: f => importTextures(f) },
      ...TEX_CH.map(({ ch, label, info }) => ({ type: 'file', compact: true, accept: '.png,.jpg,.jpeg,.webp,.avif',
        title: () => `${label}: ${texCfg(S.texTarget)?.files?.[ch] ?? (texThumb(ch) ? '(gốc)' : '—')}`, hint: info, onFile: f => importTextures([f], ch),
        thumb: () => texThumb(ch),
        canClear: () => !!texCfg(S.texTarget)?.files?.[ch], clearTitle: `Gỡ ${label}, về mặc định`, onClear: () => clearTexChannel(ch) })),
      { type: 'slider', key: 'rep', state: texUI, default: TEX_DEF.rep, label: 'Lặp (tiling)', min: 0.02, max: 10, step: 0.01 },
      { type: 'slider', key: 'rot', state: texUI, default: 0, label: 'Xoay texture', min: -180, max: 180, step: 1, unit: '°' },
      { type: 'slider', key: 'offX', state: texUI, default: 0, label: 'Dịch U', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'offY', state: texUI, default: 0, label: 'Dịch V', min: 0, max: 1, step: 0.01 },
      { type: 'color', key: 'tint', state: texUI, label: 'Màu phủ base color', when: () => !!texCfg(S.texTarget)?.files?.map },
      { type: 'slider', key: 'nrm', state: texUI, default: 1, label: 'Cường độ normal', min: 0, max: 3, step: 0.01, when: () => !!texCfg(S.texTarget)?.files?.normalMap },
      { type: 'switch', key: 'dx', state: texUI, label: 'Normal kiểu DirectX (lật kênh G)', when: () => !!texCfg(S.texTarget)?.files?.normalMap },
      { type: 'slider', key: 'rough', state: texUI, default: 1, label: 'Roughness ×', min: 0, max: 2, step: 0.01, when: () => !!texCfg(S.texTarget)?.files?.roughnessMap },
      { type: 'slider', key: 'metal', state: texUI, default: 1, label: 'Metalness ×', min: 0, max: 2, step: 0.01, when: () => !!texCfg(S.texTarget)?.files?.metalnessMap },
      { type: 'slider', key: 'ao', state: texUI, default: 1, label: 'Cường độ AO', min: 0, max: 2, step: 0.01, when: () => !!texCfg(S.texTarget)?.files?.aoMap },
      { type: 'slider', key: 'emis', state: texUI, default: 1, label: 'Cường độ phát sáng', min: 0, max: 10, step: 0.01, when: () => !!texCfg(S.texTarget)?.files?.emissiveMap },
      { type: 'slider', key: 'bump', state: texUI, default: 1, label: 'Độ nổi (bump)', min: 0, max: 5, step: 0.01, when: () => !!texCfg(S.texTarget)?.files?.bumpMap },
      { type: 'button', label: 'Gỡ texture khỏi vật liệu này', confirm: true, confirmLabel: 'Bấm lần nữa để gỡ', when: () => !!texCfg(S.texTarget), onClick: () => clearTextures() },
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
  ],
});
// ---------- lighting panel: HDRI / world, sun, soft light & gloss, lamps + shadows ----------
lightPanel = createPanel({
  title: 'Ánh sáng', state: S, defaults: DEFAULTS, storageKey: 'autobot-light-panel', className: 'tc-panel--left', resettable: false,
  footerActions: () => [{ label: 'Save', primary: true, title: 'Lưu các setting hiện tại thành preset', onClick: () => savePreset() }],
  onChange: () => { apply(); panel.refresh(); matPanel.refresh(); },
  schema: [
    { type: 'section', title: 'Preset ánh sáng', open: true, controls: [
      { type: 'select', key: 'name', state: lightUI, label: 'Preset (mặt trời + 3 đèn studio)', options: () => ['(chọn preset)', ...Object.keys(LIGHT_PRESETS)], onPick: v => applyLightPreset(v) },
      { type: 'note', text: 'Chỉ đổi đèn, mặt trời, bóng đổ, cường độ HDRI và exposure. Vật liệu, màu, bloom giữ nguyên. Bấm Save để giữ.' },
      { type: 'button', label: 'Hoàn tác preset ánh sáng', onClick: () => lightPresetUndo() },
    ] },
    { type: 'section', title: 'World', open: true, controls: [
      { type: 'select', key: 'hdri', label: 'HDRI', options: () => Object.keys(hdriTex) },
      hdriFile,
      { type: 'button', label: 'Xoá HDRI đang chọn', confirm: true, confirmLabel: 'Bấm lần nữa để xoá', when: s => !(s.hdri in BUILTIN_HDRI) && !SHIPPED_HDRI.includes(s.hdri), onClick: () => deleteHDRI() },
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
    { type: 'section', title: 'Ánh sáng mềm & độ bóng', open: true, controls: [
      { type: 'slider', key: 'roughMin', label: 'Độ nhám tối thiểu (satin → mờ)', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'specScale', label: 'Độ phản xạ bề mặt (specular)', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'coatSoft', label: 'Làm mờ lớp phủ bóng', min: 0, max: 1, step: 0.01 },
      { type: 'slider', key: 'fillInt', label: 'Đèn fill mềm (từ phía camera)', min: 0, max: 5, step: 0.01 },
      { type: 'color', key: 'fillColor', label: 'Màu fill', when: s => s.fillInt > 0 },
      { type: 'slider', key: 'shadowSoft', label: 'Độ mềm bóng', min: 0, max: 12, step: 0.1, when: s => s.shadows },
    ] },
    { type: 'section', title: 'Đèn', controls: [
      { type: 'buttons', buttons: [
        { label: 'Làm dịu độ bóng (1 chạm)', primary: true, onClick: () => softLight() },
        { label: 'Hoàn tác', onClick: () => softLightUndo() } ] },
      { type: 'slider', key: 'keyInt', label: 'Key light (đèn chính)', min: 0, max: 10, step: 0.05 },
      { type: 'color', key: 'keyColor', label: 'Màu key' },
      { type: 'slider', key: 'keyAz', label: 'Hướng key (0° = trước mặt robot)', min: -180, max: 180, step: 1, unit: '°' },
      { type: 'slider', key: 'keyEl', label: 'Độ cao key', min: -60, max: 89, step: 1, unit: '°' },
      { type: 'slider', key: 'rimInt', label: 'Rim light (đèn viền sau lưng)', min: 0, max: 10, step: 0.05 },
      { type: 'color', key: 'rimColor', label: 'Màu rim' },
      { type: 'slider', key: 'rimAz', label: 'Hướng rim', min: -180, max: 180, step: 1, unit: '°' },
      { type: 'slider', key: 'rimEl', label: 'Độ cao rim', min: -60, max: 89, step: 1, unit: '°' },
      { type: 'switch', key: 'fillCam', label: 'Fill đi theo camera' },
      { type: 'slider', key: 'fillAz', label: 'Hướng fill', min: -180, max: 180, step: 1, unit: '°', when: s => !s.fillCam },
      { type: 'slider', key: 'fillEl', label: 'Độ cao fill (âm = hắt từ dưới)', min: -60, max: 89, step: 1, unit: '°', when: s => !s.fillCam },
      { type: 'slider', key: 'ambient', label: 'Ambient', min: 0, max: 3, step: 0.01 },
      { type: 'switch', key: 'shadows', label: 'Bóng đổ' },
      { type: 'segmented', key: 'shadowRes', label: 'Độ nét bóng', options: [{ value: 1024, label: '1K' }, { value: 2048, label: '2K' }, { value: 4096, label: '4K' }], when: s => s.shadows },
    ] },
  ],
});
// corner dock: one round button per side panel, bottom-left; only one side panel open at a time
const SIDE_KEY = 'autobot-side-open';
const ICONS = {
  mat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7.2"/><path d="M4.2 7.2c2.6 1.6 9 1.6 11.6 0M3.4 11.2c3 2 10.2 2 13.2 0"/><path d="M10 2.8c-2.2 2.2-2.2 12.2 0 14.4"/></svg>',
  light: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></svg>',
};
const SIDE_PANELS = { mat: { panel: matPanel, title: 'Vật liệu' }, light: { panel: lightPanel, title: 'Ánh sáng' } };
Object.entries(SIDE_PANELS).forEach(([id, sp], i) => {
  sp.btn = Object.assign(document.createElement('button'), { className: 'tc-fab tc-surface', title: sp.title, innerHTML: ICONS[id] });
  sp.btn.setAttribute('aria-label', 'Mở bảng ' + sp.title); sp.btn.style.left = (12 + i * 52) + 'px';
  sp.btn.onclick = () => openSide(sp.panel.root.hidden ? id : null);
  document.body.append(sp.btn);
});
function openSide(id) {
  Object.entries(SIDE_PANELS).forEach(([k, sp]) => { const on = k === id; sp.panel.root.hidden = !on; sp.btn.setAttribute('aria-pressed', String(on)); if (on) sp.panel.refresh(); });
  try { localStorage.setItem(SIDE_KEY, id || ''); } catch (e) {}
}
openSide((() => { try { return localStorage.getItem(SIDE_KEY) || (localStorage.getItem('autobot-mat-open') === '1' ? 'mat' : null); } catch (e) { return null; } })());

// one click "soft light": makes the LIGHT on the hull gentler (less mirror-like, softer highlights and shadows) and
// nothing else — no bloom/glow, no grain, no tone-mapping change. The previous values are kept for one-click undo.
const SOFT_KEYS = ['roughMin', 'specScale', 'coatSoft', 'shadowSoft', 'fillInt', 'envRefl'];
let softUndo = null;
function softLight() {
  softUndo = Object.fromEntries(SOFT_KEYS.map(k => [k, S[k]]));
  Object.assign(S, { roughMin: Math.max(S.roughMin, 0.3), specScale: Math.min(S.specScale, 0.6), coatSoft: Math.max(S.coatSoft, 0.3),
    shadowSoft: Math.max(S.shadowSoft, 5), fillInt: Math.max(S.fillInt, 0.4), envRefl: Math.min(S.envRefl, 1.2) });
  apply(); refreshAll(); panel.toast('Đã làm dịu độ bóng — có thể Hoàn tác');
}
function softLightUndo() {
  if (!softUndo) return;
  Object.assign(S, softUndo); softUndo = null; apply(); refreshAll(); panel.toast('Đã hoàn tác');
}
// one click "ship in space": sun is the only strong light, no ground, near-black ambient
function spaceMode() {
  const custom = S.hdri !== 'Studio' && S.hdri !== 'Không' && hdriTex[S.hdri];
  Object.assign(S, { sun: true, sunInt: 5, ground: false, keyInt: 0, rimInt: 0.25, ambient: 0.02, envInt: custom ? 0.35 : 0.15,
    bgMode: custom ? 'HDRI' : 'Màu', bgColor: '#000000', bgBlur: 0, bloom: true, flare: true });
  apply(); refreshAll();
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
    apply(); refreshAll(); panel.toast(`Đã import và lưu HDRI "${name}"`);
  } catch (e) { alert('Không đọc được HDRI: ' + e.message); }
}
function deleteHDRI() {
  const n = S.hdri; if (n in BUILTIN_HDRI || SHIPPED_HDRI.includes(n)) return;
  hdriTex[n]?.dispose(); delete hdriTex[n]; idb.del(n); S.hdri = 'Studio'; apply(); refreshAll();
}
boot.waits.push(idb.all('tex').then(list => { list.forEach(([name, file]) => { texFiles[name] = file; }); if (list.length) { apply(); refreshAll(); } }));
// restore previously imported HDRIs
boot.waits.push(idb.all().then(async list => {
  for (const [name, file] of list) { try { hdriTex[name] = await decodeHDRI(file); } catch (e) {} }
  if (wantedHdri in hdriTex) S.hdri = wantedHdri;
  if (list.length) { apply(); refreshAll(); }
}));
boot.waits.push(Promise.all(SHIPPED_HDRI.map(async n => {
  try { const t = await new HDRLoader().loadAsync(`${BASE}hdri/${n}.hdr`); t.mapping = THREE.EquirectangularReflectionMapping; hdriTex[n] ??= t; } catch (e) {}
})).then(() => { if (wantedHdri in hdriTex) S.hdri = wantedHdri; apply(); refreshAll(); }));
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadHDRI(f); });
apply();

// ---------- sound ----------
const listener = new THREE.AudioListener(); camera.add(listener);
const aload = new THREE.AudioLoader();
const buffers = {};
const HUMS = ['sfx/engine_hum1.mp3', 'sfx/engine_hum2.mp3'];   // AI-generated seamless cruise loops
const CHATTER = Array.from({ length: 10 }, (_, i) => `sfx/chatter${i + 1}.mp3`);   // AI-generated garbled robot comm bursts
await Promise.all([...new Set([...meta.sfx.map(c => c.file), ...STOMPS, ...HUMS, ...CHATTER])].map(async f => { buffers[f] = await aload.loadAsync(BASE + f); }));
const live = [];
function fire(c) {
  const a = new THREE.Audio(listener); a.setBuffer(buffers[c.file]); a.setVolume(c.volume);
  a.play(); live.push(a);
  const dur = (c.end - c.frame) / FPS; setTimeout(() => { try { a.stop(); } catch (e) {} }, dur * 1000);
}
addEventListener('pointerdown', () => listener.context.resume(), { once: true });
let appliedVol = -1;
// engine hum while flying: fades in at ignition during the launch, holds through the cruise, fades out on exit
const hum = new THREE.Audio(listener); hum.setLoop(true);
let humVol = 0, humTake = '';
// space cruise only: now and then a burst of garbled robot comm chatter; shuffle-bag order, so all takes play before any repeats
let chatterIn = 8, chatterBag = [], lastChatter = -1;
function updateChatter(dt) {
  if (!S.chatOn || !cruise || listener.context.state !== 'running') { chatterIn = 5 + Math.random() * 5; return; }   // first burst 5–10 s into a cruise
  chatterIn -= dt;
  if (chatterIn > 0) return;
  if (!chatterBag.length) {
    chatterBag = CHATTER.map((_, j) => j).sort(() => Math.random() - 0.5);
    if (chatterBag[chatterBag.length - 1] === lastChatter) chatterBag.unshift(chatterBag.pop());   // no back-to-back repeat across bags
  }
  const i = chatterBag.pop(); lastChatter = i;
  const a = new THREE.Audio(listener); a.setBuffer(buffers[CHATTER[i]]); a.setVolume(S.chatVol); a.setPlaybackRate(0.9 + Math.random() * 0.15);
  a.play(); setTimeout(() => { try { a.stop(); } catch (e) {} }, 6000);
  chatterIn = S.chatEvery * (0.6 + Math.random() * 0.8);   // ±40% around the chosen spacing
}
function updateHum(dt) {
  const flying = cruise || (launching && cur > 102);
  const target = S.spEngine && flying ? S.spEngineVol : 0;
  humVol += (target - humVol) * Math.min(1, dt * 1.5);
  const take = HUMS[S.spEngineTake - 1] || HUMS[0];
  if (humVol > 0.002) {
    if (take !== humTake) { if (hum.isPlaying) hum.stop(); hum.setBuffer(buffers[take]); hum.setLoopStart(0.03); hum.setLoopEnd(buffers[take].duration - 0.03); humTake = take; }
    if (!hum.isPlaying && listener.context.state === 'running') hum.play();
    hum.setVolume(humVol);
    hum.setPlaybackRate(launching ? 0.9 + Math.min(0.3, LS.v / 300) : 1);   // spools up with the launch speed
  } else if (hum.isPlaying) hum.pause();
}   // master volume goes through the listener, so every sound (clips, stomps, mask) follows it

// ---------- UI ----------
const $ = id => document.getElementById(id);
const PLAY = '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M4 2.5v9l7.5-4.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M3.5 2.5h2.5v9H3.5zM8 2.5h2.5v9H8z"/></svg>';
const setPlaying = p => { playing = p; $('play').innerHTML = p ? PAUSE : PLAY; $('play').setAttribute('aria-pressed', String(p)); };
function setCruise(on) {
  cruise = on; pendingCruise = false; $('space').setAttribute('aria-pressed', String(on));
  stars.visible = on; cruiseFade = 0; starU.uFade.value = 0; wheelSpin = hubSpin = 0; setHubSpin(0);
  if (on) { setFrame(CRUISE_FRAME); wheels.forEach(w => w.base.copy(w.b.quaternion)); }
  else { model.position.set(0, 0, 0); model.quaternion.identity(); cruiseBase.identity(); cruiseOrigin.set(0, 0, 0); wheels.forEach(w => w.b.quaternion.copy(w.base)); setFrame(cur); }
  apply();
}
function setRun(on) {
  if (on && cruise) setCruise(false);
  if (on && standing) setStand(false);
  running = on; pendingRun = false; $('run').setAttribute('aria-pressed', String(on));
  runFade = 0; runPhase = 0; runSpeed = 0; stanceSide = -1; contact.fill(false);
  if (on) {
    runFrame = cur >= 205 ? meta.frameEnd : meta.frameStart; cur = runFrame;
    setFrame(runFrame); runZ = 0; model.position.set(0, 0, 0); model.updateMatrixWorld(true);
    Object.values(RJ).forEach(b => { runBase.set(b, b.quaternion.clone()); runBasePos.set(b, b.position.clone()); });
    restSoleY = soleMinY();   // rest height of the lowest sole point
  } else {
    runBase.forEach((q, b) => b.quaternion.copy(q)); runBasePos.forEach((p, b) => b.position.copy(p)); hands.forEach(h => curlHand(h, 0)); model.position.set(0, 0, 0); setFrame(cur);
  }
  apply();
}
function setStand(on) {
  if (on) { if (cruise) setCruise(false); if (running) setRun(false); }
  standing = on; pendingStand = false; $('stand').setAttribute('aria-pressed', String(on));
  standFade = 0;
  if (on) {
    const f = cur >= 205 ? meta.frameEnd : meta.frameStart; cur = f; setFrame(f); model.position.set(0, 0, 0); model.quaternion.identity();
    Object.values(RJ).forEach(b => { runBase.set(b, b.quaternion.clone()); runBasePos.set(b, b.position.clone()); });
  } else {
    runBase.forEach((q, b) => b.quaternion.copy(q)); runBasePos.forEach((p, b) => b.position.copy(p)); hands.forEach(h => curlHand(h, 0)); setFrame(cur);
  }
  apply();
}
function playRange(a, b) { if (launching) { stopLaunch(); model.position.set(0, 0, 0); model.quaternion.identity(); } if (cruise) setCruise(false); if (running) setRun(false); if (standing) setStand(false); pendingCruise = pendingRun = pendingStand = false; range = [a, b]; setFrame(a); setPlaying(true); }
$('play').onclick = () => { if (cruise) { setCruise(false); return; } if (running) { setRun(false); return; } if (standing) { setStand(false); return; } if (!playing && cur >= range[1]) setFrame(range[0]); setPlaying(!playing); };
$('toJet').onclick = () => playRange(...meta.clips.toJet);
$('toRobot').onclick = () => playRange(...meta.clips.toRobot);
// robot → jet first when needed, then cruise
$('space').onclick = () => {
  if (cruise) { setCruise(false); return; }
  if (launching) return;
  if (standing) setStand(false);
  if (running) { startLaunch(); return; }
  if (Math.round(cur) === CRUISE_FRAME) { setCruise(true); return; }
  playRange(...meta.clips.toJet); pendingCruise = true; $('space').setAttribute('aria-pressed', 'true');
};
// jet → robot first when needed, then run
$('run').onclick = () => {
  if (running) { setRun(false); return; }
  if (cruise) setCruise(false);
  if (cur <= 21 || cur >= 220) { setRun(true); return; }
  playRange(...meta.clips.toRobot); pendingRun = true; $('run').setAttribute('aria-pressed', 'true');
};
// jet → robot first when needed, then stand
$('stand').onclick = () => {
  if (standing) { setStand(false); return; }
  if (cruise) setCruise(false);
  if (running || cur <= 21 || cur >= 220) { setStand(true); return; }
  playRange(...meta.clips.toRobot); pendingStand = true; $('stand').setAttribute('aria-pressed', 'true');
};
$('mask').onclick = () => {
  maskOpen = !maskOpen; $('mask').setAttribute('aria-pressed', String(maskOpen));
  if (buffers['sfx/clank1.mp3']) fire({ file: 'sfx/clank1.mp3', volume: 0.35, frame: 0, end: 12 });
};
let follow = true; $('follow').onclick = () => { follow = !follow; $('follow').setAttribute('aria-pressed', String(follow)); };
const scrub = slider({ min: meta.frameStart, max: meta.frameEnd, step: 1, get: () => cur, set: v => { if (cruise || pendingCruise) setCruise(false); if (running || pendingRun) setRun(false); if (standing || pendingStand) setStand(false); setPlaying(false); setFrame(v); idle = 0; } });
$('scrub').replaceWith(scrub.el);
setPlaying(false);

// ---------- loop ----------
const clock = new THREE.Timer();
const tmp = new THREE.Vector3();
let fpsN = 0, fpsT = 0;
controls.addEventListener('change', () => { idle = 0; });
// jet -> robot: as the landing finishes, swing the camera round to the robot's front (it faces +Z) if it is behind.
// Only the azimuth moves (distance / height stay yours), it settles a little off-axis on the side you were on,
// and it never fights a drag in progress.
let userDragging = false;
controls.addEventListener('start', () => { userDragging = true; });
controls.addEventListener('end', () => { userDragging = false; });
const camOff = new THREE.Vector3(), camSph = new THREE.Spherical();
function frontCam(dt) {
  const [a, b] = meta.clips.toRobot;
  if (!S.camFront || !playing || userDragging || range[0] !== a || range[1] !== b) return;
  const u = THREE.MathUtils.smoothstep(cur, 195, 235);   // lands 205-220
  if (u <= 0) return;
  camOff.copy(camera.position).sub(controls.target); camSph.setFromVector3(camOff);   // theta 0 = +Z = robot's front
  const side = Math.sign(camSph.theta) || 1, want = side * THREE.MathUtils.degToRad(S.camFrontAngle);
  if (Math.abs(camSph.theta) <= Math.abs(want) + 1e-3) return;                     // already in front
  let d = want - camSph.theta; d = Math.atan2(Math.sin(d), Math.cos(d));
  camSph.theta += d * (1 - Math.exp(-dt * 4 * u));
  camera.position.copy(controls.target).add(camOff.setFromSpherical(camSph));
}
setFrame(1);
// default camera view, stored with the settings (so presets / the shipped site carry it) RELATIVE to the robot's root:
// wherever the robot is when you save, opening the site frames the idle robot the same way
function saveCamView() {
  S.startMode = cruise ? 'cruise' : standing ? 'stand' : running ? 'run' : 'idle';   // the scene the view belongs to
  rootBone.getWorldPosition(tmp);
  S.camOff = camera.position.clone().sub(controls.target).toArray().map(v => +v.toFixed(3));
  S.camTgt = controls.target.clone().sub(tmp).toArray().map(v => +v.toFixed(3));
  apply(); refreshAll(); panel.toast(`Đã lưu góc camera (${{ cruise: 'bay vũ trụ', stand: 'đứng', run: 'chạy', idle: 'robot đứng yên' }[S.startMode]}) — bấm Save để lưu vào preset`);
}
function restoreCamView() {
  if (!S.camOff) return;
  rootBone.getWorldPosition(tmp);
  controls.target.copy(tmp).add(new THREE.Vector3().fromArray(S.camTgt ?? [0, 2.6, 0]));
  camera.position.copy(controls.target).add(new THREE.Vector3().fromArray(S.camOff));
  controls.update();
}
// open in the scene the default view was saved in, then frame it
if (S.startMode === 'cruise') { cur = CRUISE_FRAME; setCruise(true); updateCruise(1 / 60); }
else if (S.startMode === 'stand') setStand(true);
else if (S.startMode === 'run') setRun(true);
restoreCamView();
// everything the first view needs has been kicked off: wait for the async restores, then let the loop reveal the page
Promise.allSettled(boot.waits).then(() => { boot.initDone = true; });
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
    if (!playing && pendingCruise) { cur = CRUISE_FRAME; setCruise(true); }
    if (!playing && pendingRun) setRun(true);
    if (!playing && pendingStand) setStand(true);
  }
  if (cruise) updateCruise(dt);
  if (running) updateRun(dt);
  if (standing) updateStand(dt);
  if (launching) updateLaunch(dt);
  updateHum(dt);
  updateChatter(dt);
  bootTick();
  if (S.masterVol !== appliedVol) { listener.setMasterVolume(S.masterVol); appliedVol = S.masterVol; }
  updateRobotExtras(dt);
  updateHighlight(dt);
  scrub.draw(); $('frame').textContent = cruise ? 'vũ trụ' : running ? 'chạy' : standing ? 'đứng' : launching ? 'cất cánh' : 'f ' + Math.round(cur);
  fpsN++; fpsT += dt; if (fpsT > 0.5) { panel.setStatus(`${Math.round(fpsN / fpsT)} fps · ${renderer.domElement.width}×${renderer.domElement.height}`); fpsN = fpsT = 0; }
  engines.forEach(e => { e.l.intensity = S.flames ? S.flameLight * 8 * Math.max(e.o.scale.x, e.o.scale.z) * S.flameInt : 0; });
  shocks.forEach(o => { const k = o.scale.x / (shockMax[o.name] || 1); o.material.uniforms.uFade.value = Math.pow(Math.max(0, 1 - k), 1.3); });
  if (rootBone) {
    rootBone.getWorldPosition(tmp);
    key.target.position.copy(tmp); key.position.copy(tmp).addScaledVector(lightDir(S.keyAz, S.keyEl, dirTmp), 14);
    rim.target.position.copy(tmp); rim.position.copy(tmp).addScaledVector(lightDir(S.rimAz, S.rimEl, dirTmp), 14);
    if (follow) {
      tmp.y += 2.6;
      // lazy follow on the ground; during the launch it locks on harder as the jet speeds up, so the climb stays in frame
      const stiff = launching ? (LS.phase === 'climb' ? 25 : 10) : 0;
      const a = stiff ? 1 - Math.exp(-dt * stiff) : 0.08;
      const d = tmp.clone().sub(controls.target); controls.target.add(d.multiplyScalar(a)); camera.position.add(d);
    }
  }
  frontCam(dt);
  controls.update();
  if (S.fillCam) { fill.position.copy(camera.position); fill.target.position.copy(controls.target); }
  else { fill.target.position.copy(key.target.position); fill.position.copy(key.target.position).addScaledVector(lightDir(S.fillAz, S.fillEl, dirTmp), 14); }
  if (S.sun) updateSun(dt);
  // footfall camera shake: offset only for this frame's render, so OrbitControls never accumulates it
  shake *= Math.exp(-dt * 7);
  const sh = shake > 1e-3 ? tmpV.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.12) : null;
  if (sh) camera.position.add(sh);
  if (!renderPathTraced()) composer.render();
  if (sh) camera.position.sub(sh);
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
  if (S.engine !== 'Cycles' || playing || cruise || running || launching || standing) return false;
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
