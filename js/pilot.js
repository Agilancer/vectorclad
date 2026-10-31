import * as THREE from './three.js';
import { buildWeaponModel } from './weapons.js';

// ---------------------------------------------------------------------------
// The pilot on foot. With the mech standing still, holding G climbs out (and,
// back beside it, climbs back in). The pilot is a person in thick sci-fi
// armor with a jetpack, a grappling hook on the right forearm and a small
// copy of the mech's rifle in a dark finish:
//   - First person (the default): the rifle held in the right hand, firing
//     from the right of the view. The wheel zooms out to a close over-the-
//     shoulder third person view and back in.
//   - Space jumps; Space again in the air lights the jetpack, Shift dashes.
//     Both burn the mech's boost gauge at 1.5 times its rate.
//   - LMB fires the rifle. Q throws a sticky grenade that blows out the one
//     tile of wall it sticks to.
//   - RMB fires the grappling hook (about a city block's reach): it reels the
//     pilot in fast on a rope that swings round corners, and stops them dead at
//     the hook: hanging off a wall or ceiling, standing on a floor. RMB again
//     lets go and fires a new line at once; Space lets go and keeps the momentum.
// Distances here are in meters; M turns them into game units.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const UP = new V3(0, 1, 0);
const _a = new V3(), _b = new V3(), _c = new V3(), _q = new THREE.Quaternion();

const HEIGHT = 1.85, EYE = 1.66, RADIUS = 0.38;
const WALK = 6.5, DASH = 17, DASH_KICK = 11, JUMP = 7, GRAVITY = 20, JET_ACCEL = 42, JET_MAX = 10;
const BOOST_MUL = 1.5;          // the jetpack burns the gauge 1.5x as fast as the mech's thrusters
const HOOK_REACH = 140, HOOK_PULL = 38, HOOK_REEL = 16, HOOK_MAX = 48;
const GRENADE_FUSE = 1.4, GRENADE_SPEED = 20, GRENADE_TILE = 2.4, GRENADE_DEPTH = 1.4;
export const PILOT_AP = 60;

/** The rifle's rounds: tracers flown by the WeaponSystem, so they hit like the mech's */
const GUN = { kind: 'bullet', dmg: 4, speed: 420, rate: 0.1, spread: 0.005 };
const DARK = { id: 'pilotDark', tint: '#25272d', stripe: '#3fc9ff' };

function armorMats() {
  const std = (p) => new THREE.MeshStandardMaterial(p);
  return {
    shell: std({ color: 0x2b2f38, roughness: 0.35, metalness: 0.75 }),
    plate: std({ color: 0x181a20, roughness: 0.45, metalness: 0.6 }),
    under: std({ color: 0x0e0f12, roughness: 0.85, metalness: 0.1 }),
    glow: new THREE.MeshBasicMaterial({ color: 0x45d2ff, toneMapped: false }),
    visor: std({ color: 0x0a1820, roughness: 0.05, metalness: 0.9, emissive: 0x1890d0, emissiveIntensity: 0.9 }),
  };
}

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
/** A limb hanging from its joint down -y */
const limb = (r0, r1, len, mat) => { const g = new THREE.CylinderGeometry(r0, r1, len, 9); g.translate(0, -len / 2, 0); return new THREE.Mesh(g, mat); };

/** The grappling hook launcher strapped along a forearm (hanging down -y, back of the arm at +z) */
function buildGrapple(A) {
  const g = new THREE.Group();
  g.add(box(0.07, 0.24, 0.07, A.plate, 0.07, -0.16, 0.0));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), A.shell);
  barrel.position.set(0.07, -0.3, 0.0);
  g.add(barrel);
  for (let i = 0; i < 3; i++) {
    const p = box(0.012, 0.06, 0.012, A.shell);
    const a = (i / 3) * Math.PI * 2;
    p.position.set(0.07 + Math.cos(a) * 0.026, -0.41, Math.sin(a) * 0.026);
    p.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    g.add(p);
  }
  g.add(box(0.075, 0.02, 0.075, A.glow, 0.07, -0.08, 0.0));
  return g;
}

