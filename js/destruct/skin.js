import * as THREE from '../three.js';
import { SOLID, GONE } from './grid.js';

// ---------------------------------------------------------------------------
// Skins: a structure keeps the triangles it was drawn with (facades, roofs,
// props, screens), lifted out of the city's merged meshes. A 3D mask texture,
// one texel per cell, says which cells are still there, and the skin shader
// drops every fragment whose cell is gone, so holes are cut to the pixel, with
// torn edges and scorch around them. Each vertex carries the point inside the
// solid it is backed by (aBack), so screens and decals vanish with the wall or
// roof behind them. Back faces draw dark: looking into a hole shows the
// building's shadowed inside.
// ---------------------------------------------------------------------------

/** The cell mask and its look-ups (the faces shader reads them too) */
export const MASK_FUNCS = /* glsl */`
uniform highp sampler3D uMask;
uniform highp sampler2D uLut;
uniform vec3 uLutMin;
uniform vec3 uLutScale;
uniform float uLutW;
uniform vec3 uOff;
uniform vec3 uDim;
float dLut(float p, int row) {
  float f = clamp((p - uLutMin[row]) * uLutScale[row], 0.0, uLutW - 1.001);
  int i = int(f);
  float a = texelFetch(uLut, ivec2(i, row), 0).r;
  float b = texelFetch(uLut, ivec2(i + 1, row), 0).r;
  return mix(a, b, f - float(i));
}
float dSolid(vec3 c) {
  if (any(lessThan(c, vec3(0.0))) || any(greaterThanEqual(c, uDim))) return 1.0;
  ivec3 i = ivec3(floor(c));
  return texelFetch(uMask, ivec3(i.x, i.z, i.y), 0).r;
}
float dHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
`;
const MASK_GLSL = /* glsl */`
varying vec3 vBack;
varying vec3 vObjN;
${MASK_FUNCS}`;

const MASK_MAIN = /* glsl */`
  vec3 dvb = vec3(dLut(vBack.x, 0), dLut(vBack.y, 1), dLut(vBack.z, 2)) - uOff;
  float dTorn = 0.0;
  if (dSolid(dvb) < 0.5) {
    // Torn edge: a jittered look-up still finds the neighbor standing, so cladding hangs into the hole
    vec3 dn = normalize(vObjN);
    vec3 dq = floor(dvb * 3.0);
    vec3 dj = vec3(dHash(dq), dHash(dq + 7.13), dHash(dq + 3.71)) - 0.5;
    dj -= dot(dj, dn) * dn;
    if (dSolid(dvb + dj * 1.15) < 0.5) discard;
    dTorn = 1.0;
  }
  float dScorch = texture(uMask, vec3(dvb.x, dvb.z, dvb.y) / vec3(uDim.x, uDim.z, uDim.y)).g;
`;

/** Patch a material's shader with the cell mask; U: the structure's shared uniform objects */
function maskPatch(sh, U, depth) {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aBack;\nvarying vec3 vBack;\nvarying vec3 vObjN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBack = aBack; vObjN = normal;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${MASK_GLSL}`)
    .replace('#include <clipping_planes_fragment>', `${MASK_MAIN}\n#include <clipping_planes_fragment>`);
  if (!depth) {
    // After the color chunk: the city's atlas shader replaces <map_fragment> itself
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      diffuseColor.rgb *= (1.0 - 0.82 * clamp(dScorch * 1.6, 0.0, 1.0)) * (1.0 - 0.5 * dTorn);
      if (!gl_FrontFacing) diffuseColor.rgb *= 0.2;`);
    // The inside of a wall gets no sky in its reflections either
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
      if (!gl_FrontFacing) { reflectedLight.indirectSpecular *= 0.05; reflectedLight.indirectDiffuse *= 0.45; }`);
  }
}

