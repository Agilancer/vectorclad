import * as THREE from '../three.js';
import { OUTLINES } from '../cityTiles.js';
import { Grid, makeLines, OUT, AIR, SOLID, CONCRETE, MAT_BY_NAME, STEEL } from './grid.js';

// ---------------------------------------------------------------------------
// Turn a city owner (a building, a tower, a lamp post...) into a voxel grid.
//
// The owner recorded what it is built from while the city was generated
// (city.js vol()): boxes for tiers and blocks, polygon segments for towers,
// pyramids, solid slabs, thin plates, extruded outlines and prop shapes. A box
// or polygon becomes a building: one-cell walls of its facade's material, a
// roof slab, floor slabs, a grid of columns and, in tall ones, a core. Props
// and slabs fill solid. Thin pieces (poles, braces, truss cards) are sampled
// so they always leave at least a line of cells.
// ---------------------------------------------------------------------------

const SMALL = new Set(['tree', 'lamp', 'signal', 'kiosk', 'subway', 'planter', 'fountain', 'armillary']);
const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Vector3();

/** World box of a recorded volume: [x0, y0, z0, x1, y1, z1] */
export function volBox(v) {
  switch (v.t) {
    case 'box': case 'solid': case 'pyr': return [v.x0, v.y0, v.z0, v.x1, v.y1, v.z1];
    case 'prism': { const r = Math.max(v.r0, v.r1); return [v.cx - r, v.y0, v.cz - r, v.cx + r, v.y1, v.cz + r]; }
    case 'plate': return [Math.min(v.ax, v.bx), v.y0, Math.min(v.az, v.bz), Math.max(v.ax, v.bx), v.y1, Math.max(v.az, v.bz)];
    case 'outline': {
      const c = Math.abs(Math.cos(v.ry)), s = Math.abs(Math.sin(v.ry)), hx = (v.w / 2) * c + (v.d / 2) * s, hz = (v.w / 2) * s + (v.d / 2) * c;
      return [v.x - hx, v.y, v.z - hz, v.x + hx, v.y + v.h, v.z + hz];
    }
    case 'shape': {
      _m.fromArray(v.e);
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 8; k++) {
        _p.set(k & 1 ? 1.1 : -1.1, k & 2 ? 1.1 : -1.1, k & 4 ? 1.1 : -1.1).applyMatrix4(_m);
        b[0] = Math.min(b[0], _p.x); b[1] = Math.min(b[1], _p.y); b[2] = Math.min(b[2], _p.z);
        b[3] = Math.max(b[3], _p.x); b[4] = Math.max(b[4], _p.y); b[5] = Math.max(b[5], _p.z);
      }
      return b;
    }
  }
  return null;
}

/** Inside the unit prop shape at local (x, y, z) */
function inShape(shape, x, y, z) {
  switch (shape) {
    case 'box': return Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5 && Math.abs(z) <= 0.5;
    case 'cyl': case 'cyl6': case 'pole': case 'tube': case 'ring6': return Math.abs(y) <= 0.5 && x * x + z * z <= 1;
    case 'cone': case 'cone4': { const r = 0.5 - y; return Math.abs(y) <= 0.5 && x * x + z * z <= r * r; }
    case 'sphere': return x * x + y * y + z * z <= 1;
    case 'ico': return x * x + y * y + z * z <= 0.85;
    case 'torus': { const a = Math.hypot(x, y) - 1; return a * a + z * z <= 0.07 * 0.07; }
  }
  return false;
}
/** Half extents of the unit shapes along their local axes */
const HALF = { box: [0.5, 0.5, 0.5], torus: [1.07, 1.07, 0.07] };
const halfOf = (shape) => HALF[shape] || (shape === 'sphere' || shape === 'ico' ? [1, 1, 1] : [1, 0.5, 1]);

/** Inside a regular n-gon of circumradius r turned by rot around (0, 0) */
function inPoly(dx, dz, n, r, rot) {
  const sec = (Math.PI * 2) / n;
  let a = Math.atan2(dz, dx) - rot;
  a -= Math.floor(a / sec) * sec; // angle within the sector, 0..sec
  return Math.hypot(dx, dz) * Math.cos(a - sec / 2) <= r * Math.cos(sec / 2);
}

/** Point in the traced outline (even-odd over its rings) */
function inOutline(rings, u, v) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * Voxelize an owner. M: game units per meter; ground: the height a cell's bottom must be at or
 * below to rest on the ground. Returns the Grid, or null if the owner has nothing solid.
 */
