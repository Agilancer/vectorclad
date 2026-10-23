import * as THREE from '../three.js';
import { OUT, AIR, GONE, SOLID, MATS, lineIndexClamped } from './grid.js';
import { voxelizeOwner, volBox } from './voxelize.js';
import { CHUNK, meshChunk } from './mesher.js';
import { interiorMaterials } from './textures.js';
import { extractSkin, partGeometry, skinMaterial, skinDepthMaterial, makeLut, makeMask, uploadMask, clipSkin } from './skin.js';
import { Body, Physics, makeProbes } from './physics.js';
import { Debris } from './debris.js';

// ---------------------------------------------------------------------------
// Destruction: everything the city is built of can be shot apart.
//
// Buildings and props stay merged static meshes until something hits them.
// Then the owner is voxelized (voxelize.js), its triangles move into a masked
// skin (skin.js) and every hit carves cells away: bullets punch holes, blasts
// blow out craters, the mega beam cuts trenches. After each round of damage a
// structure is checked three ways:
//
//   - islands: cells no longer connected to the ground break away;
//   - sections: at each damaged level, the load of everything above is set
//     against what is left to carry it. Too little left and the floors above
//     crush down a storey; the load's center beyond the edge of what is left
//     (cut a building a little past halfway) and it tips over toward the cut;
//   - spans: floors, lintels and overhangs carried too far from a support
//     that still reaches the ground give way and fall in slabs.
//
// What breaks away becomes a rigid body (physics.js) that topples, slides,
// wedges itself between buildings and crushes what it lands on, carving the
// structures it hits, which may fail in turn. Hard landings shatter bodies
// into pieces along jagged Voronoi cracks, with rubble (debris.js) and dust.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const SAFETY = 3.4;            // intact buildings carry this many times their own weight at their weakest level
const ANALYZE_EVERY = 0.07;    // seconds between structural checks of one structure
const ISLAND_BUDGET = 60000;   // cells one island search may visit before calling for a full pass
const MESH_BUDGET_MS = 5;      // chunk meshing per frame
let MAX_BODIES = 70;
const rand = (a, b) => a + Math.random() * (b - a);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _m4 = new THREE.Matrix4();

// Shared scratch arrays, grown as needed
let VIS = new Uint32Array(1 << 16), QUEUE = new Int32Array(1 << 16), STAMP = 1;
function scratch(n) {
  if (VIS.length < n) { VIS = new Uint32Array(n); STAMP = 1; }
  if (QUEUE.length < n) QUEUE = new Int32Array(n);
}
function nextStamp() {
  if (++STAMP > 0xfffffff0) { VIS.fill(0); STAMP = 1; }
  return STAMP;
}

let SID = 1;

/** A voxel structure: a standing building (static) or a falling piece of one (with a body) */
class Structure {
  constructor(D, g, owner, lut, off) {
    this.id = SID++;
    this.D = D;
    this.g = g;
    this.owner = owner;
    this.lut = lut;
    this.off = off;
    this.body = null;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.mask = makeMask(g);
    this.U = {
      uMask: { value: this.mask }, uLut: { value: lut.tex }, uLutMin: { value: lut.min }, uLutScale: { value: lut.scale },
      uLutW: { value: lut.W }, uOff: { value: new V3(off[0], off[1], off[2]) }, uDim: { value: new V3(g.nx, g.ny, g.nz) },
    };
    this.skin = [];
    this.skinMeshes = [];
    this.cn = [Math.ceil(g.nx / CHUNK), Math.ceil(g.ny / CHUNK), Math.ceil(g.nz / CHUNK)];
    this.chunks = new Map();     // key -> mesh data
    this.dirty = new Set();
    this.faceMesh = null;
    this.maskBox = null;
    this.pending = [];
    this.analyzeT = 0;
    this.warnT = 0;
    this.hp = null;
    this.dead = false;
    this.cellSize = (g.xs[g.nx] - g.xs[0]) / g.nx;
    let n = 0;
    for (let i = 0; i < g.N; i++) if (g.mat[i] >= SOLID) n++;
    this.count = n;
  }
}

