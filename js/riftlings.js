import * as THREE from './three.js';
import { canvasTexture } from './atlas.js';
import { capsuleDist } from './frameParts.js';
import { createRiftlingSwarm, RIFTLING_COLORS, RIFTLING_CLIPS } from '../assets/riftlings/riftling.js';

// ---------------------------------------------------------------------------
// Riftlings: eight-foot, six-limbed swarm predators (assets/riftlings) that
// pour into the streets in packs of one color, up to a hundred at once.
//
// Every pack hunts the same way. Its leader screams, and the pack runs at the
// mech by the streets (a flow field round the blocks), hopping walls and cars
// and climbing what it's still stuck behind. In range, a riftling crouches and
// leaps at the hull, clings to it clawing at the armor for about a second, then
// bursts with a splat in a spray of its color. Each color has a trick of its own:
//   green (acid): the biggest, fastest packs; every splat sprays acid that eats armor
//   orange (blast): bloated and slower, running in a tight clump; it goes off
//     like a grenade when it splats or is shot, and sets off the rest of the clump
//   purple (shade): runs dark (no lock-on), spreads out to surround the mech,
//     ducks out of the crosshair, then the whole pack pounces at once on a scream
//   blue (spire): comes over the rooftops, climbs the walls in its way, bounds
//     from roof to roof and leaps at the mech from high up and off walls; a latch
//     shorts out the mech's boost
//
// They're drawn by the asset's instanced swarm: one draw call for all of them,
// posed on the GPU from its 13 baked clips. This file moves them: each one is a
// point on a street, a roof or a wall (or the mech's hull), steered toward the
// mech and pushed out of the buildings and each other.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const CAP = 100;               // most alive at once
const SLOTS = 150;             // instance slots: the living, and the dead still lying where they fell
const HEIGHT_M = 8 * 0.3048;   // standing height: 8 ft
const MODEL_M = 1.35;          // the model's own standing height (assets/riftlings/README.md)
// Sizes on the model, in its meters (scaled up to HEIGHT_M with the rest of it)
const BODY = 0.42;             // body radius, against walls and each other
const HIT = 0.85;              // hit sphere radius
const CENTER = 0.7;            // hit sphere center above the feet
const HEAD = 1.9;              // its head above its feet when it rears up onto a wall
const HANG = 0.6, OUT = 0.45;  // on a wall or the hull: its body below its head, and out from the surface
const GRAVITY = 30;
const LEAP_SPEED = 26;         // along a leap's chord, units/s
const HULL = 1.9;              // the mech's hit capsule (js/frameParts.js capsuleDist)
const UP = new V3(0, 1, 0), DOWN = new V3(0, -1, 0);

// ---------------------------------------------------------------------------
// Packs. name: a riftling's lock-on label; from: first wave; weight: share of the
// swarm's packs; size: riftlings per pack. hp; run: top speed, units/s; leap: how
// far off it leaps at the mech, high: how far from up on a roof or a wall; reach:
// how far above its feet the mech's chest can be. latch: seconds it clings; claw:
// each claw stroke while it does and splat: the burst, both before the mech's
// hit scale (js/main.js). Then the color's own trick:
//   acid: seconds of corrosion each splat adds (js/main.js onAcid)
//   blast: { r: radius, dmg: to everything in it, mech: to the mech }; clump: runs packed tight
//   shade: dark and unlockable until it pounces; ring: how far out it surrounds the mech; stalk: speed doing so
//   climber: goes over the buildings, not round them (climbing all but the towers, bounding
//     from roof to roof); climb: its speed up a wall; shock: boost a latch drains
//   bulk: size relative to the rest
// ---------------------------------------------------------------------------
export const RIFT_PACKS = {
  green: {
    name: 'ACID RIFTLING', from: 1, weight: 4, size: [10, 18], hp: 8, run: 16, leap: 22, reach: 12,
    latch: [0.9, 1.15], claw: 1, splat: 2, acid: 1.1,
  },
  orange: {
    name: 'BLAST RIFTLING', from: 1, weight: 2.4, size: [5, 9], hp: 12, run: 11.5, leap: 15, reach: 9,
    latch: [0.8, 1], claw: 1, splat: 0, blast: { r: 5, dmg: 30, mech: 14 }, clump: true, bulk: 1.1,
  },
  purple: {
    name: 'SHADE RIFTLING', from: 2, weight: 2, size: [5, 8], hp: 14, run: 14, leap: 34, reach: 10,
    latch: [1.2, 1.5], claw: 1.5, splat: 3, shade: true, ring: 24, stalk: 7,
  },
  blue: {
    name: 'SPIRE RIFTLING', from: 3, weight: 2, size: [5, 8], hp: 10, run: 15, leap: 20, high: 44, reach: 30,
    latch: [0.9, 1.1], claw: 1, splat: 2, climber: true, climb: 12, shock: 9,
  },
};
for (const id in RIFT_PACKS) RIFT_PACKS[id].id = id;

// States in which a riftling stands on a street or a roof
const GROUND = { muster: 1, run: 1, stalk: 1, dodge: 1, hit: 1, gloat: 1, crouch: 1 };

const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _t = new V3(), _v = new V3(), _w = new V3(), _p = new V3();
const _m = new THREE.Matrix4();
const _col = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------------------
// The way to the mech through the streets: a flow field. The city's footprint is
// a grid of cells, blocked where a building or a wall stands on the street. A
// breadth-first search out from the mech's cell (Dial's algorithm, orthogonal
// steps costing 2 and diagonal ones 3) gives each street cell its distance to
// the mech by street, and a riftling heads downhill: round the blocks, never
// into a dead end. It's searched again whenever the mech moves to another cell.
// ---------------------------------------------------------------------------

const FIELD_CELL = 3;          // units
const FIELD_REACH = 400;       // search no further than this cost: about 600 units by street
const FAR = 65535;
const STEPS = [[1, 0, 2], [-1, 0, 2], [0, 1, 2], [0, -1, 2], [1, 1, 3], [1, -1, 3], [-1, 1, 3], [-1, -1, 3]];

class FlowField {
  constructor(world) {
    const B = world.bounds;
    this.world = world;
    this.x0 = B.minX;
    this.z0 = B.minZ;
    this.nx = Math.ceil((B.maxX - B.minX) / FIELD_CELL) + 1;
    this.nz = Math.ceil((B.maxZ - B.minZ) / FIELD_CELL) + 1;
    this.dist = new Uint16Array(this.nx * this.nz).fill(FAR);
    this.goal = -2;
    this.wait = 0;
    this.buckets = [[], [], [], []];
    this.build(); // while the game loads, not in the middle of a fight
  }

