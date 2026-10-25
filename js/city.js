import * as THREE from './three.js';
import { ATLASES, TILES, PANELS, KITS, GROUND, PARTS, STRUCTS, OUTLINES } from './cityTiles.js';
import { KIT_MATS, ROOF_KITS } from './kitTiles.js';
import { canvasTexture } from './atlas.js';
import { BILLBOARDS } from './billboards.js';
import { Trees } from './trees.js';
import { Cars } from './cars.js';

// ---------------------------------------------------------------------------
// Port Meridian, built from the city texture sheets and the asset packs.
//
// A 15 x 15 grid of blocks at real proportions: 100 ft avenues, 60 ft cross
// streets, blocks long east-west, with a forest along the west side and
// residential streets of houses and row houses beside it. Everything is laid
// out in meters and scaled by M (game units per meter), which main.js derives
// from the mech's height so the mech stands 40 ft tall.
//
// Geometry is merged per material and per chunk. Every surface samples one of
// six texture atlases through a shader that tiles inside an atlas cell, so
// the whole city draws in a few dozen calls. Many facades are composed from
// panel kits: piers, runs of window bays and louvered vent floors cut from one
// family of materials (the skyN kits are the skyscraper facade sheets, the storeN
// kits the storefront sheets, whose entries make the ground floors' shop fronts).
// Streets and sidewalks draw on ground kits picked by how
// worn the pavement is in each part of town. An elevated railway, an elevated
// highway and two bridges are built from structure kits.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

const cellCache = new Map();
/** Where a tile sits in its atlas: corner (u, v) and size (w, h) in texture coordinates */
function cell(name) {
  let c = cellCache.get(name);
  if (c) return c;
  const p = PANELS[name] || PARTS[name];
  if (p) {
    // A facade, ground or structure panel: its own rectangle on its page of the atlas
    const A = ATLASES[p[0]];
    c = { atlas: p[0], u: p[1] / A.w, v: 1 - (p[2] + p[4]) / A.h, w: p[3] / A.w, h: p[4] / A.h, aspect: p[3] / p[4] };
  } else {
    const t = TILES[name];
    if (!t) throw new Error(`Unknown city tile ${name}`);
    const A = ATLASES[t[0]];
    const col = t[1] % A.cols, row = Math.floor(t[1] / A.cols);
    c = { atlas: t[0], u: (col * A.cell + A.pad) / A.w, v: 1 - (row * A.cell + A.pad + A.content) / A.h, w: A.content / A.w, h: A.content / A.h, aspect: t[2] };
  }
  cellCache.set(name, c);
  return c;
}

const range = (prefix, rows, cols) => rows.flatMap((r) => cols.map((c) => `${prefix}${r}${c}`));

// Tile groups, named from what is painted on them
const G = {
  officeGlass: ['office00', 'office02', 'office04', 'office10', 'office12', 'office13', 'office21', 'office24', 'office32', 'office34',
    'office40', 'office43', 'facade01', 'facade12', 'facade14', 'facade21', 'facade24', 'facade30', 'facade35', 'facade41'],
  officePanel: ['office11', 'office22', 'office44', 'office14', 'facade20'],
  officeStone: ['office01', 'office20', 'office33', 'office41'],
  mech: ['office03', 'office30', 'office42', 'facade03', 'facade32'],
  prewar: ['facade00', 'facade02', 'facade13', 'facade25', 'facade31', 'facade42', 'facade44', 'facade10', 'facade34', 'facade22', 'facade04'],
  modern: ['facade11', 'facade23', 'facade33', 'facade40'],
  walkupUpper: range('shop', [1, 4], [0, 1, 2, 3, 4, 5]),
  walkupBrick: ['facade04', 'facade10', 'facade22', 'facade34', 'facade44', 'facade02'],
  ground: range('shop', [0, 3], [0, 1, 2, 3, 4, 5]).concat(range('shop', [0], [0, 1, 2, 3, 4, 5])),
  doors: range('shop', [2], [0, 1, 2, 3, 4, 5]),
  brick: ['walls10', 'walls11', 'walls14', 'walls15', 'walls16', 'walls17', 'walls55'],
  stone: ['walls50', 'walls51', 'walls53', 'walls57', 'walls52'],
  panel: ['walls00', 'walls01', 'walls03', 'walls05', 'walls40', 'walls46', 'walls70', 'walls71', 'walls77'],
  roof: ['roof00', 'roof01', 'roof02', 'roof03', 'roof04', 'roof05', 'roof44', 'roof45', 'roof53'],
  roofMetal: ['roof40', 'roof42'],
  // Roof sheets (assets/rooftop-textures): flat coverings, and pitched ones for houses
  roofFlat: ['rf01', 'rf02', 'rf07', 'rf08', 'rf09', 'rf10', 'rf13', 'rf14', 'rf15', 'rf18', 'rf20', 'rf11'].flatMap((k) => ROOF_KITS[k].cover),
  roofPitched: ['rf05', 'rf06', 'rf17', 'rf19', 'rf16', 'rf04', 'rf03'].flatMap((k) => ROOF_KITS[k].cover),
  ac: ['roof20', 'roof21', 'roof22'],
  skylight: ['roof13', 'roof14', 'roof15'],
  slab: ['paveB00', 'paveB01', 'paveB03', 'paveB30', 'paveB33', 'paveA00', 'paveA02', 'paveA03', 'paveA05', 'paveB25'],
  plaza: ['paveB32', 'paveB04', 'paveB11', 'paveB13', 'paveB15', 'paveA13', 'paveA22', 'paveB23'],
  grass: ['grass00', 'grass01', 'grass02', 'grass03', 'grass11', 'grass14', 'grass15', 'grass23', 'grass34', 'grass35', 'grass40', 'planter00', 'planter02', 'planter22'],
  manholeRound: ['street20', 'street21', 'street22', 'street26'],
  manholeSquare: ['street23', 'street24', 'street25'],
};
const pick = (r, a) => a[Math.floor(r() * a.length)];
// Species along the streets and in the parks (trees.js has them all)
const STREET_TREES = ['oak', 'maple', 'elm', 'beech', 'oak', 'maple', 'linden', 'birch', 'elm', 'pine'];

// Panel kits that suit each kind of building (repeats weight the pick)
// The skyN kits are the skyscraper facade sheets (assets/skyscraper-facades), the storeN kits the
// storefront sheets (assets/street-level-storefronts): their upper-floor windows suit walk-ups.
const STORE_KITS = Array.from({ length: 20 }, (_, i) => `store${String(i + 1).padStart(2, '0')}`);
const KIT_STYLE = {
  walkup: ['brick', 'limestone', 'masonry', 'sandstone', 'travertine', 'ivory', 'sky05', 'sky02', 'sky12', 'sky17', ...STORE_KITS],
  prewar: ['brick', 'limestone', 'limestone', 'precast', 'concrete', 'masonry', 'travertine', 'ivory', 'sandstone', 'sky02', 'sky05', 'sky12', 'sky20', 'sky16', 'sky09'],
  modern: ['precast', 'concrete', 'aluminum', 'teal', 'swatches', 'seaglass', 'silver', 'azure', 'travertine', 'masonry', 'sandstone',
    'sky03', 'sky06', 'sky08', 'sky11', 'sky16', 'sky17', 'sky18'],
  office: ['steel', 'graphite', 'navy', 'teal', 'aluminum', 'swatches', 'slate', 'indigo', 'silver', 'basalt', 'azure', 'seaglass',
    'sky01', 'sky04', 'sky07', 'sky09', 'sky10', 'sky13', 'sky14', 'sky18', 'sky19', 'sky03', 'sky08'],
  tower: ['steel', 'graphite', 'navy', 'teal', 'aluminum', 'slate', 'indigo', 'silver', 'basalt', 'azure',
    'sky01', 'sky04', 'sky07', 'sky09', 'sky10', 'sky13', 'sky14', 'sky15', 'sky19', 'sky01', 'sky04', 'sky13'],
  deco: ['limestone', 'limestone', 'brick', 'ivory', 'travertine', 'sandstone', 'sky02', 'sky02', 'sky12', 'sky20', 'sky20', 'sky15', 'sky09'],
  far: ['steel', 'graphite', 'navy', 'teal', 'aluminum', 'precast', 'concrete', 'swatches', 'slate', 'indigo', 'silver', 'basalt', 'azure', 'seaglass', 'ivory', 'travertine',
    'sky01', 'sky03', 'sky04', 'sky07', 'sky09', 'sky13', 'sky14', 'sky18', 'sky19'],
  // Houses and row houses in the residential streets
  house: ['brick', 'masonry', 'sandstone', 'ivory', 'sky05', 'sky03', 'sky11', 'sky17', 'sky12', ...STORE_KITS],
  row: ['brick', 'masonry', 'limestone', 'sandstone', 'sky05', 'sky02', 'sky12', 'sky17', 'sky20', ...STORE_KITS],
};

// What a facade is built of, for destruction: glass curtain walls shatter, masonry crumbles
const GLASS_KITS = new Set(['steel', 'graphite', 'navy', 'teal', 'aluminum', 'swatches', 'slate', 'indigo', 'silver', 'basalt', 'azure', 'seaglass']);
const STONE_KITS = new Set(['limestone', 'masonry', 'travertine', 'ivory', 'sandstone']);
function wallMat(tile, F) {
  if (F) return KIT_MATS[F.kit] || (GLASS_KITS.has(F.kit) ? 'glass' : F.kit === 'brick' ? 'brick' : STONE_KITS.has(F.kit) ? 'stone' : 'panel');
  if (!tile) return 'panel';
  // A kit's tiles: its windows are what it is built of; its solid wall, piers and louvers are
  // panels, even on a glass tower
  const kit = KIT_MATS[tile.split('_')[0]];
  if (kit) return kit === 'glass' && !/_[01]\d$/.test(tile) ? 'panel' : kit;
  if (G.officeGlass.includes(tile) || G.officePanel.includes(tile) || G.modern.includes(tile) || G.mech.includes(tile) || tile === 'facade12') return 'glass';
  if (tile.startsWith('walls1')) return 'brick';
  if (tile.startsWith('shop') || tile.startsWith('walls5') || G.prewar.includes(tile) || G.officeStone.includes(tile)) return 'stone';
  return 'panel';
}

// Road asphalt for clean, worn and broken streets: plain enough to repeat without a pattern
// showing, with no painted lines, and close in tone so neighboring roads meet quietly
const ASPHALT = [
  ['asphB00', 'asphalt00', 'asphalt14', 'tactile0', 'buslane4', 'buslane73'],
  ['cobble41', 'fresh3', 'asphB33', 'asphalt10'],
  ['asphB01', 'asphalt04', 'asphalt10', 'fresh3'],
];

// Ground kits for clean, worn and broken pavement
const GROUND_WEAR = [
  ['crisp', 'fresh', 'buslane', 'tactile', 'redcurb'],
  ['faded', 'grime', 'cobble', 'hazard', 'tactile', 'redcurb'],
  ['ruin', 'grime', 'hazard', 'faded'],
];

// Billboards are 16:9, like the ads in assets/billboards
const AD_ASPECT = 9 / 16;

/** The helipad marking: a yellow ring around a white H on dark concrete */
function helipadTexture() {
  return canvasTexture(256, (g) => {
    g.fillStyle = '#2c2e31'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#f2c230'; g.lineWidth = 9;
    g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#eceae4';
    g.fillRect(84, 66, 22, 124); g.fillRect(150, 66, 22, 124); g.fillRect(84, 117, 88, 22);
  });
}

// World size of one repeat of a tile, in meters: [width, height]
function tileMeters(name) {
  if (PANELS[name]) return [PANELS[name][5], PANELS[name][6]];
  if (name.startsWith('office')) return [12, 12];
  if (name.startsWith('facade')) return [7.2, 7.2];
  if (name.startsWith('shop')) {
    const row = +name[4], h = row === 1 || row === 4 ? 3.3 : 4.5;
    return [h * cell(name).aspect, h];
  }
  if (name.startsWith('walls1')) return [2.4, 2.4];
  if (name.startsWith('walls5')) return [2.8, 2.8];
  if (name.startsWith('walls')) return [3.2, 3.2];
  if (name.startsWith('roof')) return [6, 6];
  return [4, 4];
}

// ---------------------------------------------------------------------------
// Materials: atlas sampling with fract() inside a cell and textureGrad() so
// mip selection stays continuous across tile repeats. Each vertex carries its
// cell's rectangle, so cells can be any size.
//   aMode 0: opaque   1: paint keyed off the asphalt   2: round cut-out
// Structure cards (trusses, railings) use the alpha in the atlas: o.cut.
// ---------------------------------------------------------------------------

/** Sample the atlas cell in a shader; shared by the surface and shadow materials */
function atlasShader(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 aCell;\nattribute float aMode;\nvarying vec4 vCell;\nvarying vec2 vTUv;\nvarying float vMode;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = aCell; vTUv = uv; vMode = aMode;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec4 vCell;\nvarying vec2 vTUv;\nvarying float vMode;')
    .replace('#include <map_fragment>', /* glsl */`
      // Mode 3 mirrors the tile at every edge, so tiles whose edges don't match show no seam
      vec2 tuv = vMode > 2.5 ? 1.0 - abs(1.0 - mod(vTUv, 2.0)) : fract(vTUv);
      vec4 sampledDiffuseColor = textureGrad(map, vCell.xy + tuv * vCell.zw, dFdx(vTUv) * vCell.zw, dFdy(vTUv) * vCell.zw);
      float atlasLum = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float atlasAlpha = 1.0;
      if (vMode > 0.5 && vMode < 1.5) atlasAlpha = smoothstep(0.075, 0.16, atlasLum);
      else if (vMode > 1.5 && vMode < 2.5) atlasAlpha = 1.0 - smoothstep(0.42, 0.47, length(tuv - 0.5));
      diffuseColor *= sampledDiffuseColor;
      diffuseColor.a *= atlasAlpha;`);
}

function atlasMaterial(tex, o = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex, vertexColors: true, roughness: o.roughness ?? 0.85, metalness: o.metalness ?? 0,
    alphaTest: o.decal || o.cut ? 0.5 : 0, polygonOffset: !!o.decal, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    side: o.cut ? THREE.DoubleSide : THREE.FrontSide, alphaToCoverage: !!o.cut,
  });
  m.onBeforeCompile = (sh) => {
    atlasShader(sh);
    if (o.glass) {
      // Dark texels are window glass: make them glossy so they pick up the sky
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat glassAmt = smoothstep(0.06, 0.015, atlasLum);\nroughnessFactor = mix(roughnessFactor, 0.1, glassAmt);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.65, glassAmt);');
    }
  };
  m.customProgramCacheKey = () => `atlas-${o.decal ? 1 : 0}-${o.glass ? 1 : 0}-${o.cut ? 1 : 0}`;
  m.userData.atlasShader = atlasShader; // for masked shadow materials (js/destruct/skin.js)
  return m;
}

/** Shadows for structure cards, so trusses and railings cast their holes */
function atlasDepthMaterial(tex) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
  m.onBeforeCompile = atlasShader;
  m.customProgramCacheKey = () => 'atlas-depth';
  return m;
}

// ---------------------------------------------------------------------------
// Geometry buffers
// ---------------------------------------------------------------------------

class Buf {
  constructor(textured) {
    this.t = textured;
    this.pos = []; this.nor = []; this.col = []; this.uv = []; this.cell = []; this.mode = []; this.idx = [];
    this.n = 0;
  }
  v(x, y, z, nx, ny, nz, r, g, b, u, v, c, mode) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(r, g, b);
    if (this.t) { this.uv.push(u, v); this.cell.push(c.u, c.v, c.w, c.h); this.mode.push(mode); }
    return this.n++;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.t) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('aCell', new THREE.Float32BufferAttribute(this.cell, 4));
      g.setAttribute('aMode', new THREE.Float32BufferAttribute(this.mode, 1));
    }
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const _a = new V3(), _b = new V3(), _c = new V3(), _n = new V3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3();
const WHITE = [1, 1, 1];

// Unit shapes for props, appended with a transform
const SHAPES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
  pole: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true),
  tube: new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
  ring6: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
  cone: new THREE.ConeGeometry(1, 1, 10, 1),
  cone4: new THREE.ConeGeometry(1, 1, 4, 1),
  ico: new THREE.IcosahedronGeometry(1, 0),
  sphere: new THREE.SphereGeometry(1, 10, 6),
  torus: new THREE.TorusGeometry(1, 0.07, 6, 40),
};

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

