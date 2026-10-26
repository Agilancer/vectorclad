// Keyboard, mouse (pointer lock), touch, gamepad and spatial input, merged into one control
// snapshot per frame.

export function menuControls() {
  const visible = (el) => el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const root = ['boot', 'title', 'summon', 'brief', 'hangar', 'frames', 'intro', 'gameover']
    .map((id) => document.getElementById(id)).find(visible);
  return { root, controls: root ? [...root.querySelectorAll('button:not(:disabled), input[type="range"]:not(:disabled)')].filter(visible) : [] };
}

export function adjustRange(el, direction) {
  const step = Number(el.step) || 1;
  el.value = String(Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + direction * step)));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Rescale the whole stick outside a radial dead zone; diagonals never exceed one. */
export function deadzone(x = 0, y = 0, threshold = 0.18) {
  const length = Math.hypot(x, y);
  if (length <= threshold) return { x: 0, y: 0 };
  const scale = Math.min(1, (length - threshold) / (1 - threshold)) / length;
  return { x: x * scale, y: y * scale };
}

export class GamepadInput {
  constructor() {
    this.active = false;
    this.index = null;
    this.buttons = [];
    this.edges = new Set();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.root = null;
    this.focusIndex = 0;
    this.direction = 0;
    this.repeatAt = 0;
    this.chord = false;
    this.suspended = false;
    this.blocked = [];
    this.waitNeutral = false;
    this.immersive = false;
    this.xrSuspended = false;
    this.xrOverlay = 'controls';
    this.onXRMenu = null;
    this.onXRBack = null;
  }

  reset() {
    this.buttons = [];
    this.edges.clear();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.direction = 0;
    this.chord = false;
    this.blocked = [];
    this._blockedMissile = false;
  }

  poll(now = performance.now()) {
    const unavailable = this.immersive ? this.xrSuspended : document.hidden || this.suspended;
    if (unavailable) { this.reset(); this.waitNeutral = true; return; }
    let pads;
    try { pads = [...(navigator.getGamepads?.() || [])].filter((p) => p?.connected && p.mapping === 'standard'); }
    catch (_) { this.reset(); return; }
    const used = (p) => p.buttons.some((b) => b.pressed || b.value > 0.5) || p.axes.some((a) => Math.abs(a) > 0.25);
    const pad = pads.find(used) || pads.find((p) => p.index === this.index) || pads[0];
    if (!pad) {
      const disconnected = this.index !== null && this.active;
      this.reset(); this.index = null; this.active = false;
      document.body.classList.remove('gamepad');
      if (disconnected) this.onDisconnect?.();
      return;
    }
    if (pad.index !== this.index) { this.reset(); this.index = pad.index; }
    const buttons = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    if (this.waitNeutral) {
      this.buttons = buttons;
      this.blocked = buttons.slice();
      if (used(pad)) return;
      this.waitNeutral = false;
    }
    this.blocked = this.blocked.map((blocked, i) => blocked && !!buttons[i]);
    const pressed = (i) => !!buttons[i] && !this.buttons[i];
    const released = (i) => !buttons[i] && this.buttons[i];
    this.move = deadzone(pad.axes[0], pad.axes[1]);
    this.move.y *= -1;
    this.look = deadzone(pad.axes[2], pad.axes[3]);
    if (used(pad)) this.active = true;
    document.body.classList.toggle('gamepad', this.active);
    // Headset overlays own Menu, and B closes the controller map without dashing.
    if (this.immersive && (pressed(9) || (this.xrOverlay === 'map' && pressed(1)))) {
      if (pressed(9)) this.onXRMenu?.(); else this.onXRBack?.();
      this.edges.clear(); this.blocked = buttons.slice(); this.buttons = buttons;
      return;
    }
    const { root, controls } = menuControls();
    if (root) {
      this.edges.clear();
      this.blocked = buttons.slice();
      if (!this.immersive || this.xrOverlay === 'controls') this.navigate(root, controls, buttons, pressed, now);
    } else if (this.immersive && this.xrOverlay === 'map') {
      this.edges.clear(); this.blocked = buttons.slice();
    } else {
      for (let i = 0; i < buttons.length; i++) if (pressed(i) && !this.blocked[i]) this.edges.add(i);
      // LB is a missile on release, or a modifier for the four vehicle weapon slots.
      if (pressed(4)) this.chord = false;
      if (buttons[4] && [12, 13, 14, 15].some((i) => buttons[i])) this.chord = true;
      if (released(4) && !this.chord && !this._blockedMissile) this.edges.add('missile');
      this._blockedMissile = !!this.blocked[4];
    }
    this.buttons = buttons;
  }

