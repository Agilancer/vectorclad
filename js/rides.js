import * as THREE from './three.js';
import { workshop, createAPC } from './vehicles/models.js';
import { WEAPONS, buildWeaponModel } from './weapons.js';
import { SKINS } from './atlas.js';

// ---------------------------------------------------------------------------
// Rides for the pilot on foot (js/pilot.js): a Cheyenne gunship and a Bastion APC
// parked by the plaza, and any car in the city. Hold G beside one to get in and
// again to get out.
//   - Cheyenne: WASD flies along the view, Space climbs, C (or Ctrl) sinks, Shift
//     boosts. LMB fires the twin chin vulcans, RMB the HEAVY VULCAN (a rotary
//     launcher of mini-rockets), Q one missile, E a salvo from every pod. 1-4
//     swap the pod on each of the four weapon points.
//   - APC: W/S drive, A/D steer, the turret follows the view. LMB fires its twin
//     heavy vulcans.
//   - Cars: W/S drive, A/D steer.
// Models are in meters; M turns meters into game units.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a, b) => a + Math.random() * (b - a);
const UP = new V3(0, 1, 0);
const _a = new V3(), _b = new V3(), _c = new V3();

/** Pods for the Cheyenne's weapon points. rocketPod: unguided rockets from the same tubes. */
const POD_TYPES = ['missilePod', 'heavyPod', 'microPod', 'rocketPod'];
const POD_DEFS = {
  missilePod: WEAPONS.missilePod, heavyPod: WEAPONS.heavyPod, microPod: WEAPONS.microPod,
  rocketPod: { name: 'RP-12 Rocket Pod', short: 'ROCKETS', kind: 'missile', rockets: true, missiles: 12, mscale: 0.8, interval: 0.07, reloadTime: 6, dmg: 40, splash: 5, speed: 150, model: 'missilePod' },
};
const POD_NAMES = { missilePod: 'MISSILE POD', heavyPod: 'HEAVY MISSILE POD', microPod: 'MICRO MISSILE POD', rocketPod: 'ROCKET POD' };
const VULCAN = { kind: 'bullet', dmg: 4, speed: 420, rate: 0.045, spread: 0.014 };
/** The heavy vulcan: a rotary launcher that spits mini-rockets like a minigun */
const HEAVY = { kind: 'rocket', dmg: 12, splash: 2.6, speed: 150, rate: 0.065, spread: 0.02 };

