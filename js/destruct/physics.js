import * as THREE from '../three.js';
import { SOLID, MATS } from './grid.js';

// ---------------------------------------------------------------------------
// Rigid bodies for falling pieces of structures.
//
// A body is a voxel grid in its own frame (the building's coordinates at the
// moment it broke away), with mass and inertia summed over its cells. It
// collides through probes: points on its outer corners, binned so a big piece
// has a few hundred spread over its surface plus its extreme corners. Probes
// are pushed out of the ground, the city's boxes, standing structures and
// other bodies (both ways), and contacts are solved with sequential impulses:
// friction, a little bounce, warm starting from the last step, and sleep.
//
// A piece that has just broken away slides freely down the walls it was
// flush against (its parent's and the buildings next door): they give it no
// support until it leans into them. A piece tipping over the edge of what is
// left below can be held by a hinge: a pin on the edge it pivots about, which
// resists turning with the strength left in the hinge until it snaps.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const MAX_CONTACTS = 10;      // per body pair after reduction
const ITER = 10;
const FRICTION = 0.72;
const BAUMGARTE = 0.22;
const SLOP_K = 0.04;          // allowed penetration, in cells
const MAX_W = 6;              // rad/s
const MAX_V = 140;
const MAX_IMPACTS = 3;        // impact sites kept per body per step
const HINGE_MU = 1.6;         // how hard a hinge holds against sliding off its edge
const PK = 1024;              // contact keys: (pair key) * PK + probe
const OID = 131072;           // pair keys: body id * OID + other: 0 ground, boxes, structures, bodies

let NEXT_ID = 1;

/** 3x3 helpers on Float64Array(9), row-major */
function mulM3V(M, x, y, z, out) {
  out.x = M[0] * x + M[1] * y + M[2] * z;
  out.y = M[3] * x + M[4] * y + M[5] * z;
  out.z = M[6] * x + M[7] * y + M[8] * z;
  return out;
}

export class Body {
  /** s: the structure it renders and collides as; mass properties from its grid */
  constructor(s) {
    this.id = NEXT_ID++;
    this.isBody = true;
    this.s = s;
    this.x = new V3(); this.q = new THREE.Quaternion(); this.v = new V3(); this.w = new V3();
    this.c = new V3();
    this.R = new Float64Array(9); this.Iinv = new Float64Array(9); this.Iw = new Float64Array(9);
    this.min = new V3(); this.max = new V3();
    this.sleeping = false; this.still = 0; this.age = 0; this.fractureCool = 0.25; this.touching = false; this.resting = false;
    this.impact = null; // strongest contact this step: { speed, point, normal, other, kind, meff }
    this.imps = [];     // up to MAX_IMPACTS of them, apart from each other (impact is the first)
    this.nimp = 0;
    this.fresh = null;  // just broke away: { near: Set of the owners it was flush against, x0, q0 }
    this.hinge = null;  // pivoting on an edge (see Physics.setHinge)
    this.mass();
    this.probes = makeProbes(s.g, this.c);
    this.x.copy(this.c); // starts where it stood: world = local
    this.updateR();
  }

  /** Mass, center of mass and inverse inertia from the cells */
  mass() {
    const g = this.s.g, { nx, ny, nz, mat } = g;
    let m = 0, sx = 0, sy = 0, sz = 0, cells = 0;
    for (let y = 0; y < ny; y++) {
      const cy = g.cy(y), dy = g.dy(y);
      for (let z = 0; z < nz; z++) {
        const cz = g.cz(z), dz = g.dz(z);
        let i = nx * (z + nz * y);
        for (let x = 0; x < nx; x++, i++) {
          const k = mat[i];
          if (k < SOLID) continue;
          const mm = MATS[k].density * g.dx(x) * dy * dz;
          m += mm; sx += mm * g.cx(x); sy += mm * cy; sz += mm * cz; cells++;
        }
      }
    }
    this.m = Math.max(m, 1e-6);
    this.im = 1 / this.m;
    this.cells = cells;
    this.c.set(sx / this.m, sy / this.m, sz / this.m);
    // Inertia about the center
    let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
    const c = this.c;
    for (let y = 0; y < ny; y++) {
      const ry = g.cy(y) - c.y, dy = g.dy(y);
      for (let z = 0; z < nz; z++) {
        const rz = g.cz(z) - c.z, dz = g.dz(z);
        let i = nx * (z + nz * y);
        for (let x = 0; x < nx; x++, i++) {
          const k = mat[i];
          if (k < SOLID) continue;
          const dx = g.dx(x), rx = g.cx(x) - c.x, mm = MATS[k].density * dx * dy * dz;
          ixx += mm * (ry * ry + rz * rz + (dy * dy + dz * dz) / 12);
          iyy += mm * (rx * rx + rz * rz + (dx * dx + dz * dz) / 12);
          izz += mm * (rx * rx + ry * ry + (dx * dx + dy * dy) / 12);
          ixy -= mm * rx * ry; ixz -= mm * rx * rz; iyz -= mm * ry * rz;
        }
      }
    }
    const e = (ixx + iyy + izz) * 1e-4 + 1e-9;
    const I = new THREE.Matrix3().set(ixx + e, ixy, ixz, ixy, iyy + e, iyz, ixz, iyz, izz + e).invert();
    // THREE.Matrix3 elements are column-major; this one is symmetric so the order doesn't matter
    for (let k = 0; k < 9; k++) this.Iinv[k] = I.elements[k];
  }

