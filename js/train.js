import * as THREE from './three.js';
import { PANELS, ATLASES } from './cityTiles.js';

// ---------------------------------------------------------------------------
// The El's trains.
//
// A train sets out along the elevated railway about once a minute from the
// north, beyond the barricade: cab cars at both ends and four coaches between,
// stainless steel from the silver aluminum facade sheet with ribbed titanium
// roofs, on bogies. It runs south down the line, stops at the end of it by the water,
// crosses over to the other track and runs back north out of the city.
//
// It brakes for the mech on the track. Wherever the deck has been shot away
// under it, or a wreck lies on the line, it derails: the cars stay coupled
// while it brakes, and each leaves the rails as a rigid body with the
// train's speed as it runs off the broken end, tumbles off and crashes down
// onto whatever is below, crushing cars, people and trees where it lands. The trains keep coming whether or not the line is still there,
// so the wrecks pile up under the gap, each settled car becoming something
// solid for the next ones to land on and for the mech to climb.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _s = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _n = new V3(), _r = new V3(), _j = new V3();
const UP = new V3(0, 1, 0);

const CAR = { L: 15, W: 2.9, H: 3.5, floor: 0.95 }; // meters
const CARS = 6, SPEED = 16, EVERY = 60, MAX_WRECKS = 96;

function tileCell(name) {
  const p = PANELS[name], A = ATLASES[p[0]];
  return { atlas: p[0], u: p[1] / A.w, v: 1 - (p[2] + p[4]) / A.h, w: p[3] / A.w, h: p[4] / A.h };
}

