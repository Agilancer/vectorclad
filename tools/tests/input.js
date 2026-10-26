// Input regression checks without a browser or third-party dependencies:
//   node --test tools/tests/input.js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const moduleReady = import('../../js/input.js');
let pads, root, controls;
const classList = { add() {}, remove() {}, toggle() {} };
global.window = new EventTarget();
global.document = Object.assign(new EventTarget(), {
  hidden: false, body: { classList }, activeElement: null,
  getElementById: (id) => root?.id === id ? root : null,
});
Object.defineProperty(global.navigator, 'getGamepads', { configurable: true, value: () => pads });

function pad(index = 0, mapping = 'standard') {
  return { index, mapping, connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}
function button(index, down = true) { pads[0].buttons[index] = { pressed: down, value: down ? 1 : 0 }; }
function input(Input) { return new Input(Object.assign(new EventTarget(), { requestPointerLock() {} })); }
function control() {
  return { clicks: 0, closest: () => null, getClientRects: () => [{}], matches: () => false,
    focus() { document.activeElement = this; }, scrollIntoView() {}, click() { this.clicks++; } };
}

beforeEach(async () => {
  global.window = new EventTarget();
  global.document = Object.assign(new EventTarget(), {
    hidden: false, body: { classList }, activeElement: null,
    getElementById: (id) => root?.id === id ? root : null,
  });
  pads = [pad()]; root = null; controls = []; document.activeElement = null; document.hidden = false;
  const { gamepad } = await moduleReady;
  gamepad.reset(); gamepad.index = null; gamepad.active = false; gamepad.suspended = false; gamepad.waitNeutral = false; gamepad.onDisconnect = null;
  gamepad.immersive = gamepad.xrSuspended = false;
  gamepad.xrOverlay = 'controls'; gamepad.onXRMenu = gamepad.onXRBack = null;
});

test('radial dead zone removes drift and preserves proportional, bounded diagonals', async () => {
  const { deadzone } = await moduleReady;
  assert.deepEqual(deadzone(0.1, -0.1), { x: 0, y: 0 });
  assert.ok(Math.abs(deadzone(0.59, 0).x - 0.5) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...Object.values(deadzone(1, 1))) - 1) < 1e-9);
});

test('movement merges with existing keyboard and touch controls and stays normalized', async () => {
  const { Input } = await moduleReady, i = input(Input);
  pads[0].axes = [1, -1, 0, 0]; i.keys.add('KeyW'); i.touch.move.x = 0.5;
  const c = i.sample();
  assert.ok(c.move.x > 0 && c.move.y > 0);
  assert.ok(Math.abs(Math.hypot(c.move.x, c.move.y) - 1) < 1e-9);
});

test('right-stick turning is proportional to elapsed time', async () => {
  const { Input } = await moduleReady, i = input(Input);
  pads[0].axes = [0, 0, 1, -1];
  const at60 = i.sample(1 / 60), at120 = i.sample(1 / 120);
  assert.equal(at60.lookX, at120.lookX * 2);
  assert.equal(at60.lookY, at120.lookY * 2);
});

test('triggers, cannons, jump and dash hold; one-shot actions do not repeat', async () => {
  const { Input } = await moduleReady, i = input(Input);
  for (const n of [0, 1, 2, 3, 5, 6, 7, 8, 9, 11]) button(n);
  const a = i.sample(), b = i.sample();
  for (const key of ['fireR', 'fireL', 'fireS', 'jump', 'dash']) assert.equal(a[key] && b[key], true, key);
  for (const key of ['jumpPressed', 'dashPressed', 'reload', 'salvo', 'summon', 'menu', 'lockon']) {
    assert.equal(a[key], true, key); assert.equal(b[key], false, key + ' must be an edge');
  }
});

test('LB launches one missile on release; LB+D-pad selects vehicle weapons without a missile', async () => {
  const { Input } = await moduleReady, i = input(Input);
  button(4); assert.equal(i.sample().missile, false);
  button(4, false); assert.equal(i.sample().missile, true); assert.equal(i.sample().missile, false);
  button(4); i.sample(); button(15);
  const chord = i.sample(); assert.equal(chord.slot2, true); assert.equal(chord.wheel, 0);
  button(4, false); button(15, false); assert.equal(i.sample().missile, false);
});

test('sparse gamepad arrays and xr-standard sources do not steal Xbox controls', async () => {
  const { Input } = await moduleReady, i = input(Input);
  pads = [null, pad(1, 'xr-standard'), pad(2)]; pads[1].buttons[7].pressed = true;
  assert.equal(i.sample().fireR, false);
  pads[2].buttons[7].value = 0.8; assert.equal(i.sample().fireR, true);
});

test('disconnect clears held fire and movement and pauses once', async () => {
  const { Input, gamepad } = await moduleReady, i = input(Input);
  let pauses = 0; gamepad.onDisconnect = () => pauses++;
  button(7); pads[0].axes[0] = 1; assert.equal(i.sample().fireR, true);
  pads = []; const c = i.sample(); i.sample();
  assert.equal(c.fireR, false); assert.equal(c.move.x, 0); assert.equal(pauses, 1);
});

