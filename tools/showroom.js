// Showroom: the frames and weapons on a turntable, without the city or the swarm.
// Serve the repo root and open tools/showroom.html. URL parameters:
//   frame=<id>|lineup   which frame, or all six side by side; frame=<id>,<id>,... for a few side by side
//   preset=<n>          which of the frame's presets to equip (default 0)
//   pose=idle|walk|dash|air|aim|slash|shield
//   paint=<paint id>    bare=1 (no weapons)    yaw=<radians> pitch=<radians> dist=<units>   rack=1 (every weapon), rack=new, rack=<weapon id>
// window.__show drives it from a test.
import * as THREE from '../js/three.js';
import { makeMaterials, applyPaint, PAINTS, addOutline, glowTexture } from '../js/atlas.js';
import { FRAMES, frameById, CLASSES } from '../js/frames/index.js';
import { WEAPONS, slotsFor, allowedFor, mountWeapon, buildWeaponModel } from '../js/weapons.js';
import { BODY_SHEET, WEAPON_SHEET } from '../js/regions.js';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2f37);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);

// Sky-ish environment for the metal, like the game's
{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vD; void main(){ vec3 d = normalize(vD); float h = d.y; vec3 sky = mix(vec3(0.85,0.87,0.88), vec3(0.28,0.46,0.75), pow(max(h,0.0),0.6)); vec3 c = h > 0.0 ? sky : mix(sky, vec3(0.36,0.37,0.38), smoothstep(0.0,-0.2,h)); gl_FragColor = vec4(c,1.0); }',
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 0.55;
}
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3630, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(14, 26, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 90 });
scene.add(sun, sun.target);
const grid = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3d424a'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#4c525b'; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: grid, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const loader = new THREE.TextureLoader();
const [body, weapons] = await Promise.all([loader.loadAsync('../textures/body.jpg'), loader.loadAsync('../textures/weapons.jpg')]);
for (const t of [body, weapons]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }
body.userData.sheet = BODY_SHEET;
weapons.userData.sheet = WEAPON_SHEET;
const mats = makeMaterials({ body, weapons });
const glowTex = glowTexture();

const units = []; // { frame, mech, x }
let pose = qs.get('pose') || 'idle';
let time = 0;
const view = { yaw: +(qs.get('yaw') ?? 0.65), pitch: +(qs.get('pitch') ?? 0.12), dist: +(qs.get('dist') || 0), look: null };

function clear() {
  for (const u of units) scene.remove(u.mech.root);
  units.length = 0;
}

function addFrame(frame, x, presetIdx = 0, M = mats) {
  const mech = frame.make(M, glowTex);
  mech.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const preset = frame.presets[presetIdx] || frame.presets[0];
  for (const slot of qs.get('bare') ? [] : slotsFor(frame)) {
    const [wid, skin] = preset.slots[slot.id] || [null];
    if (!wid || !WEAPONS[wid] || !allowedFor(slot, frame).includes(wid)) continue;
    const { model, mount } = mountWeapon(slot, wid, skin, M);
    addOutline(model.group, 0.022);
    mech.attach(mount, model.group);
  }
  mech.root.position.set(x, 0, 0);
  scene.add(mech.root);
  const gun = (id) => !!id && id !== 'shield' && id !== 'blade' && !!WEAPONS[id];
  const [R, L] = qs.get('bare') ? [] : [(preset.slots.rightHand || [])[0], (preset.slots.leftHand || [])[0]];
  const u = { frame, mech, x, z: 0, hasShield: L === 'shield', armed: [gun(R), gun(L)], support: gun(R) && !L };
  units.push(u);
  return u;
}

function show(id, presetIdx = +(qs.get('preset') || 0)) {
  clear();
  if (id === 'lineup' || id.includes(',')) {
    // Each frame in its own scheme (or all in paint=)
    const list = id === 'lineup' ? FRAMES : id.split(',').map(frameById);
    list.forEach((f, i) => {
      const M = makeMaterials({ body, weapons });
      applyPaint(M, PAINTS.find((p) => p.id === (qs.get('paint') || f.paint)) || PAINTS[0]);
      addFrame(f, (i - (list.length - 1) / 2) * 9.5, 0, M);
    });
  } else {
    const f = frameById(id);
    addFrame(f, 0, presetIdx);
    applyPaint(mats, PAINTS.find((p) => p.id === (qs.get('paint') || f.presets[presetIdx]?.paint || f.paint)) || PAINTS[0]);
  }
  for (const u of units) u.mech.resetFeet();
  info();
}

function info() {
  const el = document.getElementById('info');
  el.textContent = units.map((u) => `${CLASSES[u.frame.class]} ${u.frame.code} ${u.frame.name} · scale ${u.mech.rig.scale}`).join('  |  ') + `  · pose ${pose}`;
}

