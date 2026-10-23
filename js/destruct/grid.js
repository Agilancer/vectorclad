// ---------------------------------------------------------------------------
// Voxel grids for destructible structures.
//
// A grid is rectilinear: its lines along each axis are spaced about one cell
// apart, but snapped to every wall, floor and setback of the building it was
// made from, so cell faces lie exactly on the original surfaces. Cells are
// indexed x + nx * (z + nz * y): one horizontal layer after another.
// ---------------------------------------------------------------------------

// Cell codes. Below SOLID nothing is there: OUT is outside the original
// building, AIR is a room inside it, GONE was solid and has been destroyed or
// has left with a falling piece.
export const OUT = 0, AIR = 1, GONE = 2, SOLID = 3;

// Materials: hit points (0-255), density (relative to concrete), rubble color,
// how far a slab of it can reach out unsupported (meters), and the look of a
// broken face and its debris (see textures.js).
export const MATS = [];
const def = (code, name, o) => { MATS[code] = Object.assign({ code, name }, o); return code; };
export const CONCRETE = def(3, 'concrete', { hp: 70, density: 1, color: [0.55, 0.54, 0.52], span: 9, broken: 0, fx: 'dust' });
export const STONE = def(4, 'stone', { hp: 55, density: 0.95, color: [0.66, 0.6, 0.52], span: 7, broken: 1, fx: 'dust' });
export const BRICK = def(5, 'brick', { hp: 48, density: 0.9, color: [0.5, 0.28, 0.2], span: 6, broken: 2, fx: 'dust' });
export const GLASS = def(6, 'glass', { hp: 14, density: 0.45, color: [0.42, 0.5, 0.55], span: 6, broken: 3, fx: 'glass' });
export const PANEL = def(7, 'panel', { hp: 38, density: 0.7, color: [0.6, 0.6, 0.62], span: 7, broken: 4, fx: 'dust' });
export const STEEL = def(8, 'steel', { hp: 110, density: 0.9, color: [0.3, 0.3, 0.32], span: 14, broken: 5, fx: 'sparks' });
export const WOOD = def(9, 'wood', { hp: 26, density: 0.4, color: [0.42, 0.3, 0.2], span: 6, broken: 6, fx: 'splinter' });
export const LEAF = def(10, 'leaf', { hp: 5, density: 0.06, color: [0.22, 0.32, 0.15], span: 4, broken: 7, fx: 'leaf' });
export const LIGHT = def(11, 'light', { hp: 8, density: 0.4, color: [0.9, 0.9, 0.85], span: 3, broken: 3, fx: 'glass' });
export const MAT_BY_NAME = { concrete: CONCRETE, stone: STONE, brick: BRICK, glass: GLASS, panel: PANEL, steel: STEEL, wood: WOOD, leaf: LEAF, light: LIGHT };

/** Index of the cell holding v among sorted lines L (0..L.length - 2), or -1 outside */
export function lineIndex(L, v) {
  const n = L.length - 1;
  if (v < L[0] || v >= L[n]) return v === L[n] ? n - 1 : -1;
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (L[mid] <= v) lo = mid; else hi = mid;
  }
  return lo;
}

/** Clamped variant: the nearest cell index for v */
export function lineIndexClamped(L, v) {
  const n = L.length - 1;
  if (v <= L[0]) return 0;
  if (v >= L[n]) return n - 1;
  return lineIndex(L, v);
}

export class Grid {
  /** xs, ys, zs: Float32Array line positions (n + 1 each). mat: optional Uint8Array */
  constructor(xs, ys, zs, mat) {
    this.xs = xs; this.ys = ys; this.zs = zs;
    this.nx = xs.length - 1; this.ny = ys.length - 1; this.nz = zs.length - 1;
    this.nxz = this.nx * this.nz;
    this.N = this.nxz * this.ny;
    this.mat = mat || new Uint8Array(this.N);
    this.hp = null; // per-cell hit points, made on first damage
  }