export class City {
  constructor({ scene, tex, M, fx, sound }) {
    this.scene = scene;
    this.M = M;
    this.fx = fx;
    this.sound = sound;
    this.r = mulberry(1916);
    this.rg = mulberry(1958); // ground textures, apart from the layout so neither shifts the other
    this.colliders = [];
    this.steam = [];
    this.fountains = [];
    this.signs = { screen: { pos: [], nor: [], uv: [], idx: [] }, mark: { pos: [], nor: [], uv: [], idx: [] } };
    this.rd = mulberry(1988); // decorations: screens and kiosks, apart from the layout
    this.ra = mulberry(2061); // the order the billboard ads go up in, apart from the decorations
    this.ads = []; // the billboard ads still to go up this round: every one is up before any repeats
    this.cars = [];
    this.pending = [];
    this.burning = [];
    this.treeSpots = [];
    this.treeBlocks = []; // low props trees land and roll on but the mech walks through (planters, fountain)
    this.bufs = new Map();
    this.meshes = [];
    // Destruction: every building and prop is an owner that records its triangles, colliders and
    // the volumes it is built from, so js/destruct can turn it into voxels when it is first hit
    this.owners = [];
    this.owner = null;
    this.ownerDepth = 0;
    this.rw = mulberry(2027); // water towers, apart from the layout so it doesn't shift
    this.mats = {
      facade: atlasMaterial(tex.facade, { roughness: 0.75, glass: true }),
      surface: atlasMaterial(tex.surface, { roughness: 0.85 }),
      ground: atlasMaterial(tex.ground, { roughness: 0.92 }),
      decal: atlasMaterial(tex.ground, { roughness: 0.6, decal: true }),
      props: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.15 }),
    };
    // One material per page of the panel atlas, a surface and a decal material per page of the
    // road atlas, and a solid and a see-through card material per page of the structure atlas
    this.depthMats = {};
    for (const k of Object.keys(ATLASES)) {
      if (k.startsWith('panels')) this.mats[k] = atlasMaterial(tex[k], { roughness: 0.75, glass: true });
      if (k.startsWith('roofs')) this.mats[k] = atlasMaterial(tex[k], { roughness: 0.85 });
      if (k.startsWith('roads')) {
        this.mats[k] = atlasMaterial(tex[k], { roughness: 0.92 });
        this.mats[`${k}Decal`] = atlasMaterial(tex[k], { roughness: 0.6, decal: true });
      }
      if (k.startsWith('structs')) {
        this.mats[k] = atlasMaterial(tex[k], { roughness: 0.8, metalness: 0.1 });
        this.mats[`${k}Cut`] = atlasMaterial(tex[k], { roughness: 0.7, metalness: 0.2, cut: true });
        this.depthMats[`${k}Cut`] = atlasDepthMaterial(tex[k]);
      }
    }
    this.rs = mulberry(2001); // structures, apart from the layout so neither shifts the other
    this.rf = mulberry(1864); // the forest
    this.tex = tex;
    this.layout();
    this.buildGround();
    this.buildBlocks();
    this.buildForest();
    this.buildFurniture();
    this.buildEl();
    this.buildHighway();
    this.buildWaterfront();
    this.buildScenery();
    this.flush();
    this.flushSigns();
    this.buildCars();
    this.trees = new Trees(this, this.treeSpots, this.treeBlocks);
  }

  /** Meters to game units */
  m(x) { return x * this.M; }

  // ---- layout --------------------------------------------------------------

  layout() {
    const m = (x) => this.m(x);
    const L = (this.L = {
      blockW: m(120), blockD: m(64), aveW: m(28), aveWalk: m(5), stW: m(28), stWalk: m(4), curb: m(0.2),
      prom: m(32), water: -m(3), forest: m(190),
    });
    const NX = 15, NZ = 15, NORTH = 2; // two extra rows of blocks north continue the city past the barrier
    const TW = NX * L.blockW + (NX + 1) * L.aveW, TD = NZ * L.blockD + (NZ + 1) * L.stW;
    L.x0 = -TW / 2; L.x1 = TW / 2; L.z0 = -TD / 2; L.z1 = TD / 2;
    L.zN = L.z0 - NORTH * (L.blockD + L.stW); // north end of the filler rows
    L.wx = L.x0 - L.forest; // west edge of the land: a forest runs between the city and the west esplanade
    L.aves = [];
    for (let i = 0; i <= NX; i++) {
      const a = L.x0 + i * (L.blockW + L.aveW);
      L.aves.push({ x0: a, x1: a + L.aveW, r0: a + L.aveWalk, r1: a + L.aveW - L.aveWalk, dir: i % 2 ? 1 : -1 });
    }
    L.sts = [];
    for (let k = -NORTH; k <= NZ; k++) {
      const a = L.z0 + k * (L.blockD + L.stW);
      L.sts.push({ k, z0: a, z1: a + L.stW, r0: a + L.stWalk, r1: a + L.stW - L.stWalk, dir: k % 2 ? 1 : -1 });
    }
    L.st = (k) => L.sts[k + NORTH];
    L.blocks = [];
    for (let k = -NORTH; k < NZ; k++) {
      for (let j = 0; j < NX; j++) {
        L.blocks.push({ j, k, x0: L.aves[j].x1, x1: L.aves[j + 1].x0, z0: L.st(k).z1, z1: L.st(k + 1).z0, playable: k >= 0 });
      }
    }
    // Playable area: the city plus the waterfront on three sides, closed off to the north
    this.bounds = { minX: L.wx - L.prom + m(2), maxX: L.x1 + L.prom - m(2), minZ: L.z0 + m(2), maxZ: L.z1 + L.prom - m(2) };
  }

  // ---- buffers -------------------------------------------------------------

  buf(mat, chunk = 'all') {
    const key = `${mat}|${chunk}`;
    let b = this.bufs.get(key);
    if (!b) { b = new Buf(mat !== 'props'); b.mat = mat; this.bufs.set(key, b); }
    // An owner's triangles are one unbroken run in each buffer it draws into
    if (this.owner && !this.owner.bufs.has(b)) this.owner.bufs.set(b, b.idx.length);
    return b;
  }

  // ---- owners (destructible pieces) ------------------------------------------

  /** Start recording a destructible owner; nested calls fold into the outer one */
  beginOwner(kind) {
    if (this.noOwners) return;
    if (this.owner) { this.ownerDepth++; return; }
    this.owner = { id: this.owners.length, kind, vols: [], bufs: new Map(), signs: { screen: this.signs.screen.idx.length, mark: this.signs.mark.idx.length }, colliders: [] };
    this.ownerDepth = 1;
  }

  endOwner() {
    if (this.noOwners || --this.ownerDepth > 0) return;
    const o = this.owner;
    this.owner = null;
    o.ranges = [...o.bufs].map(([b, i0]) => ({ b, i0, i1: b.idx.length })).filter((r) => r.i1 > r.i0);
    o.signRanges = Object.entries(o.signs).map(([k, i0]) => ({ kind: k, i0, i1: this.signs[k].idx.length })).filter((r) => r.i1 > r.i0);
    delete o.bufs; delete o.signs;
    if (o.vols.length) this.owners.push(o);
    else o.id = -1;
  }

  /** Record a volume the current owner is built from (in game units); see js/destruct/voxelize.js */
  vol(v) { if (this.owner) this.owner.vols.push(v); }

  /** Floor levels from y0 (or the top of a ground band) up to y1, every floor of a tile th tall */
  floorsFor(y0, y1, thm) {
    const fh = this.m(thm <= 5.5 ? Math.max(3, thm) : thm / Math.max(1, Math.round(thm / 4))), out = [];
    for (let y = y0; y < y1 - fh * 0.6; y += fh) out.push(y);
    return out;
  }

  /** The current chunk's buffer for the atlas a wall tile lives in; cut: its see-through card material */
  bufFor(tile, cut = false) { return this.buf(cell(tile).atlas + (cut ? 'Cut' : ''), this.cur); }

  /** The surface (or decal) buffer for the atlas a ground tile lives in */
  groundBuf(tile, decal = false, chunk = 'all') {
    const a = cell(tile).atlas;
    if (a === 'ground') return this.buf(decal ? 'decal' : 'ground', chunk);
    return this.buf(decal ? `${a}Decal` : a, chunk);
  }

  /**
   * A ground tile for a role ('asphalt', 'walk', 'lane', ...) at x, z, from a kit suited to
   * how worn the pavement is there. old: the original tiles, mixed into clean streets.
   */
  groundTile(role, x, z, old) {
    const rg = this.rg, w = this.wear(x, z), band = w < 0.4 ? 0 : w < 0.7 ? 1 : 2;
    if (old && band === 0 && rg() < 0.35) return pick(rg, old);
    const kits = GROUND_WEAR[band].filter((k) => GROUND[k][role].length);
    if (!kits.length) return old ? pick(rg, old) : null;
    return pick(rg, GROUND[pick(rg, kits)][role]);
  }

  chunkOf(x, z) {
    const C = this.m(420);
    return `${Math.floor(x / C)},${Math.floor(z / C)}`;
  }

  /** Textured triangle with automatic winding toward `want` normal (or the geometric normal) */
  tri(b, p, uv, c, col, mode, want) {
    _a.subVectors(p[1], p[0]); _b.subVectors(p[2], p[0]);
    _n.crossVectors(_a, _b).normalize();
    let o = [0, 1, 2];
    if (want && _n.dot(want) < 0) { _n.negate(); o = [0, 2, 1]; }
    const ids = o.map((i) => {
      const cc = Array.isArray(col[0]) ? col[i] : col;
      return b.v(p[i].x, p[i].y, p[i].z, _n.x, _n.y, _n.z, cc[0], cc[1], cc[2], uv[i][0], uv[i][1], c, mode);
    });
    b.idx.push(ids[0], ids[1], ids[2]);
  }

  /** Quad from 4 corners [BL, BR, TR, TL] with a fixed normal */
  quad(b, p, n, uv, c, col, mode = 0) {
    const i0 = b.n;
    for (let i = 0; i < 4; i++) {
      const cc = Array.isArray(col[0]) ? col[i] : col;
      b.v(p[i][0], p[i][1], p[i][2], n[0], n[1], n[2], cc[0], cc[1], cc[2], uv[i][0], uv[i][1], c, mode);
    }
    b.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  /**
   * Vertical wall from plan point a to b (left to right seen from outside), y0..y1.
   * tw, th: tile repeat size in units. snapU rounds the repeat count so whole tiles fit.
   * Vertex colors carry the tint and a canyon darkening toward the street.
   */
  wall(b, tile, ax, az, bx, bz, y0, y1, tw, th, o = {}) {
    const dx = bx - ax, dz = bz - az, w = Math.hypot(dx, dz);
    if (w < 1e-3 || y1 - y0 < 1e-3) return;
    const n = [-dz / w, 0, dx / w];
    const nu = o.snapU ? Math.max(1, Math.round(w / tw)) : w / tw;
    const c = cell(tile);
    const tint = o.tint || WHITE, base = o.base ?? 0;
    const ao = (y) => (o.ao === false ? 1 : 0.56 + 0.44 * smooth(0, this.m(55), y - base));
    const v0 = o.v0 ?? 0;
    const cuts = [y0];
    const aoTop = base + this.m(55);
    if (o.ao !== false && aoTop > y0 && aoTop < y1) cuts.push(aoTop);
    cuts.push(y1);
    for (let i = 0; i < cuts.length - 1; i++) {
      const ya = cuts[i], yb = cuts[i + 1];
      const va = v0 + (ya - y0) / th, vb = v0 + (yb - y0) / th;
      const ka = ao(ya), kb = ao(yb);
      const ca = [tint[0] * ka, tint[1] * ka, tint[2] * ka], cb = [tint[0] * kb, tint[1] * kb, tint[2] * kb];
      this.quad(b, [[ax, ya, az], [bx, ya, bz], [bx, yb, bz], [ax, yb, az]], n,
        [[0, va], [nu, va], [nu, vb], [0, vb]], c, [ca, ca, cb, cb]);
    }
  }

  /** Flat horizontal quad (+y) with uv from a function of (x, z) */
  flat(b, tile, x0, z0, x1, z1, y, uvf, mode = 0, col = WHITE) {
    const c = cell(tile);
    const P = [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]];
    this.quad(b, P, [0, 1, 0], P.map((p) => uvf(p[0], p[2])), c, col, mode);
  }

  /** Box with every face textured with one tile repeating at world scale */
  slab(b, tile, x0, z0, x1, z1, y0, y1, ts, o = {}) {
    this.vol({ t: 'solid', x0, x1, z0, z1, y0, y1, mat: o.mat || (tile === 'walls47' ? 'steel' : wallMat(tile)) });
    const tint = o.tint || WHITE, c = cell(tile), top = o.top ? cell(o.top) : c;
    const S = [[x0, z1, x1, z1], [x1, z0, x0, z0], [x1, z1, x1, z0], [x0, z0, x0, z1]];
    for (const [ax, az, bx, bz] of S) this.wall(b, tile, ax, az, bx, bz, y0, y1, ts, ts, { tint, ao: false });
    const tuv = o.top ? (x, z) => [(x - x0) / (x1 - x0), (z1 - z) / (z1 - z0)] : (x, z) => [x / ts, -z / ts];
    const P = [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
    this.quad(b, P, [0, 1, 0], P.map((p) => tuv(p[0], p[2])), top, tint);
    if (o.bottom) {
      const Q = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
      const k = 0.55;
      this.quad(b, Q, [0, -1, 0], Q.map((p) => [p[0] / ts, p[2] / ts]), c, [tint[0] * k, tint[1] * k, tint[2] * k]);
    }
  }

  /** Append a unit prop shape with a transform and a flat color */
  prop(shape, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0, chunk) {
    _q.setFromEuler(new THREE.Euler(rx, ry, rz));
    this.propQ(shape, _c.set(x, y, z), _q, _s.set(sx, sy, sz), color, chunk || this.chunkOf(x, z));
  }

  /** Append a unit prop shape at a position, rotation and scale */
  propQ(shape, pos, q, scale, color, chunk) {
    const g = SHAPES[shape];
    const b = this.buf('props', chunk);
    _m.compose(pos, q, scale);
    if (this.owner) {
      // What it is made of, read from its shape and color unless the builder said
      const [r, gg, bb] = color;
      const mat = this.propMat || (Math.max(r, gg, bb) > 1 ? 'light' : shape === 'ico' && gg > r && gg > bb ? 'leaf' : shape === 'pole' && r > bb + 0.05 && r < 0.5 ? 'wood' : 'steel');
      this.vol({ t: 'shape', shape, e: Float32Array.from(_m.elements), mat });
    }
    const nm = new THREE.Matrix3().getNormalMatrix(_m);
    const P = g.attributes.position, N = g.attributes.normal, I = g.index;
    const i0 = b.n;
    for (let i = 0; i < P.count; i++) {
      _a.fromBufferAttribute(P, i).applyMatrix4(_m);
      _n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      b.v(_a.x, _a.y, _a.z, _n.x, _n.y, _n.z, color[0], color[1], color[2]);
    }
    if (I) for (let i = 0; i < I.count; i++) b.idx.push(i0 + I.getX(i));
    else for (let i = 0; i < P.count; i++) b.idx.push(i0 + i);
  }

  /** A thin prop shape from a to b (a stay, a hanger), r thick */
  strut(shape, a, b, r, color, chunk) {
    const d = new V3().subVectors(b, a), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.divideScalar(len));
    this.propQ(shape, new V3().addVectors(a, b).multiplyScalar(0.5), q, new V3(r, len, r), color, chunk);
  }

  // ---- structure pieces --------------------------------------------------------

  /**
   * A structure box. f: { ns, ew, top, bottom } for the faces facing ±z, ±x, up and down, each
   * [tile, repeat width, repeat height] in units (0: once across the face), with an optional
   * fourth entry true to fit whole repeats along a side. Top and bottom repeat along x and z.
   */
  sbox(x0, y0, z0, x1, y1, z1, f, tint = WHITE) {
    this.vol({ t: 'solid', x0, x1, z0, z1, y0, y1, mat: this.sboxMat || 'concrete' });
    const side = (spec, ax, az, bx, bz) => {
      if (!spec) return;
      const [t, tw, th, snap] = spec, w = Math.hypot(bx - ax, bz - az);
      this.wall(this.bufFor(t), t, ax, az, bx, bz, y0, y1, tw || w, th || y1 - y0, { ao: false, tint, snapU: snap });
    };
    side(f.ns, x0, z1, x1, z1); side(f.ns, x1, z0, x0, z0);
    side(f.ew, x1, z1, x1, z0); side(f.ew, x0, z0, x0, z1);
    const flatFace = (spec, y, up) => {
      if (!spec) return;
      const [t, tw, th] = spec, uv = (x, z) => [(x - x0) / (tw || x1 - x0), (z1 - z) / (th || z1 - z0)];
      if (up) this.flat(this.bufFor(t), t, x0, z0, x1, z1, y, uv, 0, tint);
      else this.under(this.bufFor(t), t, x0, z0, x1, z1, y, uv, tint);
    };
    flatFace(f.top, y1, true);
    flatFace(f.bottom, y0, false);
  }

  /** Flat horizontal quad facing down, with uv from a function of (x, z) */
  under(b, tile, x0, z0, x1, z1, y, uvf, col = WHITE) {
    const P = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
    this.quad(b, P, [0, -1, 0], P.map((p) => uvf(p[0], p[2])), cell(tile), col);
  }

  /**
   * A vertical quad from a to b whose edges slope: y from ya0 to ya1 at a, yb0 to yb1 at b.
   * u runs along it every tw, continuing from one quad to the next; v runs up it every th
   * from each end's bottom edge, or from y = 0 with o.world.
   */
  skew(b, tile, ax, az, bx, bz, ya0, ya1, yb0, yb1, tw, th, o = {}) {
    const dx = bx - ax, dz = bz - az, w = Math.hypot(dx, dz);
    const ua = (ax * dx + az * dz) / w / tw, ub = ua + w / tw;
    const v = (y, y0) => (o.world ? y : y - y0) / th;
    this.quad(b, [[ax, ya0, az], [bx, yb0, bz], [bx, yb1, bz], [ax, ya1, az]], [-dz / w, 0, dx / w],
      [[ua, v(ya0, ya0)], [ub, v(yb0, yb0)], [ub, v(yb1, yb0)], [ua, v(ya1, ya0)]], cell(tile), o.tint || WHITE);
  }

  /** A see-through card (a truss, a railing) standing from a to b over y0..y1, repeating every tw (0: once) */
  card(tile, ax, az, bx, bz, y0, y1, tw = 0) {
    this.vol({ t: 'plate', ax, az, bx, bz, y0, y1, mat: 'steel' });
    const w = Math.hypot(bx - ax, bz - az);
    this.wall(this.bufFor(tile, true), tile, ax, az, bx, bz, y0, y1, tw || w, y1 - y0, { ao: false, snapU: true });
  }

  /** A lamp post or other piece seen from every side: two cards crossed at (x, z), h tall */
  crossCard(tile, x, y, z, h) {
    const w = h * cell(tile).aspect / 2;
    this.card(tile, x - w, z, x + w, z, y, y + h);
    this.card(tile, x, z + w, x, z - w, y, y + h);
  }

  /**
   * A solid piece (pier, tower, pylon) extruded from its traced outline: w wide and h tall with
   * its base centered at (x, y, z), d deep, turned by ry. Its faces show the piece and its edges
   * the side tile, repeating every ts. The side tile must be on the piece's atlas page.
   */
  solid(name, side, x, y, z, w, h, d, ry = 0, ts = this.m(4)) {
    this.vol({ t: 'outline', name, x, y, z, w, h, d, ry, mat: 'concrete' });
    const O = OUTLINES[name], ring = (r) => r.map(([u, v]) => new THREE.Vector2((u - 0.5) * w, v * h));
    const shape = new THREE.Shape(ring(O[0]));
    for (const hole of O.slice(1)) shape.holes.push(new THREE.Path(ring(hole)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -d / 2);
    const P = g.attributes.position, N = g.attributes.normal;
    const b = this.bufFor(name), cp = cell(name), cs = cell(side);
    const q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), ry);
    const M = new THREE.Matrix4().compose(new V3(x, y, z), q, new V3(1, 1, 1));
    const p = new V3(), nn = new V3();
    // The geometry is not indexed, so each triangle has its own vertices and face normal
    for (let i = 0; i < P.count; i += 3) {
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i), cap = Math.abs(nz) > 0.5;
      nn.set(nx, ny, nz).applyQuaternion(q);
      for (let k = i; k < i + 3; k++) {
        const px = P.getX(k), py = P.getY(k), pz = P.getZ(k);
        const u = cap ? clamp(px / w + 0.5, 0.002, 0.998) : pz / ts, v = cap ? clamp(py / h, 0.002, 0.998) : (py * nx - px * ny) / ts;
        p.set(px, py, pz).applyMatrix4(M);
        b.idx.push(b.v(p.x, p.y, p.z, nn.x, nn.y, nn.z, 1, 1, 1, u, v, cap ? cp : cs, 0));
      }
    }
    g.dispose();
  }

  /** Where a horizontal line at height v (0..1) crosses a solid piece's outline: sorted u values */
  outlineCuts(name, v) {
    const xs = [];
    for (const r of OUTLINES[name]) {
      for (let i = 0; i < r.length; i++) {
        const [ax, ay] = r[i], [bx, by] = r[(i + 1) % r.length];
        if ((ay <= v) !== (by <= v)) xs.push(ax + (v - ay) / (by - ay) * (bx - ax));
      }
    }
    return xs.sort((a, b) => a - b);
  }

  /** Width (0..1) of the opening through a piece's middle at height v, or 0 where it is solid */
  opening(name, v) {
    const xs = this.outlineCuts(name, v);
    for (let i = 1; i < xs.length - 1; i += 2) if (xs[i] <= 0.5 && xs[i + 1] >= 0.5) return xs[i + 1] - xs[i];
    return 0;
  }

  /** A cable through points pts (V3), r thick, wrapped in a tile repeating every rep along it */
  cable(tile, pts, r, rep) {
    const b = this.bufFor(tile), c = cell(tile), sides = 6, rings = [];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const t = new V3().subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
      const u1 = new V3().crossVectors(t, Math.abs(t.y) < 0.95 ? new V3(0, 1, 0) : new V3(1, 0, 0)).normalize();
      if (i) s += pts[i].distanceTo(pts[i - 1]);
      rings.push({ p: pts[i], u1, u2: new V3().crossVectors(u1, t), s });
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const ids = [[rings[i], k], [rings[i + 1], k], [rings[i + 1], k + 1], [rings[i], k + 1]].map(([R, kk]) => {
          const a = (kk / sides) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
          const nx = R.u1.x * cs + R.u2.x * sn, ny = R.u1.y * cs + R.u2.y * sn, nz = R.u1.z * cs + R.u2.z * sn;
          return b.v(R.p.x + nx * r, R.p.y + ny * r, R.p.z + nz * r, nx, ny, nz, 1, 1, 1, R.s / rep, (kk / sides) * 0.999, c, 0);
        });
        b.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      }
    }
  }

  collide(x0, y0, z0, x1, y1, z1, extra) {
    const c = Object.assign({ min: new V3(x0, y0, z0), max: new V3(x1, y1, z1) }, extra);
    this.colliders.push(c);
    if (this.owner) { c.owner = this.owner; this.owner.colliders.push(c); }
    return c;
  }

  // ---- ground ----------------------------------------------------------------

  buildGround() {
    const L = this.L, rg = this.rg, m = (x) => this.m(x);
    // Wear: broad patches of worn and broken pavement, so streets weather by neighborhood
    const spots = Array.from({ length: 9 }, () => [L.x0 + rg() * (L.x1 - L.x0), L.zN + rg() * (L.z1 - L.zN), m(100 + rg() * 180), 0.3 + rg() * 0.45]);
    this.wear = (x, z) => clamp(0.12 + spots.reduce((w, [sx, sz, R, k]) => w + k * Math.exp(-((x - sx) ** 2 + (z - sz) ** 2) / (R * R)), 0), 0, 1);
    // Each road keeps one asphalt per wear band, laid in world space along the road and mirrored at
    // the tile edges, so its segments join without a seam and the surface changes only with the wear
    const road = () => ({ t: ASPHALT.map((a) => pick(rg, a)), ox: rg() * 7 });
    const patch = (R, x0, z0, x1, z1, rot, holes = true) => {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = this.wear(cx, cz);
      const t = R.t[w < 0.4 ? 0 : w < 0.7 ? 1 : 2], ox = R.ox;
      // Kit asphalt repeats at 1.6 times its painted size, coarser but less repetitive; the original tiles every 5 m
      const [tw, th] = PANELS[t] ? tileMeters(t).map((v) => m(v * 1.6)) : [m(5), m(5)];
      this.flat(this.groundBuf(t), t, x0, z0, x1, z1, 0, (x, z) => (rot ? [z / tw + ox, x / th] : [x / tw + ox, -z / th]), 3);
      // Cracked patches and potholes where the street is worn, clear of the crossings: the
      // tiled asphalt stays even, and the damage lies over it in soft-edged rounds
      if (!holes || w < 0.4) return;
      const n = Math.round(((x1 - x0) * (z1 - z0)) / m(9) ** 2 * (w - 0.4) * 2);
      for (let i = 0; i < n; i++) {
        const h = this.groundTile('hole', cx, cz);
        if (!h) break;
        const s = m(2.2 + rg() * 2.6);
        const [ex, ez] = rot ? [s, m(8)] : [m(8), s];
        if (x1 - x0 < 2 * ex || z1 - z0 < 2 * ez) break;
        const x = x0 + ex + rg() * (x1 - x0 - 2 * ex), z = z0 + ez + rg() * (z1 - z0 - 2 * ez);
        this.flat(this.groundBuf(h, true), h, x - s / 2, z - s / 2, x + s / 2, z + s / 2, m(0.01), (xx, zz) => [(xx - x + s / 2) / s, (z + s / 2 - zz) / s], 2);
      }
    };
    // Avenues run unbroken through the intersections; cross streets meet them at the crosswalks
    for (const a of L.aves) {
      const R = road();
      for (let i = 0; i < L.sts.length; i++) {
        const s = L.sts[i], n = L.sts[i + 1];
        patch(R, a.x0, s.z0, a.x1, s.z1, true, false);
        if (n) patch(R, a.r0, s.z1, a.r1, n.z0, true);
      }
    }
    for (const s of L.sts) {
      const R = road();
      for (let i = 0; i < L.aves.length - 1; i++) patch(R, L.aves[i].x1, s.r0, L.aves[i + 1].x0, s.r1, false);
    }
    // Beyond the north edge: more road surface under the distant city
    this.flat(this.buf('ground', 'far'), 'asphB01', L.wx - L.prom, L.zN - m(2600), L.x1 + L.prom, L.zN + L.stWalk, 0, (x, z) => [x / m(60), -z / m(60)], 0, [0.7, 0.7, 0.72]);
    // Sidewalks: a raised, round-cornered slab per block with a granite curb
    for (const B of L.blocks) this.sidewalk(B);
    this.markings();
  }

  sidewalk(B) {
    const L = this.L, rg = this.rg, m = (x) => this.m(x);
    const g = this.buf('ground');
    const x0 = B.x0 - L.aveWalk, x1 = B.x1 + L.aveWalk, z0 = B.z0 - L.stWalk, z1 = B.z1 + L.stWalk;
    const h = L.curb, rad = m(4.5), cw = m(0.45);
    const ring = (inset) => {
      const pts = [], R = rad - inset;
      const C = [[x1 - rad, z0 + rad, -Math.PI / 2], [x1 - rad, z1 - rad, 0], [x0 + rad, z1 - rad, Math.PI / 2], [x0 + rad, z0 + rad, Math.PI]];
      for (const [cx, cz, a0] of C) for (let i = 0; i <= 5; i++) { const a = a0 + (i / 5) * (Math.PI / 2); pts.push(new V3(cx + Math.cos(a) * R, h, cz + Math.sin(a) * R)); }
      return pts;
    };
    const outer = ring(0), inner = ring(cw);
    const center = new V3((x0 + x1) / 2, h, (z0 + z1) / 2);
    const slab = this.groundTile('walk', center.x, center.z, G.slab), curb = 'paveB32', up = new V3(0, 1, 0);
    const [sw, sh] = PANELS[slab] ? tileMeters(slab).map(m) : [m(3), m(3)];
    const sg = this.groundBuf(slab), c1 = cell(slab), c2 = cell(curb);
    const tint = [0.96 + rg() * 0.06, 0.96 + rg() * 0.05, 0.95 + rg() * 0.05];
    const uv = (p) => [p.x / sw, -p.z / sh];
    for (let i = 0; i < inner.length; i++) {
      const p = inner[i], q = inner[(i + 1) % inner.length];
      this.tri(sg, [center, p, q], [uv(center), uv(p), uv(q)], c1, tint, 0, up);
      const P = outer[i], Q = outer[(i + 1) % outer.length];
      const cuv = (v) => [v.x / m(1.2), -v.z / m(1.2)];
      this.tri(g, [P, Q, q], [cuv(P), cuv(Q), cuv(q)], c2, WHITE, 0, up);
      this.tri(g, [P, q, p], [cuv(P), cuv(q), cuv(p)], c2, WHITE, 0, up);
      // Curb face down to the road
      this.wall(g, 'walls53', Q.x, Q.z, P.x, P.z, 0, h, m(1.2), m(1.2), { ao: false, tint: [0.8, 0.8, 0.8] });
    }
    this.collide(x0, 0, z0, x1, h, z1, { low: true });
    // A few utility covers set into the sidewalk, at their own size (up to 1.4 m)
    for (let i = 0; i < 2; i++) {
      const side = rg() < 0.5, along = B.x0 + rg() * (B.x1 - B.x0), off = m(1.4) + rg() * m(1.5);
      const z = side ? B.z0 - off : B.z1 + off;
      const t = this.groundTile('square', along, z, G.manholeSquare);
      let [w, d] = PANELS[t] ? tileMeters(t) : [1.6, 1.6];
      const k = clamp(Math.max(w, d), 0.7, 1.4) / Math.max(w, d);
      w = m(w * k); d = m(d * k);
      this.flat(this.groundBuf(t, true), t, along - w / 2, z - d / 2, along + w / 2, z + d / 2, h + m(0.02), (x, zz) => [(x - along + w / 2) / w, (z + d / 2 - zz) / d]);
    }
  }

  /**
   * A painted line along a road: along z at x = c for an avenue, along x at z = c for a
   * street, from a0 to a1. Kit lines are cropped to their paint and stretched along the
   * road; the original tiles hold a line in the middle of a 3 m strip.
   */
  roadLine(tile, alongZ, c, a0, a1, y) {
    const m = (x) => this.m(x), b = this.groundBuf(tile, true);
    const [w, len] = PANELS[tile] ? [m(tileMeters(tile)[0]), m(tileMeters(tile)[1] * 3)] : [m(3), m(tile === 'asphB11' ? 3 : 9)];
    if (alongZ) this.flat(b, tile, c - w / 2, a0, c + w / 2, a1, y, (x, z) => [(x - c + w / 2) / w, -z / len], 1);
    else this.flat(b, tile, a0, c - w / 2, a1, c + w / 2, y, (x, z) => [(z - c + w / 2) / w, x / len], 1);
  }

  /** A crosswalk over x0..x1, z0..z1; alongZ: its stripes run along z, across an avenue */
  crosswalk(tile, x0, z0, x1, z1, y, alongZ) {
    const b = this.groundBuf(tile, true);
    if (!PANELS[tile]) {
      // The original tiles: stripes run across the tile, repeating every 4.8 m
      const rep = this.m(4.8);
      if (alongZ) this.flat(b, tile, x0, z0, x1, z1, y, (x, z) => [(z - z0) / (z1 - z0), x / rep], 1);
      else this.flat(b, tile, x0, z0, x1, z1, y, (x, z) => [(x - x0) / (x1 - x0), -z / rep], 1);
      return;
    }
    // Kit tiles stand upright: the stripes span the crossing, repeating across the road at the tile's aspect
    const [tw, th] = tileMeters(tile);
    if (alongZ) { const rep = (z1 - z0) * tw / th; this.flat(b, tile, x0, z0, x1, z1, y, (x, z) => [(x - x0) / rep, (z - z0) / (z1 - z0)], 1); }
    else { const rep = (x1 - x0) * tw / th; this.flat(b, tile, x0, z0, x1, z1, y, (x, z) => [(z - z0) / rep, (x - x0) / (x1 - x0)], 1); }
  }

  markings() {
    const L = this.L, r = this.r, m = (x) => this.m(x);
    const d = this.buf('decal');
    const y = m(0.02);
    // Avenues: four lanes one way, dashed white dividers, crosswalks and stop bars at each street
    for (const a of L.aves) {
      const cx = (a.r0 + a.r1) / 2, lane = (a.r1 - a.r0) / 4;
      for (const s of L.sts) {
        const z0 = s.z1, z1 = s.z1 + L.blockD;
        if (z0 >= L.z1) continue;
        const za = z0 + m(9), zb = Math.min(z1, L.z1) - m(9);
        const t = this.groundTile('lane', cx, (za + zb) / 2, ['asphB12']);
        for (const off of [-1, 0, 1]) this.roadLine(t, true, cx + off * lane, za, zb, y);
      }
      for (const s of L.sts) {
        // Crosswalks across the avenue, in line with the street's sidewalks
        for (const [zc0, zc1] of [[s.z0, s.r0], [s.r1, s.z1]]) {
          const zz0 = zc0 + m(0.4), zz1 = zc1 - m(0.4);
          this.crosswalk(this.groundTile('crosswalk', cx, zz0, ['asphB20']), a.r0 + m(0.6), zz0, a.r1 - m(0.6), zz1, y, true);
        }
        // Stop bar on the approach side
        const zs = a.dir > 0 ? s.z0 - m(1.2) : s.z1 + m(1.2);
        this.flat(d, 'asphB10', a.r0, zs - m(1.4), a.r1, zs + m(1.4), y, (x, z) => [(z - zs + m(1.4)) / m(2.8), x / m(3)], 1);
        // Turn and straight arrows a little before the stop bar
        if (r() < 0.6) {
          const za = zs - a.dir * m(9);
          for (let l = 0; l < 4; l++) {
            const x = a.r0 + (l + 0.5) * lane, w = m(2.6);
            const t = l === 3 && r() < 0.5 ? 'asphalt41' : 'asphalt40';
            this.flat(d, t, x - w / 2, za - w / 2, x + w / 2, za + w / 2, y, (xx, z) => {
              const u = (xx - x + w / 2) / w, v = (z - za + w / 2) / w;
              return a.dir > 0 ? [1 - u, v] : [u, 1 - v];
            }, 1);
          }
        }
      }
    }
    // Cross streets: four lanes, one way with dashed dividers, or two way split by a double yellow
    for (const s of L.sts) {
      const cz = (s.r0 + s.r1) / 2, lane = (s.r1 - s.r0) / 4, two = (s.k + 20) % 3 === 0;
      for (let i = 0; i < L.aves.length - 1; i++) {
        const x0 = L.aves[i].x1 + m(8), x1 = L.aves[i + 1].x0 - m(8);
        const dash = this.groundTile('lane', (x0 + x1) / 2, cz, ['asphB12']);
        this.roadLine(two ? this.groundTile('yellow', (x0 + x1) / 2, cz, ['asphB11']) : dash, false, cz, x0, x1, y);
        for (const off of [-1, 1]) this.roadLine(dash, false, cz + off * lane, x0, x1, y);
      }
      for (const a of L.aves) {
        for (const [xc0, xc1] of [[a.x0, a.r0], [a.r1, a.x1]]) {
          const xx0 = xc0 + m(0.4), xx1 = xc1 - m(0.4);
          this.crosswalk(this.groundTile('crosswalk', xx0, cz, ['asphB20', 'asphB21']), xx0, s.r0 + m(0.5), xx1, s.r1 - m(0.5), y, false);
        }
      }
    }
    // "Don't block the box" junctions downtown, and manholes / steam vents along the roads
    for (const a of L.aves) {
      for (const s of L.sts) {
        if (s.k < 0) continue;
        if (r() < 0.12) {
          const t = this.groundTile('box', (a.r0 + a.r1) / 2, (s.r0 + s.r1) / 2, ['asphB23']);
          this.flat(this.groundBuf(t, true), t, a.r0 + m(0.5), s.r0 + m(0.3), a.r1 - m(0.5), s.r1 - m(0.3), y, (x, z) => [(x - a.r0) / (a.r1 - a.r0), (s.r1 - z) / (s.r1 - s.r0)], 1);
        }
        const n = 1 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) {
          const x = a.r0 + m(3) + r() * (a.r1 - a.r0 - m(6)), z = s.z1 + m(10) + r() * (L.blockD - m(20)), w = m(1.6);
          if (z > L.z1) continue;
          const t = this.groundTile('round', x, z, G.manholeRound);
          this.flat(this.groundBuf(t, true), t, x - w / 2, z - w / 2, x + w / 2, z + w / 2, y, (xx, zz) => [(xx - x + w / 2) / w, (z + w / 2 - zz) / w], 2);
          if (r() < 0.02 && s.k >= 0) this.steam.push({ pos: new V3(x, 0, z), t: r() * 3, stack: false });
        }
      }
    }
  }

  // ---- blocks ----------------------------------------------------------------

  buildBlocks() {
    const L = this.L;
    // Special blocks
    const special = {
      '5,3': 'needle', '6,5': 'plaza', '7,5': 'twist', '9,8': 'park', '4,7': 'green', '9,5': 'twins',
      '6,7': 'gate', '10,3': 'stack', '11,7': 'terraces', '8,9': 'deco', '12,11': 'park', '2,10': 'green', '6,12': 'green',
      '13,4': 'twist', '12,9': 'stack',
    };
    // Tall clusters: around the needle and the plaza (north), a second spine to the southeast and a
    // smaller one beyond it toward the highway
    const tall = (j, k) => {
      const d1 = Math.hypot(j - 7.2, k - 4.4), d2 = Math.hypot(j - 9.8, k - 7.4), d3 = Math.hypot(j - 12.4, k - 10.6);
      return Math.max(Math.exp(-d1 * d1 / 7), 0.92 * Math.exp(-d2 * d2 / 6), 0.8 * Math.exp(-d3 * d3 / 4), 0.18);
    };
    // Residential streets: detached houses by the forest on the west side, row houses beyond them
    // and along the south waterfront
    const zone = (j, k) => {
      if (tall(j, k) > 0.45) return null;
      if (j <= 1) return 'houses';
      if (j <= 3) return k % 4 === 1 ? 'houses' : 'rows';
      if (k >= 13 && j <= 10) return (j + k) % 3 === 0 ? 'houses' : 'rows';
      return null;
    };
    for (const B of L.blocks) {
      this.cur = this.chunkOf((B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2);
      const type = B.playable ? special[`${B.j},${B.k}`] : null;
      const t = B.playable ? tall(B.j, B.k) : 0.25 + this.r() * 0.15;
      const res = B.playable && !type ? zone(B.j, B.k) : null;
      B.residential = !!res;
      if (type === 'needle') this.needleBlock(B);
      else if (type === 'plaza') this.plazaBlock(B);
      else if (type === 'park') this.parkBlock(B, true);
      else if (type === 'green') this.parkBlock(B, false);
      else if (type === 'twins') this.twinsBlock(B, t);
      else if (type === 'gate') this.gateBlock(B, t);
      else if (type) this.towerBlock(B, t, type);
      else if (res) this.residentialBlock(B, res);
      else if (t > 0.62 && this.r() < 0.8) {
        const q = this.r();
        this.towerBlock(B, t, q < 0.38 ? 'glass' : q < 0.46 ? 'deco' : q < 0.66 ? 'prism' : q < 0.86 ? 'twist' : 'stack');
      } else this.mixedBlock(B, t);
    }
  }

  /**
   * A residential block. houses: detached houses of two or three floors under hipped roofs, set
   * back behind front yards with a tree or two. rows: row houses wall to wall along both long
   * sides, three or four floors with a doorway each and a cornice.
   */
  residentialBlock(B, kind) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb, zm = (B.z0 + B.z1) / 2;
    for (const [z0, z1, front] of [[B.z0, zm, 'n'], [zm, B.z1, 's']]) {
      if (kind === 'rows') {
        const kit = pick(r, KIT_STYLE.row), floors = 3 + Math.floor(r() * 2);
        for (const [x0, x1] of this.lots(B.x0, B.x1, 6.5, 9.5)) {
          const ends = { w: x0 <= B.x0 + 0.01, e: x1 >= B.x1 - 0.01 };
          this.rowHouse(kit, x0, x1, z0, z1, front, ends, floors);
        }
        continue;
      }
      const lots = this.lots(B.x0, B.x1, 15, 22);
      for (const [x0, x1] of lots) {
        // The house sits back from the street behind its yard, clear of its neighbors
        const yard = m(6 + r() * 3), side = m(2 + r() * 1.5), back = m(4);
        const hz0 = front === 'n' ? z0 + yard : z0 + back, hz1 = front === 'n' ? z1 - back : z1 - yard;
        const hx0 = x0 + side, hx1 = x1 - side;
        // Lawn over the lot, a path to the door, and a tree in the yard
        const grass = pick(r, G.grass);
        this.flat(this.buf('decal', this.cur), grass, x0 + m(0.4), z0 + m(0.4), x1 - m(0.4), z1 - m(0.4), y0 + m(0.06), (x, z) => [x / m(4), -z / m(4)], 0, [0.92, 1, 0.9]);
        const px = (hx0 + hx1) / 2, pz0 = front === 'n' ? z0 : hz1, pz1 = front === 'n' ? hz0 : z1;
        this.flat(this.buf('decal', this.cur), 'paveB30', px - m(0.9), pz0, px + m(0.9), pz1, y0 + m(0.08), (x, z) => [x / m(2), -z / m(2)]);
        if (r() < 0.85) {
          const tz = front === 'n' ? z0 + yard * 0.45 : z1 - yard * 0.45;
          this.tree(r() < 0.5 ? x0 + m(3) : x1 - m(3), y0, tz, 0.7 + r() * 0.35, pick(r, ['oak', 'maple', 'beech', 'elm', 'cedar', 'pine']));
        }
        if (hx1 - hx0 < m(8) || hz1 - hz0 < m(8)) continue;
        this.house(hx0, hx1, hz0, hz1, front);
      }
    }
  }

  /** A detached house: two or three floors from a kit under a hipped roof */
  house(x0, x1, z0, z1, front) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb;
    const F = this.kitFacade(pick(r, KIT_STYLE.house), Math.min(x1 - x0, z1 - z0));
    const [, bh] = tileMeters(F.bay);
    const n = Math.max(1, Math.round((3.5 + r() * 4) / bh));
    // Its windows round the ground floor too, a doorway (from a storefront kit) in the middle of the front
    const entry = this.storeEntry(pick(r, STORE_KITS), true);
    const roof = pick(r, G.roofPitched), streets = { n: front === 'n', s: front === 's', e: true, w: true };
    const H = Math.min(x1 - x0, z1 - z0) * (0.28 + r() * 0.16);
    this.building({
      x0, x1, z0, z1, y0, streets, allFacade: true, tint: this.tint(0.1), party: F.solid || pick(r, G.brick), style: 'house',
      tiers: [{ x0, x1, z0, z1, y1: y0 + entry.h + m(n * bh), tile: F.bay, F, band: entry }],
      crown: (T) => this.hipRoof(T, roof, H),
    });
  }

  /** A row house: a narrow front of a kit's windows over a doorway, flush with its neighbors */
  rowHouse(kit, x0, x1, z0, z1, front, ends, floors) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb;
    const F = this.kitFacade(kit, x1 - x0);
    const [, bh] = tileMeters(F.bay);
    const entry = this.storeEntry(kit.startsWith('store') ? kit : pick(r, STORE_KITS), true);
    const n = Math.max(2, Math.round(floors * 3.3 / bh));
    const streets = { n: front === 'n', s: front === 's', e: ends.e, w: ends.w };
    this.building({
      x0, x1, z0, z1, y0, streets, tint: this.tint(0.1), party: pick(r, G.brick), style: 'walkup',
      tiers: [{ x0, x1, z0, z1, y1: y0 + entry.h + m(n * bh), tile: F.bay, F, band: entry }],
      roof: { tile: pick(r, G.roofFlat), feature: r() < 0.2, bulkhead: r() < 0.4, ac: r() < 0.3 ? 1 : 0 },
      cornice: r() < 0.85,
    });
  }

  /**
   * A ground-floor band of entries from a storefront kit (assets/street-level-storefronts): shop
   * fronts and doorways side by side under a sign board. Returns the band for building().
   * door: just doors and windows, no sign board (houses).
   */
  storeEntry(kit, door = false) {
    const r = this.r, m = (x) => this.m(x);
    if (!kit) return { tile: pick(r, r() < 0.5 ? G.doors : G.ground), h: m(4.5) };
    const K = KITS[kit], sign = !door && K.signs.length && r() < 0.8;
    const [, eh] = tileMeters(K.entries[0]);
    return { tile: K.entries[0], kit, h: m(eh) + (sign ? m(tileMeters(K.signs[0])[1]) : 0), sign, door };
  }

  /**
   * A ground-floor band of storefront entries from a to b (seen from outside): shop fronts and
   * doorways side by side, now and then a shuttered one, under a sign board. A house's band is
   * its kit's windows with one doorway in the middle of the front. o: { tint, base, F, front }
   */
  entryWall(E, ax, az, bx, bz, y, o) {
    const m = (x) => this.m(x), r = this.rd, K = KITS[E.kit], len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) return;
    const signH = E.sign ? m(tileMeters(K.signs[0])[1]) : 0, eh = E.h - signH;
    const n = Math.max(1, Math.round(len / m(tileMeters(K.entries[0])[0]))), w = len / n;
    const dx = (bx - ax) / len, dz = (bz - az) / len, wo = { tint: o.tint, base: o.base };
    const shop = pick(r, K.entries);
    for (let i = 0; i < n; i++) {
      let tile;
      if (E.door) tile = o.front && i === Math.floor(n / 2) ? pick(r, K.entries) : o.F ? o.F.bay : pick(r, K.bays);
      else tile = r() < 0.12 ? pick(r, K.vents) : r() < 0.5 ? shop : pick(r, K.entries);
      const x0 = ax + dx * w * i, z0 = az + dz * w * i, x1 = ax + dx * w * (i + 1), z1 = az + dz * w * (i + 1);
      this.wall(this.bufFor(tile), tile, x0, z0, x1, z1, y, y + eh, w, eh, wo);
    }
    if (signH) {
      const sg = pick(r, K.signs), sw = m(tileMeters(sg)[0]);
      this.wall(this.bufFor(sg), sg, ax, az, bx, bz, y + eh, y + E.h, sw, signH, Object.assign({ snapU: true }, wo));
    }
  }

  /** A hipped roof over a building's top: four slopes up to a ridge, h high, overhanging a little */
  hipRoof(T, tile, h) {
    const m = (x) => this.m(x), ov = m(0.6), [tw] = tileMeters(tile);
    const x0 = T.x0 - ov, x1 = T.x1 + ov, z0 = T.z0 - ov, z1 = T.z1 + ov;
    const b = this.bufFor(tile), c = cell(tile), ts = m(tw);
    // As drawn, eaves and all, for destruction: a hip, its sides all at the same pitch
    this.vol({ t: 'pyr', hip: true, x0, x1, z0, z1, y0: T.y1, y1: T.y1 + h, mat: 'wood' });
    // A ridge along the long side: the slopes meet a line, not a point
    const alongX = x1 - x0 >= z1 - z0, half = (alongX ? z1 - z0 : x1 - x0) / 2, y1 = T.y1 + h;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const ra = alongX ? new V3(x0 + half, y1, cz) : new V3(cx, y1, z0 + half), rb = alongX ? new V3(x1 - half, y1, cz) : new V3(cx, y1, z1 - half);
    const P = [new V3(x0, T.y1, z1), new V3(x1, T.y1, z1), new V3(x1, T.y1, z0), new V3(x0, T.y1, z0)];
    const C = new V3(cx, T.y1, cz);
    for (let i = 0; i < 4; i++) {
      const a = P[i], bb = P[(i + 1) % 4], mid = new V3().addVectors(a, bb).multiplyScalar(0.5);
      const R = new V3().subVectors(bb, a).normalize(), out = new V3().subVectors(mid, C).setY(0).normalize();
      // The ridge end nearest this eave
      const sideLong = (Math.abs(R.x) > 0.5) === alongX;
      const near = mid.distanceToSquared(ra) < mid.distanceToSquared(rb) ? ra : rb;
      // Up the slope, square to the eave: to the middle of the ridge, or the ridge end over a short side
      const Up = new V3().subVectors(sideLong ? new V3(cx, y1, cz) : near, mid).normalize();
      const uv = (p) => [_a.subVectors(p, a).dot(R) / ts, _a.subVectors(p, mid).dot(Up) / ts];
      const want = out.clone().setY(0.6);
      if (sideLong) {
        // A long side: a trapezoid up to the whole ridge
        const pa = a.distanceToSquared(ra) < a.distanceToSquared(rb) ? ra : rb, pb = pa === ra ? rb : ra;
        this.tri(b, [a, bb, pb], [uv(a), uv(bb), uv(pb)], c, WHITE, 0, want);
        this.tri(b, [a, pb, pa], [uv(a), uv(pb), uv(pa)], c, WHITE, 0, want);
      } else this.tri(b, [a, bb, near], [uv(a), uv(bb), uv(near)], c, WHITE, 0, want);
    }
    // The eaves' undersides
    this.under(this.buf('surface', this.cur), 'walls05', x0, z0, x1, z1, T.y1, (x, z) => [x / m(3), z / m(3)], [0.55, 0.52, 0.5]);
    this.collide(T.x0, T.y1, T.z0, T.x1, T.y1 + h * 0.5, T.z1, { building: true });
  }

  /** Split [x0, x1] into lots between minW and maxW meters wide */
  lots(x0, x1, minW, maxW) {
    const out = [], m = (x) => this.m(x);
    let x = x0;
    while (x1 - x > m(minW) * 1.6) {
      const w = m(minW + this.r() * (maxW - minW));
      if (x1 - x - w < m(minW)) break;
      out.push([x, x + w]);
      x += w;
    }
    out.push([x, x1]);
    return out;
  }

  mixedBlock(B, t) {
    const r = this.r, zm = (B.z0 + B.z1) / 2;
    for (const [z0, z1, front] of [[B.z0, zm, 'n'], [zm, B.z1, 's']]) {
      const roll = r();
      const style = () => {
        const q = r();
        if (t < 0.3) return q < 0.72 ? 'walkup' : 'prewar';
        if (t < 0.5) return q < 0.35 ? 'walkup' : q < 0.85 ? 'prewar' : 'modern';
        return q < 0.15 ? 'walkup' : q < 0.6 ? 'prewar' : 'office';
      };
      for (const [x0, x1] of this.lots(B.x0, B.x1, roll < 0.5 ? 7 : 14, roll < 0.5 ? 14 : 34)) {
        const st = (x1 - x0) < this.m(12) ? 'walkup' : style();
        const ends = { w: x0 <= B.x0 + 0.01, e: x1 >= B.x1 - 0.01 };
        this.lotBuilding(st, x0, x1, z0, z1, front, ends, t, B);
      }
    }
  }

  lotBuilding(style, x0, x1, z0, z1, front, ends, t, B) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb;
    const streets = { n: front === 'n', s: front === 's', e: ends.e, w: ends.w };
    const tint = this.tint(style === 'office' ? 0.05 : 0.08);
    if (style === 'walkup' && r() < 0.25) {
      // Brick and limestone bays over a storefront
      const F = this.kitFacade(pick(r, KIT_STYLE.walkup), x1 - x0);
      const [, bh] = tileMeters(F.bay);
      const n = Math.max(1, Math.round((10 + r() * 12) / bh));
      const band = this.storeEntry(r() < 0.75 ? pick(r, STORE_KITS) : null);
      this.building({
        x0, x1, z0, z1, y0, streets, tint, party: pick(r, G.brick), style: 'walkup',
        tiers: [{ x0, x1, z0, z1, y1: y0 + band.h + m(n * bh), tile: F.bay, F, band }],
        roof: { tile: pick(r, r() < 0.65 ? G.roofFlat : G.roof), feature: r() < 0.3, bulkhead: r() < 0.5, ac: r() < 0.3 ? 1 : 0 },
        cornice: r() < 0.8,
      });
    } else if (style === 'walkup') {
      const useOne = r() < 0.6;
      const upper = useOne ? pick(r, G.walkupUpper) : pick(r, G.walkupBrick);
      const [, uh] = tileMeters(upper);
      const n = useOne ? 3 + Math.floor(r() * 4) : 2 + Math.floor(r() * 2);
      const band = this.storeEntry(r() < 0.6 ? pick(r, STORE_KITS) : null);
      const top = y0 + band.h + m(n * uh);
      this.building({
        x0, x1, z0, z1, y0, streets, tint, party: pick(r, G.brick), style: 'walkup',
        tiers: [{ x0, x1, z0, z1, y1: top, tile: upper, band }],
        roof: { tile: pick(r, r() < 0.65 ? G.roofFlat : G.roof), feature: r() < 0.3, bulkhead: r() < 0.5, ac: r() < 0.3 ? 1 : 0 },
        cornice: r() < 0.8,
      });
    } else if (style === 'prewar') {
      const F = r() < 0.55 ? this.kitFacade(pick(r, KIT_STYLE.prewar), x1 - x0) : null;
      const tile = F ? F.bay : pick(r, r() < 0.8 ? G.prewar : G.officeStone);
      const [, th] = tileMeters(tile);
      const n = Math.max(F ? 2 : 3, Math.round((3 + r() * 5 + t * 7) * 7.2 / th));
      const q = r(), band = q < 0.45 ? this.storeEntry(pick(r, STORE_KITS)) : q < 0.7 ? { tile: pick(r, G.ground), h: m(4.5) } : { tile: pick(r, G.stone), h: m(6), stone: true };
      const h0 = band.h + m(n * th);
      const tiers = [{ x0, x1, z0, z1, y1: y0 + h0, tile, F, band }];
      if ((F ? n * th > 55 : n > 7) && r() < 0.6) {
        const k = F ? Math.max(1, Math.round((14 + r() * 16) / th)) : 2 + Math.floor(r() * 3), i = m(3 + r() * 3);
        const sb = this.inset({ x0, x1, z0, z1 }, i, streets);
        if (sb) tiers.push({ ...sb, y1: y0 + h0 + m(k * th), tile, F });
      }
      this.building({
        x0, x1, z0, z1, y0, streets, tint, party: pick(r, G.brick), tiers,
        roof: { tile: pick(r, r() < 0.65 ? G.roofFlat : G.roof), feature: r() < 0.45, bulkhead: true, ac: Math.floor(r() * 3) },
        cornice: true,
      });
    } else if (style === 'modern' || style === 'office') {
      const F = r() < 0.75 ? this.kitFacade(pick(r, KIT_STYLE[style]), x1 - x0) : null;
      const tile = F ? F.bay : style === 'modern' ? pick(r, G.modern) : pick(r, r() < 0.75 ? G.officeGlass : G.officePanel);
      const [, th] = tileMeters(tile);
      const n = Math.max(F ? 2 : 3, Math.round((style === 'modern' ? 30 + r() * 30 : 45 + r() * 50 + t * 60) / th));
      const q = r(), band = q < 0.3 ? this.storeEntry(pick(r, STORE_KITS)) : { tile: q < 0.65 ? 'facade12' : pick(r, G.ground), h: r() < 0.5 ? m(7.2) : m(4.5) };
      // Kit facades may get a vent floor every 40-70 m and a crown
      const S = F ? this.kitStack(F, y0 + band.h, n, { every: Math.max(3, Math.round((40 + r() * 30) / th)), crown: r() < 0.5 }) : { y: y0 + band.h + m(n * th) };
      this.building({
        x0, x1, z0, z1, y0, streets, tint, party: (F && F.solid) || pick(r, G.panel),
        tiers: [{ x0, x1, z0, z1, y1: S.y, tile, F, bands: S.bands, band }],
        roof: { tile: pick(r, r() < 0.65 ? G.roofFlat : G.roof), mech: (F && F.vent) || pick(r, G.mech), ac: 1 + Math.floor(r() * 3) },
      });
    }
  }

  /** Shrink a footprint on its street sides (setbacks only step back from streets) */
  inset(f, d, streets) {
    const o = { x0: f.x0 + (streets.w ? d : 0), x1: f.x1 - (streets.e ? d : 0), z0: f.z0 + (streets.n ? d : 0), z1: f.z1 - (streets.s ? d : 0) };
    if (o.x1 - o.x0 < this.m(6) || o.z1 - o.z0 < this.m(6)) return null;
    return o;
  }

  tint(k) {
    const r = this.r, b = 1 - k + r() * k * 1.6;
    return [b * (0.97 + r() * 0.06), b * (0.97 + r() * 0.06), b * (0.97 + r() * 0.06)];
  }

  /**
   * Emit a building: stacked tiers, facades on street sides (party walls elsewhere),
   * ground-floor band, roof with clutter, cornice, colliders.
   */
  building(o) {
    const m = (x) => this.m(x), r = this.r;
    this.beginOwner('building');
    // What kind of building, for who and what is inside (js/people.js, js/furniture.js)
    if (this.owner && !this.owner.style) this.owner.style = o.style || (o.allFacade ? 'tower' : 'office');
    const sb = this.buf('surface', this.cur);
    let ylo = o.y0;
    o.tiers.forEach((T, ti) => {
      // Towers that rise above the neighborhood get windows on every side
      const all = ti > 0 || o.allFacade || (o.style !== 'walkup' && o.tiers[o.tiers.length - 1].y1 - o.y0 > this.m(48));
      const sides = [
        ['s', T.x0, T.z1, T.x1, T.z1], ['n', T.x1, T.z0, T.x0, T.z0], ['e', T.x1, T.z1, T.x1, T.z0], ['w', T.x0, T.z0, T.x0, T.z1],
      ];
      const [tw, th] = tileMeters(T.tile);
      const band = T.band && ti === 0 ? { y: ylo + T.band.h, mat: wallMat(T.band.tile) } : null;
      const sideMat = {};
      for (const [side] of sides) sideMat[side] = all || o.streets[side] ? wallMat(T.tile, T.F) : wallMat(o.party);
      this.vol({
        t: 'box', x0: T.x0, x1: T.x1, z0: T.z0, z1: T.z1, y0: ti === 0 ? 0 : ylo, y1: T.y1, sides: sideMat, band,
        floors: this.floorsFor(band ? band.y : ylo, T.y1, th), roof: !(ti === o.tiers.length - 1 && o.crown),
      });
      for (const [side, ax, az, bx, bz] of sides) {
        const street = all || o.streets[side];
        if (street) {
          let y = ylo;
          if (T.band && ti === 0) {
            const bt = T.band.tile, [bw, bh] = tileMeters(bt);
            const isFacade = !bt.startsWith('walls');
            if (T.band.kit) this.entryWall(T.band, ax, az, bx, bz, y, { tint: o.tint, base: o.y0, F: T.F, front: o.streets[side] });
            else this.wall(this.bufFor(bt), bt, ax, az, bx, bz, y, y + T.band.h, m(bw), isFacade ? T.band.h : m(bh), { snapU: isFacade, tint: o.tint, base: o.y0 });
            y += T.band.h;
          }
          if (T.F) this.kitWall(T.F, ax, az, bx, bz, y, T.y1, { tint: o.tint, base: o.y0, bands: T.bands });
          else this.wall(this.bufFor(T.tile), T.tile, ax, az, bx, bz, y, T.y1, m(tw), m(th), { snapU: true, tint: o.tint, base: o.y0 });
          // Now and then a big screen over the street, on buildings tall enough to carry one
          const len = Math.hypot(bx - ax, bz - az);
          if (ti === 0 && o.streets[side] && T.y1 - o.y0 > m(30) && len > m(16) && this.rd() < 0.13) {
            const w = Math.min(len * 0.5, m(16));
            this.screen(ax, az, bx, bz, y + m(3), w, m(0.35));
          }
        } else {
          const [pw, ph] = tileMeters(o.party);
          this.wall(this.bufFor(o.party), o.party, ax, az, bx, bz, ylo, T.y1, m(pw), m(ph), { tint: o.tint, base: o.y0 });
        }
      }
      // Roof (or setback terrace)
      const last = ti === o.tiers.length - 1;
      const rt = T.roofTile || (o.roof && o.roof.tile) || 'roof00', rs = PANELS[rt] && !T.roofTile ? m(tileMeters(rt)[0]) : T.roofTile ? m(4) : m(6);
      if (!(last && o.crown)) this.flat(this.bufFor(rt), rt, T.x0, T.z0, T.x1, T.z1, T.y1, (x, z) => [x / rs, -z / rs]);
      this.collide(T.x0, ti === 0 ? 0 : ylo, T.z0, T.x1, T.y1, T.z1, { building: true });
      ylo = T.y1;
    });
    const top = o.tiers[o.tiers.length - 1];
    if (o.cornice) this.cornice(o, o.tiers[0]);
    if (o.roof) this.roofClutter(top, o.roof, o.streets, o.style);
    if (o.crown) o.crown(top);
    this.endOwner();
  }

  cornice(o, T) {
    const m = (x) => this.m(x), sb = this.buf('surface', this.cur);
    const d = m(0.7), h = m(1.0), y1 = T.y1 + m(0.25), y0 = y1 - h;
    const tile = 'walls51', ts = m(1.6), tint = [0.82, 0.8, 0.78];
    if (o.streets.s) this.slab(sb, tile, T.x0, T.z1, T.x1, T.z1 + d, y0, y1, ts, { tint, bottom: true });
    if (o.streets.n) this.slab(sb, tile, T.x0, T.z0 - d, T.x1, T.z0, y0, y1, ts, { tint, bottom: true });
    if (o.streets.e) this.slab(sb, tile, T.x1, T.z0, T.x1 + d, T.z1, y0, y1, ts, { tint, bottom: true });
    if (o.streets.w) this.slab(sb, tile, T.x0 - d, T.z0, T.x0, T.z1, y0, y1, ts, { tint, bottom: true });
  }

  roofClutter(T, R, streets, style) {
    const m = (x) => this.m(x), r = this.r, sb = this.buf('surface', this.cur);
    const W = T.x1 - T.x0, D = T.z1 - T.z0, y = T.y1;
    const at = (fx, fz) => [T.x0 + W * fx, T.z0 + D * fz];
    // Drains, vents and hatches from the roof covering's own sheet
    const rk = R.tile && ROOF_KITS[R.tile.split('_')[0]];
    if (rk && W > m(6) && D > m(6)) {
      for (let k = 1 + Math.floor(r() * 3); k > 0; k--) {
        const t = pick(r, rk.detail), q = m(1.4 + r() * 0.6), [x, z] = at(0.15 + r() * 0.7, 0.15 + r() * 0.7);
        // Each a little above the last, so where two overlap neither flickers through
        this.flat(this.bufFor(t), t, x - q / 2, z - q / 2, x + q / 2, z + q / 2, y + m(0.04 + 0.015 * k), (xx, zz) => [(xx - x + q / 2) / q, (z + q / 2 - zz) / q]);
      }
    }
    // Walk-ups and prewar buildings may carry an old timber water tower on a steel frame
    if ((style === 'walkup' || style === 'prewar') && W > m(9) && D > m(9) && this.rw() < 0.5) {
      const rw = this.rw;
      this.waterTower(T.x0 + W * (rw() < 0.5 ? 0.24 : 0.76), y, T.z0 + D * (rw() < 0.5 ? 0.26 : 0.74), 0.85 + rw() * 0.35);
    }
    if (R.mech) {
      // Mechanical penthouse wrapped in louvers
      const i = Math.min(W, D) * 0.22;
      const h = m(12);
      const [mw, mh] = tileMeters(R.mech);
      const x0 = T.x0 + i, x1 = T.x1 - i, z0 = T.z0 + i, z1 = T.z1 - i;
      const pm = wallMat(R.mech);
      this.vol({ t: 'box', x0, x1, z0, z1, y0: y, y1: y + h, sides: { n: pm, s: pm, e: pm, w: pm }, band: null, floors: [], roof: true });
      for (const [ax, az, bx, bz] of [[x0, z1, x1, z1], [x1, z0, x0, z0], [x1, z1, x1, z0], [x0, z0, x0, z1]]) {
        this.wall(this.bufFor(R.mech), R.mech, ax, az, bx, bz, y, y + h, m(mw), m(mh), { snapU: true, ao: false });
      }
      this.flat(sb, 'roof04', x0, z0, x1, z1, y + h, (x, z) => [x / m(6), -z / m(6)]);
      this.collide(x0, y, z0, x1, y + h, z1, { building: true });
      if (r() < 0.5) {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ah = m(15 + r() * 25);
        this.prop('cyl6', cx, y + h + ah / 2, cz, m(0.35), ah, m(0.35), [0.55, 0.56, 0.6]);
        this.prop('ico', cx, y + h + ah, cz, m(0.6), m(0.6), m(0.6), [1, 0.25, 0.2]);
      }
    }
    if (R.bulkhead && W > m(8) && D > m(8)) {
      const [x, z] = at(0.25 + r() * 0.5, 0.3 + r() * 0.4);
      const w = m(3.5), dd = m(4.5), h = m(3.2);
      this.slab(sb, pick(r, r() < 0.5 ? G.brick : G.panel), x - w / 2, z - dd / 2, x + w / 2, z + dd / 2, y, y + h, m(2.4), { top: 'roof04' });
      this.collide(x - w / 2, y, z - dd / 2, x + w / 2, y + h, z + dd / 2, { building: true });
    }
    for (let k = 0; k < (R.ac || 0); k++) {
      if (W < m(8) || D < m(8)) break;
      const [x, z] = at(0.15 + r() * 0.7, 0.15 + r() * 0.7);
      const s = m(1.6 + r() * 1.2), h = m(1.3);
      this.slab(sb, 'walls47', x - s / 2, z - s / 2, x + s / 2, z + s / 2, y, y + h, m(1.6), { top: pick(r, G.ac) });
    }
    if (r() < 0.35 && W > m(10) && D > m(10)) {
      const [x, z] = at(0.3 + r() * 0.4, 0.3 + r() * 0.4), s = m(3.2);
      this.flat(sb, pick(r, G.skylight), x - s / 2, z - s / 2, x + s / 2, z + s / 2, y + m(0.15), (xx, zz) => [(xx - x + s / 2) / s, (z + s / 2 - zz) / s]);
    }
    if (R.feature && W > m(7) && D > m(7)) {
      const [x, z] = at(0.3 + r() * 0.4, 0.3 + r() * 0.4);
      this.roofFeature(x, y, z, T, streets);
    }
  }

  /** Something on a roof: a garden, a steel tank, a mast, solar panels or a billboard facing the street */
  roofFeature(x, y, z, T, streets) {
    const m = (v) => this.m(v), r = this.r, q = r(), W = T.x1 - T.x0, D = T.z1 - T.z0;
    if (q < 0.25 && W > m(10) && D > m(10)) this.roofGarden(x, y, z, Math.min(W, D) * 0.6);
    else if (q < 0.45) {
      // A squat steel tank on a plinth
      const R = m(1.8 + r() * 0.8), H = m(3.5 + r() * 2), steel = [0.6, 0.62, 0.65];
      this.prop('box', x, y + m(0.3), z, R * 2.3, m(0.6), R * 2.3, [0.3, 0.3, 0.32]);
      this.prop('cyl', x, y + m(0.6) + H / 2, z, R, H, R, steel);
      this.prop('ring6', x, y + m(0.6) + H * 0.5, z, R * 1.03, m(0.15), R * 1.03, [0.35, 0.36, 0.38]);
      this.prop('sphere', x, y + m(0.6) + H, z, R, R * 0.35, R, steel);
      this.collide(x - R, y, z - R, x + R, y + m(0.6) + H, z + R, { building: true });
    } else if (q < 0.6) this.antenna(x, y, z, m(12 + r() * 10));
    else if (q < 0.8 && W > m(9) && D > m(9)) {
      // Rows of solar panels tilted to the sun
      const n = 2 + Math.floor(r() * 3), w = Math.min(W * 0.6, m(10));
      for (let i = 0; i < n; i++) this.prop('box', x, y + m(0.7), z + (i - (n - 1) / 2) * m(2.4), w, m(0.12), m(1.7), [0.07, 0.11, 0.24], 0, -0.45);
    } else if (streets.n || streets.s) {
      // A billboard at the front of the roof, facing the street
      const w = Math.min(W * 0.8, m(14)), zf = streets.n ? T.z0 + m(1.5) : T.z1 - m(1.5), dir = streets.n ? -1 : 1, yb = y + m(3);
      for (const dx of [-0.35, 0.35]) this.prop('box', x + dx * w, y + m(1.5), zf, m(0.3), m(3), m(0.3), [0.18, 0.18, 0.2]);
      const ax = x - (dir * w) / 2, bx = x + (dir * w) / 2;
      this.screen(ax, zf, bx, zf, yb, w, 0);
      this.collide(x - w / 2, y, zf - m(0.5), x + w / 2, yb + w * AD_ASPECT, zf + m(0.5));
    }
  }

  /**
   * A rooftop water tower: a timber tank bound with steel hoops under a conical cap, on a
   * platform carried by braced steel legs. s scales it (1: a 4.8 m tank on 5 m legs).
   */
  waterTower(x, y, z, s = 1) {
    const m = (v) => this.m(v) * s, rw = this.rw;
    const R = m(2.4), legH = m(4.6 + rw() * 1.6), tH = m(4.8), n = rw() < 0.5 ? 4 : 6, legR = R * 0.92;
    const steel = [0.06, 0.06, 0.065], wood = [0.17 + rw() * 0.05, 0.095 + rw() * 0.025, 0.05], hoop = [0.025, 0.025, 0.028], cap = [0.045, 0.04, 0.036];
    this.propMat = 'steel';
    const legs = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.PI / n;
      legs.push(new V3(x + Math.cos(a) * legR, y, z + Math.sin(a) * legR));
    }
    for (const p of legs) {
      this.prop('cyl6', p.x, y + legH / 2, p.z, m(0.16), legH, m(0.16), steel);
      this.prop('box', p.x, y + m(0.15), p.z, m(0.6), m(0.3), m(0.6), steel);
    }
    // Cross braces between neighboring legs, and a ring girder under the platform
    for (let k = 0; k < n; k++) {
      const a = legs[k], b = legs[(k + 1) % n];
      const ch = this.chunkOf(x, z);
      this.strut('cyl6', new V3(a.x, y + m(0.5), a.z), new V3(b.x, y + legH - m(0.4), b.z), m(0.06), steel, ch);
      this.strut('cyl6', new V3(b.x, y + m(0.5), b.z), new V3(a.x, y + legH - m(0.4), a.z), m(0.06), steel, ch);
      this.strut('box', new V3(a.x, y + legH, a.z), new V3(b.x, y + legH, b.z), m(0.22), steel, ch);
    }
    this.prop('cyl', x, y + legH + m(0.15), z, R * 1.08, m(0.3), R * 1.08, [0.09, 0.08, 0.07]);
    // The tank, its hoops and the cap
    this.propMat = 'wood';
    const ty = y + legH + m(0.3);
    this.prop('cyl', x, ty + tH / 2, z, R, tH, R, wood);
    this.prop('cone', x, ty + tH + m(0.7), z, R * 1.12, m(1.4), R * 1.12, cap);
    this.propMat = 'steel';
    for (let k = 0; k < 5; k++) this.prop('ring6', x, ty + m(0.4) + k * (tH - m(0.8)) / 4, z, R * 1.025, m(0.12), R * 1.025, hoop);
    this.prop('sphere', x, ty + tH + m(1.45), z, m(0.18), m(0.18), m(0.18), hoop);
    this.propMat = null;
    this.collide(x - R, y, z - R, x + R, ty + tH + m(1.4), z + R, { tower: true });
  }

  /** A planted roof: grass, a planter edge and a few small trees */
  roofGarden(x, y, z, s) {
    const m = (v) => this.m(v), grass = pick(this.r, G.grass), h = s / 2;
    this.flat(this.bufFor(grass), grass, x - h, z - h, x + h, z + h, y + m(0.05), (xx, zz) => [xx / m(4), -zz / m(4)]);
    for (const [ax, az, bx, bz] of [[x - h, z + h, x + h, z + h], [x + h, z - h, x - h, z - h], [x + h, z + h, x + h, z - h], [x - h, z - h, x - h, z + h]]) {
      this.wall(this.buf('surface', this.cur), 'walls53', ax, az, bx, bz, y, y + m(0.5), m(1.2), m(1.2), { ao: false });
    }
    const n = 2 + Math.floor(this.r() * 3);
    for (let i = 0; i < n; i++) this.tree(x + (this.r() - 0.5) * s * 0.7, y, z + (this.r() - 0.5) * s * 0.7, 0.5);
  }

  /** A communications mast: a pole with cross arms, a dish and a red beacon */
  antenna(x, y, z, h) {
    const m = (v) => this.m(v), steel = [0.55, 0.57, 0.6];
    this.prop('box', x, y + m(0.4), z, m(2.2), m(0.8), m(2.2), [0.3, 0.3, 0.32]);
    this.prop('cyl6', x, y + h / 2, z, m(0.25), h, m(0.25), steel);
    for (const f of [0.45, 0.65, 0.85]) this.prop('box', x, y + h * f, z, m(3) * (1.2 - f), m(0.12), m(0.12), steel, f * 2);
    this.prop('cone', x + m(0.8), y + h * 0.55, z, m(0.9), m(0.35), m(0.9), [0.85, 0.86, 0.88], 0, 0, Math.PI / 2);
    this.prop('sphere', x, y + h, z, m(0.45), m(0.45), m(0.45), [1.5, 0.25, 0.2]);
    this.collide(x - m(1.1), y, z - m(1.1), x + m(1.1), y + h, z + m(1.1));
  }

  /** A helipad marking on a roof, s across, with lights at its corners */
  helipad(x, y, z, s) {
    const m = (v) => this.m(v), h = s / 2, yy = y + m(0.06);
    this.sign('mark', 0, [[x - h, yy, z + h], [x + h, yy, z + h], [x + h, yy, z - h], [x - h, yy, z - h]], [0, 1, 0]);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) this.prop('sphere', x + dx * h * 0.92, y + m(0.2), z + dz * h * 0.92, m(0.25), m(0.2), m(0.25), [0.3, 1.3, 0.5]);
  }

  /**
   * A glowing billboard in a dark housing on the face of a wall from a to b (seen from outside),
   * centered on it, w wide and 16:9, its bottom at y, standing out from the wall.
   */
  screen(ax, az, bx, bz, y, w, out) {
    const m = (v) => this.m(v), dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    const h = w * AD_ASPECT, d = m(0.35), cx = (ax + bx) / 2 + nx * out, cz = (az + bz) / 2 + nz * out, fx = cx + nx * (d / 2 + m(0.03)), fz = cz + nz * (d / 2 + m(0.03));
    this.prop('box', cx, y + h / 2, cz, w + m(0.6), h + m(0.6), d, [0.07, 0.07, 0.08], Math.atan2(-uz, ux));
    const p = (sd, yy) => [fx + (ux * sd * w) / 2, yy, fz + (uz * sd * w) / 2];
    this.sign('screen', this.nextAd(), [p(-1, y), p(1, y), p(1, y + h), p(-1, y + h)], [nx, 0, nz]);
  }

  /** The next billboard ad: the pack is dealt out in a shuffled order, all of it before any repeats */
  nextAd() {
    if (!this.ads.length) {
      this.ads = BILLBOARDS.map((_, i) => i);
      for (let i = this.ads.length - 1; i > 0; i--) {
        const j = Math.floor(this.ra() * (i + 1));
        [this.ads[i], this.ads[j]] = [this.ads[j], this.ads[i]];
      }
    }
    return this.ads.pop();
  }

  /** A quad showing billboard ad idx (screen) or the helipad marking (mark): corners [BL, BR, TR, TL] */
  sign(kind, idx, P, n) {
    if (this.owner && kind === 'screen') this.vol({ t: 'plate', ax: P[0][0], az: P[0][2], bx: P[1][0], bz: P[1][2], y0: P[0][1], y1: P[2][1], mat: 'light' });
    const S = this.signs[kind], i0 = S.pos.length / 3;
    let u0 = 0, u1 = 1, v0 = 0, v1 = 1;
    if (kind === 'screen') {
      const [x, y, w, h] = BILLBOARDS[idx], A = ATLASES.billboards;
      u0 = x / A.w; u1 = (x + w) / A.w; v0 = 1 - (y + h) / A.h; v1 = 1 - y / A.h;
    }
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    P.forEach((q, k) => { S.pos.push(...q); S.nor.push(...n); S.uv.push(...uv[k]); });
    S.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  /** Meshes for the billboards (unlit, glowing) and the helipad markings */
  flushSigns() {
    const pad = helipadTexture();
    pad.anisotropy = 4;
    const mats = {
      screen: new THREE.MeshBasicMaterial({ map: this.tex.billboards, color: new THREE.Color(1.15, 1.15, 1.15) }),
      mark: new THREE.MeshStandardMaterial({ map: pad, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    };
    for (const [k, S] of Object.entries(this.signs)) {
      if (!S.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(S.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(S.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(S.uv, 2));
      g.setIndex(S.idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats[k]);
      mesh.receiveShadow = k === 'mark';
      mesh.matrixAutoUpdate = false;
      mesh.userData.mat = k;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      S.mesh = mesh;
    }
    for (const o of this.owners) o.ranges.push(...o.signRanges.filter((r) => this.signs[r.kind].mesh).map((r) => ({ mesh: this.signs[r.kind].mesh, i0: r.i0, i1: r.i1 })));
  }

  // ---- facades from panel kits ------------------------------------------------

  /**
   * Pick a facade from a panel kit: one window bay used throughout (so floors line up),
   * a pier for the corners and between groups of bays, a solid panel and a vent.
   * maxW: the narrowest street side in units, so bays and piers fit it.
   */
  kitFacade(kit, maxW) {
    const r = this.r, K = KITS[kit], wm = maxW / this.M;
    const fit = (list, w) => list.filter((n) => tileMeters(n)[0] <= w);
    const bays = fit(K.bays, wm * 0.8);
    const F = { kit, bay: bays.length ? pick(r, bays) : K.bays.reduce((a, b) => (tileMeters(a)[0] < tileMeters(b)[0] ? a : b)), group: 0 };
    const piers = fit(K.piers, Math.min(5, wm * 0.2));
    if (piers.length && r() < 0.85) {
      F.pier = pick(r, piers);
      // Bays between divider piers; 0 keeps piers to the corners
      F.group = r() < 0.45 ? 0 : 1 + Math.floor(r() * 4);
    }
    F.solid = K.solids.length ? pick(r, K.solids) : F.pier;
    // Vent floors: prefer louvers about a storey tall
    const vents = K.vents.filter((n) => tileMeters(n)[1] > 2.4 && tileMeters(n)[1] < 6.5);
    F.vent = vents.length ? pick(r, vents) : K.vents.length ? pick(r, K.vents) : null;
    if (F.vent) F.ventH = clamp(tileMeters(F.vent)[1], 3, 6);
    return F;
  }

  /**
   * Stack n repeats of a facade's bay up from y. Optionally a vent floor every `every`
   * repeats, one on top (a mechanical floor under a setback) and a solid crown band.
   * Returns the top and the bands as [y0, y1, tile, fit]; a fitted band scales its tile
   * to the band's height, the others show a slice of it.
   */
  kitStack(F, y, n, o = {}) {
    const m = (x) => this.m(x), bh = m(tileMeters(F.bay)[1]), bands = [];
    const band = (h, tile, fit) => { bands.push([y, y + h, tile, fit]); y += h; };
    for (let i = 1; i <= n; i++) {
      y += bh;
      if (F.vent && o.every && i % o.every === 0 && i < n) band(m(F.ventH), F.vent, true);
    }
    if (F.vent && o.ventTop) band(m(F.ventH), F.vent, true);
    if (F.solid && o.crown) band(m(1.8), F.solid, false);
    return { y, bands };
  }

  /**
   * One side of a building from its kit facade, a to b (left to right seen from outside),
   * y0..y1: piers at the corners and between groups of bays, every column tiling up the
   * floors, with full-width bands (vents, crown) cutting across. o: { tint, base, bands }
   */
  kitWall(F, ax, az, bx, bz, y0, y1, o = {}) {
    const m = (x) => this.m(x), len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3 || y1 - y0 < 1e-3) return;
    const [bw0, bh] = tileMeters(F.bay).map(m);
    const [pw, ph] = F.pier ? tileMeters(F.pier).map(m) : [0, 0];
    // Bays and divider piers: the bay count whose natural widths come closest to the side
    let n = Math.max(1, Math.round(len / bw0)), d = 0, piers = 0;
    if (F.pier && len > 2 * pw + bw0 * 0.6) {
      piers = 2;
      const div = (k) => (F.group ? Math.ceil(k / F.group) - 1 : 0);
      let best = Infinity;
      for (let k = 1; k <= Math.ceil(len / bw0) + 1; k++) {
        const err = Math.abs(len - k * bw0 - (div(k) + 2) * pw);
        if (err < best) { best = err; n = k; }
      }
      d = div(n);
      // Too squeezed: drop the dividers
      if ((len - (d + 2) * pw) / n < bw0 * 0.6) { d = 0; n = Math.max(1, Math.round((len - 2 * pw) / bw0)); }
    }
    const bw = (len - (d + piers) * pw) / n;
    // Spread the bays over g groups, symmetric about the middle where the counts allow
    const g = d + 1, sizes = new Array(g).fill(Math.floor(n / g));
    let rem = n % g;
    if (rem % 2 && g % 2) { sizes[d / 2]++; rem--; }
    for (let i = Math.floor(g / 2) - 1; i >= 0 && rem >= 2; i--, rem -= 2) { sizes[i]++; sizes[g - 1 - i]++; }
    if (rem) sizes[Math.floor(d / 2)]++;
    // Vertical spans between the bands
    const spans = [];
    let y = y0;
    for (const [ya, yb] of o.bands || []) { if (ya > y) spans.push([y, Math.min(ya, y1)]); y = Math.max(y, yb); }
    if (y < y1) spans.push([y, y1]);
    const dx = (bx - ax) / len, dz = (bz - az) / len, wo = { tint: o.tint, base: o.base, snapU: true };
    let s = 0;
    const column = (tile, w, k, th) => {
      const x0 = ax + dx * s, z0 = az + dz * s;
      s += w;
      for (const [ya, yb] of spans) this.wall(this.bufFor(tile), tile, x0, z0, ax + dx * s, az + dz * s, ya, yb, w / k, th, wo);
    };
    if (piers) column(F.pier, pw, 1, ph);
    sizes.forEach((k, i) => {
      if (i) column(F.pier, pw, 1, ph);
      column(F.bay, k * bw, k, bh);
    });
    if (piers) column(F.pier, pw, 1, ph);
    for (const [ya, yb, tile, fit] of o.bands || []) {
      if (ya >= y1) continue;
      const [tw, th] = tileMeters(tile).map(m), k = fit ? (yb - ya) / th : 1;
      this.wall(this.bufFor(tile), tile, ax, az, bx, bz, ya, Math.min(yb, y1), tw * k, th * k, wo);
    }
  }

  // ---- towers ----------------------------------------------------------------

  towerBlock(B, t, kind) {
    const r = this.r, m = (x) => this.m(x);
    const W = B.x1 - B.x0;
    const tw = Math.min(W * 0.65, m(52 + r() * 22));
    const at = r();
    const tx0 = B.x0 + (W - tw) * (at < 0.33 ? 0 : at < 0.66 ? 0.5 : 1), tx1 = tx0 + tw;
    // Fill the rest of the block with mid-rises
    const rest = [[B.x0, tx0], [tx1, B.x1]].filter(([a, b]) => b - a > m(6));
    const zm = (B.z0 + B.z1) / 2;
    for (const [a, b] of rest) {
      for (const [z0, z1, front] of [[B.z0, zm, 'n'], [zm, B.z1, 's']]) {
        for (const [x0, x1] of this.lots(a, b, 12, 28)) {
          const q = r();
          this.lotBuilding(q < 0.55 ? 'prewar' : q < 0.85 ? 'office' : 'walkup', x0, x1, z0, z1, front, { w: x0 <= B.x0 + 0.01, e: x1 >= B.x1 - 0.01 }, t * 0.7, B);
        }
      }
    }
    const streets = { n: true, s: true, e: tx1 >= B.x1 - 0.01, w: tx0 <= B.x0 + 0.01 };
    const f = { x0: tx0, x1: tx1, z0: B.z0, z1: B.z1 };
    this.beginOwner('tower');
    if (kind === 'glass') this.glassTower(f, streets, t);
    else if (kind === 'twist' || kind === 'prism') this.prismTower(f, t, kind === 'twist');
    else if (kind === 'stack') this.stackTower(f, streets, t);
    else if (kind === 'terraces') this.terraceTower(f, streets, t);
    else this.decoTower(f, streets, t, kind);
    this.endOwner();
  }

  glassTower(f, streets, t) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb;
    // Most towers are composed from a kit, the rest wrapped in one curtain-wall tile
    const F = r() < 0.7 ? this.kitFacade(pick(r, KIT_STYLE.tower), Math.min(f.x1 - f.x0, f.z1 - f.z0)) : null;
    const tile = F ? F.bay : pick(r, G.officeGlass), th = m(tileMeters(tile)[1]);
    const band = { tile: 'facade12', h: m(7.2) };
    let tiers = [], fp = { ...f }, y = y0 + band.h;
    const total = Math.round(m(120 + t * 150 + r() * 40) / th);
    const nt = 1 + Math.floor(r() * 3), every = Math.max(4, Math.round(m(55 + r() * 30) / th));
    let left = total;
    for (let i = 0; i < nt && fp && left > 0; i++) {
      const last = i === nt - 1;
      const n = last ? left : Math.min(left, Math.max(4, Math.round(left * (0.45 + r() * 0.2))));
      left -= n;
      // Kit towers get a mechanical floor under each setback and every so often up the shaft
      const S = F ? this.kitStack(F, y, n, { every, ventTop: !last && left > 0, crown: last || left <= 0 }) : { y: y + n * th };
      y = S.y;
      tiers.push({ ...fp, y1: y, tile, F, bands: S.bands, band: i === 0 ? band : null });
      fp = this.inset(fp, m(4 + r() * 4), { n: true, s: true, e: true, w: true });
    }
    this.building({
      x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1, y0, streets, allFacade: true, tint: this.tint(0.06), party: (F && F.solid) || 'walls05',
      tiers,
      // A third of them are topped with a crown instead of rooftop plant
      ...(r() < 0.35 ? { crown: (T) => this.crown(T) } : { roof: { tile: pick(this.r, this.r() < 0.65 ? G.roofFlat : G.roof), mech: (F && F.vent) || pick(this.r, G.mech), ac: 2 } }),
    });
  }

  decoTower(f, streets, t, kind) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb;
    // Half the deco towers are composed from a stone or brick kit, with bays narrow enough for the upper tiers
    const F = kind === 'deco' && r() < 0.5 ? this.kitFacade(pick(r, KIT_STYLE.deco), Math.min(f.x1 - f.x0, f.z1 - f.z0) * 0.5) : null;
    const tile = F ? F.bay : pick(r, G.officeStone);
    const [, thm] = tileMeters(tile), th = m(thm);
    const band = { tile: pick(r, G.stone), h: m(9) };
    // A broad base and a couple of shallow setbacks up to the crown
    const plan = r() < 0.5 ? [7, 10] : [6, 6, 8];
    const scale = (thm === 12 ? 1 : 12 / thm) * (0.55 + t * 0.45);
    let fp = { ...f }, y = y0 + band.h;
    const tiers = [];
    plan.forEach((n, i) => {
      if (!fp) return;
      const k = Math.max(2, Math.round(n * scale));
      y += k * th;
      tiers.push({ ...fp, y1: y, tile, F, band: i === 0 ? band : null });
      const step = i === 0 ? 0.12 : 0.08;
      fp = this.inset(fp, Math.min(fp.x1 - fp.x0, fp.z1 - fp.z0) * step, { n: true, s: true, e: true, w: true });
    });
    const tint = this.tint(0.05);
    this.building({
      x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1, y0, streets, allFacade: true, tint, party: 'walls50', tiers,
      crown: (T) => this.crown(T),
    });
  }

  /** A tower crown: a glass wedge, a glowing halo over a glass drum, or a steel lattice lantern around a needle */
  crown(T) {
    const m = (x) => this.m(x), sb = this.buf('surface', this.cur), r = this.r;
    const cx = (T.x0 + T.x1) / 2, cz = (T.z0 + T.z1) / 2, W = T.x1 - T.x0, D = T.z1 - T.z0;
    const q = r();
    if (q < 0.35) return this.wedge(T, pick(r, G.officeGlass), Math.max(W, D) * (0.5 + r() * 0.3), r() < 0.5);
    if (q < 0.7) {
      // Halo: a glass drum on the roof, and a ring of light held above it on four struts
      this.flat(sb, 'roof04', T.x0, T.z0, T.x1, T.z1, T.y1, (x, z) => [x / m(6), -z / m(6)]);
      const dr = Math.min(W, D) * 0.3, dh = Math.min(W, D) * 0.35, glass = pick(r, G.officeGlass);
      this.prismSeg(cx, cz, 10, dr, dr * 0.8, 0, T.y1, T.y1 + dh, glass, m(6), m(6), { top: 'roof04' });
      this.collide(cx - dr, T.y1, cz - dr, cx + dr, T.y1 + dh, cz + dr, { building: true });
      const R = Math.min(W, D) * 0.48, yr = T.y1 + dh + m(8), glow = pick(r, [[0.35, 1.5, 1.6], [1.6, 0.9, 0.3], [1.5, 0.35, 0.9]]);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        this.strut('pole', new V3(cx + Math.cos(a) * R * 0.9, T.y1, cz + Math.sin(a) * R * 0.9), new V3(cx + Math.cos(a) * R, yr, cz + Math.sin(a) * R), m(0.35), [0.3, 0.31, 0.33], this.cur);
      }
      this.prop('torus', cx, yr, cz, R, R, R, glow, 0, Math.PI / 2);
      this.prop('torus', cx, yr + m(5), cz, R * 0.7, R * 0.7, R * 0.7, glow, 0, Math.PI / 2);
      return;
    }
    // Lattice lantern: truss cards around a glass drum, a needle through the middle
    this.flat(sb, 'roof04', T.x0, T.z0, T.x1, T.z1, T.y1, (x, z) => [x / m(6), -z / m(6)]);
    const truss = pick(r, STRUCTS.steeltruss.truss), h = Math.min(W, D) * 0.5, e = m(1);
    for (const [ax, az, bx, bz] of [[T.x0 + e, T.z1 - e, T.x1 - e, T.z1 - e], [T.x1 - e, T.z0 + e, T.x0 + e, T.z0 + e], [T.x1 - e, T.z1 - e, T.x1 - e, T.z0 + e], [T.x0 + e, T.z0 + e, T.x0 + e, T.z1 - e]]) {
      this.card(truss, ax, az, bx, bz, T.y1, T.y1 + h, h * cell(truss).aspect);
    }
    const dr = Math.min(W, D) * 0.28, glass = pick(r, G.officeGlass);
    this.prismSeg(cx, cz, 8, dr, dr, 0, T.y1, T.y1 + h * 0.8, glass, m(6), m(6), { top: 'roof04' });
    this.collide(T.x0, T.y1, T.z0, T.x1, T.y1 + h * 0.8, T.z1, { building: true });
    const sh = h * 2.4;
    this.prop('cyl6', cx, T.y1 + h * 0.8 + sh / 2, cz, m(0.8), sh, m(0.8), [0.75, 0.77, 0.8]);
    this.prop('sphere', cx, T.y1 + h * 0.8 + sh, cz, m(0.9), m(0.9), m(0.9), [1.4, 0.25, 0.2]);
  }

  /**
   * A glass wedge roof over footprint T: flat at one edge, rising by h to the opposite edge
   * (across z, or across x when alongX)
   */
  wedge(T, tile, h, alongX) {
    const b = this.bufFor(tile), c = cell(tile), [twm, thm] = tileMeters(tile), tw = this.m(twm), th = this.m(thm);
    const { x0, x1, z0, z1 } = T, y = T.y1, o = { ao: false };
    if (alongX) {
      // Low at x0, high at x1
      const L = Math.hypot(x1 - x0, h);
      this.quad(b, [[x0, y, z0], [x0, y, z1], [x1, y + h, z1], [x1, y + h, z0]], [-h / L, (x1 - x0) / L, 0],
        [[0, 0], [(z1 - z0) / tw, 0], [(z1 - z0) / tw, L / th], [0, L / th]], c, WHITE);
      this.wall(b, tile, x1, z1, x1, z0, y, y + h, tw, th, o);
      this.skew(b, tile, x1, z0, x0, z0, y, y + h, y, y, tw, th);
      this.skew(b, tile, x0, z1, x1, z1, y, y, y, y + h, tw, th);
    } else {
      // Low at z0, high at z1
      const L = Math.hypot(z1 - z0, h);
      this.quad(b, [[x1, y, z0], [x0, y, z0], [x0, y + h, z1], [x1, y + h, z1]], [0, (z1 - z0) / L, -h / L],
        [[0, 0], [(x1 - x0) / tw, 0], [(x1 - x0) / tw, L / th], [0, L / th]], c, WHITE);
      this.wall(b, tile, x0, z1, x1, z1, y, y + h, tw, th, o);
      this.skew(b, tile, x1, z1, x1, z0, y, y + h, y, y, tw, th);
      this.skew(b, tile, x0, z0, x0, z1, y, y, y, y + h, tw, th);
    }
    this.collide(x0, y, z0, x1, y + h * 0.5, z1, { building: true });
  }

  /** Four-sided pyramid with planar-mapped faces */
  pyramid(b, tile, x0, z0, x1, z1, y0, y1, ts, tint = WHITE) {
    this.vol({ t: 'pyr', x0, x1, z0, z1, y0, y1, mat: 'panel' });
    const c = cell(tile), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const apex = new V3(cx, y1, cz);
    const P = [new V3(x0, y0, z1), new V3(x1, y0, z1), new V3(x1, y0, z0), new V3(x0, y0, z0)];
    for (let i = 0; i < 4; i++) {
      const a = P[i], bb = P[(i + 1) % 4];
      const mid = new V3().addVectors(a, bb).multiplyScalar(0.5);
      const R = new V3().subVectors(bb, a).normalize(), Up = new V3().subVectors(apex, mid).normalize();
      const uv = (p) => [_a.subVectors(p, a).dot(R) / ts, _a.subVectors(p, mid).dot(Up) / ts];
      const out = new V3(mid.x - cx, 0, mid.z - cz).normalize().setY(0.5);
      this.tri(b, [a, bb, apex], [uv(a), uv(bb), uv(apex)], c, tint, 0, out);
    }
  }

  // ---- signature buildings -------------------------------------------------------

  /**
   * One segment of a polygonal tower: n sides around (cx, cz), r0 to its corners at ya and r1 at
   * yb, turned by rot. Faces tile every tw by th with whole repeats across. o: { tint, top, bottom }
   * where top and bottom are cap tiles.
   */
  prismSeg(cx, cz, n, r0, r1, rot, ya, yb, tile, tw, th, o = {}) {
    this.vol({ t: 'prism', cx, cz, n, r0, r1, rot, y0: ya, y1: yb, mat: o.mat || wallMat(tile), floors: o.floors || this.floorsFor(ya, yb, th / this.M) });
    const b = this.bufFor(tile), c = cell(tile), tint = o.tint || WHITE;
    const V = (k, r, y) => { const a = rot + (k / n) * Math.PI * 2; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; };
    const nu = Math.max(1, Math.round((2 * Math.max(r0, r1) * Math.sin(Math.PI / n)) / tw)), vt = (yb - ya) / th;
    const h = yb - ya, dr = (r0 - r1) * Math.cos(Math.PI / n), nl = Math.hypot(h, dr);
    for (let k = 0; k < n; k++) {
      // From corner k + 1 to corner k, so the face looks outward
      const am = rot + ((k + 0.5) / n) * Math.PI * 2;
      this.quad(b, [V(k + 1, r0, ya), V(k, r0, ya), V(k, r1, yb), V(k + 1, r1, yb)], [Math.cos(am) * h / nl, dr / nl, Math.sin(am) * h / nl],
        [[0, 0], [nu, 0], [nu, vt], [0, vt]], c, tint);
    }
    if (o.top) this.polyCap(cx, cz, n, r1, rot, yb, o.top, true);
    if (o.bottom) this.polyCap(cx, cz, n, r0, rot, ya, o.bottom, false);
  }

  /** A flat polygon cap (up or down) for a polygonal tower segment */
  polyCap(cx, cz, n, r, rot, y, tile, up) {
    const b = this.bufFor(tile), c = cell(tile), ts = this.m(6), C = new V3(cx, y, cz), want = new V3(0, up ? 1 : -1, 0);
    const V = (k) => { const a = rot + (k / n) * Math.PI * 2; return new V3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); };
    const uv = (p) => [p.x / ts, -p.z / ts];
    for (let k = 0; k < n; k++) { const p = V(k), q = V(k + 1); this.tri(b, [C, p, q], [uv(C), uv(p), uv(q)], c, WHITE, 0, want); }
  }

  /** The largest street-square box inside a polygon of n sides, r to its corners, turned by rot: its half-width */
  innerHalf(n, r, rot) {
    const rin = r * Math.cos(Math.PI / n);
    if (n !== 4) return rin * 0.75;
    const f = rot + Math.PI / 4;
    return rin / (Math.abs(Math.cos(f)) + Math.abs(Math.sin(f)));
  }

  /** A tower that twists as it rises (square floors, each a little turned), or a tapering octagon or hexagon */
  prismTower(f, t, twist) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb;
    const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, half = Math.min(f.x1 - f.x0, f.z1 - f.z0) / 2;
    const n = twist ? 4 : pick(r, [6, 8, 8]), R = half * (twist ? 0.98 : 0.92);
    const tile = r() < 0.5 ? pick(r, G.officeGlass) : pick(r, KITS[pick(r, KIT_STYLE.tower)].bays);
    const [tw, th] = tileMeters(tile).map(m), tint = this.tint(0.05);
    // A glass lobby box over the whole lot
    this.building({
      x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1, y0, streets: { n: true, s: true, e: true, w: true }, allFacade: true, tint,
      party: 'walls05', tiers: [{ ...f, y1: y0 + m(10), tile: 'facade12' }], roof: { tile: 'roof04' },
    });
    const per = 2 * th, nseg = Math.max(8, Math.round(m(150 + t * 170 + r() * 60) / per));
    const turn = twist ? (Math.PI / 2) * (0.7 + r() * 0.6) * (r() < 0.5 ? 1 : -1) : 0;
    let y = y0 + m(10);
    for (let i = 0; i < nseg; i++) {
      // Squares start square to the streets; polygons taper over their top fifth
      const rot = Math.PI / 4 + (turn * i) / nseg, k = (j) => (twist ? 1 : 1 - Math.max(0, j / nseg - 0.8) * 1.6);
      const ra = R * k(i), rb = R * k(i + 1), last = i === nseg - 1;
      this.prismSeg(cx, cz, n, ra, rb, rot, y, y + per, tile, tw, th, { tint, top: twist || last ? 'roof04' : null, bottom: twist ? 'walls05' : null });
      const hh = this.innerHalf(n, Math.min(ra, rb), rot);
      this.collide(cx - hh, i ? y : 0, cz - hh, cx + hh, y + per, cz + hh, { building: true });
      y += per;
    }
    const rTop = R * (twist ? 1 : 0.68);
    if (twist && r() < 0.6) this.helipad(cx, y, cz, this.innerHalf(4, rTop, Math.PI / 4 + turn) * 1.6);
    else {
      const sh = m(26 + r() * 20);
      this.prop('cone', cx, y + sh / 2, cz, rTop * 0.35, sh, rTop * 0.35, [0.72, 0.74, 0.78]);
      this.prop('sphere', cx, y + sh, cz, m(0.8), m(0.8), m(0.8), [1.4, 0.25, 0.2]);
    }
  }

  /** A box of a block-built tower: facades all round, a roof, an underside if it floats, and a collider */
  boxBlock(B, tile, tint, soffit) {
    const m = (x) => this.m(x), [tw, th] = tileMeters(tile).map(m), base = this.L.curb;
    const wm = wallMat(tile);
    this.vol({ t: 'box', x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, y0: soffit ? B.ya : 0, y1: B.yb, sides: { n: wm, s: wm, e: wm, w: wm }, band: null, floors: this.floorsFor(B.ya, B.yb, th / this.M), roof: true });
    for (const [ax, az, bx, bz] of [[B.x0, B.z1, B.x1, B.z1], [B.x1, B.z0, B.x0, B.z0], [B.x1, B.z1, B.x1, B.z0], [B.x0, B.z0, B.x0, B.z1]]) {
      this.wall(this.bufFor(tile), tile, ax, az, bx, bz, B.ya, B.yb, tw, th, { snapU: true, tint, base });
    }
    this.flat(this.buf('surface', this.cur), 'roof04', B.x0, B.z0, B.x1, B.z1, B.yb, (x, z) => [x / m(6), -z / m(6)]);
    if (soffit) this.under(this.buf('surface', this.cur), 'walls05', B.x0, B.z0, B.x1, B.z1, B.ya, (x, z) => [x / m(3.2), z / m(3.2)], [0.7, 0.7, 0.72]);
    this.collide(B.x0, soffit ? B.ya : 0, B.z0, B.x1, B.yb, B.z1, { building: true });
  }

  /**
   * A stack of shifted boxes, alternating two facades. Boxes above the street wall may hang
   * out over the sidewalks, but always rest well on the box below.
   */
  stackTower(f, streets, t) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb, W = f.x1 - f.x0, D = f.z1 - f.z0;
    const tiles = [pick(r, G.officeGlass), pick(r, KITS[pick(r, KIT_STYLE.office)].bays)], tint = this.tint(0.05);
    const top = y0 + m(110 + t * 120 + r() * 40);
    let y = y0, i = 0, prev = null;
    while (y < top) {
      const tile = tiles[i % 2], th = m(tileMeters(tile)[1]), h = Math.max(1, Math.round(m(14 + r() * 14) / th)) * th;
      const w = W * (0.5 + r() * 0.25), d = D * (0.5 + r() * 0.25), over = y > y0 + m(25) ? m(5) : 0;
      const lx = f.x0 - (streets.w ? over : 0), hx = f.x1 + (streets.e ? over : 0), lz = f.z0 - over, hz = f.z1 + over;
      // Each box swings to the other side of the one below, along one axis or the other
      const side = i % 2 ? 1 : 0, alongX = r() < 0.5;
      let x0 = alongX ? (side ? hx - w : lx) : lx + r() * (hx - lx - w), z0 = alongX ? lz + r() * (hz - lz - d) : (side ? hz - d : lz);
      if (prev) {
        x0 = clamp(x0, prev.x0 - w * 0.6, prev.x1 - w * 0.4);
        z0 = clamp(z0, prev.z0 - d * 0.6, prev.z1 - d * 0.4);
        x0 = clamp(x0, lx, hx - w); z0 = clamp(z0, lz, hz - d);
      }
      prev = { x0, z0, x1: x0 + w, z1: z0 + d, ya: y, yb: y + h };
      this.boxBlock(prev, tile, tint, i > 0);
      y += h; i++;
    }
    const cx = (prev.x0 + prev.x1) / 2, cz = (prev.z0 + prev.z1) / 2, s = Math.min(prev.x1 - prev.x0, prev.z1 - prev.z0);
    if (r() < 0.5) this.helipad(cx, y, cz, s * 0.7);
    else this.roofGarden(cx, y, cz, s * 0.7);
  }

  /** A gate: two towers at the ends of the block joined by a bridge of floors high over a plaza */
  gateBlock(B, t) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb, W = B.x1 - B.x0;
    const tile = pick(r, KITS[pick(r, KIT_STYLE.tower)].bays), span = pick(r, G.officeGlass), tint = this.tint(0.04);
    const legW = m(28), H = y0 + m(160 + t * 50), hb = m(42);
    this.beginOwner('gate');
    this.boxBlock({ x0: B.x0, x1: B.x0 + legW, z0: B.z0, z1: B.z1, ya: y0, yb: H }, tile, tint, false);
    this.boxBlock({ x0: B.x1 - legW, x1: B.x1, z0: B.z0, z1: B.z1, ya: y0, yb: H }, tile, tint, false);
    this.boxBlock({ x0: B.x0 + legW, x1: B.x1 - legW, z0: B.z0 + m(6), z1: B.z1 - m(6), ya: H - hb, yb: H }, span, tint, true);
    // A helipad on one leg, a mast on the other
    this.helipad(B.x0 + legW / 2, H, (B.z0 + B.z1) / 2, legW * 0.8);
    this.antenna(B.x1 - legW / 2, H, (B.z0 + B.z1) / 2, m(38));
    this.endOwner();
    // The plaza under the gate, with trees and a fountain
    const pave = pick(this.rg, Object.values(GROUND).flatMap((k) => k.plaza).concat(['paveB04']));
    const [pw, ph] = PANELS[pave] ? tileMeters(pave).map(m) : [m(5), m(5)];
    this.flat(this.groundBuf(pave, true), pave, B.x0 + legW, B.z0, B.x1 - legW, B.z1, y0 + m(0.05), (x, z) => [x / pw, -z / ph]);
    const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
    for (const dz of [-1, 1]) for (let i = 0; i < 4; i++) this.tree(B.x0 + legW + m(8) + i * (W - 2 * legW - m(16)) / 3, y0, cz + dz * m(20), 0.85);
    this.beginOwner('fountain');
    this.propMat = 'stone';
    this.prop('cyl', cx, y0 + m(0.4), cz, m(7), m(0.8), m(7), [0.62, 0.62, 0.64]);
    this.prop('cyl', cx, y0 + m(0.85), cz, m(6.3), m(0.08), m(6.3), [0.22, 0.38, 0.45]);
    this.propMat = null;
    this.collide(cx - m(5), 0, cz - m(5), cx + m(5), y0 + m(0.8), cz + m(5), { low: true });
    this.endOwner();
    this.fountains.push(new V3(cx, y0 + m(1), cz));
  }

  /** Twin towers on a podium, joined by a sky bridge */
  twinsBlock(B, t) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb, W = B.x1 - B.x0, cz = (B.z0 + B.z1) / 2;
    const all = { n: true, s: true, e: true, w: true }, yp = y0 + m(14), tint = this.tint(0.04);
    this.beginOwner('twins');
    this.building({
      x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, y0, streets: all, allFacade: true, tint, party: 'walls05',
      tiers: [{ x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, y1: yp, tile: 'facade12', band: { tile: pick(r, G.ground), h: m(4.5) } }],
      roof: { tile: 'roof04', ac: 2 },
    });
    const tile = r() < 0.5 ? pick(r, G.officeGlass) : pick(r, KITS[pick(r, KIT_STYLE.tower)].bays), th = m(tileMeters(tile)[1]);
    const s = m(15), H = yp + Math.round(m(180 + t * 60) / th) * th, xs = [B.x0 + W * 0.27, B.x0 + W * 0.73];
    for (const x of xs) {
      const f = { x0: x - s, x1: x + s, z0: cz - s, z1: cz + s }, top = this.inset(f, m(3), all);
      this.building({
        ...f, y0: yp, streets: all, allFacade: true, tint, party: 'walls05',
        tiers: [{ ...f, y1: H - 4 * th, tile }, { ...top, y1: H, tile }], roof: { tile: 'roof04', mech: pick(r, G.mech), ac: 1 },
      });
    }
    // Two-floor glass bridge between them, a little over halfway up
    const yb = yp + Math.round((H - yp) * 0.58 / th) * th;
    this.boxBlock({ x0: xs[0] + s, x1: xs[1] - s, z0: cz - m(5), z1: cz + m(5), ya: yb, yb: yb + m(9) }, 'facade12', [0.95, 1, 1.05], true);
    this.endOwner();
  }

  /** A ziggurat stepping in every few floors, each terrace planted with grass and trees */
  terraceTower(f, streets, t) {
    const r = this.r, m = (x) => this.m(x), y0 = this.L.curb, all = { n: true, s: true, e: true, w: true };
    const F = this.kitFacade(pick(r, ['precast', 'limestone', 'concrete', 'travertine', 'ivory']), Math.min(f.x1 - f.x0, f.z1 - f.z0) * 0.4);
    const th = m(tileMeters(F.bay)[1]), per = Math.max(3, Math.round(m(16 + t * 10) / th)), nt = 6 + Math.floor(r() * 3);
    let fp = { ...f }, y = y0 + m(6);
    const tiers = [];
    for (let i = 0; i < nt && fp; i++) {
      y += per * th;
      tiers.push({ ...fp, y1: y, tile: F.bay, F, band: i === 0 ? { tile: pick(r, G.stone), h: m(6) } : null, roofTile: pick(r, G.grass) });
      fp = this.inset(fp, m(4.5), all);
    }
    tiers[tiers.length - 1].roofTile = null;
    this.building({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1, y0, streets, allFacade: true, tint: this.tint(0.05), party: 'walls50', tiers, roof: { tile: 'roof04', ac: 1 } });
    // Trees along the middle of each terrace
    tiers.slice(0, -1).forEach((T, i) => {
      const N = tiers[i + 1];
      for (const z of [(T.z0 + N.z0) / 2, (T.z1 + N.z1) / 2]) for (let x = T.x0 + m(5); x < T.x1 - m(4); x += m(10)) this.tree(x, T.y1, z, 0.55);
      for (const x of [(T.x0 + N.x0) / 2, (T.x1 + N.x1) / 2]) for (let z = N.z0 + m(4); z < N.z1 - m(3); z += m(10)) this.tree(x, T.y1, z, 0.55);
    });
  }

  /**
   * The city's landmark: an observation needle. A lobby drum, a tapering twelve-sided concrete
   * shaft, a flared pod with a glass viewing ring and a mast with beacons.
   */
  needleBlock(B) {
    const m = (x) => this.m(x), y0 = this.L.curb, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
    const concrete = STRUCTS.overpass.slab[0], glass = 'office00', c4 = m(4);
    this.flat(this.buf('decal'), 'paveB32', B.x0, B.z0, B.x1, B.z1, y0 + m(0.05), (x, z) => [x / m(4), -z / m(4)]);
    this.beginOwner('needle');
    // Lobby drum with a planted roof
    this.prismSeg(cx, cz, 12, m(26), m(24), 0, y0, y0 + m(9), 'facade12', m(7.2), m(9), { top: pick(this.r, G.grass) });
    this.collide(cx - m(18), 0, cz - m(18), cx + m(18), y0 + m(9), cz + m(18), { building: true });
    // Shaft
    const yS = y0 + m(250), segs = 10;
    for (let i = 0; i < segs; i++) {
      const ya = y0 + m(9) + (yS - y0 - m(9)) * i / segs, yb = y0 + m(9) + (yS - y0 - m(9)) * (i + 1) / segs;
      const ra = m(12 - 5 * i / segs), rb = m(12 - 5 * (i + 1) / segs);
      this.prismSeg(cx, cz, 12, ra, rb, 0, ya, yb, concrete, c4, c4, { mat: 'concrete', floors: [ya] });
      const hh = rb * 0.68;
      this.collide(cx - hh, ya, cz - hh, cx + hh, yb, cz + hh);
    }
    // Pod: underside flaring out, a viewing ring of glass, a deck and a cap
    const yp = yS - m(18);
    this.prismSeg(cx, cz, 12, m(7.5), m(22), 0, yp, yp + m(8), concrete, c4, c4, { bottom: concrete });
    this.prismSeg(cx, cz, 12, m(22), m(22), 0, yp + m(8), yp + m(18), glass, m(6), m(5));
    this.prismSeg(cx, cz, 12, m(24), m(24), 0, yp + m(18), yp + m(20), concrete, c4, c4, { bottom: concrete });
    this.prismSeg(cx, cz, 12, m(17), m(9), 0, yp + m(20), yp + m(28), 'roof42', c4, c4, { top: 'roof04' });
    this.collide(cx - m(15), yp, cz - m(15), cx + m(15), yp + m(28), cz + m(15), { building: true });
    // Mast with rings and beacons
    const ym = yp + m(28), sh = m(70);
    this.prop('cyl6', cx, ym + sh / 2, cz, m(1.4), sh, m(1.4), [0.82, 0.84, 0.88]);
    for (const f of [0.2, 0.45, 0.7]) this.prop('cyl', cx, ym + sh * f, cz, m(3.2 - f * 2.5), m(1), m(3.2 - f * 2.5), [0.7, 0.72, 0.76]);
    this.prop('sphere', cx, ym + sh, cz, m(1.3), m(1.3), m(1.3), [1.5, 0.25, 0.2]);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      this.prop('sphere', cx + Math.cos(a) * m(24.3), yp + m(19), cz + Math.sin(a) * m(24.3), m(0.6), m(0.6), m(0.6), [1.5, 0.3, 0.2]);
    }
    this.endOwner();
    this.landmark = new V3(cx, yp + m(14), cz);
  }

  plazaBlock(B) {
    const m = (x) => this.m(x), r = this.r, g = this.buf('decal'), y0 = this.L.curb;
    // Setts, herringbone brick or pavers from the ground kits, at their own size
    const pave = pick(this.rg, Object.values(GROUND).flatMap((k) => k.plaza).concat(['paveB04']));
    const [pw, ph] = PANELS[pave] ? tileMeters(pave).map(m) : [m(5), m(5)];
    this.flat(this.groundBuf(pave, true), pave, B.x0, B.z0 + m(3), B.x1, B.z1 - m(3), y0 + m(0.05), (x, z) => [x / pw, -z / ph]);
    // Granite border bands
    for (const [x0, z0, x1, z1] of [[B.x0, B.z0, B.x1, B.z0 + m(3)], [B.x0, B.z1 - m(3), B.x1, B.z1]]) {
      this.flat(g, 'paveB32', x0, z0, x1, z1, y0 + m(0.05), (x, z) => [x / m(3), -z / m(3)]);
    }
    // Planters with trees along the long sides
    for (let i = 0; i < 8; i++) {
      for (const z of [B.z0 + m(9), B.z1 - m(9)]) {
        const x = B.x0 + m(12) + i * (B.x1 - B.x0 - m(24)) / 7;
        this.planter(x, z, m(4.5));
        this.tree(x, y0 + m(0.8), z, 0.85);
      }
    }
    // An armillary of three great steel rings on a low drum
    const cx = B.x0 + (B.x1 - B.x0) * 0.82, cz = (B.z0 + B.z1) / 2, s = m(6.5);
    this.beginOwner('armillary');
    this.prop('cyl', cx, y0 + m(0.4), cz, m(3), m(0.8), m(3), [0.3, 0.31, 0.33]);
    this.prop('torus', cx, y0 + m(0.8) + s, cz, s, s, s, [0.8, 0.82, 0.86], 0.5);
    this.prop('torus', cx, y0 + m(0.8) + s, cz, s * 0.9, s * 0.9, s * 0.9, [0.8, 0.82, 0.86], 0.5 + Math.PI / 2);
    this.prop('torus', cx, y0 + m(0.8) + s, cz, s * 0.8, s * 0.8, s * 0.8, [1.1, 0.45, 0.12], 0.5, Math.PI / 2 - 0.35);
    this.collide(cx - s, 0, cz - s, cx + s, y0 + m(0.8) + 2 * s, cz + s, { building: true });
    this.endOwner();
    this.spawn = new V3((B.x0 + B.x1) / 2 - m(14), y0, cz);
    this.spawnBlock = B;
  }

  planter(x, z, s) {
    const m = (v) => this.m(v), y0 = this.L.curb;
    this.beginOwner('planter');
    const sb = this.buf('surface', this.cur), g = this.buf('decal');
    this.slab(sb, 'walls53', x - s / 2, z - s / 2, x + s / 2, z + s / 2, y0, y0 + m(0.8), m(1.2), { tint: [0.9, 0.9, 0.88], mat: 'stone' });
    this.flat(g, pick(this.r, ['planter20', 'planter40', 'planter00']), x - s / 2, z - s / 2, x + s / 2, z + s / 2, y0 + m(0.81), (xx, zz) => [(xx - x + s / 2) / s, (z + s / 2 - zz) / s]);
    this.collide(x - s / 2, y0, z - s / 2, x + s / 2, y0 + m(0.8), z + s / 2, { prop: true, walk: true });
    this.treeBlocks.push({ min: new V3(x - s / 2, y0, z - s / 2), max: new V3(x + s / 2, y0 + m(0.8), z + s / 2) });
    this.endOwner();
  }

  /** A street tree in a pit set into the sidewalk */
  streetTree(x, z) {
    const pits = Object.values(GROUND).flatMap((k) => k.pit), y = this.L.curb;
    if (pits.length) {
      const t = pick(this.rg, pits), s = this.m(1.3);
      this.flat(this.groundBuf(t, true), t, x - s / 2, z - s / 2, x + s / 2, z + s / 2, y + this.m(0.02), (xx, zz) => [(xx - x + s / 2) / s, (z + s / 2 - zz) / s]);
    }
    this.tree(x, y, z, 0.8);
  }

  /**
   * A tree of a species (see SPECIES in trees.js; street trees by default), scale times its usual
   * size. Trees are shaped, drawn and simulated by trees.js. rng: the draws to use, so the forest
   * doesn't shift the rest of the city.
   */
  tree(x, y, z, scale = 1, species = null, rng = this.r) {
    this.treeSpots.push({ x, y, z, scale, species: species || pick(rng, STREET_TREES), seed: Math.floor(rng() * 1e9) });
  }

  parkBlock(B, fountain) {
    const m = (x) => this.m(x), r = this.r, g = this.buf('decal'), y0 = this.L.curb;
    const gs = m(4);
    // Lawn quadrants split by two crossing paths
    const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, pw = m(5);
    const quads = [[B.x0, B.z0, cx - pw, cz - pw], [cx + pw, B.z0, B.x1, cz - pw], [B.x0, cz + pw, cx - pw, B.z1], [cx + pw, cz + pw, B.x1, B.z1]];
    for (const [x0, z0, x1, z1] of quads) {
      const t = pick(r, G.grass);
      this.flat(g, t, x0 + m(1), z0 + m(1), x1 - m(1), z1 - m(1), y0 + m(0.18), (x, z) => [x / gs, -z / gs], 0, [0.95, 1, 0.92]);
    }
    this.flat(g, 'paveA22', B.x0, B.z0, B.x1, B.z1, y0 + m(0.05), (x, z) => [x / m(3), -z / m(3)]);
    // Trees scattered over the lawns
    for (const [x0, z0, x1, z1] of quads) {
      const n = Math.round(((x1 - x0) * (z1 - z0)) / (m(14) * m(14)));
      for (let i = 0; i < n; i++) this.tree(x0 + m(4) + r() * (x1 - x0 - m(8)), y0, z0 + m(4) + r() * (z1 - z0 - m(8)), 0.9 + r() * 0.4);
    }
    if (fountain) {
      const R = m(9);
      this.beginOwner('fountain');
      this.propMat = 'stone';
      this.prop('cyl', cx, y0 + m(0.45), cz, R, m(0.9), R, [0.72, 0.7, 0.66]);
      this.prop('cyl', cx, y0 + m(0.92), cz, R * 0.9, m(0.08), R * 0.9, [0.22, 0.38, 0.45]);
      this.prop('cyl', cx, y0 + m(2), cz, m(1.5), m(3), m(1.5), [0.72, 0.7, 0.66]);
      this.propMat = null;
      this.endOwner();
      this.fountains.push(new V3(cx, y0 + m(3.4), cz));
      this.treeBlocks.push({ min: new V3(cx - R * 0.8, 0, cz - R * 0.8), max: new V3(cx + R * 0.8, y0 + m(0.9), cz + R * 0.8) });
      this.treeBlocks.push({ min: new V3(cx - m(1.5), 0, cz - m(1.5)), max: new V3(cx + m(1.5), y0 + m(3.5), cz + m(1.5)) });
    }
  }

  /**
   * The forest between the city and the west esplanade: a floor of grass and moss, gravel trails
   * carrying the cross streets through it and one down its length, and stands of trees that
   * drift from oak, beech and maple woods into pines, cedars and tall redwoods.
   */
  buildForest() {
    const L = this.L, m = (x) => this.m(x), r = this.rf, y0 = L.curb;
    const x0 = L.wx, x1 = L.x0, z0 = L.zN, z1 = L.z1 - L.stWalk;
    // The floor, in patches so it doesn't repeat in a grid
    const P = m(48);
    for (let x = x0; x < x1 - 1e-3; x += P) {
      for (let z = z0; z < z1 - 1e-3; z += P) {
        const xa = x, xb = Math.min(x1, x + P), za = z, zb = Math.min(z1, z + P), t = pick(r, G.grass.slice(0, 11)), k = 0.48 + r() * 0.14;
        this.cur = this.chunkOf((xa + xb) / 2, (za + zb) / 2);
        this.flat(this.groundBuf(t), t, xa, za, xb, zb, y0, (xx, zz) => [xx / m(5), -zz / m(5)], 3, [k * 1.05, k, k * 0.72]);
      }
    }
    this.collide(x0, 0, z0, x1, y0, z1, { low: true });
    // Trails: each cross street carries on through the forest, and one runs its length
    const gravel = ROOF_KITS.rf02.cover.concat(ROOF_KITS.rf18.cover.slice(0, 2)), tw = m(3.2), xm = (x0 + x1) / 2 + m(12);
    const trails = [];
    const trail = (ax, az, bx, bz) => {
      trails.push([ax, az, bx, bz]);
      const t = pick(r, gravel), alongZ = ax === bx;
      for (let a = alongZ ? az : ax, e = alongZ ? bz : bx; a < e - 1e-3; a += m(40)) {
        const b = Math.min(e, a + m(40));
        this.cur = this.chunkOf(alongZ ? ax : (a + b) / 2, alongZ ? (a + b) / 2 : az);
        // (the trail down the wood a little over those across it, where they cross)
        if (alongZ) this.flat(this.bufFor(t), t, ax - tw / 2, a, ax + tw / 2, b, y0 + m(0.045), (xx, zz) => [xx / m(4), -zz / m(4)], 0, [0.85, 0.82, 0.75]);
        else this.flat(this.bufFor(t), t, a, az - tw / 2, b, az + tw / 2, y0 + m(0.03), (xx, zz) => [xx / m(4), -zz / m(4)], 0, [0.85, 0.82, 0.75]);
      }
    };
    for (const st of L.sts) trail(x0, (st.z0 + st.z1) / 2, x1, (st.z0 + st.z1) / 2);
    trail(xm, z0, xm, z1);
    const nearTrail = (x, z, d) => trails.some(([ax, az, bx, bz]) => (ax === bx ? Math.abs(x - ax) < d && z > az - d && z < bz + d : Math.abs(z - az) < d && x > ax - d && x < bx + d));
    // Stands: a smooth field picks broadleaf or conifer woods, with groves of redwoods
    const field = (x, z) => Math.sin(x / m(83) + 1.3) * Math.cos(z / m(127) - 0.4) + 0.5 * Math.sin((x + z) / m(61));
    const grove = (x, z) => Math.sin(x / m(37) - 2.1) * Math.sin(z / m(53) + 0.7);
    const S = m(10);
    for (let x = x0 + S * 0.5; x < x1 - m(2); x += S) {
      for (let z = z0 + S * 0.5; z < z1 - m(4); z += S) {
        const tx = clamp(x + (r() - 0.5) * S * 0.9, x0 + m(3), x1 - m(3)), tz = z + (r() - 0.5) * S * 0.9;
        if (nearTrail(tx, tz, m(3.2))) continue;
        const f = field(tx, tz) + (r() - 0.5) * 0.8, g = grove(tx, tz);
        // Woods grow taller than street trees: 15 to 30 m, the redwoods half again
        let sp, sc = 1.25 + r() * 0.75;
        if (f > 0.25) {
          if (g > 0.5 && r() < 0.75) { sp = 'redwood'; sc = 1.9 + r() * 0.9; } else sp = pick(r, ['pine', 'pine', 'cedar', 'spruce', 'fir']);
        } else sp = pick(r, ['oak', 'beech', 'maple', 'birch', 'elm', 'linden', 'poplar', 'oak']);
        this.cur = this.chunkOf(tx, tz);
        this.tree(tx, y0, tz, sc, sp, r);
      }
    }
    // A few fallen logs and boulders along the trails
    for (let i = 0; i < 70; i++) {
      const x = x0 + m(6) + r() * (x1 - x0 - m(12)), z = z0 + r() * (z1 - z0);
      if (!nearTrail(x, z, m(6))) continue;
      this.cur = this.chunkOf(x, z);
      if (r() < 0.5) this.prop('ico', x, y0 + m(0.4), z, m(1 + r()), m(0.7 + r() * 0.5), m(1 + r()), [0.42, 0.41, 0.38], r() * 6);
      else this.prop('cyl6', x, y0 + m(0.4), z, m(0.4), m(5 + r() * 4), m(0.4), [0.3, 0.22, 0.15], r() * 6, 0, Math.PI / 2);
    }
  }

  // ---- street furniture --------------------------------------------------------

  buildFurniture() {
    const L = this.L, m = (x) => this.m(x), r = this.r, y0 = L.curb;
    const gray = [0.33, 0.35, 0.37], dark = [0.13, 0.13, 0.14], lamp = [1.25, 1.18, 0.95];
    const streetLight = (x, z, dx, dz) => {
      const h = m(9);
      this.beginOwner('lamp');
      this.prop('pole', x, y0 + h / 2, z, m(0.13), h, m(0.13), gray);
      this.prop('box', x + dx * m(1.3), y0 + h, z + dz * m(1.3), Math.abs(dx) * m(2.6) + m(0.14), m(0.14), Math.abs(dz) * m(2.6) + m(0.14), gray);
      this.prop('box', x + dx * m(2.6), y0 + h - m(0.12), z + dz * m(2.6), m(0.7), m(0.22), m(0.7), lamp);
      this.collide(Math.min(x, x + dx * m(3)) - m(0.4), y0, Math.min(z, z + dz * m(3)) - m(0.4), Math.max(x, x + dx * m(3)) + m(0.4), y0 + h + m(0.3), Math.max(z, z + dz * m(3)) + m(0.4), { prop: true, walk: true });
      this.endOwner();
    };
    for (const B of L.blocks) {
      this.cur = this.chunkOf((B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2);
      const xs0 = B.x0 - L.aveWalk + m(0.8), xs1 = B.x1 + L.aveWalk - m(0.8);
      const zs0 = B.z0 - L.stWalk + m(0.8), zs1 = B.z1 + L.stWalk - m(0.8);
      // Lights and street trees along the side streets, each kept on its own block's sidewalk (the
      // last step's offsets would otherwise reach past the corner into the avenue)
      const onBlock = (x) => x < B.x1 - m(3);
      for (let x = B.x0 + m(14); x < B.x1 - m(10); x += m(46)) {
        streetLight(x, zs0, 0, -1);
        if (onBlock(x + m(23))) streetLight(x + m(23), zs1, 0, 1);
        if (B.playable && r() < 0.55 && onBlock(x + m(10))) this.streetTree(x + m(10), zs0 + m(0.6));
        if (B.playable && r() < 0.55 && onBlock(x + m(33))) this.streetTree(x + m(33), zs1 - m(0.6));
      }
      for (let z = B.z0 + m(20); z < B.z1 - m(10); z += m(60)) {
        streetLight(xs0, z, -1, 0);
        streetLight(xs1, z, 1, 0);
      }
      // Traffic signals on two corners, mast arms over the roadway
      for (const [x, z, dx, dz] of [[xs0, zs0, 1, 0], [xs1, zs1, -1, 0]]) {
        const h = m(6.6), len = m(7);
        this.beginOwner('signal');
        this.prop('pole', x, y0 + h / 2, z, m(0.2), h, m(0.2), dark);
        const ax = x + (x === xs0 ? -1 : 1) * len / 2;
        this.prop('box', ax, y0 + h, z, len, m(0.2), m(0.2), dark);
        const hx = x + (x === xs0 ? -1 : 1) * len * 0.85;
        this.prop('box', hx, y0 + h - m(0.75), z, m(0.45), m(1.2), m(0.45), [0.85, 0.7, 0.1]);
        this.prop('box', hx, y0 + h - m(0.4), z + m(0.24), m(0.2), m(0.2), m(0.06), [1.6, 0.2, 0.15]);
        this.prop('box', x, y0 + m(3.2), z - m(0.3), m(0.5), m(0.5), m(0.2), [1.0, 0.75, 0.3]);
        const ex = x + (x === xs0 ? -1 : 1) * len;
        this.collide(Math.min(x, ex) - m(0.4), y0, z - m(0.6), Math.max(x, ex) + m(0.4), y0 + h + m(0.3), z + m(0.6), { prop: true, walk: true });
        this.endOwner();
      }
      // Subway entrance on some corners
      if (B.playable && r() < 0.18) {
        const x = B.x0 - m(1.5), z = B.z0 + m(6);
        this.beginOwner('subway');
        this.prop('box', x, y0 + m(0.55), z, m(1.8), m(1.1), m(5), [0.16, 0.18, 0.22]);
        for (const dz of [-1, 1]) {
          this.prop('cyl6', x, y0 + m(1.8), z + dz * m(2.3), m(0.07), m(1.4), m(0.07), [0.16, 0.18, 0.22]);
          this.prop('box', x, y0 + m(2.7), z + dz * m(2.3), m(0.5), m(0.5), m(0.5), [0.35, 0.65, 1.4]);
        }
        this.collide(x - m(1), y0, z - m(2.8), x + m(1), y0 + m(3), z + m(2.8), { prop: true, walk: true });
        this.endOwner();
      }
    }
    // Kiosks with glowing screens on some avenue sidewalks
    const rd = this.rd, play = L.blocks.filter((B) => B.playable);
    for (let i = 0; i < 18; i++) {
      const B = pick(rd, play), w = rd() < 0.5;
      const x = w ? B.x0 - L.aveWalk + m(2.6) : B.x1 + L.aveWalk - m(2.6), z = rd() < 0.5 ? B.z0 + m(10) : B.z1 - m(10);
      this.cur = this.chunkOf(x, z);
      this.beginOwner('kiosk');
      this.prop('box', x, y0 + m(1.2), z, m(2.8), m(2.4), m(1), [0.12, 0.13, 0.15]);
      this.prop('box', x, y0 + m(2.5), z, m(3.2), m(0.2), m(1.4), [0.2, 0.21, 0.23]);
      for (const d of [-1, 1]) {
        const zf = z + d * m(0.53), hw = m(1.15), sh = 2 * hw * AD_ASPECT, yb = y0 + m(0.9);
        const a = d > 0 ? x - hw : x + hw, b = d > 0 ? x + hw : x - hw;
        this.sign('screen', this.nextAd(), [[a, yb, zf], [b, yb, zf], [b, yb + sh, zf], [a, yb + sh, zf]], [0, 0, d]);
      }
      this.collide(x - m(1.4), 0, z - m(0.5), x + m(1.4), y0 + m(2.6), z + m(0.5));
      this.endOwner();
    }
    // Barricade closing off the north edge of the playable area
    const zb = L.z0 + m(1);
    for (let x = L.wx; x < L.x1; x += m(4)) {
      this.cur = this.chunkOf(x, zb);
      this.prop('box', x + m(2), m(0.55), zb, m(3.6), m(1.1), m(0.7), (Math.floor((x - L.x0) / m(4)) % 2) ? [1.1, 0.45, 0.1] : [1, 1, 1]);
    }
  }

  // ---- elevated railway and highway ----------------------------------------------

  /**
   * An elevated railway down an avenue, after the old Els: double track on a deck carried by
   * lattice girders, on steel bents every 15 m. The deck clears the mech, which can jump up
   * onto it and walk along it, and spiders perch on it like a roof.
   */
  buildEl() {
    const L = this.L, m = (x) => this.m(x), rs = this.rs, asp = (t) => cell(t).aspect;
    const R = STRUCTS.railway, T = STRUCTS.steeltruss;
    const track = pick(rs, R.track), girder = pick(rs, R.girder), col = pick(rs, R.column), bent = pick(rs, R.bent);
    const lattice = pick(rs, R.truss.concat(T.truss)), rail = pick(rs, R.rail);
    const a = L.aves[6], cx = (a.r0 + a.r1) / 2, hw = m(5), cw = m(0.4), xc = hw - m(0.7);
    // Bents carry a cap beam (yb - 1 m to yb), lattice girders (yb to yl) and the deck slab (yl to yt)
    const yb = m(14.5), yl = m(16.5), yt = m(17), yr = yt + m(1.2);
    const z0 = L.zN + m(20), z1 = L.z1 - m(14), n = Math.round((z1 - z0) / m(15)), sp = (z1 - z0) / n;
    const tl = (2 * hw) / asp(track), plate = [girder, m(3), m(3)];
    // Where the trains run (js/train.js): two tracks down the deck
    this.el = { cx, hw, yt, z0, z1, tracks: [cx - m(2.4), cx + m(2.4)] };
    // Bents about every 15 m, but none in a cross street's roadway, where the traffic passes under:
    // those step back to the crosswalks either side
    const Z = [];
    for (let i = 0; i <= n; i++) {
      let z = z0 + i * sp;
      const prev = Z.length ? Z[Z.length - 1] : -Infinity;
      for (const s of L.sts) {
        if (z <= s.r0 - m(1.5) || z >= s.r1 + m(1.5)) continue;
        // The nearer crosswalk, unless the last bent already stands there
        const near = z - s.r0 < s.r1 - z ? s.r0 - m(1.5) : s.r1 + m(1.5), far = near < z ? s.r1 + m(1.5) : s.r0 - m(1.5);
        z = near - prev > m(4) ? near : far;
      }
      if (z - prev > m(4)) Z.push(z);
    }
    // The line runs from the first bent to the last
    this.el.z0 = Z[0]; this.el.z1 = Z[Z.length - 1];
    // Destructible in stretches of a dozen spans, each standing on its own bents at both ends (the
    // bent where two stretches meet belongs to both), so no one piece is too long to voxelize
    const G = 12, N = Z.length - 1;
    for (let g0 = 0; g0 < N; g0 += G) {
      const g1 = Math.min(N, g0 + G);
      this.beginOwner('el');
      this.sboxMat = 'steel';
      this.elSpans(g0, g1, { cx, hw, cw, xc, yb, yl, yt, yr, Z, n: N, tl, plate, track, girder, col, bent, lattice, rail });
      this.sboxMat = null;
      this.endOwner();
    }
  }

  /** Spans g0..g1 - 1 of the El (between bents at E.Z) and the bents g0..g1 under them */
  elSpans(g0, g1, E) {
    const m = (x) => this.m(x), asp = (t) => cell(t).aspect;
    const { cx, hw, cw, xc, yb, yl, yt, yr, Z, n, tl, plate, track, girder, col, bent, lattice, rail } = E;
    for (let i = g0; i < g1; i++) {
      const za = Z[i], zb = Z[i + 1];
      this.cur = this.chunkOf(cx, (za + zb) / 2);
      this.sbox(cx - hw, yl, za, cx + hw, yt, zb, {
        ew: [girder, (yt - yl) * asp(girder), yt - yl], ns: i === 0 || i === n - 1 ? [girder, 0, 0] : null, bottom: plate,
      });
      this.flat(this.bufFor(track), track, cx - hw, za, cx + hw, zb, yt, (x, z) => [(x - cx + hw) / (2 * hw), -z / tl]);
      for (const s of [-1, 1]) {
        const x = cx + s * hw;
        this.card(lattice, x, za, x, zb, yb, yl, (yl - yb) * asp(lattice));
        this.card(rail, x, za, x, zb, yt, yr, (yr - yt) * asp(rail));
        // Railings stop the mech walking off; it can jump them
        this.collide(s < 0 ? x : x - m(0.25), yt, za, s < 0 ? x + m(0.25) : x, yt + m(1.6), zb);
      }
      this.collide(cx - hw, yb, za, cx + hw, yt, zb, { building: true });
    }
    // Bents: a pair of steel columns under a cap beam, braced by a steel frame
    for (let i = g0; i <= g1; i++) {
      const z = Z[i];
      this.cur = this.chunkOf(cx, z);
      for (const s of [-1, 1]) {
        const x = cx + s * xc, face = [col, 0, (2 * cw) / asp(col)];
        this.sbox(x - cw, 0, z - cw, x + cw, yb - m(1), z + cw, { ns: face, ew: face });
        this.collide(x - cw, 0, z - cw, x + cw, yb, z + cw);
      }
      this.sbox(cx - hw, yb - m(1), z - m(0.45), cx + hw, yb, z + m(0.45), { ns: [girder, m(1) * asp(girder), m(1)], ew: [girder, 0, 0], bottom: plate });
      this.card(bent, cx - hw, z, cx + hw, z, yb - (2 * hw) / asp(bent), yb);
    }
  }

  /**
   * An elevated expressway over the east waterfront: four lanes on a deck
   * carried by girders on hammerhead piers, with lamps along its barriers. At the south end it
   * comes down to the esplanade on a ramp the mech can walk up.
   */
  buildHighway() {
    const L = this.L, m = (x) => this.m(x), rs = this.rs, asp = (t) => cell(t).aspect;
    const K = STRUCTS[pick(rs, ['overpass', 'viaduct'])];
    const deck = pick(rs, K.deck), barrier = pick(rs, K.barrier), girder = pick(rs, K.girder), pier = pick(rs, K.pier);
    const slab = K.slab[0], lamp = pick(rs, STRUCTS.industrial.lamp);
    const cx = L.x1 + m(18), hw = m(9), y0 = L.curb;
    // Girders (yg to ys) under the deck slab (ys to yt), barriers bh tall, piers every 32 m
    const yg = m(14.4), ys = m(16.3), yt = m(17), bh = m(1.1), bw = m(0.45), gx = m(5.5), gw = m(0.35);
    const dl = (2 * hw) / asp(deck), fs = [slab, m(4), m(4)], bs = [barrier, bh * asp(barrier), bh];
    const zA = L.zN - m(300), zR = L.z1 - m(190), zG = L.z1 - m(40);
    this.ramp = { z0: zR, z1: zG, x0: cx - hw, x1: cx + hw };
    const n = Math.round((zR - zA) / m(32)), sp = (zR - zA) / n;
    const barriers = (za, zb, top) => {
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? cx - hw : cx + hw - bw, x1 = x0 + bw;
        this.sbox(x0, top, za, x1, top + bh, zb, { ew: bs, top: fs });
        this.collide(x0, top, za, x1, top + m(1.6), zb);
      }
    };
    // Destructible in stretches of eight spans, each on its own piers at both ends
    for (let i = 0; i < n; i++) {
      const za = zA + i * sp, zb = za + sp;
      if (i % 8 === 0) {
        if (i) this.endOwner();
        this.beginOwner('highway');
      }
      this.cur = this.chunkOf(cx, (za + zb) / 2);
      if (i % 8 === 7 || i === n - 1) {
        this.solid(pier, slab, cx, y0, zb, m(17), yg - y0, m(2.6));
        this.collide(cx - m(2), 0, zb - m(1.3), cx + m(2), yg, zb + m(1.3));
      }
      this.sbox(cx - hw, ys, za, cx + hw, yt, zb, { ew: fs, bottom: fs, ns: i === 0 ? fs : null });
      this.flat(this.bufFor(deck), deck, cx - hw, za, cx + hw, zb, yt, (x, z) => [(x - cx + hw) / (2 * hw), -z / dl]);
      for (const s of [-1, 1]) this.sbox(cx + s * gx - gw, yg, za, cx + s * gx + gw, ys, zb, { ew: [girder, (ys - yg) * asp(girder), ys - yg] });
      barriers(za, zb, yt);
      this.collide(cx - hw, yg, za, cx + hw, yt, zb, { building: true });
      // A pier at the north end of each span, and a lamp over every other span
      this.solid(pier, slab, cx, y0, za, m(17), yg - y0, m(2.6));
      this.collide(cx - m(2), 0, za - m(1.3), cx + m(2), yg, za + m(1.3));
      if (i % 2 === 0) this.crossCard(lamp, cx + (i % 4 ? 1 : -1) * (hw - bw / 2), yt + bh, (za + zb) / 2, m(9));
    }
    this.endOwner();
    // The ramp: a filled embankment between retaining walls, collided as a flight of shallow steps
    this.beginOwner('highway');
    const yAt = (z) => y0 + (yt - y0) * (zG - z) / (zG - zR);
    const nr = Math.ceil((zG - zR) / m(2.5)), sr = (zG - zR) / nr;
    this.cur = this.chunkOf(cx, zR);
    this.wall(this.bufFor(slab), slab, cx + hw, zR, cx - hw, zR, 0, yt, m(4), m(4), { ao: false });
    for (let i = 0; i < nr; i++) {
      const za = zR + i * sr, zb = za + sr, ya = yAt(za), yb = yAt(zb), xw = cx - hw, xe = cx + hw;
      this.cur = this.chunkOf(cx, za);
      const nz = (ya - yb) / sr, nl = Math.hypot(1, nz);
      this.quad(this.bufFor(deck), [[xw, yb, zb], [xe, yb, zb], [xe, ya, za], [xw, ya, za]], [0, 1 / nl, nz / nl],
        [[0, -zb / dl], [1, -zb / dl], [1, -za / dl], [0, -za / dl]], cell(deck), WHITE);
      const sb = this.bufFor(slab), bb = this.bufFor(barrier), u = bh * asp(barrier);
      this.skew(sb, slab, xw, za, xw, zb, 0, ya, 0, yb, m(4), m(4), { world: true });
      this.skew(sb, slab, xe, zb, xe, za, 0, yb, 0, ya, m(4), m(4), { world: true });
      // Barriers: outer and inner faces, and their tops
      this.skew(bb, barrier, xw, za, xw, zb, ya, ya + bh, yb, yb + bh, u, bh);
      this.skew(bb, barrier, xw + bw, zb, xw + bw, za, yb, yb + bh, ya, ya + bh, u, bh);
      this.skew(bb, barrier, xe, zb, xe, za, yb, yb + bh, ya, ya + bh, u, bh);
      this.skew(bb, barrier, xe - bw, za, xe - bw, zb, ya, ya + bh, yb, yb + bh, u, bh);
      for (const x of [xw, xe - bw]) {
        this.quad(sb, [[x, yb + bh, zb], [x + bw, yb + bh, zb], [x + bw, ya + bh, za], [x, ya + bh, za]], [0, 1, 0],
          [[0, -zb / m(4)], [bw / m(4), -zb / m(4)], [bw / m(4), -za / m(4)], [0, -za / m(4)]], cell(slab), WHITE);
        this.collide(x, 0, za, x + bw, ya + m(1.6), zb);
      }
      this.collide(xw, 0, za, xe, ya, zb);
      this.vol({ t: 'solid', x0: xw, x1: xe, z0: za, z1: zb, y0: 0, y1: (ya + yb) / 2, mat: 'concrete' });
    }
    this.endOwner();
  }

  // ---- waterfront and scenery ------------------------------------------------

  buildWaterfront() {
    const L = this.L, m = (x) => this.m(x), r = this.r, y0 = L.curb, g = this.buf('ground');
    const P = L.prom, W = L.water;
    // Esplanade strips on the west, east and south, with a seawall down to the water
    const strips = [
      [L.wx - P, L.zN, L.wx, L.z1 + P],
      [L.x0, L.zN, L.x0 + L.aveWalk, L.z1 - L.stWalk],
      [L.x1 - L.aveWalk, L.zN, L.x1 + P, L.z1 + P],
      [L.wx, L.z1 - L.stWalk, L.x1 - L.aveWalk, L.z1 + P],
    ];
    for (const [x0, z0, x1, z1] of strips) {
      this.flat(g, 'paveB30', x0, z0, x1, z1, y0, (x, z) => [x / m(6), -z / m(6)]);
      this.collide(x0, 0, z0, x1, y0, z1, { low: true });
    }
    const sb = this.buf('surface', 'shore');
    const X0 = L.wx - P, X1 = L.x1 + P, Z1 = L.z1 + P;
    this.wall(sb, 'walls51', X0, L.zN, X0, Z1, W, y0, m(2.8), m(2.8), { ao: false });
    this.wall(sb, 'walls51', X1, Z1, X1, L.zN, W, y0, m(2.8), m(2.8), { ao: false });
    this.wall(sb, 'walls51', X0, Z1, X1, Z1, W, y0, m(2.8), m(2.8), { ao: false });
    // Curbs facing the perimeter roads
    this.wall(g, 'walls53', L.x0 + L.aveWalk, L.zN, L.x0 + L.aveWalk, L.z1 - L.stWalk, 0, y0, m(1.2), m(1.2), { ao: false });
    this.wall(g, 'walls53', L.x1 - L.aveWalk, L.z1 - L.stWalk, L.x1 - L.aveWalk, L.zN, 0, y0, m(1.2), m(1.2), { ao: false });
    this.wall(g, 'walls53', L.x1 - L.aveWalk, L.z1 - L.stWalk, L.x0 + L.aveWalk, L.z1 - L.stWalk, 0, y0, m(1.2), m(1.2), { ao: false });
    // Railings and lamps along the water
    const rail = [0.15, 0.17, 0.18];
    const railRun = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / m(6));
      for (let i = 0; i <= n; i++) {
        const f = i / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
        this.cur = this.chunkOf(x, z);
        this.prop('pole', x, y0 + m(0.55), z, m(0.08), m(1.1), m(0.08), rail);
        if (i % 5 === 0) {
          this.prop('pole', x, y0 + m(2.2), z, m(0.1), m(4.4), m(0.1), rail);
          this.prop('ico', x, y0 + m(4.5), z, m(0.32), m(0.32), m(0.32), [1.2, 1.15, 0.95]);
        }
      }
      for (let i = 0; i < n; i += 8) {
        const f0 = i / n, f1 = Math.min(1, (i + 8) / n);
        const x0 = ax + (bx - ax) * f0, z0 = az + (bz - az) * f0, x1 = ax + (bx - ax) * f1, z1 = az + (bz - az) * f1;
        this.cur = this.chunkOf(x0, z0);
        this.prop('box', (x0 + x1) / 2, y0 + m(1.1), (z0 + z1) / 2, Math.abs(x1 - x0) + m(0.1), m(0.1), Math.abs(z1 - z0) + m(0.1), rail);
      }
    };
    const e = m(0.5);
    railRun(X0 + e, L.zN, X0 + e, Z1 - e);
    railRun(X1 - e, L.zN, X1 - e, Z1 - e);
    this.balustrade(X0 + e, X1 - e, Z1 - e);
    for (let i = 0; i < 26; i++) {
      let side = r() < 0.5 ? X0 + m(8) : X1 - m(8);
      const z = L.zN + r() * (Z1 - L.zN - m(10));
      if (z < L.z0) continue;
      // Trees under the highway ramp move to the inner edge of the esplanade
      const R = this.ramp;
      if (R && side > R.x0 && side < R.x1 && z > R.z0 - m(6) && z < R.z1 + m(6)) side = L.x1 + m(3);
      this.cur = this.chunkOf(side, z);
      this.tree(side, y0, z, 0.9);
    }
    // Water
    const nrm = canvasTexture(256, (c, s) => {
      const img = c.createImageData(s, s), d = img.data;
      const h = new Float32Array(s * s);
      for (let k = 0; k < 6; k++) {
        const fx = 1 + Math.floor(r() * 6), fy = 1 + Math.floor(r() * 6), ph = r() * 6.28, amp = 1 / (1 + k);
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) h[y * s + x] += amp * Math.sin((x * fx + y * fy) * 6.283 / s + ph);
      }
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const dx = h[y * s + ((x + 1) % s)] - h[y * s + ((x + s - 1) % s)], dy = h[((y + 1) % s) * s + x] - h[((y + s - 1) % s) * s + x];
        const i = (y * s + x) * 4;
        d[i] = 128 + dx * 40; d[i + 1] = 128 + dy * 40; d[i + 2] = 255; d[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    }, false);
    nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
    nrm.repeat.set(140, 140);
    this.waterNormal = nrm;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(m(9000), m(9000)), new THREE.MeshStandardMaterial({
      color: 0x21363f, roughness: 0.14, metalness: 0.0, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.3,
    }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = W;
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;
  }

  buildScenery() {
    const L = this.L, m = (x) => this.m(x), r = this.r;
    this.noOwners = true;
    // Distant skylines: the shores across both rivers, and the uptown towers to the north
    const skyline = (x0, x1, z0, z1, n, hmin, hmax) => {
      for (let i = 0; i < n; i++) {
        const w = m(30 + r() * 50), d = m(30 + r() * 40), x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
        const q = r();
        const tile = q < 0.4 ? pick(r, G.officeGlass) : q < 0.6 ? pick(r, G.prewar) : pick(r, KITS[pick(r, KIT_STYLE.far)].bays);
        const [tw, th] = tileMeters(tile);
        const h = m(hmin + Math.pow(r(), 2) * (hmax - hmin));
        this.cur = 'far';
        this.building({
          x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: 0, streets: {}, allFacade: true, tint: this.tint(0.12),
          party: 'walls05', tiers: [{ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y1: Math.ceil(h / m(th)) * m(th), tile }],
        });
      }
    };
    const save = this.colliders.length;
    // Far shores: land, a seawall, and a skyline on top
    const fg = this.buf('ground', 'far'), fs = this.buf('surface', 'far');
    for (const [x0, x1, z0, z1, edge] of [[L.wx - m(2600), L.wx - m(640), L.zN - m(2600), L.z1 + m(700), 'e'], [L.x1 + m(600), L.x1 + m(2600), L.zN - m(2600), L.z1 + m(500), 'w']]) {
      this.flat(fg, 'asphB01', x0, z0, x1, z1, 0, (x, z) => [x / m(60), -z / m(60)], 0, [0.62, 0.63, 0.62]);
      const xe = edge === 'e' ? x1 : x0;
      this.wall(fs, 'walls51', xe, edge === 'e' ? z1 : z0, xe, edge === 'e' ? z0 : z1, L.water, 0, m(3), m(3), { ao: false });
      this.wall(fs, 'walls51', x0, z1, x1, z1, L.water, 0, m(3), m(3), { ao: false });
    }
    skyline(L.wx - m(1150), L.wx - m(700), L.zN - m(300), L.z1 + m(500), 45, 30, 230);
    skyline(L.x1 + m(650), L.x1 + m(1100), L.zN - m(200), L.z1 + m(300), 40, 15, 150);
    skyline(L.x0 + m(60), L.x1 - m(60), L.zN - m(500), L.zN - m(60), 60, 20, 120);
    skyline(L.x0 + m(100), L.x1 - m(100), L.zN - m(1500), L.zN - m(500), 70, 40, 280);
    // The skyline's tallest, far to the north: a supertall twisting a quarter turn as it rises
    this.cur = 'far';
    const ex = L.x0 + (L.x1 - L.x0) * 0.62, ez = L.zN - m(2200);
    let y = 0;
    for (let i = 0; i < 14; i++) {
      const h = m(34), k0 = 1 - (i / 14) * 0.35, k1 = 1 - ((i + 1) / 14) * 0.35;
      this.prismSeg(ex, ez, 4, m(62) * k0, m(62) * k1, Math.PI / 4 + (i / 14) * 1.4, y, y + h, 'office20', m(12), m(12), { top: i === 13 ? 'roof04' : null });
      y += h;
    }
    this.prop('cyl6', ex, y + m(45), ez, m(2), m(90), m(2), [0.72, 0.74, 0.76], 0, 0, 0, 'far');
    this.colliders.length = save; // scenery has no collision
    // A lighthouse on a rocky islet out in the harbor, and a line of wind turbines beyond it
    const sx = L.x0 + (L.x1 - L.x0) * 0.3, sz = L.z1 + m(1400), C = 'far', Wl = L.water, rock = [0.36, 0.34, 0.31];
    this.prop('cyl6', sx, Wl + m(4), sz, m(46), m(8), m(46), rock, 0, 0, 0, C);
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7, d = m(30 + (i % 3) * 8);
      this.prop('ico', sx + Math.cos(a) * d, Wl + m(5), sz + Math.sin(a) * d, m(9), m(6), m(9), rock, a, 0, 0, C);
    }
    this.prop('box', sx + m(14), Wl + m(12), sz + m(6), m(12), m(8), m(9), [0.85, 0.83, 0.78], 0.3, 0, 0, C);
    this.prop('cone4', sx + m(14), Wl + m(18), sz + m(6), m(9), m(4), m(7), [0.45, 0.16, 0.12], 0.3 + Math.PI / 4, 0, 0, C);
    for (let k = 0; k < 6; k++) {
      const r = m(6 - k * 0.45);
      this.prop('cyl', sx, Wl + m(8) + k * m(7) + m(3.5), sz, r, m(7), r, k % 2 ? [0.75, 0.12, 0.1] : [0.92, 0.92, 0.9], 0, 0, 0, C);
    }
    const yl = Wl + m(50);
    this.prop('cyl', sx, yl + m(0.4), sz, m(5), m(0.8), m(5), [0.2, 0.2, 0.22], 0, 0, 0, C);
    this.prop('cyl', sx, yl + m(3), sz, m(3), m(4.4), m(3), [1.6, 1.45, 1.0], 0, 0, 0, C);
    this.prop('cone', sx, yl + m(6.8), sz, m(3.6), m(3.2), m(3.6), [0.45, 0.16, 0.12], 0, 0, 0, C);
    // Turbines: towers and nacelles as props, rotors instanced and turned every frame
    const blades = [];
    const part = (sx_, sy, sz_, x, y, z, rz, c) => {
      const g = new THREE.BoxGeometry(sx_, sy, sz_);
      g.translate(x, y, z); g.rotateZ(rz);
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(c).flat(), 3));
      blades.push(g);
    };
    for (let k = 0; k < 3; k++) part(m(2.6), m(48), m(0.5), 0, m(25), 0, (k * Math.PI * 2) / 3, [0.93, 0.94, 0.95]);
    part(m(3), m(3), m(3), 0, 0, m(0.5), 0, [0.9, 0.9, 0.92]);
    const list = [];
    for (let i = 0; i < 7; i++) {
      const x = L.x0 + (L.x1 - L.x0) * (0.42 + i * 0.1), z = L.z1 + m(2000 + (i % 2) * 160), hT = m(100);
      this.prop('cyl', x, Wl + hT / 2, z, m(2.4), hT, m(2.4), [0.9, 0.9, 0.92], 0, 0, 0, C);
      this.prop('box', x, Wl + hT + m(1.5), z - m(2), m(4), m(4), m(10), [0.88, 0.88, 0.9], 0, 0, 0, C);
      list.push({ pos: new V3(x, Wl + hT + m(1.5), z + m(3.4)), yaw: 0, speed: 0.45 + (i % 3) * 0.06, phase: i * 1.7 });
    }
    const mesh = new THREE.InstancedMesh(mergeBoxes(blades), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), list.length);
    this.scene.add(mesh);
    this.rotors = { mesh, list, t: 0 };
    // A suspension bridge across the east river, and a cable-stayed one across the west river to the north
    this.bridge(L.x1 + L.prom, L.z0 + m(160));
    this.stayBridge(L.zN + m(60));
    this.noOwners = false;
  }

  /**
   * A bridge deck running along x from xa to xb (xa < xb) centered on z, hw wide each way, its top
   * at yAt(x), in segments so it can rise and fall. o: { deck, fascia, depth, under, barrier,
   * truss, trussDepth }: the road on top, the fascia tile on its edges (depth deep), the tile
   * underneath, barrier tile on the edges and an optional stiffening truss card under each edge.
   */
  deckRun(xa, xb, z, hw, yAt, o) {
    const m = (x) => this.m(x), asp = (t) => cell(t).aspect, n = Math.max(1, Math.round((xb - xa) / m(10)));
    const dl = (2 * hw) / asp(o.deck), bh = m(1), bw = m(0.45), d = o.depth, zs = z - hw, zn = z + hw;
    const fb = this.bufFor(o.fascia), ub = this.bufFor(o.under), bb = this.bufFor(o.barrier), db = this.bufFor(o.deck);
    const bu = bh * asp(o.barrier), fu = d * asp(o.fascia);
    for (let i = 0; i < n; i++) {
      const x0 = xa + (xb - xa) * i / n, x1 = xa + (xb - xa) * (i + 1) / n, y0 = yAt(x0), y1 = yAt(x1);
      const s = (y1 - y0) / (x1 - x0), nl = Math.hypot(s, 1);
      this.quad(db, [[x0, y0, zn], [x1, y1, zn], [x1, y1, zs], [x0, y0, zs]], [-s / nl, 1 / nl, 0],
        [[1, x0 / dl], [1, x1 / dl], [0, x1 / dl], [0, x0 / dl]], cell(o.deck), WHITE);
      this.quad(ub, [[x0, y0 - d, zs], [x1, y1 - d, zs], [x1, y1 - d, zn], [x0, y0 - d, zn]], [0, -1, 0],
        [[x0 / m(4), zs / m(4)], [x1 / m(4), zs / m(4)], [x1 / m(4), zn / m(4)], [x0 / m(4), zn / m(4)]], cell(o.under), WHITE);
      // Fascia and barriers on both edges: outer faces, inner faces and barrier tops
      this.skew(fb, o.fascia, x0, zn, x1, zn, y0 - d, y0, y1 - d, y1, fu, d);
      this.skew(fb, o.fascia, x1, zs, x0, zs, y1 - d, y1, y0 - d, y0, fu, d);
      this.skew(bb, o.barrier, x0, zn, x1, zn, y0, y0 + bh, y1, y1 + bh, bu, bh);
      this.skew(bb, o.barrier, x1, zn - bw, x0, zn - bw, y1, y1 + bh, y0, y0 + bh, bu, bh);
      this.skew(bb, o.barrier, x1, zs, x0, zs, y1, y1 + bh, y0, y0 + bh, bu, bh);
      this.skew(bb, o.barrier, x0, zs + bw, x1, zs + bw, y0, y0 + bh, y1, y1 + bh, bu, bh);
      for (const zb of [zs, zn - bw]) {
        this.quad(ub, [[x0, y0 + bh, zb + bw], [x1, y1 + bh, zb + bw], [x1, y1 + bh, zb], [x0, y0 + bh, zb]], [0, 1, 0],
          [[x0 / m(4), 0], [x1 / m(4), 0], [x1 / m(4), bw / m(4)], [x0 / m(4), bw / m(4)]], cell(o.under), WHITE);
      }
      if (o.truss) {
        const tb = this.bufFor(o.truss, true), td = o.trussDepth, tu = td * asp(o.truss);
        for (const zt of [zs, zn]) this.skew(tb, o.truss, x0, zt, x1, zt, y0 - d - td, y0 - d, y1 - d - td, y1 - d, tu, td);
      }
    }
  }

  /** Height (0..1) of the underside of a piece's lowest crossbeam: where its middle first turns solid */
  crossbeam(name) {
    for (let v = 0.02; v < 1; v += 0.005) if (!this.opening(name, v)) return v < 0.15 ? 0.5 : v;
    return 0.5;
  }

  /** A pile cap in the water under a tower or pylon, from the footing kit */
  footing(x, z, wx, wz) {
    const m = (v) => this.m(v), W = this.L.water, F = STRUCTS.footing, cap = pick(this.rs, F.block);
    this.sbox(x - wx / 2, W - m(4), z - wz / 2, x + wx / 2, W + m(2), z + wz / 2,
      { ns: [cap, m(6) * cell(cap).aspect, m(6), true], ew: [cap, m(6) * cell(cap).aspect, m(6), true], top: [STRUCTS.suspension.slab[0], m(4), m(4)] });
  }

  /**
   * A suspension bridge across the east river: towers from the suspension kit on footings in
   * the water, a deck stiffened by trusses, main cables over the towers and hangers down to the
   * deck, and an approach rising from the seawall on piers.
   */
  bridge(xs, z) {
    const m = (x) => this.m(x), W = this.L.water, rs = this.rs, K = STRUCTS.suspension, asp = (t) => cell(t).aspect;
    this.cur = 'bridge';
    const t1 = xs + m(320), t2 = t1 + m(486), end = t2 + m(330), dY = W + m(40), hw = m(9.5);
    const rampEnd = t1 - m(120), slab = K.slab[0], steel = [0.24, 0.25, 0.27];
    // Towers: the H tower, tall enough that the deck passes under its lower crossbeam
    const tower = K.tower.find((t) => OUTLINES[t].length > 1) || K.tower[0];
    const yB = W + m(2), vc = this.crossbeam(tower), Ht = (dY - yB + m(9)) / vc;
    const gap = Math.min(this.opening(tower, (dY - yB) / Ht), this.opening(tower, (dY - yB - m(8)) / Ht)) || 0.3;
    const Wt = Math.max(Ht * asp(tower), (2 * hw + m(3)) / gap), top = yB + Ht - m(2);
    for (const t of [t1, t2]) {
      this.footing(t, z, m(18), Wt + m(6));
      this.solid(tower, slab, t, yB, z, Wt, Ht, m(12), Math.PI / 2, m(6));
    }
    // Deck: the approach rises from the seawall on piers, then runs level over the river
    const deck = pick(rs, K.deck), o = { deck, fascia: K.barrier[0], depth: m(1.2), under: slab, barrier: pick(rs, K.barrier), truss: pick(rs, K.truss), trussDepth: m(6) };
    const yAt = (x) => (x < rampEnd ? this.L.curb + (dY - this.L.curb) * (x - xs) / (rampEnd - xs) : dY);
    this.deckRun(xs, rampEnd, z, hw, yAt, { ...o, truss: null, depth: m(2.5), fascia: slab });
    this.deckRun(rampEnd, end, z, hw, yAt, o);
    const pier = pick(rs, STRUCTS.footing.pier);
    for (let x = xs + m(50); x < rampEnd - m(20); x += m(50)) this.solid(pier, slab, x, W - m(1), z, 2 * hw + m(2), yAt(x) - m(2.5) - W + m(1), m(3), Math.PI / 2);
    // Anchorages at both ends of the main cables
    for (const [x0, x1] of [[rampEnd - m(30), rampEnd], [end - m(30), end]]) {
      this.sbox(x0, W - m(2), z - hw - m(4), x1, dY - m(1.2), z + hw + m(4), { ns: [slab, m(5), m(5)], ew: [slab, m(5), m(5)] });
    }
    // Main cables: catenaries from the anchorages over the tower tops, and hangers down to the deck
    const cableT = pick(rs, K.cable);
    for (const zc of [z - hw - m(1), z + hw + m(1)]) {
      const pts = [], hang = [];
      const curve = (xa, ya, xb, yb, sag) => {
        for (let i = pts.length ? 1 : 0; i <= 24; i++) {
          const f = i / 24, p = new V3(xa + (xb - xa) * f, ya + (yb - ya) * f - sag * 4 * f * (1 - f), zc);
          pts.push(p);
        }
      };
      curve(rampEnd - m(15), dY + m(3), t1, top, m(18));
      curve(t1, top, t2, top, m(38));
      curve(t2, top, end - m(15), dY + m(3), m(18));
      this.sbox(rampEnd - m(20), dY, zc - m(1.5), rampEnd - m(10), dY + m(5), zc + m(1.5), { ns: [slab, m(4), m(4)], ew: [slab, m(4), m(4)], top: [slab, m(4), m(4)] });
      this.sbox(end - m(20), dY, zc - m(1.5), end - m(10), dY + m(5), zc + m(1.5), { ns: [slab, m(4), m(4)], ew: [slab, m(4), m(4)], top: [slab, m(4), m(4)] });
      this.cable(cableT, pts, m(0.9), m(8));
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i];
        if (p.y > dY + m(3) && p.x > rampEnd && p.x < end - m(20) && Math.abs(p.x - t1) > m(8) && Math.abs(p.x - t2) > m(8)) hang.push(p);
      }
      for (const p of hang) this.prop('pole', p.x, (p.y + dY) / 2, zc, m(0.15), p.y - dY, m(0.15), steel, 0, 0, 0, 'bridge');
    }
  }

  /**
   * A cable-stayed bridge across the west river, north of the playable city: A-frame pylons from the
   * cable-stay kit on footings, fans of stays down to the deck, and approaches on piers.
   */
  stayBridge(z) {
    const L = this.L, m = (x) => this.m(x), W = L.water, rs = this.rs, K = STRUCTS.cablestay, asp = (t) => cell(t).aspect;
    this.cur = 'bridge';
    const xs = L.wx - L.prom, xe = L.wx - m(640), dY = W + m(30), hw = m(9), run = m(110);
    const slab = K.slab[0], pylon = K.pylon.find((t) => OUTLINES[t].length > 1) || K.pylon[0];
    // Up from the city's seawall, level over the river, down to the far shore
    const yAt = (x) => (x > xs - run ? L.curb + (dY - L.curb) * (xs - x) / run : x < xe + run ? dY * (x - xe) / run : dY);
    this.deckRun(xe, xs, z, hw, yAt, { deck: pick(rs, K.deck), fascia: pick(rs, K.girder), depth: m(2.5), under: slab, barrier: pick(rs, K.barrier) });
    const pier = pick(rs, K.pier);
    for (const x of [xs - m(55), xs - run, xe + run, xe + m(55)]) {
      this.solid(pier, slab, x, W - m(1), z, 2 * hw + m(2), yAt(x) - m(2.5) - W + m(1), m(3), Math.PI / 2);
    }
    // Pylons: the deck passes under the crossbar, the stays fan out from above the opening
    const yB = W + m(2), vc = this.crossbeam(pylon), Ht = Math.max((dY - yB + m(12)) / vc, m(115));
    const gap = this.opening(pylon, (dY - yB - m(3)) / Ht) || 0.4;
    const Wt = Math.max(Ht * asp(pylon), (2 * hw + m(4)) / gap);
    let vt = vc;
    for (let v = vc; v < 0.99; v += 0.005) if (this.opening(pylon, v)) vt = v;
    const stay = [0.78, 0.8, 0.82];
    for (const xp of [xs - m(170), xe + m(170)]) {
      this.footing(xp, z, m(14), Wt + m(6));
      this.solid(pylon, slab, xp, yB, z, Wt, Ht, m(7), Math.PI / 2, m(6));
      for (let k = 0; k < 8; k++) {
        const ya = yB + Ht * (Math.max(vt + 0.03, 0.8) + (0.96 - Math.max(vt + 0.03, 0.8)) * (k / 7));
        for (const dir of [-1, 1]) {
          const x = xp + dir * m(24 + k * 13);
          for (const zz of [z - hw + m(0.6), z + hw - m(0.6)]) this.strut('pole', new V3(xp, ya, z), new V3(x, yAt(x), zz), m(0.18), stay, 'bridge');
        }
      }
    }
  }

  /** A stone balustrade along the water at z from x0 to x1, with pedestals carrying lamps */
  balustrade(x0, x1, z) {
    const m = (v) => this.m(v), y0 = this.L.curb, S = STRUCTS.stonework, rs = this.rs;
    const bal = pick(rs, S.balustrade), ped = pick(rs, S.block), coping = pick(rs, S.barrier), h = m(1.15), pw = m(0.9), ph = m(1.5);
    const n = Math.round((x1 - x0) / m(16)), sp = (x1 - x0) / n, lamp = [1.2, 1.15, 0.95], post = [0.15, 0.17, 0.18];
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * sp;
      this.cur = this.chunkOf(x, z);
      this.sbox(x - pw / 2, y0, z - pw / 2, x + pw / 2, y0 + ph, z + pw / 2, { ns: [ped, 0, 0], ew: [ped, 0, 0], top: [coping, pw, pw] });
      if (i % 2 === 0) {
        this.prop('pole', x, y0 + ph + m(2), z, m(0.1), m(4), m(0.1), post);
        this.prop('ico', x, y0 + ph + m(4.1), z, m(0.32), m(0.32), m(0.32), lamp);
      }
      if (i < n) this.card(bal, x + pw / 2, z, x + sp - pw / 2, z, y0, y0 + h, h * cell(bal).aspect);
    }
  }

  // ---- finish ----------------------------------------------------------------

  flush() {
    for (const [key, b] of this.bufs) {
      if (!b.n) continue;
      const mat = this.mats[b.mat];
      const mesh = new THREE.Mesh(b.geometry(), mat);
      const chunk = key.split('|')[1];
      const far = chunk === 'far' || chunk === 'bridge';
      const decal = b.mat === 'decal' || b.mat.endsWith('Decal');
      mesh.castShadow = !far && !decal && b.mat !== 'ground' && !b.mat.startsWith('roads');
      mesh.receiveShadow = !far;
      mesh.renderOrder = decal ? 1 : 0;
      if (this.depthMats[b.mat]) mesh.customDepthMaterial = this.depthMats[b.mat];
      mesh.matrixAutoUpdate = false;
      mesh.userData.mat = b.mat;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      b.mesh = mesh;
    }
    this.bufs.clear();
    // Owners keep their meshes and index runs, not the build buffers
    for (const o of this.owners) o.ranges = o.ranges.map((r) => r.b ? { mesh: r.b.mesh, i0: r.i0, i1: r.i1 } : r).filter((r) => r.mesh);
  }

  // ---- cars ------------------------------------------------------------------

  buildCars() {
    // Parked and driving cars, skinned from the car sheets (js/cars.js)
    this.carSys = new Cars(this);
    this.cars = this.carSys.list;
  }

  crushCar(car) {
    if (!this.carSys.crush(car)) return;
    this.fx.sparksBurst(_a.copy(car.pos).setY(this.m(1)), _b.set(0, 1, 0), 14, 0xffc070, 18);
    this.fx.dust(car.pos, 0.6, 6);
    this.sound.crunch(car.pos);
  }

  damageCar(car, amount, point) {
    if (car.state === 2) return false;
    car.hp -= amount;
    if (car.hp > 0) return false;
    car.state = 2;
    car.alive = false;
    this.pending.push({ car, t: 0.05 + Math.random() * 0.25 });
    return true;
  }

  explodeCar(car) {
    const m = (x) => this.m(x);
    this.carSys.wreck(car);
    const p = _a.copy(car.pos).setY(m(1));
    this.fx.explosion(p, 1.05);
    this.sound.explosion(p, 1.1);
    this.burning.push({ car, t: 14 + Math.random() * 8 });
    this.trees.blast(p, m(10), 30);
    this.onCarBlast && this.onCarBlast(car.pos.clone());
  }

  /** ctx: { player: V3, grounded, feet: [V3, V3] } */
  update(dt, ctx) {
    const fx = this.fx, m = (x) => this.m(x), P = ctx.player;
    this.time = (this.time || 0) + dt;
    if (this.waterNormal) { this.waterNormal.offset.x += dt * 0.004; this.waterNormal.offset.y += dt * 0.0025; }
    // Cars underfoot get crushed
    if (ctx.grounded && P.y < m(1.5)) {
      for (const f of ctx.feet) {
        this.query(f.x - m(1.4), f.z - m(1.4), f.x + m(1.4), f.z + m(1.4), (c) => {
          if (!c.ref || c.ref.flat) return;
          const car = c.ref;
          if (f.x > c.min.x - m(0.4) && f.x < c.max.x + m(0.4) && f.z > c.min.z - m(0.4) && f.z < c.max.z + m(0.4)) this.crushCar(car);
        });
      }
    }
    this.trees.update(dt, ctx);
    this.carSys.update(dt, ctx);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); this.explodeCar(p.car); }
    }
    // Burning wrecks and steam vents near the player
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const b = this.burning[i];
      b.t -= dt;
      if (b.t <= 0) { this.burning.splice(i, 1); continue; }
      if (b.car.pos.distanceToSquared(P) > m(260) ** 2 || Math.random() > dt * 14) continue;
      const k = Math.min(1, b.t / 6), p = b.car.pos;
      fx.fire.emit(p.x + (Math.random() - 0.5) * m(2.5), m(1.2), p.z + (Math.random() - 0.5) * m(2.5), 0, m(3), 0, 0.5, m(1.2) * k, m(0.4), 3, 1.6, 0.5, 0.9, 1, 0.25, 0.05, 0);
      fx.smoke.emit(p.x, m(1.6), p.z, (Math.random() - 0.5) * 2, m(4), (Math.random() - 0.5) * 2, 3.5, m(1.5), m(6), 0.12, 0.11, 0.1, 0.7 * k + 0.2, 0.3, 0.3, 0.3, 0, 0.3, 0.3);
    }
    for (const s of this.steam) {
      if (s.pos.distanceToSquared(P) > m(300) ** 2) continue;
      s.t -= dt;
      if (s.t > 0) continue;
      s.t = 0.09 + Math.random() * 0.08;
      const v = 0.85 + Math.random() * 0.1;
      fx.smoke.emit(s.pos.x + (Math.random() - 0.5) * m(0.6), s.pos.y + m(0.3), s.pos.z + (Math.random() - 0.5) * m(0.6),
        (Math.random() - 0.5) * 1.2 + 0.8, m(3.2) + Math.random() * m(1.5), (Math.random() - 0.5) * 1.2,
        3.2 + Math.random(), m(1.0), m(6.5), v, v, v, s.stack ? 0.5 : 0.32, v, v, v, 0, 0.35, 0.15, (Math.random() - 0.5));
    }
    for (const f of this.fountains) {
      if (f.distanceToSquared(P) > m(250) ** 2 || Math.random() > dt * 30) continue;
      const a = Math.random() * 6.28, s = m(2.4);
      fx.smoke.emit(f.x, f.y, f.z, Math.cos(a) * s, m(6), Math.sin(a) * s, 1.1, m(0.4), m(1.4), 0.9, 0.95, 1, 0.45, 0.9, 0.95, 1, 0, 0.2, -m(9));
    }
    // Wind turbines in the harbor
    if (this.rotors) {
      const R = this.rotors;
      R.t += dt;
      R.list.forEach((w, i) => {
        _q.setFromEuler(new THREE.Euler(0, w.yaw, R.t * w.speed + w.phase));
        _m.compose(w.pos, _q, _s.set(1, 1, 1));
        R.mesh.setMatrixAt(i, _m);
      });
      R.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Visit colliders overlapping an XZ rectangle; set by World once its grid exists */
  query() {}
}

function mergeBoxes(parts) {
  const pos = [], nor = [], col = [], idx = [];
  let off = 0;
  for (const g of parts) {
    const ng = g.index ? g : g;
    pos.push(...ng.attributes.position.array);
    nor.push(...ng.attributes.normal.array);
    col.push(...ng.attributes.color.array);
    for (const i of ng.index.array) idx.push(i + off);
    off += ng.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
