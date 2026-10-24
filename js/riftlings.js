import * as THREE from './three.js';
import { createRiftlingSwarm, RIFTLING_COLORS } from '../assets/riftlings/riftling.js';

// ---------------------------------------------------------------------------
// Riftlings: small six-limbed swarm predators (assets/riftlings) that rain out
// of summoning portals by the hundred and run the mech down.
//
// The model and its 13 animations are the asset pack's: one instanced mesh
// posed on the GPU, so the whole brood is a single draw call. This module is
// the game side: each riftling falls out of the sky, lands, runs at whatever it
// is after (the mech, or an allied tank that is a good deal nearer), climbs any
// wall in the way and comes over the roof, leaps at the mech's chest from a few
// strides off and slashes at its legs once it is close. They're fragile: any
// hit kills one, a footfall squashes it, and a dashing mech bowls them over.
// Their slashes are light, but a swarm wraps round the mech and adds up fast.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const RCAP = 400;             // most riftlings at once (alive or lying dead)
const GRAVITY = 30;
const HEIGHT_M = 1.35;        // the model's standing height, in meters, at scale 1
const CLIMB = 10;             // climbing speed, units/s
const SLASH = 1.2;            // armor a slash takes, before the mech's hit scale
const POUNCE = 3;             // and a leap that lands on it
const BODY_R = 0.35;          // collision radius against walls, units
const CORPSE_T = 7;           // seconds a body lies before it sinks away
const COLORS = Object.keys(RIFTLING_COLORS);

export const RIFTLING = { id: 'riftling', name: 'RIFTLING', hp: 8, colors: RIFTLING_COLORS };

const UP = new V3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _a = new V3(), _b = new V3();
const _col = new THREE.Color();

export class RiftlingBrood {
  constructor(swarm, { scene }) {
    this.sw = swarm;
    this.world = swarm.world;
    this.fx = swarm.fx;
    this.sound = swarm.sound;
    this.M = swarm.world.M;
    this.batch = createRiftlingSwarm(THREE, { capacity: RCAP, metersPerUnit: 1 / this.M, lod: 'low' });
    const mesh = (this.mesh = this.batch.mesh);
    for (let i = 0; i < RCAP; i++) mesh.setMatrixAt(i, ZERO);
    mesh.count = 0;
    scene.add(mesh);
    this.list = [];
    this.slots = new Array(RCAP).fill(null);
    this.free = [];
    for (let i = RCAP - 1; i >= 0; i--) this.free.push(i);
    this.time = 0;
    this.alive = 0;
    this.grid = new Map();
    this.hits = new Map();
  }

  get room() { return this.free.length; }

  // ---- coming and going ----------------------------------------------------------------

  /** A riftling at pos (its feet), falling. color: one of RIFTLING_COLORS' keys */
  spawn(pos, { color = COLORS[(Math.random() * COLORS.length) | 0], vel = null } = {}) {
    if (!this.free.length) return null;
    const slot = this.free.pop(), scale = rand(1.2, 1.6), h = HEIGHT_M * scale * this.M;
    const r = {
      slot, kind: 'riftling', name: RIFTLING.name, v: RIFTLING, alive: true, removed: false, stealth: false,
      feet: pos.clone(), pos: new V3(), vel: vel ? vel.clone() : new V3(rand(-1.5, 1.5), -3, rand(-1.5, 1.5)),
      yaw: Math.random() * Math.PI * 2, scale, h, radius: 0.5 * h + 0.25, hp: RIFTLING.hp, maxHp: RIFTLING.hp,
      state: 'fall', stateT: 0, t: 0, speed: rand(11, 14), fresh: true, landT: 0.45, color, col: new THREE.Color(RIFTLING_COLORS[color]),
      flash: 0, shade: 1, anim: '', leapCool: rand(1, 3), foe: null, foeT: 0, best: Infinity, stuckT: 0,
      climb: null, struck: false, deadT: 0, squash: 1, airborne: true, wobble: Math.random() * 6,
      hit: (amount, point) => this.damage(r, amount, point),
    };
    r.pos.copy(r.feet).y += h * 0.5;
    this.slots[slot] = r;
    this.list.push(r);
    this.world.targets.push(r);
    this.alive++;
    this.recolor(r);
    this.batch.update(this.time);
    this.play(r, 'leaping', { speed: 0.6, phase: 0.35 });
    this.resize();
    return r;
  }

