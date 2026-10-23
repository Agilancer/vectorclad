import * as THREE from '../three.js';

// ---------------------------------------------------------------------------
// The inside of the city: a 4 x 4 atlas painted at startup for broken faces
// (concrete with rebar, stone, brick, shattered curtain wall, torn panel,
// steel, timber, foliage), the rooms a hole opens onto (office floor, lit
// ceiling, plaster, bare concrete) and rubble. A second atlas carries the
// ceiling lights, so blown-open floors glow.
// ---------------------------------------------------------------------------

export const CELL = {
  concrete: 0, stone: 1, brick: 2, glass: 3, panel: 4, steel: 5, wood: 6, leaf: 7,
  floor: 8, ceiling: 9, wall: 10, column: 11, rubble: 12, scorch: 13,
};
const N = 4, S = 256;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Speckle a cell with noise: n dots of radius up to rmax in shades around a base color */
function speckle(g, r, n, rmax, base, spread, alpha = 1) {
  for (let i = 0; i < n; i++) {
    const k = 1 + (r() - 0.5) * spread;
    g.fillStyle = `rgba(${base.map((c) => Math.max(0, Math.min(255, Math.round(c * k)))).join(',')},${alpha})`;
    const s = r() * rmax + 0.5;
    g.beginPath(); g.arc(r() * S, r() * S, s, 0, Math.PI * 2); g.fill();
  }
}

/** Wrapping-safe crack lines */
function cracks(g, r, n, color, width) {
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    g.beginPath(); g.moveTo(x, y);
    const steps = 4 + Math.floor(r() * 8);
    for (let k = 0; k < steps; k++) { a += (r() - 0.5) * 1.4; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); }
    g.stroke();
  }
}