function buildPilot(A, gunModel) {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);
  hips.add(box(0.4, 0.22, 0.28, A.shell));
  hips.add(box(0.42, 0.06, 0.3, A.plate, 0, 0.09, 0));
  const torso = new THREE.Group();
  torso.position.y = 0.06;
  hips.add(torso);
  torso.add(box(0.52, 0.56, 0.34, A.shell, 0, 0.32, 0));
  torso.add(box(0.42, 0.3, 0.06, A.plate, 0, 0.42, 0.18));
  torso.add(box(0.3, 0.025, 0.065, A.glow, 0, 0.33, 0.19));
  torso.add(box(0.28, 0.12, 0.3, A.under, 0, 0.06, 0));
  for (const s of [-1, 1]) {
    const pad = box(0.2, 0.12, 0.3, A.plate, s * 0.33, 0.58, 0);
    pad.rotation.z = -s * 0.3;
    torso.add(pad);
  }
  // Helmet
  const head = new THREE.Group();
  head.position.y = 0.62;
  torso.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), A.shell);
  helm.scale.set(0.95, 1.08, 1.05);
  helm.position.y = 0.14;
  head.add(helm);
  head.add(box(0.22, 0.07, 0.08, A.visor, 0, 0.16, 0.12));
  head.add(box(0.06, 0.1, 0.18, A.plate, 0, 0.27, -0.02));
  // Jetpack
  const pack = new THREE.Group();
  pack.position.set(0, 0.32, -0.25);
  torso.add(pack);
  pack.add(box(0.4, 0.5, 0.18, A.plate));
  pack.add(box(0.3, 0.035, 0.02, A.glow, 0, 0.12, -0.095));
  const nozzles = [];
  for (const s of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.46, 10), A.shell);
    tank.position.set(s * 0.14, 0, -0.1);
    pack.add(tank);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.1, 10), A.under);
    noz.position.set(s * 0.14, -0.28, -0.1);
    pack.add(noz);
    const o = new THREE.Object3D();
    o.position.set(s * 0.14, -0.34, -0.1);
    pack.add(o);
    nozzles.push(o);
  }
  // Arms and legs: thicker than a civilian's
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.33, 0.5, 0);
    torso.add(sh);
    sh.add(limb(0.085, 0.075, 0.3, A.shell));
    const el = new THREE.Group();
    el.position.y = -0.3;
    sh.add(el);
    el.add(limb(0.075, 0.065, 0.28, A.shell));
    el.add(box(0.12, 0.16, 0.12, A.plate, 0, -0.14, 0.01));
    const hand = new THREE.Group();
    hand.position.y = -0.3;
    el.add(hand);
    hand.add(box(0.1, 0.1, 0.12, A.under, 0, -0.03, 0.02));
    if (s > 0) el.add(buildGrapple(A));
    arms.push({ sh, el, hand });
    const hip = new THREE.Group();
    hip.position.set(s * 0.13, -0.04, 0);
    hips.add(hip);
    hip.add(limb(0.12, 0.095, 0.44, A.shell));
    hip.add(box(0.2, 0.2, 0.08, A.plate, 0, -0.2, 0.1));
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);
    knee.add(limb(0.095, 0.08, 0.42, A.shell));
    knee.add(box(0.14, 0.12, 0.08, A.plate, 0, -0.04, 0.09));
    knee.add(box(0.15, 0.1, 0.3, A.plate, 0, -0.45, 0.05));
    legs.push({ hip, knee });
  }
  // The rifle in the right hand, along the forearm (-y) with its top toward the back of the hand
  const gun = gunModel.group;
  gun.scale.setScalar(0.62 / 4.5);
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, -0.05, 0.05);
  arms[1].hand.add(gun);
  const hookTip = new THREE.Object3D();
  hookTip.position.set(0.07, -0.44, 0);
  arms[1].el.add(hookTip);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, hips, torso, head, arms, legs, nozzles, gun: gunModel, hookTip };
}