  remove(r) {
    if (r.removed) return;
    r.removed = true;
    if (r.alive) { r.alive = false; this.alive--; }
    this.untarget(r);
    const i = this.list.indexOf(r);
    if (i >= 0) this.list.splice(i, 1);
    this.mesh.setMatrixAt(r.slot, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.slots[r.slot] = null;
    this.free.push(r.slot);
    this.resize();
  }

  clear() {
    for (const r of [...this.list]) this.remove(r);
    this.hits.clear();
  }

  untarget(r) {
    const t = this.world.targets.indexOf(r);
    if (t >= 0) this.world.targets.splice(t, 1);
  }

  /** Only draw up to the highest slot in use */
  resize() {
    let top = 0;
    for (let i = this.slots.length - 1; i >= 0; i--) if (this.slots[i]) { top = i + 1; break; }
    this.mesh.count = top;
  }

  play(r, name, { speed = 1, phase = Math.random(), force = false } = {}) {
    if (r.anim === name && !force) return;
    r.anim = name;
    this.batch.play(r.slot, name, { speed, phase });
  }

  recolor(r) {
    const k = r.shade * (1 + r.flash * 3);
    _col.copy(r.col).multiplyScalar(k);
    this.mesh.setColorAt(r.slot, _col);
    this.mesh.instanceColor.needsUpdate = true;
  }

  // ---- damage ---------------------------------------------------------------------------

  damage(r, amount, point) {
    if (!r.alive) return false;
    r.hp -= amount;
    r.flash = 1;
    this.recolor(r);
    if (r.hp > 0) return false;
    this.kill(r, point);
    return true;
  }

  kill(r, point, { squash = false, fling = null } = {}) {
    if (!r.alive) return;
    r.alive = false;
    this.alive--;
    this.untarget(r);
    r.state = 'dead';
    r.deadT = 0;
    r.shade = 0.35;
    r.flash = 0;
    this.recolor(r);
    this.sw.kills++;
    const c = r.col, glow = c.getHex(), p = r.pos;
    this.fx.sparksBurst(p, UP, 8, glow, 12);
    for (let i = 0; i < 4; i++) this.fx.fire.emit(p.x, p.y, p.z, rand(-3, 3), rand(1, 5), rand(-3, 3), rand(0.2, 0.4), 0.5, 1.4, c.r * 2.5, c.g * 2.5, c.b * 2.5, 1, c.r, c.g, c.b, 0, 2, -8);
    this.sound.riftDie(p);
    if (squash) {
      r.squash = 0.3;
      r.airborne = false;
    } else if (fling) {
      r.vel.copy(fling);
      r.airborne = true;
    } else if (r.airborne) r.vel.set(r.vel.x * 0.3, Math.min(r.vel.y, 0), r.vel.z * 0.3);
    this.play(r, 'death', { phase: squash ? 0.9 : 0, force: true });
    this.sw.cb.onKill && this.sw.cb.onKill(r);
  }

  /** A mech's foot came down at p: everything under it is squashed */
  stomp(p, radius) {
    const R2 = radius * radius;
    for (const r of this.list) {
      if (!r.alive || Math.abs(r.feet.y - p.y) > 1.2) continue;
      const dx = r.feet.x - p.x, dz = r.feet.z - p.z;
      if (dx * dx + dz * dz < R2) this.kill(r, r.pos, { squash: true });
    }
  }

  /** A dashing mech (feet at pos, moving at vel) bowls over anything in its way */
  ram(pos, vel) {
    const speed = Math.hypot(vel.x, vel.z);
    if (speed < 14) return;
    for (const r of this.list) {
      if (!r.alive || r.feet.y < pos.y - 1 || r.feet.y > pos.y + 6) continue;
      if (Math.hypot(r.feet.x - pos.x, r.feet.z - pos.z) < 2.3) {
        this.kill(r, r.pos, { fling: _a.set(vel.x * 0.7 + rand(-4, 4), rand(6, 11), vel.z * 0.7 + rand(-4, 4)) });
      }
    }
  }

  /** Armor taken off a foe this frame, handed over once at the end of it so a swarm isn't a hundred hits */
  deal(F, amount, from) {
    const h = this.hits.get(F);
    if (h) { h.amount += amount; h.from.copy(from); } else this.hits.set(F, { amount, from: from.clone() });
  }

  // ---- per frame --------------------------------------------------------------------------

  /** ctx: { player: { pos, vel, chest, alive } } */
  update(dt, ctx) {
    this.time += dt;
    this.batch.update(this.time);
    if (!this.list.length) return;
    const P = ctx.player;
    this.fileGrid();
    for (const r of [...this.list]) if (!r.removed) this.think(r, dt, P);
    for (const [F, h] of this.hits) {
      if (F === P) this.sw.playerCb.onPlayerHit && this.sw.playerCb.onPlayerHit(h.amount, h.from, 'claw');
      else if (F.alive && F.cb) F.cb.onPlayerHit(h.amount, h.from, 'claw');
    }
    this.hits.clear();
    this.render();
  }

  /** Who it's after: the mech, unless an allied tank is a good deal nearer */
  foeFor(r, P, dt) {
    const allies = this.sw.allies;
    if (!allies.length) return P;
    r.foeT -= dt;
    if (r.foeT > 0 && r.foe && (r.foe === P || r.foe.alive)) return r.foe;
    r.foeT = rand(1.5, 2.5);
    let best = P, bd = P.alive ? r.feet.distanceTo(P.pos) * 0.7 : Infinity;
    for (const a of allies) {
      if (!a.alive || a.ship) continue;
      const d = r.feet.distanceTo(a.pos);
      if (d < bd && d < 120) { bd = d; best = a; }
    }
    r.foe = best;
    return best;
  }

  think(r, dt, P) {
    r.t += dt;
    r.stateT += dt;
    if (r.flash > 0) { r.flash = Math.max(0, r.flash - dt * 8); this.recolor(r); }
    if (r.state === 'dead') { this.corpse(r, dt); return; }
    r.leapCool -= dt;
    const F = this.foeFor(r, P, dt);
    switch (r.state) {
      case 'fall': this.fall(r, dt); break;
      case 'land':
        if (r.stateT > r.landT) {
          // Fresh out of its portal, it may stop to scream first
          const fresh = r.fresh;
          r.fresh = false;
          if (fresh && Math.random() < 0.3) { r.state = 'scream'; r.stateT = 0; this.play(r, 'screaming', { phase: 0 }); this.sound.riftScreech(r.pos); } else this.toRun(r);
        }
        break;
      case 'scream':
        this.face(r, F.pos, dt, 4);
        if (r.stateT > 1.5) this.toRun(r);
        break;
      case 'run': this.run(r, dt, F); break;
      case 'climb': this.climbing(r, dt); break;
      case 'leap': this.leaping(r, dt, F); break;
      case 'attack': this.attacking(r, dt, F); break;
    }
    if (r.removed) return;
    r.pos.set(r.feet.x, r.feet.y + r.h * 0.5, r.feet.z);
  }

  toRun(r) {
    r.state = 'run';
    r.stateT = 0;
    r.best = Infinity;
    r.stuckT = 0;
    this.play(r, 'running', { speed: r.speed / 11 });
  }

  face(r, target, dt, rate) {
    const want = Math.atan2(target.x - r.feet.x, target.z - r.feet.z);
    r.yaw += wrap(want - r.yaw) * Math.min(1, rate * dt);
  }

  /** Close enough to slash at F: the mech's legs, or an ally's hull */
  inReach(r, F, pad = 0) {
    if (F.spheres) return this.sw.foeDist(F, r.pos) < 0.9 + pad;
    if (r.feet.y < F.pos.y - 1.2 || r.feet.y > F.pos.y + 6.5) return false;
    return Math.hypot(r.feet.x - F.pos.x, r.feet.z - F.pos.z) < 2.1 + pad;
  }

  /** Falling, out of a portal or off a roof: down onto whatever is under it */
  fall(r, dt) {
    const y0 = r.feet.y;
    r.vel.y -= GRAVITY * dt;
    r.feet.addScaledVector(r.vel, dt);
    if (Math.abs(r.vel.x) + Math.abs(r.vel.z) > 0.5) this.world.resolve(r.feet, BODY_R, r.h, r.feet.y);
    const g = this.ground(r, y0);
    if (r.feet.y <= g) {
      r.feet.y = g;
      r.airborne = false;
      const impact = -r.vel.y;
      r.vel.set(0, 0, 0);
      r.state = 'land';
      r.stateT = 0;
      r.landT = r.fresh ? 0.45 : 0.15;
      this.play(r, impact > 25 ? 'hit' : 'crawling', { phase: 0, force: true });
      if (impact > 25) this.fx.dust(r.feet, 0.22, 3);
      this.sound.riftLand(r.feet);
    } else if (r.feet.y < this.world.city.L.water - 6) this.remove(r);
  }

  /** The surface under a riftling whose feet were at y (a roof it was over, or the street) */
  ground(r, y) {
    const B = this.world.bounds, x = r.feet.x, z = r.feet.z;
    if (x < B.minX - 30 || x > B.maxX + 30 || z < B.minZ - 30 || z > B.maxZ + 30) return -Infinity;
    return this.world.groundHeight(x, z, y, 0.3);
  }

  run(r, dt, F) {
    if (this.inReach(r, F)) { this.startAttack(r); return; }
    const dx = F.pos.x - r.feet.x, dz = F.pos.z - r.feet.z, dist = Math.hypot(dx, dz) || 1;
    // A leap at the mech from a few strides off
    if (r.leapCool <= 0 && F.alive && dist > 5 && dist < 16 && Math.random() < dt * 1.6) { this.startLeap(r, F); return; }
    // Run at it, weaving a little, kept apart from the rest of the brood
    let wx = dx / dist, wz = dz / dist;
    const weave = Math.sin(r.t * 2.3 + r.wobble) * 0.35;
    wx += -wz * weave; wz += (dx / dist) * weave;
    const sep = this.separation(r);
    wx += sep.x * 1.5; wz += sep.z * 1.5;
    this.face(r, _b.set(r.feet.x + wx, 0, r.feet.z + wz), dt, 9);
    const speed = r.speed * (dist < 6 ? 0.6 : 1);
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
    r.feet.x += fx * speed * dt;
    r.feet.z += fz * speed * dt;
    r.vel.set(fx * speed, 0, fz * speed);
    // A wall in the way: climb it, unless it's a tower and what it's after isn't up there
    const bx = r.feet.x, bz = r.feet.z;
    if (this.world.resolve(r.feet, BODY_R, r.h, r.feet.y)) {
      const nx = r.feet.x - bx, nz = r.feet.z - bz, n = Math.hypot(nx, nz);
      if (n > 1e-5 && (-nx * dx - nz * dz) / (n * dist) > 0.25) {
        const top = this.wallTop(r.feet.x - (nx / n) * 0.6, r.feet.z - (nz / n) * 0.6, r.feet.y);
        if (top > r.feet.y + 0.7 && (top - r.feet.y < 45 || F.pos.y > r.feet.y + 4 || r.stuckT > 2.5)) {
          this.startClimb(r, nx / n, nz / n, top);
          return;
        }
      }
    }
    // Off the edge of a roof: a running leap for the next roof, or down to the street
    const g = this.world.groundHeight(r.feet.x, r.feet.z, r.feet.y, 0.3);
    if (g < r.feet.y - 0.6) {
      r.airborne = true;
      r.stateT = 0;
      if (r.feet.y - g > 3) {
        r.state = 'leap';
        r.vel.set(fx * speed * 1.3, 7, fz * speed * 1.3);
        this.play(r, 'leaping', { speed: 1, phase: 0.2, force: true });
      } else {
        r.state = 'fall';
        this.play(r, 'leaping', { speed: 0.8, phase: 0.4 });
      }
      return;
    }
    r.feet.y = g;
    // Getting no closer: it will climb whatever is in the way after a while
    if (dist < r.best - 0.5) { r.best = dist; r.stuckT = 0; } else r.stuckT += dt;
    if (r.stuckT > 6) { r.best = Infinity; r.stuckT = 0; }
    this.pushOff(r, F);
    this.play(r, 'running', { speed: r.speed / 11 });
  }

  /** Not inside the mech's legs */
  pushOff(r, F) {
    if (F.spheres || r.feet.y < F.pos.y - 1 || r.feet.y > F.pos.y + 6.5) return;
    const dx = r.feet.x - F.pos.x, dz = r.feet.z - F.pos.z, d = Math.hypot(dx, dz);
    if (d < 1.4 && d > 1e-4) { r.feet.x = F.pos.x + (dx / d) * 1.4; r.feet.z = F.pos.z + (dz / d) * 1.4; }
  }

  /** Top of the wall at (x, z) that reaches past feet at y */
  wallTop(x, z, y) {
    let top = -Infinity;
    this.world.query(x - 0.05, z - 0.05, x + 0.05, z + 0.05, (c) => {
      if (c.walk || c.min.y > y + 1 || x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z) return;
      top = Math.max(top, c.max.y);
    });
    return top;
  }

  startClimb(r, nx, nz, top) {
    r.state = 'climb';
    r.stateT = 0;
    r.climb = { nx, nz, top, check: 0.25 };
    r.yaw = Math.atan2(-nx, -nz);
    r.vel.set(0, CLIMB, 0);
    this.play(r, 'climbing', { speed: 1.2 });
  }

  /** Up the wall, then over the edge onto the roof */
  climbing(r, dt) {
    const C = r.climb;
    r.feet.y += CLIMB * dt;
    r.feet.x -= C.nx * dt;
    r.feet.z -= C.nz * dt;
    this.world.resolve(r.feet, BODY_R, r.h, r.feet.y);
    // The wall can be shot out from under it
    if ((C.check -= dt) <= 0) {
      C.check = 0.25;
      C.top = this.wallTop(r.feet.x - C.nx * 0.6, r.feet.z - C.nz * 0.6, r.feet.y - 1);
      if (C.top < r.feet.y - 1) { r.state = 'fall'; r.airborne = true; r.vel.set(C.nx * 2, 0, C.nz * 2); this.play(r, 'leaping', { speed: 0.8, phase: 0.4 }); return; }
    }
    if (r.feet.y >= C.top) {
      r.feet.y = C.top;
      r.feet.x -= C.nx * 0.9;
      r.feet.z -= C.nz * 0.9;
      r.climb = null;
      this.toRun(r);
    }
  }

  /** A leap at the foe's chest, led a little */
  startLeap(r, F) {
    const to = _a.copy(F.chest);
    const d = Math.hypot(to.x - r.pos.x, to.z - r.pos.z), T = Math.min(0.95, Math.max(0.45, d / 18));
    if (F.vel) to.addScaledVector(F.vel, T * 0.5);
    r.vel.subVectors(to, r.pos).divideScalar(T);
    r.vel.y += 0.5 * GRAVITY * T;
    r.state = 'leap';
    r.stateT = 0;
    r.airborne = true;
    r.leapCool = rand(2.5, 4.5);
    r.yaw = Math.atan2(r.vel.x, r.vel.z);
    this.play(r, 'leaping', { speed: 1.25 / (T + 0.4), phase: 0.22, force: true });
    if (Math.random() < 0.2) this.sound.riftScreech(r.pos);
  }

  leaping(r, dt, F) {
    const y0 = r.feet.y;
    r.vel.y -= GRAVITY * dt;
    r.feet.addScaledVector(r.vel, dt);
    r.pos.set(r.feet.x, r.feet.y + r.h * 0.5, r.feet.z);
    // Onto the foe: a slash as it lands, then it drops off
    const onIt = F.spheres ? this.sw.foeDist(F, r.pos) < 0.6 : F.alive && Math.hypot(r.pos.x - F.pos.x, r.pos.z - F.pos.z) < 2 && r.pos.y > F.pos.y + 1 && r.pos.y < F.pos.y + 7;
    if (onIt && F.alive) {
      this.deal(F, POUNCE, r.pos);
      this.sound.riftSlash(r.pos);
      this.fx.sparksBurst(r.pos, UP, 4, 0xffc070, 14);
      r.vel.set(-r.vel.x * 0.15, 2, -r.vel.z * 0.15);
      r.state = 'fall';
      r.stateT = 0;
      this.play(r, 'attacking', { phase: 0.35, force: true });
      return;
    }
    this.world.resolve(r.feet, BODY_R, r.h, r.feet.y);
    const g = this.ground(r, y0);
    if (r.feet.y <= g && r.vel.y <= 0) {
      r.feet.y = g;
      r.airborne = false;
      r.vel.set(0, 0, 0);
      r.state = 'land';
      r.stateT = 0;
      r.landT = 0.15;
      this.play(r, 'crawling', { phase: 0, force: true });
    } else if (r.feet.y < this.world.city.L.water - 6) this.remove(r);
  }

  startAttack(r) {
    r.state = 'attack';
    r.stateT = 0;
    r.struck = false;
    r.recover = rand(0.85, 1.15);
    r.vel.set(0, 0, 0);
    this.play(r, 'attacking', { phase: 0, force: true });
  }

  attacking(r, dt, F) {
    this.face(r, F.pos, dt, 10);
    const sep = this.separation(r);
    r.feet.x += sep.x * dt * 3;
    r.feet.z += sep.z * dt * 3;
    this.pushOff(r, F);
    if (!r.struck && r.stateT >= 0.42) {
      r.struck = true;
      if (F.alive && this.inReach(r, F, 0.6)) {
        this.deal(F, SLASH, r.pos);
        this.sound.riftSlash(r.pos);
        if (Math.random() < 0.3) this.fx.sparksBurst(r.pos, UP, 3, 0xffc070, 12);
      }
    }
    if (r.stateT >= r.recover) {
      if (F.alive && this.inReach(r, F)) this.startAttack(r);
      else this.toRun(r);
    }
  }

  /** Lying dead (or still falling dead), then sinking away */
  corpse(r, dt) {
    r.deadT += dt;
    if (r.airborne) {
      const y0 = r.feet.y;
      r.vel.y -= GRAVITY * dt;
      r.feet.addScaledVector(r.vel, dt);
      this.world.resolve(r.feet, BODY_R, r.h, r.feet.y);
      const g = this.ground(r, y0);
      if (r.feet.y <= g) { r.feet.y = g; r.airborne = false; r.vel.set(0, 0, 0); }
      else if (r.feet.y < this.world.city.L.water - 6) { this.remove(r); return; }
    } else if (r.deadT > CORPSE_T) r.feet.y -= dt * 0.5;
    if (r.deadT > CORPSE_T + 2) this.remove(r);
  }

  // ---- crowding ------------------------------------------------------------------------------

  key(x, z) { return (Math.floor(x / 1.5) + 4096) * 8192 + (Math.floor(z / 1.5) + 4096); }

  fileGrid() {
    const G = this.grid;
    G.clear();
    for (const r of this.list) {
      if (!r.alive || r.airborne || r.state === 'climb') continue;
      const k = this.key(r.feet.x, r.feet.z);
      const cell = G.get(k);
      if (cell) cell.push(r); else G.set(k, [r]);
    }
  }

  /** A push away from the riftlings crowding this one */
  separation(r) {
    const out = _s.set(0, 0, 0), G = this.grid;
    const cx = Math.floor(r.feet.x / 1.5), cz = Math.floor(r.feet.z / 1.5);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cell = G.get((cx + i + 4096) * 8192 + (cz + j + 4096));
        if (!cell) continue;
        for (const o of cell) {
          if (o === r || Math.abs(o.feet.y - r.feet.y) > 1) continue;
          const dx = r.feet.x - o.feet.x, dz = r.feet.z - o.feet.z, d = Math.hypot(dx, dz), want = (r.h + o.h) * 0.32;
          if (d < want && d > 1e-4) { out.x += (dx / d) * (want - d) / want; out.z += (dz / d) * (want - d) / want; }
        }
      }
    }
    return out;
  }

  // ---- drawing -------------------------------------------------------------------------------

  render() {
    const mesh = this.mesh, k = this.M;
    for (const r of this.list) {
      _q.setFromAxisAngle(UP, r.yaw + Math.PI);
      const s = r.scale * k;
      _s.set(s, s * r.squash, s);
      mesh.setMatrixAt(r.slot, _m.compose(r.feet, _q, _s));
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