  /** Mark the cells that buildings, walls and anything else too tall to step over stand on */
  build() {
    const { nx, nz } = this, b = (this.blocked = new Uint8Array(nx * nz)), pad = 0.5;
    for (const c of this.world.colliders) {
      // Rooftop props and walkways don't block the street; riftlings hop low walls
      if (c.walk || c.prop || c.min.y > 1.2 || c.max.y < (c.low ? 2.5 : 0.8)) continue;
      const i0 = Math.max(0, Math.floor((c.min.x - pad - this.x0) / FIELD_CELL)), i1 = Math.min(nx - 1, Math.floor((c.max.x + pad - this.x0) / FIELD_CELL));
      const j0 = Math.max(0, Math.floor((c.min.z - pad - this.z0) / FIELD_CELL)), j1 = Math.min(nz - 1, Math.floor((c.max.z + pad - this.z0) / FIELD_CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) b[j * nx + i] = 1;
    }
  }

  cellOf(x, z) {
    const i = Math.floor((x - this.x0) / FIELD_CELL), j = Math.floor((z - this.z0) / FIELD_CELL);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }

  /** Search again if the mech has moved to another cell (at most a few times a second) */
  update(pos, dt) {
    this.wait -= dt;
    const g = this.cellOf(pos.x, pos.z);
    if (g === this.goal || this.wait > 0) return;
    this.goal = g;
    this.wait = 0.6;
    const { nx, nz, blocked: b, dist: d, buckets: Q } = this;
    d.fill(FAR);
    for (const q of Q) q.length = 0;
    if (g < 0) return;
    // The mech up on a roof (or in a building): start from the nearest street round it
    let pending = 0;
    const gi = g % nx, gj = (g - gi) / nx;
    for (let r = 0; r < 25 && !pending; r++) {
      for (let j = gj - r; j <= gj + r; j++) {
        for (let i = gi - r; i <= gi + r; i++) {
          if (Math.max(Math.abs(i - gi), Math.abs(j - gj)) !== r || i < 0 || j < 0 || i >= nx || j >= nz || b[j * nx + i]) continue;
          d[j * nx + i] = 0;
          Q[0].push(j * nx + i);
          pending++;
        }
      }
    }
    for (let cur = 0; pending > 0 && cur <= FIELD_REACH; cur++) {
      const q = Q[cur & 3];
      for (let n = 0; n < q.length; n++) {
        const k = q[n];
        pending--;
        if (d[k] !== cur) continue;
        const i = k % nx, j = (k - i) / nx;
        for (const [di, dj, cost] of STEPS) {
          const a = i + di, c = j + dj;
          if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
          const m = c * nx + a;
          // No cutting corners past a building
          if (b[m] || (cost === 3 && (b[j * nx + a] || b[c * nx + i]))) continue;
          if (cur + cost < d[m]) {
            d[m] = cur + cost;
            Q[(cur + cost) & 3].push(m);
            pending++;
          }
        }
      }
      q.length = 0;
    }
  }

  /** How far (x, z) is from the mech by street, in units; Infinity where the field doesn't reach */
  along(x, z) {
    const k = this.cellOf(x, z);
    return k < 0 || this.dist[k] === FAR ? Infinity : (this.dist[k] * FIELD_CELL) / 2;
  }

  /** The way to go from (x, z): toward a cell a few steps down the field. False where the field doesn't reach. */
  dir(x, z, out) {
    const { nx, nz, dist: d, blocked: b } = this;
    let k = this.cellOf(x, z);
    if (k < 0) return false;
    const start = k;
    for (let s = 0; s < 4; s++) {
      const i = k % nx, j = (k - i) / nx;
      let best = k, bd = d[k];
      for (const [di, dj, cost] of STEPS) {
        const a = i + di, c = j + dj;
        if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
        const m = c * nx + a;
        if (cost === 3 && (b[j * nx + a] || b[c * nx + i]) && d[k] !== FAR) continue;
        if (d[m] < bd) { bd = d[m]; best = m; }
      }
      if (best === k) break;
      k = best;
    }
    if (k === start || d[k] === FAR) return false;
    const i = k % nx;
    out.set(this.x0 + (i + 0.5) * FIELD_CELL - x, 0, this.z0 + ((k - i) / nx + 0.5) * FIELD_CELL - z);
    const L = out.length();
    if (L < 1e-3) return false;
    out.divideScalar(L);
    return true;
  }
}

/** A soft dark blob for the contact shadow under each one (the posed mesh casts none) */
function blobTexture() {
  return canvasTexture(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(0,0,0,0.55)');
    r.addColorStop(0.6, 'rgba(0,0,0,0.3)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  }, false);
}

// ---------------------------------------------------------------------------
// The horde, run by the swarm (js/spiders.js) in the same waves
// ---------------------------------------------------------------------------

export class RiftlingHorde {
  constructor(swarm, { scene, mobile = false }) {
    this.sw = swarm;
    this.world = swarm.world;
    this.fx = swarm.fx;
    this.sound = swarm.sound;
    // Game units per model meter for a riftling of the standard size
    this.k = (HEIGHT_M / MODEL_M) * swarm.world.M;
    this.rig = createRiftlingSwarm(THREE, { capacity: SLOTS, metersPerUnit: 1 / swarm.world.M, lod: mobile ? 'low' : 'full' });
    this.mesh = this.rig.mesh;
    for (let i = 0; i < SLOTS; i++) this.mesh.setMatrixAt(i, ZERO);
    this.rig.setCount(0);
    scene.add(this.mesh);
    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: blobTexture(), color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }), SLOTS);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.shadows.count = 0;
    scene.add(this.shadows);

    this.field = new FlowField(swarm.world);
    this.list = [];
    this.packs = [];
    this.slots = new Array(SLOTS).fill(null);
    this.free = [];
    for (let i = SLOTS - 1; i >= 0; i--) this.free.push(i);
    this.budget = 0;    // riftlings still to come this wave
    this.packT = 0;
    this.fails = 0;
    this.wave = 0;
    this.time = 0;
    this.alertT = -99;
    this.steps = 0;
    this.camFwd = new V3(0, 0, -1);
    this.P = null;
  }

  get alive() { return this.list.reduce((n, r) => n + (r.alive ? 1 : 0), 0); }
  get hostiles() { return this.alive + this.budget; }
  /** Nothing of this wave's swarm left to come or to kill */
  get done() { return this.budget <= 0 && this.alive === 0; }

  /** Names of the packs that join the fight on wave n, for the wave banner */
  joining(n) { return Object.values(RIFT_PACKS).filter((v) => v.from === n).map((v) => `${v.name}S`); }

  /** Wave n's swarm grows by a dozen a wave to a hundred; the millipede's waves bring half */
  startWave(n, half) {
    this.wave = n;
    this.budget = Math.round(Math.min(CAP, 4 + 12 * n) * (half ? 0.5 : 1));
    this.packT = 2.5;
    this.fails = 0;
  }

  clear() {
    for (const r of [...this.list]) this.remove(r);
    this.packs.length = 0;
    this.budget = 0;
  }

  // ---- spawning ------------------------------------------------------------------------

  spawning(dt, ctx) {
    if (this.budget <= 0 || (this.packT -= dt) > 0) return;
    const id = this.pickPack(), v = RIFT_PACKS[id];
    const n = Math.min(this.budget, CAP - this.alive, Math.round(rand(v.size[0], v.size[1])));
    // Wait for room for a proper pack (the wave's last one can be smaller)
    if (n < Math.min(4, this.budget)) { this.packT = 0.5; return; }
    const made = this.spawnPack(id, n, ctx);
    if (made) { this.budget -= made; this.fails = 0; }
    else if (++this.fails > 8) { this.budget -= n; this.fails = 0; } // nowhere to come from: let this pack go
    // The swarm comes as one surge: pack after pack, from all round, a second or two apart
    this.packT = made ? rand(0.8, 2) : 0.5;
  }

  pickPack() {
    const open = Object.values(RIFT_PACKS).filter((v) => v.from <= Math.max(1, this.wave));
    let r = Math.random() * open.reduce((t, v) => t + v.weight, 0);
    for (const v of open) if ((r -= v.weight) <= 0) return v.id;
    return open[0].id;
  }

  /** A pack of n of kind id, out of the mech's sight. Returns how many came. */
  spawnPack(id, n, ctx) {
    const v = RIFT_PACKS[id], P = ctx.player.pos, cam = ctx.camera;
    const inView = (p) => {
      _e.copy(p).project(cam);
      return _e.z < 1 && Math.abs(_e.x) < 1.15 && Math.abs(_e.y) < 1.15 && p.distanceTo(P) < 180;
    };
    // Spires come over the rooftops; the rest up the streets
    const roof = v.climber ? this.findRoof(P, 60, 160, inView) : null;
    const at = roof ? roof.point : this.findStreet(P, 85, 210, inView, 30) || this.findStreet(P, 140, 260, null, 20);
    if (!at) return 0;
    const pk = { v, members: [], live: [], leader: null, state: 'muster', t: 0, timer: v.shade ? rand(0.3, 0.6) : rand(1.3, 1.8), center: at.clone(), ringN: 0, close: 0 };
    for (let i = 0; i < n; i++) {
      let p = at;
      if (i && roof) {
        const c = roof.collider, m = 1.2;
        p = _p.set(clamp(at.x + rand(-7, 7), c.min.x + m, c.max.x - m), at.y, clamp(at.z + rand(-7, 7), c.min.z + m, c.max.z - m));
      } else if (i) p = this.findStreet(at, 1.5, 10, null, 5) || _p.set(at.x + rand(-2, 2), at.y, at.z + rand(-2, 2));
      if (!this.spawn(p, pk, i === 0)) break;
    }
    if (!pk.members.length) return 0;
    pk.leader = pk.members[0];
    this.packs.push(pk);
    // The leader screams the pack on; Shades only hiss
    if (v.shade) this.sound.riftHiss(at);
    else {
      this.anim(pk.leader, 'screaming', 1, 0);
      this.sound.riftScream(at);
    }
    return pk.members.length;
  }

