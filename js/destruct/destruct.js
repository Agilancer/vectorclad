import * as THREE from '../three.js';
import { OUT, AIR, GONE, SOLID, STEEL, MATS, lineIndexClamped } from './grid.js';
import { voxelizeOwner, volBox } from './voxelize.js';
import { CHUNK, meshChunk } from './mesher.js';
import { faceMaterial } from './textures.js';
import { houseStyle, floorTable, makePower, outage, flicker, cutPower, ceilingUniforms, setCeilingScale, CEIL_SHARED } from './ceilings.js';
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
// structure is checked four ways:
//
//   - islands: cells no longer connected to the ground break away;
//   - sections: at each damaged level, what is left to carry the load above is
//     analysed as an elastic section, the load's offset bending it. Crushed
//     evenly, the floors above drop a storey; squeezed on one side and cracked
//     open on the other, or with the load past its edge, it tips over toward
//     the damage, pivoting on a hinge (blow a notch into a tower's base and it
//     falls that way like a felled tree);
//   - chunks: parts of the plan left too far from anything carrying load down
//     through the level break away with what stands over them (a blown-out
//     corner, facade over a wide breach), arching over the gap;
//   - spans: floors, lintels and overhangs carried too far from a support
//     that still reaches the ground give way and fall in slabs.
//
// What breaks away becomes a rigid body (physics.js) that topples, slides,
// wedges itself between buildings and crushes what it lands on, carving the
// structures it hits by the energy it brings, which may fail in turn. It gets
// no support from the walls it was flush against. Hard landings shatter bodies
// into pieces along jagged Voronoi cracks, with rubble (debris.js) and dust,
// and what a collapse leaves standing free and unbraced topples after it.
//
// Ceilings and their lights are drawn by the faces shader (ceilings.js); here
// the lights' power: big hits flicker a building and knock out the fixtures
// round them with a crackle of sparks, a level giving way browns out what
// stands, and every piece that breaks away loses its supply and goes dark.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const SAFETY = 3.4;            // intact buildings carry this many times their own weight at their weakest level
const TENSION = 0.15;          // what a section can take in tension (rebar, mortar), against what it takes squeezed
const CRUSH_J = 2.5e6;         // energy it takes to crush a cubic meter of building (J), for impacts
const ANALYZE_EVERY = 0.07;    // seconds between structural checks of one structure
const ISLAND_BUDGET = 60000;   // cells one island search may visit before calling for a full pass
const ISLAND_ORDER = [5, 0, 1, 2, 3, 4]; // face neighbours pushed up first, so the search goes down first
const MESH_BUDGET_MS = 5;      // chunk meshing per frame
let MAX_BODIES = 70;
const rand = (a, b) => a + Math.random() * (b - a);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _m4 = new THREE.Matrix4();

