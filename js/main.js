import * as THREE from './three.js';
import { loadTextures, makeMaterials, applyPaint, PAINTS } from './atlas.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { music } from './music.js';
import { World, SUN_DIR, STEP } from './world.js';
import { FRAMES } from './frames.js';
import { WeaponSystem, PRESETS } from './weapons.js';
import { Input } from './input.js';
import { HUD, Hangar, FrameSelect, SummonMenu } from './ui.js';
import { SpiderSwarm } from './spiders.js';
import { Portals } from './portals.js';
import { Summoner, SUMMON_GROUPS } from './summons.js';
import { Allies } from './allies.js';
import { Destruction } from './destruct/destruct.js';
import { People } from './people.js';
import { Furniture } from './furniture.js';
import { Train } from './train.js';
import { setCeilingTextures } from './destruct/ceilings.js';
import { titleDone, portraitPhone } from './title/title.js';
import { Post } from './post.js';
import { Pilot, PILOT_AP } from './pilot.js';
import { Rides, RIDE_CARDS } from './rides.js';

const V3 = THREE.Vector3;
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (cur, target, rate, dt) => cur + wrap(target - cur) * (1 - Math.exp(-rate * dt));

// The world is scaled around the mech: METERS (meters per game unit) is set at
// startup from the mech's measured height so that it stands 40 ft tall.
const MECH_HEIGHT_M = 40 * 0.3048;
let METERS = 1.7;

// Armor points come with the frame (js/frames.js). Spider hits are scaled by HIT_SCALE; armor
// starts regenerating REGEN_DELAY seconds after the last hit. A raised shield turns away hits
// from within SHIELD_ARC of the way the mech faces.
const HIT_SCALE = 1.5;
const REGEN_DELAY = 4;
const REGEN_RATE = 26;
const SHIELD_ARC = 1.2;
const VENOM_DPS = 7;      // armor a Venomtail's venom eats per second (an Acid Riftling's acid too)
const ACID_MAX = 6;       // most seconds of acid that splats can stack up on the hull

// Boost gauge (0-100). Dashes and jump jets burn it at BOOST_DRAIN times their base
// rates, so a full gauge lasts 2.5x as long; regen is unchanged, so a refill takes
// the same time.
const BOOST_DRAIN = 1 / 2.5;

// Camera. Look pitch reaches to just short of straight up and straight down (exactly
// vertical leaves lookAt without an up). The wheel zooms between CAM_DIST_MIN and
// CAM_DIST_MAX; the game starts zoomed all the way in.
const PITCH_MAX = 1.55;
const CAM_DIST_MIN = 9, CAM_DIST_MAX = 26;

// Saves live under vectorclad.* keys. Builds before the move to this repo saved under
// fs07.*: read those when no vectorclad.* save exists yet; the next save writes the new key.
const LEGACY_KEYS = { 'vectorclad.settings': 'fs07.settings', 'vectorclad.loadout': 'fs07.loadout.ac' };
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k) ?? (LEGACY_KEYS[k] && localStorage.getItem(LEGACY_KEYS[k]));
      return v ? JSON.parse(v) : d;
    } catch (_) { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
};
// The frame picked on the select screen (js/frames.js)
let spec = FRAMES[store.get('vectorclad.frame', 'vanguard')] || FRAMES.vanguard;
// Or a ride picked there instead (js/rides.js): 'mech', 'kestrel', 'hornet' or 'apc'
let startAs = store.get('vectorclad.startAs', 'mech');
if (!['mech', 'kestrel', 'hornet', 'apc'].includes(startAs)) startAs = 'mech';

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// A sandbox: there are no waves. Nothing comes until the summon menu (the ` key, js/summons.js) calls it in.
// The hangar is a bottom sheet rather than a side panel (same query as #hangar in style.css)
const hangarSheet = matchMedia('(max-width: 720px) and (orientation: portrait)');

// ---------------------------------------------------------------------------
// Renderer & scene
// ---------------------------------------------------------------------------

const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The millipede is clipped where it hasn't yet crawled out of its portal (js/millipede.js)
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.6, 9000);

const settings = Object.assign({ sound: true, music: true, shadows: !isTouch, invert: false, sens: 1, hires: !isTouch, outlines: true, graphics: isTouch ? 'low' : 'auto' }, store.get('vectorclad.settings', {}));

// Bloom, glare, ambient occlusion and god rays (js/post.js) for the High and Ultra graphics settings
const post = new Post(renderer, scene, camera, SUN_DIR);
const TIERS = ['low', 'high', 'ultra'];
// Auto: Ultra to begin with, a step down whenever play runs slow for a while (see pace())
const autoGfx = { tier: 'ultra', t0: 0, n: 0, slow: 0 };
const graphicsTier = () => (settings.graphics === 'auto' ? autoGfx.tier : TIERS.includes(settings.graphics) ? settings.graphics : 'high');

function applyGraphics() {
  const tier = graphicsTier();
  post.setQuality(tier);
  // Ultra's shadows are twice as sharp
  const size = tier === 'ultra' ? 4096 : 2048, sh = world && world.sun.shadow;
  if (sh && sh.mapSize.x !== size) {
    sh.mapSize.set(size, size);
    if (sh.map) { sh.map.dispose(); sh.map = null; }
  }
}

function applySettings() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.hires ? 2 : 1.25));
  resize();
  renderer.shadowMap.enabled = settings.shadows;
  if (world) world.sun.castShadow = settings.shadows;
  applyGraphics();
  scene.traverse((o) => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  sound.setEnabled(settings.sound);
  music.setEnabled(settings.music);
  if (weapons) weapons.outlines = settings.outlines;
  scene.traverse((o) => { if (o.userData.isOutline) o.visible = settings.outlines; });
  store.set('vectorclad.settings', settings);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// Environment map so metal and painted armor pick up sky reflections.
function buildEnvironment() {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSun: { value: SUN_DIR.clone() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uSun; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 sky = mix(vec3(0.85,0.87,0.88), vec3(0.28,0.46,0.75), pow(max(h,0.0),0.6));
        vec3 gnd = vec3(0.36,0.37,0.38);
        vec3 c = h > 0.0 ? sky : mix(sky, gnd, smoothstep(0.0,-0.2,h));
        c += vec3(1.0,0.9,0.75) * pow(max(dot(d,uSun),0.0), 64.0) * 6.0;
        gl_FragColor = vec4(c,1.0); }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(envScene, 0.02);
  scene.environment = rt.texture;
  scene.environmentIntensity = 0.55;
  pm.dispose();
}

// ---------------------------------------------------------------------------
// Game objects (created after textures load)
// ---------------------------------------------------------------------------

const sound = new Sound();
// The title screen fires this inside the tap/click/key that dismisses it, so audio can unlock.
window.addEventListener('vectorclad:start', () => sound.unlock());
const input = new Input(canvas);
input.touchMode = isTouch;
let world, fx, mech, weapons, hud, hangar, mats, spiders, allies, frameSel, portals, summoner, summonMenu, pilot, rides;
const frameMechs = {}; // each frame's model, built the first time it is picked

const DEFAULT = PRESETS[0];
// Bumped storage key: loadouts saved for the earlier frame start fresh on this one.
const loadout = store.get('vectorclad.loadout', null) || { paint: DEFAULT.paint, slots: JSON.parse(JSON.stringify(DEFAULT.slots)) };
if (!PAINTS.some((p) => p.id === loadout.paint)) loadout.paint = PAINTS[0].id;

// Additive glow on the ground under the thrusters
const washMat = new THREE.MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
let wash;

const P = {
  pos: new V3(0, 0, 0),
  vel: new V3(),
  yaw: Math.PI, pitch: 0.05,
  bodyYaw: Math.PI,
  grounded: true,
  boost: 100, overheat: false, boostDelay: 0,
  jumpT: 0, launchT: 0, landT: 0, airT: 0,
  phase: 0, gaitDir: 1, legYaw: 0,
  dashing: false, ascending: false, onLip: false,
  thrust: { main: 0, vern: 0, calf: 0, sole: 0 },
  ap: spec.ap, alive: true, hurtT: 99, deadT: 0, runT: 0, webT: 0, venomT: 0, pinT: 0, pullT: 0, pullK: 0, pullFrom: new V3(),
  chest: new V3(),
};
const cam = { dist: CAM_DIST_MIN, shake: 0, fov: 60, pivotY: 7, orbit: 0, orbitR: 15, orbitSpeed: 0.18, lookY: 4.6, orbitY: 5.6 };
// loading | intro | frames (frame select) | loadout (before a drop) | drop (flown in) |
// brief (held at the release for the tech-demo notice) | play | hangar (paused) | over
let mode = 'loading';
let time = 0;
let deployed = false;

function shake(pos, amount) {
  const d = pos ? pos.distanceTo(P.pos) : 0;
  cam.shake = Math.min(1.2, cam.shake + amount / (1 + d / 40));
}

/** Height of the top of the mech's head in its idle stance, in game units */
function measureMech() {
  const st = {
    gait: 0, air: 0, dash: 0, crouch: 0, vel: new V3(), bodyYaw: 0, ground: 0, legYaw: 0, aimYaw: 0, aimPitch: 0,
    aim: [0, 0], recoil: [0, 0], reload: [false, false], shield: false, hasShield: false,
    thrust: { main: 0, vern: 0, calf: 0, sole: 0 }, time: 0,
  };
  for (let i = 0; i < 90; i++) mech.animate(1 / 30, st);
  mech.root.updateMatrixWorld(true);
  let top = 0;
  const v = new V3();
  mech.head.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) top = Math.max(top, v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).y);
  });
  return top - mech.root.position.y;
}