  /** Open street between rMin and rMax from center, clear of buildings */
  findStreet(center, rMin, rMax, avoidView, tries) {
    const B = this.world.bounds;
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, d = rand(rMin, rMax);
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      if (x < B.minX + 6 || x > B.maxX - 6 || z < B.minZ + 6 || z > B.maxZ - 6) continue;
      const hit = this.sw.ray(_a.set(x, 400, z), DOWN, 420);
      if (!hit || hit.normal.y < 0.9 || hit.point.y > 1.2 || (hit.collider && !hit.collider.low)) continue;
      if (avoidView && avoidView(hit.point)) continue;
      // Not in or up against a building (a ray down from inside one misses its roof)
      if (this.world.resolve(_b.copy(hit.point), 1.2, 2, hit.point.y)) continue;
      return hit.point.clone();
    }
    return null;
  }

  /** A roof of middling height between rMin and rMax away, with nothing taller over the spot */
  findRoof(center, rMin, rMax, avoidView) {
    const near = this.sw.buildings.filter((c) => {
      const d = Math.hypot((c.min.x + c.max.x) / 2 - center.x, (c.min.z + c.max.z) / 2 - center.z);
      return d > rMin && d < rMax && c.max.y > 8 && c.max.y < 50 && c.max.x - c.min.x > 6 && c.max.z - c.min.z > 6;
    });
    for (let i = 0; i < 16 && near.length; i++) {
      const c = near[Math.floor(Math.random() * near.length)];
      const p = _p.set(rand(c.min.x + 2, c.max.x - 2), c.max.y, rand(c.min.z + 2, c.max.z - 2));
      const hit = this.sw.ray(_a.set(p.x, c.max.y + 40, p.z), DOWN, 45);
      if (!hit || hit.collider !== c || Math.abs(hit.point.y - c.max.y) > 0.3) continue;
      if (avoidView && avoidView(p)) continue;
      return { point: p.clone(), collider: c };
    }
    return null;
  }

  spawn(at, pk, lead = false) {
    if (!this.free.length) this.evict();
    if (!this.free.length) return null;
    const v = pk.v, slot = this.free.pop();
    // A little variety in size; the leader stands taller
    const scale = rand(0.94, 1.06) * (v.bulk || 1) * (lead ? 1.12 : 1);
    const r = {
      kind: 'riftling', name: v.name, v, pack: pk, slot, alive: true, removed: false, boss: false, stealth: !!v.shade,
      feet: at.clone(), pos: new V3(), vel: new V3(), fwd: new V3(), sep: new V3(),
      scale, k: this.k * scale, body: BODY * this.k * scale, radius: HIT * this.k * scale,
      hp: v.hp * scale, maxHp: v.hp * scale, state: 'muster', timer: 0, t: 0,
      wallN: new V3(), wallT: 0, slide: Math.random() < 0.5 ? -1 : 1, best: Infinity, stuckT: 0, lostT: 0, detour: new V3(), detourT: 0,
      climbN: new V3(), cling: new V3(), climbY0: 0, fallY: 0, groundY: at.y, latch: null, slotA: 0, ready: false,
      fl: { vel: new V3(), from: new V3(), t: 0, T: 1 },
      cool: { leap: rand(0.2, 0.8), dodge: rand(0.5, 1.5), step: 0 },
      clip: null, cs: 1, clipAt: 0, flash: 0, glow: v.shade ? 0.18 : 1, deadT: 0, boomT: 0, rest: false,
      base: new THREE.Color(RIFTLING_COLORS[v.id]).multiplyScalar(rand(0.85, 1.1) * (lead ? 1.2 : 1)),
    };
    r.hit = (amount, point) => this.hurt(r, amount, point);
    // Facing the mech
    if (this.P) r.fwd.set(this.P.pos.x - at.x, 0, this.P.pos.z - at.z);
    if (r.fwd.lengthSq() < 1e-6) r.fwd.set(0, 0, 1);
    r.fwd.normalize();
    this.center(r, r.pos);
    this.slots[slot] = r;
    this.list.push(r);
    pk.members.push(r);
    this.world.targets.push(r);
    this.anim(r, 'idle');
    this.resize();
    return r;
  }

  /** No slot free: the longest dead goes first */
  evict() {
    let old = null;
    for (const r of this.list) if (r.state === 'dead' && (!old || r.deadT > old.deadT)) old = r;
    if (old) this.remove(old);
  }

  remove(r) {
    if (r.removed) return;
    r.removed = true;
    r.alive = false;
    this.untarget(r);
    const i = this.list.indexOf(r);
    if (i >= 0) this.list.splice(i, 1);
    const k = r.pack.members.indexOf(r);
    if (k >= 0) r.pack.members.splice(k, 1);
    this.mesh.setMatrixAt(r.slot, ZERO);
    this.shadows.setMatrixAt(r.slot, ZERO);
    this.slots[r.slot] = null;
    this.free.push(r.slot);
    this.resize();
  }

  untarget(r) {
    const t = this.world.targets.indexOf(r);
    if (t >= 0) this.world.targets.splice(t, 1);
  }

  /** Only draw instances up to the highest slot in use */
  resize() {
    let top = 0;
    for (let i = SLOTS - 1; i >= 0; i--) if (this.slots[i]) { top = i + 1; break; }
    this.rig.setCount(top);
    this.shadows.count = top;
  }

  // ---- animation ------------------------------------------------------------------------

  /** Play a clip; asked again for the clip it's already playing, only the speed changes (keeping its place) */
  anim(r, clip, speed = 1, phase) {
    const c = RIFTLING_CLIPS[clip];
    if (r.clip === clip && phase === undefined && Math.abs(r.cs - speed) < speed * 0.12) return;
    if (phase === undefined) phase = r.clip === clip ? this.phaseOf(r) : c.loop ? Math.random() : 0;
    this.rig.play(r.slot, clip, { speed, phase });
    r.clip = clip;
    r.cs = speed;
    r.clipAt = this.time - phase * c.duration / speed;
  }

  /** How far through its clip it is, 0 to 1 */
  phaseOf(r) {
    const c = RIFTLING_CLIPS[r.clip], u = (this.time - r.clipAt) * r.cs / c.duration;
    return c.loop ? u - Math.floor(u) : Math.min(1, u);
  }

  /** Locomotion clip to match its speed over the ground */
  runAnim(r) {
    const sp = Math.hypot(r.vel.x, r.vel.z);
    if (sp > 5) this.anim(r, 'running', clamp(sp / 9, 0.7, 2.2));
    else if (sp > 0.8) this.anim(r, 'walking', clamp(sp / 2.5, 0.6, 1.8));
    else this.anim(r, 'idle');
    // A patter of claws on the street from the ones close by
    if (sp > 5 && this.steps < 2 && r.cool.step <= 0 && this.sw.camPos && r.feet.distanceToSquared(this.sw.camPos) < 45 * 45) {
      this.steps++;
      r.cool.step = rand(0.12, 0.25);
      this.sound.riftStep(r.feet);
    }
  }

  // ---- per frame --------------------------------------------------------------------------

  /** ctx: { player: { pos, vel, chest, alive, bodyYaw }, camera } */
  update(dt, ctx) {
    const P = (this.P = ctx.player);
    this.ctx = ctx;
    this.time = this.sw.time;
    this.dt = dt;
    this.rig.update(this.time); // before anything starts a clip this frame
    this.steps = 0;
    ctx.camera.getWorldDirection(this.camFwd);
    this.spawning(dt, ctx);
    if (this.list.length) this.field.update(P.pos, dt);
    for (const pk of [...this.packs]) this.thinkPack(pk, dt, P);
    this.spread();
    for (const r of [...this.list]) {
      if (r.removed) continue;
      this.step(r, dt, P, ctx);
      if (!r.removed) this.render(r);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** Pack-level decisions: when the muster ends, and the Shades' ring and pounce */
  thinkPack(pk, dt, P) {
    const live = (pk.live = pk.members.filter((m) => m.alive));
    if (!live.length) {
      if (!pk.members.length) this.packs.splice(this.packs.indexOf(pk), 1);
      return;
    }
    if (!pk.leader.alive) pk.leader = live[0];
    pk.t += dt;
    let n = 0;
    pk.center.set(0, 0, 0);
    for (const m of live) if (GROUND[m.state]) { pk.center.add(m.feet); n++; }
    if (n) pk.center.divideScalar(n);
    switch (pk.state) {
      case 'muster':
        if ((pk.timer -= dt) > 0) break;
        pk.state = pk.v.shade ? 'stalk' : 'hunt';
        pk.t = 0;
        for (const m of live) if (m.state === 'muster') this.go(m, pk.v.shade ? 'stalk' : 'run');
        break;
      case 'stalk': {
        if (live.length !== pk.ringN) this.ring(pk, live, P);
        const ready = live.reduce((k, m) => k + (m.ready ? 1 : 0), 0);
        // How long most of them have been close: they don't wait forever for the stragglers
        const near = live.reduce((k, m) => k + (m.feet.distanceTo(P.pos) < pk.v.ring * 2.2 ? 1 : 0), 0);
        if (near * 2 >= live.length) pk.close += dt;
        if (P.alive && (ready >= Math.ceil(live.length * 0.75) || pk.close > 6 || pk.t > 30)) {
          // The leader screams and every one of them lights up
          pk.state = 'signal';
          pk.timer = 0.9;
          if (GROUND[pk.leader.state]) this.anim(pk.leader, 'screaming', 1.3, 0);
          this.sound.riftScream(pk.leader.pos, 1.15);
          for (const m of live) m.stealth = false;
        }
        break;
      }
      case 'signal':
        if ((pk.timer -= dt) > 0) break;
        pk.state = 'hunt';
        for (const m of live) {
          m.stealth = false;
          m.ready = false;
          if (m.state !== 'stalk' && m.state !== 'dodge' && m.state !== 'hit') continue;
          if (!this.pounce(m, P, true)) this.go(m, 'run');
        }
        break;
    }
  }

  /** Shades: a place for each on a ring round the mech, the nearest places to the ones on that side */
  ring(pk, live, P) {
    const base = Math.atan2(pk.center.x - P.pos.x, pk.center.z - P.pos.z), N = live.length;
    const order = live.map((m) => [m, wrap(Math.atan2(m.feet.x - P.pos.x, m.feet.z - P.pos.z) - base)]).sort((a, b) => a[1] - b[1]);
    order.forEach(([m], j) => { m.slotA = base - Math.PI + (2 * Math.PI * (j + 0.5)) / N; });
    pk.ringN = N;
  }

  /** A push apart for each one on the ground from the others close to it, applied as it moves */
  spread() {
    const L = this.list;
    for (const r of L) r.sep.set(0, 0, 0);
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.alive || !GROUND[a.state]) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (!b.alive || !GROUND[b.state]) continue;
        // Blasts pack in tight; the rest keep a body's width apart
        const want = (a.body + b.body) * (a.v.clump && b.v === a.v ? 1.2 : 1.6);
        const dx = b.feet.x - a.feet.x, dz = b.feet.z - a.feet.z;
        if (Math.abs(dx) > want || Math.abs(dz) > want || Math.abs(b.feet.y - a.feet.y) > 1.5) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 > want * want) continue;
        const d = Math.sqrt(d2), push = (want - d) / want;
        const ux = d > 1e-3 ? dx / d : Math.random() - 0.5, uz = d > 1e-3 ? dz / d : Math.random() - 0.5;
        a.sep.x -= ux * push; a.sep.z -= uz * push;
        b.sep.x += ux * push; b.sep.z += uz * push;
      }
    }
  }

  step(r, dt, P, ctx) {
    r.t += dt;
    r.flash = Math.max(0, r.flash - dt * 5);
    for (const k in r.cool) r.cool[k] -= dt;
    r.wallT -= dt;
    switch (r.state) {
      case 'dead': this.corpse(r, dt); return;
      case 'muster': this.muster(r, dt, P); break;
      case 'run': this.hunt(r, dt, P); break;
      case 'stalk': this.stalk(r, dt, P, ctx); break;
      case 'dodge':
        r.timer -= dt;
        r.vel.multiplyScalar(Math.exp(-2.5 * dt));
        this.move(r, dt, P);
        if (r.timer <= 0 && r.state === 'dodge') this.resume(r);
        break;
      case 'hit':
        r.timer -= dt;
        this.slow(r, dt, P);
        if (r.timer <= 0 && r.state === 'hit') this.resume(r);
        break;
      case 'gloat': this.gloat(r, dt, P); break;
      case 'climb': this.climb(r, dt, P); break;
      case 'crouch':
        r.timer -= dt;
        if (r.timer <= 0) this.launch(r);
        break;
      case 'leap': this.flight(r, dt, P); break;
      case 'fall': this.fall(r, dt, P); break;
      case 'latch': this.cling(r, dt, P); break;
    }
    if (r.removed) return;
    this.center(r, r.pos);
    // One lost somewhere far off for a long time goes back into the wave's swarm, to come again
    if (r.alive && r.lostT > 25 && r.state !== 'latch' && r.feet.distanceTo(P.pos) > 70) {
      this.remove(r);
      this.budget++;
    }
  }

  /** Where it can be hit and locked onto: mid-body */
  center(r, out) {
    if (r.state === 'climb' || r.state === 'latch') return out.copy(r.cling).addScaledVector(UP, -HANG * r.k).addScaledVector(r.climbN, OUT * r.k);
    return out.copy(r.feet).addScaledVector(UP, CENTER * r.k);
  }

  go(r, state) {
    r.state = state;
    r.timer = state === 'gloat' ? rand(0.3, 1.5) : 0;
    r.best = Infinity;
    r.stuckT = 0;
  }

  /** A Shade whose pack is still closing in, waiting for the signal to pounce */
  waiting(r) {
    const s = r.pack.state;
    return r.v.shade && (s === 'muster' || s === 'stalk' || s === 'signal');
  }

  /** Back to what its pack is doing after a flinch, a dodge, a climb or a fall */
  resume(r) {
    this.go(r, !this.P.alive ? 'gloat' : this.waiting(r) ? 'stalk' : 'run');
  }

  slow(r, dt, P) {
    const k = Math.exp(-8 * dt);
    r.vel.x *= k; r.vel.z *= k;
    this.move(r, dt, P);
  }

  muster(r, dt, P) {
    _t.set(P.pos.x - r.feet.x, 0, P.pos.z - r.feet.z);
    if (_t.lengthSq() > 1) r.fwd.lerp(_t.normalize(), 1 - Math.exp(-4 * dt)).normalize();
    this.slow(r, dt, P);
  }

  /** Run at the mech and leap at it once in range */
  hunt(r, dt, P) {
    const f = r.feet, v = r.v;
    const dx = P.pos.x - f.x, dz = P.pos.z - f.z, dist = Math.hypot(dx, dz);
    // The mech is down: gather round the wreck
    if (!P.alive && dist < 10) { this.go(r, 'gloat'); return; }
    if (P.alive && r.cool.leap <= 0 && dist < Math.max(v.leap, v.high || 0)) {
      r.cool.leap = 0.25;
      if (this.pounce(r, P)) return;
    }
    // Head for it: by the streets while it's far, then straight at it, leading it a little
    const street = this.byStreet(r, dist, _t);
    if (!street) {
      const lead = Math.min(1.2, dist / v.run) * 0.6;
      _t.set(dx + P.vel.x * lead, 0, dz + P.vel.z * lead);
      const L = _t.length();
      if (L > 1e-3) _t.divideScalar(L); else _t.copy(r.fwd);
    }
    // Blasts keep together, trailing their leader in a clump
    if (v.clump && r !== r.pack.leader) {
      const cx = r.pack.center.x - f.x, cz = r.pack.center.z - f.z, cd = Math.hypot(cx, cz);
      if (cd > 2.5) _t.addScaledVector(_a.set(cx / cd, 0, cz / cd), Math.min(1, (cd - 2.5) / 4) * 0.9).normalize();
    }
    this.progress(r, street ? Math.min(this.field.along(f.x, f.z), dist * 4) : dist, dt, P);
    this.travel(r, dt, _t, v.run * (dist < 6 ? 0.5 : 1), P);
    if (r.state === 'run') this.runAnim(r);
  }

  /**
   * The way to the mech through the streets (the flow field), for one in the street more than
   * a leap or two away. Spires take no notice: they go over the buildings.
   */
  byStreet(r, dist, out) {
    if (r.v.climber || dist < 26 || r.feet.y > 1.5 || r.detourT > 0) return false;
    return this.field.dir(r.feet.x, r.feet.z, out);
  }

  /** Track whether it's getting any closer; stuck, it climbs what it's up against or tries another way */
  progress(r, dist, dt, P) {
    if (dist < r.best - 1) { r.best = dist; r.stuckT = 0; r.lostT = 0; return; }
    r.lostT += dt;
    if ((r.stuckT += dt) < 2.5) return;
    r.stuckT = 0;
    r.best = dist;
    if (r.wallT > 0 && this.tryClimb(r, P, true)) return;
    const a = Math.atan2(P.pos.x - r.feet.x, P.pos.z - r.feet.z) + (Math.random() < 0.5 ? -1 : 1) * rand(1, 2);
    r.detour.set(Math.sin(a), 0, Math.cos(a));
    r.detourT = rand(1, 2);
    r.slide = -r.slide;
  }

  /** Shades: spread round the mech at the ring, keeping low, and duck out of its sights */
  stalk(r, dt, P, ctx) {
    const pk = r.pack, v = r.v;
    if (!P.alive || pk.state === 'hunt') { this.go(r, P.alive ? 'run' : 'gloat'); return; }
    if (r.cool.dodge <= 0 && this.inSights(r, ctx.camera)) { this.dodge(r); return; }
    const R = v.ring, f = r.feet;
    const dx = f.x - P.pos.x, dz = f.z - P.pos.z, dist = Math.hypot(dx, dz) || 1e-3;
    const off = wrap(r.slotA - Math.atan2(dx, dz));
    let speed, gone = dist + Math.abs(off) * R;
    if (dist > R * 2.2 && this.byStreet(r, dist, _t)) {
      // Still far off: come by the streets
      r.ready = false;
      speed = dist > 60 ? v.run * 0.85 : v.stalk;
      gone = Math.min(this.field.along(f.x, f.z), dist * 4);
    } else if (dist > R * 1.7 || Math.abs(off) < 0.45) {
      // Make for its place on the ring
      _t.set(P.pos.x + Math.sin(r.slotA) * R - f.x, 0, P.pos.z + Math.cos(r.slotA) * R - f.z);
      const gap = _t.length();
      r.ready = gap < 3.5;
      speed = dist > 60 ? v.run * 0.85 : r.ready ? Math.min(3, gap * 1.5) : v.stalk;
      if (gap > 1e-3) _t.divideScalar(gap); else _t.copy(r.fwd);
    } else {
      // Circle round to it, holding the ring's radius
      const s = Math.sign(off);
      _t.set((dz / dist) * s, 0, (-dx / dist) * s).addScaledVector(_a.set(dx / dist, 0, dz / dist), clamp(((R - dist) / R) * 2, -1, 1)).normalize();
      r.ready = false;
      speed = v.stalk * 1.3;
    }
    this.progress(r, r.ready ? 0 : gone, dt, P);
    this.travel(r, dt, _t, speed, P);
    if (r.state !== 'stalk') return;
    if (r.ready) {
      // In place: face the mech, crouched to spring
      _a.set(-dx, 0, -dz).normalize();
      r.fwd.lerp(_a, 1 - Math.exp(-6 * dt)).normalize();
      this.anim(r, 'crawling', 0.5);
    } else this.anim(r, 'stalking', clamp(Math.hypot(r.vel.x, r.vel.z) / 3.5, 0.6, 2.4));
  }

  /** In the line of the mech's sights (the camera's center ray), near enough to see it coming */
  inSights(r, cam) {
    _a.subVectors(r.pos, cam.position);
    const along = _a.dot(this.camFwd);
    if (along < 5 || along > 140) return false;
    return _a.addScaledVector(this.camFwd, -along).lengthSq() < 2.6 * 2.6;
  }

  /** A sideways spring out of the line of fire, the way the dodge clip throws its body (to its right) */
  dodge(r) {
    r.state = 'dodge';
    r.timer = 0.5;
    r.cool.dodge = rand(1.4, 2.6);
    r.vel.set(-r.fwd.z * 13, 0, r.fwd.x * 13);
    this.anim(r, 'dodging', 1, 0);
    this.sound.riftHiss(r.pos, 0.6);
  }

  /** Around the wreck of the mech: screams and lashes */
  gloat(r, dt, P) {
    const f = r.feet;
    _t.set(P.pos.x - f.x, 0, P.pos.z - f.z);
    const d = _t.length();
    if (P.alive || d > 16) { this.go(r, 'run'); return; }
    if (d > 1e-3) r.fwd.lerp(_t.divideScalar(d), 1 - Math.exp(-3 * dt)).normalize();
    this.slow(r, dt, P);
    if ((r.timer -= dt) <= 0) {
      r.timer = rand(1.8, 3.5);
      const pick = ['idle', 'screaming', 'tailwhip', 'idle', 'stalking'][Math.floor(Math.random() * 5)];
      this.anim(r, pick, pick === 'stalking' ? 0.3 : 1, 0);
      if (pick === 'screaming') this.sound.riftScream(r.pos, 0.6);
    }
  }

  // ---- getting about ------------------------------------------------------------------------

  /** Run along the ground (a street or a roof) toward dir at speed: walls, edges, the mech's legs */
  travel(r, dt, dir, speed, P) {
    // Up against a wall: slide along it rather than into it
    if (r.wallT > 0) {
      const into = dir.x * r.wallN.x + dir.z * r.wallN.z;
      if (into < 0) {
        _w.set(dir.x - r.wallN.x * into, 0, dir.z - r.wallN.z * into);
        if (_w.lengthSq() < 0.04) _w.set(-r.wallN.z * r.slide, 0, r.wallN.x * r.slide);
        dir = _w.normalize();
      }
    }
    if (r.detourT > 0) { r.detourT -= dt; dir = r.detour; }
    r.fwd.lerp(dir, 1 - Math.exp(-9 * dt));
    r.fwd.y = 0;
    if (r.fwd.lengthSq() < 1e-4) r.fwd.copy(dir);
    r.fwd.normalize();
    const k = 1 - Math.exp(-6 * dt);
    r.vel.x += (r.fwd.x * speed - r.vel.x) * k;
    r.vel.z += (r.fwd.z * speed - r.vel.z) * k;
    r.want = dir;
    this.move(r, dt, P);
  }

  move(r, dt, P) {
    const f = r.feet, W = this.world;
    f.x += (r.vel.x + r.sep.x * 7) * dt;
    f.z += (r.vel.z + r.sep.z * 7) * dt;
    const bx = f.x, bz = f.z;
    if (W.resolve(f, r.body, 1.3 * r.k, f.y)) {
      const nx = f.x - bx, nz = f.z - bz, n = Math.hypot(nx, nz);
      if (n > 1e-5) {
        const fresh = r.wallT <= 0;
        r.wallN.set(nx / n, 0, nz / n);
        r.wallT = 0.35;
        const into = r.vel.x * r.wallN.x + r.vel.z * r.wallN.z;
        if (into < 0) { r.vel.x -= r.wallN.x * into; r.vel.z -= r.wallN.z * into; }
        // Which way to slide when it meets the wall head-on: the way it was already leaning
        if (fresh && r.want) r.slide = r.want.x * -r.wallN.z + r.want.z * r.wallN.x >= 0 ? 1 : -1;
        // Up and over, if this wall is one to climb
        if (r.state === 'run' && r.fwd.x * r.wallN.x + r.fwd.z * r.wallN.z < -0.55 && this.tryClimb(r, P)) return;
      }
    }
    // Not through the mech's legs
    if (P.alive && f.y < P.pos.y + 6 && f.y > P.pos.y - 1.5) {
      const dx = f.x - P.pos.x, dz = f.z - P.pos.z, d = Math.hypot(dx, dz), R = 1.6 + r.body;
      if (d < R && d > 1e-4) { f.x = P.pos.x + (dx / d) * R; f.z = P.pos.z + (dz / d) * R; }
    }
    // The ground under it: up curbs and onto cars, off the edges of roofs
    const g = W.groundHeight(f.x, f.z, f.y, 0.3 * r.scale);
    if (g < f.y - 0.25) {
      // Off the edge of a roof: a Spire leaps the street to the next one if it can
      if (!(r.v.climber && r.state === 'run' && this.bound(r))) this.startFall(r);
      return;
    }
    f.y = g;
    r.groundY = g;
  }

  startFall(r) {
    r.state = 'fall';
    r.vel.y = 0;
    r.fallY = r.feet.y;
    this.anim(r, 'leaping', 0.001, 0.42);
  }

  /** Climb the wall it's against? Low ones always; the mech's own roof; tall ones only when stuck; all but the towers, for a Spire */
  tryClimb(r, P, stuck = false) {
    const f = r.feet;
    const hit = this.sw.ray(_c.set(f.x, f.y + 0.6 * r.k, f.z), _d.set(-r.wallN.x, 0, -r.wallN.z), r.body + 1.2);
    if (!hit || Math.abs(hit.normal.y) > 0.3) return false;
    const top = hit.collider ? hit.collider.max.y : hit.struct ? hit.struct.box.max.y : f.y + 200;
    const rise = top - f.y;
    const toMech = P.alive && P.pos.y > f.y + 3 && Math.abs(top - P.pos.y) < 8 && Math.hypot(P.pos.x - f.x, P.pos.z - f.z) < 80;
    if (!(r.v.climber ? rise < 45 || toMech : rise < 12 || toMech || (stuck && rise < 45))) return false;
    this.startClimb(r, hit, f.y + HEAD * r.k);
    return true;
  }

  /** Onto the wall the ray hit, head up at height y: the clip's climbing pose turned head up, belly to the wall */
  startClimb(r, hit, y) {
    r.state = 'climb';
    r.climbN.set(hit.normal.x, 0, hit.normal.z).normalize();
    r.cling.set(hit.point.x, y, hit.point.z);
    r.climbY0 = y;
    r.vel.set(0, r.v.climb || 7, 0);
    r.lostT = 0;
    this.anim(r, 'climbing', (r.v.climb || 7) / 6);
  }

  climb(r, dt, P) {
    const n = r.climbN, c = r.cling;
    c.y += (r.v.climb || 7) * dt;
    // Wall still there in front of its head? Past the top, it pulls itself over onto the roof
    const hit = this.sw.ray(_c.copy(c).addScaledVector(n, 0.5), _d.copy(n).negate(), 1.1);
    if (!hit || Math.abs(hit.normal.y) > 0.5) { this.mantle(r); return; }
    c.x = hit.point.x;
    c.z = hit.point.z;
    n.set(hit.normal.x, 0, hit.normal.z).normalize();
    // Off the wall onto the mech, when it comes in reach (a Shade waits for its pack's signal)
    if (P.alive && r.cool.leap <= 0 && !this.waiting(r)) {
      r.cool.leap = 0.3;
      if (this.pounce(r, P)) return;
    }
    if (c.y - r.climbY0 > 100) {
      r.feet.copy(c).addScaledVector(UP, -HEAD * r.k).addScaledVector(n, 0.6);
      r.vel.copy(n).multiplyScalar(3);
      this.startFall(r);
    }
  }

  mantle(r) {
    const c = r.cling, n = r.climbN, f = r.feet;
    f.set(c.x - n.x * (r.body + 0.9), c.y, c.z - n.z * (r.body + 0.9));
    r.fwd.set(-n.x, 0, -n.z);
    r.vel.set(r.fwd.x * 4, 0, r.fwd.z * 4);
    const g = this.world.groundHeight(f.x, f.z, c.y + 0.4, 0.3);
    r.best = Infinity;
    if (g > c.y - 2.5) { f.y = g; this.resume(r); } else this.startFall(r);
  }

  /** Leap at the mech if it's in range and in sight. sync: on its pack's signal. */
  pounce(r, P, sync = false) {
    const v = r.v, on = r.state === 'climb';
    const base = on ? r.cling : r.feet;
    const dh = Math.hypot(P.pos.x - base.x, P.pos.z - base.z);
    const high = on || base.y > P.pos.y + 4;
    if (dh > (high && v.high ? v.high : v.leap)) return false;
    if (P.chest.y - base.y > v.reach) return false;
    if (!this.sw.clearLine(this.center(r, _c), P.chest)) return false;
    this.startLeap(r, P, sync);
    return true;
  }

  /** At a spot on the hull facing it, somewhere from the hips to the shoulders, leading the mech */
  startLeap(r, P, sync) {
    const from = this.center(r, _b);
    const a = Math.atan2(from.x - P.pos.x, from.z - P.pos.z) + rand(-0.4, 0.4);
    const tgt = _t.set(P.pos.x + Math.sin(a) * 0.9, P.pos.y + rand(2.6, 5.6), P.pos.z + Math.cos(a) * 0.9);
    const T = clamp(from.distanceTo(tgt) / LEAP_SPEED, 0.32, 1.5);
    tgt.addScaledVector(P.vel, T * 0.8);
    this.spring(r, tgt, T, sync);
  }

  /** A Spire at a roof's edge: the next roof ahead within a leap, with nothing taller across the gap */
  bound(r) {
    const f = r.feet;
    if (f.y < 4) return false;
    for (const d of [9, 15, 21, 27]) {
      const x = f.x + r.fwd.x * d, z = f.z + r.fwd.z * d;
      const hit = this.sw.ray(_c.set(x, f.y + 10, z), DOWN, 20);
      if (!hit || hit.normal.y < 0.9 || hit.point.y < f.y - 10) continue;
      _d.set(x - f.x, hit.point.y - f.y, z - f.z);
      const L = _d.length();
      if (this.sw.ray(_e.set(f.x, f.y + 2.5, f.z), _d.divideScalar(L), L)) continue;
      this.spring(r, _t.copy(hit.point).addScaledVector(UP, CENTER * r.k), clamp(d / 22, 0.45, 1.2), false);
      return true;
    }
    return false;
  }

  /** Crouch, then spring along the arc that carries its middle to tgt in T seconds. sync: on its pack's signal. */
  spring(r, tgt, T, sync) {
    const from = this.center(r, r.fl.from);
    // Off a wall it turns to face the way it springs
    if (r.state === 'climb') r.feet.copy(from).addScaledVector(UP, -CENTER * r.k);
    r.fl.vel.subVectors(tgt, from).divideScalar(T);
    r.fl.vel.y += 0.5 * GRAVITY * T;
    r.fl.T = T;
    r.fl.t = 0;
    r.fwd.set(r.fl.vel.x, 0, r.fl.vel.z);
    if (r.fwd.lengthSq() < 1e-4) r.fwd.set(this.P.pos.x - from.x, 0, this.P.pos.z - from.z);
    if (r.fwd.lengthSq() < 1e-4) r.fwd.set(0, 0, 1);
    r.fwd.normalize();
    r.vel.set(0, 0, 0);
    r.state = 'crouch';
    r.timer = sync ? 0.12 : 0.16;
    r.lostT = 0;
    // The clip's crouch covers its first eighth; the flight takes the rest of it
    this.anim(r, 'leaping', (0.12 * RIFTLING_CLIPS.leaping.duration) / r.timer, 0);
    r.cool.leap = rand(0.8, 1.4);
    this.sound.riftLeap(from);
  }

  launch(r) {
    r.state = 'leap';
    r.vel.copy(r.fl.vel);
    r.feet.copy(r.fl.from).addScaledVector(UP, -CENTER * r.k);
    r.fallY = r.feet.y;
    this.anim(r, 'leaping', (0.76 * RIFTLING_CLIPS.leaping.duration) / r.fl.T, 0.12);
    if (r.feet.y - r.groundY < 0.5) this.fx.dust(r.feet, 0.25 * r.scale, 4);
  }

  flight(r, dt, P) {
    const fl = r.fl, f = r.feet;
    fl.t += dt;
    r.vel.y -= GRAVITY * dt;
    const c = this.center(r, _c);
    if (P.alive && capsuleDist(c, P.pos) < HULL + r.body) { this.grab(r, P); return; }
    const sp = r.vel.length();
    _d.copy(r.vel).divideScalar(sp || 1);
    const hit = fl.t > 0.05 ? this.sw.ray(c, _d, sp * dt + r.body) : null;
    if (hit) { this.touchDown(r, hit); return; }
    f.addScaledVector(r.vel, dt);
    if (r.vel.x * r.vel.x + r.vel.z * r.vel.z > 1) r.fwd.set(r.vel.x, 0, r.vel.z).normalize();
    if (f.y < this.world.city.L.water - 6) { this.remove(r); return; }
    if (r.vel.y < 0) {
      const g = this.world.groundHeight(f.x, f.z, f.y + 0.4, 0.3);
      if (f.y <= g) { f.y = g; this.landed(r); }
    }
  }

  /** A leap that missed came down on something: a street or roof, or a wall it slams into (and a Spire grabs) */
  touchDown(r, hit) {
    if (hit.normal.y > 0.6) {
      r.feet.copy(hit.point);
      this.landed(r);
    } else if (r.v.climber && Math.abs(hit.normal.y) < 0.3) {
      this.startClimb(r, hit, hit.point.y + (HEAD - CENTER) * r.k);
    } else {
      r.vel.set(hit.normal.x * 3, Math.min(0, r.vel.y), hit.normal.z * 3);
      r.feet.addScaledVector(hit.normal, 0.3);
      this.startFall(r);
    }
  }

  landed(r) {
    const drop = r.fallY - r.feet.y;
    r.vel.set(r.vel.x * 0.3, 0, r.vel.z * 0.3);
    r.groundY = r.feet.y;
    r.cool.leap = Math.max(r.cool.leap, rand(0.5, 1));
    this.fx.dust(r.feet, 0.3 * r.scale, 4);
    if (drop > 12) {
      // A long drop: it lands hard and shakes it off
      r.state = 'hit';
      r.timer = 0.35;
      this.anim(r, 'hit', 1, 0);
      this.sound.riftLand(r.feet);
    } else this.resume(r);
  }

  fall(r, dt, P) {
    const f = r.feet, W = this.world;
    r.vel.y -= GRAVITY * dt;
    f.addScaledVector(r.vel, dt);
    const bx = f.x, bz = f.z;
    if (W.resolve(f, r.body, 1.3 * r.k, f.y)) {
      const nx = f.x - bx, nz = f.z - bz, n = Math.hypot(nx, nz);
      if (n > 1e-5) {
        const into = (r.vel.x * nx + r.vel.z * nz) / n;
        if (into < 0) { r.vel.x -= (nx / n) * into; r.vel.z -= (nz / n) * into; }
      }
    }
    const g = W.groundHeight(f.x, f.z, f.y + 0.3, 0.3);
    if (f.y <= g && r.vel.y <= 0) { f.y = g; this.landed(r); return; }
    if (f.y < W.city.L.water - 6) this.remove(r);
  }

  // ---- on the hull -----------------------------------------------------------------------------

  /** It reached the mech: it clings where it struck, out of the way of the mech's own guns and locks */
  grab(r, P) {
    const c = this.center(r, _c);
    let a = wrap(Math.atan2(c.x - P.pos.x, c.z - P.pos.z) - P.bodyYaw), h = clamp(c.y - P.pos.y + HANG * r.k, 2.8, 6.6);
    // Not on top of one already there: the next free hold round the hull or up or down it
    for (let i = 0; i < 8 && this.list.some((o) => o.state === 'latch' && Math.abs(wrap(o.latch.a - a)) < 0.55 && Math.abs(o.latch.h - h) < 1.3); i++) {
      if (i % 2) h = clamp(h + (h > 4.7 ? -1.4 : 1.4), 2.8, 6.6);
      else a = wrap(a + (i % 4 ? -1 : 1) * 0.6 * (1 + (i >> 2)));
    }
    r.latch = { a, h, T: rand(r.v.latch[0], r.v.latch[1]), t: 0, clawT: rand(0.15, 0.3) };
    r.state = 'latch';
    r.vel.set(0, 0, 0);
    // On the hull nothing can lock onto it, or aim at it
    r.stealth = true;
    this.untarget(r);
    this.clingAt(r, P);
    this.anim(r, 'climbing', 2.4);
    const at = this.center(r, new V3());
    this.hurtMech(r.v.claw, at, 'claw');
    const cb = this.sw.playerCb;
    if (r.v.shock && cb.onShock) cb.onShock(r.v.shock, at);
    this.fx.sparksBurst(at, r.climbN, 6, 0xffd8a0, 12);
    this.sound.riftLatch(at);
    if (this.time - this.alertT > 9 && cb.onAlert) {
      this.alertT = this.time;
      cb.onAlert('RIFTLINGS ON THE HULL', 1.4);
    }
  }

  /** Its hold on the hull, turning and moving with the mech: head up, belly to the armor */
  clingAt(r, P) {
    const L = r.latch, a = P.bodyYaw + L.a;
    r.climbN.set(Math.sin(a), 0, Math.cos(a));
    // The torso is broad; below the hips it holds on round a leg
    const R = L.h > 4.3 ? 1.75 : 1.25;
    r.cling.set(P.pos.x + r.climbN.x * R, P.pos.y + L.h, P.pos.z + r.climbN.z * R);
  }

  cling(r, dt, P) {
    const L = r.latch;
    L.t += dt;
    if (!P.alive) { this.splat(r); return; }
    this.clingAt(r, P);
    if ((L.clawT -= dt) <= 0) {
      L.clawT = rand(0.28, 0.38);
      const at = this.center(r, new V3());
      this.hurtMech(r.v.claw, at, 'claw');
      this.fx.sparksBurst(at, r.climbN, 3, 0xffd8a0, 9);
      this.sound.riftClaw(at);
    }
    if (L.t >= L.T) this.splat(r);
  }

  /** The end of a latch: a splat and a spray of its color (and its color's parting shot) */
  splat(r) {
    const p = this.center(r, new V3()), v = r.v, cb = this.sw.playerCb;
    this.burst(p, r.base, r.climbN, 1);
    this.sound.splat(p);
    if (v.splat) this.hurtMech(v.splat, p, 'claw');
    if (v.acid && cb.onAcid) cb.onAcid(v.acid, p);
    this.remove(r);
    if (v.blast) this.explode(r, p, true);
  }

  hurtMech(amount, from, kind) {
    const cb = this.sw.playerCb;
    cb.onPlayerHit && cb.onPlayerHit(amount, from, kind);
  }

  // ---- damage and death --------------------------------------------------------------------------

  /** Weapons fire (world.damage); true if it killed */
  hurt(r, amount, point) {
    if (!r.alive || r.state === 'latch') return false;
    r.hp -= amount;
    r.flash = 1;
    if (r.hp > 0) {
      if (amount >= 4 && (r.state === 'run' || r.state === 'stalk' || r.state === 'muster')) {
        r.state = 'hit';
        r.timer = 0.3;
        this.anim(r, 'hit', 1, 0);
      }
      return false;
    }
    this.kill(r, point);
    return true;
  }

  kill(r, point) {
    const was = r.state;
    r.alive = false;
    r.stealth = false;
    this.untarget(r);
    this.sw.kills++;
    // Shot off a wall it drops away from it; in the air it carries on along its arc
    if (was === 'climb') {
      this.center(r, r.feet).addScaledVector(UP, -CENTER * r.k);
      r.vel.copy(r.climbN).multiplyScalar(4);
    } else if (was !== 'leap' && was !== 'fall') r.vel.set(r.vel.x * 0.3, 0, r.vel.z * 0.3);
    r.state = 'dead';
    r.deadT = 0;
    r.rest = false;
    this.anim(r, 'death', rand(0.9, 1.2), 0);
    this.burst(point || r.pos, r.base, UP, 0.5);
    this.sound.riftDie(r.pos);
    const cb = this.sw.playerCb;
    cb.onKill && cb.onKill(r);
    // A Blast goes off a moment later, so a shot clump goes up in a ripple
    if (r.v.blast) r.boomT = rand(0.05, 0.13);
  }

  corpse(r, dt) {
    r.deadT += dt;
    if (r.boomT > 0 && (r.boomT -= dt) <= 0) {
      const p = this.center(r, new V3());
      this.remove(r);
      this.explode(r, p, false);
      return;
    }
    const f = r.feet, W = this.world;
    if (!r.rest) {
      r.vel.y -= GRAVITY * dt;
      f.addScaledVector(r.vel, dt);
      const g = W.groundHeight(f.x, f.z, f.y + 0.3, 0.3);
      if (f.y <= g) { f.y = g; r.rest = true; r.vel.set(0, 0, 0); }
      if (f.y < W.city.L.water - 6) { this.remove(r); return; }
    }
    // It lies a while, then melts away into a colored fume
    if (r.deadT > 2.6 && Math.random() < dt * 12) {
      const c = r.base;
      this.fx.smoke.emit(f.x + rand(-0.6, 0.6), f.y + 0.3, f.z + rand(-0.6, 0.6), rand(-0.3, 0.3), rand(0.6, 1.4), rand(-0.3, 0.3),
        rand(0.8, 1.4), 0.6, 1.8, c.r * 0.5, c.g * 0.5, c.b * 0.5, 0.5, c.r * 0.25, c.g * 0.25, c.b * 0.25, 0, 0.8, 0.3);
    }
    if (r.deadT > 3.6) this.remove(r);
  }

  /** A Blast goes off. onMech: it burst on the hull, so the mech takes all of it. */
  explode(r, p, onMech) {
    const B = r.v.blast, P = this.P;
    this.fx.explosion(p, 0.45, onMech ? {} : { normal: UP });
    this.burst(p, r.base, UP, 0.8);
    this.sound.explosion(p, 0.6);
    if (P && P.alive) {
      const d = capsuleDist(p, P.pos);
      if (d < B.r) this.hurtMech(onMech ? B.mech : B.mech * (1 - d / B.r), p, 'blast');
    }
    // Riftlings clinging close by are blown off, bursting; anything near is caught in it
    for (const o of this.list) if (o.state === 'latch' && o.pos.distanceTo(p) < B.r * 0.8) o.latch.t = o.latch.T;
    this.world.damageRadius(p, B.r, B.dmg);
    if (!onMech && this.world.destruct) this.world.destruct.blast(p, 1, 70, { enemy: true });
  }

  /** A burst of a riftling's color: flung droplets, glowing gobbets and a wet mist. n: the way it sprays. */
  burst(p, col, n, k = 1) {
    const fx = this.fx, r = col.r, g = col.g, b = col.b;
    fx.flash(p, 3 * k, col.getHex(), 0.1);
    for (let i = 0; i < 22 * k; i++) {
      _v.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().addScaledVector(n, 0.8).normalize();
      const s = rand(4, 13);
      fx.sparks.emit(p.x, p.y, p.z, _v.x * s, _v.y * s + 2, _v.z * s, rand(0.35, 0.8), rand(0.16, 0.3), 0.08,
        r * 2.4, g * 2.4, b * 2.4, 1, r, g, b, 0.7, 1.2, -26);
    }
    for (let i = 0; i < 8 * k; i++) {
      fx.fire.emit(p.x + rand(-0.3, 0.3), p.y + rand(-0.3, 0.3), p.z + rand(-0.3, 0.3), rand(-4, 4), rand(-1, 4), rand(-4, 4),
        rand(0.25, 0.5), rand(0.5, 0.9) * k, rand(1.2, 1.8) * k, r * 2, g * 2, b * 2, 0.9, r * 0.5, g * 0.5, b * 0.5, 0, 3, -6);
    }
    for (let i = 0; i < 5 * k; i++) {
      fx.smoke.emit(p.x, p.y, p.z, rand(-2, 2), rand(-0.5, 2), rand(-2, 2), rand(0.6, 1.1), 0.6 * k, 2.4 * k,
        r * 0.55, g * 0.55, b * 0.55, 0.75, r * 0.3, g * 0.3, b * 0.3, 0, 2, 2);
    }
  }

  // ---- drawing ------------------------------------------------------------------------------------

  render(r) {
    const dead = r.state === 'dead';
    // The dead shrink away as they melt
    const k = r.k * (dead ? 1 - clamp((r.deadT - 2.6) / 1, 0, 1) : 1);
    if (r.state === 'climb' || r.state === 'latch') {
      // The climbing clip hangs head down with its back to -z: turned so its head is up and its belly on the wall
      const n = r.climbN;
      _m.makeBasis(_a.set(n.z * k, 0, -n.x * k), _b.set(0, -k, 0), _c.set(-n.x * k, 0, -n.z * k));
      _m.setPosition(r.cling.x + n.x * 0.25 * r.k, r.cling.y + 0.16 * r.k, r.cling.z + n.z * 0.25 * r.k);
    } else {
      // Turned about +y so the model's -z faces fwd
      const yaw = Math.atan2(-r.fwd.x, -r.fwd.z), c = Math.cos(yaw), s = Math.sin(yaw);
      _m.makeBasis(_a.set(c * k, 0, -s * k), _b.set(0, k, 0), _c.set(s * k, 0, c * k));
      let y = r.feet.y;
      // The leap clip carries its own hop; the real leap is the arc it flies, so take the clip's out
      if (r.clip === 'leaping') y -= 1.25 * Math.sin(Math.PI * this.phaseOf(r)) * k;
      _m.setPosition(r.feet.x, y, r.feet.z);
    }
    this.mesh.setMatrixAt(r.slot, _m);

    // Its color: dimmed while a Shade runs dark, pulsing on a Blast, flaring when hit, darkening dead
    if (r.v.shade) r.glow += ((this.waiting(r) && r.stealth ? 0.18 : 1.2) - r.glow) * (1 - Math.exp(-5 * this.dt));
    let g = r.glow * (1 + r.flash * 2.5);
    if (r.v.blast && !dead) g *= 1 + 0.35 * Math.sin(r.t * 7 + r.slot);
    if (dead) g *= Math.max(0.35, 1 - r.deadT * 0.5);
    this.mesh.setColorAt(r.slot, _col.copy(r.base).multiplyScalar(g));

    // A contact shadow on the street or roof under it
    if (GROUND[r.state] || r.state === 'leap' || (dead && r.rest)) {
      const lift = r.feet.y - r.groundY, fade = r.state === 'leap' ? 1 - clamp(lift / 8, 0, 1) : 1;
      if (fade > 0.05) {
        const yaw = Math.atan2(-r.fwd.x, -r.fwd.z), c = Math.cos(yaw), s = Math.sin(yaw), w = 1.0 * k * fade, l = 2.2 * k * fade;
        _m.makeBasis(_a.set(c * w, 0, -s * w), _b.set(0, 1, 0), _c.set(s * l, 0, c * l));
        _m.setPosition(r.feet.x - r.fwd.x * 0.25 * k, (r.state === 'leap' ? r.groundY : r.feet.y) + 0.05, r.feet.z - r.fwd.z * 0.25 * k);
        this.shadows.setMatrixAt(r.slot, _m);
        return;
      }
    }
    this.shadows.setMatrixAt(r.slot, ZERO);
  }
}