// Shared scratch arrays, grown as needed
let VIS = new Uint32Array(1 << 16), QUEUE = new Int32Array(1 << 16), STAMP = 1;
let LOADM = new Float64Array(4096), NEAR = new Int32Array(4096);                    // per plan column, levelLoads
let CHA = new Float32Array(4096), CHB = new Float32Array(4096), CHR = new Int32Array(4096); // chunks
let ND = new Uint8Array(1 << 16), SPQ = new Int32Array(1), SPD = new Uint8Array(1), SPS = new Int32Array(1), SPF = new Int32Array(1); // spans
const SPC = new Int32Array(256);
const NB = new Int32Array(6);
/** The six face neighbours of cell i at (x, y, z) into NB, -1 off the grid */
function faces(i, x, y, z, nx, ny, nz, nxz) {
  NB[0] = x > 0 ? i - 1 : -1; NB[1] = x < nx - 1 ? i + 1 : -1;
  NB[2] = z > 0 ? i - nx : -1; NB[3] = z < nz - 1 ? i + nx : -1;
  NB[4] = y > 0 ? i - nxz : -1; NB[5] = y < ny - 1 ? i + nxz : -1;
}
/** Distance (in cells) from every plan cell to the nearest zero, two raster passes */
function chamfer(D, nx, nz) {
  const d2 = Math.SQRT2;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = x + nx * z;
    let v = D[i];
    if (v === 0) continue;
    if (x > 0 && D[i - 1] + 1 < v) v = D[i - 1] + 1;
    if (z > 0) {
      if (D[i - nx] + 1 < v) v = D[i - nx] + 1;
      if (x > 0 && D[i - nx - 1] + d2 < v) v = D[i - nx - 1] + d2;
      if (x < nx - 1 && D[i - nx + 1] + d2 < v) v = D[i - nx + 1] + d2;
    }
    D[i] = v;
  }
  for (let z = nz - 1; z >= 0; z--) for (let x = nx - 1; x >= 0; x--) {
    const i = x + nx * z;
    let v = D[i];
    if (v === 0) continue;
    if (x < nx - 1 && D[i + 1] + 1 < v) v = D[i + 1] + 1;
    if (z < nz - 1) {
      if (D[i + nx] + 1 < v) v = D[i + nx] + 1;
      if (x < nx - 1 && D[i + nx + 1] + d2 < v) v = D[i + nx + 1] + d2;
      if (x > 0 && D[i + nx - 1] + d2 < v) v = D[i + nx - 1] + d2;
    }
    D[i] = v;
  }
}
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
  constructor(D, g, owner, lut, off, cut = null) {
    this.id = SID++;
    this.D = D;
    this.g = g;
    this.owner = owner;
    this.lut = lut;
    this.off = off;
    this.body = null;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.mask = makeMask(g, cut);
    this.floors = null;          // ceiling layouts by layer, the power, the faces' material: see lightUp
    this.power = null;
    this.faceMat = null;
    this.jolt = 0;               // cells destroyed this frame, for the lights (jolts)
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
    setCeilingScale(M);
    const env = { gravity: this.G, ground: (x, z) => this.ground(x, z), statics: (mn, mx, fn) => this.statics(mn, mx, fn) };
    this.physics = new Physics(env);
    this.debris = new Debris(scene, { gravity: this.G, ground: env.ground, solid: (x, y, z) => this.solidAt(x, y, z) }, mobile ? 900 : 2400);
    this.warmup();
    this.spiders = null;
    this.player = null;
    this.onPlayerHit = null;
    this.frame = { chunks: 0, dust: 0, act: 0, big: 0 };
    this.actBudget = mobile ? 7 : 12; // ms of activations one frame may take before the rest wait a frame
    this.later = [];                  // blasts still to carve into structures not yet activated
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
    for (const [k, n] of [['position', 3], ['normal', 3], ['uv', 2], ['aCell', 4], ['color', 3], ['aInfo', 3]]) fg.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n * 3), n));
    const floors = new THREE.DataTexture(new Float32Array(16), 1, 4, THREE.RGBAFormat, THREE.FloatType);
    floors.needsUpdate = true;
    const fm = new THREE.Mesh(fg, faceMaterial(ceilingUniforms({ U, power: makePower(), floors, origin: new THREE.Vector2() })));
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
    // Outer walls are built a little tougher than the rest: a quarter more hit points for every
    // cell facing the outside
    const { nx, ny, nz, nxz } = g;
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const i = x + nx * (z + nz * y);
      if (gm[i] < SOLID) continue;
      if ((x > 0 && gm[i - 1] === OUT) || (x < nx - 1 && gm[i + 1] === OUT) || (z > 0 && gm[i - nx] === OUT) || (z < nz - 1 && gm[i + nx] === OUT)
        || x === 0 || z === 0 || x === nx - 1 || z === nz - 1) hp[i] = Math.min(255, Math.round(hp[i] * 1.25));
    }
    s.skin = extractSkin(owner, g);
    this.buildSkin(s);
    this.lightUp(s, null);
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
    const ms = performance.now() - t0;
    this.stats.activateMs += ms;
    this.frame.act += ms;
    return s;
  }

  /**
   * A structure's ceilings and their power. A building gets its theme and floor layouts; a piece
   * breaking away (from parent p) takes its parent's, and its supply is cut.
   */
  lightUp(s, p) {
    if (p) {
      s.floors = p.floors; s.origin = p.origin;
      s.power = makePower(p.power);
      cutPower(s.power, this.time);
    } else {
      s.floors = floorTable(s.g, houseStyle(s.owner));
      s.origin = new THREE.Vector2(s.owner.box ? s.owner.box[0] : s.g.xs[0], s.owner.box ? s.owner.box[2] : s.g.zs[0]);
      s.power = makePower();
    }
    s.faceMat = faceMaterial(ceilingUniforms(s));
  }

  /**
   * What this frame's damage did to a structure's lights: the whole of it flickers, harder the
   * more was destroyed; a big hit knocks out the fixtures round it, with sparks from the ceiling
   */
  jolts() {
    const all = this.structs.concat(this.physics.bodies.map((b) => b.s));
    for (const s of all) {
      const cut = s.power.U.uPow.value.x;
      // (a piece whose lights are long dead has nothing left to short)
      if (!s.jolt || s.dead || (cut >= 0 && this.time - cut > 2)) { s.jolt = 0; continue; }
      const n = s.jolt, J = s.joltAt, M = this.M;
      s.jolt = 0;
      if (n < 18) continue;
      flicker(s.power, this.time, Math.min(1, n / 160));
      if (n < 40) continue;
      _a.set(J[0] / J[3], J[1] / J[3], J[2] / J[3]);
      const r = Math.min(18 * M, Math.max(J[4] * 1.7, (2.5 + Math.sqrt(n) * 0.45) * M));
      if (outage(s.power, _a, r, this.time)) this.sparkle(s, _a, r, Math.min(4, 1 + n / 120));
    }
  }

  /** Cells destroyed at local (x, y, z) by something of radius r: counted toward this frame's jolt */
  jolted(s, x, y, z, n, r) {
    if (!s.jolt) s.joltAt = [0, 0, 0, 0, 0];
    const J = s.joltAt;
    s.jolt += n;
    J[0] += x * n; J[1] += y * n; J[2] += z * n; J[3] += n; J[4] = Math.max(J[4], r);
  }

  /** Shorted fixtures: sparks raining from the ceiling over a few spots within r of local p */
  sparkle(s, p, r, k) {
    const g = s.g, { nxz, mat } = g;
    for (let t = 0; t < Math.round(k * 1.5); t++) {
      const a = Math.random() * Math.PI * 2, d = r * Math.sqrt(Math.random()) * 0.8;
      let i = g.cellAt(p.x + Math.cos(a) * d, p.y, p.z + Math.sin(a) * d);
      if (i < 0) continue;
      // Up through the room to its ceiling
      let n = 0;
      while (i < g.N && mat[i] === AIR && n++ < 16) i += nxz;
      if (i >= g.N || mat[i] < SOLID || n === 0) continue;
      const y = (i / nxz) | 0;
      this.toWorld(s, p.x + Math.cos(a) * d, g.ys[y] - 0.05 * this.M, p.z + Math.sin(a) * d, _b);
      this.fx.sparksBurst(_b, DOWN, 8 + Math.round(k * 4), 0xbfe2ff, 12);
      if (t === 0) { this.fx.light(_b, 0x9fd4ff, 22, 0.12, 22); this.sound.zap(_b); }
    }
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
    // A fingerprint of each level's section, so runs of identical levels are weighed once
    const hash = new Float64Array(ny + 1);
    for (let y = 1; y < ny; y++) {
      let n = 0, h = 0;
      const a = y * nxz, b = a - nxz;
      for (let c = 0; c < nxz; c++) if (mat[a + c] >= SOLID && mat[b + c] >= SOLID) { n++; h += (c * 2654435761) % 1000003; }
      s.pairs[y] = n; hash[y] = h;
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
    s.totalMass = layerMass.reduce((t, v) => t + v, 0);
    s.dist = null; // support distances: worked out at the first structural check (supportDist)
    // Strength: the most stressed piece of the most stressed intact level, load and bending
    // both, carries SAFETY times what it does (and still twice that once it cracks)
    // Levels whose section differs from the last one weighed (the same section higher up carries
    // less); a tapering shaft is sampled every ten levels or so, and every 24 at least
    const levels = [];
    for (let y = s.anchor, last = -99; y < ny; y++) {
      if (!s.pairs[y]) continue;
      const same = s.pairs[y] === s.pairs[y - 1] && hash[y] === hash[y - 1];
      const near = last >= 0 && Math.abs(s.pairs[y] - s.pairs[last]) <= 0.03 * s.pairs[last];
      if (y - last < 24 && (same || (near && y - last < 10))) continue;
      const L = this.levelLoads(s, y);
      if (L) levels.push(L.comps);
      last = y;
    }
    let worst = 0;
    for (const comps of levels) for (const C of comps) if (C.M > 0) worst = Math.max(worst, sectionStress(g, C, Infinity, _st).smax);
    s.sigma = Math.max(1e-6, worst * SAFETY);
    let cracked = 0;
    for (const comps of levels) for (const C of comps) if (C.M > 0) cracked = Math.max(cracked, sectionStress(g, C, TENSION * s.sigma, _st).smax);
    if (isFinite(cracked)) s.sigma = Math.max(s.sigma, cracked * 2);
  }

  /** Steps from each cell to one standing on an unbroken solid column down to the ground */
  supportDist(s) {
    const g = s.g, { nx, ny, nz, nxz, mat } = g;
    const dist = (s.dist = new Uint8Array(g.N).fill(255));
    scratch(g.N);
    let qh = 0, qt = 0;
    for (let c = 0; c < nxz; c++) {
      for (let i = c; i < g.N; i += nxz) {
        if (mat[i] < SOLID) break;
        dist[i] = 0;
        QUEUE[qt++] = i;
      }
    }
    while (qh < qt) {
      const i = QUEUE[qh++], d = dist[i] + 1;
      if (d >= 255) continue;
      const y = (i / nxz) | 0, r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
      if (x > 0 && dist[i - 1] > d && mat[i - 1] >= SOLID) { dist[i - 1] = d; QUEUE[qt++] = i - 1; }
      if (x < nx - 1 && dist[i + 1] > d && mat[i + 1] >= SOLID) { dist[i + 1] = d; QUEUE[qt++] = i + 1; }
      if (z > 0 && dist[i - nx] > d && mat[i - nx] >= SOLID) { dist[i - nx] = d; QUEUE[qt++] = i - nx; }
      if (z < nz - 1 && dist[i + nx] > d && mat[i + nx] >= SOLID) { dist[i + nx] = d; QUEUE[qt++] = i + nx; }
      if (y > 0 && dist[i - nxz] > d && mat[i - nxz] >= SOLID) { dist[i - nxz] = d; QUEUE[qt++] = i - nxz; }
      if (y < ny - 1 && dist[i + nxz] > d && mat[i + nxz] >= SOLID) { dist[i + nxz] = d; QUEUE[qt++] = i + nxz; }
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
    const { nx, ny, nz, nxz } = g;
    const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
    // Skin backed by a room or the outside next to it (a slanted face, a thin rail) goes once
    // nothing solid is left around that cell either
    const gm = g.mat;
    faces(i, x, y, z, nx, ny, nz, nxz);
    for (let k = 0; k < 6; k++) {
      const j = NB[k];
      if (j < 0 || gm[j] >= GONE || !md[j * 2]) continue;
      // j's own coordinates: one step from (x, y, z)
      const jx = x + (k === 0 ? -1 : k === 1 ? 1 : 0), jz = z + (k === 2 ? -1 : k === 3 ? 1 : 0), jy = y + (k === 4 ? -1 : k === 5 ? 1 : 0);
      if ((jx > 0 && gm[j - 1] >= SOLID) || (jx < nx - 1 && gm[j + 1] >= SOLID) || (jz > 0 && gm[j - nx] >= SOLID) || (jz < nz - 1 && gm[j + nx] >= SOLID) || (jy > 0 && gm[j - nxz] >= SOLID) || (jy < ny - 1 && gm[j + nxz] >= SOLID)) continue;
      md[j * 2] = 0;
    }
    if (!s.body) {
      if (y > 0 && g.mat[i - nxz] >= SOLID) s.pairs[y]--;
      if (y + 1 < g.ny && g.mat[i + nxz] >= SOLID) s.pairs[y + 1]--;
      const mm = MATS[m].density * g.vol(x, y, z);
      for (let ly = 0; ly * 4 <= y; ly++) s.colAbove[ly * nxz + r] -= mm;
      if (s.dist) s.dist[i] = 255;
    }
    const B = s.maskBox || (s.maskBox = [x, y, z, x + 1, y + 1, z + 1]);
    const xa = Math.max(0, x - 1), ya = Math.max(0, y - 1), za = Math.max(0, z - 1), xb = Math.min(nx, x + 2), yb = Math.min(ny, y + 2), zb = Math.min(nz, z + 2);
    if (xa < B[0]) B[0] = xa; if (ya < B[1]) B[1] = ya; if (za < B[2]) B[2] = za;
    if (xb > B[3]) B[3] = xb; if (yb > B[4]) B[4] = yb; if (zb > B[5]) B[5] = zb;
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
    let removed = 0, spawned = 0, sx = 0, sy = 0, sz = 0, glass = 0, steel = 0, other = 0, lastMat = 0;
    const want = o.chunks ?? 10;
    for (let y = y0; y <= y1; y++) {
      const dy = g.cy(y) - cy;
      for (let z = z0; z <= z1; z++) {
        const dz = g.cz(z) - cz;
        if (dy * dy + dz * dz > r2) continue;
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
          // The big chunks are of what the wall and slab are built of: glass only if there was nothing else
          if (name !== 'light' && name !== 'leaf' && (name !== 'glass' || !lastMat)) lastMat = m;
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
      this.jolted(s, sx / removed, sy / removed, sz / removed, removed, r);
      const p = this.toWorld(s, sx / removed, sy / removed, sz / removed, _a);
      this.burstFx(p, removed, glass, steel, other, o);
      // Explosions tear big chunks of wall and slab and twisted steel off with them, as many as
      // the volume they blew away
      if (o.big && lastMat) this.bigChunks(s, p, cx, cy, cz, removed, lastMat, steel, o);
      if (this.onCarve && !s.body) this.onCarve(s, cx, cy, cz, r, removed);
    }
    if (s.body) { s.body.wake(); } else if (removed) this.wakeNear(s, cx, cy, cz, r);
    return removed;
  }

  /**
   * Big debris: slabs of wall and floor a meter or more across and lengths of bent steel, thrown hard
   * out of a blast crater at p (world) from the blast's middle (local cx, cy, cz). One for about
   * every twelve cubic meters blown away.
   */
  bigChunks(s, p, cx, cy, cz, removed, mat, steel, o) {
    const M = this.M, cs = s.cellSize, vol = removed * (cs / M) ** 3;
    const n = Math.min(Math.max(0, 40 - this.frame.big), Math.round(vol / 12 + Math.random()));
    this.frame.big += n;
    const c = this.toWorld(s, cx, cy, cz, _c);
    for (let k = 0; k < n; k++) {
      // Out from the blast through the crater, fast
      _b.set(p.x - c.x + rand(-1, 1) * cs * 3, p.y - c.y + rand(-0.5, 1.5) * cs * 3, p.z - c.z + rand(-1, 1) * cs * 3);
      if (_b.lengthSq() < 1e-6) _b.set(rand(-1, 1), 0.5, rand(-1, 1));
      _b.normalize();
      const sp = (12 + Math.random() * 18) * M * (o.speedK || 1);
      const m = steel && Math.random() < steel / removed + 0.1 ? 8 : mat;
      this.debris.spawn(p.x + rand(-1, 1) * cs, p.y + rand(-1, 1) * cs, p.z + rand(-1, 1) * cs,
        _b.x * sp, _b.y * sp + rand(2, 8) * M, _b.z * sp, M * rand(1.1, 2.8), m, rand(25, 45));
    }
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
    const opts = Object.assign({ speed: 10 + power * 0.04, chunks: Math.round(8 + radiusM * 6), big: true }, o);
    // What it reaches is turned into voxels, nearest first; past the frame's budget the rest are
    // carved a frame or two later
    const reach = [];
    this.ownersIn(p.x - R, p.y - R, p.z - R, p.x + R, p.y + R, p.z + R, (ow) => {
      if (ow.struct || ow.dead) return;
      const B = ow.box;
      const dx = Math.max(B[0] - p.x, 0, p.x - B[3]), dy = Math.max(B[1] - p.y, 0, p.y - B[4]), dz = Math.max(B[2] - p.z, 0, p.z - B[5]);
      // (only where the blast still breaks concrete: grazing a tower isn't worth turning it into voxels)
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < R * R * 0.45) reach.push([d2, ow]);
    });
    reach.sort((a, b) => a[0] - b[0]);
    for (const [, ow] of reach) {
      if (this.frame.act === 0 || this.frame.act < this.actBudget) this.activate(ow);
      else this.later.push({ ow, p: p.clone(), R, power, opts });
    }
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
      const y = (i / nxz) | 0, r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
      faces(i, x, y, z, nx, ny, nz, nxz);
      for (let k = 0; k < 6; k++) { const j = NB[k]; if (j >= 0 && mat[j] >= SOLID && VIS[j] !== st0) { VIS[j] = st0; seeds.push(j); } }
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
        const y = (i / nxz) | 0;
        if (y < s.anchor) { found = true; break; }
        const r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
        // Pushed last, popped first: down
        faces(i, x, y, z, nx, ny, nz, nxz);
        let hitGround = false;
        for (let q = 0; q < 6; q++) {
          const j = NB[ISLAND_ORDER[q]];
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
    while (qh < qt) {
      const i = QUEUE[qh++], y = (i / nxz) | 0, r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
      faces(i, x, y, z, nx, ny, nz, nxz);
      for (let k = 0; k < 6; k++) { const j = NB[k]; if (j >= 0 && mat[j] >= SOLID && VIS[j] !== st) { VIS[j] = st; QUEUE[qt++] = j; } }
    }
    // Label what was not reached
    for (let i = 0; i < N; i++) {
      if (mat[i] < SOLID || VIS[i] === st) continue;
      const ls = nextStamp();
      const cells = [i];
      VIS[i] = ls;
      for (let h = 0; h < cells.length; h++) {
        const c = cells[h], y = (c / nxz) | 0, r = c - y * nxz, z = (r / nx) | 0, x = r - z * nx;
        faces(c, x, y, z, nx, ny, nz, nxz);
        for (let k = 0; k < 6; k++) { const j = NB[k]; if (j >= 0 && mat[j] >= SOLID && VIS[j] !== ls && VIS[j] !== st) { VIS[j] = ls; cells.push(j); } }
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
   * Each separate piece of the section (two towers on a podium) is weighed against the load
   * handed to it, with the bending the load's offset puts into it (sectionStress). Overloaded,
   * it gives: crushed evenly it pancakes a storey; squeezed on one side, cracked open on the
   * other, or with the load past its edge, it tips over that side. If it holds as a whole,
   * parts of the plan left too far from anything still standing under them may still break
   * off on their own (chunks).
   */
  checkLevel(s, y) {
    const L = this.levelLoads(s, y);
    if (!L) return;
    const wy = s.g.ys[y];
    for (let id = 0; id < L.comps.length; id++) {
      const C = L.comps[id];
      if (C.M <= 0 || !C.cells.length) continue;
      const r = sectionStress(s.g, C, TENSION * s.sigma, _st);
      const u = r.smax / s.sigma;
      if (u >= 1 || r.beyond) {
        const tip = r.e > 1e-6 && (r.beyond || r.cracked || r.smin0 < 0.3 * r.smax0);
        this.fail(s, y, L.near, id, tip ? 'tip' : 'crush', { ax: r.ax, az: r.az, lx: r.lx, lz: r.lz, fx: r.fx, fz: r.fz, front: r.front, depth: r.depth, beyond: r.beyond, wy, M: C.M });
        return;
      }
      if (u > 0.6 && this.time > s.warnT) this.warn(s, r.ax, wy, r.az, C, u);
    }
    this.chunks(s, y, L);
  }

  /**
   * The section at level y and the load on it: the section's cells (both layers solid) fall
   * into pieces of plan more than about 8 m apart (twin towers, the bents of the El; closer
   * ones work together), and every column of the plan hands the weight above it to the nearest
   * piece. Returns { comps: [{ cells, M, mx, mz }], near } or null; leaves each column's load in
   * LOADM for chunks().
   */
  levelLoads(s, y) {
    const g = s.g, { nx, nz, ny, nxz, mat } = g;
    scratch(nxz * 2);
    if (LOADM.length < nxz) { LOADM = new Float64Array(nxz * 2); NEAR = new Int32Array(nxz * 2); }
    const comps = [];
    const a = y * nxz, b = a - nxz;
    // Label a coarse grid of ~4 m squares, grown by one square, so gaps under 8 m close up
    const k = Math.max(1, Math.round((4 * this.M) / s.cellSize)), cx = Math.ceil(nx / k), cz = Math.ceil(nz / k);
    const on = new Uint8Array(cx * cz), grown = new Int32Array(cx * cz).fill(-2);
    let any = false;
    for (let c = 0; c < nxz; c++) if (mat[a + c] >= SOLID && mat[b + c] >= SOLID) { const x = c % nx; on[Math.floor(x / k) + cx * Math.floor((c - x) / nx / k)] = 1; any = true; }
    if (!any) return null;
    for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) {
      let hit = 0;
      for (let dj = -1; dj <= 1 && !hit; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < cx && jj < cz && on[ii + cx * jj]) { hit = 1; break; }
      }
      if (hit) grown[i + cx * j] = -1;
    }
    for (let q = 0; q < cx * cz; q++) {
      if (grown[q] !== -1) continue;
      const id = comps.length, list = [q];
      grown[q] = id;
      for (let h = 0; h < list.length; h++) {
        const p = list[h], i = p % cx, j = (p - i) / cx;
        if (i > 0 && grown[p - 1] === -1) { grown[p - 1] = id; list.push(p - 1); }
        if (i < cx - 1 && grown[p + 1] === -1) { grown[p + 1] = id; list.push(p + 1); }
        if (j > 0 && grown[p - cx] === -1) { grown[p - cx] = id; list.push(p - cx); }
        if (j < cz - 1 && grown[p + cx] === -1) { grown[p + cx] = id; list.push(p + cx); }
      }
      comps.push({ cells: [], M: 0, mx: 0, mz: 0 });
    }
    // Nearest section piece for every column
    const near = NEAR;
    near.fill(-1, 0, nxz);
    let qh = 0, qt = 0;
    for (let c = 0; c < nxz; c++) {
      if (mat[a + c] < SOLID || mat[b + c] < SOLID) continue;
      const x = c % nx, id = grown[Math.floor(x / k) + cx * Math.floor((c - x) / nx / k)];
      comps[id].cells.push(c);
      near[c] = id; QUEUE[qt++] = c;
    }
    while (qh < qt) {
      const c = QUEUE[qh++], x = c % nx, z = (c - x) / nx, id = near[c];
      if (x > 0 && near[c - 1] < 0) { near[c - 1] = id; QUEUE[qt++] = c - 1; }
      if (x < nx - 1 && near[c + 1] < 0) { near[c + 1] = id; QUEUE[qt++] = c + 1; }
      if (z > 0 && near[c - nx] < 0) { near[c - nx] = id; QUEUE[qt++] = c - nx; }
      if (z < nz - 1 && near[c + nx] < 0) { near[c + nx] = id; QUEUE[qt++] = c + nx; }
    }
    // Weight above y in each column
    const ly = Math.ceil(y / 4), yEnd = Math.min(ly * 4, ny);
    for (let c = 0; c < nxz; c++) {
      let m = ly < s.nly && ly * 4 < ny ? s.colAbove[ly * nxz + c] : 0;
      const x = c % nx, z = (c - x) / nx;
      for (let yy = y; yy < yEnd; yy++) { const i = c + nxz * yy; if (mat[i] >= SOLID) m += MATS[mat[i]].density * g.vol(x, yy, z); }
      LOADM[c] = m;
      if (m <= 0) continue;
      const C = comps[near[c]];
      C.M += m; C.mx += m * g.cx(x); C.mz += m * g.cz(z);
    }
    return { comps, near };
  }

  /**
   * Parts of the plan at level y the damage has left too far from anything still carrying load
   * down through the level, farther than the floors and walls above can reach out to them (less
   * far the more they carry), break away with what stands over them: a corner whose walls and
   * column were blown out, a run of facade over a wide breach. What spans over the gap arches:
   * the piece that drops narrows going up, and what is left above may give way next in turn.
   * Only local failures: a region more than a quarter of the loaded plan is the whole level's
   * business (checkLevel), a top cantilevered off what is left acts as one. Returns true if
   * anything broke away.
   */
  chunks(s, y, L) {
    const g = s.g, { nx, nz, ny, nxz, mat } = g, a = y * nxz, b = a - nxz;
    const cs = s.cellSize, M = this.M;
    if (CHA.length < nxz) { CHA = new Float32Array(nxz * 2); CHB = new Float32Array(nxz * 2); CHR = new Int32Array(nxz * 2); }
    // Plan distance (in cells) to what carries load across the level now, and before any damage
    const now = CHA, was = CHB;
    for (let c = 0; c < nxz; c++) {
      now[c] = mat[a + c] >= SOLID && mat[b + c] >= SOLID ? 0 : 1e9;
      was[c] = (mat[a + c] >= SOLID || mat[a + c] === GONE) && (mat[b + c] >= SOLID || mat[b + c] === GONE) ? 0 : 1e9;
    }
    chamfer(now, nx, nz); chamfer(was, nx, nz);
    // Columns cut off: farther than they can be reached, and well farther than they were
    const reg = CHR;
    let found = false, loaded = 0;
    for (let c = 0; c < nxz; c++) {
      reg[c] = -1;
      const m = LOADM[c];
      if (m > 0) loaded++;
      if (m <= 0 || now[c] < 2 || now[c] < was[c] + 1.5) continue;
      if (now[c] * cs > this.reachOut(s, y, c, m)) { reg[c] = -2; found = true; }
    }
    if (!found) return false;
    // Connected regions of them, a few cells or more
    let broke = false;
    for (let c0 = 0; c0 < nxz; c0++) {
      if (reg[c0] !== -2) continue;
      const cols = [c0];
      reg[c0] = c0;
      for (let h = 0; h < cols.length; h++) {
        const c = cols[h], x = c % nx, z = (c - x) / nx;
        if (x > 0 && reg[c - 1] === -2) { reg[c - 1] = c0; cols.push(c - 1); }
        if (x < nx - 1 && reg[c + 1] === -2) { reg[c + 1] = c0; cols.push(c + 1); }
        if (z > 0 && reg[c - nx] === -2) { reg[c - nx] = c0; cols.push(c - nx); }
        if (z < nz - 1 && reg[c + nx] === -2) { reg[c + nx] = c0; cols.push(c + nx); }
      }
      if (cols.length < 3 || cols.length > loaded * 0.25) continue;
      // What drops: over each column, up to where the arch over the gap takes the load
      const seeds = [];
      let mx = 0, mz = 0, n = 0;
      for (const c of cols) {
        const reach = this.reachOut(s, y, c, LOADM[c]), d = now[c] * cs;
        const x = c % nx, z = (c - x) / nx;
        for (let yy = y; yy < ny; yy++) {
          if (d <= reach + 0.6 * (g.ys[yy] - g.ys[y])) break;
          const i = c + nxz * yy;
          if (mat[i] >= SOLID) { seeds.push(i); mx += g.cx(x); mz += g.cz(z); n++; }
        }
      }
      if (seeds.length < 8) continue;
      const cells = this.hanging(s, seeds), G = this.groundStamp;
      // Peel away from the building: out from the middle of the section toward the chunk
      let ox = mx / n - L.comps.reduce((t, C) => t + C.mx, 0) / Math.max(1e-6, L.comps.reduce((t, C) => t + C.M, 0));
      let oz = mz / n - L.comps.reduce((t, C) => t + C.mz, 0) / Math.max(1e-6, L.comps.reduce((t, C) => t + C.M, 0));
      const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      const p = _a.set(mx / n, g.ys[y], mz / n);
      this.stats.chunks = (this.stats.chunks || 0) + 1;
      this.dustRing(p, Math.sqrt(cols.length) * cs * 0.6, 0.8);
      this.sound.collapse(p, Math.min(2.5, Math.cbrt(cells.length) / 14));
      this.armRemnants(s, cells);
      const body = this.detach(s, cells, { cause: 'chunk' });
      if (body) {
        body.v.x += ox * 0.6 * M; body.v.z += oz * 0.6 * M;
        // Tip outward: top away from the building
        body.w.x += oz * 0.12; body.w.z -= ox * 0.12;
      }
      broke = true;
      if (s.dead) return true;
      this.leftovers(s, G);
      if (s.dead) return true;
    }
    return broke;
  }

  /** How far (game units) floors and walls over column c at level y can carry it out from support */
  reachOut(s, y, c, m) {
    const g = s.g, { nxz, ny, mat } = g, M = this.M;
    let span = MATS[3].span;
    for (let yy = y; yy < Math.min(ny, y + 8); yy++) { const k = mat[c + nxz * yy]; if (k >= SOLID) { span = MATS[k].span; break; } }
    // Its weight as a height of solid over the column, in meters: the more it holds, the less it reaches
    const x = c % g.nx, H = m / (g.dx(x) * g.dz((c - x) / g.nx)) / M;
    return span * M * Math.max(0.5, Math.min(1, Math.sqrt(15 / Math.max(1e-3, H))));
  }

  /**
   * Seeds and everything only they held to the ground: what goes with them when they go. One
   * pass from the ground over what is left, so it costs one flood of the structure.
   */
  hanging(s, seeds) {
    const g = s.g, { nx, ny, nz, nxz, mat } = g;
    scratch(g.N);
    const F = nextStamp();
    for (const i of seeds) VIS[i] = F;
    const G = nextStamp();
    let qh = 0, qt = 0;
    for (let i = 0; i < s.anchor * nxz; i++) if (mat[i] >= SOLID && VIS[i] !== F) { VIS[i] = G; QUEUE[qt++] = i; }
    while (qh < qt) {
      const i = QUEUE[qh++], y = (i / nxz) | 0, r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
      faces(i, x, y, z, nx, ny, nz, nxz);
      for (let k = 0; k < 6; k++) { const j = NB[k]; if (j >= 0 && mat[j] >= SOLID && VIS[j] !== F && VIS[j] !== G) { VIS[j] = G; QUEUE[qt++] = j; } }
    }
    this.groundStamp = G;
    const out = seeds.slice();
    for (let h = 0; h < out.length; h++) {
      const i = out[h], y = (i / nxz) | 0, r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
      faces(i, x, y, z, nx, ny, nz, nxz);
      for (let k = 0; k < 6; k++) { const j = NB[k]; if (j >= 0 && mat[j] >= SOLID && VIS[j] !== F && VIS[j] !== G) { VIS[j] = F; out.push(j); } }
    }
    return out;
  }

  /**
   * A level gives: the floors above come down, crushing a storey, or tip over the side the
   * section was squeezed on. Tipping, the squeezed edge crumbles back to just behind where the
   * load bears, and the top pivots there on a hinge: slow at first, held by what the hinge has
   * left, faster as its weight swings out past the edge, until the hinge snaps or the gap the
   * crumbled edge left closes under it.
   */
  fail(s, y, near, id, mode, info) {
    const g = s.g, { nx, ny, nxz, mat } = g;
    this.stats.collapses++;
    let y0 = y;
    const p = new V3(info.lx, info.wy, info.lz);
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
    const tip = mode === 'tip' ? this.crushEdge(s, y, near, id, info) : null;
    const seeds = [];
    for (let yy = y0; yy < ny; yy++) for (let c = 0; c < nxz; c++) if (near[c] === id && mat[c + nxz * yy] >= SOLID) seeds.push(c + nxz * yy);
    if (!seeds.length) return;
    const cells = this.hanging(s, seeds), G = this.groundStamp;
    // What stands browns out, and the lights round the failing level die
    flicker(s.power, this.time, 1.4);
    s.power.U.uPow.value.w *= 0.7;
    if (outage(s.power, p, Math.min(30 * this.M, Math.sqrt(info.M / Math.max(1e-6, this.M ** 3)) * 0.06 + 8 * this.M), this.time)) this.sparkle(s, p, 10 * this.M, 4);
    // Dust bursting out of the failing floor all round
    this.dustRing(p, Math.sqrt(info.M / Math.max(1e-6, this.M ** 3)) * 0.02 + 2, mode === 'crush' ? 1.6 : 1);
    const size = Math.min(4, Math.cbrt(cells.length) / 12);
    this.sound.collapse(p, size);
    this.fx.onShake(p, 0.6 + size * 0.3);
    this.armRemnants(s, cells);
    const b = this.detach(s, cells, { cause: mode });
    // A hinge for what stands tall over its pivot (a tower going over); a low, wide part (a
    // deck losing its bents, a squat top) just tips off its edge on contacts
    if (b && tip && b.x.y - tip.wy > 0.8 * (Math.abs(tip.fx) * (b.max.x - b.min.x) + Math.abs(tip.fz) * (b.max.z - b.min.z))) this.hingeOn(b, s, tip);
    // And anything else it leaves hanging in the air (the crumbled edge may cut bits off)
    if (!s.dead) this.leftovers(s, G);
  }

  /**
   * After hanging() and the detach of what it found: solid cells the ground flood (stamp G)
   * didn't reach are hanging in the air with nothing; they go too. One linear pass, the flood
   * already done.
   */
  leftovers(s, G) {
    const g = s.g, { nx, ny, nz, nxz, mat, N } = g;
    let ls = 0;
    for (let i = s.anchor * nxz; i < N; i++) {
      if (mat[i] < SOLID || VIS[i] === G || VIS[i] === ls) continue;
      ls = nextStamp();
      const cells = [i];
      VIS[i] = ls;
      for (let h = 0; h < cells.length; h++) {
        const c = cells[h], y = (c / nxz) | 0, r = c - y * nxz, z = (r / nx) | 0, x = r - z * nx;
        faces(c, x, y, z, nx, ny, nz, nxz);
        for (let k = 0; k < 6; k++) { const j = NB[k]; if (j >= 0 && mat[j] >= SOLID && VIS[j] !== G && VIS[j] !== ls) { VIS[j] = ls; cells.push(j); } }
      }
      this.detach(s, cells, { cause: 'island' });
      if (s.dead) return;
      // detach stamps cells of its own; the ground's stamp G on the rest is untouched
    }
  }

  /**
   * Tipping: the squeezed edge of the section crumbles back to a pivot line just behind where
   * the load bears (or the section's edge, with the load already past it), a storey's worth
   * deep: rubble and dust out of the stump's top and the falling part's foot. Returns the pivot
   * for the hinge.
   */
  crushEdge(s, y, near, id, info) {
    const g = s.g, { nx, ny, nxz, mat } = g, cs = s.cellSize, M = this.M;
    const fx = info.fx, fz = info.fz;
    // Pivot: d back from the load along the fall direction
    let d, hb = 0;
    if (info.beyond) d = -info.front;
    else {
      const behind = info.depth - info.front; // section behind the load
      d = Math.min(Math.max(1.5 * cs, 0.12 * info.depth), Math.max(0.5 * cs, 0.8 * behind));
      hb = Math.max(1, Math.round((1.6 * M) / cs));
    }
    const px = info.lx - fx * d, pz = info.lz - fz * d, wy = g.ys[y];
    // Only the section itself crumbles (its cells across the level and a cell round them), not a
    // wider lobby or podium roof just under the level
    if (CHR.length < nxz) CHR = new Int32Array(nxz * 2);
    const nz = g.nz, a = y * nxz, b = a - nxz, zone = CHR;
    for (let c = 0; c < nxz; c++) zone[c] = 0;
    for (let c = 0; c < nxz; c++) {
      if (near[c] !== id || mat[a + c] < SOLID || mat[b + c] < SOLID) continue;
      const x = c % nx, z = (c - x) / nx;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Z = z + dz;
        if (X >= 0 && Z >= 0 && X < nx && Z < nz) zone[X + nx * Z] = 1;
      }
    }
    let n = 0, sx = 0, sy = 0, sz = 0;
    if (hb) {
      for (let yy = Math.max(s.anchor, y - hb); yy < Math.min(ny, y + hb); yy++) {
        for (let c = 0; c < nxz; c++) {
          if (near[c] !== id || !zone[c]) continue;
          const x = c % nx, z = (c - x) / nx;
          if ((g.cx(x) - px) * fx + (g.cz(z) - pz) * fz <= 0) continue;
          const i = c + nxz * yy;
          if (mat[i] < SOLID) continue;
          n++; sx += g.cx(x); sy += g.cy(yy); sz += g.cz(z);
          if (n % 3 === 0 && this.frame.chunks < 200) { this.frame.chunks++; this.chunkFrom(s, g.cx(x), g.cy(yy), g.cz(z), fx, 0.3, fz, rand(4, 9) * M, mat[i], {}); }
          this.removeCell(s, i, true);
        }
      }
      if (n) this.dustRing(_b.set(sx / n, sy / n, sz / n), Math.sqrt(n / hb) * cs * 0.5 + 2 * M, 1.2);
    }
    // How far the section reaches along the hinge line, either side of the pivot
    let span = cs;
    for (let c = 0; c < nxz; c++) {
      if (near[c] !== id || !zone[c]) continue;
      const i = c + nxz * (y - 1);
      if (y < 1 || mat[i] < SOLID) continue;
      const x = c % nx, z = (c - x) / nx, along = (g.cx(x) - px) * fz - (g.cz(z) - pz) * fx;
      if (Math.abs((g.cx(x) - px) * fx + (g.cz(z) - pz) * fz) < 2 * cs) span = Math.max(span, Math.abs(along));
    }
    return { px, pz, wy, fx, fz, d, hb, dFront: info.front + d, span };
  }

  /** Pin a tipping body on its pivot line (see crushEdge) */
  hingeOn(b, s, T) {
    const cs = s.cellSize, G = this.G;
    const pivot = new V3(T.px, T.wy, T.pz), fall = new V3(T.fx, 0, T.fz), axis = new V3(T.fz, 0, -T.fx);
    const hc = Math.max(cs, b.x.y - T.wy);
    // Lever of its weight past the pivot, and what the hinge has to hold against it
    const lever = (b.x.x - T.px) * T.fx + (b.x.z - T.pz) * T.fz;
    const Mr = 0.4 * b.m * G * Math.max(0, lever);
    // The crumbling edge gives it a start; its own height sets how fast a tower that tall leans
    b.w.addScaledVector(axis, 0.08 * Math.sqrt(G / hc));
    const extra = { s, wy: T.wy, span: T.span };
    if (T.hb) {
      // Its foot at the front: when that comes down onto the crumbled stump, the gap has closed
      extra.foot = b.toLocal(T.px + T.fx * T.dFront, T.wy + T.hb * cs, T.pz + T.fz * T.dFront, new V3());
      extra.footY = T.wy - T.hb * cs + 0.3 * cs;
    }
    this.physics.setHinge(b, pivot, axis, fall, Mr, 0.06, rand(0.35, 0.6), extra);
    this.stats.hinges = (this.stats.hinges || 0) + 1;
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
    if (ND.length < RN) ND = new Uint8Array(RN);
    const nd = ND;
    nd.fill(255, 0, RN);
    const L = (x, y, z) => (x - x0) + rw * ((z - z0) + rd * (y - y0));
    if (SPQ.length < RN) { SPQ = new Int32Array(RN); SPD = new Uint8Array(RN); SPS = new Int32Array(RN); SPF = new Int32Array(RN * 2); }
    // Seeds with the distance they start at, then sorted by it (counting sort)
    let ns = 0;
    const cnt = SPC.fill(0);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      let anch = y0 === 0 || (mat[x + nx * (z + nz * (y0 - 1))] >= SOLID && s.dist[x + nx * (z + nz * (y0 - 1))] === 0);
      for (let y = y0; y <= y1; y++) {
        const i = x + nx * (z + nz * y);
        if (mat[i] < SOLID) { anch = false; continue; }
        anch = anch || y < s.anchor;
        const l = L(x, y, z);
        let d0 = 0;
        if (!anch) {
          // The region's sides and top keep what they had; its floor hands up from below
          const edge = x === x0 || x === x1 || z === z0 || z === z1 || y === y1;
          d0 = edge ? s.dist[i] : 255;
          if (y === y0 && y0 > 0 && mat[i - nxz] >= SOLID) d0 = Math.min(d0, s.dist[i - nxz] + 1);
          if (d0 >= 255) continue;
        }
        nd[l] = d0; SPQ[ns] = l; SPD[ns++] = d0; cnt[d0]++;
      }
    }
    for (let d = 0, o = 0; d < 256; d++) { const c = cnt[d]; cnt[d] = o; o += c; }
    for (let k = 0; k < ns; k++) SPS[cnt[SPD[k]]++] = SPQ[k];
    // Breadth first from them in order of distance: the sorted seeds merged with the queue
    let sp = 0, qh = 0, qt = 0;
    const plane = rw * rd;
    while (sp < ns || qh < qt) {
      let l;
      if (qh < qt && (sp >= ns || nd[SPF[qh]] <= nd[SPS[sp]])) l = SPF[qh++]; else l = SPS[sp++];
      const nd1 = nd[l] + 1;
      if (nd1 >= 255) continue;
      const x = l % rw, t = (l - x) / rw, z = t % rd, y = (t - z) / rd;
      const gi = (x + x0) + nx * ((z + z0) + nz * (y + y0));
      if (x > 0 && nd[l - 1] > nd1 && mat[gi - 1] >= SOLID) { nd[l - 1] = nd1; SPF[qt++] = l - 1; }
      if (x < rw - 1 && nd[l + 1] > nd1 && mat[gi + 1] >= SOLID) { nd[l + 1] = nd1; SPF[qt++] = l + 1; }
      if (z > 0 && nd[l - rw] > nd1 && mat[gi - nx] >= SOLID) { nd[l - rw] = nd1; SPF[qt++] = l - rw; }
      if (z < rd - 1 && nd[l + rw] > nd1 && mat[gi + nx] >= SOLID) { nd[l + rw] = nd1; SPF[qt++] = l + rw; }
      if (y > 0 && nd[l - plane] > nd1 && mat[gi - nxz] >= SOLID) { nd[l - plane] = nd1; SPF[qt++] = l - plane; }
      if (y < rh - 1 && nd[l + plane] > nd1 && mat[gi + nxz] >= SOLID) { nd[l + plane] = nd1; SPF[qt++] = l + plane; }
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

  /** Look for what a collapse left standing on its own, a little after it settles */
  armRemnants(s, cells, box) {
    if (s.dead || s.body) return;
    const t = this.time + 0.9;
    if (!s.remnantT || s.remnantT > t) s.remnantT = t;
    // Where to look: round what went, a few cells wider (x0, y0, z0, x1, z1)
    const g = s.g, { nx, nz, nxz } = g, R = s.remBox || (s.remBox = [Infinity, Infinity, Infinity, -1, -1]);
    if (box) { R[0] = Math.min(R[0], box[0]); R[1] = Math.min(R[1], box[1]); R[2] = Math.min(R[2], box[2]); R[3] = Math.max(R[3], box[3]); R[4] = Math.max(R[4], box[4]); }
    if (cells) for (const i of cells) {
      const y = (i / nxz) | 0, r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
      if (x < R[0]) R[0] = x; if (y < R[1]) R[1] = y; if (z < R[2]) R[2] = z; if (x > R[3]) R[3] = x; if (z > R[4]) R[4] = z;
    }
  }

  /**
   * What a collapse left standing with nothing to brace it goes too: walls a cell thick and
   * columns whose floors and roof are gone, standing free taller than they could (about 16
   * times their thickness, 8 to 18 m; steel twice that). Masts, poles and parapets built that
   * way are left alone: only runs that were braced before (by what is now gone) count.
   */
  remnants(s) {
    const g = s.g, { nx, ny, nz, nxz, mat } = g, cs = s.cellSize, M = this.M;
    const lim = Math.min(18 * M, Math.max(8 * M, 16 * cs));
    // Only round what the collapse took (a wall it left standing free is next to it)
    const R = s.remBox;
    s.remBox = null;
    if (!R || R[3] < 0) return;
    const pad = 4, X0 = Math.max(0, R[0] - pad), X1 = Math.min(nx - 1, R[3] + pad), Z0 = Math.max(0, R[2] - pad), Z1 = Math.min(nz - 1, R[4] + pad);
    const Y0 = Math.max(s.anchor, R[1] - Math.ceil(lim / cs) - 1);
    // Thin: three or fewer other solid cells round it in its layer (now, or before any damage)
    const count = (i, x, z, orig) => {
      let n = 0;
      const x0 = x > 0 ? -1 : 0, x1 = x < nx - 1 ? 1 : 0, z0 = z > 0 ? -nx : 0, z1 = z < nz - 1 ? nx : 0;
      for (let dz = z0; dz <= z1; dz += nx) for (let dx = x0; dx <= x1; dx++) {
        if (!dx && !dz) continue;
        const m = mat[i + dx + dz];
        if (m >= SOLID || (orig && m === GONE)) n++;
      }
      return n;
    };
    const marks = [];
    for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
      const c = x + nx * z;
      let y = Y0;
      while (y < ny) {
        const i = c + nxz * y;
        if (mat[i] < SOLID || count(i, x, z, false) > 3) { y++; continue; }
        // A run of thin cells from here up
        let y1 = y, braced = false, steel = true;
        while (y1 < ny) {
          const j = c + nxz * y1;
          if (mat[j] < SOLID || count(j, x, z, false) > 3) break;
          if (count(j, x, z, true) > 3) braced = true;
          if (mat[j] !== STEEL) steel = false;
          y1++;
        }
        const top = y1 < ny ? mat[c + nxz * y1] : OUT;
        // Standing free (nothing on top), and it used to be braced, or capped by what is gone, wall
        // round the cap and all (under a hole in a wall that goes on round it, it is still a wall)
        const capped = top === GONE && count(c + nxz * y1, x, z, false) === 0;
        if (top < SOLID && (braced || capped) && g.ys[y1] - g.ys[y] > lim * (steel ? 2 : 1)) for (let k = y; k < y1; k++) marks.push(c + nxz * k);
        y = y1 + 1;
      }
    }
    if (!marks.length) return;
    // Topple in connected pieces, outward from the middle of the plan
    scratch(g.N);
    const fs = nextStamp();
    for (const i of marks) VIS[i] = fs;
    const mcx = (g.xs[0] + g.xs[nx]) / 2, mcz = (g.zs[0] + g.zs[nz]) / 2;
    for (const i0 of marks) {
      if (VIS[i0] !== fs || mat[i0] < SOLID) continue;
      const ps = nextStamp(), cells = [i0];
      VIS[i0] = ps;
      let sx = 0, sz = 0;
      for (let h = 0; h < cells.length; h++) {
        const i = cells[h], y = (i / nxz) | 0, r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
        sx += g.cx(x); sz += g.cz(z);
        faces(i, x, y, z, nx, ny, nz, nxz);
        for (let k = 0; k < 6; k++) { const j = NB[k]; if (j >= 0 && VIS[j] === fs && mat[j] >= SOLID) { VIS[j] = ps; cells.push(j); } }
      }
      this.stats.remnants = (this.stats.remnants || 0) + 1;
      const b = this.detach(s, cells, { cause: 'remnant' });
      if (b) {
        let ox = sx / cells.length - mcx, oz = sz / cells.length - mcz;
        const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
        b.w.x += oz * 0.1; b.w.z -= ox * 0.1;
      }
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
    const cut = []; // what stays behind
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const gi = x + nx * (z + nz * y), bi = (x - x0) + bg.nx * ((z - z0) + bg.nz * (y - y0));
      if (VIS[gi] === st) bg.hp[bi] = s.hp[gi];
      else if (bg.mat[bi] >= SOLID) { bg.mat[bi] = GONE; cut.push(bi); } else if (bg.mat[bi] === GONE) cut.push(bi); // (and what was shot away)
    }
    // Out of the parent; the edge it broke from gets checked
    for (const i of cells) this.removeCell(s, i, true);
    for (const i of cells) {
      const y = Math.floor(i / nxz), r = i - y * nxz, z = Math.floor(r / nx), x = r - z * nx;
      if ((x > 0 && mat[i - 1] >= SOLID) || (x < nx - 1 && mat[i + 1] >= SOLID) || (z > 0 && mat[i - nx] >= SOLID) || (z < nz - 1 && mat[i + nx] >= SOLID) || (y > 0 && mat[i - nxz] >= SOLID) || (y < g.ny - 1 && mat[i + nxz] >= SOLID)) s.pending.push(i);
    }
    const off = [s.off[0] + x0, s.off[1] + y0, s.off[2] + z0];
    const bs = new Structure(this, bg, s.owner, s.lut, off, cut);
    this.lightUp(bs, s);
    // The parent's lights at the break short out
    if (!s.body && cells.length > 60) {
      const cx = (g.xs[x0] + g.xs[x1 + 1]) / 2, cz = (g.zs[z0] + g.zs[z1 + 1]) / 2, w = Math.max(g.xs[x1 + 1] - g.xs[x0], g.zs[z1 + 1] - g.zs[z0]);
      flicker(s.power, this.time, Math.min(1.2, cells.length / 2500));
      if (outage(s.power, _c.set(cx, g.ys[y0], cz), Math.min(16 * this.M, w * 0.5 + 3 * this.M), this.time)) this.sparkle(s, _c, w * 0.4 + this.M, 2);
    }
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
    if (!s.body) {
      // Flush against its parent and the buildings next door: they give it no support until it
      // leans or pushes into them (physics.js)
      // (by owner: a neighbor still a city box now may be a voxel structure by the time it's hit)
      const near = new Set([s.owner]), pad = s.cellSize;
      this.statics(_a.copy(b.min).subScalar(pad), _b.copy(b.max).addScalar(pad), (o) => near.add(o.vox ? o.vox.owner : o.owner || o));
      b.fresh = { near, x0: b.x.clone(), q0: b.q.clone(), r2: (2 * s.cellSize) ** 2 };
    }
    this.physics.add(b);
    this.scene.add(bs.group);
    b.matrix(bs.group.matrix);
    bs.group.matrixWorldNeedsUpdate = true;
    this.stats.bodies++;
    this.knockOff(b);
    // What broke away took its skin along: the parent's copy of it goes, so nothing of it is left in the air
    if (cells.length >= 200) this.pruneSkin(s);
    this.checkDead(s);
    return b;
  }

  /** Drop skin triangles with no solid cell left at or next to any of their corners' backing cells */
  pruneSkin(s) {
    if (s.dead) return;
    const g = s.g, { nx, ny, nz, nxz, mat } = g;
    const near = (c) => {
      if (c < 0) return false;
      const y = (c / nxz) | 0, r = c - y * nxz, z = (r / nx) | 0, x = r - z * nx;
      for (let Y = Math.max(0, y - 1); Y <= Math.min(ny - 1, y + 1); Y++) for (let Z = Math.max(0, z - 1); Z <= Math.min(nz - 1, z + 1); Z++) {
        for (let X = Math.max(0, x - 1); X <= Math.min(nx - 1, x + 1); X++) if (mat[X + nx * (Z + nz * Y)] >= SOLID) return true;
      }
      return false;
    };
    let changed = false;
    const parts = [];
    for (const part of s.skin) {
      const Bk = part.attrs.aBack.a, tris = part.count / 3, keep = [];
      for (let t = 0; t < tris; t++) {
        const v = t * 9;
        if (near(g.cellAt(Bk[v], Bk[v + 1], Bk[v + 2])) || near(g.cellAt(Bk[v + 3], Bk[v + 4], Bk[v + 5])) || near(g.cellAt(Bk[v + 6], Bk[v + 7], Bk[v + 8]))) keep.push(t);
      }
      if (keep.length === tris) { parts.push(part); continue; }
      changed = true;
      if (!keep.length) continue;
      const attrs = {};
      for (const k in part.attrs) {
        const { a, size } = part.attrs[k], n = size * 3, A = new Float32Array(keep.length * n);
        keep.forEach((t, j) => A.set(a.subarray(t * n, t * n + n), j * n));
        attrs[k] = { a: A, size };
      }
      parts.push(Object.assign({}, part, { attrs, count: keep.length * 3 }));
    }
    if (!changed) return;
    for (const mesh of s.skinMeshes) { s.group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh.customDepthMaterial.dispose(); }
    s.skinMeshes = [];
    s.skin = parts;
    this.buildSkin(s);
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
    if (s.faceMat) s.faceMat.dispose();
    s.mask.dispose();
    if (!s.body) { const i = this.structs.indexOf(s); if (i >= 0) this.structs.splice(i, 1); }
  }

  /** Spiders standing on a piece that breaks away lose their footing, and trees planted on it go with it */
  knockOff(b) {
    const T = this.world.trees;
    if (T) {
      for (const t of T.list) {
        if (t.loose || t.base.y < 1 || t.base.x < b.min.x || t.base.x > b.max.x || t.base.z < b.min.z || t.base.z > b.max.z) continue;
        b.toLocal(t.base.x, t.base.y - b.s.cellSize * 0.5, t.base.z, _a);
        const k = b.s.g.cellAt(_a.x, _a.y, _a.z);
        if (k >= 0 && b.s.g.mat[k] >= SOLID) T.uproot(t, rand(-1, 1), 0.5, rand(-1, 1), 0.4);
      }
    }
    const S = this.spiders;
    if (!S) return;
    for (const sp of S.list) {
      if (sp.kind !== 'spider' || !sp.alive || sp.removed || (sp.state !== 'crawl' && sp.state !== 'perch' && sp.state !== 'emerge' && sp.state !== 'crouch')) continue;
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

  /**
   * A piece hit something hard this step: dust, sound, crushing and maybe shattering. What it
   * crushes at each place it struck goes by the energy it brought there (its mass at that point
   * and the speed it came in at, so by how far it fell): a storey-sized block off a roof dents a
   * street, a toppling tower's top caves in the building it lands on.
   */
  impacts(dt) {
    const M = this.M, M3 = M * M * M;
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
        for (let n = 0; n < b.nimp; n++) {
          const I = b.imps[n], v = I.speed / M;
          if (v <= 5) continue;
          const E = 0.5 * (I.meff / M3) * 2400 * v * v;                        // joules
          const R = Math.min(9, Math.max(0.6, Math.cbrt((3 * E) / CRUSH_J / (4 * Math.PI)))); // meters
          const P = Math.min(520, 60 + v * 20);
          this.crushOther(I, R, P, b);
          b.toLocal(I.point.x, I.point.y, I.point.z, _a);
          this.damageSphere(b.s, _a.x, _a.y, _a.z, Math.min(R, 2.5) * M, P * 0.7, { speed: v * 0.4 * M, chunks: 6 });
          if (b.s.dead) break;
        }
        if (b.s.dead) continue;
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
      // (not a piece toppling over: that pivots on the edge it crushes)
      if (wide && q > 6 && crushOther && !other.body && n.y > 0.9 && !a.crushDown && a.cells > 400 && !a.hinge && a.R[4] > 0.95 && a.w.length() < 0.2) {
        a.crushDown = { s: other, slow: 0, foot: footprint(a.s.g) };
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
    if (C.slow > 0.35 || b.min.y < this.ground(b.x.x, b.x.z) + 0.5 * M) {
      b.crushDown = null;
      const g = s.g;
      this.armRemnants(s, null, [lineIndexClamped(g.xs, b.min.x), 0, lineIndexClamped(g.zs, b.min.z), lineIndexClamped(g.xs, b.max.x), lineIndexClamped(g.zs, b.max.z)]);
      return;
    }
    // Cells of the structure in the band the block's underside sweeps through, across its whole
    // footprint (hollow or not, and a cell wider): a tapering shaft dropping into the wider one
    // below takes its walls with it, it doesn't slide down inside them
    const g = s.g, travel = Math.max(0, -b.v.y * dt) + s.cellSize, F = C.foot, pad = s.cellSize;
    const x0 = lineIndexClamped(g.xs, b.min.x - pad), x1 = lineIndexClamped(g.xs, b.max.x + pad);
    const z0 = lineIndexClamped(g.zs, b.min.z - pad), z1 = lineIndexClamped(g.zs, b.max.z + pad);
    const y0 = lineIndexClamped(g.ys, b.min.y - travel), y1 = lineIndexClamped(g.ys, b.min.y + Math.min(b.max.y - b.min.y, s.cellSize * 6));
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = x + g.nx * (z + g.nz * y), m = g.mat[i];
      if (m < SOLID) continue;
      // Under the block: in its footprint, and its underside there reaches the cell this step
      b.toLocal(g.cx(x), g.cy(y), g.cz(z), _a);
      const low = footLow(F, _a.x, _a.z);
      if (low === null || _a.y + travel < low - s.cellSize * 0.5) continue;
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
    const chunks = Math.round(6 + R * 2);
    if (o.vox) { if (!o.vox.dead) this.damageSphere(o.vox, p.x, p.y, p.z, R * this.M, P, { speed: 6 * this.M, chunks }); return; }
    if (o.isBody) { o.toLocal(p.x, p.y, p.z, _a); this.damageSphere(o.s, _a.x, _a.y, _a.z, R * this.M, P * 0.8, { chunks: 6 }); return; }
    if (o.ref && o.ref.kind === 'car') { this.city.damageCar(o.ref, 999, p); this.city.crushCar(o.ref); return; }
    if (o.owner) {
      // Unbroken yet: within the frame's activation budget, or a frame or two later
      if (!o.owner.struct && this.frame.act > 0 && this.frame.act >= this.actBudget) { this.later.push({ ow: o.owner, p: p.clone(), R: R * this.M, power: P, opts: { speed: 6 * this.M, chunks } }); return; }
      const s = this.activate(o.owner);
      if (s) this.damageSphere(s, p.x, p.y, p.z, R * this.M, P, { speed: 6 * this.M, chunks });
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
    CEIL_SHARED.uTime.value = this.time;
    if (this.warm && (this.warm.t -= dt) <= 0) { this.scene.remove(this.warm.g); this.warm = null; }
    this.frame.chunks = 0; this.frame.dust = 0; this.frame.big = 0;
    // Physics in steps of at most 1/90 s
    const n = Math.min(4, Math.ceil(dt / (1 / 90)));
    for (let k = 0; k < n; k++) {
      this.physics.step(dt / n);
      this.impacts(dt / n);
      this.pressures(dt / n);
      for (const b of this.physics.bodies) if (b.crushDown) this.crushDown(b, dt / n);
    }
    for (const b of this.physics.bodies) if (b.hinge) this.tendHinge(b, dt);
    // Blasts waiting on structures to activate
    while (this.later.length && (this.frame.act === 0 || this.frame.act < this.actBudget)) {
      const L = this.later.shift(), s = this.activate(L.ow);
      if (s) this.damageSphere(s, L.p.x, L.p.y, L.p.z, L.R, L.power, L.opts);
    }
    const T1 = performance.now();
    // Structural checks
    for (const s of [...this.structs]) {
      s.analyzeT -= dt;
      if (s.pending.length && s.analyzeT <= 0 && !s.dead) { s.analyzeT = ANALYZE_EVERY; this.analyze(s); }
      if (s.remnantT && this.time >= s.remnantT && !s.dead) { s.remnantT = 0; this.remnants(s); }
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
    this.capBodies();
    this.jolts();
    const T2 = performance.now();
    this.debris.update(dt);
    this.roofTrees(dt);
    this.render(dt);
    const T3 = performance.now();
    // Slow frames, for tuning
    if (T3 - T0 > 30) {
      this.slow = this.slow || [];
      this.slow.push({ t: +this.time.toFixed(1), ms: +(T3 - T0).toFixed(1), phys: +(T1 - T0).toFixed(1), checks: +(T2 - T1).toFixed(1), draw: +(T3 - T2).toFixed(1), act: +(this.stats.activateMs - act0).toFixed(1), bodies: this.physics.bodies.length });
      if (this.slow.length > 40) this.slow.shift();
    }
    // Activations from here to the next update (weapons fire first) count against the next frame
    this.frame.act = 0;
  }

  /**
   * A body pivoting on a hinge: let it go when the hinge snapped or slid off its edge, when the
   * gap the crumbled edge left has closed under its foot, or when the stump under the pivot is
   * gone; meanwhile the hinge grinds, shedding grit and dust, groaning as it starts to go.
   */
  tendHinge(b, dt) {
    const H = b.hinge, S = H.s, cs = b.s.cellSize, w = H.wa;
    if (!H.span) H.span = 0.35 * Math.min(b.max.x - b.min.x, b.max.z - b.min.z);
    if (!H.broken) {
      if (S.dead) H.broken = 'stump';
      else if (H.foot && b.toWorld(H.foot.x, H.foot.y, H.foot.z, _a).y < H.footY) H.broken = 'closed';
      else if ((H.supT = (H.supT || 0) - dt) <= 0) {
        // Still something under the hinge line to turn on (a hollow shaft's two walls will do),
        // and still something of its own over it to turn with
        H.supT = 0.1;
        const g = S.g, bg = b.s.g, n = Math.max(2, Math.ceil(H.span / cs));
        let held = false, own = false;
        for (let k = -n; k <= n && !(held && own); k++) {
          const t = (k / n) * H.span, x = w.x + H.axis.x * t - H.fall.x * cs * 0.6, z = w.z + H.axis.z * t - H.fall.z * cs * 0.6;
          for (let d = 0.5; d <= 1.5; d += 1) {
            if (!held) { const i = g.cellAt(x, w.y - cs * d, z); if (i >= 0 && g.mat[i] >= SOLID) held = true; }
            if (!own) { b.toLocal(x, w.y + cs * d, z, _b); const i = bg.cellAt(_b.x, _b.y, _b.z); if (i >= 0 && bg.mat[i] >= SOLID) own = true; }
          }
        }
        if (!held || !own) H.broken = 'support';
      }
    }
    if (H.broken) {
      const st = this.stats.hingeBreaks || (this.stats.hingeBreaks = {});
      st[H.broken] = (st[H.broken] || 0) + 1;
      b.hinge = null;
      // Settled or turned back: it just goes quiet
      if (H.broken === 'rest' || H.broken === 'back' || H.broken === 'age') return;
      const k = Math.min(3, Math.cbrt(b.cells) / 12);
      this.sound.crash(w, k);
      this.sound.metalHit(w, Math.min(1, 0.3 + k * 0.2));
      this.dustRing(w, H.span + 2 * this.M, Math.min(1.4, 0.4 + k * 0.3));
      return;
    }
    // Grinding
    const om = Math.abs(b.w.dot(H.axis));
    H.fxT = (H.fxT || 0) - dt;
    if (H.fxT > 0 || om < 0.003) return;
    H.fxT = Math.max(0.07, 0.45 - om * 3);
    const fx = this.fx, M = this.M;
    for (let i = 0; i < 4; i++) {
      const t = rand(-1, 1) * H.span, x = w.x + H.axis.x * t, z = w.z + H.axis.z * t, gy = rand(0.42, 0.55);
      fx.smoke.emit(x, w.y + rand(-1, 1) * cs, z, H.fall.x * rand(1, 4) + rand(-1, 1), rand(0, 2), H.fall.z * rand(1, 4) + rand(-1, 1),
        rand(2.5, 4.5), M * 2, M * rand(6, 10), gy, gy * 0.96, gy * 0.9, 0.6, gy, gy * 0.96, gy * 0.9, 0, 1.2, 0.2, rand(-0.6, 0.6));
      if (i % 2 === 0) this.debris.spawn(x, w.y, z, H.fall.x * rand(2, 6), rand(1, 4), H.fall.z * rand(2, 6), cs * rand(0.3, 0.7), 3, rand(8, 16));
    }
    this.sound.crumble(w, 12 + om * 400);
    if (this.time > (H.groanT || 0)) { H.groanT = this.time + rand(1.2, 2.2); this.sound.groan(w, Math.min(1, 0.5 + om * 8)); }
  }

  /**
   * Past the piece budget (big pieces always break away as pieces), the smallest of those lying
   * still crumble into rubble and dust, so the physics keeps its frame time on a phone
   */
  capBodies() {
    const B = this.physics.bodies;
    if (B.length <= MAX_BODIES || (this.capT = (this.capT || 0) - 1) > 0) return;
    this.capT = 10; // every ten frames or so
    const still = B.filter((b) => b.sleeping && b.cells < 1500 && !b.s.dead).sort((p, q) => p.cells - q.cells);
    for (const b of still.slice(0, B.length - MAX_BODIES)) {
      const P = b.probes, n = Math.min(8, P.length / 3);
      for (let k = 0; k < n && this.frame.chunks < 200; k++) {
        const j = Math.floor(Math.random() * (P.length / 3));
        b.toWorld(P[j * 3], P[j * 3 + 1], P[j * 3 + 2], _a);
        this.frame.chunks++;
        this.debris.spawn(_a.x, _a.y, _a.z, rand(-1, 1), rand(0, 1.5), rand(-1, 1), b.s.cellSize * rand(0.5, 0.9), 3, rand(10, 20));
      }
      this.dustRing(b.x, Math.cbrt(b.cells) * b.s.cellSize * 0.5, 0.3);
      this.killBody(b);
    }
  }

  /** Trees on roof gardens and terraces fall when the roof under them is shot away */
  roofTrees(dt) {
    const T = this.world.trees;
    if (!T || (this.treeT = (this.treeT || 0) - dt) > 0) return;
    this.treeT = 0.25;
    if (!this.roof) this.roof = T.list.filter((t) => t.base.y > 1);
    for (const t of this.roof) {
      if (t.loose) continue;
      for (const s of this.structs) {
        const B = s.box;
        if (s.dead || t.base.x < B.min.x || t.base.x > B.max.x || t.base.z < B.min.z || t.base.z > B.max.z || t.base.y < B.min.y || t.base.y > B.max.y + 1) continue;
        const k = s.g.cellAt(t.base.x, t.base.y - s.cellSize * 0.5, t.base.z);
        if (k >= 0 && s.g.mat[k] === GONE) T.uproot(t, rand(-1, 1), 0, rand(-1, 1), 0.5);
      }
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
    // People and furniture under it
    if (this.world.people) this.world.people.crushIn(b, inside);
    if (this.world.furniture) this.world.furniture.crushIn(b, inside);
    // Trees in its way are torn out and carried along
    const T = this.world.trees;
    if (T) {
      const hits = [];
      this.world.queryTrees(b.min.x, b.min.z, b.max.x, b.max.z, (t) => { if (!t.loose && (inside(t.A) || inside(t.C))) hits.push(t); });
      for (const t of hits) { b.pointVel(t.C, _d); T.uproot(t, _d.x, Math.max(1, _d.y), _d.z, 1.5); T.ignite(t); }
    }
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
        const d = meshChunk(g, cx * CHUNK, cy * CHUNK, cz * CHUNK, Math.min(g.nx, cx * CHUNK + CHUNK), Math.min(g.ny, cy * CHUNK + CHUNK), Math.min(g.nz, cz * CHUNK + CHUNK), this.M, s.off[1]);
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
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), cell = new Float32Array(nv * 4), col = new Float32Array(nv * 3), info = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let v = 0, k = 0;
    for (const d of s.chunks.values()) {
      if (!d) continue;
      pos.set(d.pos, v * 3); nor.set(d.nor, v * 3); uv.set(d.uv, v * 2); cell.set(d.cell, v * 4); col.set(d.col, v * 3); info.set(d.info, v * 3);
      for (let i = 0; i < d.idx.length; i++) idx[k++] = d.idx[i] + v;
      v += d.n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aCell', new THREE.BufferAttribute(cell, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    if (!s.faceMesh) {
      s.faceMesh = new THREE.Mesh(geo, s.faceMat);
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
const _st = {};

// Scratch for section analysis, grown as needed
let SX = new Float64Array(4096), SZ = new Float64Array(4096), SDX = new Float64Array(4096), SDZ = new Float64Array(4096), SACT = new Uint8Array(4096);

/**
 * Stresses in a level's section piece C (C.cells: plan cells carrying load across the level,
 * C.M the load above, C.mx / C.M, C.mz / C.M where it bears) as an elastic section: the load
 * squeezes it evenly and its offset from the section's centroid bends it, squeezing harder
 * on one side and pulling on the other. Pulled harder than sigT, that side cracks and lets go,
 * and what is left takes it all (a few rounds of that). Returns into out: smax, the peak
 * squeeze; smax0 and smin0 before cracking; cracked; the fall direction (fx, fz) from the
 * centroid toward where the load bears; front, how far past the load the section reaches that
 * way (not past it: beyond); depth, the section's extent that way; and lx, lz, the load point.
 */
function sectionStress(g, C, sigT, out) {
  const cells = C.cells, n = cells.length, nx = g.nx, P = C.M;
  if (SX.length < n) { const k = n * 2; SX = new Float64Array(k); SZ = new Float64Array(k); SDX = new Float64Array(k); SDZ = new Float64Array(k); SACT = new Uint8Array(k); }
  for (let k = 0; k < n; k++) {
    const c = cells[k], x = c % nx, z = (c - x) / nx;
    SX[k] = g.cx(x); SZ[k] = g.cz(z); SDX[k] = g.dx(x); SDZ[k] = g.dz(z); SACT[k] = 1;
  }
  const lx = C.mx / P, lz = C.mz / P;
  out.lx = lx; out.lz = lz; out.cracked = false;
  let smax = 0, ax0 = 0, az0 = 0;
  for (let it = 0; it < 4; it++) {
    let A = 0, Sx = 0, Sz = 0;
    for (let k = 0; k < n; k++) if (SACT[k]) { const w = SDX[k] * SDZ[k]; A += w; Sx += w * SX[k]; Sz += w * SZ[k]; }
    if (A <= 0) { smax = Infinity; break; }
    const ax = Sx / A, az = Sz / A;
    let Iuu = 0, Ivv = 0, Iuv = 0;
    for (let k = 0; k < n; k++) {
      if (!SACT[k]) continue;
      const w = SDX[k] * SDZ[k], u = SX[k] - ax, v = SZ[k] - az;
      Iuu += w * (u * u + SDX[k] * SDX[k] / 12); Ivv += w * (v * v + SDZ[k] * SDZ[k] / 12); Iuv += w * u * v;
    }
    const ex = lx - ax, ez = lz - az, det = Math.max(1e-12, Iuu * Ivv - Iuv * Iuv);
    // sigma = a + b u + c v balances the load and its moment about the centroid
    const a = P / A, b = (P * (ex * Ivv - ez * Iuv)) / det, cc = (P * (ez * Iuu - ex * Iuv)) / det;
    let hi = -Infinity, lo = Infinity;
    for (let k = 0; k < n; k++) {
      if (!SACT[k]) continue;
      const sg = a + b * (SX[k] - ax) + cc * (SZ[k] - az), h = 0.5 * (Math.abs(b) * SDX[k] + Math.abs(cc) * SDZ[k]);
      if (sg + h > hi) hi = sg + h;
      if (sg - h < lo) lo = sg - h;
    }
    smax = hi;
    if (it === 0) { out.smax0 = hi; out.smin0 = lo; ax0 = ax; az0 = az; }
    if (lo >= -sigT) break;
    // Cracked: the cells pulled on let go
    out.cracked = true;
    let left = 0;
    for (let k = 0; k < n; k++) if (SACT[k]) { if (a + b * (SX[k] - ax) + cc * (SZ[k] - az) < 0) SACT[k] = 0; else left++; }
    if (!left) { smax = Infinity; break; }
  }
  out.smax = smax;
  // Which way it goes, and how much section there is ahead of and behind the load that way
  const ex = lx - ax0, ez = lz - az0, e = Math.hypot(ex, ez);
  const fx = e > 1e-6 ? ex / e : 0, fz = e > 1e-6 ? ez / e : 0;
  let front = -Infinity, back = Infinity;
  for (let k = 0; k < n; k++) {
    const d = (SX[k] - lx) * fx + (SZ[k] - lz) * fz, h = 0.5 * (Math.abs(fx) * SDX[k] + Math.abs(fz) * SDZ[k]);
    if (d + h > front) front = d + h;
    if (d - h < back) back = d - h;
  }
  out.ax = ax0; out.az = az0; out.e = e; out.fx = fx; out.fz = fz;
  out.front = front; out.depth = front - back; out.beyond = e > 1e-6 && front <= 0;
  return out;
}

/**
 * A body grid's footprint in its own frame: every column with solid in it, the holes in its
 * plan filled (a hollow shaft covers its inside), grown by a cell; with the lowest solid in each
 * column (filled and grown ones take the lowest of the whole piece).
 */
function footprint(g) {
  const { nx, ny, nz, nxz, mat } = g, W = nx + 2, D = nz + 2;
  const on = new Uint8Array(W * D), low = new Float32Array(W * D).fill(Infinity);
  let lowest = Infinity;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      if (mat[x + nx * (z + nz * y)] >= SOLID) { const k = x + 1 + W * (z + 1); on[k] = 1; low[k] = g.ys[y]; if (g.ys[y] < lowest) lowest = g.ys[y]; break; }
    }
  }
  // Outside: flood from the border; what it doesn't reach is inside
  const out = new Uint8Array(W * D), q = [0];
  out[0] = 1;
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % W, z = (k - x) / W;
    for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, z > 0 ? k - W : -1, z < D - 1 ? k + W : -1]) if (j >= 0 && !out[j] && !on[j]) { out[j] = 1; q.push(j); }
  }
  const foot = new Uint8Array(W * D);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    let hit = false;
    for (let dz = -1; dz <= 1 && !hit; dz++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Z = z + dz;
      if (X >= 0 && Z >= 0 && X < W && Z < D && !out[X + W * Z]) { hit = true; break; }
    }
    const k = x + W * z;
    if (hit) { foot[k] = 1; if (low[k] === Infinity) low[k] = lowest; }
  }
  return { foot, low, W, xs: g.xs, zs: g.zs, nx, nz, cell: (g.xs[nx] - g.xs[0]) / nx };
}

/** Lowest solid of a footprint at local (x, z), or null outside it */
function footLow(F, x, z) {
  let i, j;
  if (x < F.xs[0]) i = x < F.xs[0] - F.cell ? -1 : 0; else if (x >= F.xs[F.nx]) i = x > F.xs[F.nx] + F.cell ? -1 : F.nx + 1; else i = lineIndexClamped(F.xs, x) + 1;
  if (z < F.zs[0]) j = z < F.zs[0] - F.cell ? -1 : 0; else if (z >= F.zs[F.nz]) j = z > F.zs[F.nz] + F.cell ? -1 : F.nz + 1; else j = lineIndexClamped(F.zs, z) + 1;
  if (i < 0 || j < 0) return null;
  const k = i + F.W * j;
  return F.foot[k] ? F.low[k] : null;
}

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