  updateR() {
    const { x, y, z, w } = this.q, R = this.R;
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    R[0] = 1 - (yy + zz); R[1] = xy - wz; R[2] = xz + wy;
    R[3] = xy + wz; R[4] = 1 - (xx + zz); R[5] = yz - wx;
    R[6] = xz - wy; R[7] = yz + wx; R[8] = 1 - (xx + yy);
    // Iw = R Iinv R^T
    const A = this.Iinv, T = new Float64Array(9), O = this.Iw;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) T[r * 3 + k] = R[r * 3] * A[k] + R[r * 3 + 1] * A[3 + k] + R[r * 3 + 2] * A[6 + k];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) O[r * 3 + k] = T[r * 3] * R[k * 3] + T[r * 3 + 1] * R[k * 3 + 1] + T[r * 3 + 2] * R[k * 3 + 2];
    // World box from the grid's local box
    const g = this.s.g, lo = [g.xs[0], g.ys[0], g.zs[0]], hi = [g.xs[g.nx], g.ys[g.ny], g.zs[g.nz]];
    this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity);
    for (let k = 0; k < 8; k++) {
      this.toWorld(k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2], _w);
      this.min.min(_w); this.max.max(_w);
    }
  }

  toWorld(px, py, pz, out) {
    const R = this.R, x = px - this.c.x, y = py - this.c.y, z = pz - this.c.z;
    out.x = this.x.x + R[0] * x + R[1] * y + R[2] * z;
    out.y = this.x.y + R[3] * x + R[4] * y + R[5] * z;
    out.z = this.x.z + R[6] * x + R[7] * y + R[8] * z;
    return out;
  }

  toLocal(px, py, pz, out) {
    const R = this.R, x = px - this.x.x, y = py - this.x.y, z = pz - this.x.z;
    out.x = this.c.x + R[0] * x + R[3] * y + R[6] * z;
    out.y = this.c.y + R[1] * x + R[4] * y + R[7] * z;
    out.z = this.c.z + R[2] * x + R[5] * y + R[8] * z;
    return out;
  }

  /** Local direction to world */
  dirWorld(x, y, z, out) {
    const R = this.R;
    out.x = R[0] * x + R[1] * y + R[2] * z; out.y = R[3] * x + R[4] * y + R[5] * z; out.z = R[6] * x + R[7] * y + R[8] * z;
    return out;
  }

  dirLocal(x, y, z, out) {
    const R = this.R;
    out.x = R[0] * x + R[3] * y + R[6] * z; out.y = R[1] * x + R[4] * y + R[7] * z; out.z = R[2] * x + R[5] * y + R[8] * z;
    return out;
  }

  /** Velocity of the world point p */
  pointVel(p, out) {
    const rx = p.x - this.x.x, ry = p.y - this.x.y, rz = p.z - this.x.z, w = this.w;
    out.x = this.v.x + w.y * rz - w.z * ry;
    out.y = this.v.y + w.z * rx - w.x * rz;
    out.z = this.v.z + w.x * ry - w.y * rx;
    return out;
  }

  /** The matrix that draws its grid where it is: T(x) R T(-c) */
  matrix(out) {
    const R = this.R, c = this.c;
    out.set(
      R[0], R[1], R[2], this.x.x - (R[0] * c.x + R[1] * c.y + R[2] * c.z),
      R[3], R[4], R[5], this.x.y - (R[3] * c.x + R[4] * c.y + R[5] * c.z),
      R[6], R[7], R[8], this.x.z - (R[6] * c.x + R[7] * c.y + R[8] * c.z),
      0, 0, 0, 1,
    );
    return out;
  }

  wake() { this.sleeping = false; this.still = 0; }
}
const _w = new V3();

/**
 * Probes on a grid's surface: corners of faces toward empty cells, binned about s apart (the
 * corner farthest from the center wins each bin), plus the extreme corners in 26 directions.
 */