/** The AH-56 style Cheyenne: rigid four-blade rotor, stub wings with four pylons, a pusher prop */
function createCheyenne(T, options) {
  const { box, cyl, hull, group, finish } = workshop(T, Object.assign({ color: 0x2c3330 }, options));
  const root = new T.Group();
  root.name = 'VECTORCLAD / Cheyenne gunship';
  const body = group(root, 'fuselage');
  hull(body, [[-8, 0.3, 1.4, 2.0], [-6.5, 0.75, 0.9, 2.9], [-3, 1.0, 0.7, 3.3], [1.5, 0.95, 0.8, 3.2], [4, 0.5, 1.5, 2.7], [9.2, 0.26, 1.9, 2.5]]);
  hull(body, [[-7.3, 0.42, 2.0, 2.55], [-5, 0.72, 2.6, 3.55], [-2.2, 0.66, 2.9, 3.6], [-1, 0.5, 3.0, 3.3]], 'glass');
  hull(body, [[-1.6, 0.62, 3.0, 3.5], [2, 0.7, 3.0, 3.65], [4.2, 0.42, 2.6, 3.1]], 'dark');
  cyl(body, 0.2, 0.26, 0.9, 0, 3.95, 0.5, 'metal');
  box(body, 0.16, 2.4, 1.6, 0, 3.0, 8.7);
  box(body, 3.4, 0.12, 1.0, 0, 2.05, 8.4);
  box(body, 6.4, 0.2, 1.5, 0, 1.45, -0.5);
  box(body, 6.6, 0.06, 0.2, 0, 1.56, -1.2, 'edge');
  for (const s of [-1, 1]) {
    box(body, 0.14, 0.14, 5.2, s * 1.15, 0.07, -0.8, 'metal');
    for (const z of [-2.6, 0.9]) box(body, 0.1, 0.9, 0.1, s * 0.95, 0.5, z, 'metal').rotation.z = s * 0.35;
    box(body, 0.5, 0.35, 1.6, s * 0.95, 2.6, 2.4, 'dark');
  }
  // Chin turret with the twin vulcans
  const chin = group(root, 'chin turret', 0, 0.55, -6.6);
  cyl(chin, 0.36, 0.36, 0.42, 0, 0, 0, 'dark');
  for (const x of [-0.13, 0.13]) cyl(chin, 0.055, 0.055, 1.5, x, -0.05, -0.75, 'metal', 'z', 8);
  // The heavy vulcan under the belly: six barrels round a hub
  const belly = group(root, 'heavy vulcan', 0, 0.42, -2.6);
  cyl(belly, 0.42, 0.42, 0.4, 0, 0, 0, 'dark');
  const spin = group(belly, 'barrels', 0, -0.05, -0.4);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; cyl(spin, 0.06, 0.06, 2, Math.cos(a) * 0.15, Math.sin(a) * 0.15, -1, 'metal', 'z', 8); }
  cyl(spin, 0.24, 0.24, 0.12, 0, 0, -1.9, 'dark', 'z');
  // Rotors
  const rotor = group(root, 'main rotor', 0, 4.45, 0.5);
  cyl(rotor, 0.42, 0.42, 0.28, 0, 0, 0, 'metal');
  for (let k = 0; k < 4; k++) { const b = group(rotor, 'blade', 0, 0, 0); b.rotation.y = (k / 4) * Math.PI * 2; box(b, 0.6, 0.06, 7.4, 0, 0.1, 3.9, 'dark'); }
  const prop = group(root, 'pusher prop', 0, 2.05, 9.55);
  for (let k = 0; k < 3; k++) { const b = group(prop, 'blade', 0, 0, 0); b.rotation.z = (k / 3) * Math.PI * 2; box(b, 0.24, 1.4, 0.06, 0, 0.7, 0, 'dark'); }
  const tail = group(root, 'tail rotor', 0.28, 3.6, 9.1);
  for (let k = 0; k < 2; k++) { const b = group(tail, 'blade', 0, 0, 0); b.rotation.x = k * Math.PI; box(b, 0.05, 1.2, 0.18, 0, 0.6, 0, 'dark'); }
  const pylons = [-2.75, -1.75, 1.75, 2.75].map((x) => group(root, 'pylon', x, 1.3, -0.6));
  finish(root, [body]);
  root.userData.parts = { rotor, prop, tail, chin, belly, spin, pylons };
  return root;
}

export class Rides {
  constructor({ scene, world, fx, sound, weapons, mats, M, meters, hud }) {
    Object.assign(this, { scene, world, fx, sound, weapons, mats, M, hud });
    this.current = null;
    this.list = [];
    this.heli = this.make('cheyenne', createCheyenne(THREE, { metersPerUnit: meters }), { apMax: 420, camDist: 26, camUp: 5.5, radius: 5, height: 4.5, name: 'AH-56X CHEYENNE' });
    this.apc = this.make('apc', createAPC(THREE, { metersPerUnit: meters }), { apMax: 700, camDist: 17, camUp: 4.5, radius: 2.6, height: 3.2, name: 'BASTION APC' });
    this.podIds = ['missilePod', 'microPod', 'microPod', 'missilePod'];
    this.pods = [];
    for (let i = 0; i < 4; i++) this.mountPod(i, this.podIds[i]);
    this.fireT = 0; this.heavyT = 0; this.barrel = 0; this.spinV = 0; this.cycle = 0;
    this.time = 0;
  }

  make(kind, obj, o) {
    obj.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    this.scene.add(obj);
    const r = Object.assign({ kind, obj, pos: new V3(), vel: new V3(), yaw: 0, speed: 0, ap: o.apMax, home: null, rotor: 0, tilt: 0, roll: 0 }, o);
    this.list.push(r);
    return r;
  }

  /** Park the gunship and the APC beside the starting plaza */
  park(spawn, yaw) {
    const M = this.M, f = new V3(Math.sin(yaw), 0, Math.cos(yaw)), rt = new V3(-Math.cos(yaw), 0, Math.sin(yaw));
    const spots = [[this.heli, -26, 10], [this.apc, 20, 6]];
    for (const [r, side, ahead] of spots) {
      r.pos.copy(spawn).addScaledVector(rt, side * M).addScaledVector(f, ahead * M);
      r.pos.y = this.world.groundHeight(r.pos.x, r.pos.z, 999, r.radius * M);
      r.yaw = yaw;
      r.home = { pos: r.pos.clone(), yaw };
      r.vel.set(0, 0, 0); r.speed = 0; r.ap = r.apMax;
      this.place(r);
    }
  }

