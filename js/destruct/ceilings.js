import * as THREE from '../three.js';
import { CEILING } from '../ceilingTiles.js';
import { AIR, CONCRETE } from './grid.js';
import { MASK_FUNCS } from './skin.js';

// ---------------------------------------------------------------------------
// Ceilings: what a blown-open floor shows overhead, and the light it gives.
//
// Every building gets a theme from what it is clad in (glass towers modern
// flat panels and linear slots, prewar brick old louvered troffers, warm tubes
// and water-stained tiles, concrete blocks prismatic lenses...) and, from the
// theme, a house set of fixtures, tiles and diffusers. Each storey lays them
// out on the 0.6 m ceiling grid its own way: runs of floors share a tenant's
// layout, and every floor shifts, turns, spaces and mixes it a little, with a
// lobby under the lowest ceiling and now and then a vacant floor left dark.
// The layout is a table per grid layer (a float texture) the face shader
// decodes, so ceilings cost no geometry: tiles, T-bar grid, fixtures and vents
// are drawn per pixel from textures/ceiling.jpg.
//
// The fixtures light the rooms: floors, walls and columns under a ceiling add
// the light of the fixtures nearest them, and the tiles round a fixture glow.
// Power is per structure: big hits flicker the whole building and knock out
// the fixtures round them (they sputter, then die), fixtures whose ceiling is
// shot away go out, and a piece that breaks away loses its supply and goes
// dark, fixture by fixture.
// ---------------------------------------------------------------------------

const MOD_M = 0.6;   // ceiling module, meters
const N_OUT = 6;     // outages a structure remembers

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickOf = (r, a) => a[Math.floor(r() * a.length)];
const between = (r, a, b) => a + r() * (b - a);
const irange = (r, a, b) => a + Math.floor(r() * (b - a + 1));

// ---- themes ----------------------------------------------------------------------------

const has = (tags, t) => [...t].some((c) => tags.includes(c));
const SQUARE = CEILING.squareLights, LONG = CEILING.longLights;
/** Fixtures by tag test: square slot indices and long ones (as -1 - long slot) */
const lights = (ok) => ({ sq: SQUARE.filter((l) => ok(l.tags)).map((l) => l.i), long: LONG.filter((l) => ok(l.tags)).map((l) => -1 - l.i) });

const THEMES = {
  // Glass towers: flat LED panels and linear lights, fine tiles, slot diffusers, cool white
  modern: { lights: lights((t) => t.includes('m') && !t.includes('w')), tiles: ['fine', 'smooth'], sqVents: ['diffuser'], longVents: ['slot'], longFrac: [0.3, 0.8],
    continuous: 0.3, tint: [-0.3, -0.05], dead: [0, 0.012], faulty: 0.002, stain: 0, warmFloors: 0.08 },
  // Tech floors: perforated metal pans, long slots of light end to end
  tech: { lights: lights((t) => t.includes('m') && !t.includes('w')), tiles: ['perf'], sqVents: ['return'], longVents: ['slot', 'bar'], longFrac: [0.6, 0.95],
    continuous: 0.55, tint: [-0.4, -0.15], dead: [0, 0.01], faulty: 0.002, stain: 0, warmFloors: 0 },
  // Ordinary offices: louvered and basket troffers in speckled tile, square diffusers
  office: { lights: lights((t) => t.includes('c') && !t.includes('w')), tiles: ['speck', 'fine'], sqVents: ['diffuser', 'grille', 'return'], longVents: ['bar'], longFrac: [0.3, 0.7],
    continuous: 0.12, tint: [-0.12, 0.08], dead: [0.004, 0.03], faulty: 0.006, stain: 0.01, warmFloors: 0.1 },
  // Schools, clinics, agencies: prismatic lenses, grilles and returns
  institutional: { lights: lights((t) => t.includes('p')), tiles: ['speck'], sqVents: ['grille', 'return'], longVents: ['bar'], longFrac: [0.4, 0.9],
    continuous: 0.15, tint: [-0.05, 0.12], dead: [0.01, 0.045], faulty: 0.012, stain: 0.03, warmFloors: 0.05 },
  // Prewar walk-ups and lofts: old troffers, warm tubes, tired stained tiles
  prewar: { lights: lights((t) => t.includes('c') || t.includes('w')), tiles: ['speck'], sqVents: ['grille', 'diffuser'], longVents: ['bar'], longFrac: [0.4, 0.85],
    continuous: 0.1, tint: [0.25, 0.6], dead: [0.02, 0.08], faulty: 0.025, stain: 0.12, warmFloors: 0.3 },
};
const BY_CLADDING = {
  glass: [['modern', 0.45], ['tech', 0.25], ['office', 0.3]],
  masonry: [['prewar', 0.6], ['office', 0.25], ['institutional', 0.15]],
  plain: [['office', 0.45], ['institutional', 0.4], ['modern', 0.15]],
};