async function init() {
  resize();
  const tex = await loadTextures(renderer, (p) => { $('#load-bar').style.width = `${Math.round(p * 100)}%`; });
  $('#load-msg').textContent = 'Assembling frame…';
  await new Promise((r) => setTimeout(r, 30));

  buildEnvironment();
  mats = makeMaterials(tex);
  applyPaint(mats, PAINTS.find((p) => p.id === loadout.paint) || PAINTS[0]);
  fx = new FX(scene, { onShake: shake, sound });
  hud = new HUD({ touch: isTouch });
  // The world is always scaled from the Vanguard, whichever frame is picked
  mech = frameMechs.vanguard = FRAMES.vanguard.build(mats, fx.glowTex);
  METERS = MECH_HEIGHT_M / measureMech();
  $('#load-msg').textContent = 'Building Port Meridian…';
  await new Promise((r) => setTimeout(r, 30));
  world = new World(scene, mats, fx, sound, { M: 1 / METERS, cityTex: tex.city }, {
    // The allies' hits (world.allyFire) don't light the mech's hit marker
    onHit: () => { if (!world.allyFire) hud.hit(false); },
  });
  spiders = new SpiderSwarm({
    scene, world, fx, sound, tex, glowTex: fx.glowTex,
    cb: {
      onKill: (s) => {
        // The tanks' kills are theirs, not the mech's
        if (world.allyFire) allies.kills++;
        else { hud.hit(true); hud.addKill(); }
        if (s.boss || s.v.elite) { hud.toast(`${s.name} DOWN`, 2.6); shake(s.pos, 1); }
      },
      onPlayerHit: hurt,
      onWeb: (dur) => {
        if (!P.alive) return;
        if (P.webT <= 0) hud.toast('WEBBED · DASH TO BREAK FREE', 1.6);
        P.webT = Math.max(P.webT, dur);
      },
      // Scorpion stings and pincers; the raised shield turns these away too
      onVenom: (dur, from) => {
        if (!P.alive || mode !== 'play' || shielded(bearingOf(from))) return;
        if (P.venomT <= 0) hud.toast('VENOM · ARMOR CORRODING', 1.6);
        P.venomT = Math.max(P.venomT, dur);
      },
      // Acid Riftlings bursting on the hull: their acid eats armor like venom, each splat adding more
      onAcid: (dur) => {
        if (!P.alive || mode !== 'play') return;
        if (P.venomT <= 0) hud.toast('ACID · ARMOR CORRODING', 1.6);
        P.venomT = Math.min(ACID_MAX, Math.max(0, P.venomT) + dur);
      },
      onShock: (amount, from) => {
        if (!P.alive || mode !== 'play' || shielded(bearingOf(from))) return;
        P.boost = Math.max(0, P.boost - amount);
        P.boostDelay = Math.max(P.boostDelay, 1.2);
        hud.toast('SHOCKED · BOOST DRAINED', 1.4);
        fx.sparksBurst(P.chest, UPV, 16, 0x7fc8ff, 24);
      },
      // Returns whether the pincer took hold; a duration of 0 lets go
      onGrab: (dur, from) => {
        if (!dur) { P.pinT = 0; return false; }
        if (!P.alive || mode !== 'play' || shielded(bearingOf(from))) return false;
        if (P.pinT <= 0) hud.toast('SEIZED · DASH TO BREAK FREE', 1.6);
        P.pinT = dur;
        return true;
      },
      // Boss news: cores going down, the millipede's head breaking loose
      onAlert: (text, dur) => hud.toast(text, dur),
      // A Magnetar's tractor beam, called every frame it holds the mech
      onPull: (from, k) => {
        if (!P.alive || mode !== 'play') return;
        if (P.pullT <= 0) hud.toast('TRACTOR BEAM · DASH TO RESIST', 1.6);
        P.pullT = 0.2;
        P.pullK = k;
        P.pullFrom.copy(from);
      },
    },
  });
  world.spiders = spiders;
  spiders.camPos = camera.position;
  // Everything in the city can be shot apart (js/destruct), down to the lights in its ceilings
  setCeilingTextures(tex.ceiling, tex.ceilingGlow);
  const D = (world.destruct = new Destruction({ scene, world, city: world.city, fx, sound, renderer, M: 1 / METERS, mobile: isTouch }));
  D.player = P;
  D.spiders = spiders;
  D.onPlayerHit = (amount, from, kind) => hurt(amount, from, kind);
  // The people of Port Meridian, what their rooms hold, and the trains on the El
  world.people = new People({ scene, world, fx, sound, mobile: isTouch });
  world.furniture = new Furniture({ scene, world, mobile: isTouch });
  world.train = new Train({ scene, world, fx, sound });
  D.onCarve = (s, x, y, z, r) => world.carved(s, x, y, z, r);
  // The Kestrel H that flies the mech in, and the Kestrels and Bastion tanks that join the fight
  allies = new Allies({ scene, world, fx, sound, meters: METERS, mobile: isTouch });
  allies.setSwarm(spiders);
  // Summoning: the ` menu, and the portals monsters drop out of
  portals = new Portals({ scene, fx, sound });
  summoner = new Summoner({ swarm: spiders, portals, world });
  summonMenu = new SummonMenu({
    groups: SUMMON_GROUPS, sound,
    cooldown: (id) => summoner.cooldown(id),
    queued: (id) => orders.has(id),
    onSummon: (id, n) => {
      // From the loadout (before a drop), summons wait for the fight to start; a second press takes one back
      if (mode === 'loadout') {
        if (orders.has(id)) { orders.delete(id); return { ok: false }; }
        orders.set(id, n);
        return { ok: true };
      }
      const r = mode === 'play' ? summoner.summon(id, n, P) : { ok: false, msg: '' };
      if (r.msg) hud.toast(r.msg, 2.6);
      if (r.ok) sound.warning();
      return r;
    },
  });
  P.pos.copy(world.spawn);
  mech.root.position.copy(P.pos);
  mech.resetFeet();
  if (world.city.landmark) {
    P.yaw = P.bodyYaw = Math.atan2(world.city.landmark.x - P.pos.x, world.city.landmark.z - P.pos.z);
  }
  cam.orbit = P.bodyYaw + 0.5;
  washMat.map = fx.glowTex;
  wash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), washMat);
  wash.rotation.x = -Math.PI / 2;
  wash.renderOrder = 2;
  scene.add(wash);
  mech.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });
  scene.add(mech.root);
  weapons = new WeaponSystem({ scene, fx, sound, world, mech, mats });
  weapons.onShake = shake;
  weapons.equip(loadout);
  // The pilot on foot (hold G beside a standing frame); the first person arm rides on the camera
  pilot = new Pilot({ scene, camera, world, fx, sound, weapons, mats, M: 1 / METERS });
  scene.add(camera);
  // A Kestrel gunship and an APC parked by the plaza, and the city's cars, for the pilot to take
  rides = new Rides({ scene, world, fx, sound, weapons, mats, M: 1 / METERS, meters: METERS, hud });
  rides.park(world.spawn, P.bodyYaw);

  hangar = new Hangar({
    loadout, settings, sound, touch: isTouch,
    onChange: () => {
      applyPaint(mats, PAINTS.find((p) => p.id === loadout.paint) || PAINTS[0]);
      weapons.equip(loadout);
      store.set('vectorclad.loadout', loadout);
    },
    onSettings: applySettings,
    frames: FRAMES, frame: () => spec.id, onFrame: (id) => setFrame(id),
  });
  frameSel = new FrameSelect({
    frames: FRAMES, current: startAs === 'mech' ? spec.id : startAs, sound, meters: () => METERS,
    onPick: (id) => { pickStart('mech'); setFrame(id); },
    rides: RIDE_CARDS, onRide: (id) => pickStart(id),
  });
  if (spec !== FRAMES.vanguard) setFrame(spec.id);
  applySettings();

  if (isTouch) {
    document.body.classList.add('touch');
    input.setupTouch($('#touch'));
    // The canvas never sees a tap under the touch controls, so wake the audio from them
    $('#touch').addEventListener('pointerdown', () => sound.unlock());
  }
  input.onLockChange = (locked) => {
    if (!locked && mode === 'play' && !input.lockFailed && !summonMenu.open) openHangar();
  };
  // Pause in the hangar when the game can't be seen: the page goes to the background,
  // or a phone turns upright and the rotate overlay covers it.
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') openHangar(); });
  portraitPhone.addEventListener('change', () => { if (portraitPhone.matches && mode === 'play') openHangar(); });

  // Launch: frame select, then the loadout, then the drop. Quick deploy goes straight to the drop.
  $('#btn-launch').addEventListener('click', () => { sound.unlock(); openFrames(); });
  $('#btn-quick').addEventListener('click', () => { sound.unlock(); deploy(); });
  $('#btn-frame-next').addEventListener('click', () => { sound.unlock(); if (startAs === 'mech') openLoadout(); else deploy(); });
  $('#btn-frame-back').addEventListener('click', () => { sound.unlock(); openIntro(); });
  $('#btn-hangar-back').addEventListener('click', () => { sound.unlock(); openFrames(); });
  $('#btn-close-hangar').addEventListener('click', () => { sound.unlock(); if (mode === 'loadout') startDrop(); else startPlay(); });
  $('#btn-hangar').addEventListener('click', () => openHangar());
  $('#btn-redeploy').addEventListener('click', () => { sound.unlock(); deploy(); });
  $('#btn-over-hangar').addEventListener('click', () => { sound.unlock(); openFrames(); });
  $('#t-menu').addEventListener('click', () => openHangar());
  // A tap with a second finger (thumb still on the stick) never becomes a click, so open on touchend.
  // Cancelling it also keeps the click from landing on the hangar that just opened under the finger.
  $('#t-menu').addEventListener('touchend', (e) => { e.preventDefault(); openHangar(); });
  $('#btn-summon').addEventListener('click', () => toggleSummon());
  $('#btn-summon-close').addEventListener('click', () => closeSummon(true));
  $('#t-summon').addEventListener('touchend', (e) => { e.preventDefault(); toggleSummon(); });
  $('#t-summon').addEventListener('click', () => toggleSummon());
  $('#btn-brief-ok').addEventListener('click', () => { sound.unlock(); dismissBrief(); });
  // The loadout's Debug button (touchscreens, which have no ` key)
  $('#btn-hangar-debug').addEventListener('click', () => {
    sound.unlock();
    if (mode === 'hangar') { startPlay(); openSummon(); } else if (mode === 'loadout') openSummon();
  });
  canvas.addEventListener('click', () => {
    sound.unlock();
    if (summonMenu.open) closeSummon(false);
    if (mode === 'play' && !input.locked) input.requestLock();
    // On a touch screen a tap during the insertion lets go of the frame
    if (mode === 'drop' && isTouch) releaseNow();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && mode === 'hangar') startPlay();
    // ` (or ~): the summon menu
    if (e.code === 'Backquote' && !e.repeat) { e.preventDefault(); toggleSummon(); }
    if (e.code === 'Escape' && summonMenu.open) closeSummon(false);
    if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && mode === 'brief' && !e.repeat) { e.preventDefault(); dismissBrief(); }
    // Space during the insertion: let go of the frame now
    if (e.code === 'Space' && mode === 'drop' && !e.repeat) { e.preventDefault(); releaseNow(); }
  });

  // Warm up shaders so the first shots don't hitch
  renderer.compile(scene, camera);

  // Keep the GPU free for the title screen until the player taps through it.
  await titleDone;
  $('#loading').hidden = true;
  $('#intro').hidden = false;
  mode = 'intro';
  if (!isTouch) $('#btn-launch').focus({ preventScroll: true });
  requestAnimationFrame(frame);
}