/** First person: the right forearm, hand and rifle, in the camera's frame (-z ahead) */
function buildViewModel(A, gunModel) {
  const v = new THREE.Group();
  const gun = gunModel.group;
  gun.scale.setScalar(0.85 / 4.5);
  gun.rotation.y = Math.PI + 0.07;
  v.add(gun);
  v.add(box(0.1, 0.12, 0.13, A.under, 0, -0.06, 0.01));
  v.add(box(0.105, 0.05, 0.1, A.plate, 0, 0.0, 0.0));
  // The forearm runs back from the grip toward the lower right of the view
  const dir = new V3(0.3, -0.5, 1).normalize();
  const arm = new THREE.Group();
  arm.position.set(0, -0.08, 0.04);
  arm.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
  v.add(arm);
  arm.add(limb(0.06, 0.075, 0.55, A.shell));
  arm.add(box(0.13, 0.22, 0.13, A.plate, 0, -0.2, 0));
  const grap = buildGrapple(A);
  grap.rotation.y = Math.PI;
  grap.position.y = 0.08;
  arm.add(grap);
  const hookTip = new THREE.Object3D();
  hookTip.position.set(-0.07, -0.05, 0);
  arm.add(hookTip);
  v.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  return { group: v, gun: gunModel, hookTip };
}