/** A masked copy of a city material for one structure */
export function skinMaterial(src, U) {
  const m = src.clone();
  const base = src.onBeforeCompile, key = src.customProgramCacheKey && src.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? src.customProgramCacheKey.bind(src) : null;
  m.onBeforeCompile = (sh, r) => { if (base) base.call(src, sh, r); maskPatch(sh, U, false); };
  m.customProgramCacheKey = () => `${key ? key() : src.type}|skin`;
  m.side = THREE.DoubleSide;
  return m;
}

/** Shadow-map material that leaves the same holes */
export function skinDepthMaterial(src, U) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const atlas = src && src.map && src.alphaTest > 0 ? src : null;
  if (atlas) { m.map = src.map; m.alphaTest = 0.5; }
  const base = atlas && src.userData.atlasShader;
  m.onBeforeCompile = (sh, r) => { if (base) base(sh, r); maskPatch(sh, U, true); };
  m.customProgramCacheKey = () => `skin-depth${base ? '-cut' : ''}`;
  m.side = THREE.DoubleSide;
  return m;
}

// ---- textures ---------------------------------------------------------------------

/** Lookup rows mapping a coordinate on each axis to a fractional cell index (for the shader) */
export function makeLut(g) {
  const L = [g.xs, g.ys, g.zs];
  const ext = L.map((l) => l[l.length - 1] - l[0]);
  const W = Math.min(4096, Math.max(64, Math.ceil(Math.max(...ext.map((e, a) => e / Math.max(1e-3, minGap(L[a]) * 0.25))))));
  const data = new Float32Array(W * 3);
  const scale = new THREE.Vector3(), min = new THREE.Vector3();
  for (let a = 0; a < 3; a++) {
    const l = L[a], lo = l[0], e = ext[a];
    min.setComponent(a, lo);
    scale.setComponent(a, (W - 1) / e);
    let i = 0;
    for (let k = 0; k < W; k++) {
      const p = lo + (k / (W - 1)) * e;
      while (i < l.length - 2 && l[i + 1] <= p) i++;
      data[a * W + k] = Math.min(l.length - 1, i + (p - l[i]) / (l[i + 1] - l[i]));
    }
  }
  const tex = new THREE.DataTexture(data, W, 3, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, min, scale, W };
}
function minGap(l) { let m = Infinity; for (let i = 1; i < l.length; i++) m = Math.min(m, l[i] - l[i - 1]); return m; }

/**
 * A 2-channel cell texture: R 255 where the cell has not been destroyed, G scorch. cut: for a
 * piece broken off a structure, the cells that stayed behind (GONE in its grid): it carries a
 * clip of the parent's skin, and what of that was backed by empty cells beside them, with
 * nothing solid of the piece's own next to them, must not show.
 */
export function makeMask(g, cut = null) {
  const data = new Uint8Array(g.N * 2);
  for (let i = 0; i < g.N; i++) data[i * 2] = g.mat[i] === GONE ? 0 : 255;
  if (cut) {
    const { nx, ny, nz, nxz, mat } = g;
    const solid = (j, x, y, z) => (x > 0 && mat[j - 1] >= SOLID) || (x < nx - 1 && mat[j + 1] >= SOLID) || (z > 0 && mat[j - nx] >= SOLID) || (z < nz - 1 && mat[j + nx] >= SOLID) || (y > 0 && mat[j - nxz] >= SOLID) || (y < ny - 1 && mat[j + nxz] >= SOLID);
    for (const i of cut) {
      const y = (i / nxz) | 0, r = i - y * nxz, z = (r / nx) | 0, x = r - z * nx;
      for (let k = 0; k < 6; k++) {
        const X = x + (k === 0 ? -1 : k === 1 ? 1 : 0), Z = z + (k === 2 ? -1 : k === 3 ? 1 : 0), Y = y + (k === 4 ? -1 : k === 5 ? 1 : 0);
        if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
        const j = X + nx * (Z + nz * Y);
        if (mat[j] < GONE && data[j * 2] && !solid(j, X, Y, Z)) data[j * 2] = 0;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, g.nx, g.nz, g.ny);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Upload cells [x0, x1) x [y0, y1) x [z0, z1) of a mask texture, or all of it if it isn't on the GPU yet */
export function uploadMask(renderer, tex, box) {
  const p = renderer && renderer.properties.get(tex);
  if (!p || !p.__webglTexture || p.__version !== tex.version || !box) { tex.needsUpdate = true; return; }
  const gl = renderer.getContext(), img = tex.image;
  const [x0, y0, z0, x1, y1, z1] = box;
  renderer.state.bindTexture(gl.TEXTURE_3D, p.__webglTexture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, img.width);
  gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, img.height);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, z0);
  gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, y0);
  gl.texSubImage3D(gl.TEXTURE_3D, 0, x0, z0, y0, x1 - x0, z1 - z0, y1 - y0, gl.RG, gl.UNSIGNED_BYTE, img.data);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
}

