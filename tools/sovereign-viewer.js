// Turntable for the BK-09 Sovereign (js/sovereign.js), lit like a studio shot so it can be
// held up against the reference art. URL params:
//   view=ref|front|side|back|three   camera preset (ref matches the reference art's angle)
//   az, el                           camera azimuth/elevation in degrees, overriding the preset
//   pose=idle|aim                    armed=1 puts a rifle in the right hand
//   outline=1                        ink outlines as in the game
//   spin=1                           turntable
//   ref=<url>                        reference image shown in the corner (compare)
//   shot=1                           hide the UI (for screenshots)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { glowTexture } from '../js/atlas.js';
import { Sovereign, buildSovereignRifle, loadSovereignTextures, makeSovereignMaterials } from '../js/sovereign.js';

const Q = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9e4de);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;

// Soft studio light: a warm key from the front left, a cool fill and a rim from behind
scene.add(new THREE.HemisphereLight(0xfffaf2, 0x8c857c, 0.9));
const key = new THREE.DirectionalLight(0xfff3e2, 2.4);
key.position.set(6, 12, 9);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 10, bottom: -2, near: 1, far: 40 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
fill.position.set(-8, 5, 4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1.2);
rim.position.set(-3, 8, -10);
scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.22 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 4.1, 0);
controls.enableDamping = true;

// Camera presets: azimuth from the mech's front (+Z) toward its left side (+X), elevation
const VIEWS = { ref: [58, 4], front: [0, 6], three: [35, 10], side: [90, 4], back: [180, 8], rear: [-140, 12], top: [30, 45] };
function setView(az, el, dist = 21, ty = 4.1) {
  controls.target.set(0, ty, 0);
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  camera.position.set(Math.sin(a) * Math.cos(e) * dist, controls.target.y + Math.sin(e) * dist, Math.cos(a) * Math.cos(e) * dist);
  controls.update();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const state = {
  pose: Q.get('pose') || 'idle',
  armed: Q.get('armed') === '1',
  outline: Q.get('outline') === '1',
  spin: Q.get('spin') === '1',
};
if (Q.get('shot') === '1') document.body.classList.add('shot');
if (Q.get('ref')) { document.getElementById('ref').src = Q.get('ref'); document.body.classList.add('compare'); }

const tex = await loadSovereignTextures(renderer, '../');
const mats = makeSovereignMaterials(tex);
const mech = new Sovereign(mats, glowTexture());
scene.add(mech.root);

const rifle = buildSovereignRifle(mats);
function applyState() {
  for (const o of mech.outlines) o.visible = state.outline;
  mech.attach('rightHand', state.armed ? rifle : null);
}

const st = {
  gait: 0, air: 0, dash: 0, crouch: 0, legYaw: 0, aimYaw: 0, aimPitch: 0, bodyYaw: 0, ground: 0,
  aim: [0, 0], recoil: [0, 0], reload: [0, 0], shield: false, hasShield: false,
  thrust: { main: 0, vern: 0, calf: 0, sole: 0 }, vel: new THREE.Vector3(), armed: [false, false], support: false, time: 0,
};
function step(dt) {
  st.time += dt;
  st.armed = [state.armed, false];
  st.support = state.armed;
  st.aim = [state.pose === 'aim' ? 1 : 0, 0];
  mech.animate(dt, st);
}
// Settle the damped pose before the first frame
applyState();
for (let i = 0; i < 240; i++) step(1 / 60);

const v = Q.get('view') || 'ref';
const [az0, el0] = VIEWS[v] || VIEWS.ref;
setView(Q.has('az') ? +Q.get('az') : az0, Q.has('el') ? +Q.get('el') : el0, Q.has('dist') ? +Q.get('dist') : 24);

// UI
const bar = document.getElementById('bar');
function button(label, on, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  if (on !== null) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.onclick = () => { const r = fn(); if (on !== null) b.setAttribute('aria-pressed', r ? 'true' : 'false'); };
  bar.appendChild(b);
  return b;
}
for (const k of ['ref', 'front', 'three', 'side', 'back', 'rear']) button(k, null, () => setView(...VIEWS[k]));
button('spin', state.spin, () => (state.spin = !state.spin));
button('armed', state.armed, () => { state.armed = !state.armed; applyState(); return state.armed; });
button('aim', state.pose === 'aim', () => { state.pose = state.pose === 'aim' ? 'idle' : 'aim'; return state.pose === 'aim'; });
button('outline', state.outline, () => { state.outline = !state.outline; applyState(); return state.outline; });

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  step(dt);
  if (state.spin) mech.root.rotation.y += dt * 0.4;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// For headless screenshots
window.__viewer = {
  setView,
  setState(s) { Object.assign(state, s); applyState(); for (let i = 0; i < 120; i++) step(1 / 60); },
  render() { controls.update(); renderer.render(scene, camera); },
  ready: true,
};