// The weapons laid out on a wall rack, muzzles to the right: rack=1 for all of them, rack=new for the arsenal's
function rack(which = qs.get('rack')) {
  clear();
  const ids = WEAPONS[which] ? [which] : Object.keys(WEAPONS).filter((id) => which !== 'new' || ARSENAL.includes(id));
  const cols = Math.min(ids.length, which === 'new' ? 3 : 4), rows = Math.ceil(ids.length / cols);
  const g = new THREE.Group();
  ids.forEach((id, i) => {
    const m = buildWeaponModel(id, { id: 'white', tint: '#ffffff', stripe: '#d8322b' }, mats);
    addOutline(m.group, 0.022);
    const col = i % cols, row = Math.floor(i / cols);
    m.group.position.set((col - (cols - 1) / 2) * 7.5 - 2, 1 + (rows - 1 - row) * 3, 0);
    m.group.rotation.y = Math.PI / 2;
    g.add(m.group);
  });
  scene.add(g);
  units.push({ mech: { root: g, animate() {}, resetFeet() {} }, frame: { code: 'rack', name: ids.join(' · '), class: 'light' }, x: 0, rack: true });
  view.look = new THREE.Vector3(0, 1 + (rows - 1) * 1.5, 0);
  view.dist = view.dist || rows * 5.5;
  view.yaw = 0;
  view.pitch = 0.05;
  document.getElementById('info').textContent = ids.map((id) => WEAPONS[id].short).join(' · ');
}
const ARSENAL = ['railgun', 'arcCaster', 'flamer', 'blade', 'sawLauncher', 'harpoon', 'drones', 'hydra', 'singularity', 'artillery', 'mines', 'orbital'];

const _v = new THREE.Vector3();
const st = () => ({
  gait: 0, air: 0, dash: 0, crouch: 0, vel: new THREE.Vector3(), bodyYaw: 0, ground: 0, legYaw: 0, aimYaw: 0, aimPitch: 0,
  aim: [0, 0], recoil: [0, 0], reload: [false, false], slash: [0, 0], shield: false, hasShield: false,
  thrust: { main: 0, vern: 0, calf: 0, sole: 0 }, time,
});

function step(dt) {
  time += dt;
  for (const u of units) {
    if (u.rack) continue;
    const s = st();
    s.hasShield = u.hasShield;
    s.armed = u.armed;
    s.support = u.support;
    s.aimPitch = view.aimPitch || 0;
    const speed = pose === 'walk' ? u.frame.walk : 0;
    if (pose === 'walk') {
      u.z += speed * dt;
      s.vel.set(0, 0, speed);
      s.gait = Math.min(1, speed / 7.5);
    }
    if (pose === 'dash') { s.dash = 1; s.thrust = { main: 1, vern: 0.75, calf: 0.55, sole: 0 }; }
    if (pose === 'air') { s.air = 1; s.thrust = { main: 0.85, vern: 0.55, calf: 0.9, sole: 1 }; }
    if (pose === 'aim') { s.aim = [1, 1]; s.aimPitch = view.aimPitch ?? 0.05; }
    if (pose === 'shield') { s.aim = [1, 0]; s.shield = true; }
    if (pose === 'slash') s.slash = [(time * 0.8) % 1, 0];
    u.mech.root.position.set(u.x, 0, u.z);
    s.ground = 0;
    u.mech.animate(dt, s);
  }
}

function place() {
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  const lineup = units.length > 1 && !units[0].rack;
  const u = units[0];
  const z = u ? u.z || 0 : 0;
  const K = u && u.mech.rig ? u.mech.rig.scale : 1;
  const look = view.look || _v.set(0, lineup ? 4.5 : 4.4 * K, z);
  const d = view.dist || (lineup ? 46 : 17 * K);
  camera.position.set(look.x + Math.sin(view.yaw) * Math.cos(view.pitch) * d, look.y + Math.sin(view.pitch) * d, look.z + Math.cos(view.yaw) * Math.cos(view.pitch) * d);
  camera.lookAt(look);
  sun.position.set(look.x + 14, 26, look.z + 18);
  sun.target.position.copy(look);
}

// Controls: frame buttons, poses, drag to orbit
const bar = document.getElementById('bar');
const btn = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); bar.appendChild(b); return b; };
for (const f of FRAMES) btn(f.name, () => show(f.id));
btn('Lineup', () => show('lineup'));
btn('Weapons', () => rack('1'));
btn('New weapons', () => rack('new'));
for (const p of ['idle', 'walk', 'aim', 'dash', 'air', 'slash', 'shield']) btn(p, () => { pose = p; for (const u of units) { u.z = 0; u.mech.resetFeet(); } info(); });
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.yaw -= (e.clientX - drag.x) * 0.01;
  view.pitch = Math.max(-0.2, Math.min(1.2, view.pitch + (e.clientY - drag.y) * 0.01));
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('wheel', (e) => { view.dist = Math.max(4, (view.dist || 17) * (e.deltaY > 0 ? 1.1 : 0.9)); });

if (qs.get('rack')) rack(); else show(qs.get('frame') || 'vanguard');
// Settle the stance before the first frame
for (let i = 0; i < 90; i++) step(1 / 30);
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = window.__show.fixedDt || Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!window.__show.paused) step(dt);
  place();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.__show = {
  THREE, scene, camera, renderer, units, view, mats, show, rack, step, place,
  setPose(p) { pose = p; for (const u of units) { u.z = 0; u.mech.resetFeet(); } info(); },
  render() { place(); renderer.render(scene, camera); },
  /** Run n steps of dt and render once: for headless screenshots */
  advance(n, dt = 1 / 30) { for (let i = 0; i < n; i++) step(dt); place(); renderer.render(scene, camera); },
  ready: true,
};