/** Into the fight from the hangar. Not yet deployed (only tests call it that way), the frame starts on the plaza. */
function startPlay() {
  if (!deployed || !P.alive) redeploy();
  $('#intro').hidden = true;
  $('#frames').hidden = true;
  $('#hangar').hidden = true;
  $('#hud').hidden = false;
  if (isTouch) $('#touch').hidden = false;
  mode = 'play';
  input.requestLock();
}

/** Fresh frame on the starting plaza, an empty city */
function redeploy() {
  deployed = true;
  pilot.reset();
  rides.reset();
  exitHold = 0;
  allies.clear();
  Object.assign(P, { ap: spec.ap, alive: true, hurtT: 99, deadT: 0, runT: 0, webT: 0, venomT: 0, pinT: 0, pullT: 0, boost: 100, overheat: false, grounded: true, onLip: false, jumpT: 0, landT: 0 });
  P.pos.copy(world.spawn);
  P.vel.set(0, 0, 0);
  if (world.city.landmark) P.yaw = P.bodyYaw = Math.atan2(world.city.landmark.x - P.pos.x, world.city.landmark.z - P.pos.z);
  P.pitch = 0.05;
  mech.root.position.copy(P.pos);
  mech.resetFeet();
  weapons.equip(loadout);
  setHardLock(null);
  summoner.clear();
  spiders.start();
  hud.resetKills();
  $('#gameover').hidden = true;
}

/** Full armor: the frame's, or the pilot's while on foot */
const apMax = () => (pilot && pilot.active ? (rides.current ? rides.current.apMax : PILOT_AP) : spec.ap);

/** World bearing from the mech to a point: 0 along +z, clockwise from above */
const bearingOf = (from) => Math.atan2(from.x - P.pos.x, from.z - P.pos.z);
/** The raised shield turns away anything coming from within SHIELD_ARC of the way the mech faces */
const shielded = (bearing) => weapons.shieldUp && Math.abs(wrap(bearing - P.bodyYaw)) < SHIELD_ARC;

/** A spider or scorpion hit the mech. from: where the shot or strike came from. */
function hurt(amount, from, kind) {
  if (!P.alive || mode !== 'play') return;
  _t.subVectors(from, P.pos);
  const bearing = bearingOf(from);
  const blocked = shielded(bearing);
  const dmg = amount * HIT_SCALE * (blocked ? 0.12 : 1);
  P.ap -= dmg;
  P.hurtT = 0;
  // Screen angle of the shooter: 0 straight ahead, clockwise
  hud.damage(dmg / apMax(), -wrap(bearing - P.yaw), blocked);
  if (blocked) {
    _t.normalize();
    _t2.set(P.pos.x + Math.sin(P.bodyYaw) * 2.2, P.pos.y + 4.6, P.pos.z + Math.cos(P.bodyYaw) * 2.2);
    fx.sparksBurst(_t2, _t, 10, 0x9fffd0, 22);
    sound.shieldBlock();
    shake(null, 0.06);
  } else {
    const heavy = kind === 'laser' || kind === 'shell' || kind === 'blast' || kind === 'sting' || kind === 'crush';
    sound.playerHit(heavy ? 1.3 : 0.8);
    shake(null, heavy ? 0.4 : 0.14);
  }
  if (P.ap <= 0) die();
}

