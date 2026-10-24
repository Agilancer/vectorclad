import * as THREE from './three.js';
import { PANELS, ATLASES } from './cityTiles.js';
import { TREE_TILES } from './kitTiles.js';

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
// Every tree is one of a dozen species, each with its own bark and foliage
// from the bark-and-foliage sheets (textures/trees.jpg) and its own crown:
// round heads of leafy blobs (oak, maple, beech, linden), vase-shaped elms,
// slender birches and columnar poplars, tiered pines, spruces and firs,
// cedars, and redwoods twice the height of the rest. Trunks, stumps, leafy
// blobs and needled cones are four InstancedMeshes for the whole city, each
// instance pointing at its own tile of the atlas. World files the trees on
// its spatial grid so rays and blasts can find them.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const GRAVITY = 30;
const SUBSTEP = 1 / 120;
const MECH_R = 1.5, MECH_H = 7; // the mech's collision cylinder in main.js
// Tints over the textures as a tree burns: glowing ember, then char
const EMBER = [1.7, 0.55, 0.16], CHAR_LEAF = [0.16, 0.14, 0.13], CHAR_WOOD = [0.2, 0.15, 0.12];
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

/**
 * Species, in meters at scale 1. bark, leaf: sheets in TREE_TILES. crown: how the foliage is
 * built: round (a head of blobs), vase (blobs spreading toward the top), column (blobs stacked
 * tall and narrow), tiers (cones stacked up a tall trunk), cone (one or two tall cones).
 * trunk: height to the crown and radius at the foot; crown: radius and height; tint: the leaves'
 * color over the texture; barkTint: the trunk's (birch bark is the beech bark bleached).
 */
export const SPECIES = {
  oak:     { bark: 'oak', leaf: 'oak', crown: 'round', trunkH: 3.4, trunkR: 0.42, R: 3.4, H: 4.6, n: 6, tint: [0.95, 1, 0.9], leafRGB: [0.2, 0.3, 0.13] },
  maple:   { bark: 'maple', leaf: 'maple', crown: 'round', trunkH: 3.8, trunkR: 0.34, R: 3.0, H: 5.0, n: 5, tint: [1, 1, 0.92], leafRGB: [0.24, 0.36, 0.12] },
  elm:     { bark: 'elm', leaf: 'elm', crown: 'vase', trunkH: 4.6, trunkR: 0.36, R: 3.6, H: 4.6, n: 6, tint: [0.95, 1, 0.92], leafRGB: [0.2, 0.32, 0.14] },
  beech:   { bark: 'beech', leaf: 'beech', crown: 'round', trunkH: 4.0, trunkR: 0.34, R: 3.1, H: 5.2, n: 5, tint: [1, 1.02, 0.9], leafRGB: [0.26, 0.38, 0.13] },
  linden:  { bark: 'mossy', leaf: 'mosaic', crown: 'round', trunkH: 3.6, trunkR: 0.36, R: 2.8, H: 5.6, n: 5, tint: [1, 1, 0.92], leafRGB: [0.22, 0.34, 0.14] },
  birch:   { bark: 'beech', leaf: 'forest', crown: 'column', trunkH: 4.6, trunkR: 0.22, R: 2.0, H: 5.8, n: 4, tint: [1.08, 1.12, 0.92], barkTint: [1.75, 1.72, 1.62], leafRGB: [0.3, 0.42, 0.16] },
  poplar:  { bark: 'forest', leaf: 'mossy', crown: 'column', trunkH: 3.0, trunkR: 0.3, R: 1.9, H: 10, n: 5, tint: [0.95, 1, 0.9], leafRGB: [0.2, 0.32, 0.12] },
  pine:    { bark: 'pine', leaf: 'pine', crown: 'tiers', trunkH: 5.5, trunkR: 0.34, R: 2.8, H: 7.5, n: 4, tint: [0.9, 1, 0.92], leafRGB: [0.13, 0.24, 0.12] },
  spruce:  { bark: 'forest', leaf: 'pine', crown: 'tiers', trunkH: 2.2, trunkR: 0.32, R: 3.0, H: 11, n: 5, tint: [0.72, 0.85, 0.82], leafRGB: [0.1, 0.18, 0.12] },
  fir:     { bark: 'cedar', leaf: 'cedar', crown: 'tiers', trunkH: 2.6, trunkR: 0.3, R: 2.6, H: 10, n: 4, tint: [0.85, 0.95, 0.88], leafRGB: [0.12, 0.22, 0.12] },
  cedar:   { bark: 'cedar', leaf: 'cedar', crown: 'cone', trunkH: 2.4, trunkR: 0.36, R: 2.9, H: 9.5, n: 2, tint: [0.95, 1, 0.9], leafRGB: [0.15, 0.26, 0.12] },
  redwood: { bark: 'redwood', leaf: 'redwood', crown: 'tiers', trunkH: 11, trunkR: 0.62, R: 3.6, H: 10, n: 5, tint: [0.9, 1, 0.9], leafRGB: [0.14, 0.24, 0.12] },
};

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tile's rectangle in the tree atlas, as (u, v, w, h) */
function tileRect(name) {
  const p = PANELS[name], A = ATLASES[p[0]];
  return [p[1] / A.w, 1 - (p[2] + p[4]) / A.h, p[3] / A.w, p[4] / A.h];
}