test('menus navigate and activate once, and held confirm cannot become a gameplay jump', async () => {
  const { Input } = await moduleReady, i = input(Input);
  controls = [control(), control()];
  root = { id: 'intro', closest: () => null, getClientRects: () => [{}], querySelectorAll: () => controls };
  button(0); i.sample(); i.sample(); assert.equal(controls[0].clicks, 1);
  root = null; assert.equal(i.sample().jump, false);
  button(0, false); i.sample(); button(0); assert.equal(i.sample().jumpPressed, true);
});

test('spatial input holds until release while actions are consumed once', async () => {
  const { Input } = await moduleReady, i = input(Input);
  i.spatial.move.y = 1; i.spatial.held.add('fireR'); i.spatial.held.add('jump'); i.spatial.edges.add('jump');
  const a = i.sample(), b = i.sample();
  assert.equal(a.move.y, 1); assert.equal(a.fireR && b.fireR, true);
  assert.equal(a.jumpPressed, true); assert.equal(b.jumpPressed, false);
  i.spatial.held.clear(); assert.equal(i.sample().fireR, false);
});

test('Xbox Menu toggles the XR panel once without selecting a focused menu item', async () => {
  const { Input, gamepad } = await moduleReady, i = input(Input);
  controls = [control()];
  root = { id: 'intro', closest: () => null, getClientRects: () => [{}], querySelectorAll: () => controls };
  gamepad.immersive = true;
  let toggles = 0;
  gamepad.onXRMenu = () => { toggles++; gamepad.xrOverlay = 'collapsed'; };
  button(9); assert.equal(i.sample().menu, false); i.sample();
  assert.equal(toggles, 1); assert.equal(controls[0].clicks, 0);
  button(9, false); i.sample(); button(0); i.sample();
  assert.equal(controls[0].clicks, 0, 'collapsed menus must not accept blind selections');
});

test('Xbox B closes the XR controller map without dashing or leaking held buttons', async () => {
  const { Input, gamepad } = await moduleReady, i = input(Input);
  gamepad.immersive = true; gamepad.xrOverlay = 'map';
  let backs = 0;
  gamepad.onXRBack = () => { backs++; gamepad.xrOverlay = 'controls'; };
  button(1); assert.equal(i.sample().dash, false); assert.equal(i.sample().dash, false);
  assert.equal(backs, 1);
  button(1, false); i.sample(); button(1); assert.equal(i.sample().dashPressed, true);
});

test('collapsed XR dock preserves gameplay input while the controller map blocks it', async () => {
  const { Input, gamepad } = await moduleReady, i = input(Input);
  gamepad.immersive = true; gamepad.xrOverlay = 'collapsed';
  button(7); pads[0].axes[1] = -1;
  const c = i.sample(); assert.equal(c.fireR, true); assert.equal(c.move.y, 1);
  gamepad.xrOverlay = 'map'; const help = i.sample();
  assert.equal(help.fireR, false); assert.equal(help.move.y, 0);
});

test('focus loss requires neutral controls before held buttons can fire again', async () => {
  const { Input, startGamepadNavigation } = await moduleReady, i = input(Input);
  global.requestAnimationFrame = () => 1;
  startGamepadNavigation(); button(7); assert.equal(i.sample().fireR, true);
  window.dispatchEvent(new Event('blur')); assert.equal(i.sample().fireR, false);
  window.dispatchEvent(new Event('focus')); assert.equal(i.sample().fireR, false);
  button(7, false); i.sample(); button(7); assert.equal(i.sample().fireR, true);
});

test('D-pad repeats after a delay, sliders update values, and rebuilt menus retain focus', async () => {
  const { GamepadInput } = await moduleReady, g = new GamepadInput();
  controls = [control(), control()];
  root = { id: 'intro', closest: () => null, getClientRects: () => [{}], querySelectorAll: () => controls };
  button(13); g.poll(10); assert.equal(document.activeElement, controls[1]);
  g.poll(100); assert.equal(document.activeElement, controls[1]);
  g.poll(400); assert.equal(document.activeElement, controls[0]);
  button(13, false); g.poll(410);
  let events = 0;
  Object.assign(controls[0], { min: '0', max: '2', step: '0.25', value: '1', matches: () => true, dispatchEvent: () => events++ });
  button(15); g.poll(420); assert.equal(controls[0].value, '1.25'); assert.equal(events, 2);
  controls[0] = control(); button(15, false); g.poll(430);
  assert.equal(document.activeElement, controls[0]);
});

test('keyboard and mouse behavior still use their original capture and edge rules', async () => {
  const { Input } = await moduleReady, i = input(Input);
  i.keys.add('KeyW'); i.keys.add('Space'); i.edges.add('Space'); i.mouse.L = true;
  const before = i.sample(); assert.equal(before.move.y, 1); assert.equal(before.fireR, false); assert.equal(before.jumpPressed, true);
  i.locked = true; const after = i.sample(); assert.equal(after.fireR, true); assert.equal(after.jumpPressed, false); assert.equal(after.jump, true);
});
