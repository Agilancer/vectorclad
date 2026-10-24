import * as THREE from './three.js';

// ---------------------------------------------------------------------------
// Furniture: what the rooms of a broken building hold.
//
// Sixteen pieces modeled from boxes and cylinders, in meters: desks, office
// and dining chairs, computer monitors, filing cabinets, bookshelves full of
// books, water coolers and potted plants for the offices; sofas, armchairs,
// beds, tables, televisions, fridges, wardrobes and floor lamps for the homes.
// Each kind is one InstancedMesh with its parts' colors in the vertices and a
// tint per piece.
//
// When a building is first broken open (js/people.js fills it with people at
// the same time), the floors round the hole are furnished, offices or homes
// by the kind of building. Blasts throw the pieces out through the holes,
// tumbling, and a piece whose floor is shot out from under it falls. They
// bounce, slide and come to rest on the street, on rubble or on the floors
// below.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _v = new V3(), _w = new V3(), _e = new THREE.Euler(), _col = new THREE.Color();

/** A model from parts: [shape, sx, sy, sz, x, y, z, color, rx?, ry?, rz?] (box or cyl), origin on the floor */
function build(parts) {
  const geos = [];
  for (const [shape, sx, sy, sz, x, y, z, color, rx = 0, ry = 0, rz = 0] of parts) {
    const g = shape === 'cyl' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 10) : shape === 'cone' ? new THREE.ConeGeometry(0.5, 1, 10, 1, true)
      : shape === 'ball' ? new THREE.IcosahedronGeometry(0.5, 1) : new THREE.BoxGeometry(1, 1, 1);
    g.scale(sx, sy, sz);
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
    g.translate(x, y, z);
    const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingBox();
  return geo;
}

const WOOD = '#8a5a34', DARKWOOD = '#4a2f1d', STEEL = '#8d939a', BLACK = '#1d1e20', WHITE = '#e9e7e2', FABRIC = '#6b7a8f';
const legs4 = (w, d, h, t, c) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ['box', t, h, t, a * (w / 2 - t / 2), h / 2, b * (d / 2 - t / 2), c]);
const books = (w, y, d) => {
  const out = [], cols = ['#7a1f1f', '#2e3b5e', '#386641', '#c2a878', '#5c4033', '#e07b39', '#202020', '#8d6346'];
  let x = -w / 2 + 0.02;
  let i = 0;
  while (x < w / 2 - 0.05) {
    const bw = 0.03 + ((i * 37) % 5) * 0.008, bh = 0.2 + ((i * 13) % 4) * 0.025;
    out.push(['box', bw, bh, d * 0.75, x + bw / 2, y + bh / 2, 0, cols[i % cols.length]]);
    x += bw + 0.004; i++;
  }
  return out;
};