export function makeProbes(g, com, maxProbes = 520) {
  const { nx, ny, nz, mat } = g;
  const cell = Math.max(1e-3, (g.xs[nx] - g.xs[0]) / nx);
  // Bins about a tenth of the piece along each axis, so a tall tower still gets a ring of
  // probes round its foot to pivot on; no finer than a thirtieth of its size, so a slab or a
  // strip doesn't get a probe for every cell of its thin side
  const ext = Math.hypot(g.xs[nx] - g.xs[0], g.ys[ny] - g.ys[0], g.zs[nz] - g.zs[0]), lo = Math.max(cell * 1.01, ext / 30);
  let sx = Math.max(lo, (g.xs[nx] - g.xs[0]) / 10), sy = Math.max(lo, (g.ys[ny] - g.ys[0]) / 10), sz = Math.max(lo, (g.zs[nz] - g.zs[0]) / 10);
  const corners = [];
  const seen = new Set();
  const addCorner = (x, y, z) => {
    const key = x + (nx + 1) * (z + (nz + 1) * y);
    if (seen.has(key)) return;
    seen.add(key);
    corners.push(g.xs[x], g.ys[y], g.zs[z]);
  };
  const solid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && mat[x + nx * (z + nz * y)] >= SOLID;
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    if (mat[x + nx * (z + nz * y)] < SOLID) continue;
    if (!solid(x - 1, y, z)) { addCorner(x, y, z); addCorner(x, y + 1, z); addCorner(x, y, z + 1); addCorner(x, y + 1, z + 1); }
    if (!solid(x + 1, y, z)) { addCorner(x + 1, y, z); addCorner(x + 1, y + 1, z); addCorner(x + 1, y, z + 1); addCorner(x + 1, y + 1, z + 1); }
    if (!solid(x, y - 1, z)) { addCorner(x, y, z); addCorner(x + 1, y, z); addCorner(x, y, z + 1); addCorner(x + 1, y, z + 1); }
    if (!solid(x, y + 1, z)) { addCorner(x, y + 1, z); addCorner(x + 1, y + 1, z); addCorner(x, y + 1, z + 1); addCorner(x + 1, y + 1, z + 1); }
    if (!solid(x, y, z - 1)) { addCorner(x, y, z); addCorner(x + 1, y, z); addCorner(x, y + 1, z); addCorner(x + 1, y + 1, z); }
    if (!solid(x, y, z + 1)) { addCorner(x, y, z + 1); addCorner(x + 1, y, z + 1); addCorner(x, y + 1, z + 1); addCorner(x + 1, y + 1, z + 1); }
  }
  const n = corners.length / 3;
  if (n <= maxProbes) return Float32Array.from(corners);
  // Extremes in 26 directions
  const pick = new Set();
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    if (!a && !b && !c) continue;
    let best = -Infinity, bi = 0;
    for (let i = 0; i < n; i++) { const d = corners[i * 3] * a + corners[i * 3 + 1] * b + corners[i * 3 + 2] * c; if (d > best) { best = d; bi = i; } }
    pick.add(bi);
  }
  // Binned: the farthest corner from the center in each bin, coarser until few enough
  for (let tries = 0; tries < 6; tries++) {
    const bins = new Map();
    for (let i = 0; i < n; i++) {
      const x = corners[i * 3], y = corners[i * 3 + 1], z = corners[i * 3 + 2];
      const key = Math.floor(x / sx) + 4096 * (Math.floor(z / sz) + 4096 * Math.floor(y / sy));
      const d = (x - com.x) ** 2 + (y - com.y) ** 2 + (z - com.z) ** 2;
      const b = bins.get(key);
      if (!b || d > b[0]) bins.set(key, [d, i]);
    }
    if (bins.size + pick.size <= maxProbes || tries === 5) {
      for (const [, i] of bins.values()) pick.add(i);
      break;
    }
    sx *= 1.35; sy *= 1.35; sz *= 1.35;
  }
  const out = new Float32Array(pick.size * 3);
  let k = 0;
  for (const i of pick) { out[k++] = corners[i * 3]; out[k++] = corners[i * 3 + 1]; out[k++] = corners[i * 3 + 2]; }
  return out;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

const _p = new V3(), _l = new V3(), _n = new V3(), _va = new V3(), _vb = new V3(), _t = new V3(), _r = new V3();
const _out = {};

export class Physics {
  /**
   * env: { gravity, ground(x, z) -> y, statics(min, max, fn(c)) visiting city boxes { min, max }
   * and standing structures { vox: s } near a box }
   */
  constructor(env) {
    this.env = env;
    this.bodies = [];
    this.contacts = [];
    this.manifolds = []; // contacts grouped by the pair of things touching
    this.pool = [];
    this.cache = new Map(); // warm starting: key -> [jn, jt1, jt2]
    this.old = new Map();
    this.pairs = new Map();
    this.time = 0;
  }