  reset() {
    this.current = null;
    for (const r of this.list) if (r.home) { r.pos.copy(r.home.pos); r.yaw = r.home.yaw; r.vel.set(0, 0, 0); r.speed = 0; r.ap = r.apMax; this.place(r); }
    for (const p of this.pods) p.loaded = p.def.missiles;
  }

  mountPod(i, id) {
    const old = this.pods[i];
    if (old) old.model.group.removeFromParent();
    const def = POD_DEFS[id];
    const model = buildWeaponModel(def.model || id, SKINS.find((s) => s.id === 'gunmetal'), this.mats);
    const g = model.group;
    g.scale.setScalar(0.85);
    g.rotation.y = Math.PI;
    g.position.y = -0.95;
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    this.heli.obj.userData.parts.pylons[i].add(g);
    this.podIds[i] = id;
    this.pods[i] = { model, def, loaded: def.missiles, reloadT: 0, slot: { type: 'shoulder' } };
  }

  /** The nearest ride or car within reach of the pilot at p: { ride } or { car } */
  nearest(p) {
    const M = this.M;
    let best = null, bd = Infinity;
    for (const r of this.list) {
      const d = Math.hypot(p.x - r.pos.x, p.z - r.pos.z) - r.radius * M;
      if (d < 3 * M && d < bd && Math.abs(p.y - r.pos.y) < 5 * M) { best = { ride: r }; bd = d; }
    }
    const cars = this.world.city.carSys;
    if (cars) {
      for (const car of cars.list) {
        if (!car.alive || car.state !== 0 || car.flat) continue;
        const d = Math.hypot(p.x - car.pos.x, p.z - car.pos.z) - car.wid / 2;
        if (d < 2.2 * M && d < bd) { best = { car }; bd = d; }
      }
    }
    return best;
  }

  /** Into a ride, or a car taken out of traffic */
  board(n, P) {
    let r = n.ride;
    if (n.car) {
      const cars = this.world.city.carSys, car = n.car;
      if (car.lane) { car.lane.cars.splice(car.lane.cars.indexOf(car), 1); car.lane = null; }
      const k = cars.moving.indexOf(car);
      if (k >= 0) cars.moving.splice(k, 1);
      car.speed = 0;
      r = { kind: 'car', car, obj: null, pos: car.pos, vel: new V3(), yaw: car.yaw, speed: 0, apMax: 90, ap: 90, camDist: 9, camUp: 2.6, radius: car.wid / 2 / this.M, height: 1.6, name: 'STOLEN CAR' };
    }
    this.current = r;
    this.pilotAp = P.ap;
    P.ap = r.ap;
    P.pos.copy(r.pos);
    P.vel.set(0, 0, 0);
    this.sound.hatch(r.pos);
    this.hud.toast(r.kind === 'cheyenne' ? 'CHEYENNE · LMB VULCANS · RMB HEAVY VULCAN · Q/E PODS · 1-4 SWAP PODS' : r.kind === 'apc' ? 'APC · LMB TWIN HEAVY VULCAN' : 'CAR STOLEN · W/S DRIVE · A/D STEER', 3.5);
  }

  /** Out the side; the ride stays where it is */
  leave(P) {
    const r = this.current, M = this.M;
    this.current = null;
    r.ap = P.ap;
    P.ap = this.pilotAp;
    r.vel.set(0, 0, 0); r.speed = 0;
    const rt = r.kind === 'car' ? _a.set(Math.sin(r.yaw), 0, Math.cos(r.yaw)) : _a.set(-Math.cos(r.yaw), 0, Math.sin(r.yaw));
    P.pos.copy(r.pos).addScaledVector(rt, (r.radius + 1.2) * M);
    P.pos.y = this.world.groundHeight(P.pos.x, P.pos.z, r.pos.y + 2 * M, 0.4 * M);
    P.vel.set(0, 0, 0);
    if (r.kind === 'car') this.place(r);
    this.sound.hatch(P.pos);
  }

  /** Drive or fly the current ride for this frame. Returns its horizontal speed. */
  update(dt, c, P, aim, playing) {
    const r = this.current;
    this.time += dt;
    if (!playing) c = { move: { x: 0, y: 0 } };
    if (r.kind === 'cheyenne') this.fly(dt, c, P, r); else this.drive(dt, c, P, r);
    P.pos.copy(r.pos);
    P.vel.copy(r.vel);
    P.grounded = r.kind !== 'cheyenne';
    P.bodyYaw = r.yaw;
    r.ap = P.ap;
    if (playing) this.shoot(dt, c, r, aim);
    this.place(r);
    return Math.hypot(r.vel.x, r.vel.z);
  }

