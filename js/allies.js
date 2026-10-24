import * as THREE from './three.js';
import { createDropship, createAPC } from './vehicles/models.js';

// The allies: the Kestrel H that flies the mech in from the harbor, packs of Kestrels that set
// Bastion tanks down in the streets, and the tanks, which drive the street grid hunting the swarm.
// The swarm hunts them back (js/spiders.js reads `foes`): tanks and Kestrels can be destroyed,
// the Kestrel H carrying the mech can't.

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * t * (t * (6 * t - 15) + 10); };
const UP = new V3(0, 1, 0);
const ONE = new V3(1, 1, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1), CHAR = new THREE.Color(0.2, 0.19, 0.18);

// The Kestrel H is this much bigger than the Kestrels that carry the tanks
const LIFTER_SCALE = 1.45;
const LIFTER_PAINT = { armor: 0x4b555d, edge: 0x69737a, dark: 0x22272b, brass: 0xc29a3e };
// The insertion: seconds from high over the harbor to a hover over the drop zone, then to release
const DROP_FLY = 22.4, DROP_SETTLE = 1.1;
// Its line (units): how high it starts, how far out past the seawall and how far east of the
// avenue it comes in up; how high the mech's feet ride over the streets, how high they are let
// go, and the radius of the turns at street corners (the wings just clear the towers')
const FLIGHT = { high: 150, offshore: 260, swing: 55, feet: 11, release: 5, corner: 10 };
// Its pace (units, seconds) before it is fitted to DROP_FLY: cruise over the water and in the
// streets, the most it pulls in a turn, how hard it speeds up and brakes, and the seconds over
// which every change of pace is eased
const PACE = { sea: 60, street: 60, lat: 12, acc: 14, brake: 16, ease: 0.5 };
// Kestrels: armor, cruise speed, braking, sink and climb rates, speed on the way out (units, seconds)
const SHIP = { hp: 300, cruise: 82, brake: 30, sink: 20, climb: 18, out: 95 };
// Bastions: armor, top speed, turn rate, gun range, seconds between shots, shell damage and splash
// (a stalker takes two shells: the tanks help, the mech still does most of the killing)
const TANK = { hp: 150, speed: 8.5, turn: 1.4, range: 175, reload: 2.8, dmg: 17, splash: 2.2, shell: 240, spread: 0.022, elev: [-0.12, 0.95] };
// Where a slung tank's wheels sit under a Kestrel, and the tank's hit spheres (model meters)
const TANK_HANG = new V3(0, -3.15, -0.4);

const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new V3();
const _tint = new THREE.Color();
const FLIP = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

/** Pose matrix for a vehicle heading along bearing `yaw` (0 = +z), nose -Z, pitched and rolled */
function pose(out, pos, yaw, pitch = 0, roll = 0) {
  _q.setFromEuler(_e.set(pitch, yaw + Math.PI, roll, 'YXZ'));
  return out.compose(pos, _q, ONE);
}

/**
 * A line through `route` ([x, z, radius] corners, the first and last radius unused): straight
 * legs joined by arcs of each corner's radius, smoothed so the turns come on gradually, and
 * sampled evenly about every unit. Returns { X, Z, ds }.
 */
function streetLine(route) {
  const px = [], pz = [];
  const line = (x0, z0, x1, z1) => {
    const m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5));
    for (let q = px.length ? 1 : 0; q <= m; q++) { px.push(x0 + ((x1 - x0) * q) / m); pz.push(z0 + ((z1 - z0) * q) / m); }
  };
  let cx = route[0][0], cz = route[0][1];
  for (let i = 1; i < route.length - 1; i++) {
    const [x, z, r] = route[i], [x0, z0] = route[i - 1], [x1, z1] = route[i + 1];
    let ax = x - x0, az = z - z0, bx = x1 - x, bz = z1 - z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const turn = Math.acos(clamp(ax * bx + az * bz, -1, 1)), tl = r * Math.tan(turn / 2);
    line(cx, cz, x - ax * tl, z - az * tl);
    if (turn > 1e-4) {
      // Around the center of the arc, from where it meets the leg in to where it meets the leg out
      const side = Math.sign(ax * bz - az * bx), ox = x - ax * tl - side * az * r, oz = z - az * tl + side * ax * r;
      const a0 = Math.atan2(pz[pz.length - 1] - oz, px[px.length - 1] - ox), m = Math.ceil((r * turn) / 0.5);
      for (let q = 1; q <= m; q++) { const a = a0 + (side * turn * q) / m; px.push(ox + Math.cos(a) * r); pz.push(oz + Math.sin(a) * r); }
    }
    cx = x + bx * tl; cz = z + bz * tl;
  }
  const last = route[route.length - 1];
  line(cx, cz, last[0], last[1]);
  // Ease the turns in and out (a few passes of a moving average, narrowing to hold the ends)
  for (let pass = 0; pass < 3; pass++) {
    const sx = px.slice(), sz = pz.slice(), n = px.length;
    for (let i = 1; i < n - 1; i++) {
      const w = Math.min(8, i, n - 1 - i);
      let x = 0, z = 0;
      for (let q = -w; q <= w; q++) { x += sx[i + q]; z += sz[i + q]; }
      px[i] = x / (2 * w + 1); pz[i] = z / (2 * w + 1);
    }
  }
  // Even samples
  const len = [0];
  for (let i = 1; i < px.length; i++) len.push(len[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]));
  const total = len[len.length - 1], n = Math.ceil(total) + 1, ds = total / (n - 1);
  const X = new Float32Array(n), Z = new Float32Array(n);
  for (let i = 0, p = 1; i < n; i++) {
    const s = i * ds;
    while (p < len.length - 1 && len[p] < s) p++;
    const f = clamp((s - len[p - 1]) / Math.max(1e-6, len[p] - len[p - 1]), 0, 1);
    X[i] = px[p - 1] + (px[p] - px[p - 1]) * f; Z[i] = pz[p - 1] + (pz[p] - pz[p - 1]) * f;
  }
  return { X, Z, ds };
}

// ---------------------------------------------------------------------------
// Instanced fleets
// ---------------------------------------------------------------------------

/**
 * Draws every copy of a vehicle model with instanced meshes, one per group and material of the
 * template, so a whole squadron costs a few dozen draw calls. Each copy can pose the template's
 * groups its own way (wheels, turret, gun) by replacing their local matrices.
 */
class Fleet {
  constructor(scene, template, cap) {
    template.updateMatrixWorld(true);
    this.nodes = [];
    const index = new Map();
    template.traverse((o) => {
      if (!o.isGroup) return;
      index.set(o, this.nodes.length);
      this.nodes.push({ name: o.name, parent: o === template ? -1 : index.get(o.parent), local: o.matrix.clone(), hidden: !o.visible });
    });
    this.parts = [];
    template.traverse((o) => {
      if (!o.isMesh) return;
      const mesh = new THREE.InstancedMesh(o.geometry, o.material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < cap; i++) mesh.setColorAt(i, WHITE);
      mesh.castShadow = o.castShadow;
      mesh.receiveShadow = true;
      // Copies move all over the city; one bounding sphere for all of them would cull wrongly
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.parts.push({ mesh, node: index.get(o.parent), local: o.matrix.clone() });
    });
    this.world = this.nodes.map(() => new THREE.Matrix4());
    this.hidden = this.nodes.map(() => false);
  }

  node(name) { return this.nodes.findIndex((n) => n.name.startsWith(name)); }

  /** A group's local matrix with its rotation replaced (and moved by dx, lift), for over[] in set() */
  turned(k, out, rx, ry, rz, lift = 0, dx = 0) {
    _p.setFromMatrixPosition(this.nodes[k].local);
    _p.y += lift;
    _p.x += dx;
    return out.compose(_p, _q2.setFromEuler(_e.set(rx, ry, rz)), ONE);
  }

