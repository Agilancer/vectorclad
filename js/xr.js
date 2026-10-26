// WebXR adapter. The normal game camera remains in world space for aiming, audio and AI;
// a separate camera on a meter-scaled rig supplies the two headset views.
import * as THREE from './three.js';
import { gamepad, menuControls, adjustRange } from './input.js';

export class Immersive {
  constructor({ renderer, scene, camera, input, onPause, onRelease, onGesture, onChange = () => {}, onQuality = () => {}, status }) {
    Object.assign(this, { renderer, scene, camera, input, onPause, onRelease, onGesture, onChange, onQuality, status });
    this.active = false;
    this.pending = false;
    this.session = null;
    this.holds = new Map();
    this.buttons = [];
    this.page = 0;
    this.menu = null;
    this.nextDraw = 0;
    this.turnHeld = false;
    this.suspended = false;
    this.origin = null;
    this.tracked = false;
    this.panelOpen = true;
    this.helpOpen = false;
    this.mode = null;
    this.firstPerson = false;
    this.quality = 0;
    this.performance = { last: 0, start: 0, frames: 0, slow: 0, fast: 0 };
    this.panelRevision = 0;
    this.panelKey = null;
    this.hud = null;
    this.hudTop = 446;
    this.rig = new THREE.Group();
    this.rig.visible = false;
    this.viewCamera = new THREE.PerspectiveCamera(60, 1, 0.05, camera.far);
    this.rig.add(this.viewCamera);
    scene.add(this.rig);
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1200; this.canvas.height = 760;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.2), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.panel.position.set(0, -0.38, -2);
    this.panel.renderOrder = 10000;
    this.viewCamera.add(this.panel);
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.009, 24), new THREE.MeshBasicMaterial({ color: 0x7dffb6, depthTest: false, depthWrite: false, toneMapped: false }));
    this.reticle.position.z = -2;
    this.reticle.renderOrder = 10001;
    this.viewCamera.add(this.reticle);
    this.raycaster = new THREE.Raycaster();
    this.ray = { origin: new THREE.Vector3(), direction: new THREE.Vector3() };
    this.aimRay = null;
    this.v = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    renderer.xr.enabled = true;
    renderer.xr.cameraAutoUpdate = false;
    renderer.xr.setReferenceSpaceType('local');
    renderer.xr.setFramebufferScaleFactor(0.85);
    for (const button of document.querySelectorAll('[data-enter-xr]')) button.addEventListener('click', () => this.session ? this.exit() : this.enter());
    for (const button of document.querySelectorAll('[data-xr-map]')) button.addEventListener('click', () => this.showControllerMap());
    gamepad.onXRMenu = () => this.setPanelOpen(!this.panelOpen);
    gamepad.onXRBack = () => this.setPanelOpen(true);
    this.checkSupport();
  }

  updateButtons() {
    for (const button of document.querySelectorAll('[data-enter-xr]')) {
      button.hidden = !this.supported && !this.active;
      button.textContent = this.active ? 'Exit VR' : 'Enter VR · Vision Pro';
    }
    for (const button of document.querySelectorAll('[data-xr-map]')) button.hidden = !this.active;
  }

  async checkSupport() {
    let supported = false;
    try { supported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); }
    catch (_) { /* A denied capability check leaves the windowed game available. */ }
    this.supported = supported;
    this.updateButtons();
    if (this.active) return;
    this.status.textContent = supported
      ? 'Vision Pro: Enter VR for head aiming and look-and-pinch controls. Xbox controllers also work in VR.'
      : 'Xbox: connect a controller and press A. Vision Pro: play in a Safari window; immersive mode appears when available.';
  }

  async enter() {
    if (this.pending || this.session) return;
    this.pending = true;
    this.onGesture();
    let session;
    try {
      // Keep this request in the click/pinch gesture; no asynchronous work may precede it.
      session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      this.session = session;
      this.origin = null;
      this.tracked = false;
      this.heading = null;
      this.turnHeld = false;
      this.suspended = false;
      this.active = true;
      this.quality = 0;
      this.performance.last = this.performance.start = 0;
      this.mode = null;
      this.setPanelOpen(true);
      this.updateButtons();
      this.input.xrActive = true;
      gamepad.suspended = false;
      gamepad.immersive = true;
      gamepad.xrSuspended = false;
      this.input.releaseTouch();
      this.input.exitLock();
      this.rig.visible = true;
      session.addEventListener('end', () => this.cleanup(), { once: true });
      session.addEventListener('selectstart', (event) => this.select(event));
      session.addEventListener('selectend', (event) => this.release(event.inputSource));
      session.addEventListener('inputsourceschange', (event) => { for (const source of event.removed) this.release(source); });
      session.addEventListener('visibilitychange', () => {
        this.suspended = session.visibilityState !== 'visible';
        gamepad.xrSuspended = this.suspended;
        if (this.suspended) { this.releaseAll(); gamepad.reset(); this.onPause(); }
      });
      await this.renderer.xr.setSession(session);
      if (this.session !== session) return;
      this.onChange(true);
      document.body.classList.add('immersive');
      this.status.textContent = 'VR active · Look to aim · Pinch Menu or press Xbox Menu to show / hide the panel · Xbox map shows every control.';
    } catch (error) {
      if (session) await session.end().catch(() => {});
      this.cleanup();
      this.status.textContent = `Could not enter VR: ${error.message || error.name}. You can keep playing in the browser window and try again.`;
    } finally {
      this.pending = false;
    }
  }

  async exit() {
    try { await this.session?.end(); }
    catch (error) { this.status.textContent = `Could not exit VR: ${error.message || error}`; }
  }

  setPanelOpen(open) {
    this.panelOpen = open;
    this.helpOpen = false;
    gamepad.xrOverlay = open ? 'controls' : 'collapsed';
    this.buttons = [];
    this.releaseAll();
    this.nextDraw = 0;
    this.panelKey = null;
  }

  showControllerMap() {
    if (!this.active) return;
    if (this.mode === 'play' || this.mode === 'drop') this.onPause();
    this.setPanelOpen(true);
    this.helpOpen = true;
    gamepad.xrOverlay = 'map';
  }

  cleanup() {
    const wasActive = this.active;
    this.active = false;
    this.tracked = false;
    this.session = null;
    this.input.xrActive = false;
    gamepad.immersive = false;
    gamepad.xrSuspended = false;
    gamepad.xrOverlay = 'controls';
    this.rig.visible = false;
    this.releaseAll();
    gamepad.reset();
    document.body.classList.remove('immersive');
    this.updateButtons();
    if (wasActive) {
      this.onChange(false);
      this.camera.near = 0.6;
      this.camera.updateProjectionMatrix();
      this.onPause();
      this.status.textContent = 'Returned from VR. Resume in the window or choose Enter VR again.';
    }
  }

  release(source) { this.holds.delete(source); this.syncHeld(); }
  releaseAll() { this.holds.clear(); this.syncHeld(); this.input.spatial.edges.clear(); }

  syncHeld() {
    const s = this.input.spatial;
    s.held.clear(); s.move.x = s.move.y = 0;
    for (const { action } of this.holds.values()) {
      if (action === 'forward') s.move.y += 1;
      else if (action === 'back') s.move.y -= 1;
      else if (action === 'left') s.move.x -= 1;
      else if (action === 'right') s.move.x += 1;
      else s.held.add(action);
    }
    this.aimRay = null;
  }

  /** Source order and gripSpace are deliberately irrelevant, including transient pointers. */
  sourceRay(frame, source) {
    const reference = this.renderer.xr.getReferenceSpace();
    const pose = reference && frame?.getPose(source.targetRaySpace, reference);
    if (!pose) return null;
    const { position, orientation } = pose.transform;
    this.ray.origin.set(position.x, position.y, position.z).applyMatrix4(this.rig.matrixWorld);
    this.q.set(orientation.x, orientation.y, orientation.z, orientation.w);
    this.ray.direction.set(0, 0, -1).applyQuaternion(this.q).transformDirection(this.rig.matrixWorld);
    return this.ray;
  }

  select(event) {
    if (!this.active || this.suspended || !this.tracked) return;
    const ray = this.sourceRay(event.frame, event.inputSource);
    if (!ray) return;
    this.raycaster.set(ray.origin, ray.direction);
    const hit = this.raycaster.intersectObject(this.panel)[0];
    if (hit) {
      const x = hit.uv.x * this.canvas.width, y = (1 - hit.uv.y) * this.canvas.height;
      const button = this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (button) { this.activate(button, event.inputSource, x); return; }
      if (this.panelOpen || y >= this.hudTop) return;
    }
    // Looking at the world and pinching fires; a pinch on the panel never fires through it.
    if (menuControls().root) return;
    const action = event.inputSource.handedness === 'left' ? 'fireL' : 'fireR';
    this.holds.set(event.inputSource, { action, world: true });
    this.syncHeld();
  }

  activate(button, source, x) {
    if (button.disabled) return;
    this.onGesture();
    this.nextDraw = 0;
    if (button.el) {
      button.el.focus({ preventScroll: true });
      if (button.el.matches('input[type="range"]')) adjustRange(button.el, x < button.x + button.w / 2 ? -1 : 1);
      else button.el.click();
    } else if (button.action === 'panel') this.setPanelOpen(!this.panelOpen);
    else if (button.action === 'map') this.showControllerMap();
    else if (button.action === 'back') this.setPanelOpen(true);
    else if (button.action === 'previous') this.page = Math.max(0, this.page - 1);
    else if (button.action === 'next') this.page++;
    else if (button.action === 'quit') this.exit();
    else if (button.action === 'recenter') this.origin = null;
    else if (button.action === 'turnLeft') this.heading += Math.PI / 6;
    else if (button.action === 'turnRight') this.heading -= Math.PI / 6;
    else if (button.action === 'release') this.onRelease();
    else {
      this.holds.set(source, { action: button.action, world: false });
      this.input.spatial.edges.add(button.action);
      this.syncHeld();
    }
  }

  filterInput(c, player, mode) {
    if (!this.active) return;
    if (this.heading === null) this.heading = player.yaw;
    const turn = Math.abs(gamepad.look.x) > 0.65 ? Math.sign(gamepad.look.x) : Math.abs(c.lookX) > 5 ? Math.sign(c.lookX) : 0;
    if (mode === 'play' && !this.helpOpen) {
      if (turn && !this.turnHeld) this.heading -= turn * Math.PI / 6;
      player.yaw = this.heading;
    }
    this.turnHeld = !!turn;
    c.lookX = c.lookY = 0;
    if (this.suspended || !this.tracked || this.helpOpen) {
      c.move = { x: 0, y: 0 };
      for (const key of Object.keys(c)) if (typeof c[key] === 'boolean') c[key] = false;
    }
  }

  updateView(frame, player, meters, distance, mode, height = 8.4) {
    if (mode !== this.mode) {
      this.mode = mode;
      if (!this.helpOpen) this.setPanelOpen(mode !== 'play' && mode !== 'drop');
    }
    const reference = this.renderer.xr.getReferenceSpace();
    const pose = reference && frame?.getViewerPose(reference);
    if (!pose) {
      const wasTracked = this.tracked;
      this.tracked = false;
      gamepad.xrSuspended = true;
      this.releaseAll();
      if (wasTracked) this.onPause();
      return false;
    }
    this.tracked = true;
    gamepad.xrSuspended = this.suspended;
    if (this.heading === null) this.heading = player.yaw;
    const scale = 1 / meters;
    this.rig.scale.setScalar(scale);
    this.rig.rotation.y = this.heading + Math.PI;
    if (!this.origin) {
      const p = pose.transform.position;
      this.origin = new THREE.Vector3(p.x, p.y, p.z);
    }
    this.rig.position.copy(player.pos);
    this.rig.position.y += height;
    this.rig.position.x -= Math.sin(this.heading) * distance;
    this.rig.position.z -= Math.cos(this.heading) * distance;
    this.rig.position.sub(this.v.copy(this.origin).multiplyScalar(scale).applyQuaternion(this.rig.quaternion));
    this.viewCamera.near = 0.08 * scale;
    this.viewCamera.far = this.camera.far;
    this.rig.updateMatrixWorld(true);
    this.renderer.xr.updateCamera(this.viewCamera);
    this.viewCamera.getWorldPosition(this.camera.position);
    this.viewCamera.getWorldQuaternion(this.camera.quaternion);
    this.camera.projectionMatrix.copy(this.renderer.xr.getCamera().projectionMatrix);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld(true);
    this.aimRay = null;
    for (const [source, held] of this.holds) {
      if (!held.world) continue;
      const ray = this.sourceRay(frame, source);
      if (ray) { this.aimRay = ray; break; }
    }
    const now = performance.now();
    if (now >= this.nextDraw) { this.refreshPanel(mode); this.nextDraw = now + 100; }
    return true;
  }

  refreshPanel(mode) {
    if (this.helpOpen) {
      if (this.panelKey === 'map') return false;
      this.draw(mode); this.panelKey = 'map';
      return true;
    }
    const menu = this.helpOpen ? { root: null, controls: [] } : menuControls();
    const text = id => document.getElementById(id)?.textContent || '';
    const focus = menu.controls.indexOf(document.activeElement);
    const key = JSON.stringify([mode, this.panelOpen, this.helpOpen, this.firstPerson, this.quality, this.page, menu.root?.id, focus,
      this.helpOpen ? null : this.hudSnapshot(),
      ...['ap-txt', 'boost-txt', 'score', 'weapons', 'mslct'].map(text),
      ...menu.controls.map(el => [this.label(el), el.value, el.className, el.getAttribute('aria-pressed')])]);
    if (key === this.panelKey) return false;
    this.draw(mode);
    this.panelKey = key;
    return true;
  }

  setHUD(state) { this.hud = state; }

  hudSnapshot() {
    const d = this.hud;
    if (!d) return null;
    const target = !d.pilot && d.hard?.alive ? d.hard : null;
    return {
      armor: Math.max(0, Math.ceil(d.ap)), armorMax: d.apMax,
      boost: Math.round(d.boost), overheat: d.overheat, shield: d.shield,
      speed: Math.round(d.speed), altitude: Math.round(d.alt),
      missiles: d.ordnance?.ready ?? d.missiles, missileCap: d.ordnance?.capacity ?? d.missileCap, locks: d.pilot ? 0 : d.locks.length,
      ordnanceName: d.ordnance?.name || 'MISSILES', ordnanceHint: d.ordnance?.hint || 'PINCH TO LAUNCH',
      actor: d.actor, pilot: d.pilot, grapple: d.grapple,
      hostiles: d.hostiles, notice: d.notice,
      target: target ? { name: target.name || 'LOCK', health: Math.max(0, Math.round(target.hp / target.maxHp * 100)),
        range: Math.round(target.pos.distanceTo(d.camera.position) * d.meters) } : null,
      weapons: (d.spatialWeapons || d.weapons).map(w => ({ slot: w.slot.id, name: w.name, empty: w.empty, kind: w.kind,
        ammo: w.ammo, max: w.max, reload: w.reload == null ? null : Math.round(w.reload * 20) / 20,
        charge: w.charge == null ? null : Math.round(w.charge * 20) / 20 })),
    };
  }

  samplePerformance(now, mode) {
    const p = this.performance;
    if (!this.active || mode !== 'play' || this.suspended || !this.tracked) {
      p.last = p.start = p.frames = p.slow = p.fast = 0;
      return;
    }
    if (!p.start) { p.start = p.last = now; p.frames = 0; return; }
    const interval = now - p.last; p.last = now;
    if (interval <= 0 || interval > 250) { p.start = now; p.frames = 0; return; }
    p.frames++;
    if (now - p.start < 2000) return;
    const average = (now - p.start) / p.frames;
    const budget = 1000 / Math.max(60, this.session?.frameRate || 72);
    p.slow = average > budget * 1.35 ? p.slow + 1 : 0;
    p.fast = average < budget * 1.05 ? p.fast + 1 : 0;
    const quality = p.slow >= 2 ? Math.min(2, this.quality + 1) : p.fast >= 3 ? Math.max(0, this.quality - 1) : this.quality;
    p.start = now; p.frames = 0;
    if (quality !== this.quality) {
      this.quality = quality;
      p.slow = p.fast = 0;
      this.onQuality(quality);
      this.nextDraw = 0;
    }
  }

  label(el) {
    if (el.matches('input')) return `${el.getAttribute('aria-label') || el.previousElementSibling?.textContent || 'Value'}: ${el.value}   − / +`;
    const label = el.getAttribute('data-xr-label') || el.getAttribute('aria-label') || el.title || el.textContent.trim().replace(/\s+(Tab|`)$/, '');
    const section = el.closest('.settings-row')?.querySelector('span')?.textContent || el.closest('.hsec')?.querySelector('h3')?.textContent;
    return section ? `${section}: ${label}` : label;
  }

  draw(mode) {
    this.panelRevision++;
    const ctx = this.ctx, { root, controls } = menuControls();
    if (this.menu !== root) { this.menu = root; this.page = 0; }
    ctx.clearRect(0, 0, 1200, 760);
    this.buttons = [];
    const button = (label, action, x, y, w, h, el = null, disabled = false) => {
      this.buttons.push({ action, x, y, w, h, el, disabled });
      ctx.fillStyle = el === document.activeElement ? '#4d4326' : '#242b31'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#768b89'; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = disabled ? '#68746f' : '#ece8df'; ctx.font = '26px sans-serif';
      ctx.save(); ctx.beginPath(); ctx.rect(x + 12, y, w - 24, h); ctx.clip();
      ctx.fillText(label, x + 14, y + h / 2 + 9); ctx.restore();
    };
    ctx.fillStyle = 'rgba(13,15,18,0.94)';
    if (this.panelOpen) ctx.fillRect(0, 0, 1200, 760);
    const text = (id) => document.getElementById(id)?.textContent || '0';
    const stats = `ARMOR ${text('ap-txt')}   BOOST ${text('boost-txt')}   KILLS ${text('score')}`;
    this.reticle.visible = !root && !this.helpOpen;
    if (!this.panelOpen) {
      this.drawCombatHUD(mode, button, !!root);
      this.texture.needsUpdate = true;
      return;
    }
    if (this.helpOpen) {
      this.drawControllerMap();
      button('Back to menu · B', 'back', 24, 646, 268, 64);
      button('Hide menu', 'panel', 308, 646, 300, 64);
      button('Recenter', 'recenter', 624, 646, 268, 64);
      button('Exit VR', 'quit', 908, 646, 268, 64);
    } else {
      ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = '#f2b632';
      ctx.fillText(`VECTORCLAD · ${mode.toUpperCase()}`, 28, 42);
      button('Xbox map', 'map', 838, 12, 170, 52);
      button('Hide menu', 'panel', 1024, 12, 152, 52);
      ctx.font = '22px monospace'; ctx.fillStyle = '#7dffb6';
      const summary = root?.getAttribute?.('data-xr-summary');
      ctx.fillText(summary || stats, 28, 82, 1144);
      if (!summary) {
        const ammo = [...(document.getElementById('weapons')?.querySelectorAll?.('.ammo') || [])].map(el => el.textContent);
        const hand = value => ['RMB', 'LT', 'HOLD L', 'L SHIELD'].includes(value) ? 'SHIELD' : value || '—';
        ctx.fillText(`R ${hand(ammo[0])}  L ${hand(ammo[1])}  MSL ${text('mslct')}`, 630, 82);
      }
      if (root) {
        const focus = controls.indexOf(document.activeElement);
        // Gamepad focus follows onto the visible page, including after a panel re-render.
        if (focus >= 0 && focus !== this.lastFocus) this.page = Math.floor(focus / 7);
        this.lastFocus = focus;
        this.page = Math.min(this.page, Math.max(0, Math.ceil(controls.length / 7) - 1));
        controls.slice(this.page * 7, this.page * 7 + 7).forEach((el, i) => button(this.label(el), null, 24, 106 + i * 76, 1152, 66, el));
        button('Previous', 'previous', 24, 646, 268, 64);
        button(`${this.page + 1} / ${Math.max(1, Math.ceil(controls.length / 7))} · Next`, 'next', 308, 646, 300, 64);
        button('Recenter', 'recenter', 624, 646, 268, 64);
        button('Exit VR', 'quit', 908, 646, 268, 64);
      } else {
        const actions = [
          ['Forward', 'forward'], ['Back', 'back'], ['Left', 'left'], ['Right', 'right'],
          ['R fire', 'fireR'], ['L fire / shield', 'fireL'], ['Cannons', 'fireS'], ['Lock on', 'lockon'],
          ['Jet / jump', 'jump'], ['Dash', 'dash'], ['Missile', 'missile'], ['Full salvo', 'salvo'],
          ['Reload', 'reload'], ['Turn left', 'turnLeft'], ['Turn right', 'turnRight'], ['Summon', 'summon'],
          [mode === 'drop' ? 'Release now' : 'Hangar / pause', mode === 'drop' ? 'release' : 'menu'], ['Recenter', 'recenter'], [this.firstPerson ? 'View: First' : 'View: Chase', 'camera'], ['Exit VR', 'quit'],
          ['Sink', 'down'], ['Board / exit', 'exit'], ['Weapon 1', 'slot1'], ['Weapon 2', 'slot2'], ['Weapon 3', 'slot3'], ['Weapon 4', 'slot4'],
        ];
        actions.forEach(([label, action], i) => button(label, action, 24 + i % 4 * 292, 112 + Math.floor(i / 4) * 84, 276, 72));
      }
    }
    ctx.fillStyle = '#b0bdb7'; ctx.font = '22px sans-serif';
    ctx.fillText(this.helpOpen ? 'Look to aim · Xbox Menu: show / hide panel · B: back to menu' : 'Look + pinch: select / hold · Xbox A: select · B: back · Menu: show / hide', 28, 744);
    this.texture.needsUpdate = true;
  }

  drawCombatHUD(mode, button, menuOpen) {
    const c = this.ctx, d = this.hudSnapshot();
    const live = mode === 'play' && !menuOpen;
    const green = '#7dffb6', amber = '#f2b632', red = '#ff736b';
    const text = (value, x, y, color = '#ece8df', size = 22, width = 1144) => {
      c.fillStyle = color; c.font = `${size}px sans-serif`; c.fillText(value, x, y, width);
    };
    const meter = (x, y, width, fraction, color) => {
      c.fillStyle = '#34413f'; c.fillRect(x, y, width, 8);
      c.fillStyle = color; c.fillRect(x, y, width * Math.max(0, Math.min(1, fraction || 0)), 8);
    };
    c.fillStyle = 'rgba(10,18,21,0.90)'; c.fillRect(16, this.hudTop, 1168, 314);
    const armor = d?.armor ?? Number(document.getElementById('ap-txt')?.textContent || 0);
    const armorMax = d?.armorMax || 1, boost = d?.boost ?? 0;
    const low = !!d && armor < armorMax * 0.25;
    text(`${this.firstPerson ? 'FIRST' : 'CHASE'} · ${d?.actor || 'FRAME'} · ${mode === 'hangar' ? 'PAUSED' : mode.toUpperCase()}`, 28, 474, green, 20, 370);
    const target = d?.target;
    const targetLine = target ? `${target.name} · ${target.range} m · ${target.health}% ARMOR`
      : `HOSTILES ${d?.hostiles ?? 0} · LOCKS ${d?.locks ?? 0} · ${d?.speed ?? 0} km/h · ALT ${d?.altitude ?? 0} m`;
    text(targetLine, 414, 474, target ? amber : '#b6cac2', 20, 758);
    text(`ARMOR ${armor} / ${d?.armorMax ?? '—'}`, 28, 511, low ? red : green, 26, 560);
    text(d?.overheat ? 'BOOST · OVERHEATED' : `BOOST ${boost}%`, 616, 511, d?.overheat ? red : amber, 26, 556);
    meter(28, 529, 556, armor / armorMax, low ? red : green);
    meter(616, 529, 556, boost / 100, d?.overheat ? red : amber);

    const weapon = (slot, x) => {
      const w = d?.weapons.find(w => w.slot === slot);
      const shield = w?.kind === 'shield';
      const held = shield || w?.kind === 'continuous' || w?.kind === 'grapple';
      button('', held ? (slot === 'leftHand' ? 'fireL' : 'fireR') : 'reload', x, 553, 370, 83, null, !live || !w || w.empty);
      text(`${slot === 'rightHand' ? 'R' : 'L'} · ${w?.name || 'EMPTY'}`, x + 12, 579, '#c1d1ca', 21, 346);
      const label = !w || w.empty ? 'NO WEAPON' : shield ? (d.shield ? 'SHIELD RAISED' : 'HOLD TO SHIELD')
        : w.kind === 'continuous' ? 'HOLD TO FIRE · ∞'
        : w.kind === 'grapple' ? (d.grapple ? 'PINCH TO RELEASE' : 'PINCH TO GRAPPLE')
        : w.reload != null ? `RELOADING ${Math.round(w.reload * 100)}%`
        : w.charge != null ? (w.charge >= 1 ? 'FIRING' : `CHARGING ${Math.round(w.charge * 100)}%`)
        : `${w.ammo} / ${w.max} · PINCH TO RELOAD`;
      const color = w?.ammo === 0 && !shield ? red : shield && d.shield ? green : '#ece8df';
      text(label, x + 12, 607, color, 22, 346);
      const fraction = held ? 1 : w?.reload ?? w?.charge ?? (w?.ammo / w?.max);
      meter(x + 12, 620, 346, fraction, w?.reload != null ? amber : green);
    };
    weapon('rightHand', 28); weapon('leftHand', 414);
    button('', 'missile', 800, 553, 372, 83, null, !live || !d?.missileCap);
    text(`${d?.ordnanceName || 'MISSILES'}${d?.pilot ? '' : ` · LOCKS ${d?.locks ?? 0}`}`, 812, 579, amber, 21, 348);
    text(`${d?.missiles ?? 0} / ${d?.missileCap ?? 0} · ${d?.ordnanceHint || 'PINCH TO LAUNCH'}`, 812, 607, d?.missiles ? '#ece8df' : red, 22, 348);
    meter(812, 620, 348, (d?.missiles || 0) / (d?.missileCap || 1), amber);
    button('Menu', 'panel', 28, 650, 214, 54);
    button(mode === 'drop' ? 'Release now' : 'Summon', mode === 'drop' ? 'release' : 'summon', 260, 650, 214, 54, null, !live && mode !== 'drop');
    button(`Lock on · ${d?.locks ?? 0}`, 'lockon', 492, 650, 214, 54, null, !live || !!d?.pilot);
    button(this.firstPerson ? 'View: First' : 'View: Chase', 'camera', 724, 650, 214, 54, null, !live && mode !== 'drop');
    button('Recenter', 'recenter', 956, 650, 216, 54);
    const notice = low ? 'LOW ARMOR · Take cover to regenerate' : d?.overheat ? 'BOOST OVERHEATED · Land and let it recharge'
      : d?.notice || 'Pinch a weapon to reload · Hold the shield · Pinch missiles to launch · Menu opens all controls';
    text(notice, 28, 738, low || d?.overheat ? red : '#b6cac2', 20, 1144);
  }

  drawControllerMap() {
    const c = this.ctx;
    c.fillStyle = '#f2b632'; c.font = 'bold 30px sans-serif';
    c.fillText('XBOX CONTROLLER · VR', 28, 42);
    c.fillStyle = '#7dffb6'; c.font = '24px sans-serif';
    c.fillText('Look to aim · Right stick turns in 30° steps · Menu toggles the panel', 28, 82);
    // Draw the controller here so the in-headset guide needs no extra asset or download.
    c.save(); c.translate(600, 225);
    c.fillStyle = '#303b43'; c.strokeStyle = '#83968e'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-150, -82); c.bezierCurveTo(-215, -80, -260, 110, -200, 118);
    c.bezierCurveTo(-160, 124, -130, 44, -98, 44); c.lineTo(98, 44);
    c.bezierCurveTo(130, 44, 160, 124, 200, 118); c.bezierCurveTo(260, 110, 215, -80, 150, -82);
    c.closePath(); c.fill(); c.stroke();
    const circle = (x, y, radius, label, color = '#c4d2cc') => {
      c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fillStyle = '#131b20'; c.fill();
      c.strokeStyle = color; c.stroke(); c.fillStyle = color; c.font = 'bold 22px sans-serif';
      c.textAlign = 'center'; c.fillText(label, x, y + 8);
    };
    circle(-128, -28, 32, 'LS'); circle(70, 44, 32, 'RS'); circle(-64, 43, 25, '+');
    circle(147, 13, 17, 'A', '#74d57c'); circle(181, -21, 17, 'B', '#f07169');
    circle(113, -21, 17, 'X', '#78b4ff'); circle(147, -55, 17, 'Y', '#f2cb60');
    circle(-33, -35, 16, '▧'); circle(33, -35, 16, '≡');
    c.textAlign = 'center'; c.fillStyle = '#ece8df'; c.font = 'bold 22px sans-serif';
    c.fillText('LT / LB', -142, -102); c.fillText('RT / RB', 142, -102);
    c.restore();
    const rows = [
      ['LS', 'Move'], ['RT / LT', 'Right / left hand or shield'],
      ['RS', 'Snap turn 30°'], ['RB', 'Shoulder cannons'],
      ['A', 'Jump / hold to jet · Release on drop'], ['LB release', 'Single missile'],
      ['B', 'Dash · Back in menus'], ['Y', 'Full missile salvo'],
      ['X', 'Reload'], ['RS click', 'Lock on / switch target'],
      ['LS hold', 'Board / leave mech or vehicle'], ['D-pad ↑ / ↓', 'First / chase view · Descend'],
      ['D-pad ← / →', 'Zoom'], ['LB + D-pad', 'Vehicle weapon slots ↑ → ↓ ←'],
      ['Menu ≡', 'Show / hide panel'], ['View ▧', 'Summon monsters'],
      ['A / D-pad', 'Select / navigate menus'], ['Pause', 'Choose Hangar on the panel'],
    ];
    rows.forEach(([key, action], i) => {
      const x = 28 + (i % 2) * 588, y = 370 + Math.floor(i / 2) * 30;
      c.font = 'bold 22px sans-serif'; c.fillStyle = '#f2b632'; c.fillText(key, x, y);
      c.font = '21px sans-serif'; c.fillStyle = '#ece8df'; c.fillText(action, x + 158, y, 412);
    });
  }
}