function die() {
  P.alive = false;
  P.ap = 0;
  P.deadT = 0;
  mode = 'over';
  summonMenu.hide();
  setHardLock(null);
  input.exitLock();
  $('#touch').hidden = true;
  input.releaseTouch();
  fx.explosion(P.chest, pilot.active ? 0.6 : 2.2);
  sound.explosion(P.chest, pilot.active ? 0.6 : 2);
  shake(null, 1.2);
  cam.orbit = P.yaw + Math.PI;
  const t = Math.floor(P.runT);
  $('#over-summoned').textContent = String(summoner.total);
  $('#over-kills').textContent = String(hud.score);
  $('#over-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** The pause hangar: loadout and settings, then back into the fight */
function openHangar() {
  if (mode === 'hangar') return;
  summonMenu.hide();
  mode = 'hangar';
  $('#hangar-eyebrow').textContent = 'HANGAR 2 · BAY 07';
  $('#btn-close-hangar').textContent = 'Launch';
  $('#btn-hangar-back').hidden = true;
  hangar.render();
  $('#hangar').hidden = false;
  $('#touch').hidden = true;
  input.releaseTouch();
  input.exitLock();
  cam.orbit = P.bodyYaw + 0.6;
}

/** Only one of the full-screen panels at a time */
function showPanel(id) {
  for (const p of ['#intro', '#frames', '#hangar', '#gameover', '#drop', '#brief']) $(p).hidden = p !== id;
  summonMenu.hide();
  $('#hud').hidden = true;
  $('#touch').hidden = true;
  input.releaseTouch();
  input.exitLock();
}

function openIntro() {
  mode = 'intro';
  showPanel('#intro');
  if (!isTouch) $('#btn-launch').focus({ preventScroll: true });
}

/** Frame select: the frames take turns in the showroom on the plaza */
function openFrames() {
  // Back from a lost fight: a fresh frame on the plaza to look at, not the wreck
  if (!P.alive) redeploy();
  mode = 'frames';
  showPanel('#frames');
  frameSel.render(startAs === 'mech' ? spec.id : startAs);
  $('#btn-frame-next').textContent = startAs === 'mech' ? 'Loadout' : 'Deploy';
  cam.orbit = P.bodyYaw + 0.5;
  if (!isTouch) $('#btn-frame-next').focus({ preventScroll: true });
}

/** The loadout before a drop: the hangar panel, with Deploy and a way back to the frames */
function openLoadout() {
  mode = 'loadout';
  showPanel('#hangar');
  $('#hangar-eyebrow').textContent = `PRE-DEPLOY · ${spec.code} ${spec.name.toUpperCase()}`;
  $('#btn-close-hangar').textContent = 'Deploy';
  $('#btn-hangar-back').hidden = false;
  hangar.render();
  cam.orbit = P.bodyYaw + 0.6;
}

/**
 * Swap the frame on show (or in play, from the pause hangar): same spot and loadout, and the
 * same share of its armor left. The world's scale is left alone.
 */
function setFrame(id) {
  const f = FRAMES[id];
  if (!f) return;
  const share = (pilot && pilot.active ? pilot.mechAp : P.ap) / spec.ap;
  spec = f;
  store.set('vectorclad.frame', id);
  const next = frameMechs[id] || (frameMechs[id] = f.build(mats, fx.glowTex));
  if (next !== mech) {
    weapons.equip({ slots: {} }); // strip the weapons off the old frame
    scene.remove(mech.root);
    mech = next;
    weapons.mech = mech;
    mech.root.position.copy(pilot && pilot.active ? pilot.parked.pos : P.pos);
    mech.root.rotation.set(0, pilot && pilot.active ? pilot.parked.yaw : P.bodyYaw, 0);
    mech.resetFeet();
    mech.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; if (o.userData.isOutline) o.visible = settings.outlines; });
    scene.add(mech.root);
    weapons.equip(loadout);
    if (mode !== 'loading') { fx.dust(P.pos, 1.2, 14); sound.servo(P.pos); }
  }
  const ap = Math.max(1, share * f.ap);
  if (pilot && pilot.active) pilot.mechAp = ap; else P.ap = ap;
  $('#unit-code').textContent = f.code;
  $('#unit-name').textContent = f.name.toUpperCase();
}

/**
 * The summon menu (the ` key): in the fight, where the game runs on behind it, or over the loadout
 * before a drop, where what's summoned waits for the fight to start (orders)
 */
const orders = new Map();
function openSummon() {
  if ((mode !== 'play' && mode !== 'loadout') || summonMenu.open) return;
  summonMenu.show(mode === 'loadout');
  input.releaseTouch();
  input.exitLock();
}

/** relock: take the pointer back for aiming (only works inside a click or key press) */
function closeSummon(relock) {
  if (!summonMenu.open) return;
  summonMenu.hide();
  if (relock && mode === 'play') input.requestLock();
}

function toggleSummon() {
  sound.unlock();
  if (summonMenu.open) closeSummon(true);
  else openSummon();
}

/**
 * Right before the fight starts (the clamps are about to open): the drop holds while a notice says
 * this is a tech demo and monsters come from the summon menu. OKAY lets go of the frame.
 */
let briefed = false;
function showBrief() {
  mode = 'brief';
  $('#drop').hidden = true;
  $('#brief').hidden = false;
  input.exitLock();
  input.releaseTouch();
  $('#btn-brief-ok').focus({ preventScroll: true });
}

function dismissBrief() {
  if (mode !== 'brief') return;
  briefed = true;
  $('#brief').hidden = true;
  if (allies.drop) releaseFrame(allies.drop);
  else { mode = 'play'; $('#hud').hidden = false; if (isTouch) $('#touch').hidden = false; }
  // Inside the click (or key press): the pointer can be locked again for aiming
  input.requestLock();
}

/** Deploy: the Kestrel H flies the frame in from the harbor and lets go over the plaza */
function startDrop() {
  redeploy();
  briefed = false;
  mode = 'drop';
  showPanel('#drop');
  $('#drop-hint').textContent = isTouch ? 'TAP · RELEASE NOW' : 'SPACE · RELEASE NOW';
  const D = allies.startDrop(world.spawn);
  P.yaw = P.bodyYaw = D.heading;
  P.pitch = 0.05;
  P.pos.copy(D.feet);
  P.grounded = false;
  mech.root.position.copy(P.pos);
  mech.resetFeet();
  cam.pivotY = P.pos.y + 7.4;
  // Inside the click: the only time the pointer can be locked without another one
  input.requestLock();
}

/** Frame or ride, from the frame select */
function pickStart(id) {
  startAs = id;
  store.set('vectorclad.startAs', id);
  if (mode === 'frames') $('#btn-frame-next').textContent = id === 'mech' ? 'Loadout' : 'Deploy';
}

/** Into the fight as picked: the mech flown in, or straight into a ride */
function deploy() {
  if (startAs === 'mech') startDrop(); else startRide(startAs);
}

/**
 * Deploy in a ride: the APC on the edge of town, the Kestrel over the coast. The mech is left
 * standing on the plaza for the pilot to come back to.
 */
function startRide(kind) {
  redeploy();
  showPanel('');
  pilot.exit(P, P.bodyYaw);
  const r = rides.deploy(kind);
  rides.board({ ride: r }, P);
  P.yaw = r.yaw;
  P.pitch = kind === 'apc' ? 0.04 : -0.12;
  cam.fov = 72;
  mode = 'play';
  $('#hud').hidden = false;
  if (isTouch) $('#touch').hidden = false;
  allies.schedule(14);
  input.requestLock();
}

/** Ask the lifter to let go now: the clamps click and open (over the water, once over the city) */
function releaseNow() {
  if (!allies.releaseEarly()) return;
  $('#drop-hint').textContent = 'RELEASE ARMED';
}

/** Hanging from the cradle: no control, no thrusters, the lifter's turbines in the ears */
let etaShown = '';
function holdInCradle(dt, D) {
  P.pos.copy(D.feet);
  P.vel.copy(D.vel);
  P.yaw = P.bodyYaw = D.heading;
  P.legYaw = 0;
  P.grounded = false;
  for (const k in P.thrust) P.thrust[k] = damp(P.thrust[k], 0, 10, dt);
  washMat.opacity = 0;
  sound.setThrust(0.85, dt);
  const eta = Math.max(0, D.releaseT - D.t).toFixed(1);
  if (eta !== etaShown) $('#drop-eta').textContent = etaShown = eta;
  if (D.released) { if (briefed) releaseFrame(D); else showBrief(); }
  return { speed: 0, gait: 0, ground: 0 };
}