  /** Pose copy i with root matrix M; over[k], if set, replaces group k's local matrix */
  set(i, M, over, tint = WHITE) {
    const N = this.nodes, W = this.world, H = this.hidden;
    for (let k = 0; k < N.length; k++) {
      const n = N[k];
      W[k].multiplyMatrices(n.parent < 0 ? M : W[n.parent], (over && over[k]) || n.local);
      H[k] = n.hidden || (n.parent >= 0 && H[n.parent]);
    }
    for (const p of this.parts) {
      p.mesh.setMatrixAt(i, H[p.node] ? ZERO : _m.multiplyMatrices(W[p.node], p.local));
      p.mesh.setColorAt(i, tint);
    }
  }

  /** Model-space point (meters) on group k of the copy last set, in world space */
  point(k, x, y, z, out) { return out.set(x, y, z).applyMatrix4(this.world[k]); }

  commit(count) {
    for (const p of this.parts) {
      p.mesh.count = count;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.mesh.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Allies
// ---------------------------------------------------------------------------

export class Allies {
  /** meters: meters per game unit (the models are built in meters) */
  constructor({ scene, world, fx, sound, meters, mobile = false }) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.sound = sound;
    this.M = meters;
    this.shipCap = mobile ? 8 : 12;
    this.tankCap = mobile ? 10 : 16;
    this.shipFleet = new Fleet(scene, createDropship(THREE, { metersPerUnit: meters }), this.shipCap);
    this.tankFleet = new Fleet(scene, createAPC(THREE, { metersPerUnit: meters }), this.tankCap);
    const T = this.tankFleet;
    this.nWheels = T.nodes.map((n, k) => (n.name.startsWith('wheel') ? k : -1)).filter((k) => k >= 0);
    this.nTurret = T.node('sliding roof turret');
    this.nGun = T.node('twin gun');
    this.nChin = this.shipFleet.node('chin turret');
    this.ships = [];
    this.tanks = [];
    this.shells = [];
    this.foes = []; // what the swarm can go after: landed tanks and Kestrels in the air
    this.kills = 0;
    this.base = null; // the swarm's callbacks; hits routed to an ally go to it instead (setSwarm)
    this.packT = Infinity;
    this.drop = null;
    this.lifter = null;
    this.buildRoads();
  }

  /** The swarm whose fire the allies draw; its callbacks are what an ally's routed ones fall back to */
  setSwarm(swarm) {
    this.base = swarm.cb;
    swarm.allies = this.foes;
  }

  /** Meters to game units */
  m(x) { return x / this.M; }

  clear() {
    this.ships.length = this.tanks.length = this.shells.length = this.foes.length = 0;
    this.shipFleet.commit(0);
    this.tankFleet.commit(0);
    this.packT = Infinity;
    this.kills = 0;
    if (this.lifter) this.lifter.visible = false;
    this.drop = null;
  }

  // ---- the street grid ----------------------------------------------------------

  /** Intersections of the avenues and cross streets; tanks drive between neighbors */
  buildRoads() {
    const L = this.world.city.L;
    this.xs = L.aves.map((a) => (a.x0 + a.x1) / 2);
    this.zs = L.sts.filter((s) => s.k >= 0).map((s) => (s.z0 + s.z1) / 2);
    this.blocked = new Map(); // edge key -> seconds left
  }

  nearestNode(x, z) {
    let i = 0, k = 0;
    for (let n = 1; n < this.xs.length; n++) if (Math.abs(this.xs[n] - x) < Math.abs(this.xs[i] - x)) i = n;
    for (let n = 1; n < this.zs.length; n++) if (Math.abs(this.zs[n] - z) < Math.abs(this.zs[k] - z)) k = n;
    return { i, k };
  }

  edgeKey(a, b) { return a.i < b.i || (a.i === b.i && a.k < b.k) ? `${a.i},${a.k}-${b.i},${b.k}` : `${b.i},${b.k}-${a.i},${a.k}`; }

  /** Is the sky over (x, z) open and the road clear, so a Kestrel can come straight down there? */
  open(x, z) {
    const W = this.world;
    if (W.groundHeight(x, z, 2, 2.5) > 1.2) return false;
    for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      if (W.raycast(_a.set(x + dx, 1.5, z + dz), UP, 260, { targets: false })) return false;
    }
    return true;
  }

  /**
   * Up to n spots in the streets around p for a pack to set its tanks down: crossings and the
   * middles of blocks, spread apart, out of the mech's way. axis: the bearing of the road there.
   */
  dropSpots(n, p) {
    const out = [], xs = this.xs, zs = this.zs, B = this.world.bounds;
    for (let tries = 0; tries < 160 && out.length < n; tries++) {
      const i = Math.floor(Math.random() * xs.length), k = Math.floor(Math.random() * zs.length);
      let x = xs[i], z = zs[k], axis = Math.random() < 0.5 ? 0 : Math.PI / 2;
      const r = Math.random();
      if (r < 0.35 && k < zs.length - 1) { z = (zs[k] + zs[k + 1]) / 2; axis = 0; }
      else if (r < 0.7 && i < xs.length - 1) { x = (xs[i] + xs[i + 1]) / 2; axis = Math.PI / 2; }
      if (x < B.minX + 20 || x > B.maxX - 20 || z < B.minZ + 20 || z > B.maxZ - 20) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 40 || d > 260) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 30)) continue;
      if (this.tanks.some((t) => Math.hypot(t.pos.x - x, t.pos.z - z) < 12)) continue;
      if (!this.open(x, z)) continue;
      out.push({ x, z, axis });
    }
    return out;
  }

  // ---- the insertion: the Kestrel H flies the mech in ----------------------------------

  /**
   * Fly the mech in from high over the harbor, south of the city, and hold it over `feet` until
   * release. It swoops down to the mouth of an avenue and threads the streets just over the
   * traffic, between the towers: up the avenue, a left onto a cross street, a right, a left, and
   * a wide right over the plaza that brings it to a hover over `feet`, nose north. The line is
   * worked out from the city under it each time, and its pace from the turns along it.
   */
  startDrop(feet) {
    if (!this.lifter) {
      // Gunmetal, not the olive drab of the Kestrels that carry the tanks
      this.lifter = createDropship(THREE, { metersPerUnit: this.M / LIFTER_SCALE, lifter: true, palette: LIFTER_PAINT });
      this.scene.add(this.lifter);
    }
    const Lf = this.lifter, W = this.world, L = W.city.L, F = FLIGHT;
    Lf.visible = true;
    Lf.userData.setClamp(0);
    const u = LIFTER_SCALE / this.M;
    const hang = Lf.userData.hang.clone().multiplyScalar(u);
    const depth = -hang.y;

    // The route, counted from the plaza block (j, k): up the avenue four east of it to the second
    // street south, west two blocks, north one, west along the plaza's own street, then a turn
    // over the plaza that ends on the spawn. Each corner is [x, z, radius of the turn there].
    const { j, k } = W.city.spawnBlock;
    const ave = (i) => (L.aves[i].x0 + L.aves[i].x1) / 2, st = (i) => (L.st(i).z0 + L.st(i).z1) / 2;
    // Each leg runs down the middle of the gap the buildings leave, which isn't always the middle
    // of the street: some stand out into it
    const mid = (alongX, c, a, b) => {
      let lo = -9, hi = 9;
      for (let t = Math.min(a, b) + 14; t <= Math.max(a, b) - 14; t += 2) {
        for (let o = 0.5; o <= 9; o += 0.5) {
          const at = (d) => (alongX ? W.groundHeight(t, c + d, 1e5, 0.25) : W.groundHeight(c + d, t, 1e5, 0.25)) > F.feet;
          if (o < hi && at(o)) hi = o;
          if (-o > lo && at(-o)) lo = -o;
        }
      }
      return c + clamp((lo + hi) / 2, -3, 3);
    };
    const shore = L.z1 + L.prom;
    let a1 = ave(j + 4), a2 = ave(j + 2), s1 = st(k + 2), s2 = st(k + 1);
    a1 = mid(false, a1, shore, s1); a2 = mid(false, a2, s1, s2);
    s1 = mid(true, s1, a1, a2); s2 = mid(true, s2, a2, feet.x + (s2 - feet.z));
    const route = [
      [a1 + F.swing, shore + F.offshore, 0],
      [a1, shore + F.offshore * 0.3, 400],
      [a1, s1, F.corner], [a2, s1, F.corner], [a2, s2, F.corner],
      [feet.x, s2, s2 - feet.z],
      [feet.x, feet.z, 0],
    ];
    const { X, Z, ds } = streetLine(route);
    const n = X.length, S = (n - 1) * ds;

    // Heading (0 = +z) and how fast it turns per unit flown (> 0: to the left)
    const H = new Float32Array(n), K = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      H[i] = Math.atan2(X[b] - X[a], Z[b] - Z[a]);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      K[i] = b > a ? wrap(H[b] - H[a]) / ((b - a) * ds) : 0;
    }
    // Finish exactly on the heading of the last leg (smoothing the line bends its last few units)
    const [ex, ez] = route[route.length - 1], [fx, fz] = route[route.length - 2], hEnd = Math.atan2(ex - fx, ez - fz);
    for (let i = 0; i < n; i++) H[i] += wrap(hEnd - H[i]) * smooth(S - 12, S, i * ds);

    // Height: high over the water, diving to just over the traffic by the seawall, bobbing gently
    // through the streets and easing down onto the release height over the plaza. Never lower
    // than what clears every roof under the wings, climbing toward what is ahead at 0.6 and
    // diving past what it has cleared at 1.6.
    let entry = n - 1;
    for (let i = 0; i < n; i++) if (Z[i] <= shore) { entry = i; break; }
    const sEntry = entry * ds, low = depth + F.feet, end = feet.y + depth + F.release;
    const req = new Float32Array(n), Y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const px = Math.cos(H[i]), pz = -Math.sin(H[i]);
      let h = feet.y;
      for (let w = -5; w <= 5; w += 2.5) h = Math.max(h, W.groundHeight(X[i] + px * w, Z[i] + pz * w, 1e5, 0.75));
      req[i] = h + depth + F.release;
    }
    const env = req.slice();
    for (let i = 1; i < n; i++) env[i] = Math.max(env[i], env[i - 1] - 1.6 * ds);
    for (let i = n - 2; i >= 0; i--) env[i] = Math.max(env[i], env[i + 1] - 0.6 * ds);
    for (let i = 0; i < n; i++) {
      const s = i * ds;
      const bob = (1.6 * Math.sin(s * 0.045) + 0.7 * Math.sin(s * 0.11 + 1.3)) * smooth(sEntry - 40, sEntry + 40, s) * (1 - smooth(S - 160, S - 60, s));
      let y = F.high + (low - F.high) * smoother(0, sEntry - 30, s) + bob;
      y += (end - y) * smoother(S - 75, S, s);
      Y[i] = Math.max(y, env[i]);
    }
    for (let pass = 0; pass < 3; pass++) {
      const s = Y.slice();
      for (let i = 2; i < n - 2; i++) Y[i] = Math.max(req[i], (s[i - 2] + 2 * s[i - 1] + 3 * s[i] + 2 * s[i + 1] + s[i + 2]) / 9);
    }

    // Pace: fast over the water, slower in the streets and slower again through the corners,
    // speeding up and braking at set rates, eased so no change of pace is sudden, then fitted to
    // DROP_FLY
    const P = PACE, v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const cruise = P.sea + (P.street - P.sea) * smooth(sEntry - 140, sEntry, i * ds);
      v[i] = Math.min(cruise, Math.sqrt(P.lat / Math.max(1e-4, Math.abs(K[i]))));
    }
    v[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * P.brake * ds));
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * P.acc * ds));
    const T = new Float32Array(n);
    for (let i = 1; i < n; i++) T[i] = T[i - 1] + (2 * ds) / Math.max(1e-3, v[i - 1] + v[i]);
    const sAt = (t) => {
      if (t <= 0) return v[0] * t;
      if (t >= T[n - 1]) return S;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
      return (lo + (t - T[lo]) / (T[hi] - T[lo])) * ds;
    };
    const h = 1 / 60, sig = P.ease, R = Math.ceil((3 * sig) / h), wts = [];
    let wsum = 0;
    for (let q = -R; q <= R; q++) { const w = Math.exp(-0.5 * ((q * h) / sig) ** 2); wts.push(w); wsum += w; }
    const nT = Math.ceil((T[n - 1] + 3 * sig) / h) + 1, raw = new Float32Array(nT + 2 * R), sT = new Float32Array(nT);
    for (let q = 0; q < raw.length; q++) raw[q] = sAt((q - R) * h);
    for (let q = 0; q < nT; q++) {
      let acc = 0;
      for (let w = 0; w < wts.length; w++) acc += wts[w] * raw[q + w];
      sT[q] = clamp(acc / wsum, 0, S);
    }
    sT[nT - 1] = S;

    const D = (this.drop = {
      t: 0, X, Y, Z, H, K, ds, S, sT, sDt: DROP_FLY / (nT - 1), paced: (nT - 1) * h, s: 0,
      hang, depth, heading: H[0], phase: 'fly', released: false,
      pos: new V3(X[0], Y[0], Z[0]), prev: new V3(X[0], Y[0], Z[0]), vel: new V3(), speed: 0, pitch: 0, roll: 0, clamp: 0,
      feet: new V3(), mechQ: new THREE.Quaternion(), cam: { pos: new V3(), look: new V3() },
      flyT: DROP_FLY, releaseT: DROP_FLY + DROP_SETTLE, whoosh: false,
    });
    D.tEntry = this.dropTime(sEntry);
    this.sound.thrusters(D.pos);
    this.updateDrop(0);
    return D;
  }

  /** How far along the insertion line the lifter is at time t */
  dropS(t) {
    const D = this.drop, q = clamp(t / D.sDt, 0, D.sT.length - 1), i = Math.min(D.sT.length - 2, Math.floor(q));
    return D.sT[i] + (D.sT[i + 1] - D.sT[i]) * (q - i);
  }

  /** When the lifter is s along the line */
  dropTime(s) {
    const D = this.drop;
    let i = 0;
    while (i < D.sT.length - 1 && D.sT[i] < s) i++;
    return i * D.sDt;
  }

  /** The point s along the insertion line, carried straight back before its start */
  dropPoint(s, out) {
    const D = this.drop, n = D.X.length;
    if (s < 0) {
      const g = (D.Y[1] - D.Y[0]) / D.ds;
      return out.set(D.X[0] + Math.sin(D.H[0]) * s, D.Y[0] + g * s, D.Z[0] + Math.cos(D.H[0]) * s);
    }
    const q = Math.min(s / D.ds, n - 1), i = Math.min(n - 2, Math.floor(q)), f = q - i;
    return out.set(D.X[i] + (D.X[i + 1] - D.X[i]) * f, D.Y[i] + (D.Y[i + 1] - D.Y[i]) * f, D.Z[i] + (D.Z[i + 1] - D.Z[i]) * f);
  }

  /** Heading, turn and climb of the line at s */
  dropLine(s) {
    const D = this.drop, n = D.X.length, q = clamp(s / D.ds, 0, n - 1), i = Math.min(n - 2, Math.floor(q)), f = q - i;
    return {
      heading: D.H[i] + wrap(D.H[i + 1] - D.H[i]) * f,
      turn: D.K[i] + (D.K[i + 1] - D.K[i]) * f,
      climb: (D.Y[i + 1] - D.Y[i]) / D.ds,
    };
  }

  updateDrop(dt) {
    const D = this.drop, Lf = this.lifter;
    if (!D) return null;
    D.t += dt;
    D.prev.copy(D.pos);
    if (D.phase === 'fly') {
      D.s = this.dropS(D.t);
      this.dropPoint(D.s, D.pos);
      // Hover over the drop zone, settling a little, then let go
      if (D.t > DROP_FLY) D.pos.y -= 0.6 * smooth(0, DROP_SETTLE, D.t - DROP_FLY);
      if (!D.whoosh && D.t >= D.tEntry - 0.6) { D.whoosh = true; this.sound.thrusters(D.pos); }
      if (D.t >= D.releaseT) { D.phase = 'leave'; D.released = true; D.leaveT = 0; this.sound.hatch(D.pos); this.sound.servo(D.pos); }
    } else {
      // Climb straight out of the towers, then fly off north and out of sight
      D.leaveT += dt;
      const up = Math.min(34, 6 + D.leaveT * 16), fwd = D.pos.y > 190 ? Math.min(110, (D.leaveT - 4) * 30) : 2;
      D.pos.y += up * dt;
      D.pos.z -= Math.max(0, fwd) * dt;
      if (D.leaveT > 11) { Lf.visible = false; this.drop = null; return D; }
    }
    if (dt > 0) {
      D.vel.subVectors(D.pos, D.prev).divideScalar(dt);
      if (D.phase === 'fly') {
        // Speed along the line and its change, from the eased pace rather than frame to frame
        const e = 0.1, ve = (t) => (this.dropS(t + e) - this.dropS(t - e)) / (2 * e);
        const speed = ve(D.t), acc = (ve(D.t + e) - ve(D.t - e)) / (2 * e), line = this.dropLine(D.s);
        D.speed = speed;
        D.heading = line.heading;
        // Nose follows the climb and dive, dips as it speeds up and comes up as it brakes; it banks
        // into the turns
        const pitchT = clamp(Math.atan(line.climb) * 0.55 + clamp(-acc * 0.015, -0.15, 0.3), -0.45, 0.45);
        const rollT = clamp(Math.atan2(speed * speed * line.turn, this.m(9.81)) * 0.85, -0.6, 0.6);
        D.pitch += (pitchT - D.pitch) * damp(3, dt);
        D.roll += (rollT + 0.03 * Math.sin(D.t * 1.3) - D.roll) * damp(3.5, dt);
      } else {
        D.speed = Math.hypot(D.vel.x, D.vel.z);
        D.pitch += (0.06 - D.pitch) * damp(4, dt);
        D.roll += (0.03 * Math.sin(D.t * 1.3) - D.roll) * damp(4, dt);
      }
    }
    D.clamp += ((D.released ? 1 : 0) - D.clamp) * damp(8, dt);
    Lf.userData.setClamp(D.clamp);
    pose(_m, D.pos, D.heading, D.pitch, D.roll);
    Lf.position.copy(D.pos);
    Lf.quaternion.setFromRotationMatrix(_m);
    // The mech hangs from the cradle, facing the way the lifter flies
    if (!D.released) {
      D.feet.copy(D.hang).applyQuaternion(Lf.quaternion).add(D.pos);
      D.mechQ.copy(Lf.quaternion).multiply(FLIP);
    }
    this.lifterFx(D, dt);
    // Cinematic chase: off the right flank over the water, the city ahead, then swinging in behind
    // and riding the line itself through the streets, so the camera is never in a wall, hanging
    // back further the faster the lifter goes
    if (D.phase === 'fly') {
      const k = smooth(1.5, Math.max(2, D.tEntry - 1), D.t), f = _a.set(Math.sin(D.heading), 0, Math.cos(D.heading)), r = _b.set(-f.z, 0, f.x);
      _c.copy(D.pos).addScaledVector(f, -10).addScaledVector(r, 22).addScaledVector(UP, -3);
      this.dropPoint(D.s - 20 - 0.15 * D.speed, _d).addScaledVector(UP, 5);
      D.cam.pos.lerpVectors(_c, _d, k);
      D.cam.look.copy(D.pos).addScaledVector(UP, -D.depth * 0.45).addScaledVector(f, 14 - 6 * k);
    }
    return D;
  }

  lifterFx(D, dt) {
    if (!dt) return;
    const fx = this.fx, Lf = this.lifter, u = LIFTER_SCALE / this.M;
    // Exhaust from the turbine nozzles, and the lift fans' downwash
    for (const s of [-1, 1]) {
      _a.set(s * 2.55, 3.95, 5.6).multiplyScalar(u).applyQuaternion(Lf.quaternion).add(D.pos);
      _b.set(0, 0, 1).applyQuaternion(Lf.quaternion);
      const v = 18 + D.speed * 0.4, size = 0.45 + Math.min(1, D.speed / 120);
      fx.fire.emit(_a.x, _a.y, _a.z, _b.x * v + D.vel.x * 0.6, _b.y * v + D.vel.y * 0.6, _b.z * v + D.vel.z * 0.6, 0.12, size, 0.35 * size, 0.6, 1.4, 2.6, 0.9, 0.3, 0.6, 1.4, 0, 1);
    }
    const ground = this.world.groundHeight(D.pos.x, D.pos.z, D.pos.y, 2);
    const alt = D.pos.y - ground;
    if (alt < 26 && Math.random() < 0.8) this.fx.dust(_a.set(D.pos.x + rand(-4, 4), ground, D.pos.z + rand(-4, 4)), 1.4 - alt / 30, 3);
  }

  // ---- packs of Kestrels with tanks -----------------------------------------------------

  /** The next pack comes in `after` seconds */
  schedule(after) { this.packT = after; }

  /** A pack of three to ten Kestrels, each with a tank, flying in from over the water */
  spawnPack(p) {
    const room = Math.min(this.shipCap - this.ships.length, this.tankCap - this.tanks.length - this.ships.filter((s) => s.tank).length);
    const want = Math.min(room, 3 + Math.floor(Math.random() * 8));
    if (want < 1) return 0;
    const spots = this.dropSpots(want, p);
    if (!spots.length) return 0;
    // In over the harbor most of the time, otherwise over the river east or west
    const B = this.world.bounds, side = Math.random(), entry = new V3();
    if (side < 0.6) entry.set(clamp(p.x + rand(-220, 220), B.minX + 80, B.maxX - 80), 0, B.maxZ + 300);
    else if (side < 0.8) entry.set(B.maxX + 300, 0, clamp(p.z + rand(-160, 160), B.minZ + 80, B.maxZ - 80));
    else entry.set(B.minX - 300, 0, clamp(p.z + rand(-160, 160), B.minZ + 80, B.maxZ - 80));
    const cx = spots.reduce((s, q) => s + q.x, 0) / spots.length, cz = spots.reduce((s, q) => s + q.z, 0) / spots.length;
    const yaw = Math.atan2(cx - entry.x, cz - entry.z), fwd = _c.set(Math.sin(yaw), 0, Math.cos(yaw)), right = _d.set(-fwd.z, 0, fwd.x);
    // A V: the leader takes the nearest spot, the wings fan out behind it
    spots.sort((a, b) => Math.hypot(a.x - entry.x, a.z - entry.z) - Math.hypot(b.x - entry.x, b.z - entry.z));
    spots.forEach((spot, j) => {
      const row = Math.ceil(j / 2), side2 = j % 2 ? 1 : -1;
      const start = entry.clone().addScaledVector(right, side2 * row * 15).addScaledVector(fwd, -row * 17);
      const cruise = this.cruiseAlt(start, spot);
      start.y = cruise + row * 2;
      this.ships.push(this.makeShip(start, yaw, spot, cruise));
    });
    this.sound.thrusters(_a.copy(entry).setY(80));
    return spots.length;
  }

  /** Altitude that clears every roof on the line from a to the spot, with room for the tank below */
  cruiseAlt(a, spot) {
    const W = this.world, dx = spot.x - a.x, dz = spot.z - a.z, d = Math.hypot(dx, dz), n = Math.ceil(d / 8);
    let h = 0;
    for (let i = 0; i <= n; i++) {
      const x = a.x + (dx * i) / n, z = a.z + (dz * i) / n;
      for (const w of [-6, 0, 6]) h = Math.max(h, W.groundHeight(x - (dz / d) * w, z + (dx / d) * w, 1e5, 1));
    }
    return Math.max(70, h + 16);
  }

  makeShip(pos, yaw, spot, cruise) {
    const s = {
      ship: true, alive: true, hp: SHIP.hp, maxHp: SHIP.hp, pos, vel: new V3(Math.sin(yaw) * SHIP.cruise, 0, Math.cos(yaw) * SHIP.cruise),
      yaw, pitch: 0, roll: 0, phase: 'in', t: 0, spot, cruise, tank: true, flash: 0, speed: SHIP.cruise,
      chest: new V3(), spheres: [0, 1, 2].map(() => ({ c: new V3(), r: this.m(3.4) })), fireT: rand(0.5, 1.5), burst: 0, chin: 0, target: null,
      over: [],
    };
    s.cb = this.routed(s);
    return s;
  }

  updateShip(s, dt, p) {
    const W = this.world;
    s.t += dt;
    s.flash = Math.max(0, s.flash - dt * 4);
    const ground = s.phase === 'dead' ? 0 : W.groundHeight(s.spot.x, s.spot.z, 2, 2);
    const hover = ground + this.m(-TANK_HANG.y) + 0.9;
    let yawT = s.yaw;
    switch (s.phase) {
      case 'in': {
        // Level at cruise height straight for the spot, braking to a stop over it
        _a.set(s.spot.x - s.pos.x, 0, s.spot.z - s.pos.z);
        const d = _a.length(), sp = Math.min(SHIP.cruise, Math.sqrt(2 * SHIP.brake * d));
        if (d > 3) yawT = Math.atan2(_a.x, _a.z);
        _a.divideScalar(d || 1).multiplyScalar(sp);
        s.vel.x += (_a.x - s.vel.x) * damp(3, dt);
        s.vel.z += (_a.z - s.vel.z) * damp(3, dt);
        s.vel.y = (s.cruise - s.pos.y) * 1.2;
        if (d < 2 && Math.hypot(s.vel.x, s.vel.z) < 4) {
          s.phase = 'down';
          // Turn to lie along the street before coming down between the buildings
          s.axisYaw = Math.abs(wrap(s.spot.axis - s.yaw)) < Math.PI / 2 ? s.spot.axis : s.spot.axis + Math.PI;
          this.sound.servo(s.pos);
        }
        break;
      }
      case 'down': {
        yawT = s.axisYaw;
        const aligned = Math.abs(wrap(s.axisYaw - s.yaw)) < 0.08;
        const dy = s.pos.y - hover;
        s.vel.y = aligned || dy > 40 ? -Math.min(SHIP.sink, Math.sqrt(2 * 9 * Math.max(0, dy)) + 0.6) : 0;
        s.vel.x = (s.spot.x - s.pos.x) * 2;
        s.vel.z = (s.spot.z - s.pos.z) * 2;
        if (dy < 0.15) { s.phase = 'drop'; s.t = 0; }
        break;
      }
      case 'drop':
        yawT = s.axisYaw;
        s.vel.set((s.spot.x - s.pos.x) * 2, (hover - s.pos.y) * 3, (s.spot.z - s.pos.z) * 2);
        if (s.tank && s.t > 0.45) this.releaseTank(s);
        if (s.t > 1.1) { s.phase = 'up'; this.sound.thrusters(s.pos); }
        break;
      case 'up':
        yawT = s.axisYaw;
        s.vel.set(0, Math.min(SHIP.climb, s.vel.y + 14 * dt), 0);
        if (s.pos.y > s.cruise) {
          s.phase = 'out';
          s.t = 0;
          // Back out the way the pack came, give or take
          s.outYaw = s.yaw + Math.PI + rand(-0.5, 0.5);
        }
        break;
      case 'out': {
        yawT = s.outYaw;
        const sp = Math.min(SHIP.out, s.t * 22);
        const turned = Math.abs(wrap(s.outYaw - s.yaw)) < 0.4;
        s.vel.x += (Math.sin(s.yaw) * (turned ? sp : 6) - s.vel.x) * damp(2, dt);
        s.vel.z += (Math.cos(s.yaw) * (turned ? sp : 6) - s.vel.z) * damp(2, dt);
        // Up over the skyline: the way out was never checked for towers
        s.vel.y = s.pos.y < 240 ? 16 : 3;
        if (s.t > 24 || s.pos.distanceTo(p) > 950) s.removed = true;
        break;
      }
      case 'dead': {
        // Spinning down, burning, until it hits something
        s.vel.y -= 22 * dt;
        s.yaw += s.spin * dt;
        s.roll += s.spin * 0.4 * dt;
        const v = s.vel.length();
        const hit = W.raycast(s.pos, _a.copy(s.vel).divideScalar(v || 1), v * dt + 1.5, { targets: false });
        if (hit || s.pos.y < W.city.L.water) { this.crash(s, hit ? hit.point : s.pos); return; }
        if (Math.random() < 0.9) {
          const g = 0.12 + Math.random() * 0.1;
          this.fx.smoke.emit(s.pos.x, s.pos.y + 1, s.pos.z, rand(-1, 1), 2, rand(-1, 1), 3, 1.6, 6, g, g, g, 0.7, g + 0.15, g + 0.15, g + 0.15, 0, 0.6, 0.3);
          this.fx.fire.emit(s.pos.x, s.pos.y + 0.5, s.pos.z, rand(-2, 2), rand(0, 3), rand(-2, 2), 0.4, 1.8, 0.6, 3, 1.4, 0.4, 1, 1, 0.3, 0.05, 0, 1);
        }
        break;
      }
    }
    // Yaw, and the nose and wings following the motion
    const turn = wrap(yawT - s.yaw), rate = s.phase === 'in' ? 0.8 : 1.3;
    if (s.phase !== 'dead') s.yaw += clamp(turn, -rate * dt, rate * dt);
    const speed = Math.hypot(s.vel.x, s.vel.z), acc = dt ? (speed - s.speed) / dt : 0;
    s.speed = speed;
    if (s.phase !== 'dead') {
      s.pitch += (clamp(-acc * 0.012, -0.22, 0.3) - s.pitch) * damp(3, dt);
      s.roll += (clamp(-turn * 0.8, -0.45, 0.45) * (speed > 10 ? 1 : 0.3) - s.roll) * damp(3, dt);
    }
    s.pos.addScaledVector(s.vel, dt);
    // Downwash in the street while it is low
    if ((s.phase === 'down' || s.phase === 'drop' || s.phase === 'up') && s.pos.y - ground < 18 && Math.random() < dt * 14) {
      this.fx.dust(_a.set(s.pos.x + rand(-3, 3), ground, s.pos.z + rand(-3, 3)), 1.2, 3);
    }
    if (s.phase === 'down' || s.phase === 'drop' || s.phase === 'up') this.shipGuns(s, dt);
  }

  /** The chin turret covers the street while the Kestrel is low, in short bursts (fired in render) */
  shipGuns(s, dt) {
    s.fireT -= dt;
    if (s.burst <= 0 && s.fireT <= 0) {
      s.fireT = rand(0.9, 1.6);
      s.target = this.pickTarget(s.pos, 130, true);
      if (s.target) { s.burst = 6; s.burstT = 0.3; }
    }
    const t = s.target && s.target.alive ? s.target : null;
    if (t) s.chin = clamp(s.chin + clamp(wrap(Math.atan2(t.pos.x - s.pos.x, t.pos.z - s.pos.z) - s.yaw - s.chin), -3 * dt, 3 * dt), -2.2, 2.2);
    if (s.burst > 0 && (s.burstT -= dt) <= 0) {
      s.burstT = 0.09;
      s.burst = t ? s.burst - 1 : 0;
      s.shoot = t;
    }
  }

  releaseTank(s) {
    s.tank = false;
    _q.setFromEuler(_e.set(s.pitch, s.yaw + Math.PI, s.roll, 'YXZ'));
    const pos = _a.copy(TANK_HANG).divideScalar(this.M).applyQuaternion(_q).add(s.pos).clone();
    const t = this.makeTank(pos, s.yaw);
    t.vel.copy(s.vel);
    this.tanks.push(t);
    this.sound.hatch(pos);
  }

  /** Shot down: it spins, burns and falls; a tank still slung under it goes down with it */
  downShip(s) {
    s.alive = false;
    s.phase = 'dead';
    s.spin = rand(-2.4, 2.4) || 1.5;
    s.vel.y = Math.max(s.vel.y, 2);
    this.fx.explosion(s.chest, 1.2);
    this.sound.explosion(s.chest, 1.4);
    if (s.tank) {
      this.releaseTank(s);
      const t = this.tanks[this.tanks.length - 1];
      t.hp = 1;
      t.doomed = true;
    }
  }

  crash(s, p) {
    s.removed = true;
    this.fx.explosion(p, 2.2);
    this.sound.explosion(p, 2.4);
    this.fx.scorch(p.x, p.z, 7, p.y + 0.05);
    this.allyHit(() => this.world.damageRadius(p, 9, 70, { crush: true }));
    if (this.world.destruct) this.world.destruct.blast(p, 3, 200, { enemy: true });
  }

  // ---- tanks -------------------------------------------------------------------------

  makeTank(pos, yaw) {
    const t = {
      tank: true, alive: true, hp: TANK.hp, maxHp: TANK.hp, pos, vel: new V3(), yaw, speed: 0, state: 'fall',
      turret: 0, gun: 0.1, wheel: 0, pitch: 0, roll: 0, flash: 0, barrel: 0,
      fireT: rand(0.5, 1.5), scanT: 0, target: null, see: false, from: null, to: null, goal: null, goalT: 0, stuckT: 0,
      chest: new V3(), spheres: [0, 1].map(() => ({ c: new V3(), r: this.m(2.5) })), over: [],
    };
    t.cb = this.routed(t);
    return t;
  }

  updateTank(t, dt, p) {
    const W = this.world;
    t.flash = Math.max(0, t.flash - dt * 4);
    if (t.state === 'fall') {
      t.vel.y -= 30 * dt;
      t.vel.x *= 1 - damp(3, dt);
      t.vel.z *= 1 - damp(3, dt);
      t.pos.addScaledVector(t.vel, dt);
      const g = W.groundHeight(t.pos.x, t.pos.z, t.pos.y + 0.5, 1.5);
      if (t.pos.y <= g) {
        t.pos.y = g;
        const hard = -t.vel.y;
        t.vel.set(0, 0, 0);
        this.fx.dust(t.pos, 1.1, 10);
        this.sound.footstep(t.pos, 0.9);
        if (t.doomed) { this.killTank(t); return; }
        t.state = 'drive';
        t.pitch = -0.08 * Math.min(1, hard / 8);
        // Head for the nearest crossing along the road it landed on
        const N = this.nearestNode(t.pos.x, t.pos.z), ox = t.pos.x - this.xs[N.i], oz = t.pos.z - this.zs[N.k];
        const from = Math.abs(ox) < Math.abs(oz) ? { i: N.i, k: N.k + (oz > 0 ? 1 : -1) } : { i: N.i + (ox > 0 ? 1 : -1), k: N.k };
        from.i = clamp(from.i, 0, this.xs.length - 1);
        from.k = clamp(from.k, 0, this.zs.length - 1);
        t.from = from.i === N.i && from.k === N.k ? N : from;
        t.to = N;
      }
      return;
    }
    if (t.state === 'dead') {
      t.deadT += dt;
      const k = Math.max(0.2, 1 - t.deadT / 24);
      if (Math.random() < dt * 14 * k) {
        const g = 0.1 + Math.random() * 0.08;
        this.fx.smoke.emit(t.pos.x + rand(-1, 1), t.pos.y + 1.6, t.pos.z + rand(-1, 1), rand(-0.5, 0.5), 2.5, rand(-0.5, 0.5), 3.2, 1.2, 5.5, g, g, g, 0.65, g + 0.2, g + 0.2, g + 0.2, 0, 0.6, 0.4);
      }
      if (Math.random() < dt * 9 * k) this.fx.fire.emit(t.pos.x, t.pos.y + 1.4, t.pos.z, rand(-0.5, 0.5), 1.5, rand(-0.5, 0.5), 0.5, 1.2, 0.3, 3, 1.4, 0.4, 1, 1, 0.2, 0.05, 0, 1);
      if (t.deadT > 30) t.removed = true;
      return;
    }

    // Targets: the nearest bug it can see, or the nearest at all to go after
    t.scanT -= dt;
    if (t.scanT <= 0) {
      t.scanT = rand(0.3, 0.5);
      t.target = this.pickTarget(_a.copy(t.pos).setY(t.pos.y + 2.6), TANK.range + 60, false);
      t.see = !!t.target && this.canSee(_a, t.target);
    }
    const tg = t.target && t.target.alive && !t.target.stealth ? t.target : null;
    if (!tg) t.see = false;

    // Where to drive: toward the target, else back toward the mech, else anywhere near it
    t.goalT -= dt;
    if (tg) { t.goal = tg.pos; t.chasing = true; }
    else if (!t.goal || t.goalT <= 0 || t.chasing) {
      t.chasing = false;
      t.goalT = rand(8, 14);
      const far = Math.hypot(p.x - t.pos.x, p.z - t.pos.z) > 110;
      t.goal = far ? p.clone() : new V3(p.x + rand(-140, 140), 0, p.z + rand(-140, 140));
    }
    if (!t.to) t.to = this.nextNode(t, t.from, null);
    const dist = tg ? tg.pos.distanceTo(t.pos) : Infinity;
    // Hold still to shoot at something in sight and in range; keep driving to close on it otherwise
    const hold = t.see && dist < TANK.range - 30;
    const nx = this.xs[t.to.i], nz = this.zs[t.to.k];
    const travel = Math.atan2(nx - this.xs[t.from.i], nz - this.zs[t.from.k]);
    // Keep to the right of the road
    const lx = nx - Math.cos(travel) * 2.4, lz = nz + Math.sin(travel) * 2.4;
    const want = Math.atan2(lx - t.pos.x, lz - t.pos.z);
    const err = wrap(want - t.yaw);
    t.yaw += clamp(err, -TANK.turn * dt, TANK.turn * dt);
    let target = hold ? 0 : TANK.speed * clamp(1 - Math.abs(err) / 1.1, 0.2, 1);
    // Make way: other tanks just ahead, and the mech
    const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
    for (const o of this.tanks) {
      if (o === t || o.state === 'fall') continue;
      const dx = o.pos.x - t.pos.x, dz = o.pos.z - t.pos.z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < 9 && side < 3.2) target = Math.min(target, Math.max(0, (along - 5) * 1.5));
    }
    {
      const dx = p.x - t.pos.x, dz = p.z - t.pos.z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      if (Math.abs(p.y - t.pos.y) < 8 && along > 0 && along < 10 && side < 4) target = Math.min(target, Math.max(0, (along - 5) * 1.5));
    }
    t.speed += clamp(target - t.speed, -14 * dt, 5 * dt);
    const bx = t.pos.x, bz = t.pos.z;
    t.pos.x += fx * t.speed * dt;
    t.pos.z += fz * t.speed * dt;
    t.vel.set(fx * t.speed, 0, fz * t.speed);
    this.crushCars(t);
    // Buildings, rubble and wrecks in the road push back; one it can't get past means another way
    const pushed = W.resolve(t.pos, 1.7, 2.6, t.pos.y + 0.6);
    const moved = Math.hypot(t.pos.x - bx, t.pos.z - bz);
    t.stuckT = target > 1 && (pushed || moved < target * dt * 0.3) ? t.stuckT + dt : Math.max(0, t.stuckT - dt * 2);
    if (t.stuckT > 2.2) {
      this.blocked.set(this.edgeKey(t.from, t.to), 30);
      [t.from, t.to] = [t.to, t.from];
      t.to = this.nextNode(t, t.from, null);
      t.stuckT = 0;
    }
    const g = W.groundHeight(t.pos.x, t.pos.z, t.pos.y + 0.7, 1.4);
    t.pos.y = g > t.pos.y ? g : Math.max(g, t.pos.y - 12 * dt);
    // Tilt with the ground under the front and back wheels
    const hf = W.groundHeight(t.pos.x + fx * 2.6, t.pos.z + fz * 2.6, t.pos.y + 0.7, 0.6);
    const hb = W.groundHeight(t.pos.x - fx * 2.6, t.pos.z - fz * 2.6, t.pos.y + 0.7, 0.6);
    t.pitch += (clamp(Math.atan2(hf - hb, 5.2), -0.35, 0.35) - t.pitch) * damp(6, dt);
    t.wheel += (t.speed * dt) / this.m(1.04);
    // At the crossing: on to the next one
    if (Math.hypot(nx - t.pos.x, nz - t.pos.z) < 4.5) {
      const prev = t.from;
      t.from = t.to;
      t.to = this.nextNode(t, t.from, prev);
    }

    // Turret and gun: track the target, leading it, and fire when on it
    if (tg) {
      const muzzleY = t.pos.y + 2.9;
      const lead = Math.min(1.2, dist / TANK.shell);
      _b.copy(tg.pos).addScaledVector(tg.vel || _c.set(0, 0, 0), lead);
      const yawT = wrap(Math.atan2(_b.x - t.pos.x, _b.z - t.pos.z) - t.yaw);
      const pitchT = clamp(Math.atan2(_b.y - muzzleY, Math.hypot(_b.x - t.pos.x, _b.z - t.pos.z)) - t.pitch, TANK.elev[0], TANK.elev[1]);
      const dy = wrap(yawT - t.turret), dp = pitchT - t.gun;
      t.turret += clamp(dy, -2 * dt, 2 * dt);
      t.gun += clamp(dp, -1.2 * dt, 1.2 * dt);
      t.fireT -= dt;
      t.aimed = t.see && dist < TANK.range && Math.abs(dy) < 0.05 && Math.abs(dp) < 0.06 && t.fireT <= 0;
    } else {
      t.turret += clamp(wrap(0 - t.turret), -dt, dt);
      t.gun += clamp(0.06 - t.gun, -dt, dt);
      t.aimed = false;
    }
  }

  /** Next crossing from `at`: the neighbor that gets nearest the goal, not straight back if it can help it */
  nextNode(t, at, prev) {
    const goal = t.goal || t.pos;
    let best = null, bs = Infinity;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = at.i + di, k = at.k + dk;
      if (i < 0 || k < 0 || i >= this.xs.length || k >= this.zs.length) continue;
      const n = { i, k };
      let s = Math.hypot(this.xs[i] - goal.x, this.zs[k] - goal.z) + rand(0, 30);
      if (prev && prev.i === i && prev.k === k) s += 400;
      if (this.blocked.has(this.edgeKey(at, n))) s += 900;
      if (s < bs) { bs = s; best = n; }
    }
    return best;
  }

  /** Tanks roll over cars and flatten them, like the mech's feet */
  crushCars(t) {
    const W = this.world, fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
    W.query(t.pos.x - 3.5, t.pos.z - 3.5, t.pos.x + 3.5, t.pos.z + 3.5, (c) => {
      const car = c.ref;
      if (!car || car.kind !== 'car' || car.flat || !car.alive) return;
      const dx = car.pos.x - t.pos.x, dz = car.pos.z - t.pos.z;
      if (Math.abs(dx * fx + dz * fz) < 3.6 && Math.abs(dx * fz - dz * fx) < 2.1) W.city.crushCar(car);
    });
  }

  killTank(t) {
    t.alive = false;
    t.state = 'dead';
    t.deadT = 0;
    t.speed = 0;
    // The turret is blown off its ring and lands askew
    t.pop = { x: rand(-1.2, 1.2), y: rand(0.5, 1.3), rx: rand(-0.5, 0.5), rz: rand(-0.6, 0.6), ry: rand(-1, 1) };
    const p = _a.copy(t.pos).setY(t.pos.y + 1.4);
    this.fx.explosion(p, 1.25);
    this.fx.scorch(t.pos.x, t.pos.z, 4, t.pos.y + 0.04);
    this.sound.explosion(p, 1.3);
    this.allyHit(() => this.world.damageRadius(p, 6, 25));
  }

  // ---- shooting -------------------------------------------------------------------------

  /** The nearest live bug within range of `from`, preferring one in sight */
  pickTarget(from, range, needSight) {
    const list = [];
    for (const t of this.world.targets) {
      if (!t.alive || t.stealth || t.hidden || t.kind === 'car' || t.kind === 'tree') continue;
      const d = t.pos.distanceTo(from);
      if (d < range) list.push({ t, d });
    }
    if (!list.length) return null;
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(3, list.length); i++) if (this.canSee(from, list[i].t)) return list[i].t;
    return needSight ? null : list[0].t;
  }

  canSee(from, t) {
    _d.subVectors(t.pos, from);
    const d = _d.length();
    const hit = this.world.raycast(from, _d.divideScalar(d), d, { targets: false });
    return !hit || hit.dist > d - (t.radius || 2) - 1;
  }

  /** Damage dealt by the allies, flagged so the mech's hit marker and kill count leave it alone */
  allyHit(fn) {
    const W = this.world;
    W.allyFire = true;
    try { return fn(); } finally { W.allyFire = false; }
  }

  fire(from, dir, speed, dmg, splash, kind) {
    this.shells.push({ pos: from.clone(), vel: dir.clone().multiplyScalar(speed), dmg, splash, kind, life: 2 });
    if (kind === 'shell') {
      this.fx.muzzle(from, dir, 0xffb050, 1.4);
      for (let i = 0; i < 4; i++) this.fx.smoke.emit(from.x, from.y, from.z, dir.x * 6 + rand(-1, 1), dir.y * 6 + rand(0, 1.5), dir.z * 6 + rand(-1, 1), 1.4, 0.8, 3.2, 0.5, 0.48, 0.45, 0.5, 0.55, 0.55, 0.55, 0, 1.5, 0.2);
      this.sound.cannon(from);
    } else {
      this.fx.muzzle(from, dir, 0xffd070, 0.6);
      if (this.sound.gate('allyGun', 0.06, from)) this.sound.gun(from);
    }
  }

  updateShells(dt) {
    const W = this.world, fx = this.fx;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const b = this.shells[i];
      b.life -= dt;
      const step = b.vel.length() * dt;
      _a.copy(b.vel).divideScalar(step / dt);
      const hit = W.raycast(b.pos, _a, step, { targets: true, trees: true, pad: 0.4 });
      const prev = _b.copy(b.pos);
      if (hit || b.life <= 0) {
        const p = hit ? hit.point : b.pos;
        if (hit) this.impact(b, p, hit, _a);
        this.shells.splice(i, 1);
        continue;
      }
      b.pos.addScaledVector(b.vel, dt);
      // Tracer
      const big = b.kind === 'shell';
      for (let k = 0; k < 3; k++) {
        _c.lerpVectors(prev, b.pos, k / 3);
        fx.fire.emit(_c.x, _c.y, _c.z, 0, 0, 0, 0.08, big ? 0.9 : 0.45, 0.15, 3, big ? 1.5 : 2.2, 0.4, 0.9, 1, 0.4, 0.1, 0);
      }
    }
  }

  impact(b, p, hit, dir) {
    const W = this.world, D = W.destruct, fx = this.fx;
    this.allyHit(() => {
      if (hit.target && hit.target.alive) W.damage(hit.target, b.dmg, p);
      if (b.splash) W.damageRadius(p, b.splash, b.dmg * 0.45);
    });
    if (b.kind === 'shell') {
      fx.explosion(p, 0.42, { normal: hit.normal });
      this.sound.explosion(p, 0.45);
    } else fx.sparksBurst(p, hit.normal || UP, 6, 0xffc070, 18);
    // A tank round chips the city, though less than the mech's guns
    if (D && !hit.target) D.bullet(hit, { radius: b.kind === 'shell' ? 0.9 : 0.5, power: b.kind === 'shell' ? 45 : 20, dir, enemy: true, chunks: 2, speed: 6 });
  }

  // ---- what the swarm does to them ----------------------------------------------------

  /** Callbacks for a bug going after this ally: its hits land here, the rest of what it does is lost on a tank */
  routed(a) {
    const base = this.base || {};
    return Object.assign(Object.create(base), {
      onPlayerHit: (amount, from, kind) => this.hurt(a, amount, from, kind),
      onWeb() {}, onVenom() {}, onShock() {}, onPull() {},
      onGrab() { return false; },
    });
  }

  hurt(a, amount, from, kind) {
    if (!a.alive) return;
    a.hp -= amount;
    a.flash = 1;
    if (from) _a.subVectors(from, a.chest).normalize();
    this.fx.sparksBurst(a.chest, from ? _a : UP, 5, 0xffc070, 16);
    if (Math.random() < 0.4) this.sound.metalHit(a.chest, 0.6);
    if (a.hp > 0) return;
    if (a.ship) this.downShip(a); else this.killTank(a);
  }

  // ---- per frame -------------------------------------------------------------------------

  /** ctx: { player: V3 (the mech's feet), packs: whether packs keep coming } */
  update(dt, ctx) {
    const p = ctx.player;
    for (const [k, v] of this.blocked) { if (v - dt <= 0) this.blocked.delete(k); else this.blocked.set(k, v - dt); }
    if (ctx.packs) {
      this.packT -= dt;
      if (this.packT <= 0) {
        const n = this.spawnPack(p);
        this.packT = n ? rand(45, 75) : 8;
        if (n && ctx.onPack) ctx.onPack(n);
      }
    }
    for (const s of this.ships) this.updateShip(s, dt, p);
    for (const t of this.tanks) this.updateTank(t, dt, p);
    this.ships = this.ships.filter((s) => !s.removed);
    this.tanks = this.tanks.filter((t) => !t.removed);
    this.updateShells(dt);
    this.render();
    // What the swarm can go after
    const F = this.foes;
    F.length = 0;
    for (const t of this.tanks) if (t.alive && t.state === 'drive') F.push(t);
    for (const s of this.ships) if (s.alive && s.phase !== 'out') F.push(s);
  }

  render() {
    const S = this.shipFleet, T = this.tankFleet, F = _tint;
    this.ships.forEach((s, i) => {
      pose(_m, s.pos, s.yaw, s.pitch, s.roll);
      s.over[this.nChin] = S.turned(this.nChin, s.over[this.nChin] || new THREE.Matrix4(), 0, s.chin, 0);
      S.set(i, _m, s.over, s.alive ? F.setScalar(1 + s.flash * 0.6) : CHAR);
      // Center, hit spheres along the fuselage, and a gun round if one is due (it needs this pose)
      S.point(0, 0, 2.6, 0, s.chest);
      [-7, 0, 7].forEach((z, k) => S.point(0, 0, 2.6, z, s.spheres[k].c));
      if (s.shoot) {
        const t = s.shoot;
        s.shoot = null;
        S.point(this.nChin, s.burst % 2 ? 0.22 : -0.22, -0.15, -1.9, _a);
        _b.copy(t.pos).addScaledVector(t.vel || _c.set(0, 0, 0), _a.distanceTo(t.pos) / 300).sub(_a).normalize();
        _b.x += rand(-0.025, 0.025); _b.y += rand(-0.025, 0.025); _b.z += rand(-0.025, 0.025);
        this.fire(_a, _b.normalize(), 300, 4, 0, 'round');
      }
    });
    S.commit(this.ships.length);
    this.tanks.forEach((t, i) => {
      pose(_m, t.pos, t.yaw, t.pitch, 0);
      for (const k of this.nWheels) t.over[k] = T.turned(k, t.over[k] || new THREE.Matrix4(), -t.wheel, 0, 0);
      const pop = t.pop;
      t.over[this.nTurret] = pop
        ? T.turned(this.nTurret, t.over[this.nTurret] || new THREE.Matrix4(), pop.rx, t.turret + pop.ry, pop.rz, pop.y, pop.x)
        : T.turned(this.nTurret, t.over[this.nTurret] || new THREE.Matrix4(), 0, t.turret, 0);
      t.over[this.nGun] = T.turned(this.nGun, t.over[this.nGun] || new THREE.Matrix4(), t.gun, 0, 0);
      T.set(i, _m, t.over, t.alive ? F.setScalar(1 + t.flash * 0.6) : CHAR);
      T.point(0, 0, 1.5, 0, t.chest);
      T.point(0, 0, 1.5, -2.2, t.spheres[0].c);
      T.point(0, 0, 1.5, 2.2, t.spheres[1].c);
      if (t.aimed) {
        t.aimed = false;
        t.fireT = TANK.reload * rand(0.85, 1.15);
        t.barrel ^= 1;
        T.point(this.nGun, t.barrel ? 0.3 : -0.3, 0, -1.85, _a);
        T.point(this.nGun, t.barrel ? 0.3 : -0.3, 0, -0.5, _b);
        _c.subVectors(_a, _b).normalize();
        const sp = TANK.spread;
        _c.x += rand(-sp, sp); _c.y += rand(-sp * 0.6, sp); _c.z += rand(-sp, sp);
        this.fire(_a, _c.normalize(), TANK.shell, TANK.dmg, TANK.splash, 'shell');
      }
    });
    T.commit(this.tanks.length);
  }
}