  add(b) { this.bodies.push(b); b.wake(); return b; }
  remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }

  step(dt) {
    this.time += dt;
    const B = this.bodies, g = this.env.gravity;
    for (const b of B) {
      b.impact = null;
      if (b.sleeping) continue;
      b.age += dt;
      b.fractureCool = Math.max(0, b.fractureCool - dt);
      b.v.y -= g * dt;
    }
    this.collide();
    this.prestep(dt);
    for (const b of B) if (b.hinge && !b.sleeping) this.prepHinge(b, dt);
    for (let it = 0; it < ITER; it++) {
      this.solve();
      for (const b of B) if (b.hinge && !b.sleeping) this.solveHinge(b.hinge, b);
    }
    for (const c of this.contacts) {
      const w = this.cache.get(c.key);
      if (w) { w[0] = c.jn; w[1] = c.jt1; w[2] = c.jt2; } else this.cache.set(c.key, [c.jn, c.jt1, c.jt2]);
    }
    // Integrate
    for (const b of B) {
      if (b.sleeping) continue;
      const ws = b.w.length();
      if (ws > MAX_W) b.w.multiplyScalar(MAX_W / ws);
      const vs = b.v.length();
      if (vs > MAX_V) b.v.multiplyScalar(MAX_V / vs);
      b.x.addScaledVector(b.v, dt);
      const q = b.q, w = b.w, h = 0.5 * dt;
      const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
      q.x += h * (w.x * qw + w.y * qz - w.z * qy);
      q.y += h * (w.y * qw + w.z * qx - w.x * qz);
      q.z += h * (w.z * qw + w.x * qy - w.y * qx);
      q.w += h * (-w.x * qx - w.y * qy - w.z * qz);
      q.normalize();
      b.updateR();
      // Air and contact damping (only resting on something: a piece sliding down a wall falls
      // freely), then sleep once it has been still a while
      const touching = b.touching, rest = b.resting;
      const lin = rest ? 0.6 : 0.02, ang = rest ? 1.4 : touching ? 0.4 : 0.05;
      b.v.multiplyScalar(Math.max(0, 1 - lin * dt));
      b.w.multiplyScalar(Math.max(0, 1 - ang * dt));
      const slow = b.v.lengthSq() < 0.09 && b.w.lengthSq() < 0.004;
      b.still = slow && touching && !b.hinge ? b.still + dt : 0;
      if (b.still > 0.7) { b.sleeping = true; b.v.set(0, 0, 0); b.w.set(0, 0, 0); }
      if (b.hinge) this.hingeAngle(b, dt);
      // Flush against nothing any more once it has moved or turned a little
      const F = b.fresh;
      if (F && (b.age > 3 || b.x.distanceToSquared(F.x0) > F.r2 || Math.abs(b.q.dot(F.q0)) < 0.99966)) b.fresh = null;
    }
  }

  // ---- hinges ---------------------------------------------------------------------

  /**
   * Pin body b on the edge it tips over: wa the world point on the pivot line, axis the hinge
   * line (turning +axis tips the top toward the fall), Mr the moment the hinge resists with,
   * fading to nothing as it turns through yieldAng, and snapping at breakAng. The pin pushes
   * up and holds against sliding (with friction), it never pulls down; turning about the other
   * two axes is held still while it lasts.
   */
  setHinge(b, wa, axis, fall, Mr, yieldAng, breakAng, extra = {}) {
    const la = b.toLocal(wa.x, wa.y, wa.z, new V3());
    b.hinge = Object.assign({ wa: wa.clone(), la, axis: axis.clone().normalize(), fall: fall.clone().normalize(), up: new V3(0, 1, 0), Mr, yieldAng, breakAng,
      q0: b.q.clone(), ang: 0, jn: 0, jt1: 0, jt2: 0, ja: 0, jb: 0, jc: 0, r: new V3(), err: new V3(), broken: null, age: 0 }, extra);
    b.wake();
    return b.hinge;
  }

  prepHinge(b, dt) {
    const H = b.hinge;
    if (H.broken) return;
    H.age += dt;
    b.toWorld(H.la.x, H.la.y, H.la.z, _p);
    H.r.subVectors(_p, b.x);
    H.err.subVectors(_p, H.wa);
    const g = b.s.g, cell = (g.xs[g.nx] - g.xs[0]) / g.nx;
    // Slid or lifted clear of its edge: the hinge is gone
    if (H.err.length() > cell * 1.8) { H.broken = 'slid'; return; }
    H.mn = 1 / this.effMassBody(b, H.r, H.up);
    H.mt1 = 1 / this.effMassBody(b, H.r, H.fall);
    H.mt2 = 1 / this.effMassBody(b, H.r, H.axis);
    const k = BAUMGARTE / dt;
    H.bn = Math.min(6, k * Math.max(0, -H.err.y - cell * SLOP_K));
    H.bt1 = -k * 0.5 * H.err.dot(H.fall);
    H.bt2 = -k * 0.5 * H.err.dot(H.axis);
    H.ka = 1 / Math.max(1e-12, angMass(b, H.axis));
    H.kb = 1 / Math.max(1e-12, angMass(b, H.fall));
    H.kc = 1 / Math.max(1e-12, angMass(b, H.up));
    // The plastic moment it has left, as an impulse this step
    const a = Math.max(0, H.ang);
    H.lim = H.Mr * Math.max(0, 1 - a / H.yieldAng) * dt;
    // Warm start
    H.jn *= 0.85; H.jt1 *= 0.85; H.jt2 *= 0.85; H.ja *= 0.5;
    _t.copy(H.up).multiplyScalar(H.jn).addScaledVector(H.fall, H.jt1).addScaledVector(H.axis, H.jt2);
    applyBody(b, H.r, _t);
    turn(b, H.axis, H.ja);
  }

  solveHinge(H, b) {
    if (H.broken) return;
    // Pin: normal (push only), then the two tangents within friction
    b.pointVel(_p.addVectors(b.x, H.r), _va);
    let j0 = H.jn;
    H.jn = Math.max(0, j0 + (H.bn - _va.dot(H.up)) * H.mn);
    if (H.jn !== j0) applyBody(b, H.r, _t.copy(H.up).multiplyScalar(H.jn - j0));
    const lim = HINGE_MU * H.jn;
    b.pointVel(_p, _va);
    j0 = H.jt1;
    H.jt1 = Math.max(-lim, Math.min(lim, j0 + (H.bt1 - _va.dot(H.fall)) * H.mt1));
    if (H.jt1 !== j0) applyBody(b, H.r, _t.copy(H.fall).multiplyScalar(H.jt1 - j0));
    b.pointVel(_p, _va);
    j0 = H.jt2;
    H.jt2 = Math.max(-lim, Math.min(lim, j0 + (H.bt2 - _va.dot(H.axis)) * H.mt2));
    if (H.jt2 !== j0) applyBody(b, H.r, _t.copy(H.axis).multiplyScalar(H.jt2 - j0));
    // The hinge's own strength against turning about its line, and a line holds the other two
    j0 = H.ja;
    H.ja = Math.max(-H.lim, Math.min(H.lim, j0 - b.w.dot(H.axis) * H.ka));
    if (H.ja !== j0) turn(b, H.axis, H.ja - j0);
    turn(b, H.fall, -b.w.dot(H.fall) * H.kb);
    turn(b, H.up, -b.w.dot(H.up) * H.kc);
  }

  /** How far the body has turned about its hinge line since it was pinned, and whether it snapped */
  hingeAngle(b, dt) {
    const H = b.hinge, q = b.q, q0 = H.q0;
    // q * q0^-1
    const w = q.w * q0.w + q.x * q0.x + q.y * q0.y + q.z * q0.z;
    const x = -q.w * q0.x + q.x * q0.w - q.y * q0.z + q.z * q0.y;
    const y = -q.w * q0.y + q.x * q0.z + q.y * q0.w - q.z * q0.x;
    const z = -q.w * q0.z - q.x * q0.y + q.y * q0.x + q.z * q0.w;
    H.ang = 2 * Math.atan2(x * H.axis.x + y * H.axis.y + z * H.axis.z, w);
    if (!H.broken && H.ang > H.breakAng) H.broken = 'snapped';
    // Come to rest on its hinge (leaning on something): let it settle and sleep like the rest
    H.stillT = Math.abs(b.w.dot(H.axis)) < 0.002 && H.age > 0.6 ? (H.stillT || 0) + dt : 0;
    if (!H.broken && H.stillT > 0.6) H.broken = 'rest';
    // Turning back onto the stump: let the contacts there take it
    if (!H.broken && H.ang < -0.03) H.broken = 'back';
    if (!H.broken && H.age > 40) H.broken = 'age';
  }

  effMassBody(b, r, d) {
    _r.crossVectors(r, d); mulM3V(b.Iw, _r.x, _r.y, _r.z, _l); _l.cross(r);
    return b.im + _l.dot(d);
  }

  contact(a, b, px, py, pz, nx, ny, nz, depth, key, kind) {
    const c = this.pool.pop() || { ra: new V3(), rb: new V3(), n: new V3(), t1: new V3(), t2: new V3(), p: new V3() };
    c.a = a; c.b = b; c.p.set(px, py, pz); c.n.set(nx, ny, nz); c.depth = depth; c.key = key; c.kind = kind; c.slip = false;
    return c;
  }

  /** Probe contacts for every awake body against everything near it */
  collide() {
    for (const c of this.contacts) this.pool.push(c);
    this.contacts.length = 0;
    const B = this.bodies, env = this.env;
    const pairs = this.pairs;
    pairs.clear();
    for (const a of B) {
      a.touching = a.resting = false;
      if (a.sleeping) continue;
      const g = a.s.g, P = a.probes, np = P.length / 3;
      const cell = (g.xs[g.nx] - g.xs[0]) / g.nx;
      const pad = cell, base = a.id * OID, F = a.fresh, H = a.hinge && !a.hinge.broken ? a.hinge : null;
      // Ground
      let list = null;
      for (let i = 0; i < np; i++) {
        a.toWorld(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], _p);
        const gy = env.ground(_p.x, _p.z);
        if (_p.y < gy) (list || (list = [])).push(this.contact(a, null, _p.x, gy, _p.z, 0, 1, 0, gy - _p.y, base * PK + i, 'ground'));
      }
      if (list) pairs.set(base, list);
      // City boxes and standing structures
      env.statics(_t.copy(a.min).subScalar(pad), _r.copy(a.max).addScalar(pad), (s) => {
        const vox = s.vox;
        // Walls it was flush against when it broke away hold nothing up: only a real push into
        // them counts, and it slides along them freely
        const flush = F !== null && F.near.has(vox ? vox.owner : s.owner || s);
        // Pivoting on the stump: at the hinge line and behind it (lifting off) the hinge carries
        // it, not contacts. Ahead of it, touching the stump means the gap under it has closed
        const hs = H && vox === H.s ? H : null, stumpY = hs ? hs.wy + cell * 1.5 : -Infinity;
        const pk = base + (vox ? 40001 + (vox.id % 40000) : 1 + ((s.id ?? (s.id = NEXT_ID++)) % 40000));
        let list = pairs.get(pk) || null;
        const n0 = list ? list.length : 0;
        if (vox) {
          // Crushing down through it: no contacts, the structure gives way under it instead
          if (a.crushDown && a.crushDown.s === vox) return;
          const sg = vox.g;
          if (a.max.x < sg.xs[0] || a.min.x > sg.xs[sg.nx] || a.max.y < sg.ys[0] || a.min.y > sg.ys[sg.ny] || a.max.z < sg.zs[0] || a.min.z > sg.zs[sg.nz]) return;
          for (let i = 0; i < np; i++) {
            a.toWorld(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], _p);
            const ahead = hs ? (_p.x - hs.wa.x) * hs.fall.x + (_p.z - hs.wa.z) * hs.fall.z : 0;
            if (_p.y < stumpY && ahead < cell * 2) continue;
            const o = sg.pushOut(_p.x, _p.y, _p.z, 6, _out);
            if (!o) continue;
            if (hs && !hs.broken && ahead >= cell * 2 && o.depth > cell * 0.1) hs.broken = 'closed';
            const d = o.depth < 0 ? cell : o.depth;
            const side = flush && o.ny === 0;
            if (side && d < cell * 0.3) continue;
            const c = this.contact(a, s, _p.x + o.nx * d, _p.y + o.ny * d, _p.z + o.nz * d, o.nx, o.ny, o.nz, d, pk * PK + i, 'vox');
            c.slip = side;
            (list || (list = [])).push(c);
          }
        } else {
          const mn = s.min, mx = s.max;
          for (let i = 0; i < np; i++) {
            a.toWorld(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], _p);
            if (_p.x <= mn.x || _p.x >= mx.x || _p.y <= mn.y || _p.y >= mx.y || _p.z <= mn.z || _p.z >= mx.z) continue;
            // Out through the nearest face (not down through a floor)
            let d = mx.y - _p.y, nx = 0, ny = 1, nz = 0;
            if (_p.x - mn.x < d) { d = _p.x - mn.x; nx = -1; ny = 0; nz = 0; }
            if (mx.x - _p.x < d) { d = mx.x - _p.x; nx = 1; ny = 0; nz = 0; }
            if (_p.z - mn.z < d) { d = _p.z - mn.z; nx = 0; ny = 0; nz = -1; }
            if (mx.z - _p.z < d) { d = mx.z - _p.z; nx = 0; ny = 0; nz = 1; }
            if (_p.y - mn.y < d && mn.y > 0.5) { d = _p.y - mn.y; nx = 0; ny = -1; nz = 0; }
            const side = flush && ny === 0;
            if (side && d < cell * 0.3) continue;
            const c = this.contact(a, s, _p.x + nx * d, _p.y + ny * d, _p.z + nz * d, nx, ny, nz, d, pk * PK + i, 'box');
            c.slip = side;
            (list || (list = [])).push(c);
          }
        }
        if (list && list.length > n0) pairs.set(pk, list);
      });
    }
    // Body against body, probes of each inside the other
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j];
        if (a.sleeping && b.sleeping) continue;
        if (a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y || a.max.z < b.min.z || a.min.z > b.max.z) continue;
        const list = [];
        this.probeInto(a, b, list, 1);
        this.probeInto(b, a, list, -1);
        if (list.length) pairs.set(a.id * OID + 80001 + (b.id % 50000), list);
      }
    }
    this.manifolds.length = 0;
    for (const list of pairs.values()) {
      const kept = reduce(list, this.pool);
      this.manifolds.push(kept);
      for (const c of kept) {
        this.contacts.push(c);
        if (c.slip) continue;
        c.a.touching = true;
        if (c.n.y > 0.3) c.a.resting = true;
        if (c.b && c.b.isBody) { c.b.touching = true; if (c.n.y < -0.3) c.b.resting = true; }
      }
    }
  }

  /** Contacts from the probes of p inside body o; sign 1: a = p, b = o; -1: a = o, b = p */
  probeInto(p, o, list, sign) {
    const P = p.probes, np = P.length / 3, og = o.s.g;
    for (let i = 0; i < np; i++) {
      p.toWorld(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], _p);
      if (_p.x < o.min.x || _p.x > o.max.x || _p.y < o.min.y || _p.y > o.max.y || _p.z < o.min.z || _p.z > o.max.z) continue;
      o.toLocal(_p.x, _p.y, _p.z, _l);
      const r = og.pushOut(_l.x, _l.y, _l.z, 6, _out);
      if (!r) continue;
      let d = r.depth;
      o.dirWorld(r.nx, r.ny, r.nz, _n);
      if (d < 0) { _n.subVectors(p.x, o.x).normalize(); d = 0.5; }
      // Normal points from o toward p; contact a is p when sign > 0
      const key = (p.id * OID + 80001 + (o.id % 50000)) * PK + i;
      if (sign > 0) list.push(this.contact(p, o, _p.x + _n.x * d, _p.y + _n.y * d, _p.z + _n.z * d, _n.x, _n.y, _n.z, d, key, 'body'));
      else list.push(this.contact(o, p, _p.x, _p.y, _p.z, -_n.x, -_n.y, -_n.z, d, key, 'body'));
    }
  }

  prestep(dt) {
    const old = this.cache;
    this.cache = this.old;
    this.cache.clear();
    this.old = old;
    for (const b of this.bodies) { b.nimp = 0; b.impact = null; }
    for (const c of this.contacts) {
      const a = c.a, b = c.b && c.b.isBody ? c.b : null;
      c.bb = b;
      c.ra.subVectors(c.p, a.x);
      if (b) c.rb.subVectors(c.p, b.x);
      // Tangents
      const n = c.n;
      if (Math.abs(n.y) < 0.9) c.t1.set(0, 1, 0).cross(n).normalize(); else c.t1.set(1, 0, 0).cross(n).normalize();
      c.t2.crossVectors(n, c.t1);
      c.mn = 1 / this.effMass(c, n);
      c.mt1 = 1 / this.effMass(c, c.t1);
      c.mt2 = 1 / this.effMass(c, c.t2);
      // Approach speed for bounce and impact damage
      a.pointVel(c.p, _va);
      if (b) { b.pointVel(c.p, _vb); _va.sub(_vb); }
      const vn = _va.dot(n);
      c.vn0 = vn;
      const g = a.s.g, cell = (g.xs[g.nx] - g.xs[0]) / g.nx;
      c.bias = Math.min(6, (BAUMGARTE / dt) * Math.max(0, c.depth - cell * SLOP_K));
      if (vn < -2.5) c.bias = Math.max(c.bias, -0.12 * vn);
      // A piece only feels an impact from something at least a tenth its weight: rubble
      // squeezed out from under a falling block doesn't shatter it. The effective mass at the
      // point says how hard it lands there
      if (-vn > 0 && (!b || b.m > a.m * 0.1)) addImpact(a, -vn, c.p, n, 1, c.b, c.kind, c.mn, cell);
      if (b && -vn > 0 && a.m > b.m * 0.1) addImpact(b, -vn, c.p, n, -1, a, 'body', c.mn, cell);
      // Warm start
      const w = old.get(c.key);
      if (w) this.cache.set(c.key, w);
      c.jn = w ? w[0] * 0.85 : 0; c.jt1 = w ? w[1] * 0.85 : 0; c.jt2 = w ? w[2] * 0.85 : 0;
      if (c.jn || c.jt1 || c.jt2) {
        _t.copy(n).multiplyScalar(c.jn).addScaledVector(c.t1, c.jt1).addScaledVector(c.t2, c.jt2);
        this.apply(c, _t);
      }
    }
  }

  effMass(c, d) {
    const a = c.a, b = c.bb;
    let k = a.im;
    _r.crossVectors(c.ra, d); mulM3V(a.Iw, _r.x, _r.y, _r.z, _l); _l.cross(c.ra); k += _l.dot(d);
    if (b) { k += b.im; _r.crossVectors(c.rb, d); mulM3V(b.Iw, _r.x, _r.y, _r.z, _l); _l.cross(c.rb); k += _l.dot(d); }
    return k;
  }

  /** Apply impulse J (on a; -J on b) */
  apply(c, J) {
    const a = c.a, b = c.bb;
    a.v.addScaledVector(J, a.im);
    _r.crossVectors(c.ra, J); mulM3V(a.Iw, _r.x, _r.y, _r.z, _l); a.w.add(_l);
    if (b) {
      b.v.addScaledVector(J, -b.im);
      _r.crossVectors(c.rb, J); mulM3V(b.Iw, _r.x, _r.y, _r.z, _l); b.w.sub(_l);
      if (b.sleeping && J.lengthSq() * b.im * b.im > 0.04) b.wake();
    }
  }

  solve() {
    for (const c of this.contacts) {
      const a = c.a, b = c.bb;
      a.pointVel(c.p, _va);
      if (b) { b.pointVel(c.p, _vb); _va.sub(_vb); }
      // Normal
      const vn = _va.dot(c.n);
      let dj = (c.bias - vn) * c.mn;
      const jn0 = c.jn;
      c.jn = Math.max(0, jn0 + dj);
      dj = c.jn - jn0;
      if (dj) { _t.copy(c.n).multiplyScalar(dj); this.apply(c, _t); }
      // Friction
      const lim = c.slip ? 0 : FRICTION * c.jn;
      a.pointVel(c.p, _va);
      if (b) { b.pointVel(c.p, _vb); _va.sub(_vb); }
      let j0 = c.jt1;
      c.jt1 = Math.max(-lim, Math.min(lim, j0 - _va.dot(c.t1) * c.mt1));
      if (c.jt1 !== j0) { _t.copy(c.t1).multiplyScalar(c.jt1 - j0); this.apply(c, _t); }
      a.pointVel(c.p, _va);
      if (b) { b.pointVel(c.p, _vb); _va.sub(_vb); }
      j0 = c.jt2;
      c.jt2 = Math.max(-lim, Math.min(lim, j0 - _va.dot(c.t2) * c.mt2));
      if (c.jt2 !== j0) { _t.copy(c.t2).multiplyScalar(c.jt2 - j0); this.apply(c, _t); }
    }
  }
}