  navigate(root, controls, buttons, pressed, now) {
    if (!controls.length || !this.active) return;
    const changed = this.root !== root;
    if (changed) { this.root = root; this.focusIndex = 0; this.direction = 0; }
    let index = controls.indexOf(document.activeElement);
    if (index < 0) {
      index = Math.min(this.focusIndex, controls.length - 1);
      controls[index].focus({ preventScroll: true });
    }
    if (changed) controls[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const horizontal = buttons[15] || this.move.x > 0.55 ? 1 : buttons[14] || this.move.x < -0.55 ? -1 : 0;
    const vertical = buttons[13] || this.move.y < -0.55 ? 1 : buttons[12] || this.move.y > 0.55 ? -1 : 0;
    const direction = vertical ? vertical * 2 : horizontal;
    if (direction && (direction !== this.direction || now >= this.repeatAt)) {
      const current = controls[index];
      if (horizontal && !vertical && current.matches('input[type="range"]')) adjustRange(current, horizontal);
      else {
        index = (index + (vertical || horizontal) + controls.length) % controls.length;
        controls[index].focus({ preventScroll: true });
        controls[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.repeatAt = now + (direction !== this.direction ? 380 : 140);
    }
    this.direction = direction;
    this.focusIndex = index;
    // A held confirm never repeats when a click rebuilds the panel.
    if (pressed(0) || pressed(9)) controls[index].click();
    if (pressed(1) || pressed(8)) {
      const back = { summon: 'btn-summon-close', hangar: document.getElementById('btn-hangar-back')?.hidden ? 'btn-close-hangar' : 'btn-hangar-back', frames: 'btn-frame-back', brief: 'btn-brief-ok' }[root.id];
      if (back) document.getElementById(back)?.click();
    }
  }
}

export const gamepad = new GamepadInput();
let navigating = false;
export function startGamepadNavigation() {
  if (navigating) return;
  navigating = true;
  const poll = (now) => { gamepad.poll(now); requestAnimationFrame(poll); };
  requestAnimationFrame(poll);
  window.addEventListener('blur', () => { gamepad.suspended = true; gamepad.reset(); gamepad.waitNeutral = true; });
  window.addEventListener('focus', () => { gamepad.suspended = false; });
  const otherInput = () => { gamepad.active = false; document.body.classList.remove('gamepad'); };
  window.addEventListener('pointerdown', otherInput);
  window.addEventListener('keydown', otherInput);
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.mouse = { L: false, R: false, M: false };
    this.look = { x: 0, y: 0 };
    this.wheel = 0;
    this.locked = false;
    this.lockFailed = false;
    this.enabled = true;
    this.touchMode = false;
    this.touch = { move: { x: 0, y: 0 }, fireR: false, fireL: false, fireS: false, jump: false, dash: false };
    this.touchResets = [];
    this.onMenu = null;
    this.spatial = { move: { x: 0, y: 0 }, held: new Set(), edges: new Set() };
    this.xrActive = false;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.edges.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.L = this.mouse.R = this.mouse.M = false; this.releaseTouch(); });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.L = true;
      if (e.button === 1) { this.mouse.M = true; e.preventDefault(); }
      if (e.button === 2) this.mouse.R = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.L = false;
      if (e.button === 1) this.mouse.M = false;
      if (e.button === 2) this.mouse.R = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.touchMode) return;
      // Without pointer lock, look by dragging with any button held.
      if (this.locked || (this.lockFailed && (this.mouse.L || this.mouse.R || this.mouse.M))) {
        this.look.x += e.movementX || 0;
        this.look.y += e.movementY || 0;
      }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockFailed = false;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
  }

  requestLock() {
    if (this.touchMode || gamepad.active || this.xrActive || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; });
    } catch (_) {
      this.lockFailed = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- touch -----------------------------------------------------------------

  /** Let go of the stick and every held button, as if each finger had lifted. */
  releaseTouch() {
    for (const release of this.touchResets) release();
  }

  setupTouch(root) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#stick-knob');
    const lookZone = root.querySelector('#look-zone');
    const moveZone = root.querySelector('#move-zone');
    const R = 56;
    let stickId = null, ox = 0, oy = 0;
    moveZone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      stickId = e.pointerId;
      moveZone.setPointerCapture(e.pointerId);
      ox = e.clientX; oy = e.clientY;
      stick.style.left = `${ox}px`;
      stick.style.top = `${oy}px`;
      stick.classList.add('on');
      knob.style.transform = 'translate(-50%, -50%)';
    });
    moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.touch.move.x = dx / R;
      this.touch.move.y = -dy / R;
    });
    const releaseStick = () => {
      stickId = null;
      this.touch.move.x = this.touch.move.y = 0;
      stick.classList.remove('on');
    };
    const endStick = (e) => { if (e.pointerId === stickId) releaseStick(); };
    this.touchResets.push(releaseStick);
    moveZone.addEventListener('pointerup', endStick);
    moveZone.addEventListener('pointercancel', endStick);

    // Look: drag anywhere on the right side, and also while holding fire buttons
    const lookDrag = (el, onDown, onUp) => {
      let id = null, lx = 0, ly = 0;
      el.addEventListener('pointerdown', (e) => {
        if (id !== null) return;
        id = e.pointerId;
        el.setPointerCapture(e.pointerId);
        lx = e.clientX; ly = e.clientY;
        el.classList.add('held');
        onDown && onDown();
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        this.look.x += (e.clientX - lx) * 1.6;
        this.look.y += (e.clientY - ly) * 1.6;
        lx = e.clientX; ly = e.clientY;
      });
      const release = () => {
        if (id === null) return;
        id = null;
        el.classList.remove('held');
        onUp && onUp();
      };
      const up = (e) => { if (e.pointerId === id) release(); };
      this.touchResets.push(release);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    lookDrag(lookZone);
    const hold = (sel, key) => {
      const el = root.querySelector(sel);
      if (!el) return;
      lookDrag(el, () => { this.touch[key] = true; }, () => { this.touch[key] = false; });
    };
    hold('#t-fire', 'fireR');
    hold('#t-fireL', 'fireL');
    hold('#t-cannon', 'fireS');
    hold('#t-jump', 'jump');
    hold('#t-dash', 'dash');
    const tap = (sel, code) => {
      const el = root.querySelector(sel);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.edges.add(code);
        el.classList.add('held');
        setTimeout(() => el.classList.remove('held'), 140);
      });
    };
    tap('#t-msl', 'KeyQ');
    tap('#t-salvo', 'KeyE');
    tap('#t-reload', 'KeyR');
    tap('#t-lock', 'KeyT');
  }

  // ---- per-frame snapshot ----------------------------------------------------

  sample(dt = 1 / 60) {
    gamepad.poll();
    const g = gamepad, b = g.buttons, ge = g.edges, s = this.spatial;
    const menuOpen = !!menuControls().root;
    const padLive = !menuOpen && !(g.immersive ? g.xrSuspended || g.xrOverlay === 'map' : g.suspended);
    const held = (i) => padLive && !!b[i] && !g.blocked[i];
    const edge = (i) => padLive && ge.has(i);
    const sh = (key) => !menuOpen && s.held.has(key), se = (key) => !menuOpen && s.edges.has(key);
    const k = this.keys, e = this.edges, t = this.touch;
    let mx = 0, my = 0;
    if (k.has('KeyW')) my += 1;
    if (k.has('KeyS')) my -= 1;
    if (k.has('KeyD')) mx += 1;
    if (k.has('KeyA')) mx -= 1;
    mx += t.move.x; my += t.move.y;
    mx += (padLive ? g.move.x : 0) + (menuOpen ? 0 : s.move.x);
    my += (padLive ? g.move.y : 0) + (menuOpen ? 0 : s.move.y);
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    let lx = this.look.x, ly = this.look.y;
    if (padLive) { lx += g.look.x * 600 * dt; ly += g.look.y * 420 * dt; }
    if (k.has('ArrowLeft')) lx -= 9;
    if (k.has('ArrowRight')) lx += 9;
    if (k.has('ArrowUp')) ly -= 6;
    if (k.has('ArrowDown')) ly += 6;
    this.look.x = this.look.y = 0;
    // Mouse buttons only count while the pointer is captured (or in drag-look mode)
    const mouseLive = this.locked || this.lockFailed;
    const c = {
      move: { x: mx, y: my },
      lookX: lx, lookY: ly,
      fireR: (mouseLive && this.mouse.L) || t.fireR || k.has('KeyJ') || held(7) || sh('fireR'),
      fireL: (mouseLive && this.mouse.R) || t.fireL || k.has('KeyK') || held(6) || sh('fireL'),
      fireS: k.has('KeyF') || (mouseLive && this.mouse.M) || t.fireS || held(5) || sh('fireS'),
      jump: k.has('Space') || t.jump || held(0) || sh('jump'),
      jumpPressed: e.has('Space') || edge(0) || se('jump'),
      dash: k.has('ShiftLeft') || k.has('ShiftRight') || t.dash || held(1) || sh('dash'),
      dashPressed: edge(1) || se('dash'),
      missile: e.has('KeyQ') || edge('missile') || se('missile'),
      salvo: e.has('KeyE') || edge(3) || se('salvo'),
      reload: e.has('KeyR') || edge(2) || se('reload'),
      lockon: e.has('KeyT') || edge(11) || se('lockon'),
      menu: e.has('Tab') || e.has('KeyM') || edge(9) || se('menu'),
      summon: edge(8) || se('summon'),
      camera: e.has('KeyV') || (!held(4) && edge(12)) || se('camera'),
      // Hold G: climb out of the standing mech, or back into it (js/pilot.js)
      exit: k.has('KeyG') || held(10) || sh('exit'),
      // Rides (js/rides.js): sink, and the Hornet's four weapon points
      down: k.has('KeyC') || k.has('ControlLeft') || (!held(4) && held(13)) || sh('down'),
      slot1: e.has('Digit1') || (held(4) && edge(12)) || se('slot1'), slot2: e.has('Digit2') || (held(4) && edge(15)) || se('slot2'),
      slot3: e.has('Digit3') || (held(4) && edge(13)) || se('slot3'), slot4: e.has('Digit4') || (held(4) && edge(14)) || se('slot4'),
      wheel: this.wheel + (!held(4) ? Number(edge(15)) - Number(edge(14)) : 0),
    };
    this.wheel = 0;
    // Touch jump presses register as an edge on the first held frame
    if (t.jump && !this._tj) c.jumpPressed = true;
    this._tj = t.jump;
    if (t.dash && !this._td) c.dashPressed = true;
    if ((k.has('ShiftLeft') || k.has('ShiftRight')) && (e.has('ShiftLeft') || e.has('ShiftRight'))) c.dashPressed = true;
    this._td = t.dash;
    e.clear();
    ge.clear();
    s.edges.clear();
    return c;
  }
}