  fly(dt, c, P, r) {
    const M = this.M, W = this.world;
    const f = _a.set(Math.sin(P.yaw), 0, Math.cos(P.yaw)), rt = _b.set(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
    const boost = !!c.dash;
    const top = (boost ? 75 : 42) * M;
    const want = _c.set(0, 0, 0).addScaledVector(f, c.move.y || 0).addScaledVector(rt, c.move.x || 0);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(top);
    want.y = ((c.jump ? 1 : 0) - (c.down ? 1 : 0)) * 14 * M;
    const k = 1 - Math.exp(-(boost ? 1.6 : 1.1) * dt);
    r.vel.x += (want.x - r.vel.x) * k; r.vel.z += (want.z - r.vel.z) * k;
    r.vel.y += (want.y - r.vel.y) * (1 - Math.exp(-2.5 * dt));
    r.yaw = r.yaw + wrap(P.yaw - r.yaw) * (1 - Math.exp(-3 * dt));
    // Lean into the motion
    const lf = r.vel.x * Math.sin(r.yaw) + r.vel.z * Math.cos(r.yaw), ll = r.vel.x * -Math.cos(r.yaw) + r.vel.z * Math.sin(r.yaw);
    r.tilt = damp(r.tilt, clamp(lf / (75 * M), -1, 1) * 0.3, 4, dt);
    r.roll = damp(r.roll, clamp(ll / (42 * M), -1, 1) * 0.35, 4, dt);
    const prevY = r.pos.y;
    r.pos.addScaledVector(r.vel, dt);
    const bx = r.pos.x, bz = r.pos.z;
    if (W.resolve(r.pos, r.radius * M, r.height * M, Math.max(prevY, r.pos.y))) {
      const nx = r.pos.x - bx, nz = r.pos.z - bz, n = Math.hypot(nx, nz);
      const into = n > 1e-6 ? (r.vel.x * nx + r.vel.z * nz) / n : 0;
      if (into < 0) { r.vel.x -= (nx / n) * into; r.vel.z -= (nz / n) * into; }
    }
    const g = W.groundHeight(r.pos.x, r.pos.z, Math.max(prevY, r.pos.y), r.radius * M * 0.6);
    if (r.pos.y < g) { r.pos.y = g; r.vel.y = Math.max(0, r.vel.y); }
    r.pos.y = Math.min(r.pos.y, 420 * M);
    r.rotor = damp(r.rotor, 1, 1.5, dt);
    this.sound.setThrust(0.35 + r.rotor * 0.35 + (boost ? 0.25 : 0), dt);
    // Downwash on the ground below
    const alt = r.pos.y - g;
    if (alt < 18 * M && Math.random() < 0.6) this.fx.dust(_a.set(r.pos.x + rand(-4, 4) * M, g, r.pos.z + rand(-4, 4) * M), 0.6 * (1 - alt / (18 * M)) + 0.3, 2);
  }

  drive(dt, c, P, r) {
    const M = this.M, W = this.world, car = r.kind === 'car';
    const top = (car ? 38 : 22) * M, rev = (car ? 12 : 8) * M;
    const thr = c.move.y || 0, steer = c.move.x || 0;
    if (thr > 0.1) r.speed = Math.min(top * (c.dash ? 1.35 : 1), r.speed + (car ? 14 : 8) * M * thr * dt);
    else if (thr < -0.1) r.speed = Math.max(-rev, r.speed + (r.speed > 0 ? 30 : 8) * M * thr * dt);
    else r.speed = damp(r.speed, 0, car ? 0.8 : 1.6, dt);
    // Steering bites with speed
    const sp = r.speed / top;
    r.yaw -= steer * (car ? 1.9 : 1.2) * clamp(Math.abs(sp) * 3, 0, 1) * Math.sign(r.speed || 1) * dt;
    const fx = car ? Math.cos(r.yaw) : Math.sin(r.yaw), fz = car ? -Math.sin(r.yaw) : Math.cos(r.yaw);
    r.vel.x = fx * r.speed; r.vel.z = fz * r.speed;
    const prevY = r.pos.y;
    r.vel.y = (r.vel.y || 0) - 30 * M * dt;
    r.pos.x += r.vel.x * dt; r.pos.z += r.vel.z * dt; r.pos.y += r.vel.y * dt;
    const bx = r.pos.x, bz = r.pos.z;
    if (W.resolve(r.pos, r.radius * M, r.height * M, Math.max(prevY, r.pos.y))) {
      const n = Math.hypot(r.pos.x - bx, r.pos.z - bz);
      if (n > 0.02 && Math.abs(r.speed) > 6 * M) { this.sound.crunch(r.pos); this.fx.sparksBurst(r.pos, UP, 8, 0xffc070, 12); }
      r.speed *= 0.6;
    }
    const g = W.groundHeight(r.pos.x, r.pos.z, Math.max(prevY, r.pos.y), r.radius * M * 0.7);
    if (r.pos.y <= g) { r.pos.y = g; r.vel.y = 0; }
    if (W.people && Math.abs(r.speed) > 4 * M) W.people.blast(r.pos, r.radius * M * 1.3, 0.5);
    this.sound.setThrust(0.15 + Math.abs(sp) * 0.4, dt);
    if (!car) r.obj.userData.roll(r.speed * dt);
  }

  shoot(dt, c, r, aim) {
    this.fireT -= dt; this.heavyT -= dt;
    const W = this.weapons;
    if (r.kind === 'car') return;
    if (r.kind === 'apc') {
      // Twin heavy vulcans, barrel by barrel
      if (c.fireR && this.heavyT <= 0) {
        this.heavyT = HEAVY.rate * 0.9;
        const gun = r.obj.getObjectByName('twin gun');
        gun.localToWorld(_a.set((this.barrel++ % 2 ? 0.3 : -0.3), 0, -1.85));
        this.heavyRocket(_a, aim);
      }
      return;
    }
    const P = r.obj.userData.parts;
    if (c.fireR && this.fireT <= 0) {
      this.fireT = VULCAN.rate;
      P.chin.localToWorld(_a.set(this.barrel++ % 2 ? 0.13 : -0.13, -0.05, -1.5));
      const dir = this.aimDir(_a, aim, VULCAN.spread);
      W.spawnTracer(_a.clone(), dir, VULCAN, 0xffc46a, 3.5, 2.5);
      this.fx.muzzle(_a, dir, 0xffa040, 0.6);
      this.sound.gun(_a);
    }
    this.spinV = damp(this.spinV, c.fireL ? 30 : 0, c.fireL ? 6 : 1.5, dt);
    P.spin.rotation.z += this.spinV * dt;
    if (c.fireL && this.heavyT <= 0 && this.spinV > 12) {
      this.heavyT = HEAVY.rate;
      P.spin.localToWorld(_a.set(0, 0, -2));
      this.heavyRocket(_a, aim);
    }
    // Missile pods
    const target = this.pickTarget(aim);
    if (c.missile) {
      const pod = this.pods.filter((p) => p.loaded > 0)[this.cycle++ % Math.max(1, this.pods.filter((p) => p.loaded > 0).length)];
      if (pod) this.launch(pod, target, aim, 0); else this.sound.empty();
    }
    if (c.salvo) {
      let any = false;
      this.pods.forEach((p, pi) => {
        const n = p.loaded;
        for (let i = 0; i < n; i++) { any = true; this.launch(p, target, aim, 0.05 * pi + i * p.def.interval); }
      });
      if (!any) this.sound.empty();
    }
    for (const p of this.pods) {
      if (p.loaded > 0) continue;
      p.reloadT += dt;
      if (p.reloadT >= p.def.reloadTime) { p.loaded = p.def.missiles; p.reloadT = 0; this.sound.reload(); }
    }
    if (this.queue) {
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const q = this.queue[i];
        if (this.time < q.t) continue;
        this.queue.splice(i, 1);
        this.fireTube(q.pod, q.tube, q.target, q.point);
      }
    }
    // Number keys swap the pod on each weapon point
    for (let i = 0; i < 4; i++) {
      if (!c['slot' + (i + 1)]) continue;
      const id = POD_TYPES[(POD_TYPES.indexOf(this.podIds[i]) + 1) % POD_TYPES.length];
      this.mountPod(i, id);
      this.hud.toast(`WEAPON POINT ${i + 1} · ${POD_NAMES[id]}`, 1.6);
      this.sound.click();
    }
  }

