import * as THREE from './three.js';
import { BODY } from './playerBody.js';

// ---------------------------------------------------------------------------
// Street and park trees.
//
// A standing tree is scenery the mech plows through: touching one rips it out
// of the ground, leaving a stump, and it tumbles away as a rigid body. Three
// spheres along the trunk (root ball, trunk, canopy) carry its contacts with
// the ground, walls and the mech, so a fallen tree rests tilted on its canopy
// and rolls in arcs when the mech kicks it along.
//
// Anything that could set a tree alight (bolts, bullets, beams, blasts, spider
// and scorpion fire) knocks it loose and sets it burning. A burning tree chars
// and loses its leaves, and passes the fire to any standing tree it rolls into.
//
// Trunks, leaf blobs and stumps are three InstancedMeshes for the whole city.
// World files the trees on its spatial grid so rays and blasts can find them.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const GRAVITY = 30;
const SUBSTEP = 1 / 120;
const EMBER = [0.34, 0.11, 0.03], CHAR_LEAF = [0.05, 0.045, 0.04], CHAR_WOOD = [0.07, 0.05, 0.04];
const rand = (a, b) => a + Math.random() * (b - a);
const mix = (a, b, t) => a + (b - a) * t;

const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _j = new V3(), _n = new V3(), _p = new V3(), _r = new V3(), _s = new V3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _col = new THREE.Color();
const ID_Q = new THREE.Quaternion();

/** Distance along a unit ray to where it enters a sphere, or -1 (a ray starting inside misses) */
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc < 0) return -1;
  const h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/** Distance along a unit ray to where it enters a capsule from a to b, or -1 */
function rayCapsule(o, d, a, b, r) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z;
  const ox = o.x - a.x, oy = o.y - a.y, oz = o.z - a.z;
  const baba = bx * bx + by * by + bz * bz, bard = bx * d.x + by * d.y + bz * d.z, baoa = bx * ox + by * oy + bz * oz;
  const k2 = baba - bard * bard;
  if (k2 > 1e-9) {
    const k1 = baba * (ox * d.x + oy * d.y + oz * d.z) - baoa * bard;
    const k0 = baba * (ox * ox + oy * oy + oz * oz) - baoa * baoa - r * r * baba;
    const h = k1 * k1 - k2 * k0;
    if (h < 0) return -1;
    const t = (-k1 - Math.sqrt(h)) / k2;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
  }
  // Past the ends of the body: the end caps
  const ta = raySphere(o, d, a, r), tb = raySphere(o, d, b, r);
  return ta < 0 ? tb : tb < 0 ? ta : Math.min(ta, tb);
}

/** Closest point to p on segment ab */
function closestOnSegment(p, a, b, out) {
  out.subVectors(b, a);
  const L = out.lengthSq();
  const t = L > 1e-9 ? Math.max(0, Math.min(1, _e.subVectors(p, a).dot(out) / L)) : 0;
  return out.multiplyScalar(t).add(a);
}

let VSTAMP = 0;
const _vo = {};