/** A box body in the atlas layout the city's materials read: sides, roof and ends, each its own tile */
function bodyGeometry(M, side, end, roof, front) {
  const pos = [], nor = [], col = [], uv = [], cell = [], mode = [], idx = [];
  const quad = (P, n, U, c) => {
    const i0 = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(...P[k]); nor.push(...n); col.push(1, 1, 1); uv.push(...U[k]); cell.push(c.u, c.v, c.w, c.h); mode.push(0); }
    idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  };
  const w = CAR.W / 2 * M, l = CAR.L / 2 * M, y0 = CAR.floor * M, y1 = (CAR.floor + CAR.H) * M, reps = Math.round(CAR.L / 4);
  const cs = tileCell(side), ce = tileCell(end), cr = tileCell(roof), cf = tileCell(front);
  // Sides: windows along the length, one storey of the facade's bay
  quad([[w, y0, l], [w, y0, -l], [w, y1, -l], [w, y1, l]], [1, 0, 0], [[0, 0], [reps, 0], [reps, 1], [0, 1]], cs);
  quad([[-w, y0, -l], [-w, y0, l], [-w, y1, l], [-w, y1, -l]], [-1, 0, 0], [[0, 0], [reps, 0], [reps, 1], [0, 1]], cs);
  // Roof, a little crowned
  const yc = y1 + 0.18 * M;
  quad([[-w, y1, l], [0, yc, l], [0, yc, -l], [-w, y1, -l]], [-0.25, 1, 0], [[0, 0], [0.5, 0], [0.5, reps], [0, reps]], cr);
  quad([[0, yc, l], [w, y1, l], [w, y1, -l], [0, yc, -l]], [0.25, 1, 0], [[0.5, 0], [1, 0], [1, reps], [0.5, reps]], cr);
  // Ends: the front wears a cab window
  quad([[-w, y0, l], [w, y0, l], [w, y1, l], [-w, y1, l]], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], cf);
  quad([[w, y0, -l], [-w, y0, -l], [-w, y1, -l], [w, y1, -l]], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]], ce);
  quad([[-w, y0, -l], [w, y0, -l], [w, y0, l], [-w, y0, l]], [0, -1, 0], [[0, 0], [1, 0], [1, reps], [0, reps]], ce);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 4));
  g.setAttribute('aMode', new THREE.Float32BufferAttribute(mode, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Underframe, two bogies with their wheels, couplers: dark steel */
function frameGeometry(M) {
  const parts = [];
  const box = (sx, sy, sz, x, y, z, c) => { const g = new THREE.BoxGeometry(sx * M, sy * M, sz * M); g.translate(x * M, y * M, z * M); parts.push([g, c]); };
  const wheel = (x, z) => { const g = new THREE.CylinderGeometry(0.45 * M, 0.45 * M, 0.16 * M, 10); g.rotateZ(Math.PI / 2); g.translate(x * M, 0.45 * M, z * M); parts.push([g, [0.12, 0.12, 0.13]]); };
  box(2.5, 0.35, CAR.L - 1.2, 0, 0.78, 0, [0.16, 0.16, 0.17]);
  for (const bz of [-1, 1]) {
    const z = bz * (CAR.L / 2 - 2.6);
    box(2.2, 0.35, 2.8, 0, 0.55, z, [0.2, 0.2, 0.21]);
    for (const dz of [-0.9, 0.9]) for (const x of [-0.75, 0.75]) wheel(x, z + dz);
  }
  box(0.3, 0.3, 0.7, 0, 0.75, CAR.L / 2 + 0.2, [0.25, 0.25, 0.26]);
  box(0.3, 0.3, 0.7, 0, 0.75, -CAR.L / 2 - 0.2, [0.25, 0.25, 0.26]);
  const pos = [], nor = [], col = [];
  for (const [g0, c] of parts) {
    const g = g0.toNonIndexed();
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export class Train {
  constructor({ scene, world, fx, sound }) {
    this.world = world; this.city = world.city; this.fx = fx; this.sound = sound;
    this.M = this.city.M;
    this.el = this.city.el;
    this.trains = [];
    this.wrecks = [];   // cars off the rails, moving or settled
    this.timer = 6;     // the first train comes soon after the start
    this.next = 0;
    const M = this.M, cap = 140;
    const mat = this.city.mats.panelsKit, frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 });
    const mk = (geo, m) => {
      const mesh = new THREE.InstancedMesh(geo, m, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };
    // Stainless coaches with dark windows, from the silver aluminum sheet; ribbed titanium roofs
    this.body = mk(bodyGeometry(M, 'sky01_10', 'sky01_22', 'sky19_21', 'sky01_23'), mat);
    this.cab = mk(bodyGeometry(M, 'sky01_11', 'sky01_22', 'sky19_21', 'sky04_00'), mat);
    this.frame = mk(frameGeometry(M), frameMat);
    this.cap = cap;
  }

  m(x) { return x * this.M; }

  /** A new train at the north end of the line, southbound */
  depart() {
    const el = this.el, m = (v) => this.m(v);
    const cars = [];
    for (let i = 0; i < CARS; i++) cars.push({ off: i * m(CAR.L + 1), cab: i === 0 || i === CARS - 1 });
    this.trains.push({ x0: el.tracks[0], x1: el.tracks[0], cross: null, dir: 1, s: el.z0 + m((CAR.L + 1) * CARS), speed: m(SPEED), cars, state: 'run' });
  }

  /** Where car i of train t is: its track position across (x) and along (z) */
  carAt(t, c, out) {
    const z = t.s - t.dir * c.off, m = (v) => this.m(v);
    // Over the crossover: from one track to the other within 40 m of where it set off back
    const d = t.cross === null ? 0 : Math.max(0, (t.cross - z) * -t.dir), k = Math.min(1, d / m(40)), f = k * k * (3 - 2 * k);
    return out.set(t.x0 + (t.x1 - t.x0) * f, this.el.yt, z);
  }

  /** At the end of the line: turn back on the other track, the last car now leading */
  reverse(t) {
    const last = t.cars[t.cars.length - 1].off;
    t.s -= t.dir * last;
    for (const c of t.cars) c.off = last - c.off;
    t.cars.reverse();
    t.dir = -t.dir;
    t.x0 = this.el.tracks[0]; t.x1 = this.el.tracks[1];
    t.cross = t.s;
    t.state = 'run';
    t.speed = 0;
  }

  /** Whether the track holds at (x, z): the deck under the rails is still there */
  holds(x, z) {
    const D = this.world.destruct, y = this.el.yt - this.m(0.25);
    if (!D) return true;
    return D.solidAt(x, y, z) || D.solidAt(x - this.m(1), y, z) || D.solidAt(x + this.m(1), y, z);
  }

  /** A wreck (of another train, or of this one's cars already gone) on the track at (x, z) */
  blocked(x, z, t) {
    const m = (v) => this.m(v), yt = this.el.yt;
    for (const w of this.wrecks) {
      if (w.from === t) continue;
      if (Math.abs(w.pos.x - x) < m(3) && Math.abs(w.pos.z - z) < m(CAR.L * 0.6) && w.pos.y > yt - m(4) && w.pos.y < yt + m(5)) return true;
    }
    return false;
  }

  /** How far ahead along the track the mech stands on it, or Infinity */
  mechAhead(t, head, P) {
    const m = (v) => this.m(v), yt = this.el.yt;
    if (!P || Math.abs(P.x - head.x) > m(4) || P.y < yt - m(2) || P.y > yt + m(6)) return Infinity;
    const d = (P.z - head.z) * t.dir - m(CAR.L * 0.5);
    return d > -m(2) ? d : Infinity;
  }

  /** Car c (index i, from the front) of train t leaves the rails: a body with the train's speed */
  wreckCar(t, c, i) {
    const m = (v) => this.m(v);
    const flip = c.cab && c.back ? Math.PI : 0;
    const w = {
      cab: c.cab, pos: this.carAt(t, c, new V3()), q: new THREE.Quaternion().setFromAxisAngle(UP, (t.dir > 0 ? 0 : Math.PI) + flip),
      vel: new V3(rand(-1, 1) * m(1.5), m(rand(0.3, 2)), t.dir * Math.max(t.speed, m(3))), w: new V3(rand(-0.3, 0.3), rand(-0.2, 0.2), rand(-0.5, 0.5)),
      rest: 0, asleep: false, collider: null, hitT: 0, from: t,
    };
    this.wrecks.push(w);
    return w;
  }

  /**
   * The train leaves the rails. The cars stay coupled while it brakes: each goes on as a body,
   * tumbling, as it comes to the gap (or into the wreck ahead), and whatever is left when it
   * stops is a wreck on the deck for the next train to pile into.
   */
  derail(t) {
    if (t.crash) return;
    t.crash = true;
    t.cars[t.cars.length - 1].back = t.cars[t.cars.length - 1].cab;
    this.sound.explosion(this.carAt(t, t.cars[0], _a), 0.8);
    // Too many: the oldest settled ones go
    while (this.wrecks.length > MAX_WRECKS) {
      const k = this.wrecks.findIndex((w) => w.asleep);
      if (k < 0) break;
      const [w] = this.wrecks.splice(k, 1);
      if (w.collider) this.world.removeCollider(w.collider);
    }
  }

  /**
   * A derailing train, braking: each car goes when its front bogie runs off the end of the
   * track, and the leading one when it runs into the wreck ahead
   */
  crashing(t, dt) {
    const m = (v) => this.m(v), el = this.el;
    t.speed = Math.max(0, t.speed - m(1.6) * dt);
    t.s += t.dir * t.speed * dt;
    t.cars = t.cars.filter((c, i) => {
      const p = this.carAt(t, c, _c);
      if (p.z < el.z0 || p.z > el.z1) return true;
      const lost = !this.holds(p.x, p.z + t.dir * m(CAR.L * 0.3)) || (i === 0 && this.blocked(p.x, p.z + t.dir * m(CAR.L * 0.5), t));
      if (lost) this.wreckCar(t, c, i);
      return !lost;
    });
    // Stopped: what is left lies on the deck
    if (t.cars.length && t.speed < m(0.3)) { for (const c of t.cars) this.wreckCar(t, c, 0).vel.set(0, 0, 0); t.cars = []; }
    if (!t.cars.length) t.gone = true;
  }

  // ---- wrecks: rigid boxes -------------------------------------------------------

  /** Corners and edge midpoints of a car's box, in its frame (meters scaled) */
  probes() {
    if (this._probes) return this._probes;
    const m = (v) => this.m(v), w = m(CAR.W / 2), l = m(CAR.L / 2), y0 = m(0.3), y1 = m(CAR.floor + CAR.H);
    const P = [];
    for (const y of [y0, y1]) for (const x of [-w, w]) for (const z of [-l, 0, l]) P.push(new V3(x, y, z));
    return (this._probes = P);
  }

  /** Inverse inertia of a box (unit mass) applied to world v, in place */
  invI(w, v) {
    const m = (x) => this.m(x), W = m(CAR.W), H = m(CAR.H + CAR.floor), L = m(CAR.L);
    _qi.copy(w.q).invert();
    v.applyQuaternion(_qi);
    v.x *= 12 / (H * H + L * L); v.y *= 12 / (W * W + L * L); v.z *= 12 / (W * W + H * H);
    return v.applyQuaternion(w.q);
  }

  contact(w, p, n, bounce, mu) {
    const r = _r.subVectors(p, w.pos);
    const v = _a.crossVectors(w.w, r).add(w.vel);
    const vn = v.dot(n);
    if (vn >= 0) return 0;
    const ang = (dir) => _d.crossVectors(this.invI(w, _c.crossVectors(r, dir)), r).dot(dir);
    const jn = -(1 + bounce) * vn / (1 + ang(n));
    w.vel.addScaledVector(n, jn);
    w.w.add(this.invI(w, _c.crossVectors(r, _j.copy(n).multiplyScalar(jn))));
    v.crossVectors(w.w, r).add(w.vel);
    const tv = _b.copy(v).addScaledVector(n, -v.dot(n)), ts = tv.length();
    if (ts > 1e-5) {
      tv.divideScalar(ts);
      const jt = Math.min(ts / (1 + ang(tv)), mu * jn);
      w.vel.addScaledVector(tv, -jt);
      w.w.add(this.invI(w, _c.crossVectors(r, _j.copy(tv).multiplyScalar(-jt))));
    }
    return -vn;
  }

  stepWreck(w, dt, P) {
    const m = (x) => this.m(x), G = 9.81 * this.M * 1.3, n = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / n;
    let touching = false, hardest = 0;
    for (let k = 0; k < n; k++) {
      w.vel.y -= G * h;
      w.pos.addScaledVector(w.vel, h);
      const wl = w.w.length();
      if (wl > 1e-6) w.q.premultiply(_q.setFromAxisAngle(_a.copy(w.w).divideScalar(wl), wl * h)).normalize();
      // Probes against the ground, the rubble, the deck and the wrecks already settled
      let lift = 0;
      for (const p0 of this.probes()) {
        const p = _n.copy(p0).applyQuaternion(w.q).add(w.pos);
        const g = this.world.groundHeight(p.x, p.z, p.y + m(0.6), m(0.3));
        if (p.y < g) lift = Math.max(lift, g - p.y);
      }
      if (lift > 0) {
        w.pos.y += lift;
        for (const p0 of this.probes()) {
          const p = _s.copy(p0).applyQuaternion(w.q).add(w.pos);
          const g = this.world.groundHeight(p.x, p.z, p.y + m(0.6), m(0.3));
          if (p.y < g + m(0.05)) {
            const hit = this.contact(w, p, UP, 0.15, 0.6);
            hardest = Math.max(hardest, hit);
            touching = true;
          }
        }
      }
      // Walls: knocked back off them
      const fwd = _d.set(0, 0, 1).applyQuaternion(w.q);
      _c.copy(w.pos).addScaledVector(fwd, m(CAR.L / 2)).y += m(2);
      if (this.world.destruct && this.world.destruct.solidAt(_c.x, _c.y, _c.z) && w.vel.dot(fwd) > 0) {
        w.vel.addScaledVector(fwd, -w.vel.dot(fwd) * 1.3);
        hardest = Math.max(hardest, m(8));
      }
    }
    if (touching) {
      w.w.multiplyScalar(Math.exp(-dt * 1.5));
      const f = Math.exp(-dt * 0.9);
      w.vel.x *= f; w.vel.z *= f;
    }
    // A hard landing: dust, a crash and whatever was under it crushed
    w.hitT -= dt;
    if (hardest > m(6) && w.hitT <= 0) {
      w.hitT = 0.4;
      const k = Math.min(1.6, hardest / m(14));
      this.fx.dust(w.pos, 1.2 * k + 0.5, 12);
      this.fx.sparksBurst(w.pos, UP, 14, 0xffc070, 24);
      this.sound.crunch(w.pos);
      if (hardest > m(10)) this.sound.explosion(w.pos, 0.6 * k);
      this.world.crushAt(w.pos, m(7), 120 * k);
    }
    const calm = touching && w.vel.lengthSq() < m(0.5) ** 2 && w.w.lengthSq() < 0.04;
    w.rest = calm ? w.rest + dt : 0;
    if (w.rest > 1) this.settle(w);
    if (w.pos.y < this.city.L.water - m(8)) { w.vel.set(0, 0, 0); w.w.set(0, 0, 0); w.asleep = true; }
  }

  /** At rest: something solid, to land on and climb */
  settle(w) {
    w.asleep = true;
    w.vel.set(0, 0, 0); w.w.set(0, 0, 0);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const p0 of this.probes()) {
      const p = _a.copy(p0).applyQuaternion(w.q).add(w.pos);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); z1 = Math.max(z1, p.z);
    }
    // A little inside the corners, so the box doesn't stand far out of a car lying askew
    const ix = (x1 - x0) * 0.08, iz = (z1 - z0) * 0.08;
    w.collider = { min: new V3(x0 + ix, Math.max(0, y0), z0 + iz), max: new V3(x1 - ix, y1, z1 - iz), building: true, wreck: true };
    this.world.moveCollider(w.collider);
  }

  // ---- per frame ---------------------------------------------------------------------

  update(dt, ctx) {
    if (!this.el) return;
    const m = (x) => this.m(x), P = ctx.player, el = this.el;
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = EVERY * rand(0.85, 1.15); this.depart(); }
    for (const t of this.trains) {
      if (t.state === 'wait') {
        t.wait -= dt;
        if (t.wait <= 0) this.reverse(t);
        continue;
      }
      // Up to speed, and braking for the buffers at the south end
      t.speed = Math.min(m(SPEED), t.speed + m(1.4) * dt);
      if (t.dir > 0) {
        const left = el.z1 - m(8) - t.s;
        t.speed = Math.min(t.speed, Math.sqrt(Math.max(0, 2 * m(1.1) * left)));
        if (left < m(0.5) && t.speed < m(0.3)) { t.state = 'wait'; t.wait = 9; t.speed = 0; continue; }
      }
      if (t.crash) { this.crashing(t, dt); continue; }
      // The mech on the track: brake to a stop short of it
      const head = this.carAt(t, t.cars[0], _b), gap = this.mechAhead(t, head, P);
      if (gap < Infinity) t.speed = Math.min(t.speed, Math.sqrt(Math.max(0, 2 * m(3) * (gap - m(4)))));
      t.s += t.dir * t.speed * dt;
      // The rails ahead of the front, and under every car
      let fail = this.blocked(head.x, head.z + t.dir * m(CAR.L * 0.5), t);
      for (let i = 0; i < t.cars.length && !fail; i++) {
        const c = this.carAt(t, t.cars[i], _c);
        if (c.z < el.z0 || c.z > el.z1) continue;
        for (const dz of [-0.35, 0.35]) if (!this.holds(c.x, c.z + dz * m(CAR.L))) { fail = true; break; }
      }
      if (fail) { this.derail(t); this.crashing(t, dt); continue; }
      // Gone north out of the city
      const last = t.s - t.dir * t.cars[t.cars.length - 1].off;
      if (t.dir < 0 && last < el.z0 - m(10)) t.gone = true;
      if (Math.random() < dt * 3 && P && Math.abs(t.s - P.z) < m(300)) this.sound.footstep(_a.set(head.x, el.yt, t.s), 0.25);
    }
    this.trains = this.trains.filter((t) => !t.gone);
    for (const w of this.wrecks) if (!w.asleep) this.stepWreck(w, dt, P);
    this.draw();
  }

  draw() {
    const M = this.M;
    let nb = 0, nc = 0, nf = 0;
    const put = (mesh, i, pos, q) => { _m.compose(pos, q, _s.set(1, 1, 1)); mesh.setMatrixAt(i, _m); };
    for (const t of this.trains) {
      t.cars.forEach((c, i) => {
        this.carAt(t, c, _a);
        if (_a.z < this.el.z0 - M * 20 || _a.z > this.el.z1 + M * 20 || nf >= this.cap) return;
        // The cab at the back faces the other way
        _q.setFromAxisAngle(UP, (t.dir > 0 ? 0 : Math.PI) + (c.cab && i === t.cars.length - 1 ? Math.PI : 0));
        if (c.cab) put(this.cab, nc++, _a, _q); else put(this.body, nb++, _a, _q);
        put(this.frame, nf++, _a, _q);
      });
    }
    for (const w of this.wrecks) {
      if (nf >= this.cap) break;
      if (w.cab) put(this.cab, nc++, w.pos, w.q); else put(this.body, nb++, w.pos, w.q);
      put(this.frame, nf++, w.pos, w.q);
    }
    this.body.count = nb; this.cab.count = nc; this.frame.count = nf;
    this.body.instanceMatrix.needsUpdate = this.cab.instanceMatrix.needsUpdate = this.frame.instanceMatrix.needsUpdate = true;
  }
}