  idx(x, y, z) { return x + this.nx * (z + this.nz * y); }
  solid(i) { return this.mat[i] >= SOLID; }
  /** Solid at (x, y, z), out of range is empty */
  solidAt(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return false;
    return this.mat[x + this.nx * (z + this.nz * y)] >= SOLID;
  }
  cx(x) { return (this.xs[x] + this.xs[x + 1]) * 0.5; }
  cy(y) { return (this.ys[y] + this.ys[y + 1]) * 0.5; }
  cz(z) { return (this.zs[z] + this.zs[z + 1]) * 0.5; }
  dx(x) { return this.xs[x + 1] - this.xs[x]; }
  dy(y) { return this.ys[y + 1] - this.ys[y]; }
  dz(z) { return this.zs[z + 1] - this.zs[z]; }
  vol(x, y, z) { return (this.xs[x + 1] - this.xs[x]) * (this.ys[y + 1] - this.ys[y]) * (this.zs[z + 1] - this.zs[z]); }

  /** Split a cell index into [x, y, z] (into out) */
  xyz(i, out) {
    const y = Math.floor(i / this.nxz), r = i - y * this.nxz, z = Math.floor(r / this.nx);
    out[0] = r - z * this.nx; out[1] = y; out[2] = z;
    return out;
  }

  /** Cell index holding a local point, or -1 */
  cellAt(px, py, pz) {
    const x = lineIndex(this.xs, px); if (x < 0) return -1;
    const y = lineIndex(this.ys, py); if (y < 0) return -1;
    const z = lineIndex(this.zs, pz); if (z < 0) return -1;
    return x + this.nx * (z + this.nz * y);
  }

  inBounds(px, py, pz, pad = 0) {
    return px >= this.xs[0] - pad && px <= this.xs[this.nx] + pad && py >= this.ys[0] - pad && py <= this.ys[this.ny] + pad && pz >= this.zs[0] - pad && pz <= this.zs[this.nz] + pad;
  }

  /**
   * Push a local point that sits inside solid out to the nearest empty cell along one of the six
   * axes, searching up to k cells each way. Returns { nx, ny, nz, depth } or null if not inside.
   */
  pushOut(px, py, pz, k = 6, out = {}) {
    const x = lineIndex(this.xs, px), y = lineIndex(this.ys, py), z = lineIndex(this.zs, pz);
    if (x < 0 || y < 0 || z < 0) return null;
    if (this.mat[x + this.nx * (z + this.nz * y)] < SOLID) return null;
    let best = Infinity;
    out.nx = 0; out.ny = 1; out.nz = 0;
    // Up first: things resting on a floor should be pushed up out of it
    for (let s = 1; s <= k && s < best; s++) {
      if (y + s >= this.ny || !this.solidAt(x, y + s, z)) { const d = this.ys[y + s] - py; if (d < best) { best = d; out.nx = 0; out.ny = 1; out.nz = 0; } break; }
    }
    for (let s = 1; s <= k; s++) {
      if (y - s < 0) break;
      if (!this.solidAt(x, y - s, z)) { const d = py - this.ys[y - s + 1]; if (d < best) { best = d; out.nx = 0; out.ny = -1; out.nz = 0; } break; }
    }
    for (let s = 1; s <= k; s++) {
      if (x + s >= this.nx || !this.solidAt(x + s, y, z)) { const d = this.xs[x + s] - px; if (d < best) { best = d; out.nx = 1; out.ny = 0; out.nz = 0; } break; }
    }
    for (let s = 1; s <= k; s++) {
      if (x - s < 0 || !this.solidAt(x - s, y, z)) { const d = px - this.xs[x - s + 1]; if (d < best) { best = d; out.nx = -1; out.ny = 0; out.nz = 0; } break; }
    }
    for (let s = 1; s <= k; s++) {
      if (z + s >= this.nz || !this.solidAt(x, y, z + s)) { const d = this.zs[z + s] - pz; if (d < best) { best = d; out.nx = 0; out.ny = 0; out.nz = 1; } break; }
    }
    for (let s = 1; s <= k; s++) {
      if (z - s < 0 || !this.solidAt(x, y, z - s)) { const d = pz - this.zs[z - s + 1]; if (d < best) { best = d; out.nx = 0; out.ny = 0; out.nz = -1; } break; }
    }
    out.depth = best === Infinity ? -1 : best;
    out.cell = x + this.nx * (z + this.nz * y);
    return out;
  }