export const FURNITURE = {
  desk: { office: 3, parts: [['box', 1.5, 0.04, 0.75, 0, 0.74, 0, WOOD], ...legs4(1.5, 0.75, 0.72, 0.05, STEEL), ['box', 0.42, 0.55, 0.65, 0.5, 0.42, 0, '#9a9a96']] },
  officeChair: { office: 3, parts: [['box', 0.48, 0.08, 0.48, 0, 0.48, 0, BLACK], ['box', 0.46, 0.55, 0.06, 0, 0.8, -0.22, BLACK], ['cyl', 0.06, 0.4, 0.06, 0, 0.25, 0, STEEL], ['box', 0.6, 0.04, 0.08, 0, 0.05, 0, BLACK], ['box', 0.08, 0.04, 0.6, 0, 0.05, 0, BLACK]] },
  monitor: { office: 2, parts: [['box', 0.6, 0.38, 0.04, 0, 0.32, 0, BLACK], ['box', 0.56, 0.33, 0.01, 0, 0.32, 0.022, '#22344a'], ['box', 0.06, 0.14, 0.06, 0, 0.07, -0.02, STEEL], ['box', 0.24, 0.02, 0.18, 0, 0.01, 0, STEEL]] },
  filing: { office: 1.5, parts: [['box', 0.48, 1.3, 0.62, 0, 0.65, 0, '#7d8288'], ...[0.2, 0.52, 0.84, 1.16].map((y) => ['box', 0.18, 0.03, 0.02, 0, y, 0.32, '#c8c8c8'])] },
  bookshelf: { office: 1, home: 1, parts: [['box', 0.9, 1.9, 0.04, 0, 0.95, -0.15, DARKWOOD], ['box', 0.04, 1.9, 0.34, -0.43, 0.95, 0, DARKWOOD], ['box', 0.04, 1.9, 0.34, 0.43, 0.95, 0, DARKWOOD],
    ...[0.05, 0.5, 0.95, 1.4, 1.86].map((y) => ['box', 0.86, 0.03, 0.34, 0, y, 0, DARKWOOD]), ...books(0.82, 0.07, 0.3), ...books(0.82, 0.52, 0.3), ...books(0.82, 0.97, 0.3), ...books(0.82, 1.42, 0.3)] },
  cooler: { office: 0.5, parts: [['box', 0.32, 1.0, 0.32, 0, 0.5, 0, WHITE], ['cyl', 0.27, 0.42, 0.27, 0, 1.2, 0, '#7fb6e0']] },
  plant: { office: 1, home: 1, parts: [['cyl', 0.36, 0.38, 0.36, 0, 0.19, 0, '#a1522e'], ['ball', 0.7, 0.8, 0.7, 0, 0.85, 0, '#3f7a35'], ['ball', 0.45, 0.5, 0.45, 0.15, 1.15, 0.05, '#4f8f3f']] },
  sofa: { home: 1.5, parts: [['box', 2.0, 0.42, 0.9, 0, 0.25, 0, FABRIC], ['box', 2.0, 0.5, 0.2, 0, 0.65, -0.35, FABRIC], ['box', 0.2, 0.3, 0.9, -0.9, 0.55, 0, FABRIC], ['box', 0.2, 0.3, 0.9, 0.9, 0.55, 0, FABRIC], ...legs4(1.9, 0.8, 0.06, 0.06, BLACK)] },
  armchair: { home: 1, parts: [['box', 0.85, 0.42, 0.85, 0, 0.25, 0, '#8d4b3a'], ['box', 0.85, 0.5, 0.18, 0, 0.66, -0.33, '#8d4b3a'], ['box', 0.16, 0.28, 0.85, -0.35, 0.56, 0, '#8d4b3a'], ['box', 0.16, 0.28, 0.85, 0.35, 0.56, 0, '#8d4b3a']] },
  bed: { home: 1, parts: [['box', 1.6, 0.3, 2.1, 0, 0.2, 0, DARKWOOD], ['box', 1.52, 0.22, 2.0, 0, 0.45, 0, WHITE], ['box', 1.4, 0.1, 0.4, 0, 0.6, -0.75, '#d8d4c8'], ['box', 1.5, 0.05, 1.2, 0, 0.58, 0.35, '#5b7aa6'], ['box', 1.6, 1.0, 0.08, 0, 0.5, -1.06, DARKWOOD]] },
  table: { home: 1.5, parts: [['cyl', 1.2, 0.04, 1.2, 0, 0.74, 0, WOOD], ['cyl', 0.1, 0.72, 0.1, 0, 0.36, 0, DARKWOOD], ['cyl', 0.6, 0.04, 0.6, 0, 0.02, 0, DARKWOOD]] },
  chair: { home: 2, office: 0.5, parts: [['box', 0.44, 0.05, 0.44, 0, 0.45, 0, WOOD], ['box', 0.44, 0.5, 0.04, 0, 0.72, -0.2, WOOD], ...legs4(0.44, 0.44, 0.45, 0.04, DARKWOOD)] },
  tv: { home: 1, parts: [['box', 1.2, 0.5, 0.45, 0, 0.25, 0, DARKWOOD], ['box', 1.1, 0.64, 0.05, 0, 0.88, 0, BLACK], ['box', 1.04, 0.58, 0.01, 0, 0.88, 0.027, '#1d2b3a']] },
  fridge: { home: 0.7, parts: [['box', 0.75, 1.8, 0.7, 0, 0.9, 0, WHITE], ['box', 0.03, 0.5, 0.03, 0.3, 1.3, 0.36, STEEL], ['box', 0.03, 0.3, 0.03, 0.3, 0.6, 0.36, STEEL], ['box', 0.74, 0.01, 0.01, 0, 1.15, 0.351, '#b8b6b0']] },
  wardrobe: { home: 0.8, parts: [['box', 1.1, 2.0, 0.6, 0, 1.0, 0, WOOD], ['box', 0.01, 1.9, 0.01, 0, 1.0, 0.301, DARKWOOD], ['box', 0.03, 0.2, 0.03, -0.06, 1.0, 0.31, STEEL], ['box', 0.03, 0.2, 0.03, 0.06, 1.0, 0.31, STEEL]] },
  lamp: { home: 1, office: 0.3, parts: [['cyl', 0.3, 0.04, 0.3, 0, 0.02, 0, BLACK], ['cyl', 0.03, 1.5, 0.03, 0, 0.77, 0, BLACK], ['cone', 0.45, 0.32, 0.45, 0, 1.6, 0, '#f2e6c8']] },
};
const KINDS = Object.keys(FURNITURE);
// Tints a piece may take: wood stains, fabrics, paint
const TINTS = [[1, 1, 1], [1, 1, 1], [0.8, 0.8, 0.82], [1.15, 1.08, 1], [0.9, 1, 1.15], [1.15, 0.9, 0.85], [0.85, 1.05, 0.9]];