// ---- geometry ----------------------------------------------------------------------

const ATTRS = ['position', 'normal', 'color', 'uv', 'aCell', 'aMode'];

/**
 * Lift an owner's triangles out of the city meshes. Returns a list of skin parts
 * { src (material), attrs: { name: { a: Float32Array, size } }, count } with aBack computed
 * against the grid, and blanks the triangles in the city (they become degenerate).
 */
export function extractSkin(owner, g) {
  const byMat = new Map();
  for (const r of owner.ranges) {
    const mesh = r.mesh, geo = mesh.geometry, I = geo.index;
    let part = byMat.get(mesh.material);
    if (!part) {
      part = { src: mesh.material, key: mesh.userData.mat, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, data: {}, n: 0 };
      for (const name of ATTRS) if (geo.attributes[name]) part.data[name] = { size: geo.attributes[name].itemSize, v: [] };
      byMat.set(mesh.material, part);
    }
    for (let k = r.i0; k < r.i1; k++) {
      const vi = I.getX(k);
      for (const name in part.data) {
        const A = geo.attributes[name], D = part.data[name];
        for (let c = 0; c < D.size; c++) D.v.push(A.array[vi * D.size + c]);
      }
      part.n++;
    }
    // Blank them in the city mesh
    const arr = I.array, v0 = arr[r.i0];
    arr.fill(v0, r.i0, r.i1);
    I.addUpdateRange(r.i0, r.i1 - r.i0);
    I.needsUpdate = true;
  }
  const parts = [];
  for (const part of byMat.values()) {
    const attrs = {};
    for (const name in part.data) attrs[name] = { a: Float32Array.from(part.data[name].v), size: part.data[name].size };
    attrs.aBack = { a: backing(attrs.position.a, attrs.normal.a, g), size: 3 };
    parts.push({ src: part.src, key: part.key, castShadow: part.castShadow, receiveShadow: part.receiveShadow, attrs, count: part.n });
  }
  return parts;
}

/** For each vertex, a point just inside the solid it sits on: behind it, else below it */
function backing(P, Nrm, g) {
  const n = P.length / 3, out = new Float32Array(P.length);
  const h = Math.max(1e-3, Math.min(g.xs[1] - g.xs[0], g.ys[1] - g.ys[0], g.zs[1] - g.zs[0]));
  const solidAt = (x, y, z) => { const c = g.cellAt(x, y, z); return c >= 0 && g.mat[c] >= SOLID; };
  for (let i = 0; i < n; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2], nx = Nrm[i * 3], ny = Nrm[i * 3 + 1], nz = Nrm[i * 3 + 2];
    let bx = px - nx * h * 0.03, by = py - ny * h * 0.03, bz = pz - nz * h * 0.03, found = solidAt(bx, by, bz);
    for (let s = 1; !found && s <= 10; s++) {
      const d = h * (0.03 + s * 0.4);
      const qx = px - nx * d, qy = py - ny * d, qz = pz - nz * d;
      if (solidAt(qx, qy, qz)) { bx = qx; by = qy; bz = qz; found = true; }
    }
    for (let s = 1; !found && s <= 8; s++) {
      const qy = py - h * (0.03 + s * 0.4);
      if (solidAt(px, qy, pz)) { bx = px; by = qy; bz = pz; found = true; }
    }
    // Still nothing (a thin rail, a mast's arm): the nearest solid cell in any direction
    for (let r = 1; !found && r <= 4; r++) {
      for (let k = 0; k < 26 && !found; k++) {
        const dx = (k % 3) - 1, dy = (Math.floor(k / 3) % 3) - 1, dz = Math.floor(k / 9) - 1;
        if (!dx && !dy && !dz) continue;
        const qx = px + dx * h * 0.6 * r, qy = py + dy * h * 0.6 * r, qz = pz + dz * h * 0.6 * r;
        if (solidAt(qx, qy, qz)) { bx = qx; by = qy; bz = qz; found = true; }
      }
    }
    out[i * 3] = bx; out[i * 3 + 1] = by; out[i * 3 + 2] = bz;
  }
  return out;
}