/** Keep the deepest contact, then the ones spreading farthest from those kept (the rest go back to the pool) */
let DIST = new Float64Array(256);
function reduce(list, pool) {
  if (list.length <= MAX_CONTACTS) return list;
  const n = list.length;
  if (DIST.length < n) DIST = new Float64Array(n * 2);
  let bi = 0;
  for (let i = 1; i < n; i++) if (list[i].depth > list[bi].depth) bi = i;
  const kept = [list[bi]];
  const best = list[bi].p;
  for (let i = 0; i < n; i++) DIST[i] = list[i].p.distanceToSquared(best);
  DIST[bi] = -1;
  while (kept.length < MAX_CONTACTS) {
    let k = -1, bd = 1e-6;
    for (let i = 0; i < n; i++) if (DIST[i] > bd) { bd = DIST[i]; k = i; }
    if (k < 0) break;
    const c = list[k];
    kept.push(c);
    DIST[k] = -1;
    for (let i = 0; i < n; i++) if (DIST[i] > 0) DIST[i] = Math.min(DIST[i], list[i].p.distanceToSquared(c.p));
  }
  for (let i = 0; i < n; i++) if (DIST[i] !== -1) pool.push(list[i]);
  return kept;
}

/** Keep the hardest impacts on a body this step, one per patch a few cells across */
function addImpact(b, speed, p, n, sign, other, kind, meff, cell) {
  const L = b.imps, r2 = cell * cell * 16;
  let k = -1;
  for (let i = 0; i < b.nimp; i++) if (L[i].point.distanceToSquared(p) < r2) { k = i; break; }
  if (k >= 0) { if (speed <= L[k].speed) return; } else if (b.nimp < MAX_IMPACTS) {
    k = b.nimp++;
    if (!L[k]) L[k] = { speed: 0, point: new V3(), normal: new V3(), other: null, kind: '', meff: 0 };
  } else {
    k = 0;
    for (let i = 1; i < MAX_IMPACTS; i++) if (L[i].speed < L[k].speed) k = i;
    if (speed <= L[k].speed) return;
  }
  const I = L[k];
  I.speed = speed; I.point.copy(p); I.normal.copy(n).multiplyScalar(sign); I.other = other; I.kind = kind; I.meff = meff;
  if (!b.impact || speed > b.impact.speed) b.impact = I;
}

/** Inverse angular mass of b about world axis d */
function angMass(b, d) { mulM3V(b.Iw, d.x, d.y, d.z, _l); return d.dot(_l); }

/** Impulse J at offset r from b's center */
function applyBody(b, r, J) {
  b.v.addScaledVector(J, b.im);
  _r.crossVectors(r, J); mulM3V(b.Iw, _r.x, _r.y, _r.z, _l); b.w.add(_l);
}

/** Angular impulse j about world axis d */
function turn(b, d, j) {
  if (!j) return;
  mulM3V(b.Iw, d.x * j, d.y * j, d.z * j, _l); b.w.add(_l);
}