  /**
   * First solid cell along a local ray o + d t, t in [0, tMax]. Returns
   * { t, cell, axis, sign } (the face entered: normal is -sign along axis) or null.
   */
  raycast(ox, oy, oz, dx, dy, dz, tMax, out = {}) {
    const X = this.xs, Y = this.ys, Z = this.zs, nx = this.nx, ny = this.ny, nz = this.nz;
    // Clip to the grid's box
    let t0 = 0, t1 = tMax, axis = -1, sign = 0;
    const slab = (o, d, lo, hi, a) => {
      if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
      let ta = (lo - o) / d, tb = (hi - o) / d, s = -1;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
      if (ta > t0) { t0 = ta; axis = a; sign = -s; }
      if (tb < t1) t1 = tb;
      return t0 <= t1;
    };
    if (!slab(ox, dx, X[0], X[nx], 0) || !slab(oy, dy, Y[0], Y[ny], 1) || !slab(oz, dz, Z[0], Z[nz], 2)) return null;
    const e = 1e-6;
    let x = lineIndexClamped(X, ox + dx * (t0 + e)), y = lineIndexClamped(Y, oy + dy * (t0 + e)), z = lineIndexClamped(Z, oz + dz * (t0 + e));
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const nextT = (L, i, s, o, d) => (Math.abs(d) < 1e-12 ? Infinity : (L[s > 0 ? i + 1 : i] - o) / d);
    let tx = nextT(X, x, sx, ox, dx), ty = nextT(Y, y, sy, oy, dy), tz = nextT(Z, z, sz, oz, dz);
    let t = t0;
    if (axis < 0) { axis = 1; sign = sy; } // started inside: report an up/down face
    for (let guard = 0; guard < 4096; guard++) {
      const i = x + nx * (z + nz * y);
      if (this.mat[i] >= SOLID) {
        out.t = t; out.cell = i; out.axis = axis; out.sign = sign; out.x = x; out.y = y; out.z = z;
        return out;
      }
      if (tx <= ty && tx <= tz) {
        t = tx; x += sx; axis = 0; sign = sx;
        if (x < 0 || x >= nx || t > t1) return null;
        tx = nextT(X, x, sx, ox, dx);
      } else if (ty <= tz) {
        t = ty; y += sy; axis = 1; sign = sy;
        if (y < 0 || y >= ny || t > t1) return null;
        ty = nextT(Y, y, sy, oy, dy);
      } else {
        t = tz; z += sz; axis = 2; sign = sz;
        if (z < 0 || z >= nz || t > t1) return null;
        tz = nextT(Z, z, sz, oz, dz);
      }
    }
    return null;
  }

  /** A sub-grid over cells [x0, x1) x [y0, y1) x [z0, z1), its materials copied */
  sub(x0, y0, z0, x1, y1, z1) {
    const g = new Grid(this.xs.slice(x0, x1 + 1), this.ys.slice(y0, y1 + 1), this.zs.slice(z0, z1 + 1));
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
      const a = this.nx * (z + this.nz * y), b = g.nx * (z - z0 + g.nz * (y - y0));
      g.mat.set(this.mat.subarray(a + x0, a + x1), b);
    }
    return g;
  }
}

/** Split [a, b] into about (b - a) / h equal parts; pushes the inner lines and b */
function fill(out, a, b, h) {
  const n = Math.max(1, Math.round((b - a) / h));
  for (let i = 1; i <= n; i++) out.push(a + ((b - a) * i) / n);
}

/** Lines over [lo, hi] that pass through every value in `must`, about h apart */
export function makeLines(lo, hi, must, h) {
  const m = must.filter((v) => v > lo + h * 0.08 && v < hi - h * 0.08).sort((a, b) => a - b);
  const keep = [];
  for (const v of m) if (!keep.length || v - keep[keep.length - 1] > h * 0.08) keep.push(v);
  const out = [lo];
  let a = lo;
  for (const v of keep.concat([hi])) { fill(out, a, v, h); a = v; }
  return Float32Array.from(out);
}