/** A building's theme and house set, from what its walls are made of */
export function houseStyle(owner) {
  const r = rng(0x9e3779b1 ^ (owner.id * 2654435761));
  const n = { glass: 0, masonry: 0, plain: 0 };
  for (const v of owner.vols) {
    const ms = v.sides ? Object.values(v.sides) : v.mat ? [v.mat] : [];
    for (const m of ms) {
      if (m === 'glass' || m === 'steel') n.glass++;
      else if (m === 'brick' || m === 'stone') n.masonry++;
      else if (m === 'concrete' || m === 'panel') n.plain++;
    }
  }
  const cls = n.glass >= n.masonry && n.glass >= n.plain && n.glass > 0 ? 'glass' : n.masonry >= n.plain && n.masonry > 0 ? 'masonry' : 'plain';
  let u = r(), name = BY_CLADDING[cls][0][0];
  for (const [k, w] of BY_CLADDING[cls]) { if ((u -= w) < 0) { name = k; break; } }
  const T = THEMES[name];
  const fam = pickOf(r, T.tiles), tiles = CEILING.tiles[fam];
  const stains = CEILING.tiles.stain;
  const sqv = T.sqVents.flatMap((k) => CEILING.squareVents[k] || []), lgv = T.longVents.flatMap((k) => CEILING.longVents[k] || []);
  const H = {
    name, T, r,
    // The house fixtures: one of each shape, and a couple of others some floors use
    sq: pickOf(r, T.lights.sq), long: pickOf(r, T.lights.long),
    alt: [pickOf(r, T.lights.sq), pickOf(r, T.lights.long), pickOf(r, T.lights.long)],
    longFrac: between(r, ...T.longFrac),
    tile: pickOf(r, tiles), tileAlt: pickOf(r, tiles), stain: T.stain * between(r, 0.3, 1.6), stainTile: pickOf(r, stains),
    sqVent: sqv.length ? pickOf(r, sqv) : -1, longVent: lgv.length ? pickOf(r, lgv) : -1,
    tint: between(r, ...T.tint), rot: r() < 0.5 ? 1 : 0,
  };
  return H;
}

// ---- per floor ------------------------------------------------------------------------

/**
 * The layout table of a root structure: for every grid layer, the layout of the storey whose
 * ceiling is the bottom of that layer's slab. 4 rows of RGBA floats, one texel per layer:
 *   0: fixture (square slot, or -1 - long slot), spacing along and across (modules), flags (1 turned, 2 staggered)
 *   1: grid offset along and across, main tile, second tile
 *   2: share of second tiles, vent (square slot, 1000 + long slot, -1 none), vent spacing along and across
 *   3: brightness (0: a dark floor), tint (warm +, cool -), share of dead fixtures, share of faulty ones
 */