/** The clamps open: the frame drops onto the plaza and is the player's from here */
function releaseFrame(D) {
  mode = 'play';
  // The pointer stays locked from the Deploy click; if it was let go, a click on the view takes it again
  $('#drop').hidden = true;
  $('#hud').hidden = false;
  if (isTouch) $('#touch').hidden = false;
  P.vel.set(D.vel.x, Math.min(0, D.vel.y) - 2, D.vel.z);
  P.grounded = false;
  P.airT = 0;
  mech.resetFeet();
  hud.toast('FRAME RELEASED · WEAPONS FREE', 2.4);
  // What was summoned from the loadout comes through now
  if (orders.size) {
    let n = 0;
    for (const [id, count] of orders) if (summoner.summon(id, count, P).ok) n++;
    orders.clear();
    if (n) { hud.toast(n === 1 ? 'SUMMONED FROM THE LOADOUT · INBOUND' : `${n} SUMMONS FROM THE LOADOUT · INBOUND`, 3); sound.warning(); }
  }
  // The first Kestrels with tanks come in a little after the release
  allies.schedule(14);
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const _f = new V3(), _r = new V3(), _w = new V3(), _t = new V3(), _t2 = new V3();
const NO_INPUT = { move: { x: 0, y: 0 }, lookX: 0, lookY: 0 };

function updatePlayer(dt, c) {
  const playing = mode === 'play';
  if (!playing) c = Object.assign({}, NO_INPUT, { wheel: c.wheel });
  // A frame with less boost burns its gauge faster
  const BD = BOOST_DRAIN / spec.boost;

  // Look
  const sens = 0.0022 * settings.sens;
  P.yaw -= c.lookX * sens;
  P.pitch = clamp(P.pitch - c.lookY * sens * (settings.invert ? -1 : 1), -PITCH_MAX, PITCH_MAX);
  // Lock-on steers the camera so the target stays in view; the mouse still adds on top
  if (playing && hard.target) {
    _t.subVectors(hard.target.pos, _t2.set(P.pos.x, P.pos.y + 6.2, P.pos.z));
    const ty = Math.atan2(_t.x, _t.z);
    const tp = clamp(Math.atan2(_t.y, Math.hypot(_t.x, _t.z)) + 0.04, -PITCH_MAX, PITCH_MAX);
    P.yaw = dampAngle(P.yaw, ty, 3.5, dt);
    P.pitch = damp(P.pitch, tp, 3, dt);
  }
  if (c.wheel) cam.dist = clamp(cam.dist + c.wheel * 1.5, CAM_DIST_MIN, CAM_DIST_MAX);

  _f.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
  _r.set(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
  _w.set(0, 0, 0).addScaledVector(_f, c.move.y).addScaledVector(_r, c.move.x);
  const wishLen = _w.length();
  if (wishLen > 1) _w.divideScalar(wishLen);

  // Seized by an Emperor's pincer: pinned in place. Dashing tears free three times faster.
  if (P.pinT > 0) P.pinT = Math.max(0, P.pinT - dt * (playing && c.dash ? 3 : 1));
  const pinned = P.pinT > 0;

  // Boost / dash
  const canBoost = P.boost > 0 && !P.overheat;
  if (playing && c.dashPressed && canBoost && P.boost > 6 * BD && !pinned) {
    sound.boostIgnite();
    P.boost -= 6 * BD;
    const dir = wishLen > 0.1 ? _t.copy(_w).normalize() : _t.copy(_f);
    P.vel.x += dir.x * 14; P.vel.z += dir.z * 14;
    if (P.grounded) fx.dust(P.pos, 0.8, 8);
  }
  P.dashing = playing && !!c.dash && canBoost;
  // Web slows the mech; dashing tears through it faster
  const webbed = P.webT > 0;
  if (webbed) {
    P.webT = Math.max(0, P.webT - dt * (P.dashing ? 3 : 1));
    if (Math.random() < dt * 14) {
      const a = Math.random() * Math.PI * 2;
      fx.smoke.emit(P.pos.x + Math.cos(a) * 1.6, P.pos.y + 1 + Math.random() * 5, P.pos.z + Math.sin(a) * 1.6, 0, -0.5, 0, 0.9, 1.2, 2.2, 0.9, 0.95, 1, 0.55, 0.85, 0.9, 1, 0, 1, 0);
    }
  }
  const maxSpeed = (P.dashing ? spec.dash : spec.walk) * (webbed ? 0.45 : 1) * (pinned ? 0 : 1);
  const accel = P.grounded ? (P.dashing ? 70 : 30) : (P.dashing ? 45 : 14);
  const target = _t.set(0, 0, 0);
  if (wishLen > 0.08) target.copy(_w).multiplyScalar(maxSpeed);
  else if (P.dashing) target.copy(_f).multiplyScalar(maxSpeed);
  const landSlow = P.landT > 0 ? 0.25 : 1;
  target.multiplyScalar(landSlow);
  _t2.set(target.x - P.vel.x, 0, target.z - P.vel.z);
  const dv = _t2.length();
  const decel = wishLen < 0.08 && !P.dashing && P.grounded ? 45 : accel;
  if (dv > 0) {
    const step = Math.min(dv, decel * dt);
    P.vel.x += (_t2.x / dv) * step;
    P.vel.z += (_t2.z / dv) * step;
  }

  // Vertical
  P.ascending = false;
  P.launchT = Math.max(0, P.launchT - dt);
  P.landT = Math.max(0, P.landT - dt);
  if (P.grounded) {
    P.airT = 0;
    if (playing && c.jumpPressed && P.jumpT <= 0 && P.landT <= 0.05 && !pinned) { P.jumpT = 0.13; sound.servo(P.pos); }
    if (P.jumpT > 0) {
      P.jumpT -= dt;
      if (P.jumpT <= 0) {
        P.vel.y = spec.jump;
        P.grounded = false;
        P.launchT = 0.35;
        if (canBoost) P.boost -= 4 * BD;
        sound.boostIgnite();
        fx.dust(P.pos, 1.2, 14);
        shake(null, 0.25);
      }
    }
  } else {
    P.airT += dt;
    let g = 32;
    if (playing && c.jump && canBoost && P.airT > 0.12) {
      P.ascending = true;
      P.vel.y = Math.min(14, P.vel.y + 62 * dt);
      g = 0;
      P.boost -= 24 * BD * dt;
    } else if (P.dashing) {
      g = 9;
      P.vel.y = Math.max(P.vel.y, -6);
    }
    P.vel.y -= g * dt;
  }
  if (P.dashing) P.boost -= 26 * BD * dt;

  // Integrate
  const prevY = P.pos.y;
  P.pos.addScaledVector(P.vel, dt);
  // Held in a tractor beam: dragged toward the Magnetar a little faster than the mech walks;
  // dashing pulls away
  if (P.pullT > 0) {
    P.pullT -= dt;
    _t2.set(P.pullFrom.x - P.pos.x, 0, P.pullFrom.z - P.pos.z);
    const d = _t2.length();
    if (d > 6) P.pos.addScaledVector(_t2.divideScalar(d), 9.5 * P.pullK * (P.dashing ? 0.25 : 1) * dt);
  }
  // Feet that were within a step of a top last frame can still land on it, however far they fell since
  const stepY = Math.max(prevY, P.pos.y);
  // Blocked by a wall: stop the motion into it and slide along it. The push-out never adds
  // speed, so a frame pushed out of a wall it has sunk into isn't flung away from it.
  const bx = P.pos.x, bz = P.pos.z;
  if (world.resolve(P.pos, 1.5, 7, stepY)) {
    const nx = P.pos.x - bx, nz = P.pos.z - bz, n = Math.hypot(nx, nz);
    const into = n > 1e-6 ? (P.vel.x * nx + P.vel.z * nz) / n : 0;
    if (into < 0) { P.vel.x -= (nx / n) * into; P.vel.z -= (nz / n) * into; }
  }
  // Nor through the millipede's body
  spiders.mill.pushOut(P.pos, 1.5, 7);
  let ground = world.groundHeight(P.pos.x, P.pos.z, stepY, 0.9);
  // Feet just short of a roof with the body over its edge: step up onto the lip, or slip
  // off it when moving away, instead of dropping past it into the wall
  const lip = !P.grounded || P.onLip ? world.ledge(P.pos.x, P.pos.z, stepY, 1.5) : null;
  P.onLip = false;
  if (lip && lip.top > ground + STEP && P.pos.y <= lip.top + 0.05 && P.vel.y <= 1) {
    if (P.vel.x * lip.nx + P.vel.z * lip.nz < 0.5) {
      ground = lip.top;
      P.onLip = true;
      const pull = Math.min(lip.dist - 0.8, 6 * dt);
      P.pos.x -= lip.nx * pull; P.pos.z -= lip.nz * pull;
    } else {
      const push = Math.min(1.5 - lip.dist, 6 * dt);
      P.pos.x += lip.nx * push; P.pos.z += lip.nz * push;
    }
  }
  if (P.pos.y <= ground) {
    P.pos.y = ground;
    // Jetting up past a lip only lifts the feet over it: landing there would cut the thrusters mid-climb
    if (P.grounded || P.vel.y <= 1) {
      if (!P.grounded) {
        const impact = -P.vel.y;
        if (impact > 5) {
          // A hard landing squashes the riftlings under it
          spiders.rift.stomp(P.pos, clamp(impact / 8, 1.8, 4));
          P.landT = clamp(impact / 45, 0.12, 0.45);
          shake(null, clamp(impact / 40, 0.15, 0.7));
          fx.dust(P.pos, clamp(impact / 15, 0.8, 2), 16);
          sound.footstep(P.pos, 1.4);
        }
      }
      P.vel.y = Math.max(0, P.vel.y);
      P.grounded = true;
    }
  } else if (P.grounded && P.pos.y > ground + 0.05) {
    P.grounded = false;
  }
  if (P.grounded && P.pos.y > ground) P.pos.y = ground;

  // Boost regen and overheat
  if (P.dashing || P.ascending) P.boostDelay = 0.6;
  else if (P.grounded) {
    P.boostDelay -= dt;
    if (P.boostDelay <= 0) P.boost = Math.min(100, P.boost + 42 * dt * (P.webT > 0 ? 0.4 : 1));
  }
  if (P.boost <= 0 && !P.overheat) {
    P.boost = 0;
    P.overheat = true;
    hud.toast('OVERHEAT', 1.6);
    sound.alarm();
  }
  if (P.overheat && P.boost >= 40) P.overheat = false;

  // Facing and legs
  P.bodyYaw = dampAngle(P.bodyYaw, P.yaw, mode === 'play' ? 7 : 2, dt);
  const fwdB = _t.set(Math.sin(P.bodyYaw), 0, Math.cos(P.bodyYaw));
  const speed = Math.hypot(P.vel.x, P.vel.z);
  const lz = P.vel.x * fwdB.x + P.vel.z * fwdB.z;
  const lx = P.vel.x * fwdB.z - P.vel.z * fwdB.x; // component toward the mech's left (+X local)
  if (speed > 0.6) {
    if (lz >= -0.35 * speed) { P.legYaw = clamp(Math.atan2(lx, lz), -1.2, 1.2); P.gaitDir = 1; }
    else { P.legYaw = clamp(Math.atan2(-lx, -lz), -1.0, 1.0); P.gaitDir = -1; }
  } else P.legYaw *= 0.9;
  const walking = P.grounded && !P.dashing && P.landT <= 0;
  const gait = walking ? clamp(speed / spec.walk, 0, 1) : 0;

  // Thrusters
  const T = P.thrust;
  const tMain = P.dashing ? 1 : P.ascending ? 0.85 : P.launchT > 0 ? 0.9 : !P.grounded ? 0.12 : 0;
  const tVern = P.dashing ? 0.75 : P.ascending ? 0.55 : P.launchT > 0 ? 0.5 : 0;
  const tCalf = P.ascending ? 0.9 : P.dashing ? 0.55 : P.launchT > 0 ? 0.8 : 0;
  const tSole = P.ascending ? 1 : P.launchT > 0 ? 1 : 0;
  T.main = damp(T.main, tMain, 14, dt);
  T.vern = damp(T.vern, tVern, 14, dt);
  T.calf = damp(T.calf, tCalf, 14, dt);
  T.sole = damp(T.sole, tSole, 14, dt);
  sound.setThrust(Math.max(T.main, T.sole * 0.8), dt);

  // Exhaust particles and ground wash
  if (T.main > 0.3 || T.sole > 0.3) {
    for (const th of mech.allThrusters()) {
      if (th.level < 0.3) continue;
      th.worldExhaust(_t, _t2);
      const s = 6 + 10 * th.level;
      fx.fire.emit(_t.x, _t.y, _t.z, _t2.x * s + P.vel.x, _t2.y * s + P.vel.y, _t2.z * s + P.vel.z,
        0.07, th.size * 1.3, th.size * 0.3, 0.35, 0.5, 1.0, 0.7, 0.4, 0.2, 0.9, 0, 2);
    }
    const alt = P.pos.y - ground;
    if (alt < 9 && (P.ascending || P.launchT > 0) && Math.random() < 0.7) {
      const k = 1 - alt / 9;
      fx.dust(_t.set(P.pos.x, ground, P.pos.z), 0.7 + k, 2);
    }
  }
  {
    const alt = P.pos.y - ground;
    const k = Math.max(T.main * 0.7, T.sole) * Math.max(0, 1 - alt / 12);
    washMat.opacity = k * (0.55 + Math.random() * 0.15);
    wash.position.set(P.pos.x, ground + 0.06, P.pos.z);
    wash.scale.setScalar(6 + alt * 0.8);
  }
  if (P.dashing && P.grounded && Math.random() < 0.8) {
    // Skid sparks and dust behind the feet
    for (let i = 0; i < 2; i++) {
      mech.footWorld(i, _t);
      fx.sparks.emit(_t.x, ground + 0.2, _t.z, -P.vel.x * 0.4 + (Math.random() - 0.5) * 6, Math.random() * 5, -P.vel.z * 0.4 + (Math.random() - 0.5) * 6,
        0.35, 0.16, 0.05, 3, 2, 0.8, 1, 1, 0.4, 0.1, 0.5, 1, -25);
    }
    if (Math.random() < 0.5) {
      const g = 0.5;
      fx.smoke.emit(P.pos.x, ground + 0.4, P.pos.z, -P.vel.x * 0.15, 1, -P.vel.z * 0.15, 1.4, 1.5, 5, g, g * 0.94, g * 0.86, 0.45, g, g, g, 0, 1.5, 0.2);
    }
  }

  return { speed, gait, ground };
}

// ---------------------------------------------------------------------------
// On foot (js/pilot.js): hold G with the frame standing still to climb out, and beside it to climb back in
// ---------------------------------------------------------------------------

const BOARD_HOLD = 0.7;
let exitHold = 0, exitDone = false;

function updateBoarding(dt, c) {
  if (mode !== 'play' || !P.alive || !c.exit) { exitHold = 0; exitDone = false; return; }
  if (exitDone) return;
  // On foot: the mech first, then a ride or a car within reach. In a ride: out.
  const near = pilot.active && !rides.current && !pilot.nearMech(P) ? rides.nearest(P.pos) : null;
  const ok = rides.current ? true : near ? true : pilot.active ? pilot.nearMech(P)
    : P.grounded && Math.hypot(P.vel.x, P.vel.z) < 0.6 && !P.dashing && P.landT <= 0 && P.jumpT <= 0 && P.pinT <= 0 && P.webT <= 0;
  if (!ok) {
    if (exitHold >= 0) hud.toast(pilot.active ? 'GET TO THE FRAME, A RIDE OR A CAR' : 'STAND STILL TO DISEMBARK', 1.2);
    exitHold = -1;
    return;
  }
  if (exitHold <= 0) { exitHold = 0; hud.toast(rides.current ? 'GETTING OUT…' : pilot.active ? 'BOARDING…' : 'DISEMBARKING…', BOARD_HOLD); }
  exitHold += dt;
  if (exitHold < BOARD_HOLD) return;
  exitDone = true;
  if (rides.current) rides.leave(P);
  else if (near) { pilot.release(); rides.board(near, P); }
  else if (pilot.active) {
    pilot.enter(P);
    P.bodyYaw = pilot.parked.yaw;
    mech.resetFeet();
    hud.toast('FRAME ONLINE', 1.4);
  } else {
    setHardLock(null);
    pilot.exit(P, P.bodyYaw);
    hud.toast('ON FOOT · RMB GRAPPLE · Q GRENADE', 3);
  }
}

function updateOnFoot(dt, c) {
  const playing = mode === 'play';
  if (!playing) c = Object.assign({}, NO_INPUT, { wheel: c.wheel });
  const sens = 0.0022 * settings.sens;
  P.yaw -= c.lookX * sens;
  P.pitch = clamp(P.pitch - c.lookY * sens * (settings.invert ? -1 : 1), -PITCH_MAX, PITCH_MAX);
  washMat.opacity = 0;
  const speed = rides.current ? rides.update(dt, c, P, aim, playing) : pilot.update(dt, c, P, BOOST_DRAIN / spec.boost, aim, playing, hud);
  return { speed, gait: 0, ground: P.pos.y };
}

// ---------------------------------------------------------------------------
// Camera & aim
// ---------------------------------------------------------------------------

const aim = { point: new V3(), dir: new V3() };

// Lock-on button: holds one target for the aimed weapons and the camera
const hard = { target: null };
const _ndc = new V3();

function lockCandidates() {
  const out = [];
  for (const t of world.targets) {
    if (!t.alive || t.stealth || t.pos.distanceTo(P.pos) > 460) continue;
    _ndc.copy(t.pos).project(camera);
    if (_ndc.z > 1) continue;
    const r = Math.hypot(_ndc.x * camera.aspect, _ndc.y);
    if (r < 1.25) out.push({ t, r });
  }
  // Targets in clear view come first, nearest the crosshair first
  out.sort((a, b) => a.r - b.r);
  const seen = [], hidden = [];
  for (const c of out) (seen.length < 6 && inView(c.t) ? seen : hidden).push(c);
  return seen.concat(hidden);
}

const _los = new V3();
function inView(t) {
  _los.subVectors(t.pos, camera.position);
  const d = _los.length();
  const hit = world.raycast(camera.position, _los.divideScalar(d), d, { targets: false });
  return !hit || hit.dist > d - t.radius - 1;
}

function setHardLock(t) {
  hard.target = t;
  weapons.hardTarget = t;
}

function pressLock() {
  const c = lockCandidates();
  if (!c.length) {
    if (hard.target) { setHardLock(null); hud.toast('LOCK RELEASED', 0.8); }
    else sound.empty();
    return;
  }
  // Pressing again while still pointed at the locked target releases it
  if (hard.target && c[0].t === hard.target) { setHardLock(null); hud.toast('LOCK RELEASED', 0.8); sound.click(); return; }
  setHardLock(c[0].t);
  sound.lockFull();
}

function updateHardLock() {
  const t = hard.target;
  if (!t) return;
  // Lost when it dies, burrows out of sight, or goes dark
  if (!t.alive || t.stealth || !world.targets.includes(t)) {
    // Roll onto the next target in view, if any
    const c = lockCandidates();
    setHardLock(c.length ? c[0].t : null);
    if (hard.target) sound.lock();
  } else if (t.pos.distanceTo(P.pos) > 520) setHardLock(null);
}

function leadPoint(out) {
  const t = hard.target;
  const s = weapons.slots.rightHand;
  const speed = s && s.def.speed ? s.def.speed : 0;
  const d = t.pos.distanceTo(P.pos);
  out.copy(t.pos);
  if (speed > 0) out.addScaledVector(t.vel, Math.min(2, d / speed));
  return out;
}
const camDir = new V3(), camRight = new V3(), camFwd = new V3(), pivot = new V3(), camPos = new V3(), dropQ = new THREE.Quaternion();

function updateCamera(dt, speed) {
  const dropping = (mode === 'drop' || mode === 'brief') && allies.drop;
  cam.pivotY = dropping ? P.pos.y + 7.4 : damp(cam.pivotY, P.pos.y + 7.4, 10, dt);
  pivot.set(P.pos.x, cam.pivotY, P.pos.z);
  camera.near = 0.6;
  if (pilot.active && mode === 'play' && !cam.debugOrbit) {
    // On foot: through the pilot's eyes, or close over the shoulder
    if (rides.current) pivot.copy(rides.placeCamera(dt, P, camera, camDir));
    else { pilot.placeCamera(dt, P, camera, camDir); pivot.copy(pilot.camPos); }
    cam.fov = damp(cam.fov, P.dashing ? 80 : 72, 4, dt);
  } else if ((mode === 'play' || dropping) && !cam.debugOrbit) {
    camDir.set(Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), Math.cos(P.yaw) * Math.cos(P.pitch));
    camRight.set(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
    // Shoulder offset, pulled in when a wall is close on that side
    let side = 4.4;
    const sideHit = world.raycast(pivot, camRight, side + 1.2, { targets: false });
    if (sideHit) side = Math.max(0, sideHit.dist - 1.2);
    const origin = _t.copy(pivot).addScaledVector(camRight, side);
    // Looking steeply down, slide forward so the crosshair comes to rest on the ground just
    // ahead of the feet, where the arms can reach, instead of passing beside the mech
    let ahead = 4.5 - 7.4 / Math.tan(Math.max(0.01, -P.pitch));
    if (ahead > 0) {
      camFwd.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
      const aheadHit = world.raycast(origin, camFwd, ahead + 1.2, { targets: false });
      if (aheadHit) ahead = Math.max(0, aheadHit.dist - 1.2);
      origin.addScaledVector(camFwd, ahead);
    }
    // Pull in when something blocks the view
    const back = _t2.copy(camDir).negate();
    const hit = world.raycast(origin, back, cam.dist, { targets: false });
    const dist = hit ? Math.max(3, hit.dist - 0.8) : cam.dist;
    camPos.copy(origin).addScaledVector(back, dist);
    camPos.y += 1.0;
    camPos.y = Math.max(camPos.y, world.groundHeight(camPos.x, camPos.z, camPos.y) + 0.8);
    camera.position.copy(camPos);
    camera.lookAt(_t.copy(camPos).add(camDir));
    const fovT = P.dashing ? 72 : 60;
    cam.fov = damp(cam.fov, fovT, 4, dt);
    if (dropping) {
      // The insertion: a chase shot of the lifter that eases into this view by the release (from
      // the clamps' clicks when the frame is let go early)
      const D = allies.drop, k = smoothstep(D.camT, D.releaseT, D.t);
      dropQ.copy(camera.quaternion);
      camera.position.copy(D.cam.pos);
      camera.lookAt(D.cam.look);
      camera.position.lerp(camPos, k);
      camera.quaternion.slerp(dropQ, k);
      camDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    }
  } else {
    // Showroom orbit for the intro and hangar
    cam.orbit += dt * cam.orbitSpeed;
    const r = cam.orbitR;
    camPos.set(P.pos.x + Math.sin(cam.orbit) * r, P.pos.y + cam.orbitY, P.pos.z + Math.cos(cam.orbit) * r);
    camera.position.copy(camPos);
    const look = _t.set(P.pos.x, P.pos.y + cam.lookY, P.pos.z);
    // Shift the mech left of center while a side panel covers the right, right of it while the
    // intro or frame select covers the left
    const sidePanel = mode === 'hangar' || mode === 'loadout';
    const panelOpen = sidePanel && !hangarSheet.matches;
    const introOpen = (mode === 'intro' || mode === 'frames') && window.innerWidth > 720;
    if (panelOpen || introOpen) {
      _t2.subVectors(look, camPos).normalize().cross(new V3(0, 1, 0)).normalize();
      // On a landscape phone the two frame cards sit side by side and reach further across
      look.addScaledVector(_t2, panelOpen ? 4.5 : mode === 'frames' && window.innerHeight <= 500 ? -7 : -4.5);
    }
    if (sidePanel && hangarSheet.matches) look.y -= 2.5;
    camera.lookAt(look);
    camDir.subVectors(look, camPos).normalize();
    cam.fov = damp(cam.fov, 50, 3, dt);
  }
  if (cam.free) {
    // Debug/screenshot camera: { pos: [x, y, z], look: [x, y, z], fov }
    camera.position.set(...cam.free.pos);
    camera.lookAt(_t.set(...cam.free.look));
    cam.fov = cam.free.fov || cam.fov;
  }
  // On portrait screens, widen the vertical FOV so the view is never narrower than it is tall;
  // otherwise an upright tablet crops the mech off the side of the screen.
  camera.fov = camera.aspect < 1 ? 2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) / camera.aspect) * 180 / Math.PI : cam.fov;
  camera.updateProjectionMatrix();

  // Shake
  if (cam.shake > 0) {
    const s = cam.shake * cam.shake * 0.5;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
    cam.shake = Math.max(0, cam.shake - dt * 1.8);
  }

  // Aim point: ray through screen center starting at the mech's depth
  const startT = Math.max(0, _t.subVectors(pivot, camera.position).dot(camDir));
  const o = _t2.copy(camera.position).addScaledVector(camDir, startT);
  const hit = world.raycast(o, camDir, 700);
  aim.point.copy(hit ? hit.point : o.addScaledVector(camDir, 700));
  if (hard.target && mode === 'play') leadPoint(aim.point);
  aim.dir.copy(camDir);

  sound.listener.x = camera.position.x;
  sound.listener.y = camera.position.y;
  sound.listener.z = camera.position.z;
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

let last = performance.now();
const feetA = new V3(), feetB = new V3();
const UPV = new V3(0, 1, 0);
const spiderCtx = { player: P, camera };
const shoulder = new V3();
const HELD = { speed: 0, gait: 0, ground: 0 };
const ZERO = new V3(), NO_THRUST = { main: 0, vern: 0, calf: 0, sole: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = window.__mech && window.__mech.fixedDt ? window.__mech.fixedDt : Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  const c = input.sample();
  if (c.menu) { if (mode === 'play') openHangar(); else if (mode === 'hangar') startPlay(); }
  if (c.reload && mode === 'play') weapons.reloadAll();
  if (c.lockon && mode === 'play' && !pilot.active) pressLock();
  updateBoarding(dt, c);
  updateHardLock();

  // The Kestrel H: carrying the frame in, then climbing away after the release
  const running = mode === 'drop' || mode === 'play' || mode === 'over';
  const D = running && allies.drop ? allies.updateDrop(dt) : null;
  // Held at the release while the tech-demo notice is up: nothing moves
  const { speed, gait } = mode === 'brief' ? HELD : mode === 'drop' && D ? holdInCradle(dt, D) : pilot.active ? updateOnFoot(dt, c) : updatePlayer(dt, c);
  if (mode === 'play' && P.dashing && !pilot.active) spiders.rift.ram(P.pos, P.vel);
  updateCamera(dt, speed);
  if (rides.current) P.chest.set(P.pos.x, P.pos.y + 2 / METERS, P.pos.z);
  else if (pilot.active) pilot.chest(P.chest, P); else P.chest.set(P.pos.x, P.pos.y + 4.8, P.pos.z);

  // Armor regenerates out of contact; the swarm runs while playing and over the wreck
  if (mode === 'play' && P.alive) {
    P.runT += dt;
    P.hurtT += dt;
    // Venom eats armor and holds off regeneration while it lasts
    if (P.venomT > 0) {
      P.venomT -= dt;
      P.hurtT = 0;
      P.ap -= VENOM_DPS * dt;
      if (Math.random() < dt * 18) {
        const a = Math.random() * Math.PI * 2;
        fx.smoke.emit(P.pos.x + Math.cos(a) * 1.5, P.pos.y + 1 + Math.random() * 5, P.pos.z + Math.sin(a) * 1.5, 0, 1.2, 0, 0.8, 0.8, 2, 0.35, 0.9, 0.15, 0.6, 0.2, 0.5, 0.1, 0, 0.5, 0.5);
      }
      if (P.ap <= 0) die();
    }
    if (P.alive && P.hurtT > REGEN_DELAY) P.ap = Math.min(apMax(), P.ap + REGEN_RATE * dt * (pilot.active ? 0.3 : 1));
  }
  if (mode === 'play' || mode === 'over') {
    summoner.update(dt);
    spiders.update(dt, spiderCtx);
    portals.update(dt);
  }
  summonMenu.update();
  // Tanks and their Kestrels fight on over the wreck; new packs only come while the mech fights
  if (running) {
    allies.update(dt, {
      player: P.pos, packs: mode === 'play' && P.alive,
      onPack: (n) => hud.toast(`KESTRELS INBOUND · ${n} BASTION${n === 1 ? '' : 'S'}`, 2.6),
    });
  }
  if (mode === 'over') {
    P.deadT += dt;
    if (P.deadT > 1.8 && $('#gameover').hidden) $('#gameover').hidden = false;
    // The wreck burns
    const k = Math.max(0.3, 1 - P.deadT / 12);
    if (Math.random() < dt * 30 * k) {
      const g = 0.12 + Math.random() * 0.08;
      fx.smoke.emit(P.chest.x + (Math.random() - 0.5) * 2, P.chest.y, P.chest.z + (Math.random() - 0.5) * 2, Math.random() - 0.5, 3 + Math.random() * 2, Math.random() - 0.5,
        3.5, 1.5, 7, g, g, g, 0.7, g + 0.2, g + 0.2, g + 0.2, 0, 0.6, 0.4);
    }
    if (Math.random() < dt * 14 * k) fx.fire.emit(P.chest.x, P.chest.y - 0.5, P.chest.z, Math.random() - 0.5, 2, Math.random() - 0.5, 0.4, 1.4, 0.4, 3, 1.4, 0.4, 1, 1, 0.2, 0.05, 0, 1);
    if (Math.random() < dt * 1.5 * k) fx.sparksBurst(_t.copy(P.chest).add(_t2.set(Math.random() - 0.5, Math.random() * 2 - 1, Math.random() - 0.5)), UPV, 12, 0xffc070, 18);
  }

  // Aim angles from the shoulders toward the aim point
  shoulder.set(P.pos.x, P.pos.y + 6.2, P.pos.z);
  _t.subVectors(aim.point, shoulder);
  const aimYawWorld = Math.atan2(_t.x, _t.z);
  const aiming = mode === 'play' && !cam.debugOrbit && !pilot.active;
  const aimPitch = aiming ? Math.atan2(_t.y, Math.hypot(_t.x, _t.z)) : 0;
  const aimYaw = aiming ? clamp(wrap(aimYawWorld - P.bodyYaw), -1.2, 1.2) : 0;

  // Weapons (input only while playing)
  const wc = mode === 'play' && !pilot.active ? c : { fireR: false, fireL: false, fireS: false, missile: false, salvo: false };
  weapons.update(dt, wc, aim, camera);

  // Animate mech: standing where the pilot left it while on foot
  const parked = pilot.active;
  mech.root.position.copy(parked ? pilot.parked.pos : P.pos);
  mech.root.rotation.set(0, parked ? pilot.parked.yaw : P.bodyYaw, 0);
  // Hanging from the cradle it pitches and rolls with the lifter
  if (mode === 'drop' && D && !D.released) mech.root.quaternion.copy(D.mechQ);
  const H = weapons.hand;
  const res = mech.animate(dt, {
    gait: parked ? 0 : gait, air: parked || P.grounded ? 0 : 1, dash: !parked && P.dashing ? 1 : 0,
    vel: parked ? ZERO : P.vel, bodyYaw: parked ? pilot.parked.yaw : P.bodyYaw, ground: parked ? pilot.parked.pos.y : P.pos.y,
    crouch: parked ? 0.5 : !P.alive ? 1 : P.jumpT > 0 ? 1 : P.landT > 0 ? Math.min(1, P.landT * 3) : 0,
    legYaw: parked ? 0 : P.legYaw, aimYaw, aimPitch,
    aim: [H[0].aim, H[1].aim], recoil: [H[0].recoil, H[1].recoil], reload: [H[0].reload, H[1].reload],
    shield: weapons.shieldUp, hasShield: !!(weapons.slots.leftHand && weapons.slots.leftHand.def.kind === 'shield'),
    thrust: parked ? NO_THRUST : (window.__mech && window.__mech.forceThrust) || P.thrust, time,
  });
  if (parked) pilot.animate(dt, P, P.pitch, time, mode === 'play' && !rides.current);
  if (parked && rides.current) pilot.body.root.visible = pilot.view.group.visible = false;
  rides.animate(dt, P);
  if (res.step >= 0) {
    mech.footWorld(res.step, _t);
    _t.y = P.pos.y;
    const k = res.soft ? 0.45 : 1;
    fx.dust(_t, (0.6 + gait * 0.4) * k, res.soft ? 4 : 8);
    spiders.rift.stomp(_t, 1.7);
    sound.footstep(_t, (0.75 + gait * 0.4) * k);
    shake(null, (0.16 + gait * 0.12) * k);
  }

  world.update(dt, P.pos, { grounded: parked || P.grounded, vel: parked ? ZERO : P.vel, feet: [mech.footWorld(0, feetA), mech.footWorld(1, feetB)], camera });
  fx.update(dt);

  if (mode === 'play' || mode === 'hangar' || mode === 'over') {
    hud.update(dt, {
      ap: P.ap, apMax: apMax(), hostiles: spiders.hostiles, boss: spiders.boss,
      boost: P.boost, overheat: P.overheat,
      speed: speed * METERS * 3.6, alt: (P.pos.y) * METERS,
      locks: weapons.lock.locks, missiles: weapons.missilesLoaded, missileCap: weapons.missileCapacity,
      weapons: weapons.status(), camera, hard: hard.target, meters: METERS,
    });
  }

  if (!(window.__mech && window.__mech.skipRender)) {
    skipEmpty();
    if (post.active) {
      // A hit flashes red in from the edges and shakes the colors apart; low armor keeps a pulse of red
      const hit = mode === 'play' ? Math.exp(-P.hurtT * 3.5) : 0, low = mode === 'play' && P.alive ? smoothstep(0.3, 0.1, P.ap / apMax()) : 0;
      post.state.hurt = Math.min(1, hit * 0.8 + low * (0.3 + 0.12 * Math.sin(time * 5)));
      post.state.ca = hit * 0.05 + (P.dashing ? 0.012 : 0);
      post.render(dt);
    } else renderer.render(scene, camera);
  }
  pace(now);
}

/**
 * Instanced meshes with nothing in them (furniture before a building breaks open, spider parts
 * between waves, stumps, idle particles) would still bind their shaders and upload their
 * uniforms every frame, and again for the shadow map: off the camera's layer while empty.
 */
function skipEmpty() {
  scene.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    const g = o.geometry, n = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : g.drawRange.count;
    if (n > 0) o.layers.enable(0); else o.layers.disable(0);
  });
}