/** A leafy blob: an icosphere with its surface knocked about, so it reads as a clump and not a ball */
function blobGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, v = new V3();
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(v.x * 7.1 + v.y * 3.7) * Math.cos(v.z * 6.3 - v.y * 2.9)) + 0.08 * Math.sin(v.x * 17 + v.z * 13);
      seen.set(key, k);
    }
    v.multiplyScalar(k);
    // Flatter underneath, as a crown is
    if (v.y < 0) v.y *= 0.72;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A needled cone: wide at its foot, its rim drooping in ragged points */
function coneGeometry() {
  const g = new THREE.ConeGeometry(1, 1, 14, 3, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x), k = 1 + 0.16 * Math.sin(a * 7) * (0.5 - y);
    p.setXYZ(i, x * k, y - (y < -0.45 ? 0.06 * (1 + Math.sin(a * 7)) : 0), z * k);
  }
  g.translate(0, 0.5, 0);
  g.computeVertexNormals();
  return g;
}

/**
 * The material for trunks and foliage: samples each instance's tile of the tree atlas (aTile),
 * mirrored at its edges so repeats show no seams. Bark wraps the trunk along its uv; foliage is
 * projected on the blob from three sides, so it needs no uv seam.
 */
function treeMaterial(tex, foliage) {
  const m = new THREE.MeshStandardMaterial({ roughness: foliage ? 0.85 : 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTrees = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTile;\nattribute vec2 aRep;\nvarying vec4 vTile;\nvarying vec2 vTUv;\nvarying vec3 vObj;\nvarying vec3 vObjN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = aTile; vTUv = uv * aRep; vObj = position * aRep.x; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uTrees;
        varying vec4 vTile;
        varying vec2 vTUv;
        varying vec3 vObj;
        varying vec3 vObjN;
        vec4 treeTile(vec2 t) {
          vec2 m = 1.0 - abs(1.0 - mod(t, 2.0));
          return textureGrad(uTrees, vTile.xy + m * vTile.zw, dFdx(t) * vTile.zw, dFdy(t) * vTile.zw);
        }`)
      .replace('#include <map_fragment>', foliage ? `
        vec3 tw = abs(normalize(vObjN)); tw = pow(tw, vec3(3.0)); tw /= tw.x + tw.y + tw.z;
        vec4 leafC = treeTile(vObj.zy) * tw.x + treeTile(vObj.xz) * tw.y + treeTile(vObj.xy) * tw.z;
        diffuseColor.rgb *= leafC.rgb * 1.15;` : `
        diffuseColor.rgb *= treeTile(vTUv).rgb * 1.1;`);
  };
  m.customProgramCacheKey = () => `tree-${foliage ? 1 : 0}`;
  return m;
}

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
    const tex = city.tex.trees;
    const barkMat = treeMaterial(tex, false), leafMat = treeMaterial(tex, true);
    // Every tree's shape first, to know how many blobs and cones the meshes need
    const shapes = spots.map((sp) => this.shape(sp));
    // Trees are drawn in chunks of the city, each its own meshes, so whole chunks are culled out
    // of view and out of the sun's shadow frustum, which only covers the ground near the mech
    const CH = city.m(480), chunks = new Map();
    spots.forEach((sp, i) => {
      const key = `${Math.floor(sp.x / CH)},${Math.floor(sp.z / CH)}`;
      let c = chunks.get(key);
      if (!c) chunks.set(key, (c = { trees: [], nBlob: 0, nCone: 0 }));
      c.trees.push(i);
      for (const b of shapes[i].blobs) { if (b.cone) c.nCone++; else c.nBlob++; }
    });
    const base = {
      trunk: (() => { const g = new THREE.CylinderGeometry(0.62, 1, 1, 9, 2, true); g.translate(0, 0.5, 0); return g; })(),
      stump: (() => { const g = new THREE.CylinderGeometry(0.85, 1, 1, 9, 1); g.translate(0, 0.5, 0); return g; })(),
      blob: blobGeometry(), cone: coneGeometry(),
    };
    const mk = (src, mat, count) => {
      // Each mesh has its own per-instance tiles, over the shared shape
      const geo = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) if (src.attributes[k]) geo.setAttribute(k, src.attributes[k]);
      geo.setIndex(src.index);
      const n = Math.max(1, count);
      geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      geo.setAttribute('aRep', new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2));
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.castShadow = m.receiveShadow = true;
      m.setColorAt(0, _col.setRGB(1, 1, 1));
      m.count = count;
      city.scene.add(m);
      return m;
    };
    this.chunks = [];
    const tch = new Array(n);
    for (const c of chunks.values()) {
      const ch = {
        trunk: mk(base.trunk, barkMat, c.trees.length), stump: mk(base.stump, barkMat, c.trees.length),
        leaf: mk(base.blob, leafMat, c.nBlob), cone: mk(base.cone, leafMat, c.nCone), nt: 0, nb: 0, nc: 0,
      };
      ch.stump.count = 0;
      this.chunks.push(ch);
      for (const i of c.trees) tch[i] = ch;
    }

    spots.forEach((sp, i) => {
      const S = shapes[i], u = S.u, ch = tch[i], ti = ch.nt++;
      for (const b of S.blobs) {
        b.mesh = b.cone ? ch.cone : ch.leaf;
        b.slot = b.cone ? ch.nc++ : ch.nb++;
        b.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.rx, b.ry, 0));
        const A = b.mesh.geometry.attributes, T = S.leafTiles[b.slot % S.leafTiles.length];
        A.aTile.setXYZW(b.slot, T[0], T[1], T[2], T[3]);
        A.aRep.setXY(b.slot, b.cone ? 2.2 : 1.6, b.cone ? 2.2 : 1.6);
      }
      const A = ch.trunk.geometry.attributes;
      A.aTile.setXYZW(ti, ...S.bark);
      // Bark wraps twice around, and repeats every 2 m up the trunk
      A.aRep.setXY(ti, 2, Math.max(1, S.trunkH / u / 2));
      const H = S.canopyY + S.canopyR;
      const t = {
        kind: 'tree', alive: true, i, u, species: sp.species, ch: tch[i], ti,
        base: new V3(sp.x, sp.y, sp.z),
        barkTint: S.barkTint, leafTint: S.leafTint, leafRGB: S.leafRGB, barkTile: S.bark,
        blobs: S.blobs,
        trunkR: S.trunkR, trunkH: S.trunkH, canopyY: S.canopyY, canopyR: S.canopyR,
        com: (S.trunkH * 0.5 + S.canopyY) * 0.5, // center of mass, above the base
        // Contact spheres: [height above the base, radius]
        spheres: [[0.35 * u, Math.max(0.35 * u, S.trunkR)], [S.trunkH * 0.6, Math.max(0.35 * u, S.trunkR)], [S.canopyY, S.canopyR]],
        // Inverse inertia (unit mass) across the trunk and about it
        iIp: 1 / (H * H / 7.5), iIa: 1 / (2.2 * u * u),
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
    for (const ch of this.chunks) {
      for (const m of [ch.trunk, ch.leaf, ch.cone]) {
        m.geometry.attributes.aTile.needsUpdate = true;
        m.geometry.attributes.aRep.needsUpdate = true;
        // Bounds with room for trees that roll away a little; the stumps share the trunks'
        m.computeBoundingSphere();
        m.boundingSphere.radius += city.m(60);
      }
      ch.stump.boundingSphere = ch.trunk.boundingSphere.clone();
    }
    this.flushMeshes(true);
  }

  /**
   * A tree's shape from its spot: { x, y, z, scale, species, seed }. Sizes in game units.
   * Blobs: { x, y, z (from the base), sx, sy, sz, rx, ry, cone }.
   */
  shape(sp) {
    const Sp = SPECIES[sp.species] || SPECIES.oak, r = seeded(sp.seed || 1), u = this.city.m(sp.scale || 1);
    const k = 0.85 + r() * 0.3, trunkH = Sp.trunkH * u * k, R = Sp.R * u * (0.85 + r() * 0.3), H = Sp.H * u * k;
    const blobs = [];
    const blob = (x, y, z, sx, sy, sz, cone = false) => blobs.push({ x, y, z, sx, sy, sz, rx: cone ? 0 : r() * 3, ry: r() * 6.28, cone });
    let cy = trunkH + H * 0.45, cr = Math.max(R, H * 0.5);
    if (Sp.crown === 'round' || Sp.crown === 'vase') {
      // A head of blobs: one big one in the middle, the rest around and above it
      const vase = Sp.crown === 'vase';
      blob(0, trunkH + H * 0.42, 0, R * 0.78, H * 0.42, R * 0.78);
      for (let i = 1; i < Sp.n; i++) {
        const a = (i / (Sp.n - 1)) * 6.28 + r() * 0.8, f = i % 2 ? 0.55 : 0.35;
        const d = R * (vase ? 0.62 : 0.5) * (0.8 + r() * 0.4), y = trunkH + H * (vase ? 0.55 + f * 0.4 : 0.3 + f * 0.6);
        const s = R * (0.5 + r() * 0.2);
        blob(Math.cos(a) * d, y, Math.sin(a) * d, s, s * 0.85, s);
      }
      cy = trunkH + H * 0.5; cr = Math.max(R, H * 0.55);
    } else if (Sp.crown === 'column') {
      for (let i = 0; i < Sp.n; i++) {
        const f = i / Math.max(1, Sp.n - 1), s = R * (1 - f * 0.45) * (0.85 + r() * 0.3);
        blob((r() - 0.5) * R * 0.3, trunkH + H * (0.15 + f * 0.72), (r() - 0.5) * R * 0.3, s, H / Sp.n * 0.95, s);
      }
      cy = trunkH + H * 0.5; cr = Math.max(R, H * 0.5);
    } else if (Sp.crown === 'tiers') {
      // Cones stacked up the trunk, each narrower than the one below, overlapping
      const n = Sp.n, step = H / (n + 0.6);
      for (let i = 0; i < n; i++) {
        const f = i / n, w = R * (1 - f * 0.78) * (0.92 + r() * 0.16);
        blob(0, trunkH + i * step - step * 0.2, 0, w, step * 1.9, w, true);
      }
      cy = trunkH + H * 0.42; cr = Math.max(R, H * 0.5);
    } else {
      // Cone: one tall cone, a second over its top
      blob(0, trunkH - H * 0.05, 0, R, H * 0.8, R, true);
      blob(0, trunkH + H * 0.5, 0, R * 0.55, H * 0.5, R * 0.55, true);
      cy = trunkH + H * 0.4; cr = Math.max(R, H * 0.5);
    }
    const T = TREE_TILES[Sp.bark] || TREE_TILES.oak, Lf = TREE_TILES[Sp.leaf] || TREE_TILES.oak;
    const barkName = T.bark[Math.floor(r() * T.bark.length)];
    // One or two of the sheet's leaf tiles per tree, so a crown isn't patched from every one of them
    const l0 = Lf.leaf[Math.floor(r() * Lf.leaf.length)], l1 = Lf.leaf[Math.floor(r() * Lf.leaf.length)];
    const g = 0.88 + r() * 0.2;
    return {
      u, trunkH, trunkR: Sp.trunkR * u * k, canopyY: cy, canopyR: cr, blobs,
      bark: tileRect(barkName), leafTiles: [tileRect(l0), tileRect(l1)],
      leafTint: Sp.tint.map((c) => c * g), barkTint: Sp.barkTint || [1, 1, 1], leafRGB: Sp.leafRGB,
    };
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
    const SM = t.ch.stump, si = SM.count++;
    _q.setFromAxisAngle(_a.set(0, 1, 0), Math.random() * 6.28);
    _m.compose(t.base, _q, _b.set(t.trunkR * 1.08, t.u * rand(0.35, 0.6), t.trunkR * 1.08));
    SM.setMatrixAt(si, _m);
    const k = 0.7, A = SM.geometry.attributes;
    SM.setColorAt(si, _col.setRGB(t.barkTint[0] * k, t.barkTint[1] * k, t.barkTint[2] * k));
    A.aTile.setXYZW(si, ...t.barkTile);
    A.aRep.setXY(si, 2, 0.5);
    A.aTile.needsUpdate = A.aRep.needsUpdate = true;
    t.ch.stumpsDirty = true;
    // Dirt from the roots, leaves shaken from the crown
    const fx = this.fx;
    fx.dust(t.base, 0.45, 6);
    const c = t.leafRGB;
    for (let i = 0; i < 10; i++) {
      const g = rand(0.65, 0.95);
      _a.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize().multiplyScalar(t.canopyR * rand(0.3, 0.9)).add(t.C);
      fx.smoke.emit(_a.x, _a.y, _a.z, vx * 0.3 + rand(-3, 3), rand(0, 3), vz * 0.3 + rand(-3, 3), rand(1.4, 2.4), 0.45, 0.3,
        c[0] * g, c[1] * g, c[2] * g, 0.95, c[0] * g, c[1] * g, c[2] * g, 0, 1.6, -5, rand(-4, 4));
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
      if (P && c.y + r > P.y && c.y - r < P.y + MECH_H) {
        let dx = c.x - P.x, dz = c.z - P.z;
        const d = Math.hypot(dx, dz), min = MECH_R + r;
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
      if (c.y + r <= P.y || c.y - r >= P.y + MECH_H) continue;
      if (Math.hypot(c.x - P.x, c.z - P.z) < MECH_R + r) return true;
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
        if (d > MECH_R + t.trunkR + t.canopyR * 0.5) return;
        if (P.y > t.base.y + t.canopyY + t.canopyR * 0.7 || P.y + MECH_H < t.base.y) return;
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
    // The trunk runs on up into the crown
    _m.compose(_b.set(0, 0, 0), ID_Q, _s.set(t.trunkR, t.trunkH + (t.canopyY - t.trunkH) * 0.9, t.trunkR));
    t.ch.trunk.setMatrixAt(t.ti, _m.premultiply(_w));
    // Leaves shrink in toward the middle of the crown as they burn away
    const L = t.leaf;
    for (const b of t.blobs) {
      _b.set(b.x * L, t.canopyY + (b.y - t.canopyY) * L, b.z * L);
      _m.compose(_b, b.q, _s.set(b.sx * L, b.sy * L, b.sz * L));
      b.mesh.setMatrixAt(b.slot, _m.premultiply(_w));
    }
    t.dirty = false;
    t.ch.matsDirty = true;
    if (!t.recolor) return;
    t.recolor = false;
    t.ch.colorsDirty = true;
    // Green to glowing ember to char, as the fire takes hold
    const f = t.char, e = Math.min(1, f / 0.4), c = Math.max(0, (f - 0.4) / 0.6), lt = t.leafTint;
    _col.setRGB(
      mix(mix(lt[0], EMBER[0], e), CHAR_LEAF[0], c),
      mix(mix(lt[1], EMBER[1], e), CHAR_LEAF[1], c),
      mix(mix(lt[2], EMBER[2], e), CHAR_LEAF[2], c));
    for (const b of t.blobs) b.mesh.setColorAt(b.slot, _col);
    const w = t.barkTint;
    t.ch.trunk.setColorAt(t.ti, _col.setRGB(mix(w[0], CHAR_WOOD[0], f), mix(w[1], CHAR_WOOD[1], f), mix(w[2], CHAR_WOOD[2], f)));
  }

  flushMeshes(all) {
    for (const ch of this.chunks) {
      const meshes = [ch.trunk, ch.leaf, ch.cone];
      if (ch.matsDirty || all) {
        for (const m of meshes) m.instanceMatrix.needsUpdate = true;
        ch.matsDirty = false;
      }
      if (ch.colorsDirty || all) {
        for (const m of meshes) m.instanceColor.needsUpdate = true;
        ch.colorsDirty = false;
      }
      if (ch.stumpsDirty) {
        ch.stump.instanceMatrix.needsUpdate = true;
        ch.stump.instanceColor.needsUpdate = true;
        ch.stumpsDirty = false;
      }
    }
  }
}