/** BufferGeometry for a skin part (non-indexed triangles) */
export function partGeometry(part) {
  const geo = new THREE.BufferGeometry();
  for (const name in part.attrs) geo.setAttribute(name, new THREE.BufferAttribute(part.attrs[name].a, part.attrs[name].size));
  geo.computeBoundingSphere();
  return geo;
}

/** Keep the parts of a skin inside box [x0, y0, z0, x1, y1, z1], clipping triangles across it */
export function clipSkin(parts, box) {
  const out = [];
  for (const part of parts) {
    const names = Object.keys(part.attrs), sizes = names.map((k) => part.attrs[k].size), stride = sizes.reduce((a, b) => a + b, 0);
    const P = part.attrs.position.a, res = [];
    const vert = (i) => { const v = new Float32Array(stride); let o = 0; names.forEach((k, a) => { const s = sizes[a], A = part.attrs[k].a; for (let c = 0; c < s; c++) v[o++] = A[i * s + c]; }); return v; };
    const tris = part.count / 3;
    for (let t = 0; t < tris; t++) {
      const i = t * 3;
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      for (let k = 0; k < 3; k++) {
        const x = P[(i + k) * 3], y = P[(i + k) * 3 + 1], z = P[(i + k) * 3 + 2];
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
      if (mxx < box[0] || mnx > box[3] || mxy < box[1] || mny > box[4] || mxz < box[2] || mnz > box[5]) continue;
      let poly = [vert(i), vert(i + 1), vert(i + 2)];
      if (!(mnx >= box[0] && mxx <= box[3] && mny >= box[1] && mxy <= box[4] && mnz >= box[2] && mxz <= box[5])) {
        for (let a = 0; a < 3 && poly.length; a++) {
          poly = clipPoly(poly, a, box[a], 1);
          if (poly.length) poly = clipPoly(poly, a, box[a + 3], -1);
        }
        if (poly.length < 3) continue;
      }
      for (let k = 1; k < poly.length - 1; k++) res.push(poly[0], poly[k], poly[k + 1]);
    }
    if (!res.length) continue;
    const attrs = {};
    let o = 0;
    names.forEach((k, a) => {
      const s = sizes[a], A = new Float32Array(res.length * s);
      res.forEach((v, j) => { for (let c = 0; c < s; c++) A[j * s + c] = v[o + c]; });
      attrs[k] = { a: A, size: s };
      o += s;
    });
    out.push({ src: part.src, key: part.key, castShadow: part.castShadow, receiveShadow: part.receiveShadow, attrs, count: res.length });
  }
  return out;
}

/** Sutherland-Hodgman against the plane x[a] = c, keeping the side where (x[a] - c) * dir >= 0 */
function clipPoly(poly, a, c, dir) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const da = (A[a] - c) * dir, db = (B[a] - c) * dir;
    if (da >= 0) out.push(A);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db), v = new Float32Array(A.length);
      for (let k = 0; k < A.length; k++) v[k] = A[k] + (B[k] - A[k]) * t;
      out.push(v);
    }
  }
  return out;
}
