// Tests XR input, camera math and session recovery using three.js 0.170.0 geometry.
// No headset or WebGL context is required. Point THREE_RUNTIME at the pinned ES module:
//   THREE_RUNTIME=node_modules/three/build/three.module.js node --test tools/tests/xr.js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setMaxListeners } = require('node:events');
const threeFile = process.env.THREE_RUNTIME;
if (!threeFile) throw new Error('Set THREE_RUNTIME to the three.js 0.170.0 ES module (see the header).');
const runtime = (async () => {
  const threeURL = pathToFileURL(path.resolve(threeFile)).href;
  const inputURL = pathToFileURL(path.resolve(__dirname, '../../js/input.js')).href;
  const source = fs.readFileSync(path.resolve(__dirname, '../../js/xr.js'), 'utf8')
    .replace("'./three.js'", JSON.stringify(threeURL)).replace("'./input.js'", JSON.stringify(inputURL));
  return { THREE: await import(threeURL), ...(await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))), ...(await import(inputURL)) };
})();
let elements, enterButton, mapButton, labels;
const classList = { add() {}, remove() {}, toggle() {} };
global.window = new EventTarget();
global.document = Object.assign(new EventTarget(), {
  hidden: false, body: { classList }, activeElement: null,
  getElementById: (id) => elements?.[id] || null,
  querySelectorAll: selector => selector === '[data-enter-xr]' ? [enterButton] : [mapButton],
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ ...Object.fromEntries(['clearRect', 'fillRect', 'strokeRect', 'save', 'restore', 'beginPath', 'rect', 'clip', 'translate', 'moveTo', 'lineTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke', 'arc'].map(name => [name, () => {}])), fillText: text => labels.push(text) }) }),
});
// Each fixture installs an independent Input on these shared browser stand-ins.
setMaxListeners(0, global.window, global.document);
Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });

class Session extends EventTarget {
  constructor() { super(); this.visibilityState = 'visible'; this.inputSources = []; }
  async end() { this.dispatchEvent(new Event('end')); }
}
function event(type, props) { return Object.assign(new Event(type), props); }
async function fixture(options = {}) {
  const { THREE, Input, Immersive } = await runtime;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.6, 9000);
  const input = new Input(new EventTarget());
  let pauses = 0;
  const session = new Session();
  const reference = {};
  const xrCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
  const head = { x: 1, y: 1.5, z: 2 };
  const renderer = { xr: {
    setReferenceSpaceType() {}, setFramebufferScaleFactor() {},
    getReferenceSpace: () => reference, getCamera: () => xrCamera,
    async setSession(value) { this.session = value; },
    updateCamera(view) { view.position.set(head.x, head.y, head.z); view.quaternion.identity(); view.updateMatrixWorld(true); },
  } };
  Object.defineProperty(navigator, 'xr', { configurable: true, value: {
    isSessionSupported: async () => true, requestSession: async () => session, ...options,
  } });
  const status = { textContent: '' };
  const xr = new Immersive({ renderer, scene, camera, input, status, onPause: () => pauses++, onRelease() {}, onGesture() {} });
  await Promise.resolve();
  const player = { pos: new THREE.Vector3(20, 10, 30), yaw: 0 };
  const frame = { getViewerPose: () => ({ transform: { position: { x: 1, y: 1.5, z: 2 } } }), getPose: () => ({ transform: { position: head, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) };
  return { xr, input, camera, renderer, session, status, player, head, frame, THREE, get pauses() { return pauses; } };
}
beforeEach(async () => {
  elements = {}; enterButton = Object.assign(new EventTarget(), { hidden: true });
  mapButton = Object.assign(new EventTarget(), { hidden: true }); labels = [];
  const { gamepad } = await runtime; gamepad.reset(); gamepad.look = { x: 0, y: 0 };
  gamepad.immersive = gamepad.xrSuspended = false;
  gamepad.xrOverlay = 'controls';
});

test('feature detection exposes VR only where supported', async () => {
  await fixture(); assert.equal(enterButton.hidden, false);
  const f = await fixture({ isSessionSupported: async () => false });
  assert.equal(enterButton.hidden, true); assert.match(f.status.textContent, /Safari window/);
});

test('denied entry leaves controls usable and permits a retry', async () => {
  let tries = 0;
  const f = await fixture({ requestSession: async () => { tries++; throw new Error('Permission denied'); } });
  await f.xr.enter(); await f.xr.enter();
  assert.equal(tries, 2); assert.equal(f.xr.active, false); assert.equal(f.xr.pending, false);
  assert.equal(f.input.xrActive, false); assert.equal(f.xr.rig.visible, false);
  assert.equal(f.pauses, 0); assert.match(f.status.textContent, /Permission denied/);
});

test('camera stays in game world space while physical head movement uses meter scale', async () => {
  const f = await fixture(); await f.xr.enter();
  assert.equal(f.xr.updateView(f.frame, f.player, 2, 9, 'play'), true);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} = ${b}`);
  close(f.camera.position.x, 20); close(f.camera.position.y, 18.4); close(f.camera.position.z, 21);
  f.head.x += 0.2; f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  close(f.camera.position.x, 19.9);
  assert.equal(f.camera.parent, null);
  assert.equal(f.xr.renderer.xr.cameraAutoUpdate, false);
});

test('transient pointers can fire both hands without a gamepad, gripSpace or fixed source index', async () => {
  const f = await fixture(); await f.xr.enter(); f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  const left = { handedness: 'left', targetRayMode: 'transient-pointer', targetRaySpace: {} };
  const right = { handedness: 'right', targetRayMode: 'transient-pointer', targetRaySpace: {} };
  f.session.inputSources = [{ hand: {} }, { hand: {} }, left, right];
  f.session.dispatchEvent(event('selectstart', { frame: f.frame, inputSource: left }));
  f.session.dispatchEvent(event('selectstart', { frame: f.frame, inputSource: right }));
  assert.equal(f.input.spatial.held.has('fireL'), true); assert.equal(f.input.spatial.held.has('fireR'), true);
  f.session.dispatchEvent(event('selectend', { inputSource: left }));
  assert.equal(f.input.spatial.held.has('fireL'), false); assert.equal(f.input.spatial.held.has('fireR'), true);
  f.session.dispatchEvent(event('inputsourceschange', { removed: [right] }));
  assert.equal(f.input.spatial.held.size, 0);
});

test('a real panel ray activates its button and cannot fire through the UI', async () => {
  const f = await fixture(); await f.xr.enter(); f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  f.xr.setPanelOpen(true); f.xr.draw('play');
  f.xr.rig.updateMatrixWorld(true);
  const button = f.xr.buttons.find((b) => b.action === 'jump');
  const target = new f.THREE.Vector3((button.x + button.w / 2) / 1200 * 1.9 - 0.95, 0.6 - (button.y + button.h / 2) / 760 * 1.2, 0);
  f.xr.panel.localToWorld(target); f.xr.rig.worldToLocal(target);
  const eye = new f.THREE.Vector3(f.head.x, f.head.y, f.head.z);
  const q = new f.THREE.Quaternion().setFromRotationMatrix(new f.THREE.Matrix4().lookAt(eye, target, new f.THREE.Vector3(0, 1, 0)));
  const frame = { getPose: () => ({ transform: { position: f.head, orientation: q } }) };
  const source = { targetRaySpace: {}, handedness: 'right' };
  f.xr.select({ frame, inputSource: source });
  assert.equal(f.input.spatial.held.has('jump'), true);
  assert.equal(f.input.spatial.edges.has('jump'), true);
  assert.equal(f.input.spatial.held.has('fireR'), false);
  f.xr.release(source); assert.equal(f.input.spatial.held.size, 0);
});

test('VR entry controls become working Exit VR controls and restore after exit', async () => {
  const f = await fixture(); await f.xr.enter();
  assert.equal(enterButton.textContent, 'Exit VR'); assert.equal(mapButton.hidden, false);
  await f.xr.checkSupport(); assert.equal(enterButton.textContent, 'Exit VR');
  enterButton.dispatchEvent(new Event('click')); await Promise.resolve();
  assert.equal(f.xr.active, false); assert.equal(enterButton.textContent, 'Enter VR · Vision Pro');
  assert.equal(mapButton.hidden, true);
});

test('the panel collapses in combat and its dock can reopen it without hiding the world', async () => {
  const { gamepad } = await runtime, f = await fixture(); await f.xr.enter();
  f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  assert.equal(f.xr.panelOpen, false); assert.equal(gamepad.xrOverlay, 'collapsed');
  assert.ok(f.xr.buttons.some(b => b.action === 'panel'));
  assert.equal(f.xr.buttons.some(b => b.action === 'fireR'), false);
  f.xr.activate({ action: 'panel' }, {}); f.xr.draw('play');
  assert.equal(f.xr.panelOpen, true); assert.equal(gamepad.xrOverlay, 'controls');
  assert.ok(f.xr.buttons.some(b => b.action === 'fireR'));
  f.xr.holds.set({}, { action: 'fireR' }); f.xr.syncHeld();
  f.xr.activate({ action: 'panel' }, {});
  assert.equal(f.input.spatial.held.size, 0);
  // The transparent part of a collapsed panel must not intercept a world pinch.
  f.xr.raycaster.intersectObject = () => [{ uv: { x: 0.5, y: 0.8 } }];
  f.xr.select({ frame: f.frame, inputSource: { handedness: 'right', targetRaySpace: {} } });
  assert.equal(f.input.spatial.held.has('fireR'), true);
});

test('the Xbox map pauses combat, shows VR bindings, and closes without leaving VR', async () => {
  const { gamepad } = await runtime, f = await fixture(); await f.xr.enter();
  f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  f.xr.showControllerMap(); f.xr.draw('play');
  assert.equal(f.pauses, 1); assert.equal(gamepad.xrOverlay, 'map');
  assert.ok(labels.includes('XBOX CONTROLLER · VR'));
  assert.ok(labels.includes('Show / hide panel')); assert.ok(labels.includes('Snap turn 30°'));
  const c = { move: { x: 1, y: 0 }, lookX: 9, lookY: 8, fireR: true };
  f.xr.filterInput(c, f.player, 'play'); assert.equal(c.fireR, false); assert.equal(c.move.x, 0);
  gamepad.onXRBack(); assert.equal(f.xr.helpOpen, false); assert.equal(f.xr.active, true);
  gamepad.onXRMenu(); assert.equal(f.xr.panelOpen, false);
});

test('static maps and paused HUDs reuse their canvas texture until visible content changes', async () => {
  const f = await fixture(); await f.xr.enter();
  f.xr.showControllerMap();
  assert.equal(f.xr.refreshPanel('hangar'), true);
  const revision = f.xr.panelRevision, version = f.xr.texture.version;
  for (let i = 0; i < 20; i++) assert.equal(f.xr.refreshPanel('hangar'), false);
  assert.equal(f.xr.panelRevision, revision); assert.equal(f.xr.texture.version, version);
  f.xr.setPanelOpen(false); assert.equal(f.xr.refreshPanel('hangar'), true);
  assert.equal(f.xr.refreshPanel('hangar'), false);
  f.xr.firstPerson = true; assert.equal(f.xr.refreshPanel('hangar'), true);
  elements['ap-txt'] = { textContent: '900' }; assert.equal(f.xr.refreshPanel('hangar'), true);
});

test('raised combat HUD reads live armor, reload, shield, target and boost state', async () => {
  const f = await fixture(); await f.xr.enter(); f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  assert.ok(f.xr.panel.position.y > -0.65);
  const state = { ap: 200, apMax: 880, boost: 12, overheat: true, shield: true, speed: 20, alt: 10,
    missiles: 4, missileCap: 12, locks: [{}], hostiles: 3, notice: '', actor: 'PX-09',
    hard: { alive: true, name: 'SCORPION', hp: 50, maxHp: 100, pos: f.camera.position.clone().addScalar(10) },
    camera: f.camera, meters: 2,
    weapons: [{ slot: { id: 'rightHand' }, name: 'BEAM RIFLE', kind: 'beam', ammo: 2, max: 16, reload: 0.5 },
      { slot: { id: 'leftHand' }, name: 'SHIELD', kind: 'shield' }] };
  f.xr.setHUD(state); f.xr.refreshPanel('play');
  assert.ok(labels.includes('ARMOR 200 / 880')); assert.ok(labels.includes('BOOST · OVERHEATED'));
  assert.ok(labels.includes('RELOADING 50%')); assert.ok(labels.includes('SHIELD RAISED'));
  assert.ok(labels.includes('LOW ARMOR · Take cover to regenerate'));
  assert.equal(f.xr.hudSnapshot().target.health, 50);
  const revision = f.xr.panelRevision;
  state.weapons[0].reload = null; state.weapons[0].ammo = 16; state.shield = false;
  assert.equal(f.xr.refreshPanel('play'), true); assert.equal(f.xr.panelRevision, revision + 1);
  assert.ok(labels.includes('16 / 16 · PINCH TO RELOAD'));
  f.xr.activate(f.xr.buttons.find(b => b.action === 'reload'), {});
  assert.equal(f.input.sample().reload, true);
  const source = {}; f.xr.activate(f.xr.buttons.find(b => b.action === 'fireL'), source);
  assert.equal(f.input.sample().fireL, true); f.xr.release(source); assert.equal(f.input.sample().fireL, false);
  f.xr.activate(f.xr.buttons.find(b => b.action === 'missile'), {});
  assert.equal(f.input.sample().missile, true);
});

test('combat HUD background consumes pinches and paused weapon cards cannot fire', async () => {
  const f = await fixture(); await f.xr.enter(); f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  const source = { handedness: 'right', targetRaySpace: {} };
  f.xr.raycaster.intersectObject = () => [{ uv: { x: 0.5, y: 1 - 530 / 760 } }];
  f.xr.select({ frame: f.frame, inputSource: source });
  assert.equal(f.input.spatial.held.has('fireR'), false);
  f.xr.draw('hangar');
  const card = f.xr.buttons.find(b => b.action === 'reload');
  assert.equal(card.disabled, true); f.xr.activate(card, source);
  assert.equal(f.input.sample().reload, false);
});

test('XR quality steps down after sustained slow frames and restores only after sustained recovery', async () => {
  const f = await fixture(); await f.xr.enter(); f.xr.tracked = true;
  const changes = []; f.xr.onQuality = level => changes.push(level);
  let now = 100;
  const frames = (step, count, mode = 'play') => { for (let i = 0; i < count; i++) { now += step; f.xr.samplePerformance(now, mode); } };
  frames(30, 145); assert.equal(f.xr.quality, 1);
  frames(30, 140); assert.equal(f.xr.quality, 2);
  frames(10, 650); assert.equal(f.xr.quality, 1);
  frames(10, 620); assert.equal(f.xr.quality, 0);
  assert.deepEqual(changes, [1, 2, 1, 0]);
  frames(40, 250, 'hangar'); assert.equal(f.xr.quality, 0);
  assert.equal(f.xr.performance.frames, 0);
});

test('head tracking loss and obscured sessions release inputs and pause', async () => {
  const f = await fixture(); await f.xr.enter(); f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  f.xr.holds.set({}, { action: 'forward' }); f.xr.syncHeld();
  f.xr.updateView({ getViewerPose: () => null }, f.player, 2, 9, 'play');
  assert.equal(f.xr.tracked, false); assert.equal(f.input.spatial.move.y, 0); assert.equal(f.pauses, 1);
  f.xr.updateView({ getViewerPose: () => null }, f.player, 2, 9, 'play'); assert.equal(f.pauses, 1);
  f.session.visibilityState = 'visible-blurred'; f.session.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.xr.suspended, true); assert.equal(f.pauses, 2);
});

test('snap turn happens once per stick excursion and ignores forced look pitch', async () => {
  const { gamepad } = await runtime, f = await fixture(); await f.xr.enter();
  f.xr.updateView(f.frame, f.player, 2, 9, 'play'); gamepad.look.x = 1;
  const c = () => ({ lookX: 10, lookY: 8, move: { x: 0, y: 0 } });
  const first = c(); f.xr.filterInput(first, f.player, 'play');
  assert.equal(first.lookX, 0); assert.equal(first.lookY, 0);
  assert.ok(Math.abs(f.player.yaw + Math.PI / 6) < 1e-9);
  f.xr.filterInput(c(), f.player, 'play'); assert.ok(Math.abs(f.player.yaw + Math.PI / 6) < 1e-9);
  gamepad.look.x = 0; f.xr.filterInput({ ...c(), lookX: 0 }, f.player, 'play');
  gamepad.look.x = 1; f.xr.filterInput(c(), f.player, 'play'); assert.ok(Math.abs(f.player.yaw + Math.PI / 3) < 1e-9);
});

test('end and re-entry reset held controls and headset origin', async () => {
  const f = await fixture(); await f.xr.enter(); f.xr.updateView(f.frame, f.player, 2, 9, 'play');
  f.xr.holds.set({}, { action: 'fireR' }); f.xr.syncHeld();
  await f.session.end();
  assert.equal(f.xr.active, false); assert.equal(f.input.xrActive, false); assert.equal(f.input.spatial.held.size, 0);
  assert.equal(f.xr.rig.visible, false); assert.equal(f.pauses, 1);
  f.xr.cleanup(); assert.equal(f.pauses, 1);
  await f.xr.enter(); assert.equal(f.xr.active, true); assert.equal(f.xr.origin, null);
  assert.equal(f.input.spatial.held.size, 0);
});