export class Furniture {
  constructor({ scene, world, mobile = false }) {
    this.world = world; this.M = world.city.M;
    this.cap = mobile ? 70 : 160; // per kind
    this.items = [];
    this.kinds = {};
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
    for (const k of KINDS) {
      const mesh = new THREE.InstancedMesh(build(FURNITURE[k].parts), mat, this.cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _col.setRGB(1, 1, 1));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      // The box round the piece, to set it down on its lowest corner whichever way up it lands
      const bb = mesh.geometry.boundingBox, corners = [];
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) corners.push(new V3(x, y, z));
      this.kinds[k] = { mesh, slots: [], free: [], dirty: false, corners, top: bb.max.y };
    }
    this.office = KINDS.filter((k) => FURNITURE[k].office);
    this.home = KINDS.filter((k) => FURNITURE[k].home);
  }

  m(x) { return x * this.M; }

  /** Weighted pick of a kind for an office or a home */
  kind(home) {
    const list = home ? this.home : this.office, w = list.map((k) => FURNITURE[k][home ? 'home' : 'office']);
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[0];
  }

  /** A piece of furniture at p (on the floor), turned by yaw, in structure s */
  add(kind, p, yaw, s) {
    const K = this.kinds[kind];
    let i = K.free.pop();
    if (i === undefined) {
      if (K.mesh.count < this.cap) i = K.mesh.count++;
      else {
        // Full: the oldest piece of this kind goes
        const old = this.items.find((it) => it.kind === kind);
        if (!old) return null;
        this.remove(old);
        i = K.free.pop();
      }
    }
    const it = { kind, i, pos: p.clone(), q: new THREE.Quaternion().setFromAxisAngle(_v.set(0, 1, 0), yaw), vel: new V3(), spin: new V3(), air: false, s, check: Math.random() * 0.4, rest: 0 };
    const t = TINTS[Math.floor(Math.random() * TINTS.length)];
    K.mesh.setColorAt(i, _col.setRGB(t[0], t[1], t[2]));
    K.mesh.instanceColor.needsUpdate = true;
    this.items.push(it);
    this.place(it);
    return it;
  }

  remove(it) {
    const K = this.kinds[it.kind];
    K.mesh.setMatrixAt(it.i, _m.makeScale(0, 0, 0));
    K.dirty = true;
    K.free.push(it.i);
    this.items.splice(this.items.indexOf(it), 1);
  }

  place(it) {
    const K = this.kinds[it.kind];
    _m.compose(it.pos, it.q, _s.setScalar(this.M));
    K.mesh.setMatrixAt(it.i, _m);
    K.dirty = true;
  }

  /**
   * Furnish the floors of s round (x, y, z): spots from people.floorSpots. home: a house or
   * apartments rather than offices. Pieces by the hole are thrown out of it.
   */
  furnish(s, spots, x, y, z, r, home) {
    const B = s.box;
    _w.set(x - (B.min.x + B.max.x) / 2, 0, z - (B.min.z + B.max.z) / 2);
    if (_w.lengthSq() < 1e-6) _w.set(1, 0, 0);
    _w.normalize();
    for (const p of spots) {
      const kind = this.kind(home);
      // Offices: a desk comes with a monitor on it, facing the chair drawn up to its front
      const yaw = Math.floor(Math.random() * 4) * Math.PI / 2 + rand(-0.15, 0.15);
      const it = this.add(kind, p, yaw, s);
      if (!it) continue;
      if (kind === 'desk') {
        const mon = this.add('monitor', _v.set(p.x, p.y + this.m(0.76), p.z), yaw + rand(-0.2, 0.2), s);
        if (mon) mon.on = it;
        this.add('officeChair', _v.set(p.x + Math.sin(yaw) * this.m(0.75), p.y, p.z + Math.cos(yaw) * this.m(0.75)), yaw + Math.PI + rand(-0.5, 0.5), s);
      }
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d < r * 1.8) this.throw(it, _w.x * this.m(rand(3, 10)), this.m(rand(1, 5)), _w.z * this.m(rand(3, 10)));
    }
  }

  throw(it, vx, vy, vz) {
    it.air = true;
    it.on = null;
    it.rest = 0;
    it.vel.set(vx, vy, vz);
    it.spin.set(rand(-6, 6), rand(-4, 4), rand(-6, 6));
  }

  /** An explosion: pieces near it fly */
  blast(p, radius, amount) {
    const R = Math.max(radius * 1.3, this.m(6));
    for (const it of this.items) {
      const d = it.pos.distanceTo(p);
      if (d > R) continue;
      _v.subVectors(it.pos, p);
      if (_v.lengthSq() < 1e-6) _v.set(Math.random() - 0.5, 0.2, Math.random() - 0.5);
      _v.normalize();
      const k = (1 - d / R) * Math.min(1.6, 0.6 + amount / 80);
      this.throw(it, _v.x * this.m(6 + 20 * k), Math.max(_v.y, 0.2) * this.m(6 + 16 * k), _v.z * this.m(6 + 20 * k));
    }
  }

  /** What a piece at (x, z) comes down on: floors and streets, or the river outside the city */
  floor(x, z, y) {
    const g = this.world.groundHeight(x, z, y, this.m(0.3)), D = this.world.destruct;
    return g <= 0 && D && D.ground(x, z) < 0 ? D.ground(x, z) : g;
  }

  /** How far below its origin a piece reaches, turned as it is (its lowest corner) */
  low(it) {
    let lo = 0;
    for (const c of this.kinds[it.kind].corners) lo = Math.min(lo, _w.copy(c).applyQuaternion(it.q).y);
    return lo * this.M;
  }

  /** Pieces inside a falling slab are crushed: gone in a puff */
  crushIn(b, inside) {
    for (let n = this.items.length - 1; n >= 0; n--) {
      const it = this.items[n];
      _v.copy(it.pos); _v.y += this.m(0.4);
      if (inside(_v)) this.remove(it);
    }
  }

  update(dt, ctx) {
    const D = this.world.destruct, m = (x) => this.m(x), G = 9.81 * this.M * 1.3;
    const solid = (x, y, z) => (D ? D.solidAt(x, y, z) : false);
    for (let n = this.items.length - 1; n >= 0; n--) {
      const it = this.items[n];
      if (!it.air) {
        // At rest: does what it stands on still hold it? (A monitor goes with its desk.)
        it.check -= dt;
        if (it.check > 0) continue;
        it.check = 0.4;
        if (it.on) { if (it.on.air || this.items.indexOf(it.on) < 0) this.throw(it, it.on.vel.x, it.on.vel.y, it.on.vel.z); else continue; }
        else if (this.floor(it.pos.x, it.pos.z, it.pos.y + m(0.3)) < it.pos.y - this.low(it) - m(0.4)) this.throw(it, rand(-1, 1), 0, rand(-1, 1));
        else continue;
      }
      it.vel.y -= G * dt;
      const nx = it.pos.x + it.vel.x * dt, ny = it.pos.y + it.vel.y * dt, nz = it.pos.z + it.vel.z * dt;
      if (solid(nx, ny + m(0.4), nz)) { it.vel.x *= -0.25; it.vel.z *= -0.25; it.spin.multiplyScalar(0.6); } else { it.pos.x = nx; it.pos.z = nz; }
      // Not up through a ceiling
      if (it.vel.y > 0 && solid(it.pos.x, ny + m(1), it.pos.z)) it.vel.y = -it.vel.y * 0.2;
      else it.pos.y = ny;
      _q.setFromEuler(_e.set(it.spin.x * dt, it.spin.y * dt, it.spin.z * dt));
      it.q.multiply(_q);
      const lo = this.low(it), g = it.vel.y > 0 ? -Infinity : this.floor(it.pos.x, it.pos.z, it.pos.y + lo + m(0.5));
      if (g < 0 && it.pos.y + lo <= g) { this.remove(it); continue; } // into the river
      if (it.pos.y + lo <= g) {
        it.pos.y = g - lo;
        if (it.vel.y < -m(3)) {
          // Bounce and tumble on
          it.vel.y *= -0.28; it.vel.x *= 0.55; it.vel.z *= 0.55; it.spin.multiplyScalar(0.55);
        } else {
          it.vel.set(0, 0, 0);
          it.air = false;
          // Settle on a side: snap the tumble to the nearest face down, then set it down on its lowest corner
          _e.setFromQuaternion(it.q);
          const snap = (a) => Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
          it.q.setFromEuler(_e.set(snap(_e.x), _e.y, snap(_e.z)));
          it.pos.y = g - this.low(it);
        }
      }
      this.place(it);
    }
    for (const k in this.kinds) {
      const K = this.kinds[k];
      if (K.dirty) { K.mesh.instanceMatrix.needsUpdate = true; K.dirty = false; }
    }
  }
}