  launch(pod, target, aim, delay) {
    if (pod.loaded <= 0) return;
    const tube = pod.def.missiles - pod.loaded;
    pod.loaded--;
    (this.queue || (this.queue = [])).push({ t: this.time + delay, pod, tube, target, point: aim.point.clone().add(_a.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(delay > 0 ? 5 : 0)) });
  }

  fireTube(pod, tube, target, point) {
    if (pod.def.rockets) {
      const t = pod.model.tubes[tube % pod.model.tubes.length];
      t.getWorldPosition(_a);
      const dir = _b.subVectors(point, _a).normalize();
      dir.x += rand(-0.02, 0.02); dir.y += rand(-0.02, 0.02); dir.z += rand(-0.02, 0.02);
      this.weapons.spawnRocket(_a.clone(), dir.normalize().clone(), pod.def, 'rocket');
      this.weapons.rockets[this.weapons.rockets.length - 1].obj.scale.setScalar(2);
      this.sound.rocket(_a);
    } else this.weapons.launchMissile(pod, tube, target, point);
  }

  heavyRocket(from, aim) {
    const dir = this.aimDir(from, aim, HEAVY.spread);
    this.weapons.spawnRocket(from.clone(), dir, HEAVY, 'rocket');
    this.weapons.rockets[this.weapons.rockets.length - 1].obj.scale.setScalar(1.3);
    this.fx.muzzle(from, dir, 0xffa040, 0.9);
    this.sound.rocket(from);
  }