export function voxelizeOwner(owner, M, ground) {
  const vols = owner.vols;
  const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const grow = (b) => { for (let i = 0; i < 3; i++) { B[i] = Math.min(B[i], b[i]); B[i + 3] = Math.max(B[i + 3], b[i + 3]); } };
  for (const v of vols) { const b = volBox(v); if (b) grow(b); }
  if (!(B[3] > B[0])) return null;
  const pad = 0.02 * M;
  B[0] -= pad; B[2] -= pad; B[3] += pad; B[4] += pad; B[5] += pad;
  B[1] = Math.max(B[1], -10);
  // Cell size: about half a meter, coarser for the giants so a grid stays near a million cells
  const vm = ((B[3] - B[0]) * (B[4] - B[1]) * (B[5] - B[2])) / (M * M * M);
  const small = SMALL.has(owner.kind);
  let hm = Math.min(1.25, Math.max(small ? (owner.kind === 'tree' ? 0.42 : 0.3) : 0.5, Math.cbrt(vm / 1.0e6)));
  const h = hm * M;
  // Lines through every wall, roof, slab and floor
  const mx = [], my = [ground], mz = [];
  for (const v of vols) {
    if (v.t === 'box' || v.t === 'solid') {
      mx.push(v.x0, v.x1); mz.push(v.z0, v.z1); my.push(v.y0, v.y1);
      if (v.band) my.push(v.band.y);
      if (v.floors) for (const f of v.floors) my.push(f, f + Math.min(h, 0.6 * M));
    } else if (v.t === 'pyr') my.push(v.y0);
    else if (v.t === 'prism') { my.push(v.y0, v.y1); if (v.floors) for (const f of v.floors) my.push(f, f + Math.min(h, 0.6 * M)); }
  }
  const g = new Grid(makeLines(B[0], B[3], mx, h), makeLines(B[1], B[4], my, h), makeLines(B[2], B[5], mz, h));
  const { nx, ny, nz, nxz, N, mat } = g;
  if (N > 4.5e6) return null;
  const X = new Float32Array(nx), Y = new Float32Array(ny), Z = new Float32Array(nz);
  for (let i = 0; i < nx; i++) X[i] = g.cx(i);
  for (let i = 0; i < ny; i++) Y[i] = g.cy(i);
  for (let i = 0; i < nz; i++) Z[i] = g.cz(i);
  const range = (L, C, a, b) => {
    // Cells whose centers lie in [a, b]
    let i0 = 0, i1 = C.length - 1;
    while (i0 < C.length && C[i0] < a) i0++;
    while (i1 >= 0 && C[i1] > b) i1--;
    return [i0, i1];
  };

  // ---- building volumes: which one holds each cell ------------------------------------
  const shells = vols.filter((v) => v.t === 'box' || v.t === 'prism' || v.t === 'pyr');
  const vid = new Int16Array(N).fill(-1);
  // Each row of a layer is filled as one interval: boxes whole, polygons and pyramids by
  // where the row's line crosses their outline
  const fillRow = (y, z, xa, xb, k) => {
    if (xb < xa) return;
    let x0 = lineIdx(g.xs, xa);
    if (X[x0] < xa) x0++;
    const row = nx * (z + nz * y);
    for (let x = x0; x < nx && X[x] <= xb; x++) vid[row + x] = k;
  };
  shells.forEach((v, k) => {
    const b = volBox(v);
    const [y0, y1] = range(g.ys, Y, b[1], b[4]), [z0, z1] = range(g.zs, Z, b[2], b[5]);
    const P = v.t === 'prism' ? new Float64Array(v.n * 2) : null;
    for (let y = y0; y <= y1; y++) {
      const t = (Y[y] - v.y0) / (v.y1 - v.y0);
      if (P) {
        const r = v.r0 + (v.r1 - v.r0) * t;
        for (let c = 0; c < v.n; c++) { const a = v.rot + (c / v.n) * Math.PI * 2; P[c * 2] = v.cx + Math.cos(a) * r; P[c * 2 + 1] = v.cz + Math.sin(a) * r; }
      }
      for (let z = z0; z <= z1; z++) {
        const zz = Z[z];
        if (v.t === 'box') fillRow(y, z, b[0], b[3], k);
        else if (v.t === 'pyr') {
          const kk = 1 - t, cx = (v.x0 + v.x1) / 2, hw = ((v.x1 - v.x0) / 2) * kk;
          if (Math.abs(zz - (v.z0 + v.z1) / 2) <= ((v.z1 - v.z0) / 2) * kk) fillRow(y, z, cx - hw, cx + hw, k);
        } else {
          // Convex polygon: the row's line enters and leaves it once
          let xa = Infinity, xb = -Infinity;
          for (let c = 0; c < v.n; c++) {
            const ax = P[c * 2], az = P[c * 2 + 1], bx = P[((c + 1) % v.n) * 2], bz = P[((c + 1) % v.n) * 2 + 1];
            if ((az <= zz) === (bz <= zz)) continue;
            const x = ax + ((zz - az) / (bz - az)) * (bx - ax);
            if (x < xa) xa = x; if (x > xb) xb = x;
          }
          fillRow(y, z, xa, xb, k);
        }
      }
    }
  });

  // Per volume: floor layers, column lines and a core in the tall ones
  const info = shells.map((v) => {
    const fl = new Uint8Array(ny);
    if (v.floors) {
      for (const f of v.floors) {
        let j = 0;
        while (j < ny && g.ys[j + 1] <= f + 1e-4) j++;
        if (j < ny && Y[j] > v.y0 && Y[j] < v.y1) fl[j] = 1;
      }
    }
    const I = { fl, colX: null, colZ: null, core: null, mat: MAT_BY_NAME[v.mat] || CONCRETE };
    let cx0, cx1, cz0, cz1;
    if (v.t === 'box') { cx0 = v.x0; cx1 = v.x1; cz0 = v.z0; cz1 = v.z1; } else if (v.t === 'prism') {
      const a = Math.min(v.r0, v.r1) * Math.cos(Math.PI / v.n) * 0.7;
      cx0 = v.cx - a; cx1 = v.cx + a; cz0 = v.cz - a; cz1 = v.cz + a;
    }
    if (cx0 !== undefined) {
      const W = (cx1 - cx0) / M, D = (cz1 - cz0) / M, H = (v.y1 - v.y0) / M;
      // Columns about 7 m apart, clear of the walls
      const lines = (a, b, L, C) => {
        const f = new Uint8Array(C.length), span = (b - a) / M;
        if (span < 13) return null;
        const n = Math.max(2, Math.round(span / 7));
        for (let k = 1; k < n; k++) { const p = a + ((b - a) * k) / n; f[Math.max(0, Math.min(C.length - 1, lineIdx(L, p)))] = 1; }
        return f;
      };
      if (v.t === 'box' && v.floors && v.floors.length) { I.colX = lines(cx0, cx1, g.xs, X); I.colZ = lines(cz0, cz1, g.zs, Z); }
      if (H > 55 && W > 16 && D > 16) {
        const mxc = (cx0 + cx1) / 2, mzc = (cz0 + cz1) / 2, hw = (cx1 - cx0) * 0.17, hd = (cz1 - cz0) * 0.17;
        I.core = [lineIdx(g.xs, mxc - hw), lineIdx(g.xs, mxc + hw), lineIdx(g.zs, mzc - hd), lineIdx(g.zs, mzc + hd)];
      }
    }
    return I;
  });

  // ---- classify: walls, roofs, soffits, floors, columns, core and rooms -----------------
  for (let y = 0; y < ny; y++) {
    const onGround = g.ys[y] <= ground + 1e-3;
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = x + nx * (z + nz * y), k = vid[i];
        if (k < 0) continue;
        const v = shells[k], I = info[k];
        let side = null;
        const w = x === 0 || vid[i - 1] < 0, e = x === nx - 1 || vid[i + 1] < 0, n = z === 0 || vid[i - nx] < 0, sth = z === nz - 1 || vid[i + nx] < 0;
        if (w) side = 'w'; else if (e) side = 'e'; else if (n) side = 'n'; else if (sth) side = 's';
        else if (v.t !== 'box' && (vid[i - 1 - nx] < 0 || vid[i + 1 - nx] < 0 || vid[i - 1 + nx] < 0 || vid[i + 1 + nx] < 0)) side = 'd';
        if (side) {
          let m = I.mat;
          if (v.sides) {
            const name = v.sides[side];
            m = v.band && Y[y] < v.band.y && name !== 'brick' ? MAT_BY_NAME[v.band.mat] : MAT_BY_NAME[name];
          }
          mat[i] = m || CONCRETE;
          continue;
        }
        if (y === ny - 1 || vid[i + nxz] < 0 || (y > 0 && vid[i - nxz] < 0) || onGround || I.fl[y]) { mat[i] = CONCRETE; continue; }
        if (I.colX && I.colZ && I.colX[x] && I.colZ[z]) { mat[i] = CONCRETE; continue; }
        if (I.core) {
          const [a0, a1, b0, b1] = I.core;
          if (x >= a0 && x <= a1 && z >= b0 && z <= b1 && (x === a0 || x === a1 || z === b0 || z === b1)) { mat[i] = CONCRETE; continue; }
        }
        mat[i] = AIR;
      }
    }
  }

  // ---- solid pieces --------------------------------------------------------------------
  const put = (x, y, z, m) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const i = x + nx * (z + nz * y);
    if (mat[i] < SOLID) mat[i] = m;
  };
  const putAt = (px, py, pz, m) => put(lineIdx(g.xs, px), lineIdx(g.ys, py), lineIdx(g.zs, pz), m);
  for (const v of vols) {
    const m = MAT_BY_NAME[v.mat] || STEEL;
    if (v.t === 'solid') {
      const [x0, x1] = range(g.xs, X, v.x0, v.x1), [y0, y1] = range(g.ys, Y, v.y0, v.y1), [z0, z1] = range(g.zs, Z, v.z0, v.z1);
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, m);
      // Thinner than a cell: sample through its middle
      if (x1 < x0 || y1 < y0 || z1 < z0) {
        const sx = Math.max(1, Math.ceil((v.x1 - v.x0) / (h / 2))), sy = Math.max(1, Math.ceil((v.y1 - v.y0) / (h / 2))), sz = Math.max(1, Math.ceil((v.z1 - v.z0) / (h / 2)));
        for (let a = 0; a < sx; a++) for (let b = 0; b < sy; b++) for (let c = 0; c < sz; c++) {
          putAt(v.x0 + ((a + 0.5) / sx) * (v.x1 - v.x0), v.y0 + ((b + 0.5) / sy) * (v.y1 - v.y0), v.z0 + ((c + 0.5) / sz) * (v.z1 - v.z0), m);
        }
      }
    } else if (v.t === 'plate') {
      const len = Math.hypot(v.bx - v.ax, v.bz - v.az), su = Math.max(1, Math.ceil(len / (h / 2))), sv = Math.max(1, Math.ceil((v.y1 - v.y0) / (h / 2)));
      for (let a = 0; a <= su; a++) for (let b = 0; b <= sv; b++) {
        const f = a / su;
        putAt(v.ax + (v.bx - v.ax) * f, v.y0 + ((v.y1 - v.y0) * b) / sv, v.az + (v.bz - v.az) * f, m);
      }
    } else if (v.t === 'outline') {
      const rings = OUTLINES[v.name];
      if (!rings) continue;
      const b = volBox(v), c = Math.cos(-v.ry), s = Math.sin(-v.ry);
      const [x0, x1] = range(g.xs, X, b[0], b[3]), [y0, y1] = range(g.ys, Y, b[1], b[4]), [z0, z1] = range(g.zs, Z, b[2], b[5]);
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const px = X[x] - v.x, pz = Z[z] - v.z, lx = px * c + pz * s, lz = -px * s + pz * c;
        if (Math.abs(lz) > v.d / 2 + h * 0.3) continue;
        if (inOutline(rings, lx / v.w + 0.5, (Y[y] - v.y) / v.h)) put(x, y, z, m);
      }
    } else if (v.t === 'shape') {
      _m.fromArray(v.e);
      _mi.copy(_m).invert();
      const b = volBox(v);
      const [x0, x1] = range(g.xs, X, b[0], b[3]), [y0, y1] = range(g.ys, Y, b[1], b[4]), [z0, z1] = range(g.zs, Z, b[2], b[5]);
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        _p.set(X[x], Y[y], Z[z]).applyMatrix4(_mi);
        if (inShape(v.shape, _p.x, _p.y, _p.z)) put(x, y, z, m);
      }
      // Thin parts (poles, braces, hoops, panels): sample the shape so it leaves a trace of cells
      const half = halfOf(v.shape), e = _m.elements;
      const ext = [0, 1, 2].map((a) => Math.hypot(e[a * 4], e[a * 4 + 1], e[a * 4 + 2]) * half[a] * 2);
      if (Math.min(...ext) < h * 1.6) {
        if (v.shape === 'torus') {
          const n = Math.max(8, Math.ceil((Math.PI * ext[0]) / (h / 2)));
          for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; _p.set(Math.cos(a), Math.sin(a), 0).applyMatrix4(_m); putAt(_p.x, _p.y, _p.z, m); }
        } else {
          const st = ext.map((L) => (L < h * 1.6 ? 1 : Math.min(48, Math.ceil(L / (h / 2)) + 1)));
          for (let a = 0; a < st[0]; a++) for (let b2 = 0; b2 < st[1]; b2++) for (let c = 0; c < st[2]; c++) {
            const u = st[0] > 1 ? (a / (st[0] - 1) - 0.5) * 2 * half[0] * 0.98 : 0;
            const w = st[1] > 1 ? (b2 / (st[1] - 1) - 0.5) * 2 * half[1] * 0.98 : 0;
            const t = st[2] > 1 ? (c / (st[2] - 1) - 0.5) * 2 * half[2] * 0.98 : 0;
            if (!inShape(v.shape, u, w, t) && !(v.shape === 'box')) continue;
            _q.set(u, w, t).applyMatrix4(_m);
            putAt(_q.x, _q.y, _q.z, m);
          }
        }
      }
    }
  }
  g.ground = ground;
  return g;
}

function lineIdx(L, v) {
  let lo = 0, hi = L.length - 1;
  if (v <= L[0]) return 0;
  if (v >= L[hi]) return hi - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] <= v) lo = mid; else hi = mid; }
  return lo;
}