export class Pilot {
  constructor({ scene, camera, world, fx, sound, weapons, mats, M }) {
    Object.assign(this, { scene, camera, world, fx, sound, weapons, M });
    this.A = armorMats();
    this.body = buildPilot(this.A, buildWeaponModel('beamRifle', DARK, mats));
    this.view = buildViewModel(this.A, buildWeaponModel('beamRifle', DARK, mats));
    this.body.root.scale.setScalar(M);
    this.body.root.visible = false;
    scene.add(this.body.root);
    // The view model is drawn at 1.5x size and 1.5x the distance: the same on screen, clear of the near plane
    this.view.group.scale.setScalar(M * 1.5);
    this.view.group.visible = false;
    camera.add(this.view.group);
    // The grappling line and the hook at its far end
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, toneMapped: false }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    scene.add(this.rope);
    this.hookHead = new THREE.Mesh(new THREE.OctahedronGeometry(0.18 * M), this.A.glow);
    this.hookHead.visible = false;
    scene.add(this.hookHead);
    this.grenadeGeo = new THREE.SphereGeometry(0.11 * M, 10, 8);
    this.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4, metalness: 0.6, emissive: 0xff2a1a, emissiveIntensity: 0 });
    this.grenades = [];
    this.active = false;
    this.third = false;
    this.parked = { pos: new V3(), yaw: 0 };
    this.hook = null;          // { anchor, len, target, off }
    this.jet = false;
    this.fireT = 0; this.throwT = 0; this.recoil = 0; this.phase = 0; this.bob = 0;
    this.prevR = false;
    this.mechAp = 0;
    this.camPos = new V3();
  }

  /** Climb out beside the mech, which stays standing where it is */
  exit(P, mechYaw) {
    const M = this.M;
    this.active = true;
    this.third = false;
    this.parked.pos.copy(P.pos);
    this.parked.yaw = mechYaw;
    // Down beside its right foot
    const rx = -Math.cos(mechYaw), rz = Math.sin(mechYaw);
    P.pos.x += rx * 3.2 + Math.sin(mechYaw) * 1.2;
    P.pos.z += rz * 3.2 + Math.cos(mechYaw) * 1.2;
    P.pos.y = this.world.groundHeight(P.pos.x, P.pos.z, P.pos.y + 2, RADIUS * M);
    this.world.resolve(P.pos, RADIUS * M, HEIGHT * M, P.pos.y);
    P.vel.set(0, 0, 0);
    P.grounded = true;
    P.dashing = P.ascending = false;
    this.mechAp = P.ap;
    P.ap = PILOT_AP;
    this.release();
    this.sound.hatch(P.pos);
  }

  /** Back into the mech: the pilot is wherever the mech is */
  enter(P) {
    this.active = false;
    P.pos.copy(this.parked.pos);
    P.vel.set(0, 0, 0);
    P.grounded = true;
    P.ap = this.mechAp;
    this.release();
    this.body.root.visible = false;
    this.view.group.visible = false;
    this.sound.hatch(P.pos);
  }

  /** Within reach of the parked mech to climb back in */
  nearMech(P) {
    const d = Math.hypot(P.pos.x - this.parked.pos.x, P.pos.z - this.parked.pos.z);
    return d < 7 * this.M + 4 && Math.abs(P.pos.y - this.parked.pos.y) < 4;
  }

  /** Back in the mech with nothing left behind (a redeploy or the frame select) */
  reset() {
    if (this.active) { this.active = false; this.body.root.visible = false; this.view.group.visible = false; }
    this.release();
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades.length = 0;
  }

  release() {
    this.hook = null;
    this.rope.visible = false;
    this.hookHead.visible = false;
  }

  /** The wheel: out to third person, in to first */
  zoom(wheel) {
    if (wheel > 0) this.third = true;
    else if (wheel < 0) this.third = false;
  }

  /**
   * Move the pilot (P) for this frame. c: the control snapshot, BD: the mech's boost drain factor,
   * aim: { point, dir } from the camera. Returns the horizontal speed.
   */
  update(dt, c, P, BD, aim, playing, hud) {
    const M = this.M, W = this.world;
    if (!playing) c = { move: { x: 0, y: 0 } };
    this.zoom(c.wheel || 0);
    const f = _a.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
    const r = _b.set(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
    const wish = _c.set(0, 0, 0).addScaledVector(f, c.move.y).addScaledVector(r, c.move.x);
    const wl = wish.length();
    if (wl > 1) wish.divideScalar(wl);
    const bd = BD * BOOST_MUL;
    const canBoost = P.boost > 0 && !P.overheat;

    // Dash: a kick and then a held sprint on the thrusters, just like the mech's
    if (playing && c.dashPressed && canBoost && P.boost > 6 * bd) {
      this.sound.boostIgnite();
      P.boost -= 6 * bd;
      const dir = wl > 0.1 ? wish.clone().normalize() : f.clone();
      P.vel.addScaledVector(dir, DASH_KICK * M);
    }
    P.dashing = playing && !!c.dash && canBoost;
    const maxSpeed = (P.dashing ? DASH : WALK) * M;
    const hx = P.vel.x, hz = P.vel.z, hs = Math.hypot(hx, hz);
    if (P.grounded && !this.hook) {
      // Feet on the ground: run up to speed, stop quickly
      const tx = wish.x * maxSpeed, tz = wish.z * maxSpeed;
      const dx = tx - hx, dz = tz - hz, dv = Math.hypot(dx, dz);
      const acc = (wl > 0.08 ? (P.dashing ? 90 : 60) : 40) * M * dt;
      if (dv > 0) { const k = Math.min(1, acc / dv); P.vel.x += dx * k; P.vel.z += dz * k; }
    } else {
      // In the air: steer, but never brake the momentum the hook or a dash built up
      const acc = (P.dashing ? 26 : 12) * M * dt;
      P.vel.x += wish.x * acc; P.vel.z += wish.z * acc;
      const ns = Math.hypot(P.vel.x, P.vel.z), cap = Math.max(hs, maxSpeed);
      if (ns > cap) { P.vel.x *= cap / ns; P.vel.z *= cap / ns; }
    }

    // Space on the line lets go of it (keeping the momentum); that press neither jumps nor lights the jetpack
    if (playing && c.jumpPressed && this.hook) {
      this.release();
      this.sound.click();
      c = { ...c, jumpPressed: false };
    }

    // Jump, then the jetpack on a second press in the air
    P.ascending = false;
    if (P.grounded) {
      this.jet = false;
      if (playing && c.jumpPressed) { P.vel.y = JUMP * M; P.grounded = false; this.fx.dust(P.pos, 0.25, 4); }
    } else {
      if (playing && c.jumpPressed && canBoost) { this.jet = true; this.sound.boostIgnite(); }
      if (!c.jump || !canBoost) this.jet = false;
      let g = GRAVITY * M;
      if (this.jet) {
        P.ascending = true;
        P.vel.y = Math.min(JET_MAX * M, P.vel.y + JET_ACCEL * M * dt);
        g = 0;
        P.boost -= 24 * bd * dt;
      } else if (P.dashing && !this.hook) {
        g *= 0.3;
        P.vel.y = Math.max(P.vel.y, -6 * M);
      }
      P.vel.y -= g * dt;
    }
    if (P.dashing) P.boost -= 26 * bd * dt;

    // The grappling hook: each press lets go of the old line and fires a new one
    const pressR = playing && c.fireL && !this.prevR;
    this.prevR = playing && !!c.fireL;
    if (pressR) { this.release(); this.fireHook(P, aim, hud); }
    if (this.hook) this.swing(dt, P);

    // Move, then walls and floors
    const prevY = P.pos.y;
    P.pos.addScaledVector(P.vel, dt);
    const stepY = Math.max(prevY, P.pos.y);
    const bx = P.pos.x, bz = P.pos.z;
    if (W.resolve(P.pos, RADIUS * M, HEIGHT * M, stepY)) {
      const nx = P.pos.x - bx, nz = P.pos.z - bz, n = Math.hypot(nx, nz);
      const into = n > 1e-6 ? (P.vel.x * nx + P.vel.z * nz) / n : 0;
      if (into < 0) { P.vel.x -= (nx / n) * into; P.vel.z -= (nz / n) * into; }
    }
    if (W.spiders) W.spiders.mill.pushOut(P.pos, RADIUS * M, HEIGHT * M);
    const ground = W.groundHeight(P.pos.x, P.pos.z, stepY, RADIUS * M);
    if (P.pos.y <= ground) {
      if (!P.grounded && P.vel.y < -12 * M) { this.fx.dust(P.pos, 0.35, 6); this.sound.footstep(P.pos, 0.35); }
      P.pos.y = ground;
      if (P.vel.y <= 1) { P.vel.y = Math.max(0, P.vel.y); P.grounded = true; }
    } else if (P.grounded && P.pos.y > ground + 0.05) P.grounded = false;
    // Ceilings
    if (!P.grounded && P.vel.y > 0) {
      const hit = W.raycast(_a.set(P.pos.x, P.pos.y + HEIGHT * M * 0.5, P.pos.z), UP, HEIGHT * M * 0.55, { targets: false });
      if (hit) P.vel.y = 0;
    }

    // Boost regen and overheat (the gauge is the mech's)
    if (P.dashing || P.ascending) P.boostDelay = 0.6;
    else if (P.grounded) {
      P.boostDelay -= dt;
      if (P.boostDelay <= 0) P.boost = Math.min(100, P.boost + 42 * dt);
    }
    if (P.boost <= 0 && !P.overheat) { P.boost = 0; P.overheat = true; if (hud) hud.toast('JETPACK OVERHEAT', 1.4); this.sound.alarm(); }
    if (P.overheat && P.boost >= 40) P.overheat = false;
    P.bodyYaw = P.yaw;
    const thrust = P.ascending ? 1 : P.dashing ? 0.7 : 0;
    this.sound.setThrust(thrust * 0.5, dt);
    P.thrust.main = damp(P.thrust.main, thrust, 14, dt);

    // Rifle and grenades
    this.fireT -= dt;
    this.throwT -= dt;
    this.recoil = damp(this.recoil, 0, 14, dt);
    if (playing && c.fireR && this.fireT <= 0) this.shoot(P, aim);
    if (playing && (c.missile || c.salvo) && this.throwT <= 0) this.throwGrenade(P, aim);
    this.updateGrenades(dt);

    const speed = Math.hypot(P.vel.x, P.vel.z);
    this.phase += dt * (P.grounded ? speed / M * 1.5 : 0);
    return speed;
  }

  fireHook(P, aim, hud) {
    const W = this.world, M = this.M;
    const o = this.camPos;
    const hit = W.raycast(o, aim.dir, HOOK_REACH * M, { props: true });
    if (!hit) { this.sound.empty(); if (hud) hud.toast('OUT OF REACH', 0.6); return; }
    // The surface's normal, facing back toward the pilot, decides where the pilot stops
    const n = hit.normal ? hit.normal.clone().normalize() : aim.dir.clone().negate();
    if (n.dot(aim.dir) > 0) n.negate();
    this.hook = { anchor: hit.point.clone(), len: 0, target: hit.target || null, off: null, normal: n, stop: new V3(), hang: false };
    if (hit.target) this.hook.off = hit.point.clone().sub(hit.target.pos);
    this.stopPoint(this.hook);
    this.hook.len = this.hook.stop.distanceTo(_a.set(P.pos.x, P.pos.y + HEIGHT * M * 0.6, P.pos.z));
    this.fx.sparksBurst(hit.point, hit.normal || UP, 8, 0x9fe6ff, 14);
    this.sound.thump(P.pos);
    P.grounded = false;
    P.vel.y = Math.max(P.vel.y, 3 * M);
  }

  /**
   * Where the pilot's chest comes to rest at the end of the line: clear of a wall or a ceiling
   * by the body's size, or standing on a floor or a rooftop.
   */
  stopPoint(h) {
    const M = this.M, n = h.normal;
    const k = n.y > 0.6 ? HEIGHT * 0.6 : n.y < -0.6 ? HEIGHT * 0.4 + 0.15 : RADIUS + 0.15;
    h.stop.copy(h.anchor).addScaledVector(n, k * M);
  }

  /**
   * On the rope: reeled in fast, and held to its length so it swings round the anchor. It ends
   * with the pilot stopped dead at the hook: hanging off a wall or ceiling until Space or a new
   * shot lets go, or standing on a floor.
   */
  swing(dt, P) {
    const M = this.M, h = this.hook;
    if (h.target) {
      if (!h.target.alive) { this.release(); return; }
      const nx = h.target.pos.x + h.off.x, ny = h.target.pos.y + h.off.y, nz = h.target.pos.z + h.off.z;
      // A target moved across the map in one frame (a pedestrian or car recycled elsewhere) takes the hook with it
      if (Math.hypot(nx - h.anchor.x, ny - h.anchor.y, nz - h.anchor.z) > 8 * M) { this.release(); return; }
      h.anchor.set(nx, ny, nz);
    }
    this.stopPoint(h);
    const lift = HEIGHT * M * 0.6;
    const chest = _a.set(P.pos.x, P.pos.y + lift, P.pos.z);
    const to = _b.subVectors(h.stop, chest);
    const d = to.length();
    // Arrived, or close enough that this frame's step would carry the pilot past it (and into the wall)
    if (h.hang || d < 0.35 * M || d <= P.vel.length() * dt) {
      P.pos.set(h.stop.x, h.stop.y - lift, h.stop.z);
      P.vel.set(0, 0, 0);
      if (h.normal.y > 0.6) { this.release(); P.grounded = true; return; }
      if (!h.hang) { h.hang = true; this.sound.footstep(P.pos, 0.3); }
      this.jet = false;
      P.grounded = false;
      return;
    }
    to.divideScalar(d);
    // Pulled along the rope, and reeled in
    P.vel.addScaledVector(to, HOOK_PULL * M * dt);
    h.len = Math.max(1.2 * M, Math.min(h.len, d) - HOOK_REEL * M * dt);
    // The rope can't stretch: take away any speed outward along it, and pull back to its length
    const out = -P.vel.dot(to);
    if (d > h.len) {
      if (out > 0) P.vel.addScaledVector(to, out);
      P.pos.addScaledVector(to, Math.min(d - h.len, 20 * M * dt));
    }
    const s = P.vel.length(), cap = Math.min(HOOK_MAX * M, d / dt);
    if (s > cap) P.vel.multiplyScalar(cap / s);   // never overshoot the stop point in one frame
    P.grounded = false;
  }

  shoot(P, aim) {
    this.fireT = GUN.rate;
    const muz = (this.third ? this.body.gun : this.view.gun).muzzles[0];
    muz.getWorldPosition(_a);
    const dir = _b.subVectors(aim.point, _a);
    if (dir.lengthSq() < 1e-4) dir.copy(aim.dir);
    dir.normalize();
    dir.x += (Math.random() - 0.5) * GUN.spread * 2; dir.y += (Math.random() - 0.5) * GUN.spread * 2; dir.z += (Math.random() - 0.5) * GUN.spread * 2;
    dir.normalize();
    this.weapons.spawnTracer(_a.clone(), dir.clone(), GUN, 0x7fe0ff, 2.2, 1.6);
    this.fx.muzzle(_a, dir, 0x6fd8ff, 0.22);
    this.sound.gun(_a);
    this.recoil = 1;
  }

  throwGrenade(P, aim) {
    const M = this.M;
    this.throwT = 0.9;
    if (this.grenades.length >= 4) return;
    const mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat.clone());
    const pos = this.camPos.clone().addScaledVector(aim.dir, 0.5 * M).add(_a.set(-Math.cos(P.yaw), 0, Math.sin(P.yaw)).multiplyScalar(0.25 * M));
    const vel = aim.dir.clone().multiplyScalar(GRENADE_SPEED * M).add(P.vel);
    vel.y += 3 * M;
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.grenades.push({ mesh, pos, vel, stuck: null, t: 0 });
    this.sound.thump(pos);
  }

  updateGrenades(dt) {
    const W = this.world, M = this.M;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.t += dt;
      if (!g.stuck) {
        g.vel.y -= GRAVITY * M * dt;
        const step = g.vel.length() * dt;
        const dir = _a.copy(g.vel).normalize();
        const hit = W.raycast(g.pos, dir, step, { props: true });
        if (hit) {
          g.pos.copy(hit.point);
          g.stuck = { point: hit.point.clone(), normal: (hit.normal || UP).clone(), struct: hit.struct || null, collider: hit.collider || null, target: hit.target || null, dir: dir.clone() };
          if (hit.target) g.stuck.off = hit.point.clone().sub(hit.target.pos);
          g.t = 0;
          this.sound.click();
        } else g.pos.addScaledVector(g.vel, dt);
        if (g.t > 8) { this.scene.remove(g.mesh); this.grenades.splice(i, 1); continue; }
      } else {
        const s = g.stuck;
        if (s.target && s.target.alive) g.pos.copy(s.target.pos).add(s.off);
        // A quickening blink, then the bang
        g.mesh.material.emissiveIntensity = Math.sin(g.t * (8 + g.t * 20)) > 0 ? 3 : 0.2;
        if (g.t >= GRENADE_FUSE) {
          this.detonate(g);
          this.scene.remove(g.mesh);
          this.grenades.splice(i, 1);
          continue;
        }
      }
      g.mesh.position.copy(g.pos);
    }
  }

  detonate(g) {
    const W = this.world, s = g.stuck, M = this.M;
    s.point.copy(g.pos);
    this.fx.explosion(g.pos, 0.55, { normal: s.normal });
    this.sound.explosion(g.pos, 0.6);
    W.damageRadius(g.pos, 3 * M, 70);
    if (W.people) W.people.blast(g.pos, 3 * M, 1);
    // Only the one tile it stuck to
    if (W.destruct && !s.target && (s.struct || s.collider)) W.destruct.tile(s, s.dir, GRENADE_TILE, GRENADE_DEPTH);
  }

  /** Place the camera: the eyes in first person, close over the right shoulder in third */
  placeCamera(dt, P, camera, camDir) {
    const M = this.M, W = this.world;
    camDir.set(Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), Math.cos(P.yaw) * Math.cos(P.pitch));
    const eye = this.camPos.set(P.pos.x, P.pos.y + EYE * M, P.pos.z);
    // A little bob as the feet go
    const speed = Math.hypot(P.vel.x, P.vel.z);
    this.bob = damp(this.bob, P.grounded ? clamp(speed / (WALK * M), 0, 1.5) : 0, 8, dt);
    if (!this.third) {
      eye.y += Math.abs(Math.sin(this.phase)) * 0.04 * M * this.bob;
      camera.position.copy(eye);
    } else {
      const right = _a.set(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
      const pivot = _b.copy(eye).addScaledVector(UP, 0.05 * M);
      let side = 0.75 * M;
      const sh = W.raycast(pivot, right, side + 0.3 * M, { targets: false });
      if (sh) side = Math.max(0, sh.dist - 0.3 * M);
      pivot.addScaledVector(right, side);
      const back = _c.copy(camDir).negate();
      const want = 2.9 * M;
      const hit = W.raycast(pivot, back, want + 0.3 * M, { targets: false });
      const dist = hit ? Math.max(0.3 * M, hit.dist - 0.3 * M) : want;
      camera.position.copy(pivot).addScaledVector(back, dist);
    }
    camera.lookAt(_a.copy(camera.position).add(camDir));
    camera.near = this.third ? 0.12 : 0.1;
  }

  /** Pose the third person model and the first person arm, the jetpack flames, the rope */
  animate(dt, P, aimPitch, time, playing) {
    const M = this.M, B = this.body, fp = !this.third && playing;
    B.root.visible = !fp;
    this.view.group.visible = fp;
    B.root.position.copy(P.pos);
    B.root.rotation.set(0, P.yaw, 0);
    const speed = Math.hypot(P.vel.x, P.vel.z) / M;
    const k = P.grounded ? clamp(speed / WALK, 0, 1.6) : 0, s = Math.sin(this.phase);
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1, L = B.legs[i];
      if (P.grounded) {
        L.hip.rotation.x = side * 0.6 * s * k;
        L.knee.rotation.x = Math.max(0, Math.sin(this.phase + (i ? Math.PI : 0) + 1.3)) * 0.9 * k + 0.05;
      } else {
        L.hip.rotation.x = damp(L.hip.rotation.x, i ? -0.5 : 0.2, 6, dt);
        L.knee.rotation.x = damp(L.knee.rotation.x, i ? 0.9 : 0.4, 6, dt);
      }
    }
    B.hips.position.y = 0.95 + Math.abs(Math.cos(this.phase)) * 0.04 * k;
    B.torso.rotation.x = P.dashing ? 0.25 : 0.05 * k;
    B.head.rotation.x = -aimPitch * 0.5;
    // Rifle arm up along the aim, the other steadying it, or reaching for the rope
    const R = B.arms[1], Lf = B.arms[0];
    R.sh.rotation.set(-(Math.PI / 2 + aimPitch) + this.recoil * 0.08, 0.1, 0);
    R.el.rotation.x = 0;
    if (this.hook) { Lf.sh.rotation.set(-2.4, 0, -0.3); Lf.el.rotation.x = 0; } else { Lf.sh.rotation.set(-(Math.PI / 2 + aimPitch) * 0.85, -0.6, 0); Lf.el.rotation.x = -0.6; }
    // First person: kick and bob
    const v = this.view.group;
    const bx = Math.sin(this.phase) * 0.012 * this.bob, by = Math.abs(Math.cos(this.phase)) * 0.012 * this.bob;
    v.position.set((0.2 + bx) * M * 1.5, (-0.2 - by) * M * 1.5, (-0.42 + this.recoil * 0.05) * M * 1.5);
    v.rotation.set(this.recoil * 0.06, 0, 0);
    // Jetpack flames
    if (P.ascending || P.dashing) {
      for (const n of B.nozzles) {
        n.getWorldPosition(_a);
        this.fx.fire.emit(_a.x, _a.y, _a.z, P.vel.x, -6 * M + P.vel.y, P.vel.z, 0.05, 0.22 * M * 3, 0.06 * M * 3, 0.35, 0.5, 1.0, 0.7, 0.4, 0.2, 0.9, 0, 2);
      }
    }
    // The rope from the hook launcher to the anchor
    if (this.hook) {
      (fp ? this.view.hookTip : B.hookTip).getWorldPosition(_a);
      const to = _b.subVectors(this.hook.anchor, _a), d = to.length();
      this.rope.position.copy(_a);
      this.rope.quaternion.setFromUnitVectors(UP, to.divideScalar(d));
      this.rope.scale.set(0.035 * M, d, 0.035 * M);
      this.rope.visible = true;
      this.hookHead.position.copy(this.hook.anchor);
      this.hookHead.rotation.y = time * 6;
      this.hookHead.visible = true;
    }
  }

  chest(out, P) { return out.set(P.pos.x, P.pos.y + 1.3 * this.M, P.pos.z); }
}