export function floorTable(g, H) {
  const { ny, nxz, mat } = g;
  // Ceilings: layers with concrete over a room
  const ceil = [];
  for (let y = 1; y < ny; y++) {
    const a = y * nxz, b = a - nxz;
    let n = 0;
    for (let c = 0; c < nxz && n < 3; c++) if (mat[a + c] === CONCRETE && mat[b + c] === AIR) n++;
    if (n >= 3) ceil.push(y);
  }
  const data = new Float32Array(ny * 4 * 4);
  const r = H.r, T = H.T;
  let tenant = null, left = 0;
  const rows = [];
  ceil.forEach((y, k) => {
    // A tenant: a run of one to four floors on one layout
    if (left-- <= 0) {
      left = irange(r, 0, 3);
      const long = r() < H.longFrac;
      let light = long ? H.long : H.sq;
      const u = r();
      if (u < 0.25) light = long ? pickOf(r, H.alt.slice(1)) : H.alt[0];
      else if (u < 0.3) light = pickOf(r, long ? T.lights.long : T.lights.sq);
      const L = light < 0 ? CEILING.longLen[-1 - light] : 1;
      let Sa, Sb;
      if (L > 1) { Sa = r() < T.continuous ? L : L + irange(r, 1, 4); Sb = irange(r, 2, 5); }
      else { Sa = irange(r, 2, 5); Sb = r() < 0.6 ? Sa : irange(r, 2, 5); }
      tenant = { light, L, Sa, Sb, rot: r() < 0.7 ? H.rot : 1 - H.rot, stagger: L === 1 || Sa > L ? (r() < 0.25 ? 1 : 0) : 0 };
    }
    const t = Object.assign({}, tenant);
    // The lobby: square panels, bright, set wide
    if (k === 0 && ceil.length >= 3) { t.light = pickOf(r, T.lights.sq); t.L = 1; t.Sa = t.Sb = irange(r, 3, 4); t.stagger = 0; }
    // Every floor a little its own: shifted, the odd one turned or respaced
    if (r() < 0.15) t.rot = 1 - t.rot;
    if (r() < 0.2) t.Sb = Math.max(2, t.Sb + (r() < 0.5 ? -1 : 1));
    // A quarter of the fixtures: twice as far apart each way, or runs end to end four times as far apart
    if (t.L > 1 && t.Sa === t.L) t.Sb *= 4;
    else { t.Sa *= 2; t.Sb *= 2; }
    const offA = irange(r, 0, t.Sa - 1), offB = irange(r, 0, t.Sb - 1);
    const stain = r() < 0.5 ? H.stain : H.stain * 0.3;
    const alt = stain > 0.02 ? H.stainTile : H.tileAlt;
    const altFrac = stain > 0.02 ? stain : between(r, 0, 0.12);
    let vent = -1;
    const vr = r();
    if (vr < 0.45 && H.sqVent >= 0) vent = H.sqVent; else if (vr < 0.75 && H.longVent >= 0) vent = 1000 + H.longVent;
    const Va = t.Sa * (r() < 0.5 ? 2 : 1), Vb = t.Sb * 2;
    let bright = between(r, 0.85, 1.12) * (k === 0 ? 1.2 : 1);
    if (k > 0 && r() < 0.04) bright = 0; // vacant
    const tint = H.tint + between(r, -0.08, 0.08) + (r() < T.warmFloors ? 0.3 : 0);
    rows.push({ y, row: [t.light, t.Sa, t.Sb, t.rot + 2 * t.stagger, offA, offB, H.tile, alt, altFrac, vent, Va, Vb, bright, tint, between(r, ...T.dead), T.faulty * between(r, 0.3, 2)] });
  });
  // Each layer takes the storey of the nearest ceiling at or above it
  let j = 0;
  for (let y = 0; y < ny; y++) {
    while (j < rows.length - 1 && rows[j].y < y) j++;
    const R = rows.length ? rows[j].row : null;
    for (let q = 0; q < 4; q++) for (let c = 0; c < 4; c++) data[(q * ny + y) * 4 + c] = R ? R[q * 4 + c] : (q === 3 && c === 0 ? 0 : 1);
  }
  const tex = new THREE.DataTexture(data, ny, 4, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---- power ----------------------------------------------------------------------------

/** Power state of a structure: shader uniforms (U), and which outage slot goes next */
export function makePower(from = null) {
  const P = {
    U: {
      uPow: { value: new THREE.Vector4(-1, -99, 0, 1) }, // cut at, flicker from, flicker strength, supply
      uOut: { value: Array.from({ length: N_OUT }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uOutT: { value: new Array(N_OUT).fill(-99) },
    },
    next: 0,
  };
  if (from) {
    P.U.uPow.value.copy(from.U.uPow.value);
    from.U.uOut.value.forEach((v, i) => P.U.uOut.value[i].copy(v));
    P.U.uOutT.value = from.U.uOutT.value.slice();
    P.next = from.next;
  }
  return P;
}

/** Fixtures within r of p (local coordinates) sputter and die from time t */
export function outage(P, p, r, t) {
  // Grow an outage close by rather than spend a slot
  const O = P.U.uOut.value;
  for (let i = 0; i < N_OUT; i++) {
    const o = O[i];
    if (o.w > 0 && Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) + r < o.w * 1.15) return false;
  }
  const i = P.next;
  P.next = (P.next + 1) % N_OUT;
  O[i].set(p.x, p.y, p.z, r);
  P.U.uOutT.value[i] = t;
  return true;
}

/** The whole structure flickers from time t, strength k (stacks with a flicker under way) */
export function flicker(P, t, k) {
  const u = P.U.uPow.value, left = u.z * Math.exp(-(t - u.y) * 1.5);
  u.y = t; u.z = Math.min(1.4, Math.max(k, left + k * 0.5));
}

/** Its supply cut at time t: every fixture sputters out (a piece broken away) */
export function cutPower(P, t) {
  const u = P.U.uPow.value;
  if (u.x < 0) u.x = t;
}

// ---- shader -----------------------------------------------------------------------------

const C = CEILING;
const GLSL = /* glsl */`
${MASK_FUNCS}
uniform sampler2D uCeil;
uniform sampler2D uCeilGlow;
uniform highp sampler2D uFloors;
uniform float uFloorsW;
uniform float uMod;
uniform float uMeter;
uniform float uTime;
uniform vec2 uOrigin;
uniform vec4 uPow;
uniform vec4 uOut[${N_OUT}];
uniform float uOutT[${N_OUT}];
varying vec3 vLP;
varying vec3 vLN;
varying vec3 vInfo;
const float LONG_LEN[${C.longLen.length}] = float[${C.longLen.length}](${C.longLen.map((v) => v.toFixed(1)).join(',')});
const float A_SIZE = ${C.size.toFixed(1)};
const float A_SQ = ${C.sq.toFixed(1)};
const float A_GUT = ${C.gut.toFixed(1)};
const float A_SQCOLS = ${C.sqCols.toFixed(1)};
const float A_LONGW = ${C.longW.toFixed(1)};
const float A_LONGCOLS = ${C.longCols.toFixed(1)};
const float A_LONGY0 = ${C.longY0.toFixed(1)};
float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
bool isThin(float j) { ${C.longVents.slot.map((j) => `if (j == ${j.toFixed(1)}) return true;`).join(' ')} return false; }

struct CFloor { float light; float La; vec2 S; float rot; float stag; vec2 off; float tile; float tileAlt; float altFrac; float vent; vec2 V; float bright; float tint; float dead; float faulty; };
CFloor cFloor(float layer) {
  int x = int(clamp(layer, 0.0, uFloorsW - 1.0));
  vec4 a = texelFetch(uFloors, ivec2(x, 0), 0), b = texelFetch(uFloors, ivec2(x, 1), 0);
  vec4 c = texelFetch(uFloors, ivec2(x, 2), 0), d = texelFetch(uFloors, ivec2(x, 3), 0);
  CFloor F;
  F.light = a.x; F.La = a.x < 0.0 ? LONG_LEN[int(-1.0 - a.x)] : 1.0; F.S = max(a.yz, vec2(1.0));
  F.rot = mod(a.w, 2.0); F.stag = floor(a.w / 2.0);
  F.off = b.xy; F.tile = b.z; F.tileAlt = b.w;
  F.altFrac = c.x; F.vent = c.y; F.V = max(c.zw, vec2(1.0));
  F.bright = d.x; F.tint = d.y; F.dead = d.z; F.faulty = d.w;
  return F;
}
/** Module coordinates of a local point on a floor's grid (along, across) */
vec2 cModule(vec3 p, CFloor F) { vec2 q = (p.xz - uOrigin) / uMod; return F.rot > 0.5 ? q.yx : q; }
vec3 cLocal(vec2 m, CFloor F, float y) { vec2 q = F.rot > 0.5 ? m.yx : m; return vec3(uOrigin.x + q.x * uMod, y, uOrigin.y + q.y * uMod); }
/** The fixture lattice cell holding module point q: its id and the corner of its fixture */
vec2 cLattice(vec2 q, CFloor F, out vec2 base) {
  float row = floor((q.y - F.off.y) / F.S.y);
  float sh = F.stag * mod(row, 2.0) * floor(F.S.x * 0.5);
  float col = floor((q.x - F.off.x - sh) / F.S.x);
  base = vec2(col * F.S.x + F.off.x + sh, row * F.S.y + F.off.y);
  return vec2(col, row);
}
vec3 cTint(float t) { return t > 0.0 ? mix(vec3(1.0), vec3(1.0, 0.8, 0.56), min(t, 1.0)) : mix(vec3(1.0), vec3(0.8, 0.9, 1.0), min(-t, 1.0)); }
/** Atlas UV of local (u, v) in [0, 1] of a square slot, or a long one */
vec2 cSlot(float i, vec2 uv, bool isLong) {
  vec2 o, s;
  if (isLong) { float j = i; o = vec2(mod(j, A_LONGCOLS) * A_LONGW, A_LONGY0 + floor(j / A_LONGCOLS) * A_SQ); s = vec2(LONG_LEN[int(j)] * A_SQ, A_SQ); }
  else { o = vec2(mod(i, A_SQCOLS) * A_SQ, floor(i / A_SQCOLS) * A_SQ); s = vec2(A_SQ); }
  vec2 px = o + A_GUT + clamp(uv, 0.0, 1.0) * (s - 2.0 * A_GUT);
  return vec2(px.x, A_SIZE - px.y) / A_SIZE;
}
/** A fixture dying from time t0 after a delay: sputtering, then out */
float cDie(float t0, float delay, float n) {
  float a = uTime - t0;
  if (a >= delay) return 0.0;
  return a > delay - 0.45 || n < 0.35 ? step(0.45, n) : 1.0;
}
/** How lit the fixture of lattice cell id is, centered at local c */
float cPower(vec2 id, CFloor F, vec3 c, float layer) {
  float seed = layer * 0.731;
  float h = cHash(id + seed);
  if (h < F.dead || F.bright <= 0.0) return 0.0;
  float h2 = cHash(id.yx * 1.37 + seed + 3.1);
  float n = cHash(vec2(floor(uTime * 15.0 + h2 * 37.0), h2 * 53.0));
  float p = uPow.w;
  // A failing ballast
  if (h2 < F.faulty) p *= n < 0.3 ? 0.04 : n < 0.42 ? 0.5 : 1.0;
  // The whole building shaken: fixtures cut in and out, the supply dips
  float k = clamp(uPow.z * exp(-(uTime - uPow.y) * 1.5), 0.0, 1.0);
  if (k > 0.01) p *= (1.0 - 0.35 * k) * (n < 0.15 + 0.6 * k ? 0.05 : 1.0);
  for (int i = 0; i < ${N_OUT}; i++) {
    vec4 o = uOut[i];
    if (o.w <= 0.0) continue;
    vec3 d = c - o.xyz; d.y *= 1.7;
    float r = length(d) / o.w;
    if (r < 1.0) p *= cDie(uOutT[i], 0.05 + r * 0.5 + h * 0.6, n);
  }
  if (uPow.x >= 0.0) p *= cDie(uPow.x, 0.2 + h * 1.4, n);
  // Its own piece of ceiling shot away
  vec3 cc = vec3(dLut(c.x, 0), dLut(c.y + 0.1 * uMeter, 1), dLut(c.z, 2)) - uOff;
  if (dSolid(cc) < 0.5) return 0.0;
  return p * F.bright;
}
/**
 * Light from the four fixtures of ceiling layer nearest local p (normal n), in units of a
 * room's albedo, and how much the tiles round them glow (ceilings)
 */
vec3 cRoom(vec3 p, vec3 n, float layer, float ceilY, bool onCeil) {
  CFloor F = cFloor(layer);
  if (F.bright <= 0.0) return vec3(0.0);
  vec2 q = cModule(p, F);
  float area = F.La * ${(MOD_M * MOD_M).toFixed(3)};
  float r0 = floor((q.y - F.off.y - 0.5) / F.S.y);
  float E = 0.0, sum = 0.0;
  for (int a = 0; a < 2; a++) {
    float row = r0 + float(a);
    float sh = F.stag * mod(row, 2.0) * floor(F.S.x * 0.5);
    float c0 = floor((q.x - F.off.x - sh - F.La * 0.5) / F.S.x);
    for (int b = 0; b < 2; b++) {
      float col = c0 + float(b);
      vec2 m = vec2(col * F.S.x + F.off.x + sh + F.La * 0.5, row * F.S.y + F.off.y + 0.5);
      vec3 c = cLocal(m, F, ceilY);
      float pw = cPower(vec2(col, row), F, c, layer);
      if (pw <= 0.0) continue;
      sum += pw;
      vec3 L = (c - p) / uMeter;
      float d2 = dot(L, L), dl = sqrt(d2);
      vec3 dir = L / max(dl, 1e-3);
      if (onCeil) E += pw * area * 0.3 / (d2 * 6.0 + 0.3);
      else E += pw * area * max(dot(n, dir), 0.0) * max(dir.y, 0.0) * 5.0 / (d2 + 0.8);
    }
  }
  float amb = 0.045 * sum * clamp(6.0 * F.La / (F.S.x * F.S.y), 0.5, 1.5);
  return cTint(F.tint) * (E + amb);
}
`;

/**
 * The ceiling tile of module cell m on floor F, with its T-bar edges, at module-space point q
 * (gradients gx, gy for mipmaps): albedo into alb, light into em
 */
const SHADE = /* glsl */`
  vec3 cAlb = vec3(1.0), cEm = vec3(0.0);
  float kind = vInfo.x;
  if (kind > 0.5 && kind < 1.5) {
    CFloor F = cFloor(vInfo.y);
    vec2 q = cModule(vLP, F);
    vec2 gx = dFdx(q), gy = dFdy(q);
    vec2 base;
    vec2 id = cLattice(q, F, base);
    vec2 r = q - base;
    bool done = false;
    if (r.x < F.La && r.y < 1.0) {
      // A fixture
      bool isLong = F.light < 0.0;
      float slot = isLong ? -1.0 - F.light : F.light;
      vec2 uv = vec2(r.x / F.La, r.y);
      vec2 s = vec2(A_SQ / A_SIZE);
      vec2 auv = cSlot(slot, uv, isLong);
      vec2 tgx = gx * s * vec2(1.0, -1.0), tgy = gy * s * vec2(1.0, -1.0);
      vec3 tex = textureGrad(uCeil, auv, tgx, tgy).rgb;
      vec3 gl = textureGrad(uCeilGlow, auv, tgx, tgy).rgb;
      float gm = max(gl.r, max(gl.g, gl.b));
      vec3 c = cLocal(base + vec2(F.La * 0.5, 0.5), F, vLP.y);
      float pw = cPower(id, F, c, vInfo.y);
      // Switched off, a diffuser is a pale gray lens
      cAlb = mix(tex, vec3(dot(tex, vec3(0.33)) * 0.62), gm * 0.8);
      cEm = gl * cTint(F.tint) * pw * 1.5 + cAlb * pw * 0.12;
      done = true;
    }
    if (!done && F.vent >= 0.0) {
      // A diffuser or grille on its own lattice, between the fixtures
      bool isLong = F.vent >= 1000.0;
      float slot = isLong ? F.vent - 1000.0 : F.vent;
      float len = isLong ? LONG_LEN[int(slot)] : 1.0;
      vec2 vo = F.off + floor(F.S * 0.5) + vec2(F.La, 0.0);
      vec2 vr = q - vo - floor((q - vo) / F.V) * F.V;
      bool thin = isLong && isThin(slot);
      if (vr.x < len && vr.y < 1.0 && (!thin || abs(vr.y - 0.5) < 0.25)) {
        vec2 uv = vec2(vr.x / len, thin ? (vr.y - 0.25) * 2.0 : vr.y);
        vec2 s = vec2(A_SQ, A_SQ * (thin ? 2.0 : 1.0)) / A_SIZE;
        cAlb = textureGrad(uCeil, cSlot(slot, uv, isLong), gx * s * vec2(1.0, -1.0), gy * s * vec2(1.0, -1.0)).rgb;
        done = true;
      }
    }
    if (!done) {
      // A tile, turned any way, and the T-bar round it
      vec2 m = floor(q), f = fract(q);
      float h = cHash(m + vInfo.y * 0.37);
      float tile = h < F.altFrac ? F.tileAlt : F.tile;
      float k = floor(cHash(m.yx + 7.7) * 4.0);
      vec2 uv = f;
      mat2 R = mat2(1.0, 0.0, 0.0, 1.0);
      if (k == 1.0) { uv = vec2(1.0 - f.y, f.x); R = mat2(0.0, 1.0, -1.0, 0.0); }
      else if (k == 2.0) { uv = 1.0 - f; R = mat2(-1.0, 0.0, 0.0, -1.0); }
      else if (k == 3.0) { uv = vec2(f.y, 1.0 - f.x); R = mat2(0.0, -1.0, 1.0, 0.0); }
      vec2 s = vec2(A_SQ - 2.0 * A_GUT) / A_SIZE * vec2(1.0, -1.0);
      cAlb = textureGrad(uCeil, cSlot(tile, uv, false), (R * gx) * s, (R * gy) * s).rgb;
      float e = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
      float w = max(fwidth(q.x), fwidth(q.y));
      float bar = 1.0 - smoothstep(0.022, 0.022 + w * 1.5, e);
      float sh = (1.0 - smoothstep(0.03, 0.05 + w * 1.5, e)) * (1.0 - bar);
      cAlb = mix(cAlb * (1.0 - 0.35 * sh), vec3(0.8, 0.8, 0.78), bar);
    }
    cEm += cAlb * cRoom(vLP, vLN, vInfo.y, vLP.y, true);
  } else if (kind > 1.5 && vInfo.y >= 0.0) {
    cEm = cRoom(vLP, vLN, vInfo.y, vInfo.z, false);
  }
`;

/** Shared uniforms and textures of every structure's faces */
export const CEIL_SHARED = {
  uCeil: { value: null }, uCeilGlow: { value: null }, uTime: { value: 0 }, uMeter: { value: 1 }, uMod: { value: MOD_M },
};
/** Hand over the loaded atlas (main.js) */
export function setCeilingTextures(map, glow) {
  for (const t of [map, glow]) {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  CEIL_SHARED.uCeil.value = map;
  CEIL_SHARED.uCeilGlow.value = glow;
}
/** The game's scale: units per meter */
export function setCeilingScale(M) {
  CEIL_SHARED.uMeter.value = M;
  CEIL_SHARED.uMod.value = MOD_M * M;
}

/** Patch the faces shader: called from textures.js with the per-structure uniforms */
export function ceilingPatch(sh, U) {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aInfo;\nvarying vec3 vLP;\nvarying vec3 vLN;\nvarying vec3 vInfo;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal; vInfo = aInfo;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL}`);
  return SHADE;
}

/** The uniforms a structure's faces read */
export function ceilingUniforms(s) {
  return Object.assign({}, CEIL_SHARED, s.U, s.power.U, { uFloors: { value: s.floors }, uFloorsW: { value: s.floors.image.width }, uOrigin: { value: s.origin } });
}
