import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const meta = await (await fetch('/anim.json')).json();
const FPS = meta.fps;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 500);
camera.position.set(6, 4, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.6, 0);
controls.enableDamping = true;

const key = new THREE.DirectionalLight(0xfff4e6, 2.2); key.position.set(5, 10, 6); key.castShadow = true; scene.add(key);
const rim = new THREE.DirectionalLight(0x88bbff, 1.4); rim.position.set(-6, 5, -8); scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ---------- post ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

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

const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const coreMat = flameMat.clone(); coreMat.color.set(0xfff0c8);
const ringMat = flameMat.clone(); ringMat.color.set(0xffc080); ringMat.opacity = 0.5;
model.traverse(o => {
  if (!o.isMesh) return;
  o.castShadow = o.receiveShadow = true;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  mats.forEach(m => {
    if (!m) return;
    if (m.name === 'TF_Armor') {
      Object.assign(m, armor);
      m.normalScale = new THREE.Vector2(0.6, 0.6);
      m.emissive = new THREE.Color(0x40ff20); m.emissiveIntensity = 3;
      m.needsUpdate = true;
    }
  });
  if (o.name.startsWith('VFX_')) {
    o.material = /Core|Flash/.test(o.name) ? coreMat : /Shock/.test(o.name) ? ringMat : flameMat;
    o.castShadow = false;
  }
});

// ---------- animation ----------
const mixer = new THREE.AnimationMixer(model);
// the glb holds one clip for the rig ('TF_Rig') + one per VFX object; drive them all on one timeline
const actions = gltf.animations.map(c => { const a = mixer.clipAction(c); a.play(); a.paused = true; return a; });
const rootBone = model.getObjectByName('root');

let playing = false, range = [meta.frameStart, meta.frameEnd], cur = meta.frameStart;
function setFrame(f) { cur = f; const t = (f - 1) / FPS; actions.forEach(a => { a.time = Math.min(t, a.getClip().duration); }); mixer.update(0); }

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
const scrub = $('scrub'); scrub.min = meta.frameStart; scrub.max = meta.frameEnd;
function playRange(a, b) { range = [a, b]; setFrame(a); playing = true; $('play').textContent = '❚❚ Pause'; }
$('play').onclick = () => { playing = !playing; if (playing && cur >= range[1]) setFrame(range[0]); $('play').textContent = playing ? '❚❚ Pause' : '▶ Play'; };
$('toJet').onclick = () => playRange(...meta.clips.toJet);
$('toRobot').onclick = () => playRange(...meta.clips.toRobot);
let follow = true; $('follow').onclick = () => { follow = !follow; $('follow').textContent = 'Camera follow: ' + (follow ? 'on' : 'off'); };
scrub.oninput = () => { playing = false; $('play').textContent = '▶ Play'; setFrame(+scrub.value); };

// ---------- loop ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
setFrame(1);
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (playing) {
    const prev = cur;
    let next = cur + dt * FPS;
    if (next >= range[1]) { next = range[1]; playing = false; $('play').textContent = '▶ Play'; }
    meta.sfx.forEach(c => { if (c.frame > prev && c.frame <= next) fire(c); });
    setFrame(next);
  }
  scrub.value = Math.round(cur); $('frame').textContent = 'f ' + Math.round(cur);
  if (follow && rootBone) {
    rootBone.getWorldPosition(tmp); tmp.y += 2.6;
    const d = tmp.clone().sub(controls.target); controls.target.add(d.multiplyScalar(0.08)); camera.position.add(d);
  }
  controls.update();
  composer.render();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});