function paint(cellId, g, r, emis) {
  const fill = (c) => { g.fillStyle = c; g.fillRect(0, 0, S, S); };
  switch (cellId) {
    case CELL.concrete: case CELL.rubble:
      fill('#7d7a75');
      speckle(g, r, 2600, 3.2, [125, 122, 116], 0.5);
      speckle(g, r, 500, 5, [92, 90, 86], 0.4, 0.6);
      speckle(g, r, 300, 2, [168, 162, 150], 0.3);
      cracks(g, r, 10, 'rgba(40,38,36,0.7)', 2);
      if (cellId === CELL.concrete) {
        // Snapped rebar poking through
        g.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const x = r() * S, y = r() * S, a = r() < 0.5 ? 0 : Math.PI / 2, L = 30 + r() * 70;
          g.strokeStyle = '#3d2a1e'; g.lineWidth = 5;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
          g.strokeStyle = '#8a5a34'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(x, y - 1); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L - 1); g.stroke();
        }
      }
      break;
    case CELL.stone:
      fill('#a39684');
      speckle(g, r, 2200, 3.5, [163, 150, 132], 0.35);
      speckle(g, r, 400, 7, [130, 118, 104], 0.3, 0.55);
      cracks(g, r, 8, 'rgba(60,52,44,0.7)', 2);
      break;
    case CELL.brick: {
      fill('#5a3c32');
      const bh = 26, bw = 60;
      for (let y = 0; y < S; y += bh) {
        const off = (y / bh) % 2 ? bw / 2 : 0;
        for (let x = -bw; x < S + bw; x += bw) {
          if (r() < 0.12) continue; // knocked-out bricks show the mortar bed
          const k = 0.8 + r() * 0.4;
          g.fillStyle = `rgb(${Math.round(128 * k)},${Math.round(62 * k)},${Math.round(44 * k)})`;
          g.fillRect(x + off + 3, y + 3, bw - 6, bh - 6);
        }
      }
      speckle(g, r, 900, 2.5, [100, 70, 60], 0.5, 0.5);
      cracks(g, r, 6, 'rgba(30,20,16,0.6)', 2);
      break;
    }
    case CELL.glass: {
      // Curtain wall torn open: mullions, spandrel and shards
      fill('#202830');
      for (let x = 0; x < S; x += 64) { g.fillStyle = '#5b6168'; g.fillRect(x, 0, 9, S); }
      for (let y = 0; y < S; y += 128) { g.fillStyle = '#4a4f55'; g.fillRect(0, y, S, 22); }
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(${150 + r() * 60},${190 + r() * 50},${210 + r() * 40},${0.25 + r() * 0.4})`;
        const x = r() * S, y = r() * S, s = 6 + r() * 26;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * (r() - 0.2), y + s); g.lineTo(x - s * (r() - 0.2), y + s * r()); g.fill();
      }
      break;
    }
    case CELL.panel:
      fill('#8b8c8e');
      speckle(g, r, 1200, 3, [139, 140, 142], 0.3);
      // Insulation and studs behind torn skin
      for (let x = 0; x < S; x += 48) { g.fillStyle = '#5f6064'; g.fillRect(x, 0, 6, S); }
      speckle(g, r, 260, 9, [214, 190, 120], 0.25, 0.6);
      cracks(g, r, 6, 'rgba(40,40,44,0.7)', 2);
      break;
    case CELL.steel:
      fill('#3d3e42');
      speckle(g, r, 1600, 2.5, [70, 70, 74], 0.4);
      speckle(g, r, 220, 9, [120, 70, 40], 0.4, 0.45);
      for (let y = 0; y < S; y += 32) { g.fillStyle = 'rgba(20,20,22,0.5)'; g.fillRect(0, y, S, 2); }
      break;
    case CELL.wood:
      fill('#6b4c33');
      for (let y = 0; y < S; y += 22) {
        const k = 0.8 + r() * 0.35;
        g.fillStyle = `rgb(${Math.round(110 * k)},${Math.round(78 * k)},${Math.round(52 * k)})`;
        g.fillRect(0, y + 2, S, 18);
        g.strokeStyle = 'rgba(40,26,16,0.5)'; g.lineWidth = 1;
        for (let k2 = 0; k2 < 3; k2++) { g.beginPath(); const yy = y + 5 + r() * 12; g.moveTo(0, yy); g.bezierCurveTo(S / 3, yy + r() * 6 - 3, (2 * S) / 3, yy + r() * 6 - 3, S, yy); g.stroke(); }
      }
      break;
    case CELL.leaf:
      fill('#2c4423');
      speckle(g, r, 2600, 5, [52, 84, 40], 0.6);
      speckle(g, r, 600, 3, [98, 132, 64], 0.4);
      break;
    case CELL.floor: {
      // Office carpet tiles, some stained
      fill('#3d4249');
      for (let y = 0; y < S; y += 64) for (let x = 0; x < S; x += 64) {
        const k = 0.88 + r() * 0.2;
        g.fillStyle = `rgb(${Math.round(64 * k)},${Math.round(70 * k)},${Math.round(78 * k)})`;
        g.fillRect(x + 1, y + 1, 62, 62);
      }
      speckle(g, r, 1400, 1.5, [80, 86, 94], 0.4, 0.6);
      speckle(g, r, 30, 18, [40, 38, 36], 0.3, 0.25);
      break;
    }
    case CELL.ceiling: {
      fill('#c9c7c0');
      g.strokeStyle = '#8f8d87'; g.lineWidth = 3;
      for (let x = 0; x <= S; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
      for (let y = 0; y <= S; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
      speckle(g, r, 600, 1.2, [170, 168, 160], 0.3);
      // Light panels in two of the tiles
      for (const [x, y] of [[64, 64], [192, 192]]) {
        g.fillStyle = '#fff8e6'; g.fillRect(x + 6, y + 6, 52, 52);
        emis.fillStyle = '#ffe9c2'; emis.fillRect(x + 6, y + 6, 52, 52);
      }
      break;
    }
    case CELL.wall:
      fill('#bdb6aa');
      speckle(g, r, 1200, 2, [189, 182, 170], 0.15);
      // Faint scuffs and a chair rail of grime
      speckle(g, r, 60, 10, [150, 144, 132], 0.2, 0.25);
      break;
    case CELL.column:
      fill('#94918b');
      speckle(g, r, 1800, 2, [148, 145, 139], 0.25);
      cracks(g, r, 3, 'rgba(60,58,54,0.5)', 1.5);
      break;
    case CELL.scorch:
      fill('#1b1916');
      speckle(g, r, 900, 6, [40, 36, 30], 0.6, 0.6);
      break;
  }
}

let ATLAS = null;
/** The shared atlas textures: { map, emissive } */
export function interiorAtlas() {
  if (ATLAS) return ATLAS;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N * S; return c; };
  const cm = mk(), ce = mk(), g = cm.getContext('2d'), ge = ce.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, N * S, N * S);
  for (let id = 0; id < N * N; id++) {
    const x = (id % N) * S, y = Math.floor(id / N) * S;
    g.save(); ge.save();
    g.translate(x, y); ge.translate(x, y);
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    ge.beginPath(); ge.rect(0, 0, S, S); ge.clip();
    paint(id, g, rng(1000 + id * 77), ge);
    g.restore(); ge.restore();
  }
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  ATLAS = { map: tex(cm, true), emissive: tex(ce, true) };
  return ATLAS;
}

/** Atlas rectangle of a cell id: [u, v, w, h] */
export function cellRect(id) {
  const pad = 2 / (N * S);
  const u = (id % N) / N, v = 1 - (Math.floor(id / N) + 1) / N;
  return [u + pad, v + pad, 1 / N - 2 * pad, 1 / N - 2 * pad];
}

/** Sample the atlas inside the cell carried by each vertex (aCell), repeating with fract() */
function atlasPatch(sh, emissive) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 aCell;\nvarying vec4 vCell;\nvarying vec2 vTUv;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = aCell; vTUv = uv;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec4 vCell;\nvarying vec2 vTUv;')
    .replace('#include <map_fragment>', /* glsl */`
      vec2 tuv = fract(vTUv);
      vec2 cuv = vCell.xy + tuv * vCell.zw;
      vec2 gx = dFdx(vTUv) * vCell.zw, gy = dFdy(vTUv) * vCell.zw;
      diffuseColor *= textureGrad(map, cuv, gx, gy);`);
  if (emissive) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', /* glsl */`
      totalEmissiveRadiance *= textureGrad(emissiveMap, cuv, gx, gy).rgb;`);
  }
}

let MATS = null;
/** Materials for the voxel faces of structures (lit ceilings) and for flying rubble */
export function interiorMaterials() {
  if (MATS) return MATS;
  const A = interiorAtlas();
  const faces = new THREE.MeshStandardMaterial({
    map: A.map, emissiveMap: A.emissive, emissive: new THREE.Color(1.35, 1.25, 1.05), vertexColors: true, roughness: 0.92, metalness: 0.02,
  });
  faces.onBeforeCompile = (sh) => atlasPatch(sh, true);
  faces.customProgramCacheKey = () => 'destruct-faces';
  MATS = { faces };
  return MATS;
}