export class Trees {
  /** spots: from City.tree(). blocks: low boxes trees land on that the mech walks through. */
  constructor(city, spots, blocks) {
    this.city = city;
    this.fx = city.fx;
    this.sound = city.sound;
    this.blocks = blocks;
    this.world = null; // set by World once its grid exists
    this.hitN = new V3(); // surface normal of the last rayHit
    this.list = [];
    this.loose = [];

    const n = spots.length;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.15 });
    const mk = (geo, count) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false; // instances roll away from where the bounds were taken
      city.scene.add(m);
      return m;
    };
    this.trunkMesh = mk(new THREE.CylinderGeometry(1, 1, 1, 6, 1), n);
    this.leafMesh = mk(new THREE.IcosahedronGeometry(1, 0), n * 3);
    const stump = new THREE.CylinderGeometry(0.85, 1, 1, 6, 1);
    stump.translate(0, 0.5, 0);
    this.stumpMesh = mk(stump, n);
    // Colors up front so all three meshes compile the same instanced-color shader
    for (let i = 0; i < n; i++) this.stumpMesh.setColorAt(i, _col.setRGB(1, 1, 1));
    this.stumpMesh.count = 0;

    spots.forEach((sp, i) => {
      const u = sp.u; // game units per meter at this tree's size
      const t = {
        kind: 'tree', alive: true, i, u,
        base: new V3(sp.x, sp.y, sp.z),
        trunkColor: sp.trunk,
        blobs: sp.blobs.map((b) => Object.assign({ q: new THREE.Quaternion().setFromEuler(new THREE.Euler(b.rx, b.ry, 0)) }, b)),
        trunkR: 0.35 * u, trunkH: 4 * u, canopyY: 6.1 * u, canopyR: 2.9 * u,
        com: 4 * u, // center of mass, above the base
        // Contact spheres: [height above the base, radius]
        spheres: [[0.35 * u, 0.35 * u], [2.4 * u, 0.35 * u], [6.1 * u, 2.9 * u]],
        // Inverse inertia (unit mass) across the trunk and about it
        iIp: 1 / (11 * u * u), iIa: 1 / (2.2 * u * u),
        loose: false, asleep: false, rest: 0,
        pos: new V3(), vel: new V3(), w: new V3(), q: new THREE.Quaternion(),
        burn: 0, char: 0, smolder: 0, leaf: 1, recolor: true,
        // World points for rays and blasts: trunk base and top, canopy center
        A: new V3(), B: new V3(), C: new V3(), box: { x0: 0, z0: 0, x1: 0, z1: 0 },
        cells: null, stamp: 0,
      };
      this.points(t);
      this.draw(t);
      this.list.push(t);
    });
    this.flushMeshes(true);
  }

  // ---- shape -------------------------------------------------------------------

  /** World position of a point on the trunk axis, h above the base */
  axisPoint(t, h, out) {
    if (!t.loose) return out.set(t.base.x, t.base.y + h, t.base.z);
    return out.set(0, h - t.com, 0).applyQuaternion(t.q).add(t.pos);
  }

  /** Refresh the world points and the XZ bounds the grid files the tree under */
  points(t) {
    this.axisPoint(t, 0, t.A);
    this.axisPoint(t, t.trunkH, t.B);
    this.axisPoint(t, t.canopyY, t.C);
    const R = t.canopyR * 1.3, b = t.box;
    b.x0 = Math.min(t.A.x, t.C.x) - R; b.x1 = Math.max(t.A.x, t.C.x) + R;
    b.z0 = Math.min(t.A.z, t.C.z) - R; b.z1 = Math.max(t.A.z, t.C.z) + R;
  }

  /** Ray hit distance under `best`, or -1. Sets hitN. */
  rayHit(t, o, d, best, pad = 0) {
    let tt = best, part = 0;
    const ts = raySphere(o, d, t.C, t.canopyR * t.leaf + pad);
    if (ts >= 0 && ts < tt) { tt = ts; part = 1; }
    const tc = rayCapsule(o, d, t.A, t.B, t.trunkR * 1.5 + pad);
    if (tc >= 0 && tc < tt) { tt = tc; part = 2; }
    if (!part) return -1;
    _p.copy(o).addScaledVector(d, tt);
    if (part === 1) this.hitN.subVectors(_p, t.C);
    else this.hitN.subVectors(_p, closestOnSegment(_p, t.A, t.B, _a));
    if (this.hitN.lengthSq() < 1e-9) this.hitN.copy(d).negate();
    this.hitN.normalize();
    return tt;
  }

  /** Distance from p to the tree's surface (0 inside it) */
  distTo(t, p) {
    const dc = p.distanceTo(t.C) - t.canopyR * t.leaf;
    const dt = p.distanceTo(closestOnSegment(p, t.A, t.B, _a)) - t.trunkR;
    return Math.max(0, Math.min(dc, dt));
  }

  // ---- what breaks them ------------------------------------------------------

  /** A shot struck the tree at `point`: knock it loose, push it away from the shot, set it alight */
  hit(t, amount, point) {
    _n.subVectors(t.C, point).setY(0);
    if (_n.lengthSq() < 1e-6) _n.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _n.normalize();
    if (!t.loose) {
      const k = 2 + Math.min(8, amount * 0.1);
      this.uproot(t, _n.x * k, 1.5 + k * 0.3, _n.z * k, k / t.com);
    } else {
      this.wake(t);
      this.apply(t, _r.subVectors(point, t.pos), _j.copy(_n).multiplyScalar(Math.min(6, amount * 0.1)));
    }
    this.ignite(t);
    return false;
  }

  /** An explosion: every tree within `radius` is thrown loose and set burning */
  blast(point, radius, amount) {
    if (!this.world) return;
    const o = _s.copy(point), hits = [];
    this.world.queryTrees(o.x - radius, o.z - radius, o.x + radius, o.z + radius, (t) => {
      const d = this.distTo(t, o);
      if (d < radius) hits.push([t, d]);
    });
    for (const [t, d] of hits) {
      const f = 1 - d / radius;
      const k = (4 + amount * 0.15) * (0.4 + 0.6 * f);
      _n.subVectors(t.C, o).setY(0);
      if (_n.lengthSq() < 1e-6) _n.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _n.normalize();
      if (!t.loose) this.uproot(t, _n.x * k, k * 0.55, _n.z * k, k / t.com);
      else {
        this.wake(t);
        _n.y = 0.6;
        this.apply(t, _r.subVectors(t.C, t.pos), _j.copy(_n).multiplyScalar(k));
      }
      this.ignite(t);
    }
  }

  /** Tear a standing tree out of the ground with a starting velocity, toppling away from it */
  uproot(t, vx, vy, vz, spin) {
    if (t.loose) return;
    t.loose = true;
    t.q.identity();
    t.pos.set(t.base.x, t.base.y + t.com, t.base.z);
    t.vel.set(vx, vy, vz);
    // Spin about the level axis across the push, so the crown goes over first
    const h = Math.hypot(vx, vz) || 1;
    t.w.set(vz / h, 0, -vx / h).multiplyScalar(spin * 0.8);
    t.w.y = rand(-1, 1);
    this.wake(t);
    this.loose.push(t);
    // The stump left behind
    const si = this.stumpMesh.count++;
    _q.setFromAxisAngle(_a.set(0, 1, 0), Math.random() * 6.28);
    _m.compose(t.base, _q, _b.set(t.trunkR * 1.08, t.u * rand(0.35, 0.6), t.trunkR * 1.08));
    this.stumpMesh.setMatrixAt(si, _m);
    const k = 0.6;
    this.stumpMesh.setColorAt(si, _col.setRGB(t.trunkColor[0] * k, t.trunkColor[1] * k, t.trunkColor[2] * k));
    this.stumpsDirty = true;
    // Dirt from the roots, leaves shaken from the crown
    const fx = this.fx;
    fx.dust(t.base, 0.45, 6);
    for (let i = 0; i < 10; i++) {
      const b = t.blobs[i % 3], g = 0.8;
      _a.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize().multiplyScalar(t.canopyR * rand(0.3, 0.9)).add(t.C);
      fx.smoke.emit(_a.x, _a.y, _a.z, vx * 0.3 + rand(-3, 3), rand(0, 3), vz * 0.3 + rand(-3, 3), rand(1.4, 2.4), 0.45, 0.3,
        b.color[0] * g, b.color[1] * g, b.color[2] * g, 0.95, b.color[0] * g, b.color[1] * g, b.color[2] * g, 0, 1.6, -5, rand(-4, 4));
    }
    this.sound.treeSnap(t.base);
  }

  ignite(t) {
    if (t.burn > 0 || t.char >= 1) return; // already burning, or burnt out
    t.burn = rand(14, 22);
    const fx = this.fx, u = t.u, R = t.canopyR;
    fx.flash(t.C, R * 2.6, 0xff9a40, 0.2);
    for (let i = 0; i < 18; i++) {
      _a.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(R * rand(0.2, 0.9)).add(t.C);
      fx.fire.emit(_a.x, _a.y, _a.z, rand(-2, 2), rand(2, 6) * u, rand(-2, 2), rand(0.3, 0.6), 1.8 * u, 0.6 * u, 3.2, 1.8, 0.6, 1, 1, 0.25, 0.05, 0, 0.5, 2);
    }
    this.sound.ignite(t.C);
  }

  wake(t) { t.asleep = false; t.rest = 0; }

  // ---- rigid body --------------------------------------------------------------

  /** World inverse inertia applied to v, in place */
  invI(t, v) {
    _qi.copy(t.q).invert();
    v.applyQuaternion(_qi);
    v.x *= t.iIp; v.y *= t.iIa; v.z *= t.iIp;
    return v.applyQuaternion(t.q);
  }

  /** n · ((I⁻¹ (r × n)) × r): how much spin soaks up an impulse along n at r */
  angular(t, r, n) {
    const x = this.invI(t, _c.crossVectors(r, n));
    return _d.crossVectors(x, r).dot(n);
  }

  /** Impulse j at offset r from the center of mass (unit mass) */
  apply(t, r, j) {
    t.vel.add(j);
    t.w.add(this.invI(t, _c.crossVectors(r, j)));
  }

  /** Resolve a contact at world point p with surface normal n. Returns the closing speed. */
  contact(t, p, n, bounce, mu) {
    const r = _r.subVectors(p, t.pos);
    const v = _a.crossVectors(t.w, r).add(t.vel);
    const vn = v.dot(n);
    if (vn >= 0) return 0;
    const jn = -(1 + (vn < -4 ? bounce : 0)) * vn / (1 + this.angular(t, r, n));
    this.apply(t, r, _j.copy(n).multiplyScalar(jn));
    // Friction against the sliding velocity at the contact turns sliding into rolling
    v.crossVectors(t.w, r).add(t.vel);
    const tv = _b.copy(v).addScaledVector(n, -v.dot(n));
    const ts = tv.length();
    if (ts > 1e-5) {
      tv.divideScalar(ts);
      const jt = Math.min(ts / (1 + this.angular(t, r, tv)), mu * jn);
      this.apply(t, r, _j.copy(tv).multiplyScalar(-jt));
    }
    return -vn;
  }

  /** Push the contact spheres out of the ground, walls, the play-area edge and the mech */
  collide(t, ctx) {
    let touching = false;
    const P = ctx.player, mv = ctx.vel, B = this.city.bounds;
    for (const [h, r] of t.spheres) {
      const c = this.axisPoint(t, h, _p), stamp = ++VSTAMP;
      // Ground: the highest box top under the sphere's center that it is above
      let g = 0;
      const D = this.world.destruct;
      const wall = (b) => {
        if (b.walk) return;
        // A building being shot apart: its real floors and walls, not its box
        if (b.vox) {
          const s = b.vox;
          if (!D || s.dead || s.tstamp === stamp) return;
          s.tstamp = stamp;
          const top = D.floorUnder(s, c.x, c.z, c.y - r + 0.4, r * 0.6, 0);
          if (top > g) g = top;
          const o = s.g.pushOut(c.x, c.y, c.z, 4, _vo);
          if (o && o.ny === 0 && o.depth >= 0) {
            const push = o.depth + r * 0.5;
            t.pos.x += o.nx * push; t.pos.z += o.nz * push;
            c.x += o.nx * push; c.z += o.nz * push;
            this.contact(t, _e.set(c.x - o.nx * r, c.y, c.z - o.nz * r), _n.set(o.nx, 0, o.nz), 0.3, 0.4);
            touching = true;
          }
          return;
        }
        const inside = c.x > b.min.x && c.x < b.max.x && c.z > b.min.z && c.z < b.max.z;
        if (c.y - r >= b.max.y - 0.4) { if (inside && b.max.y > g) g = b.max.y; return; }
        if (c.y + r <= b.min.y) return;
        // A wall: push out sideways
        const cx = Math.max(b.min.x, Math.min(c.x, b.max.x)), cz = Math.max(b.min.z, Math.min(c.z, b.max.z));
        let dx = c.x - cx, dz = c.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        let push;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          dx /= d; dz /= d; push = r - d;
        } else {
          const ox0 = c.x - b.min.x, ox1 = b.max.x - c.x, oz0 = c.z - b.min.z, oz1 = b.max.z - c.z;
          const o = Math.min(ox0, ox1, oz0, oz1);
          dx = o === ox0 ? -1 : o === ox1 ? 1 : 0;
          dz = dx ? 0 : o === oz0 ? -1 : 1;
          push = o + r;
        }
        t.pos.x += dx * push; t.pos.z += dz * push;
        c.x += dx * push; c.z += dz * push;
        this.contact(t, _e.set(c.x - dx * r, c.y, c.z - dz * r), _n.set(dx, 0, dz), 0.3, 0.4);
        touching = true;
      };
      this.world.query(c.x - r, c.z - r, c.x + r, c.z + r, wall);
      for (const b of this.blocks) {
        if (b.max.x > c.x - r && b.min.x < c.x + r && b.max.z > c.z - r && b.min.z < c.z + r) wall(b);
      }
      const pen = g + r - c.y;
      if (pen > 0) {
        t.pos.y += pen;
        c.y += pen;
        const hitV = this.contact(t, _e.set(c.x, g, c.z), _n.set(0, 1, 0), 0.25, 0.7);
        if (hitV > 7) {
          this.fx.dust(_e, Math.min(1, hitV / 20) * (r > t.trunkR * 2 ? 0.8 : 0.4), 5);
          this.sound.treeThud(_e, Math.min(1, hitV / 18));
        }
        touching = true;
      }
      // Edge of the play area
      for (let k = 0; k < 2; k++) {
        const ax = k ? 'z' : 'x', lo = k ? B.minZ : B.minX, hi = k ? B.maxZ : B.maxX;
        const s = c[ax] < lo + r ? 1 : c[ax] > hi - r ? -1 : 0;
        if (!s) continue;
        const push = s > 0 ? lo + r - c[ax] : hi - r - c[ax];
        t.pos[ax] += push; c[ax] += push;
        _n.set(0, 0, 0)[ax] = s;
        this.contact(t, _e.copy(c).addScaledVector(_n, -r), _n, 0.3, 0.4);
      }
      // The mech kicks it along: at least as fast as the mech is moving into it, with a little lift
      if (P && c.y + r > P.y && c.y - r < P.y + BODY.h) {
        let dx = c.x - P.x, dz = c.z - P.z;
        const d = Math.hypot(dx, dz), min = BODY.r + r;
        if (d < min && d > 1e-4) {
          dx /= d; dz /= d;
          t.pos.x += dx * (min - d); t.pos.z += dz * (min - d);
          c.x += dx * (min - d); c.z += dz * (min - d);
          const rr = _r.set(c.x - dx * r, c.y, c.z - dz * r).sub(t.pos);
          const vn = _a.crossVectors(t.w, rr).add(t.vel).dot(_n.set(dx, 0, dz));
          const want = Math.max(0, (mv ? mv.x * dx + mv.z * dz : 0)) * 1.2 + 1.5;
          if (vn < want) {
            const jn = (want - vn) / (1 + this.angular(t, rr, _n));
            this.apply(t, rr, _j.set(dx * jn, jn * 0.25, dz * jn));
            if (jn > 5) this.sound.treeThud(c, Math.min(1, jn / 20));
          }
          touching = true;
        }
      }
    }
    return touching;
  }

  /** Whether any of a fallen tree's contact spheres is inside the mech's cylinder */
  touchesMech(t, P) {
    for (const [h, r] of t.spheres) {
      const c = this.axisPoint(t, h, _p);
      if (c.y + r <= P.y || c.y - r >= P.y + BODY.h) continue;
      if (Math.hypot(c.x - P.x, c.z - P.z) < BODY.r + r) return true;
    }
    return false;
  }

  step(t, dt, ctx) {
    const n = Math.max(1, Math.ceil(dt / SUBSTEP)), h = dt / n;
    let touching = false;
    for (let k = 0; k < n; k++) {
      t.vel.y -= GRAVITY * h;
      t.pos.addScaledVector(t.vel, h);
      const wl = t.w.length();
      if (wl > 1e-6) t.q.premultiply(_q.setFromAxisAngle(_a.copy(t.w).divideScalar(wl), wl * h)).normalize();
      if (this.collide(t, ctx)) touching = true;
    }
    // Rolling resistance, then sleep once it settles
    if (touching) {
      t.w.multiplyScalar(Math.exp(-dt * 0.9));
      const f = Math.exp(-dt * 0.35);
      t.vel.x *= f; t.vel.z *= f;
    }
    const calm = touching && t.vel.lengthSq() < 0.09 && t.w.lengthSq() < 0.09;
    t.rest = calm ? t.rest + dt : 0;
    if (t.rest > 0.6) { t.asleep = true; t.vel.set(0, 0, 0); t.w.set(0, 0, 0); }
    // Falling out of the world for any reason: settle it back on the street
    if (t.pos.y < -20) { t.pos.set(t.base.x, t.com, t.base.z); t.vel.set(0, 0, 0); t.w.set(0, 0, 0); }
  }

  /** A rolling tree that runs into a standing one knocks it down, and spreads its fire */
  knock(t, out) {
    if (t.vel.lengthSq() < 6) return;
    const C = t.C, R = t.canopyR * t.leaf;
    this.world.queryTrees(C.x - R, C.z - R, C.x + R, C.z + R, (o) => {
      if (o.loose || o === t) return;
      if (Math.hypot(o.base.x - C.x, o.base.z - C.z) > R * 0.8 + o.trunkR) return;
      if (C.y - R > o.base.y + o.canopyY + o.canopyR * 0.5 || C.y + R < o.base.y) return;
      out.push(o);
    });
  }

  // ---- per frame ------------------------------------------------------------------

  /** ctx: { player: V3 (feet), vel: V3 } */
  update(dt, ctx) {
    if (!this.world) return;
    const P = ctx.player, mv = ctx.vel;
    // The mech rips out any standing tree it walks into, and wakes any fallen one it touches
    // (the kick itself happens in collide(), which only runs for trees that are awake)
    const struck = [];
    if (P) {
      this.world.queryTrees(P.x - 6, P.z - 6, P.x + 6, P.z + 6, (t) => {
        if (t.loose) {
          if (t.asleep && this.touchesMech(t, P)) this.wake(t);
          return;
        }
        const d = Math.hypot(t.base.x - P.x, t.base.z - P.z);
        if (d > BODY.r + t.trunkR + t.canopyR * 0.5) return;
        if (P.y > t.base.y + t.canopyY + t.canopyR * 0.7 || P.y + BODY.h < t.base.y) return;
        struck.push(t);
      });
    }
    for (const t of struck) {
      // Thrown along the way the mech is moving, a little away from its center
      const rx = (t.base.x - P.x), rz = (t.base.z - P.z), rl = Math.hypot(rx, rz) || 1;
      const sp = mv ? Math.hypot(mv.x, mv.z) : 0;
      let dx = rx / rl, dz = rz / rl;
      if (sp > 1) { dx = mv.x / sp * 0.75 + dx * 0.25; dz = mv.z / sp * 0.75 + dz * 0.25; }
      const dl = Math.hypot(dx, dz) || 1, k = Math.max(4, sp * 1.1);
      this.uproot(t, dx / dl * k, 2 + sp * 0.08, dz / dl * k, k / t.com);
    }

    const knocked = [];
    for (const t of this.loose) {
      if (!t.asleep) {
        this.step(t, dt, ctx);
        this.points(t);
        this.world.binTree(t);
        t.dirty = true;
        const before = knocked.length;
        this.knock(t, knocked);
        for (let i = before; i < knocked.length; i++) {
          const o = knocked[i];
          o.from = t;
        }
        if (knocked.length > before) t.vel.multiplyScalar(0.75);
      }
      if (t.burn > 0 || t.smolder > 0) this.burnFx(t, dt, P);
      if (t.dirty || t.recolor) this.draw(t);
    }
    for (const o of knocked) {
      if (o.loose) continue;
      const t = o.from;
      o.from = null;
      this.uproot(o, t.vel.x * 0.6, 1.5, t.vel.z * 0.6, Math.hypot(t.vel.x, t.vel.z) * 0.6 / o.com);
      if (t.burn > 0) this.ignite(o);
    }
    this.flushMeshes();
  }

  burnFx(t, dt, P) {
    if (t.burn > 0) {
      t.burn -= dt;
      if (t.char < 1) {
        t.char = Math.min(1, t.char + dt / 7);
        t.leaf = 1 - 0.45 * t.char;
        t.recolor = t.dirty = true;
      }
      if (t.burn <= 0) t.smolder = 10;
    } else t.smolder -= dt;
    if (P && t.C.distanceToSquared(P) > 180 * 180) return;
    const fx = this.fx, u = t.u, C = t.C, R = t.canopyR * t.leaf;
    if (t.burn > 0) {
      const k = Math.min(1, t.burn / 4);
      // Flames through the crown
      if (Math.random() < dt * 40) {
        _a.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(R * Math.sqrt(Math.random()) * 0.8).add(C);
        fx.fire.emit(_a.x, _a.y, _a.z, rand(-1, 1), rand(2, 4) * u, rand(-1, 1), rand(0.45, 0.85), 2.2 * u * k, 0.6 * u, 3, 1.5, 0.45, 0.9, 1, 0.22, 0.05, 0, 0, 1.5);
      }
      // and up the trunk
      if (Math.random() < dt * 10) {
        _a.lerpVectors(t.A, t.B, Math.random());
        fx.fire.emit(_a.x, _a.y, _a.z, rand(-0.5, 0.5), 2 * u, rand(-0.5, 0.5), rand(0.3, 0.6), 1.1 * u * k, 0.3 * u, 3, 1.4, 0.4, 0.9, 1, 0.2, 0.05, 0, 0, 1);
      }
      // Rising embers
      if (Math.random() < dt * 6) {
        _a.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).multiplyScalar(R * 0.7).add(C);
        fx.sparks.emit(_a.x, _a.y, _a.z, rand(-2, 2), rand(3, 7), rand(-2, 2), rand(0.7, 1.5), 0.14, 0.05, 3, 1.4, 0.4, 1, 1, 0.3, 0.05, 0, 0.6, 2);
      }
      // Smoke column
      if (Math.random() < dt * 10) {
        fx.smoke.emit(C.x + rand(-0.5, 0.5) * R, C.y + R * 0.4, C.z + rand(-0.5, 0.5) * R, rand(-1, 1), rand(3, 5) * u, rand(-1, 1),
          3.5, 1.6 * u, 6.5 * u, 0.12, 0.11, 0.1, 0.65 * k + 0.2, 0.3, 0.3, 0.3, 0, 0.3, 0.3, rand(-0.6, 0.6));
      }
    } else if (Math.random() < dt * 5 * (t.smolder / 10)) {
      // A burnt-out tree smolders for a while
      fx.smoke.emit(C.x, C.y, C.z, rand(-0.5, 0.5), 2 * u, rand(-0.5, 0.5), 3, 1 * u, 4 * u, 0.2, 0.19, 0.18, 0.45, 0.35, 0.35, 0.35, 0, 0.3, 0.3, rand(-0.6, 0.6));
    }
  }

  // ---- drawing -------------------------------------------------------------------

  draw(t) {
    // Tree frame: origin at the base of the trunk
    if (t.loose) _w.compose(this.axisPoint(t, 0, _a), t.q, _s.set(1, 1, 1));
    else _w.compose(t.base, ID_Q, _s.set(1, 1, 1));
    _m.compose(_b.set(0, t.trunkH / 2, 0), ID_Q, _s.set(t.trunkR, t.trunkH, t.trunkR));
    this.trunkMesh.setMatrixAt(t.i, _m.premultiply(_w));
    // Leaves shrink in toward the middle of the crown as they burn away
    const L = t.leaf;
    for (let k = 0; k < 3; k++) {
      const b = t.blobs[k];
      _b.set(b.x * L, t.canopyY + (b.y - t.canopyY) * L, b.z * L);
      _m.compose(_b, b.q, _s.set(b.s * L, b.s * 0.85 * L, b.s * L));
      this.leafMesh.setMatrixAt(t.i * 3 + k, _m.premultiply(_w));
    }
    t.dirty = false;
    this.matsDirty = true;
    if (!t.recolor) return;
    t.recolor = false;
    this.colorsDirty = true;
    // Green to glowing ember to char, as the fire takes hold
    const f = t.char, e = Math.min(1, f / 0.4), c = Math.max(0, (f - 0.4) / 0.6);
    for (let k = 0; k < 3; k++) {
      const col = t.blobs[k].color;
      _col.setRGB(
        mix(mix(col[0], EMBER[0], e), CHAR_LEAF[0], c),
        mix(mix(col[1], EMBER[1], e), CHAR_LEAF[1], c),
        mix(mix(col[2], EMBER[2], e), CHAR_LEAF[2], c));
      this.leafMesh.setColorAt(t.i * 3 + k, _col);
    }
    const w = t.trunkColor;
    this.trunkMesh.setColorAt(t.i, _col.setRGB(mix(w[0], CHAR_WOOD[0], f), mix(w[1], CHAR_WOOD[1], f), mix(w[2], CHAR_WOOD[2], f)));
  }

  flushMeshes(all) {
    if (this.matsDirty || all) {
      this.trunkMesh.instanceMatrix.needsUpdate = this.leafMesh.instanceMatrix.needsUpdate = true;
      this.matsDirty = false;
    }
    if (this.colorsDirty || all) {
      this.trunkMesh.instanceColor.needsUpdate = this.leafMesh.instanceColor.needsUpdate = true;
      this.colorsDirty = false;
    }
    if (this.stumpsDirty) {
      this.stumpMesh.instanceMatrix.needsUpdate = true;
      this.stumpMesh.instanceColor.needsUpdate = true;
      this.stumpsDirty = false;
    }
  }
}
