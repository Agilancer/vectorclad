import * as THREE from '../three.js';
import { B, BODY_SHEET, frontPrism, chamferBox } from '../atlas.js';
import { P, Thruster, blade, warp } from '../mech.js';

// ---------------------------------------------------------------------------
// Shaping kit for the frame builds: rounded shells, vernier ports, fins,
// light strips and frame greebles, on top of the faceted plates in mech.js.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;

/**
 * Rounded armor lofted along Y through superellipse sections, smooth shaded.
 * secs: [{ y, w, d, x?, z?, e? }] in order along Y; e is the section's
 * squareness (2 is an ellipse, 3-4 a rounded box, 8 nearly square).
 * Ends are closed with flat caps; shrink the end sections to round them off.
 */
export function shell(secs, { n = 20, e = 3 } = {}) {
  const pos = [], idx = [];
  const ring = (s) => {
    const ex = 2 / (s.e || e), out = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + Math.PI / n;
      const c = Math.cos(t), sn = Math.sin(t);
      out.push([(s.x || 0) + Math.sign(c) * Math.abs(c) ** ex * s.w / 2, s.y, (s.z || 0) + Math.sign(sn) * Math.abs(sn) ** ex * s.d / 2]);
    }
    return out;
  };
  const up = secs[secs.length - 1].y > secs[0].y;
  secs.forEach((s) => ring(s).forEach((p) => pos.push(...p)));
  for (let r = 0; r < secs.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = r * n + i, b = r * n + j, c = (r + 1) * n + i, d = (r + 1) * n + j;
      if (up) idx.push(a, c, d, a, d, b); else idx.push(a, d, c, a, b, d);
    }
  }
  // Caps get their own vertices so the rim stays crisp
  const cap = (s, top) => {
    const base = pos.length / 3;
    ring(s).forEach((p) => pos.push(...p));
    pos.push(s.x || 0, s.y, s.z || 0);
    const ctr = base + n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (top) idx.push(ctr, base + j, base + i); else idx.push(ctr, base + i, base + j);
    }
  };
  cap(secs[secs.length - 1], up);
  cap(secs[0], !up);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Untextured use samples a plain patch of the sheet; P(geo, mat, faces) maps it properly
  const [px, py, pw, ph] = B.plainA, u = (px + pw / 2) / BODY_SHEET.w, v = 1 - (py + ph / 2) / BODY_SHEET.h;
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2).map((_, i) => (i % 2 ? v : u)), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** shell() run along Z: sections { z, w, h, x?, y?, e? }. */
export function shellZ(secs, opts) {
  return shell(secs.map((s) => ({ y: s.z, w: s.w, d: s.h, x: s.x, z: -(s.y || 0), e: s.e })), opts).rotateX(Math.PI / 2);
}

/**
 * A dome: a superellipsoid w × h × d, flattened behind (back 0..1 of its
 * depth kept) and squared off by e. Faces +Z.
 */
export function dome(w, h, d, { e = 2.6, back = 1, seg = 18, rings = 10 } = {}) {
  const secs = [];
  for (let k = 0; k <= rings; k++) {
    const t = -1 + (2 * k) / rings;
    const r = Math.max(0.04, Math.abs(1 - Math.abs(t) ** e) ** (1 / e));
    const z = t * d / 2;
    secs.push({ z: z < 0 ? z * back : z, w: w * r, h: h * r, e });
  }
  return shellZ(secs, { n: seg, e });
}

/**
 * A vernier port: a raised collar around a tan-lined bowl with a nozzle
 * throat, facing +Z of the placement. With `thrust` it also fires: a small
 * thruster sits in the throat and joins the given list.
 */
export function port(mech, parent, r, x, y, z, rx = 0, ry = 0, rz = 0, thrust = null) {
  const M = mech.mats;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  parent.add(g);
  const collar = P(new THREE.TorusGeometry(r, r * 0.2, 6, 18), M.second, { all: B.plainB });
  g.add(collar);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.5, r * 0.55, 18, 1, true).rotateX(-Math.PI / 2), M.port);
  bowl.position.z = -r * 0.22;
  g.add(bowl);
  const throat = new THREE.Mesh(new THREE.CircleGeometry(r * 0.5, 14), M.joint);
  throat.position.z = -r * 0.48;
  g.add(throat);
  for (const o of [collar, bowl, throat]) o.userData.noOutline = true;
  if (thrust) {
    const t = new Thruster(g, new V3(0, 0, -r * 0.3), new V3(0, 0, 1), r * 0.55, mech.glowTex);
    thrust.push(t);
  }
  return g;
}

/** A V-fin antenna on a forehead: two swept blades from a crest block, facing +Z. */
export function vfin(mech, parent, span, x, y, z, mat = mech.mats.trim, { rise = 0.62, sweep = 0.2, w = 0.035 } = {}) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  for (const s of [-1, 1]) {
    const geo = frontPrism([[0, -0.04], [span * 0.16, 0], [span, span * rise], [span * 0.9, span * rise + 0.02], [0, 0.09]].map(([px, py]) => [px * s, py]), w, 0.008);
    const m = P(geo, mat, mat.map ? { all: B.plainA } : undefined);
    m.rotation.y = -s * sweep;
    g.add(m);
  }
  const crest = P(chamferBox(0.11, 0.12, 0.08, 0.03, 0.01), mech.mats.red);
  crest.position.set(0, 0.03, 0.02);
  g.add(crest);
  return g;
}

/** A thin glowing strip in the eye color (or another basic material). */
export function strip(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.userData.noOutline = true;
  parent.add(m);
  return m;
}

/** A row of slats: n louvres of size sx × sy × sz stepping along `step` from (x, y, z). */
export function slats(parent, mat, n, x, y, z, step, sx, sy, sz, rx = 0) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x + step[0] * i, y + step[1] * i, z + step[2] * i);
    m.rotation.x = rx;
    m.castShadow = true;
    parent.add(m);
  }
}

/** A plate swept into a shallow curve across X (bend > 0 droops its sides). Faces +Z. */
export function curvedPlate(pts, depth, bend, mat, faces = { all: B.plainA }) {
  const geo = warp(frontPrism(pts, depth, 0.02), (v) => { v.z -= bend * v.x * v.x; });
  return P(geo, mat, faces);
}

/** A side-view fin ([z, y] points) thinning toward its tips. */
export function fin(pts, width, mat, faces = { all: B.plainA }) {
  return P(blade(pts, width, [0.5, 1], [0.6, 1]), mat, faces);
}

/** Exposed frame: a dark strut from a to b (local points) with a joint ball at each end. */
export function strut(parent, mat, a, b, r) {
  const dir = new V3().subVectors(b, a), len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}
