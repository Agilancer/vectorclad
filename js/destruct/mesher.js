import { OUT, AIR, GONE, SOLID, MATS, CONCRETE } from './grid.js';
import { CELL, cellRect } from './textures.js';

// ---------------------------------------------------------------------------
// Greedy mesher for the faces a structure shows once it is broken: faces of
// solid cells next to destroyed cells (raw broken material) and next to rooms
// (floors, ceilings, plaster, bare concrete). Faces toward the outside are
// left to the original facade skin. Works one chunk of cells at a time so a
// hit only re-meshes the chunks it touched.
// ---------------------------------------------------------------------------

export const CHUNK = 16;

const RECT = [];
for (let i = 0; i < 16; i++) RECT[i] = cellRect(i);
// Repeat sizes in meters per atlas cell: broken faces, floors, ceilings, walls
const TILE_M = { broken: 2.6, floor: 4, ceiling: 2.6, wall: 3.2, column: 2.4 };
const WALLISH = new Set(['stone', 'brick', 'glass', 'panel']);

/**
 * Face style for a solid cell of material m whose neighbor in direction d (0 +x, 1 -x, 2 +y,
 * 3 -y, 4 +z, 5 -z) has code nb. 0: no face. Otherwise atlas cell + 1, and shade class in bits 5+.
 */
function style(m, nb, d) {
  if (nb >= SOLID || nb === OUT) return 0;
  const M = MATS[m];
  if (nb === GONE) return (M.broken + 1) | (1 << 5);
  // A room
  if (d === 2) return m === CONCRETE ? CELL.floor + 1 : (M.broken + 1) | (2 << 5);
  if (d === 3) return m === CONCRETE ? CELL.ceiling + 1 : (M.broken + 1) | (2 << 5);
  return (WALLISH.has(M.name) ? CELL.wall : m === CONCRETE ? CELL.column : M.broken) + 1;
}

const SHADE = [1, 0.84, 1.06, 0.62, 0.92, 0.78]; // per direction: sides, top, bottom

/**
 * Mesh the faces of cells in [x0, x1) x [y0, y1) x [z0, z1) of grid g. M: game units per meter.
 * Returns { pos, nor, uv, cell, col, idx } as plain arrays (empty when there is nothing).
 */
export function meshChunk(g, x0, y0, z0, x1, y1, z1, M) {
  const out = { pos: [], nor: [], uv: [], cell: [], col: [], idx: [], n: 0 };
  const { nx, ny, nz, mat } = g;
  const L = [g.xs, g.ys, g.zs];
  const lo = [x0, y0, z0], hi = [x1, y1, z1], dim = [nx, ny, nz];
  const stride = [1, nx * nz, nx];
  const mask = new Int16Array(CHUNK * CHUNK), matOf = new Uint8Array(CHUNK * CHUNK);
  for (let a = 0; a < 3; a++) {
    // u, v: the two other axes (u then v), chosen so u x v points along +a
    const u = (a + 1) % 3, v = (a + 2) % 3;
    for (let s = 1; s >= -1; s -= 2) {
      const d = a * 2 + (s > 0 ? 0 : 1);
      const nu = hi[u] - lo[u], nv = hi[v] - lo[v];
      for (let k = lo[a]; k < hi[a]; k++) {
        const kn = k + s, edge = kn < 0 || kn >= dim[a];
        let any = false;
        for (let j = 0; j < nv; j++) {
          const row = k * stride[a] + (lo[v] + j) * stride[v] + lo[u] * stride[u];
          for (let i = 0; i < nu; i++) {
            const ci = row + i * stride[u];
            const m = mat[ci];
            let f = 0;
            if (m >= SOLID) {
              const nb = edge ? OUT : mat[ci + s * stride[a]];
              f = style(m, nb, d);
            }
            mask[i + j * nu] = f;
            matOf[i + j * nu] = m;
            if (f) any = true;
          }
        }
        if (!any) continue;
        // Plane of these faces
        const plane = L[a][s > 0 ? k + 1 : k];
        for (let j = 0; j < nv; j++) {
          for (let i = 0; i < nu;) {
            const f = mask[i + j * nu];
            if (!f) { i++; continue; }
            let w = 1;
            while (i + w < nu && mask[i + w + j * nu] === f) w++;
            let h = 1;
            grow: while (j + h < nv) {
              for (let t = 0; t < w; t++) if (mask[i + t + (j + h) * nu] !== f) break grow;
              h++;
            }
            for (let jj = 0; jj < h; jj++) for (let t = 0; t < w; t++) mask[i + t + (j + jj) * nu] = 0;
            emit(out, a, u, v, s, plane, L[u][lo[u] + i], L[u][lo[u] + i + w], L[v][lo[v] + j], L[v][lo[v] + j + h], f, matOf[i + j * nu], d, M);
            i += w;
          }
        }
      }
    }
  }
  return out;
}

const _P = [0, 0, 0];
function emit(out, a, u, v, s, plane, u0, u1, v0, v1, f, m, d, M) {
  const cellId = (f & 31) - 1, cls = f >> 5;
  const R = RECT[cellId];
  // Repeat size: rooms by kind, broken faces finer
  const T = M * (cls ? TILE_M.broken : cellId === CELL.floor ? TILE_M.floor : cellId === CELL.ceiling ? TILE_M.ceiling : cellId === CELL.wall ? TILE_M.wall : TILE_M.column);
  const base = cls ? MATS[m].color : [1, 1, 1];
  // A little variation per face so big broken areas don't read as one sheet
  const hsh = Math.sin(plane * 12.9898 + u0 * 78.233 + v0 * 37.719) * 43758.5453;
  const jit = 0.92 + (hsh - Math.floor(hsh)) * 0.16;
  // Rooms are in shadow: plaster and columns darkest, floors a little lighter; ceilings keep their lights
  const room = cls ? (cls === 1 ? 0.78 : 0.62) : cellId === CELL.floor ? 0.55 : cellId === CELL.ceiling ? 0.42 : 0.4;
  const sh = SHADE[d] * jit * room;
  const r = base[0] * sh, g = base[1] * sh, b = base[2] * sh;
  const i0 = out.n;
  const corners = s > 0 ? [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] : [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
  for (const [cu, cv] of corners) {
    _P[a] = plane; _P[u] = cu; _P[v] = cv;
    out.pos.push(_P[0], _P[1], _P[2]);
    out.nor.push(a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0);
    // World-planar texture coordinates: horizontal faces use x/z, walls run along and up
    let tu, tv;
    if (a === 1) { tu = _P[0] / T; tv = -_P[2] / T; } else if (a === 0) { tu = _P[2] / T * -s; tv = _P[1] / T; } else { tu = _P[0] / T * s; tv = _P[1] / T; }
    out.uv.push(tu, tv);
    out.cell.push(R[0], R[1], R[2], R[3]);
    out.col.push(r, g, b);
  }
  out.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  out.n += 4;
}