export class Destruction {
  /** mobile: fewer flying chunks and pieces at once, for phones and tablets */
  constructor({ scene, world, city, fx, sound, renderer, M, mobile = false }) {
    if (mobile) MAX_BODIES = 36;
    this.scene = scene; this.world = world; this.city = city; this.fx = fx; this.sound = sound; this.renderer = renderer;
    this.M = M;
    this.G = 9.81 * M * 1.3;
    this.groundY = city.L.curb + 0.01 * M;
    this.structs = [];
    this.faceMat = interiorMaterials().faces;
    const env = { gravity: this.G, ground: (x, z) => this.ground(x, z), statics: (mn, mx, fn) => this.statics(mn, mx, fn) };
    this.physics = new Physics(env);
    this.debris = new Debris(scene, { gravity: this.G, ground: env.ground, solid: (x, y, z) => this.solidAt(x, y, z) }, mobile ? 900 : 2400);
    this.warmup();
    this.spiders = null;
    this.player = null;
    this.onPlayerHit = null;
    this.frame = { chunks: 0, dust: 0 };
    this.stats = { activated: 0, removed: 0, bodies: 0, fractures: 0, collapses: 0, activateMs: 0 };
    this.time = 0;
    this.crushAt = new Map();
    this.log = []; // recent fractures, for tuning
    // Owners by area, to find what an explosion or a falling piece reaches
    this.HC = 40;
    this.hash = new Map();
    for (const o of city.owners) {
      const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const v of o.vols) { const b = volBox(v); if (!b) continue; for (let k = 0; k < 3; k++) { B[k] = Math.min(B[k], b[k]); B[k + 3] = Math.max(B[k + 3], b[k + 3]); } }
      if (!(B[3] > B[0])) continue;
      o.box = B;
      o.small = o.kind === 'tree' || o.kind === 'lamp' || o.kind === 'signal' || o.kind === 'planter' || o.kind === 'subway' || o.kind === 'kiosk';
      for (let i = Math.floor(B[0] / this.HC); i <= Math.floor(B[3] / this.HC); i++) {
        for (let j = Math.floor(B[2] / this.HC); j <= Math.floor(B[5] / this.HC); j++) {
          const k = `${i},${j}`;
          let l = this.hash.get(k);
          if (!l) this.hash.set(k, (l = []));
          l.push(o);
        }
      }
    }
  }

  /**
   * Compile the masked skin, shadow and broken-face shaders up front (main.js compiles the scene
   * after this), so the first hit on a building doesn't stall on shader compiles.
   */
  warmup() {
    const seen = new Set(), g = new THREE.Group();
    const lut = { tex: new THREE.DataTexture(new Float32Array(6), 2, 3, THREE.RedFormat, THREE.FloatType), min: new V3(), scale: new V3(1, 1, 1), W: 2 };
    lut.tex.needsUpdate = true;
    const mask = new THREE.Data3DTexture(new Uint8Array(2), 1, 1, 1);
    mask.format = THREE.RGFormat; mask.needsUpdate = true;
    const U = { uMask: { value: mask }, uLut: { value: lut.tex }, uLutMin: { value: lut.min }, uLutScale: { value: lut.scale }, uLutW: { value: 2 }, uOff: { value: new V3() }, uDim: { value: new V3(1, 1, 1) } };
    for (const mesh of this.city.meshes) {
      const src = mesh.material;
      if (seen.has(src)) continue;
      seen.add(src);
      const geo = new THREE.BufferGeometry();
      for (const name in mesh.geometry.attributes) {
        const A = mesh.geometry.attributes[name];
        geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(A.itemSize * 3), A.itemSize));
      }
      geo.setAttribute('aBack', new THREE.BufferAttribute(new Float32Array(9), 3));
      const m = new THREE.Mesh(geo, skinMaterial(src, U));
      m.customDepthMaterial = skinDepthMaterial(src, U);
      m.castShadow = true; m.frustumCulled = false;
      g.add(m);
    }
    const fg = new THREE.BufferGeometry();
    for (const [k, n] of [['position', 3], ['normal', 3], ['uv', 2], ['aCell', 4], ['color', 3]]) fg.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n * 3), n));
    const fm = new THREE.Mesh(fg, this.faceMat);
    fm.castShadow = true; fm.frustumCulled = false;
    g.add(fm);
    g.position.y = -500;
    this.scene.add(g);
    this.warm = { g, t: 4 };
  }

  // ---- world queries ----------------------------------------------------------

  /** Street level, or the river outside the city */
  ground(x, z) {
    const B = this.world.bounds;
    if (x < B.minX - 30 || x > B.maxX + 30 || z > B.maxZ + 30) return this.city.L.water;
    return 0;
  }

  /** Visit the city boxes and standing structures near a box (each structure once) */
  statics(mn, mx, fn) {
    const st = nextStamp();
    this.world.query(mn.x, mn.z, mx.x, mx.z, (c) => {
      if (c.walk || c.prop) return;
      if (c.vox) {
        if (c.vox.dead || c.vox.stamp === st) return;
        c.vox.stamp = st;
        fn(c.vox.ref);
        return;
      }
      if (c.max.y < mn.y || c.min.y > mx.y) return;
      fn(c);
    });
  }

  /** Owners whose box meets a box */
  ownersIn(x0, y0, z0, x1, y1, z1, fn) {
    const st = nextStamp();
    for (let i = Math.floor(x0 / this.HC); i <= Math.floor(x1 / this.HC); i++) {
      for (let j = Math.floor(z0 / this.HC); j <= Math.floor(z1 / this.HC); j++) {
        const l = this.hash.get(`${i},${j}`);
        if (!l) continue;
        for (const o of l) {
          if (o.stamp === st) continue;
          o.stamp = st;
          const B = o.box;
          if (B[3] < x0 || B[0] > x1 || B[4] < y0 || B[1] > y1 || B[5] < z0 || B[2] > z1) continue;
          fn(o);
        }
      }
    }
  }

  /** Solid at a world point: city boxes, standing structures and pieces */
  solidAt(x, y, z) {
    const w = this.world;
    const i = Math.floor((x - w.gx0) / w.cell), j = Math.floor((z - w.gz0) / w.cell);
    if (i >= 0 && j >= 0 && i < w.gw && j < w.gh) {
      for (const c of w.grid[j * w.gw + i]) {
        if (c.walk || c.prop || x < c.min.x || x > c.max.x || y < c.min.y || y > c.max.y || z < c.min.z || z > c.max.z) continue;
        if (c.vox) { const k = c.vox.g.cellAt(x, y, z); if (k >= 0 && c.vox.g.mat[k] >= SOLID) return true; continue; }
        return true;
      }
    }
    for (const b of this.physics.bodies) {
      if (x < b.min.x || x > b.max.x || y < b.min.y || y > b.max.y || z < b.min.z || z > b.max.z) continue;
      b.toLocal(x, y, z, _a);
      const k = b.s.g.cellAt(_a.x, _a.y, _a.z);
      if (k >= 0 && b.s.g.mat[k] >= SOLID) return true;
    }
    return false;
  }

  /**
   * Ray against one structure (world o, d). Returns { t, nx, ny, nz, cell } or null.
   * Pieces are tested in their own frame.
   */
  rayStruct(s, o, d, max) {
    const g = s.g;
    let r;
    if (s.body) {
      const b = s.body;
      b.toLocal(o.x, o.y, o.z, _a);
      b.dirLocal(d.x, d.y, d.z, _b);
      r = g.raycast(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, max, _hit);
      if (!r) return null;
      const n = [0, 0, 0]; n[r.axis] = -r.sign;
      b.dirWorld(n[0], n[1], n[2], _c);
      return { t: r.t, nx: _c.x, ny: _c.y, nz: _c.z, cell: r.cell };
    }
    r = g.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, _hit);
    if (!r) return null;
    return { t: r.t, nx: r.axis === 0 ? -r.sign : 0, ny: r.axis === 1 ? -r.sign : 0, nz: r.axis === 2 ? -r.sign : 0, cell: r.cell };
  }

  /** Ray against the moving and fallen pieces: { t, nx, ny, nz, cell, s } or null */
  rayBodies(o, d, max) {
    let best = null;
    for (const b of this.physics.bodies) {
      // Quick reject by the piece's box
      const t = rayAabb(o, d, b.min, b.max, max);
      if (t === null) continue;
      const r = this.rayStruct(b.s, o, d, max);
      if (r && r.t < max) { max = r.t; best = r; best.s = b.s; }
    }
    return best;
  }

  /** Highest floor under (x, z) within r, no higher than y + step: for feet and the camera */
  floorUnder(s, x, z, y, r, step) {
    const g = s.g;
    if (s.body) {
      const h = this.rayStruct(s, _d.set(x, y + step, z), DOWN, step + 40);
      return h ? y + step - h.t : -Infinity;
    }
    const x0 = lineIndexClamped(g.xs, x - r), x1 = lineIndexClamped(g.xs, x + r), z0 = lineIndexClamped(g.zs, z - r), z1 = lineIndexClamped(g.zs, z + r);
    const ytop = lineIndexClamped(g.ys, y + step);
    let best = -Infinity;
    for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
      // Inside the circle
      const cx = Math.max(g.xs[xx], Math.min(x, g.xs[xx + 1])), cz = Math.max(g.zs[zz], Math.min(z, g.zs[zz + 1]));
      if ((cx - x) ** 2 + (cz - z) ** 2 > r * r) continue;
      for (let yy = ytop; yy >= 0; yy--) {
        if (g.mat[xx + g.nx * (zz + g.nz * yy)] >= SOLID) {
          const top = g.ys[yy + 1];
          if (top <= y + step && top > best) best = top;
          break;
        }
      }
    }
    return best;
  }

  /**
   * Push a standing cylinder (feet at pos.y, r, height) out of a structure's solid cells,
   * except what it can step onto from stepY. Returns true if it moved.
   */
  pushCylinder(s, pos, r, height, stepY, step) {
    const g = s.g;
    let hit = false;
    if (s.body) {
      // Pieces: feel around with short horizontal rays at a few heights
      for (let k = 0; k < 3; k++) {
        const y = stepY + step + 0.4 + (k / 2) * Math.max(0.1, pos.y + height - stepY - step - 0.6);
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          _b.set(Math.cos(ang), 0, Math.sin(ang));
          const h = this.rayStruct(s, _d.set(pos.x, y, pos.z), _b, r);
          if (h && h.t < r) { pos.x -= _b.x * (r - h.t); pos.z -= _b.z * (r - h.t); hit = true; }
        }
      }
      return hit;
    }
    const y0 = lineIndexClamped(g.ys, stepY + step + 0.01), y1 = lineIndexClamped(g.ys, pos.y + height - 0.01);
    if (pos.y + height <= g.ys[0] || stepY + step >= g.ys[g.ny]) return false;
    for (let pass = 0; pass < 2; pass++) {
      const x0 = lineIndexClamped(g.xs, pos.x - r), x1 = lineIndexClamped(g.xs, pos.x + r), z0 = lineIndexClamped(g.zs, pos.z - r), z1 = lineIndexClamped(g.zs, pos.z + r);
      let bestD = Infinity, bx = 0, bz = 0;
      for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
        let solid = false;
        for (let yy = y0; yy <= y1; yy++) if (g.mat[xx + g.nx * (zz + g.nz * yy)] >= SOLID) { solid = true; break; }
        if (!solid) continue;
        const cx = Math.max(g.xs[xx], Math.min(pos.x, g.xs[xx + 1])), cz = Math.max(g.zs[zz], Math.min(pos.z, g.zs[zz + 1]));
        const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 < bestD) { bestD = d2; bx = cx; bz = cz; }
      }
      if (bestD === Infinity) break;
      hit = true;
      const d = Math.sqrt(bestD);
      if (d > 1e-5) { pos.x = bx + ((pos.x - bx) / d) * r; pos.z = bz + ((pos.z - bz) / d) * r; } else { pos.x += r * 0.5; }
    }
    return hit;
  }

  // ---- activation --------------------------------------------------------------

  /** Turn an owner into a voxel structure the first time it is hit */
  activate(owner) {
    if (owner.struct) return owner.struct.dead ? null : owner.struct;
    if (owner.dead) return null;
    const t0 = performance.now();
    const g = voxelizeOwner(owner, this.M, this.groundY);
    if (!g) { owner.dead = true; return null; }
    const s = new Structure(this, g, owner, makeLut(g), [0, 0, 0]);
    s.ref = { vox: s };
    s.hp = new Uint8Array(g.N);
    const HP = MATS.map((m) => (m ? m.hp : 0)), gm = g.mat, hp = s.hp;
    for (let i = 0; i < g.N; i++) { const m = gm[i]; if (m >= SOLID) hp[i] = HP[m]; }
    s.skin = extractSkin(owner, g);
    this.buildSkin(s);
    this.scene.add(s.group);
    s.group.updateMatrixWorld(true);
    s.anchor = 1;
    while (s.anchor < g.ny && g.ys[s.anchor] <= this.groundY + 1e-3) s.anchor++;
    this.initStats(s);
    owner.struct = s;
    for (const c of owner.colliders) c.vox = s;
    // One box over all of it, so rays and feet find every part, props and cornices included
    s.box = { min: new V3(g.xs[0], g.ys[0], g.zs[0]), max: new V3(g.xs[g.nx], g.ys[g.ny], g.zs[g.nz]) };
    this.world.addCollider({ min: s.box.min.clone(), max: s.box.max.clone(), vox: s, proxy: true });
    this.structs.push(s);
    this.stats.activated++;
    this.stats.activateMs += performance.now() - t0;
    return s;
  }

  buildSkin(s) {
    for (const part of s.skin) {
      const mesh = new THREE.Mesh(partGeometry(part), skinMaterial(part.src, s.U));
      mesh.castShadow = part.castShadow;
      mesh.receiveShadow = part.receiveShadow;
      mesh.customDepthMaterial = skinDepthMaterial(part.src, s.U);
      mesh.matrixAutoUpdate = false;
      s.group.add(mesh);
      s.skinMeshes.push(mesh);
    }
  }

  cellMass(g, i) {
    const y = Math.floor(i / g.nxz), r = i - y * g.nxz, z = Math.floor(r / g.nx), x = r - z * g.nx;
    return MATS[g.mat[i]].density * g.vol(x, y, z);
  }

  /** Load paths: interface pairs, mass above each column, strength, and support distances */
  initStats(s) {
    const g = s.g, { nx, ny, nz, nxz, mat } = g;
    s.pairs = new Int32Array(ny + 1);
    for (let y = 1; y < ny; y++) {
      let n = 0;
      const a = y * nxz, b = a - nxz;
      for (let c = 0; c < nxz; c++) if (mat[a + c] >= SOLID && mat[b + c] >= SOLID) n++;
      s.pairs[y] = n;
    }
    s.pairs0 = s.pairs.slice();
    s.nly = Math.ceil(ny / 4) + 1;
    s.colAbove = new Float32Array(s.nly * nxz);
    const layerMass = new Float64Array(ny);
    for (let c = 0; c < nxz; c++) {
      const x = c % nx, z = (c - x) / nx;
      let run = 0;
      for (let y = ny - 1; y >= 0; y--) {
        const i = c + nxz * y;
        if (mat[i] >= SOLID) { const m = MATS[mat[i]].density * g.vol(x, y, z); run += m; layerMass[y] += m; }
        if (y % 4 === 0) s.colAbove[(y >> 2) * nxz + c] = run;
      }
    }
    // Strength: the weakest intact level holds SAFETY times its load
    let above = 0, worst = 0;
    for (let y = ny - 1; y >= s.anchor; y--) {
      above += layerMass[y];
      let A = 0;
      const a = y * nxz, b = a - nxz;
      for (let c = 0; c < nxz; c++) if (mat[a + c] >= SOLID && mat[b + c] >= SOLID) { const x = c % nx; A += g.dx(x) * g.dz((c - x) / nx); }
      if (A > 0) worst = Math.max(worst, above / A);
    }
    s.sigma = Math.max(1e-6, worst * SAFETY);
    s.totalMass = layerMass.reduce((t, v) => t + v, 0);
    s.dist = null; // support distances: worked out at the first structural check (supportDist)
  }

  /** Steps from each cell to one standing on an unbroken solid column down to the ground */
  supportDist(s) {
    const g = s.g, { nx, ny, nz, nxz, mat } = g;
    s.dist = new Uint8Array(g.N).fill(255);
    scratch(g.N);
    let qh = 0, qt = 0;
    for (let c = 0; c < nxz; c++) {
      for (let y = 0; y < ny; y++) {
        const i = c + nxz * y;
        if (mat[i] < SOLID) break;
        s.dist[i] = 0;
        QUEUE[qt++] = i;
      }
    }
    while (qh < qt) {
      const i = QUEUE[qh++], d = s.dist[i] + 1;
      if (d >= 255) continue;
      const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
      if (x > 0 && mat[i - 1] >= SOLID && s.dist[i - 1] > d) { s.dist[i - 1] = d; QUEUE[qt++] = i - 1; }
      if (x < nx - 1 && mat[i + 1] >= SOLID && s.dist[i + 1] > d) { s.dist[i + 1] = d; QUEUE[qt++] = i + 1; }
      if (z > 0 && mat[i - nx] >= SOLID && s.dist[i - nx] > d) { s.dist[i - nx] = d; QUEUE[qt++] = i - nx; }
      if (z < nz - 1 && mat[i + nx] >= SOLID && s.dist[i + nx] > d) { s.dist[i + nx] = d; QUEUE[qt++] = i + nx; }
      if (y > 0 && mat[i - nxz] >= SOLID && s.dist[i - nxz] > d) { s.dist[i - nxz] = d; QUEUE[qt++] = i - nxz; }
      if (y < ny - 1 && mat[i + nxz] >= SOLID && s.dist[i + nxz] > d) { s.dist[i + nxz] = d; QUEUE[qt++] = i + nxz; }
    }
  }

  // ---- damage -------------------------------------------------------------------

  /** Destroy one cell. quiet: no structural check queued (pieces breaking away) */
  removeCell(s, i, quiet) {
    const g = s.g, m = g.mat[i];
    if (m < SOLID) return;
    g.mat[i] = GONE;
    s.count--;
    const md = s.mask.image.data;
    md[i * 2] = 0;
    md[i * 2 + 1] = 255;
    const { nx, nz, nxz } = g;
    const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
    if (!s.body) {
      if (y > 0 && g.mat[i - nxz] >= SOLID) s.pairs[y]--;
      if (y + 1 < g.ny && g.mat[i + nxz] >= SOLID) s.pairs[y + 1]--;
      const mm = MATS[m].density * g.vol(x, y, z);
      for (let ly = 0; ly * 4 <= y; ly++) s.colAbove[ly * nxz + r] -= mm;
      if (s.dist) s.dist[i] = 255;
    }
    const B = s.maskBox || (s.maskBox = [x, y, z, x + 1, y + 1, z + 1]);
    if (x < B[0]) B[0] = x; if (y < B[1]) B[1] = y; if (z < B[2]) B[2] = z;
    if (x >= B[3]) B[3] = x + 1; if (y >= B[4]) B[4] = y + 1; if (z >= B[5]) B[5] = z + 1;
    this.touchChunk(s, x, y, z);
    if (!quiet) s.pending.push(i);
    this.stats.removed++;
  }

  /** Mark the chunk of a changed cell for meshing, its neighbors too the first time */
  touchChunk(s, x, y, z) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), cz = Math.floor(z / CHUNK);
    const key = cx + 1024 * (cz + 1024 * cy);
    const fresh = !s.chunks.has(key) && !s.dirty.has(key);
    s.dirty.add(key);
    if (fresh) {
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const X = cx + a, Y = cy + b, Z = cz + c;
        if (X < 0 || Y < 0 || Z < 0 || X >= s.cn[0] || Y >= s.cn[1] || Z >= s.cn[2]) continue;
        const k = X + 1024 * (Z + 1024 * Y);
        if (!s.chunks.has(k)) s.dirty.add(k);
      }
    } else {
      // Faces on a chunk border belong to the neighbor too
      const lx = x - cx * CHUNK, ly = y - cy * CHUNK, lz = z - cz * CHUNK;
      if (lx === 0 && cx > 0) s.dirty.add(key - 1);
      if (lx === CHUNK - 1 && cx + 1 < s.cn[0]) s.dirty.add(key + 1);
      if (lz === 0 && cz > 0) s.dirty.add(key - 1024);
      if (lz === CHUNK - 1 && cz + 1 < s.cn[2]) s.dirty.add(key + 1024);
      if (ly === 0 && cy > 0) s.dirty.add(key - 1024 * 1024);
      if (ly === CHUNK - 1 && cy + 1 < s.cn[1]) s.dirty.add(key + 1024 * 1024);
    }
  }

  /**
   * Damage cells of s in a sphere around local (cx, cy, cz), r units across, with power at its
   * middle falling off to the edge. Cells out of hit points are destroyed; o.chunks of them
   * become flying rubble thrown out at o.speed. Returns the number destroyed.
   */
  damageSphere(s, cx, cy, cz, r, power, o = {}) {
    const g = s.g;
    if (cx + r < g.xs[0] || cx - r > g.xs[g.nx] || cy + r < g.ys[0] || cy - r > g.ys[g.ny] || cz + r < g.zs[0] || cz - r > g.zs[g.nz]) return 0;
    const x0 = lineIndexClamped(g.xs, cx - r), x1 = lineIndexClamped(g.xs, cx + r);
    const y0 = lineIndexClamped(g.ys, cy - r), y1 = lineIndexClamped(g.ys, cy + r);
    const z0 = lineIndexClamped(g.zs, cz - r), z1 = lineIndexClamped(g.zs, cz + r);
    const md = s.mask.image.data, r2 = r * r * 1.69;
    let removed = 0, spawned = 0, sx = 0, sy = 0, sz = 0, glass = 0, steel = 0, other = 0;
    const want = o.chunks ?? 10;
    for (let y = y0; y <= y1; y++) {
      const dy = g.cy(y) - cy;
      for (let z = z0; z <= z1; z++) {
        const dz = g.cz(z) - cz;
        for (let x = x0; x <= x1; x++) {
          const i = x + g.nx * (z + g.nz * y), m = g.mat[i];
          if (m < SOLID) continue;
          const dx = g.cx(x) - cx, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) continue;
          // Ragged: each cell sees the blast a little nearer or farther
          const f = d2 / (r * r) * (0.8 + Math.random() * 0.4);
          if (f >= 1) { md[i * 2 + 1] = Math.min(255, md[i * 2 + 1] + 90 * (1.69 - f)); continue; }
          const dmg = power * (1 - f) * (o.enemy ? 0.6 : 1);
          const hp = s.hp[i] - dmg;
          md[i * 2 + 1] = Math.min(255, md[i * 2 + 1] + dmg * 2.2);
          if (hp > 0) { s.hp[i] = hp; continue; }
          s.hp[i] = 0;
          removed++;
          const wx = g.cx(x), wy = g.cy(y), wz = g.cz(z);
          sx += wx; sy += wy; sz += wz;
          const name = MATS[m].name;
          if (name === 'glass' || name === 'light') glass++; else if (name === 'steel') steel++; else other++;
          if (spawned < want && this.frame.chunks < 140 && (spawned < 3 || Math.random() < 0.5)) {
            spawned++;
            this.frame.chunks++;
            this.chunkFrom(s, wx, wy, wz, dx, dy, dz, o.speed ?? 8, m, o);
          }
          this.removeCell(s, i, false);
        }
      }
    }
    if (s.maskBox == null) s.maskBox = [x0, y0, z0, x1 + 1, y1 + 1, z1 + 1];
    else { const B = s.maskBox; B[0] = Math.min(B[0], x0); B[1] = Math.min(B[1], y0); B[2] = Math.min(B[2], z0); B[3] = Math.max(B[3], x1 + 1); B[4] = Math.max(B[4], y1 + 1); B[5] = Math.max(B[5], z1 + 1); }
    if (removed) {
      const p = this.toWorld(s, sx / removed, sy / removed, sz / removed, _a);
      this.burstFx(p, removed, glass, steel, other, o);
    }
    if (s.body) { s.body.wake(); } else if (removed) this.wakeNear(s, cx, cy, cz, r);
    return removed;
  }

  toWorld(s, x, y, z, out) { return s.body ? s.body.toWorld(x, y, z, out) : out.set(x, y, z); }

  /** A flying chunk from a destroyed cell at local (x, y, z), thrown away from the blast */
  chunkFrom(s, x, y, z, dx, dy, dz, speed, m, o) {
    const p = this.toWorld(s, x, y, z, _b);
    const L = Math.hypot(dx, dy, dz) || 1;
    let vx = (dx / L) * speed, vy = (dy / L) * speed + speed * 0.4, vz = (dz / L) * speed;
    if (s.body) { s.body.dirWorld(vx, vy, vz, _c); vx = _c.x; vy = _c.y; vz = _c.z; s.body.pointVel(p, _d); vx += _d.x; vy += _d.y; vz += _d.z; }
    if (o.dir) { vx -= o.dir.x * speed * 0.5; vy -= o.dir.y * speed * 0.5; vz -= o.dir.z * speed * 0.5; }
    const k = rand(0.6, 1.4);
    this.debris.spawn(p.x, p.y, p.z, vx * k + rand(-2, 2), vy * k + rand(-1, 3), vz * k + rand(-2, 2), s.cellSize * rand(0.35, 0.8), m, rand(10, 22));
  }

  /** Dust, shards and sound for a batch of destroyed cells around p */
  burstFx(p, n, glass, steel, other, o = {}) {
    const fx = this.fx, M = this.M;
    if (other && this.frame.dust < 50) {
      const k = Math.min(3, 0.5 + Math.sqrt(other) * 0.18);
      for (let i = 0; i < Math.min(8, 1 + other / 6); i++) {
        this.frame.dust++;
        const g = rand(0.42, 0.56);
        fx.smoke.emit(p.x + rand(-1, 1) * k, p.y + rand(-1, 1) * k, p.z + rand(-1, 1) * k, rand(-2, 2), rand(0.5, 2.5), rand(-2, 2),
          rand(2, 4.5), M * 1.5 * k, M * 6 * k, g, g * 0.95, g * 0.88, 0.6, g, g * 0.96, g * 0.9, 0, 1.5, 0.25, rand(-1, 1));
      }
      this.sound.crumble(p, other);
    }
    if (glass) {
      // Glittering shards falling away from the facade
      for (let i = 0; i < Math.min(40, glass * 3); i++) {
        fx.sparks.emit(p.x + rand(-1, 1), p.y + rand(-1, 1), p.z + rand(-1, 1), rand(-6, 6), rand(-2, 6), rand(-6, 6),
          rand(0.8, 1.8), rand(0.08, 0.18), 0.05, 1.6, 1.9, 2.2, 1, 0.6, 0.75, 0.9, 0.7, 0.3, -this.G * 1.6);
      }
      this.sound.glassBreak(p, glass);
    }
    if (steel) {
      fx.sparksBurst(p, UP, Math.min(18, 4 + steel * 2), 0xffc070, 22);
      this.sound.metalHit(p, Math.min(1, 0.4 + steel * 0.1));
    }
  }

  /** Sleeping pieces resting near new damage wake up so they can fall */
  wakeNear(s, x, y, z, r) {
    for (const b of this.physics.bodies) {
      if (!b.sleeping) continue;
      if (b.max.x < x - r - 2 || b.min.x > x + r + 2 || b.max.y < y - r - 2 || b.min.y > y + r + 2 || b.max.z < z - r - 2 || b.min.z > z + r + 2) continue;
      b.wake();
    }
  }

  // ---- weapons -----------------------------------------------------------------

  /**
   * A round hits something. hit: from world.raycast (hit.struct for voxels, hit.collider for
   * city boxes). o: { radius (m), power, dir, speed, enemy, chunks }. Returns the cells destroyed.
   */
  bullet(hit, o) {
    if (!hit) return 0;
    let s = hit.struct, p = hit.point, n = hit.normal;
    if (!s) {
      const c = hit.collider;
      if (!c || !c.owner || !o.dir) return 0;
      s = this.activate(c.owner);
      if (!s) return 0;
      // Find the cell the round really meets inside the box it struck
      const back = 2;
      const from = _c.copy(p).addScaledVector(o.dir, -back);
      const r = this.rayStruct(s, from, o.dir, back + 6 * this.M);
      if (!r) return 0;
      p = _d.copy(from).addScaledVector(o.dir, r.t);
      n = _b.set(r.nx, r.ny, r.nz);
    }
    const R = o.radius * this.M;
    // Carve in from the surface, not around it
    _a.copy(p).addScaledVector(n, -R * 0.38);
    if (s.body) s.body.toLocal(_a.x, _a.y, _a.z, _a);
    return this.damageSphere(s, _a.x, _a.y, _a.z, R, o.power, o);
  }

  /**
   * An explosion at p: radius in meters, power at its middle. Activates whatever it reaches,
   * carves craters into structures and pieces and throws pieces about.
   */
  blast(p, radiusM, power, o = {}) {
    const R = radiusM * this.M;
    let total = 0;
    this.ownersIn(p.x - R, p.y - R, p.z - R, p.x + R, p.y + R, p.z + R, (ow) => {
      if (ow.struct || ow.dead) return;
      const B = ow.box;
      const dx = Math.max(B[0] - p.x, 0, p.x - B[3]), dy = Math.max(B[1] - p.y, 0, p.y - B[4]), dz = Math.max(B[2] - p.z, 0, p.z - B[5]);
      if (dx * dx + dy * dy + dz * dz < R * R * 0.6) this.activate(ow);
    });
    const opts = Object.assign({ speed: 10 + power * 0.04, chunks: Math.round(8 + radiusM * 6) }, o);
    for (const s of this.structs) {
      if (s.dead) continue;
      total += this.damageSphere(s, p.x, p.y, p.z, R, power, opts);
    }
    for (const b of [...this.physics.bodies]) {
      if (b.max.x < p.x - R || b.min.x > p.x + R || b.max.y < p.y - R || b.min.y > p.y + R || b.max.z < p.z - R || b.min.z > p.z + R) continue;
      b.toLocal(p.x, p.y, p.z, _a);
      total += this.damageSphere(b.s, _a.x, _a.y, _a.z, R, power, opts);
      // Shove it
      _b.subVectors(b.x, p);
      const d = Math.max(1, _b.length());
      const dv = Math.min(10, (power * 0.6 * this.M) / Math.sqrt(Math.max(1, b.cells)) / Math.max(1, d / R));
      b.v.addScaledVector(_b.normalize(), dv);
      b.w.x += rand(-1, 1) * dv * 0.05; b.w.z += rand(-1, 1) * dv * 0.05;
      b.wake();
    }
    return total;
  }

  /** The mega beam burning into whatever it touches this frame */
  beam(hit, dir, dt, o = {}) {
    if (!hit) return 0;
    return this.bullet(hit, Object.assign({ radius: 1.35, power: 4500 * dt, dir, speed: 6, chunks: 2 }, o));
  }

  // ---- structural checks -----------------------------------------------------------

  analyze(s) {
    const removed = s.pending;
    s.pending = [];
    if (!removed.length) return;
    if (s.body) { this.splitBody(s, removed); return; }
    if (!s.dist) this.supportDist(s);
    this.islands(s, removed);
    if (s.dead) return;
    this.sections(s, removed);
    if (s.dead) return;
    this.spans(s, removed);
    if (s.needFull && this.time - (s.fullT || -9) > 0.5) { s.fullT = this.time; s.needFull = false; this.fullIslands(s); }
  }

  /** Cells cut off from the ground: search down from each broken edge */
  islands(s, removed) {
    const g = s.g, { nx, ny, nz, nxz, mat } = g;
    scratch(g.N);
    const grounded = new Set();
    const seeds = [];
    const st0 = nextStamp();
    for (const i of removed) {
      const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
      const nb = [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, z > 0 ? i - nx : -1, z < nz - 1 ? i + nx : -1, y > 0 ? i - nxz : -1, y < ny - 1 ? i + nxz : -1];
      for (const j of nb) if (j >= 0 && mat[j] >= SOLID && VIS[j] !== st0) { VIS[j] = st0; seeds.push(j); }
    }
    let budget = ISLAND_BUDGET * 4;
    for (const seed of seeds) {
      if (mat[seed] < SOLID || grounded.has(VIS[seed])) continue;
      const st = nextStamp();
      let top = 0, found = false, count = 0;
      const cells = [];
      QUEUE[top++] = seed; VIS[seed] = st;
      while (top) {
        const i = QUEUE[--top];
        cells.push(i);
        if (++count > ISLAND_BUDGET || --budget < 0) { found = true; s.needFull = true; break; }
        const y = Math.floor(i / nxz);
        if (y < s.anchor) { found = true; break; }
        const r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
        // Pushed last, popped first: down
        const nb = [y < ny - 1 ? i + nxz : -1, x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, z > 0 ? i - nx : -1, z < nz - 1 ? i + nx : -1, y > 0 ? i - nxz : -1];
        let hitGround = false;
        for (const j of nb) {
          if (j < 0 || mat[j] < SOLID) continue;
          const v = VIS[j];
          if (v === st) continue;
          if (grounded.has(v)) { hitGround = true; break; }
          VIS[j] = st;
          QUEUE[top++] = j;
        }
        if (hitGround) { found = true; break; }
      }
      if (found) grounded.add(st);
      else this.detach(s, cells, { cause: 'island' });
      if (s.dead) return;
    }
  }

  /** Everything not reached from the ground breaks away */
  fullIslands(s) {
    const g = s.g, { nx, ny, nz, nxz, mat, N } = g;
    scratch(N);
    const st = nextStamp();
    let qh = 0, qt = 0;
    for (let i = 0; i < s.anchor * nxz; i++) if (mat[i] >= SOLID) { VIS[i] = st; QUEUE[qt++] = i; }
    const visit = (j) => { if (mat[j] >= SOLID && VIS[j] !== st) { VIS[j] = st; QUEUE[qt++] = j; } };
    while (qh < qt) {
      const i = QUEUE[qh++], y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
      if (x > 0) visit(i - 1); if (x < nx - 1) visit(i + 1); if (z > 0) visit(i - nx); if (z < nz - 1) visit(i + nx); if (y > 0) visit(i - nxz); if (y < ny - 1) visit(i + nxz);
    }
    // Label what was not reached
    for (let i = 0; i < N; i++) {
      if (mat[i] < SOLID || VIS[i] === st) continue;
      const cells = [];
      const ls = nextStamp();
      let h = 0, t = 0;
      const local = [];
      local.push(i); VIS[i] = ls;
      while (h < local.length) {
        const c = local[h++];
        cells.push(c);
        const y = Math.floor(c / nxz), r = c - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
        for (const j of [x > 0 ? c - 1 : -1, x < nx - 1 ? c + 1 : -1, z > 0 ? c - nx : -1, z < nz - 1 ? c + nx : -1, y > 0 ? c - nxz : -1, y < ny - 1 ? c + nxz : -1]) {
          if (j >= 0 && mat[j] >= SOLID && VIS[j] !== ls && VIS[j] !== st) { VIS[j] = ls; local.push(j); }
        }
        t++;
      }
      this.detach(s, cells, { cause: 'island' });
      if (s.dead) return;
    }
  }

  /** Check the levels the damage weakened most */
  sections(s, removed) {
    const g = s.g, nxz = g.nxz, seen = new Set();
    for (const i of removed) {
      const y = Math.floor(i / nxz);
      if (y >= s.anchor) seen.add(y);
      if (y + 1 < g.ny && y + 1 >= s.anchor) seen.add(y + 1);
    }
    const cands = [...seen].filter((y) => s.pairs0[y] > 0 && s.pairs[y] < s.pairs0[y] * 0.985)
      .sort((a, b) => s.pairs[a] / s.pairs0[a] - s.pairs[b] / s.pairs0[b]).slice(0, 3);
    for (const y of cands) {
      if (s.dead) return;
      this.checkLevel(s, y);
    }
  }

  /**
   * Can what stands above level y (the interface between layers y - 1 and y) still be carried?
   * The section splits into separate pieces of floor plan (two towers on a podium); every column
   * of cells above hands its weight to the nearest piece. Each piece fails if its load is more
   * than its strength, reduced the farther the load's center sits toward its edge, or if the
   * center is past the edge: then it tips.
   */
  checkLevel(s, y) {
    const g = s.g, { nx, nz, ny, nxz, mat } = g;
    scratch(nxz * 2);
    const lab = new Int32Array(nxz).fill(-1);
    const comps = [];
    const a = y * nxz, b = a - nxz;
    // Pieces of plan more than about 8 m apart stand apart (twin towers, the bents of the El);
    // closer ones (columns and the walls round them) work together. Label a coarse grid of
    // ~4 m squares, grown by one square, so gaps under 8 m close up.
    const k = Math.max(1, Math.round((4 * this.M) / s.cellSize)), cx = Math.ceil(nx / k), cz = Math.ceil(nz / k);
    const on = new Uint8Array(cx * cz), grown = new Int32Array(cx * cz).fill(-2);
    for (let c = 0; c < nxz; c++) if (mat[a + c] >= SOLID && mat[b + c] >= SOLID) { const x = c % nx; on[Math.floor(x / k) + cx * Math.floor((c - x) / nx / k)] = 1; }
    for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) {
      let any = 0;
      for (let dj = -1; dj <= 1 && !any; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < cx && jj < cz && on[ii + cx * jj]) { any = 1; break; }
      }
      if (any) grown[i + cx * j] = -1;
    }
    for (let q = 0; q < cx * cz; q++) {
      if (grown[q] !== -1) continue;
      const id = comps.length, list = [q];
      grown[q] = id;
      for (let h = 0; h < list.length; h++) {
        const p = list[h], i = p % cx, j = (p - i) / cx;
        for (const n of [i > 0 ? p - 1 : -1, i < cx - 1 ? p + 1 : -1, j > 0 ? p - cx : -1, j < cz - 1 ? p + cx : -1]) if (n >= 0 && grown[n] === -1) { grown[n] = id; list.push(n); }
      }
      comps.push({ cells: [], M: 0, mx: 0, mz: 0 });
    }
    for (let c = 0; c < nxz; c++) {
      if (mat[a + c] < SOLID || mat[b + c] < SOLID) continue;
      const x = c % nx, id = grown[Math.floor(x / k) + cx * Math.floor((c - x) / nx / k)];
      lab[c] = id;
      comps[id].cells.push(c);
    }
    if (!comps.length) return;
    // Nearest section piece for every column
    const near = new Int32Array(nxz).fill(-1);
    let qh = 0, qt = 0;
    for (let c = 0; c < nxz; c++) if (lab[c] >= 0) { near[c] = lab[c]; QUEUE[qt++] = c; }
    while (qh < qt) {
      const k = QUEUE[qh++], x = k % nx, z = (k - x) / nx, id = near[k];
      if (x > 0 && near[k - 1] < 0) { near[k - 1] = id; QUEUE[qt++] = k - 1; }
      if (x < nx - 1 && near[k + 1] < 0) { near[k + 1] = id; QUEUE[qt++] = k + 1; }
      if (z > 0 && near[k - nx] < 0) { near[k - nx] = id; QUEUE[qt++] = k - nx; }
      if (z < nz - 1 && near[k + nx] < 0) { near[k + nx] = id; QUEUE[qt++] = k + nx; }
    }
    // Weight above y in each column
    const ly = Math.ceil(y / 4), yEnd = Math.min(ly * 4, ny);
    for (let c = 0; c < nxz; c++) {
      let m = ly < s.nly && ly * 4 < ny ? s.colAbove[ly * nxz + c] : 0;
      const x = c % nx, z = (c - x) / nx;
      for (let yy = y; yy < yEnd; yy++) { const i = c + nxz * yy; if (mat[i] >= SOLID) m += MATS[mat[i]].density * g.vol(x, yy, z); }
      if (m <= 0) continue;
      const C = comps[near[c]];
      C.M += m; C.mx += m * g.cx(x); C.mz += m * g.cz(z);
    }
    for (let id = 0; id < comps.length; id++) {
      const C = comps[id];
      if (C.M <= 0) continue;
      let A = 0, ax = 0, az = 0;
      for (const k of C.cells) { const x = k % nx, z = (k - x) / nx, w = g.dx(x) * g.dz(z); A += w; ax += w * g.cx(x); az += w * g.cz(z); }
      ax /= A; az /= A;
      const ex = C.mx / C.M - ax, ez = C.mz / C.M - az, e = Math.hypot(ex, ez);
      let ratio = 0;
      if (e > 1e-4) {
        const ux = ex / e, uz = ez / e;
        let reach = 0;
        for (const k of C.cells) { const x = k % nx, z = (k - x) / nx; reach = Math.max(reach, (g.cx(x) - ax) * ux + (g.cz(z) - az) * uz + 0.5 * (Math.abs(ux) * g.dx(x) + Math.abs(uz) * g.dz(z))); }
        ratio = e / Math.max(1e-6, reach);
      }
      const cap = s.sigma * A * Math.max(0, 1 - ratio);
      const stress = cap > 0 ? C.M / cap : Infinity;
      const wy = g.ys[y];
      if (ratio >= 1 || stress >= 1) {
        this.fail(s, y, near, id, ratio > 0.55 ? 'tip' : 'crush', { ax, az, ex, ez, wy, M: C.M });
        return;
      }
      if ((stress > 0.55 || ratio > 0.72) && this.time > s.warnT) this.warn(s, ax, wy, az, C, Math.max(stress, ratio));
    }
  }

  /** A level gives: the floors above come down, crushing a storey or tipping over */
  fail(s, y, near, id, mode, info) {
    const g = s.g, { nx, ny, nxz, mat } = g;
    this.stats.collapses++;
    let y0 = y;
    const p = _a.set(info.ax, info.wy, info.az);
    if (mode === 'crush') {
      // The weakest storey turns to rubble and everything above drops onto what is left
      const crushTop = Math.min(ny, y + Math.max(2, Math.round((3.2 * this.M) / s.cellSize)));
      let n = 0;
      for (let yy = y; yy < crushTop; yy++) {
        for (let c = 0; c < nxz; c++) {
          if (near[c] !== id) continue;
          const i = c + nxz * yy;
          if (mat[i] < SOLID) continue;
          if (n++ % 3 === 0 && this.frame.chunks < 200) {
            this.frame.chunks++;
            const x = c % nx, z = (c - x) / nx;
            this.chunkFrom(s, g.cx(x), g.cy(yy), g.cz(z), g.cx(x) - info.ax, 0, g.cz(z) - info.az, 6, mat[i], {});
          }
          this.removeCell(s, i, true);
        }
      }
      y0 = crushTop;
    }
    const cells = [];
    for (let yy = y0; yy < ny; yy++) for (let c = 0; c < nxz; c++) if (near[c] === id && mat[c + nxz * yy] >= SOLID) cells.push(c + nxz * yy);
    // Dust bursting out of the failing floor all round
    this.dustRing(p, Math.sqrt(info.M / Math.max(1e-6, this.M ** 3)) * 0.02 + 2, mode === 'crush' ? 1.6 : 1);
    const size = Math.min(4, Math.cbrt(cells.length) / 12);
    this.sound.collapse(p, size);
    this.fx.onShake(p, 0.6 + size * 0.3);
    const b = this.detach(s, cells, { cause: mode });
    if (b && mode === 'tip') {
      // A nudge over the edge so it doesn't balance on a knife edge
      const e = Math.hypot(info.ex, info.ez) || 1;
      b.w.x += (info.ez / e) * 0.04; b.w.z -= (info.ex / e) * 0.04;
    }
  }

  /** A strained level groans and sheds dust and grit */
  warn(s, x, y, z, C, k) {
    s.warnT = this.time + rand(1.2, 2.4);
    const p = _a.set(x, y, z);
    this.sound.groan(p, k);
    const g = s.g, nx = g.nx;
    for (let i = 0; i < 16; i++) {
      const c = C.cells[Math.floor(Math.random() * C.cells.length)], cx = c % nx, cz = (c - cx) / nx;
      const px = g.cx(cx), pz = g.cz(cz), gy = rand(0.4, 0.5);
      this.fx.smoke.emit(px, y + rand(0, 1), pz, rand(-1, 1), rand(-2, 0), rand(-1, 1), rand(2, 3.5), this.M * 0.8, this.M * 4, gy, gy, gy * 0.92, 0.45, gy, gy, gy, 0, 0.8, 0.4);
      if (i % 3 === 0) this.debris.spawn(px, y, pz, rand(-1, 1), rand(-1, 0), rand(-1, 1), s.cellSize * 0.3, 3, 6);
    }
  }

  dustRing(p, r, k = 1) {
    const fx = this.fx, M = this.M;
    for (let i = 0; i < 40 * k; i++) {
      const a = Math.random() * Math.PI * 2, d = r * rand(0.6, 1.2), sp = rand(4, 12) * k;
      const gy = rand(0.4, 0.55);
      fx.smoke.emit(p.x + Math.cos(a) * d, p.y + rand(-1, 2), p.z + Math.sin(a) * d, Math.cos(a) * sp, rand(-0.5, 2.5), Math.sin(a) * sp,
        rand(4, 8), M * 4, M * rand(14, 22), gy, gy * 0.96, gy * 0.9, 0.7, gy, gy * 0.96, gy * 0.9, 0, 1.2, 0.15, rand(-0.6, 0.6));
    }
  }

  /**
   * Overhangs and floors left without support: around the damage, recompute each cell's
   * distance from a solid path to the ground. Cells pushed past what their material spans,
   * and farther than they were before, give way.
   */
  spans(s, removed) {
    const g = s.g, { nx, ny, nz, nxz, mat } = g;
    let x0 = nx, y0 = ny, z0 = nz, x1 = 0, y1 = 0, z1 = 0;
    for (const i of removed) {
      const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const S = Math.min(40, Math.ceil((9.5 * this.M) / s.cellSize));
    x0 = Math.max(0, x0 - S); x1 = Math.min(nx - 1, x1 + S); z0 = Math.max(0, z0 - S); z1 = Math.min(nz - 1, z1 + S);
    y0 = Math.max(0, y0 - 1); y1 = Math.min(ny - 1, y1 + S);
    const rw = x1 - x0 + 1, rd = z1 - z0 + 1, rh = y1 - y0 + 1, RN = rw * rd * rh;
    if (RN > 900000) return;
    const nd = new Uint8Array(RN).fill(255);
    const L = (x, y, z) => (x - x0) + rw * ((z - z0) + rd * (y - y0));
    // Buckets by distance
    const buckets = [];
    const push = (d, i) => { (buckets[d] || (buckets[d] = [])).push(i); };
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      let anch = y0 === 0 || (mat[x + nx * (z + nz * (y0 - 1))] >= SOLID && s.dist[x + nx * (z + nz * (y0 - 1))] === 0);
      for (let y = y0; y <= y1; y++) {
        const i = x + nx * (z + nz * y);
        if (mat[i] < SOLID) { anch = false; continue; }
        anch = anch || y < s.anchor;
        const l = L(x, y, z);
        if (anch) { nd[l] = 0; push(0, l); continue; }
        // The region's sides and top keep what they had; its floor hands up from below
        const edge = x === x0 || x === x1 || z === z0 || z === z1 || y === y1;
        let d0 = edge ? s.dist[i] : 255;
        if (y === y0 && y0 > 0 && mat[i - nxz] >= SOLID) d0 = Math.min(d0, s.dist[i - nxz] + 1);
        if (d0 < 255) { nd[l] = d0; push(d0, l); }
      }
    }
    for (let d = 0; d < buckets.length; d++) {
      const B = buckets[d];
      if (!B) continue;
      for (let k = 0; k < B.length; k++) {
        const l = B[k];
        if (nd[l] !== d) continue;
        const x = l % rw, t = (l - x) / rw, z = t % rd, y = (t - z) / rd;
        const nd1 = d + 1;
        if (nd1 >= 255) continue;
        const gi = (x + x0) + nx * ((z + z0) + nz * (y + y0));
        const tryN = (ok, ln, gn) => { if (ok && mat[gn] >= SOLID && nd[ln] > nd1) { nd[ln] = nd1; push(nd1, ln); } };
        tryN(x > 0, l - 1, gi - 1); tryN(x < rw - 1, l + 1, gi + 1);
        tryN(z > 0, l - rw, gi - nx); tryN(z < rd - 1, l + rw, gi + nx);
        tryN(y > 0, l - rw * rd, gi - nxz); tryN(y < rh - 1, l + rw * rd, gi + nxz);
      }
    }
    // Failing cells
    const fail = [];
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = x + nx * (z + nz * y), m = mat[i];
      if (m < SOLID) continue;
      const d = nd[L(x, y, z)], lim = Math.max(2, (MATS[m].span * this.M) / s.cellSize);
      if (d > lim && d > s.dist[i] + 1) fail.push(i);
      else s.dist[i] = d;
    }
    if (!fail.length) return;
    // Break them away in connected pieces
    scratch(g.N);
    const fs = nextStamp();
    for (const i of fail) VIS[i] = fs;
    for (const i of fail) {
      if (VIS[i] !== fs || mat[i] < SOLID) continue;
      const ps = nextStamp(), cells = [i];
      VIS[i] = ps;
      for (let h = 0; h < cells.length; h++) {
        const c = cells[h], y = Math.floor(c / nxz), r = c - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
        for (const j of [x > 0 ? c - 1 : -1, x < nx - 1 ? c + 1 : -1, z > 0 ? c - nx : -1, z < nz - 1 ? c + nx : -1, y > 0 ? c - nxz : -1, y < ny - 1 ? c + nxz : -1]) {
          if (j >= 0 && VIS[j] === fs && mat[j] >= SOLID) { VIS[j] = ps; cells.push(j); }
        }
      }
      if (cells.length > 2) this.sound.crash(this.toWorld(s, g.cx(cells[0] % nx), g.ys[Math.floor(cells[0] / nxz)], g.cz(Math.floor((cells[0] % nxz) / nx)), _b), Math.min(2, cells.length / 400));
      this.detach(s, cells, { cause: 'span' });
      if (s.dead) return;
    }
  }

  /** After damage to a piece: split it if it came apart, and refresh its mass */
  splitBody(s, removed) {
    const g = s.g, { nx, ny, nz, nxz, mat, N } = g, b = s.body;
    if (!b) return;
    scratch(N);
    const comps = [];
    const st = nextStamp();
    let total = 0;
    for (let i = 0; i < N; i++) {
      if (mat[i] < SOLID || VIS[i] === st) continue;
      const cells = [i];
      VIS[i] = st;
      for (let h = 0; h < cells.length; h++) {
        const c = cells[h], y = Math.floor(c / nxz), r = c - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
        for (const j of [x > 0 ? c - 1 : -1, x < nx - 1 ? c + 1 : -1, z > 0 ? c - nx : -1, z < nz - 1 ? c + nx : -1, y > 0 ? c - nxz : -1, y < ny - 1 ? c + nxz : -1]) {
          if (j >= 0 && mat[j] >= SOLID && VIS[j] !== st) { VIS[j] = st; cells.push(j); }
        }
      }
      comps.push(cells);
      total += cells.length;
      if (total > 250000) break;
    }
    if (!comps.length) { this.killBody(b); return; }
    comps.sort((p, q) => q.length - p.length);
    for (let k = 1; k < comps.length; k++) this.detach(s, comps[k], { cause: 'split' });
    if (!s.dead) this.refreshBody(b);
  }

  /** New mass, center and probes after cells were lost, keeping the piece where it is */
  refreshBody(b) {
    const world = b.toWorld(b.c.x, b.c.y, b.c.z, new V3());
    const oc = b.c.clone();
    b.mass();
    if (b.cells < 1) { this.killBody(b); return; }
    // Same pose: the new center's world position
    _a.copy(b.c).sub(oc);
    b.dirWorld(_a.x, _a.y, _a.z, _b);
    b.x.copy(world).add(_b);
    b.probes = makeProbes(b.s.g, b.c);
    b.updateR();
    b.wake();
  }

  // ---- breaking away ------------------------------------------------------------------

  /**
   * Cells of s become a new piece of their own: a sub-grid, the skin clipped to it, a body
   * that starts with the parent's motion. Tiny pieces just become rubble.
   */
  detach(s, cells, o = {}) {
    if (!cells.length) return null;
    const g = s.g, { nx, nz, nxz, mat } = g;
    if (cells.length < 5 || (this.physics.bodies.length >= MAX_BODIES && cells.length < 400)) {
      for (const i of cells) {
        const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
        if (this.frame.chunks < 200) { this.frame.chunks++; this.chunkFrom(s, g.cx(x), g.cy(y), g.cz(z), 0, 1, 0, 1, mat[i], {}); }
        this.removeCell(s, i, false);
      }
      this.checkDead(s);
      return null;
    }
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -1, y1 = -1, z1 = -1;
    scratch(g.N);
    const st = nextStamp();
    for (const i of cells) {
      VIS[i] = st;
      const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const bg = g.sub(x0, y0, z0, x1 + 1, y1 + 1, z1 + 1);
    bg.hp = new Uint8Array(bg.N);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const gi = x + nx * (z + nz * y), bi = (x - x0) + bg.nx * ((z - z0) + bg.nz * (y - y0));
      if (VIS[gi] === st) bg.hp[bi] = s.hp[gi];
      else if (bg.mat[bi] >= SOLID) bg.mat[bi] = GONE;
    }
    // Out of the parent; the edge it broke from gets checked
    for (const i of cells) this.removeCell(s, i, true);
    for (const i of cells) {
      const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
      if ((x > 0 && mat[i - 1] >= SOLID) || (x < nx - 1 && mat[i + 1] >= SOLID) || (z > 0 && mat[i - nx] >= SOLID) || (z < nz - 1 && mat[i + nx] >= SOLID) || (y > 0 && mat[i - nxz] >= SOLID) || (y < g.ny - 1 && mat[i + nxz] >= SOLID)) s.pending.push(i);
    }
    const off = [s.off[0] + x0, s.off[1] + y0, s.off[2] + z0];
    const bs = new Structure(this, bg, s.owner, s.lut, off);
    bs.hp = bg.hp;
    bs.cellSize = s.cellSize;
    bs.sigma = s.sigma;
    bs.ref = { vox: bs };
    const e = s.cellSize * 0.02;
    bs.skin = clipSkin(s.skin, [bg.xs[0] - e, bg.ys[0] - e, bg.zs[0] - e, bg.xs[bg.nx] + e, bg.ys[bg.ny] + e, bg.zs[bg.nz] + e]);
    this.buildSkin(bs);
    // Mesh the broken faces it carries
    for (let y = 0; y < bg.ny; y++) for (let z = 0; z < bg.nz; z++) for (let x = 0; x < bg.nx; x++) {
      if (bg.mat[x + bg.nx * (z + bg.nz * y)] === GONE) bs.dirty.add(Math.floor(x / CHUNK) + 1024 * (Math.floor(z / CHUNK) + 1024 * Math.floor(y / CHUNK)));
    }
    const b = new Body(bs);
    bs.body = b;
    if (s.body) {
      const pb = s.body;
      b.q.copy(pb.q);
      b.updateR();
      pb.toWorld(b.c.x, b.c.y, b.c.z, b.x);
      pb.pointVel(b.x, b.v);
      b.w.copy(pb.w);
      b.age = pb.age;
    }
    b.updateR();
    this.physics.add(b);
    this.scene.add(bs.group);
    b.matrix(bs.group.matrix);
    bs.group.matrixWorldNeedsUpdate = true;
    this.stats.bodies++;
    this.knockOff(b);
    this.checkDead(s);
    return b;
  }

  /** A structure with nothing solid left goes */
  checkDead(s) {
    if (s.dead || s.count > 0) return;
    if (s.body) this.killBody(s.body); else this.disposeStruct(s);
  }

  killBody(b) {
    this.physics.remove(b);
    this.disposeStruct(b.s);
  }

  disposeStruct(s) {
    if (s.dead) return;
    s.dead = true;
    this.scene.remove(s.group);
    for (const mesh of s.skinMeshes) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.customDepthMaterial.dispose(); }
    if (s.faceMesh) s.faceMesh.geometry.dispose();
    s.mask.dispose();
    if (!s.body) { const i = this.structs.indexOf(s); if (i >= 0) this.structs.splice(i, 1); }
  }

  /** Spiders standing on a piece that breaks away lose their footing */
  knockOff(b) {
    const S = this.spiders;
    if (!S) return;
    for (const sp of S.list) {
      if (!sp.alive || sp.removed || (sp.state !== 'crawl' && sp.state !== 'perch' && sp.state !== 'emerge' && sp.state !== 'crouch')) continue;
      _a.copy(sp.p).addScaledVector(sp.n, -0.3);
      if (_a.x < b.min.x || _a.x > b.max.x || _a.y < b.min.y || _a.y > b.max.y || _a.z < b.min.z || _a.z > b.max.z) continue;
      b.toLocal(_a.x, _a.y, _a.z, _b);
      const k = b.s.g.cellAt(_b.x, _b.y, _b.z);
      if (k < 0 || b.s.g.mat[k] < SOLID) continue;
      sp.state = 'fall';
      sp.flight = { target: null };
      sp.goal = null;
      sp.support = null;
      sp.vel.set(rand(-3, 3), rand(1, 4), rand(-3, 3));
    }
  }

  // ---- impacts ---------------------------------------------------------------------

  /** A piece hit something hard this step: dust, sound, crushing and maybe shattering */
  impacts(dt) {
    const M = this.M;
    for (const b of [...this.physics.bodies]) {
      b.crashT = Math.max(0, (b.crashT || 0) - dt);
      const imp = b.impact;
      if (!imp || b.s.dead) continue;
      const sp = imp.speed / M; // m/s
      if (sp < 2.5) continue;
      const size = Math.cbrt(b.cells);
      if (b.crashT <= 0) {
        b.crashT = 0.18;
        const k = Math.min(3, size / 10) * Math.min(1.5, sp / 10);
        if (k > 0.15) {
          this.dustRing(imp.point, M * (1 + size * 0.15), Math.min(1.4, 0.25 + k * 0.35));
          this.sound.crash(imp.point, k);
          this.fx.onShake(imp.point, Math.min(1, 0.1 + k * 0.25));
        }
        // Crush what it hit, and chip itself where it struck
        if (sp > 5) {
          const R = Math.min(5, 0.3 * Math.sqrt(sp) * Math.max(0.6, size / 14)), P = Math.min(420, 30 + sp * 22);
          this.crushOther(imp, R, P, b);
          b.toLocal(imp.point.x, imp.point.y, imp.point.z, _a);
          this.damageSphere(b.s, _a.x, _a.y, _a.z, Math.min(R, 2) * M, P * 0.7, { speed: sp * 0.4 * M, chunks: 6 });
          if (b.s.dead) continue;
        }
      }
      // Shatter
      const thr = 7 + 30 / Math.cbrt(Math.max(1, b.cells / 40));
      if (sp > thr && b.fractureCool <= 0 && b.cells >= 120) {
        this.log.push({ t: +this.time.toFixed(2), cells: b.cells, sp: +sp.toFixed(1), thr: +thr.toFixed(1), kind: imp.kind, other: imp.other && imp.other.isBody ? imp.other.cells : imp.other ? 'static' : 'ground' });
        if (this.log.length > 60) this.log.shift();
        this.fracture(b, imp, sp);
      }
    }
  }

  /**
   * Contacts that press harder than what they press on can carry crush it, on either side: a
   * toppling block grinds away the edge it pivots on, a dropped storey keeps pancaking down.
   * Pressure is the pair's total contact force (in weight) over the patch its contacts span.
   */
  pressures(dt) {
    const G = this.G;
    for (const list of this.physics.manifolds) {
      if (!list.length) continue;
      const c0 = list[0], a = c0.a, b = c0.b;
      if (!a || a.s.dead) continue;
      let F = 0;
      for (const c of list) F += c.jn;
      if (F <= 0) continue;
      const key = `${a.id}|${b ? (b.isBody ? b.id : b.vox ? 's' + b.vox.id : 'c') : 'g'}`;
      const now = this.time;
      if ((this.crushAt.get(key) || 0) > now) continue;
      // Patch: the spread of the contacts across the contact plane, at least a cell
      const n = c0.n, t1 = c0.t1, t2 = c0.t2, cs = a.s.cellSize;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const c of list) { const u = c.p.dot(t1), v = c.p.dot(t2); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const other = b && b.vox ? b.vox : b && b.isBody ? b.s : null;
      // What bears the load is the solid under the patch (walls and columns), not its outline
      let area = (u1 - u0 + cs * 1.5) * (v1 - v0 + cs * 1.5);
      if (other && !other.body) area = Math.min(area, Math.max(cs * cs, this.bearing(other, list, n, cs)));
      const P = F / dt / G / area;
      const selfS = a.s.sigma || 0, otherS = other ? other.sigma || 0 : 0;
      const crushSelf = selfS > 0 && P > selfS, crushOther = other && !other.dead && otherS > 0 && P > otherS;
      // An unbroken city box that is pressed on hard becomes a structure that can give
      if (b && !b.vox && !b.isBody && b.owner && P > 0.5 * (a.s.sigma || 1)) { this.activate(b.owner); continue; }
      if (!crushSelf && !crushOther) continue;
      if (this.crushAt.size > 4000) this.crushAt.clear();
      this.crushAt.set(key, now + 0.035);
      // The hardest-pressed contacts give, faster the more they are overloaded
      const q = P / Math.max(1e-9, crushOther ? otherS : selfS);
      const top = list.slice().sort((x, y) => y.jn - x.jn).slice(0, Math.min(list.length, 2 + Math.floor(q)));
      this.stats.crushes = (this.stats.crushes || 0) + 1;
      this.stats.maxQ = Math.max(this.stats.maxQ || 0, Math.round(q));
      // A broad patch hit far beyond its strength gives way all at once: a whole slab under it
      // turns to rubble, so a falling block crushes down floor by floor
      const wide = (u1 - u0) > cs * 4 && (v1 - v0) > cs * 4;
      // Landing hard on top of what's left: the block crushes its way down through it
      if (wide && q > 6 && crushOther && !other.body && n.y > 0.9 && !a.crushDown && a.cells > 400) {
        a.crushDown = { s: other, slow: 0 };
        this.stats.crushDowns = (this.stats.crushDowns || 0) + 1;
        this.sound.collapse(c0.p, Math.min(3, Math.cbrt(a.cells) / 14));
        continue;
      }
      if (wide && q > 2.5 && crushOther && !other.body && Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z) < 1.01) {
        const depth = cs * Math.min(7, 1 + 0.7 * Math.sqrt(q)), pad = cs * 0.8;
        const lo = [0, 0, 0], hi = [0, 0, 0];
        for (let ax = 0; ax < 3; ax++) { lo[ax] = Infinity; hi[ax] = -Infinity; }
        for (const c of list) for (let ax = 0; ax < 3; ax++) { const v = c.p.getComponent(ax); lo[ax] = Math.min(lo[ax], v - pad); hi[ax] = Math.max(hi[ax], v + pad); }
        // Into the structure along -n
        const ax = Math.abs(n.x) > 0.5 ? 0 : Math.abs(n.y) > 0.5 ? 1 : 2, sg = n.getComponent(ax) > 0 ? 1 : -1;
        if (sg > 0) { lo[ax] = hi[ax] - depth - pad; } else { hi[ax] = lo[ax] + depth + pad; }
        this.crushBox(other, lo, hi);
        if (crushSelf && !a.s.dead) for (const c of top) { a.toLocal(c.p.x, c.p.y, c.p.z, _a); this.damageSphere(a.s, _a.x, _a.y, _a.z, cs * 2, 9999, { chunks: 2 }); }
        this.dustRing(c0.p, (u1 - u0 + v1 - v0) * 0.35, Math.min(1.6, 0.4 + q * 0.05));
        if (Math.random() < 0.5) this.sound.crash(c0.p, Math.min(3, Math.sqrt(q) * 0.4));
        continue;
      }
      for (const c of top) {
        const r = cs * Math.min(4, 0.8 + 0.55 * Math.sqrt(q));
        if (crushOther) {
          if (other.body) { other.body.toLocal(c.p.x, c.p.y, c.p.z, _a); this.damageSphere(other, _a.x, _a.y, _a.z, r, 9999, { chunks: 2, speed: 4 * this.M }); }
          else this.damageSphere(other, c.p.x - n.x * cs * 0.3, c.p.y - n.y * cs * 0.3, c.p.z - n.z * cs * 0.3, r, 9999, { chunks: 2, speed: 4 * this.M });
        }
        if (crushSelf && !a.s.dead) {
          a.toLocal(c.p.x + n.x * cs * 0.3, c.p.y + n.y * cs * 0.3, c.p.z + n.z * cs * 0.3, _a);
          this.damageSphere(a.s, _a.x, _a.y, _a.z, r, 9999, { chunks: 2, speed: 4 * this.M });
        }
      }
      if (Math.random() < 0.3) this.dustRing(c0.p, cs * 3, 0.25);
    }
  }

  /**
   * A block crushing down through a standing structure (progressive collapse): every cell of the
   * structure its solid will pass through this step turns to rubble and dust, and it is slowed
   * by about half its weight. Ends at the ground or once it has nearly stopped.
   */
  crushDown(b, dt) {
    const C = b.crushDown, s = C.s, M = this.M;
    if (s.dead || b.s.dead) { b.crushDown = null; return; }
    b.wake();
    b.v.y += this.G * 0.48 * dt;
    b.v.x *= 1 - 2 * dt; b.v.z *= 1 - 2 * dt;
    b.w.multiplyScalar(1 - 3 * dt);
    C.slow = b.v.y > -0.6 * M ? C.slow + dt : 0;
    if (C.slow > 0.35 || b.min.y < this.ground(b.x.x, b.x.z) + 0.5 * M) { b.crushDown = null; return; }
    // Cells of the structure in the band the block's underside sweeps through
    const g = s.g, travel = Math.max(0, -b.v.y * dt) + s.cellSize;
    const x0 = lineIndexClamped(g.xs, b.min.x), x1 = lineIndexClamped(g.xs, b.max.x);
    const z0 = lineIndexClamped(g.zs, b.min.z), z1 = lineIndexClamped(g.zs, b.max.z);
    const y0 = lineIndexClamped(g.ys, b.min.y - travel), y1 = lineIndexClamped(g.ys, b.min.y + Math.min(b.max.y - b.min.y, s.cellSize * 6));
    const bg = b.s.g;
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = x + g.nx * (z + g.nz * y), m = g.mat[i];
      if (m < SOLID) continue;
      // Under the block's solid: the cell, lifted by the step's travel, falls inside it
      b.toLocal(g.cx(x), g.cy(y) + travel, g.cz(z), _a);
      const k = bg.cellAt(_a.x, _a.y, _a.z);
      if (k < 0 || bg.mat[k] < SOLID) {
        b.toLocal(g.cx(x), g.cy(y) + travel + s.cellSize, g.cz(z), _a);
        const k2 = bg.cellAt(_a.x, _a.y, _a.z);
        if (k2 < 0 || bg.mat[k2] < SOLID) continue;
      }
      n++; sx += g.cx(x); sy += g.cy(y); sz += g.cz(z);
      if (n % 5 === 0 && this.frame.chunks < 220) {
        this.frame.chunks++;
        this.chunkFrom(s, g.cx(x), g.cy(y), g.cz(z), g.cx(x) - b.x.x, 0.2, g.cz(z) - b.x.z, rand(4, 12) * M, m, {});
      }
      this.removeCell(s, i, false);
    }
    // The block's own underside crumbles too, now and then
    if (Math.random() < dt * 6) {
      const P = b.probes;
      for (let t = 0; t < 3; t++) {
        const j = Math.floor(Math.random() * (P.length / 3));
        if (P[j * 3 + 1] > b.c.y) continue;
        this.damageSphere(b.s, P[j * 3], P[j * 3 + 1], P[j * 3 + 2], b.s.cellSize * 2.2, 9999, { chunks: 3, speed: 6 * M });
      }
    }
    if (n) {
      C.dust = (C.dust || 0) - dt;
      if (C.dust <= 0) {
        C.dust = 0.12;
        _b.set(sx / n, sy / n, sz / n);
        this.dustRing(_b, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.55, Math.min(1.5, 0.4 + n / 300));
        this.sound.crumble(_b, 40);
        if (Math.random() < 0.3) this.sound.crash(_b, Math.min(2.5, n / 200));
        this.fx.onShake(_b, Math.min(0.5, n / 1200));
      }
    }
  }

  /** Area of a standing structure's solid cells just under a contact patch (axis-aligned normal) */
  bearing(s, list, n, cs) {
    const g = s.g, ax = Math.abs(n.x) > 0.5 ? 0 : Math.abs(n.y) > 0.5 ? 1 : 2;
    if (Math.abs(n.getComponent(ax)) < 0.99) return Infinity;
    const L = [g.xs, g.ys, g.zs], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const c of list) for (let k = 0; k < 3; k++) { const v = c.p.getComponent(k); lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); }
    const plane = (lo[ax] + hi[ax]) / 2 - n.getComponent(ax) * cs * 0.5;
    const r = [0, 0, 0], q = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      if (k === ax) { r[k] = q[k] = lineIndexClamped(L[k], plane); continue; }
      r[k] = lineIndexClamped(L[k], lo[k] - cs * 0.8); q[k] = lineIndexClamped(L[k], hi[k] + cs * 0.8);
    }
    let A = 0;
    for (let y = r[1]; y <= q[1]; y++) for (let z = r[2]; z <= q[2]; z++) for (let x = r[0]; x <= q[0]; x++) {
      if (g.mat[x + g.nx * (z + g.nz * y)] < SOLID) continue;
      A += ax === 0 ? g.dy(y) * g.dz(z) : ax === 1 ? g.dx(x) * g.dz(z) : g.dx(x) * g.dy(y);
    }
    return A;
  }

  /** Turn every cell of a standing structure inside a world box to rubble */
  crushBox(s, lo, hi) {
    const g = s.g;
    const x0 = lineIndexClamped(g.xs, lo[0]), x1 = lineIndexClamped(g.xs, hi[0]);
    const y0 = lineIndexClamped(g.ys, lo[1]), y1 = lineIndexClamped(g.ys, hi[1]);
    const z0 = lineIndexClamped(g.zs, lo[2]), z1 = lineIndexClamped(g.zs, hi[2]);
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = x + g.nx * (z + g.nz * y), m = g.mat[i];
      if (m < SOLID) continue;
      if (n++ % 4 === 0 && this.frame.chunks < 220) { this.frame.chunks++; this.chunkFrom(s, g.cx(x), g.cy(y), g.cz(z), rand(-1, 1), 0.3, rand(-1, 1), 5 * this.M, m, {}); }
      this.removeCell(s, i, false);
    }
    return n;
  }

  crushOther(imp, R, P, b) {
    const o = imp.other, p = imp.point;
    if (!o) return;
    if (o.vox) { if (!o.vox.dead) this.damageSphere(o.vox, p.x, p.y, p.z, R * this.M, P, { speed: 6 * this.M, chunks: 8 }); return; }
    if (o.isBody) { o.toLocal(p.x, p.y, p.z, _a); this.damageSphere(o.s, _a.x, _a.y, _a.z, R * this.M, P * 0.8, { chunks: 6 }); return; }
    if (o.ref && o.ref.kind === 'car') { this.city.damageCar(o.ref, 999, p); this.city.crushCar(o.ref); return; }
    if (o.owner) {
      const s = this.activate(o.owner);
      if (s) this.damageSphere(s, p.x, p.y, p.z, R * this.M, P, { speed: 6 * this.M, chunks: 8 });
    }
  }

  /**
   * Shatter a piece along jagged cracks: cells near the impact turn to rubble, the rest are
   * split among seeds clustered near the impact, so the far end may survive as one big piece.
   */
  fracture(b, imp, sp) {
    const s = b.s, g = s.g, { nx, ny, nz, nxz, mat, N } = g;
    this.stats.fractures++;
    const pl = b.toLocal(imp.point.x, imp.point.y, imp.point.z, new V3());
    const cells = [];
    for (let i = 0; i < N; i++) if (mat[i] >= SOLID) cells.push(i);
    if (!cells.length) return;
    const pos = (i, out) => { const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx; out.set(g.cx(x), g.cy(y), g.cz(z)); return out; };
    // Crush zone
    const rc = Math.min(4.5, Math.max(0.7, 0.11 * sp)) * this.M;
    this.damageSphere(s, pl.x, pl.y, pl.z, rc, 400, { speed: sp * this.M * 0.35, chunks: 30 });
    // Seeds
    const ext = Math.hypot(g.xs[g.nx] - g.xs[0], g.ys[g.ny] - g.ys[0], g.zs[g.nz] - g.zs[0]);
    const n = Math.max(2, Math.min(16, Math.round(2 + sp * 0.3 * Math.min(2.2, Math.cbrt(cells.length) / 10))));
    const seeds = [pl.clone()];
    const R0 = ext * 0.22;
    for (let tries = 0; seeds.length < n && tries < n * 30; tries++) {
      const p = pos(cells[Math.floor(Math.random() * cells.length)], new V3());
      const w = Math.pow(R0 / (p.distanceTo(pl) + R0), 1.4);
      if (seeds.length < n - 2 ? Math.random() < w : true) seeds.push(p);
    }
    // Nearest seed, with a wobble so cracks are ragged
    const lab = new Int8Array(N).fill(-1);
    const wob = s.cellSize * 1.4;
    for (const i of cells) {
      if (mat[i] < SOLID) continue;
      pos(i, _a);
      const nzv = Math.sin(_a.x * 0.9 + _a.y * 1.7) * Math.cos(_a.z * 1.3 - _a.x * 0.6);
      let best = Infinity, bi = 0;
      for (let k = 0; k < seeds.length; k++) {
        const d = _a.distanceTo(seeds[k]) + nzv * wob * (k % 2 ? 1 : -1);
        if (d < best) { best = d; bi = k; }
      }
      lab[i] = bi;
    }
    // Connected pieces of each label
    scratch(N);
    const st = nextStamp();
    const pieces = [];
    for (const i of cells) {
      if (mat[i] < SOLID || VIS[i] === st) continue;
      const L = lab[i], piece = [i];
      VIS[i] = st;
      for (let h = 0; h < piece.length; h++) {
        const c = piece[h], y = Math.floor(c / nxz), r = c - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
        for (const j of [x > 0 ? c - 1 : -1, x < nx - 1 ? c + 1 : -1, z > 0 ? c - nx : -1, z < nz - 1 ? c + nx : -1, y > 0 ? c - nxz : -1, y < ny - 1 ? c + nxz : -1]) {
          if (j >= 0 && mat[j] >= SOLID && VIS[j] !== st && lab[j] === L) { VIS[j] = st; piece.push(j); }
        }
      }
      pieces.push(piece);
    }
    pieces.sort((p, q) => q.length - p.length);
    const sound = this.sound, center = imp.point.clone();
    for (const piece of pieces) {
      const nb = this.detach(s, piece, { cause: 'fracture' });
      if (!nb) continue;
      nb.fractureCool = 0.9;
      // Spring apart from the impact a little, small pieces more
      _a.subVectors(nb.x, center).normalize();
      const k = Math.min(2.5, sp * 0.08) * this.M / Math.max(1, Math.cbrt(nb.cells / 200));
      nb.v.addScaledVector(_a, k * rand(0.3, 1));
      const sw = 0.25 / Math.max(1, Math.cbrt(nb.cells / 200));
      nb.w.x += rand(-1, 1) * sw; nb.w.y += rand(-1, 1) * sw; nb.w.z += rand(-1, 1) * sw;
    }
    this.checkDead(s);
    this.dustRing(center, this.M * (2 + Math.cbrt(cells.length) * 0.3), 1.4);
    sound.collapse(center, Math.min(3, Math.cbrt(cells.length) / 15));
  }

  // ---- per frame ---------------------------------------------------------------------

  update(dt, ctx = {}) {
    const T0 = performance.now(), act0 = this.stats.activateMs;
    this.time += dt;
    if (this.warm && (this.warm.t -= dt) <= 0) { this.scene.remove(this.warm.g); this.warm = null; }
    this.frame.chunks = 0; this.frame.dust = 0;
    // Physics in steps of at most 1/90 s
    const n = Math.min(4, Math.ceil(dt / (1 / 90)));
    for (let k = 0; k < n; k++) {
      this.physics.step(dt / n);
      this.impacts(dt / n);
      this.pressures(dt / n);
      for (const b of this.physics.bodies) if (b.crushDown) this.crushDown(b, dt / n);
    }
    const T1 = performance.now();
    // Structural checks
    for (const s of [...this.structs]) {
      s.analyzeT -= dt;
      if (s.pending.length && s.analyzeT <= 0 && !s.dead) { s.analyzeT = ANALYZE_EVERY; this.analyze(s); }
    }
    for (const b of [...this.physics.bodies]) {
      const s = b.s;
      s.analyzeT -= dt;
      if (s.pending.length && s.analyzeT <= 0 && !s.dead) { s.analyzeT = ANALYZE_EVERY * 2; this.analyze(s); }
    }
    // Pieces: draw where they are, dust off fast movers, sink in the river, crush what's under
    const W = this.city.L.water;
    for (const b of [...this.physics.bodies]) {
      const s = b.s;
      if (s.dead) continue;
      b.matrix(s.group.matrix);
      s.group.matrixWorldNeedsUpdate = true;
      if (b.x.y < W - 40 || b.age > 900) { this.killBody(b); continue; }
      if (b.x.y < W + 2 && !b.splashed && b.v.y < -2) { b.splashed = true; this.splash(b); }
      if (!b.sleeping) {
        const v = b.v.length();
        if (v > 3 * this.M && Math.random() < dt * Math.min(30, Math.cbrt(b.cells) * 1.5)) {
          // Dust and grit shaken off its broken faces as it falls
          const P = b.probes, i = Math.floor(Math.random() * (P.length / 3));
          b.toWorld(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], _a);
          const gy = rand(0.4, 0.55);
          this.fx.smoke.emit(_a.x, _a.y, _a.z, b.v.x * 0.3, b.v.y * 0.3, b.v.z * 0.3, rand(2, 4), this.M * 1.5, this.M * 7, gy, gy, gy * 0.92, 0.5, gy, gy, gy, 0, 1.5, 0.3);
        }
        if (v > 2 * this.M) this.crushUnder(b, ctx);
      }
    }
    const T2 = performance.now();
    this.debris.update(dt);
    this.render(dt);
    const T3 = performance.now();
    // Slow frames, for tuning
    if (T3 - T0 > 30) {
      this.slow = this.slow || [];
      this.slow.push({ t: +this.time.toFixed(1), ms: +(T3 - T0).toFixed(1), phys: +(T1 - T0).toFixed(1), checks: +(T2 - T1).toFixed(1), draw: +(T3 - T2).toFixed(1), act: +(this.stats.activateMs - act0).toFixed(1), bodies: this.physics.bodies.length });
      if (this.slow.length > 40) this.slow.shift();
    }
  }

  /** A moving piece flattens props, spiders and the mech in its way */
  crushUnder(b, ctx) {
    b.crushT = (b.crushT || 0) - 1;
    if (b.crushT > 0) return;
    b.crushT = 6;
    // Lamp posts, trees and the like
    this.ownersIn(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, (o) => {
      if (!o.small || o.dead) return;
      const B = o.box, cx = (B[0] + B[3]) / 2, cy = (B[1] + B[4]) / 2, cz = (B[2] + B[5]) / 2;
      b.toLocal(cx, cy, cz, _a);
      const k = b.s.g.cellAt(_a.x, _a.y, _a.z);
      if (k < 0 || b.s.g.mat[k] < SOLID) return;
      const s = this.activate(o);
      if (s) this.damageSphere(s, cx, cy, cz, Math.max(B[3] - B[0], B[4] - B[1], B[5] - B[2]) * 0.6, 300, { chunks: 6 });
    });
    const speed = b.v.length();
    const inside = (p) => {
      if (p.x < b.min.x || p.x > b.max.x || p.y < b.min.y || p.y > b.max.y || p.z < b.min.z || p.z > b.max.z) return false;
      b.toLocal(p.x, p.y, p.z, _b);
      const g = b.s.g, k = g.cellAt(_b.x, _b.y, _b.z);
      return k >= 0 && g.mat[k] >= SOLID;
    };
    if (this.spiders) for (const sp of this.spiders.list) if (sp.alive && inside(sp.pos)) this.spiders.damage(sp, 9999, sp.pos);
    const P = this.player;
    if (P && P.alive && this.onPlayerHit && speed > 3 * this.M) {
      for (const h of [1.5, 4.5]) {
        if (inside(_c.set(P.pos.x, P.pos.y + h, P.pos.z))) {
          this.onPlayerHit(Math.min(140, 10 + speed * Math.cbrt(b.cells) * 0.25), b.x.clone(), 'crush');
          break;
        }
      }
    }
  }

  splash(b) {
    const p = b.x, W = this.city.L.water, k = Math.min(3, Math.cbrt(b.cells) / 8);
    for (let i = 0; i < 30 * k; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(2, 8) * k;
      this.fx.smoke.emit(p.x + Math.cos(a) * k * 2, W + 0.3, p.z + Math.sin(a) * k * 2, Math.cos(a) * sp, rand(6, 16) * k, Math.sin(a) * sp,
        rand(1.5, 3), this.M * 2 * k, this.M * 6 * k, 0.85, 0.9, 0.95, 0.7, 0.8, 0.85, 0.9, 0, 0.6, -this.G);
    }
    this.sound.crash(p, k);
  }

  /** Masks to the GPU, broken faces meshed within the frame's budget */
  render() {
    const t0 = performance.now();
    const all = this.structs.concat(this.physics.bodies.map((b) => b.s));
    for (const s of all) {
      if (s.maskBox && !s.dead) { uploadMask(this.renderer, s.mask, s.maskBox); s.maskBox = null; }
    }
    for (const s of all) {
      if (!s.dirty.size || s.dead) continue;
      let changed = false;
      for (const key of s.dirty) {
        if (performance.now() - t0 > MESH_BUDGET_MS && changed) break;
        s.dirty.delete(key);
        const cx = key % 1024, t = (key - cx) / 1024, cz = t % 1024, cy = (t - cz) / 1024;
        const g = s.g;
        const d = meshChunk(g, cx * CHUNK, cy * CHUNK, cz * CHUNK, Math.min(g.nx, cx * CHUNK + CHUNK), Math.min(g.ny, cy * CHUNK + CHUNK), Math.min(g.nz, cz * CHUNK + CHUNK), this.M);
        s.chunks.set(key, d.n ? d : null);
        changed = true;
      }
      if (changed) this.rebuildFaces(s);
      if (performance.now() - t0 > MESH_BUDGET_MS * 1.5) break;
    }
  }

  /** One geometry for all of a structure's meshed chunks */
  rebuildFaces(s) {
    let nv = 0, ni = 0;
    for (const d of s.chunks.values()) if (d) { nv += d.n; ni += d.idx.length; }
    if (!nv) {
      if (s.faceMesh) { s.group.remove(s.faceMesh); s.faceMesh.geometry.dispose(); s.faceMesh = null; }
      return;
    }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), cell = new Float32Array(nv * 4), col = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let v = 0, k = 0;
    for (const d of s.chunks.values()) {
      if (!d) continue;
      pos.set(d.pos, v * 3); nor.set(d.nor, v * 3); uv.set(d.uv, v * 2); cell.set(d.cell, v * 4); col.set(d.col, v * 3);
      for (let i = 0; i < d.idx.length; i++) idx[k++] = d.idx[i] + v;
      v += d.n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aCell', new THREE.BufferAttribute(cell, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    if (!s.faceMesh) {
      s.faceMesh = new THREE.Mesh(geo, this.faceMat);
      s.faceMesh.castShadow = s.faceMesh.receiveShadow = true;
      s.faceMesh.matrixAutoUpdate = false;
      s.group.add(s.faceMesh);
    } else {
      s.faceMesh.geometry.dispose();
      s.faceMesh.geometry = geo;
    }
  }

  /** Counts for the debug hook */
  info() {
    return {
      ...this.stats, structs: this.structs.length, bodies: this.physics.bodies.length,
      awake: this.physics.bodies.filter((b) => !b.sleeping).length, contacts: this.physics.contacts.length, debris: this.debris.n,
    };
  }
}

const UP = new V3(0, 1, 0), DOWN = new V3(0, -1, 0);
const _hit = {};

/** Entry distance of a ray into a box, or null */
function rayAabb(o, d, mn, mx, max) {
  let t0 = 0, t1 = max;
  for (const a of ['x', 'y', 'z']) {
    const da = d[a], oa = o[a];
    if (Math.abs(da) < 1e-12) { if (oa < mn[a] || oa > mx[a]) return null; continue; }
    let ta = (mn[a] - oa) / da, tb = (mx[a] - oa) / da;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return t0;
}