/**
 * Auto graphics: while playing, watch how long frames take, and step down a setting when play
 * stays slow (under about 45 frames a second for most of four seconds).
 */
function pace(now) {
  const A = autoGfx;
  if (settings.graphics !== 'auto' || mode !== 'play' || A.tier === 'low') { A.t0 = 0; return; }
  if (!A.t0) { A.t0 = now; A.n = 0; return; }
  A.n++;
  if (now - A.t0 < 2000) return;
  A.slow = (now - A.t0) / A.n > 1000 / 45 ? A.slow + 1 : 0;
  A.t0 = 0;
  if (A.slow >= 2) {
    A.slow = 0;
    A.tier = TIERS[TIERS.indexOf(A.tier) - 1];
    applyGraphics();
  }
}

init().catch((err) => {
  console.error(err);
  $('#load-msg').textContent = `Could not start: ${err.message}`;
});

// Debug/test hook
window.__mech = {
  P, cam, input, get pilot() { return pilot; }, get rides() { return rides; }, startPlay, openHangar, redeploy, hurt, get AP_MAX() { return spec.ap; }, get spiders() { return spiders; }, scene, camera,
  openFrames, openLoadout, startDrop, setFrame, openSummon, closeSummon, dismissBrief,
  get summoner() { return summoner; }, get portals() { return portals; }, get summonMenu() { return summonMenu; }, get frame() { return spec; }, get allies() { return allies; },
  applyPaintById: (id) => applyPaint(mats, PAINTS.find((p) => p.id === id) || PAINTS[0]),
  renderer, post, settings, applySettings, get METERS() { return METERS; }, get time() { return time; }, get weapons() { return weapons; }, get world() { return world; }, get destruct() { return world && world.destruct; }, get mech() { return mech; }, get mode() { return mode; },
};