  aimDir(from, aim, spread) {
    const d = new V3().subVectors(aim.point, from);
    if (d.lengthSq() < 1) d.copy(aim.dir);
    d.normalize();
    d.x += rand(-spread, spread); d.y += rand(-spread, spread); d.z += rand(-spread, spread);
    return d.normalize();
  }

  /** The target nearest the crosshair, for the missiles */
  pickTarget(aim) {
    let best = null, bs = 0.12;
    for (const t of this.world.targets) {
      if (!t.alive || t.stealth) continue;
      _b.subVectors(t.pos, this.camPos || aim.point);
      const d = _b.length();
      if (d > 600) continue;
      const s = 1 - _b.dot(aim.dir) / d;
      if (s < bs) { bs = s; best = t; }
    }
    return best;
  }

  /** Chase camera: orbiting the ride with the mouse, pulled in when something is in the way */
  placeCamera(dt, P, camera, camDir) {
    const r = this.current, M = this.M, W = this.world;
    camDir.set(Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), Math.cos(P.yaw) * Math.cos(P.pitch));
    const pivot = _a.copy(r.pos).addScaledVector(UP, r.camUp * M);
    const back = _b.copy(camDir).negate();
    const want = r.camDist * M;
    const hit = W.raycast(pivot, back, want + M, { targets: false });
    const d = hit ? Math.max(2 * M, hit.dist - M) : want;
    camera.position.copy(pivot).addScaledVector(back, d);
    camera.position.y += 1.2 * M;
    camera.lookAt(_c.copy(camera.position).add(camDir));
    camera.near = 0.3;
    this.camPos = pivot.clone();
    return pivot;
  }

  /** Put every ride's model where it is; spin the rotors */
  place(r) {
    if (r.kind === 'car') {
      const cars = this.world.city.carSys, car = r.car;
      car.yaw = r.yaw;
      cars.bounds(car);
      if (car.collider) { car.collider.min.set(car.min.x, r.pos.y, car.min.z); car.collider.max.set(car.max.x, r.pos.y + 1.8 * this.M, car.max.z); this.world.moveCollider(car.collider); }
      cars.place(car);
      return;
    }
    r.obj.position.copy(r.pos);
    r.obj.rotation.set(0, r.yaw + Math.PI, 0, 'YXZ');
    if (r.kind === 'cheyenne') {
      r.obj.rotation.x = -r.tilt;
      r.obj.rotation.z = r.roll;
    }
  }

  /** Rotors, turret and the like, every frame */
  animate(dt, P) {
    const h = this.heli, parts = h.obj.userData.parts;
    if (this.current !== h) h.rotor = damp(h.rotor, 0, 0.4, dt);
    parts.rotor.rotation.y += h.rotor * 28 * dt;
    parts.prop.rotation.z += h.rotor * 40 * dt;
    parts.tail.rotation.x += h.rotor * 45 * dt;
    const a = this.apc;
    if (this.current === a) {
      a.obj.userData.setTurretAngle(wrap(P.yaw - a.yaw));
      a.obj.userData.setGunPitch(clamp(P.pitch, -0.15, 0.7));
    }
    if (this.current === h) {
      parts.chin.rotation.y = clamp(wrap(P.yaw - h.yaw), -1.4, 1.4);
    }
  }
}
