import * as THREE from './three.js';
import { SPIDER_ATLAS, SPIDER_PARTS } from './spiderParts.js';

// ---------------------------------------------------------------------------
// Spider-frames: six-legged climbing machines that swarm the city.
//
// Locomotion follows how real spiders and procedural spider rigs move:
//   - The body rides a surface (street, wall or roof) with its own up vector.
//     Rays ahead find walls to climb onto (concave edges); a ray back under
//     the body finds the far side of a roof edge or building corner to wrap
//     around (convex edges). The rendered body eases into each new surface.
//   - Each foot is planted in world space. When it strays too far from its
//     rest spot, it steps: a ray from the hip toward the rest spot finds the
//     foothold, which can be on a different face than the body (feet reach
//     around corners first and the body follows).
//   - Legs step in an alternating tripod (front and back on one side with the
//     middle on the other), so three feet are always down.
//   - Jumps are ballistic. The spider crouches, leaps along an arc, turns its
//     underside to the landing surface in the air, and trails a silk dragline.
//
// Everything is instanced: each body part and leg segment is one InstancedMesh
// shared by every spider, so the whole swarm costs about a dozen draw calls.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);

const CAP = 64;               // most spiders alive at once
const FEMUR = 2.3;            // leg segment lengths, in body units
const TIBIA = 3.0;
const BODY_H = 1.15;          // body center above the surface
const GRAVITY = 30;
const STEP = 1.25;            // a planted foot steps when it is this far from its rest spot
const SPEED = 11;             // crawl speed

// Right-side legs, front to back (left legs mirror x): hip on the body, rest spot on the surface plane
const LEGS = [
  { hip: [0.6, 0.02, 0.72], rest: [2.3, 2.85] },
  { hip: [0.76, 0.04, 0.12], rest: [3.2, 0.55] },
  { hip: [0.64, 0.02, -0.42], rest: [2.65, -2.15] },
];
// Leg i: side = i < 3 ? left : right, pair = i % 3. Alternating tripods: L0 R1 L2 / R0 L1 R2.
const LEG_SIDE = [-1, -1, -1, 1, 1, 1];
const LEG_PAIR = [0, 1, 2, 0, 1, 2];
const LEG_GROUP = [0, 1, 0, 1, 0, 1];

// ---------------------------------------------------------------------------
// Variants: each has its own size, toughness, gait, body proportions, weapon,
// tactics and palette. Palettes are swapped per spider in the shader: lift
// brightens the bare metal toward white and tint colors it, accent replaces the
// red paint, and glow recolors the lit tubes and slits. Every variant keeps the
// red eyes.
//
//   leap: chance to leap to a new perch when choosing a goal
//   perch: how far from the mech it likes to perch; roof: share of roof perches
//   linger: how long it stays on a perch, relative to a stalker
// ---------------------------------------------------------------------------
export const VARIANTS = {
  stalker: {
    name: 'STALKER', size: [1.15, 1.55], hp: 26, speed: 1, legs: 1, abdomen: [1, 1, 1],
    weapon: 'plasma', leap: 0.55, perch: [20, 120], roof: 0.3, linger: 1,
    palette: { tint: [1, 1, 1], lift: 0, accent: [0.85, 0.08, 0.06], glow: [1, 0.16, 0.12] },
  },
  skitter: {
    name: 'SKITTERER', size: [0.78, 0.92], hp: 10, speed: 1.6, legs: 1.18, abdomen: [0.8, 0.9, 0.75],
    weapon: 'pounce', volatile: true, leap: 0, perch: [0, 0], roof: 0, linger: 0.3,
    palette: { tint: [1.35, 0.82, 0.48], lift: 0.14, accent: [0.4, 1, 0.08], glow: [0.45, 1, 0.08] },
  },
  weaver: {
    name: 'WEAVER', size: [1.05, 1.3], hp: 22, speed: 1.15, legs: 1.12, abdomen: [0.82, 0.82, 1.4],
    weapon: 'web', leap: 0.75, perch: [15, 90], roof: 0.25, linger: 0.8,
    palette: { tint: [1.05, 1.02, 0.96], lift: 0.55, accent: [0.12, 0.7, 1], glow: [0.2, 0.85, 1] },
  },
  lancer: {
    name: 'LANCER', size: [1.6, 1.8], hp: 55, speed: 0.75, legs: 1.05, abdomen: [1, 0.95, 1.15], lance: true,
    weapon: 'lance', leap: 0.45, perch: [55, 170], roof: 0.6, linger: 2.2, high: true,
    palette: { tint: [0.72, 0.86, 1.45], lift: 0.08, accent: [0.6, 0.15, 1], glow: [0.72, 0.25, 1] },
  },
  bombard: {
    name: 'BOMBARDIER', size: [1.4, 1.6], hp: 45, speed: 0.8, legs: 0.95, abdomen: [1.4, 1.35, 1.1],
    weapon: 'mortar', leap: 0.4, perch: [40, 150], roof: 0.85, linger: 2, high: true,
    palette: { tint: [1.75, 1.2, 0.55], lift: 0.06, accent: [1, 0.42, 0.03], glow: [1, 0.48, 0.06] },
  },
  brood: {
    name: 'BROODMOTHER', size: [2.5, 2.6], hp: 320, speed: 0.6, legs: 1, abdomen: [1.45, 1.4, 1.5],
    weapon: 'fan', boss: true, leap: 0.3, perch: [30, 110], roof: 0.5, linger: 1.6,
    palette: { tint: [0.5, 0.45, 0.58], lift: 0, accent: [1, 0.06, 0.4], glow: [1, 0.08, 0.45] },
  },
};
for (const id in VARIANTS) VARIANTS[id].id = id;

// Wave mix: [variant, weight, first wave, pack size]. A Broodmother leads every fifth wave.
const MIX = [['stalker', 4, 1, [1, 3]], ['skitter', 3, 1, [2, 4]], ['weaver', 2, 2, [1, 2]], ['lancer', 1.4, 3, [1, 1]], ['bombard', 1.4, 4, [1, 2]]];
const BOSS_EVERY = 5;

// Projectiles. color is HDR (it glows past white); trail is the particle color.
const BOLTS = {
  plasma: { speed: 46, dmg: 9, size: 1, color: [3.2, 0.42, 0.6], trail: [3, 0.4, 0.7], hit: 0xff2a40 },
  fan: { speed: 40, dmg: 8, size: 1.15, color: [3, 0.3, 1.5], trail: [2.6, 0.3, 1.3], hit: 0xff2a90 },
  web: { speed: 36, dmg: 3, size: 1.35, color: [2.2, 2.6, 3], trail: [1.3, 1.6, 1.9], hit: 0xc8f0ff, web: 2.8 },
  shell: { speed: 0, dmg: 24, size: 1.7, color: [3.2, 1.4, 0.25], trail: [2.4, 0.9, 0.2], hit: 0xffa040, splash: 7, gravity: 30 },
};

// Lasers: charge time, when the aim locks, damage, beam width and colors
const LASERS = {
  red: { charge: 0.95, lock: 0.78, dmg: 16, width: 0.45, glow: 1.6, dur: 0.3, line: 0xff1a24, beam: 0xff2a30, halo: 0xff1010 },
  lance: { charge: 1.7, lock: 1.4, dmg: 36, width: 0.85, glow: 2.8, dur: 0.45, line: 0xa040ff, beam: 0xc070ff, halo: 0x7020ff },
};

const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _g = new V3(), _h = new V3();
const _u = new V3(), _r = new V3(), _n = new V3(), _q = new V3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _col = new THREE.Color();
const UP = new V3(0, 1, 0);

// ---------------------------------------------------------------------------
// Geometry cut from the spider atlas
// ---------------------------------------------------------------------------

const AW = SPIDER_ATLAS.w, AH = SPIDER_ATLAS.h;
const EDGE_UV = new THREE.Vector2(1014 / AW, 1 - 1014 / AH); // an unused black corner: plate edges read as dark seams

function addColor(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = fn ? fn(p.getX(i), p.getY(i), p.getZ(i)) : 1;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/**
 * A plate cut to a traced part outline, with the part's art on both faces.
 * Local space: the part's top end at the origin and its tip at (0, -1, 0),
 * so scaling by a segment's length makes it span joint to joint. Curved
 * parts are rotated so their actual tip lands on the end. Thickness runs
 * along z from -0.5 to 0.5.
 */
function plateGeo(name) {
  const { poly } = SPIDER_PARTS[name];
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of poly) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const top = poly.filter(([, y]) => y < minY + (maxY - minY) * 0.12);
  const tx = top.reduce((s, p) => s + p[0], 0) / top.length, ty = top.reduce((s, p) => s + p[1], 0) / top.length;
  let tip = poly[0];
  for (const p of poly) if (p[1] > tip[1]) tip = p;
  const L = Math.hypot(tip[0] - tx, tip[1] - ty), ang = Math.atan2(tip[0] - tx, tip[1] - ty);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // image (x right, y down) <-> local (x right, y up, tip at -1)
  const toLocal = (x, y) => {
    const dx = (x - tx) / L, dy = (y - ty) / L;
    return new THREE.Vector2(dx * ca - dy * sa, -(dx * sa + dy * ca));
  };
  const uvOf = (lx, ly) => {
    const rx = lx, ry = -ly;
    return new THREE.Vector2((tx + (rx * ca + ry * sa) * L) / AW, 1 - (ty + (-rx * sa + ry * ca) * L) / AH);
  };
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(poly.map(([x, y]) => toLocal(x, y))), {
    depth: 0.7, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.01, bevelOffset: -0.01, bevelSegments: 1,
    UVGenerator: {
      generateTopUV(_g, v, a, b, c) { return [uvOf(v[a * 3], v[a * 3 + 1]), uvOf(v[b * 3], v[b * 3 + 1]), uvOf(v[c * 3], v[c * 3 + 1])]; },
      generateSideWallUV() { return [EDGE_UV, EDGE_UV, EDGE_UV, EDGE_UV]; },
    },
  });
  g.translate(0, 0, -0.35);
  return addColor(g);
}

/** Ellipsoid with a rectangle of the atlas projected onto it from above (front at the image top) */
function hullGeo(name, sx, sy, sz) {
  const g = new THREE.SphereGeometry(1, 24, 14);
  const [rx, ry, rw, rh] = SPIDER_PARTS[name].rect;
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (rx + (p.getX(i) * 0.5 + 0.5) * rw) / AW, 1 - (ry + (0.5 - p.getZ(i) * 0.5) * rh) / AH);
  }
  addColor(g, (x, y) => (y >= 0 ? 1 : 0.3 + 0.7 * (1 + y)));
  g.scale(sx, sy, sz);
  return g;
}

/** Joint disc: the turbine art on both caps, dark rim. Axis along local y. */
function jointGeo() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 18, 1);
  const [rx, ry, rw, rh] = SPIDER_PARTS.joint.rect;
  const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, (rx + (p.getX(i) * 0.5 + 0.5) * rw) / AW, 1 - (ry + (p.getZ(i) * 0.5 + 0.5) * rh) / AH);
    else uv.setXY(i, EDGE_UV.x, EDGE_UV.y);
  }
  return addColor(g);
}

/** Plate matrix: top end at o, tip along tipDir, art facing rightHint × up, width wk of the length */
function plateMatrix(out, o, tipDir, rightHint, len, wk, thick) {
  _u.copy(tipDir).normalize().negate();
  _r.copy(rightHint).addScaledVector(_u, -rightHint.dot(_u));
  if (_r.lengthSq() < 1e-8) _r.set(1, 0, 0).addScaledVector(_u, -_u.x);
  _r.normalize();
  _n.crossVectors(_r, _u);
  out.makeBasis(_r.multiplyScalar(len * wk), _u.multiplyScalar(len), _n.multiplyScalar(thick));
  return out.setPosition(o);
}

// ---------------------------------------------------------------------------
// Beam shader (camera-facing ribbon along local +y, 0..1)
// ---------------------------------------------------------------------------

const BEAM_VERT = /* glsl */`
uniform float uWidth;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 base = (modelMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz;
  vec3 axis = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 side = cross(axis, cameraPosition - base);
  float L = length(side);
  side = L > 1e-5 ? side / L : vec3(1.0, 0.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(base + side * position.x * uWidth, 1.0);
}`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uAlpha; uniform float uCore; uniform float uTime;
varying vec2 vUv;
void main() {
  float d = abs(vUv.x - 0.5) * 2.0;
  float glow = pow(1.0 - d, 2.2);
  float core = smoothstep(0.35, 0.0, d) * uCore;
  float ripple = 0.8 + 0.2 * sin(vUv.y * 220.0 - uTime * 80.0);
  gl_FragColor = vec4((uColor * glow * 1.5 + vec3(1.0, 0.85, 0.85) * core) * ripple * uAlpha, 1.0);
}`;
const BEAM_GEO = new THREE.PlaneGeometry(1, 1, 1, 6).translate(0, 0.5, 0);

function beamMesh(color) {
  const m = new THREE.Mesh(BEAM_GEO, new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 }, uCore: { value: 1 }, uWidth: { value: 1 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  }));
  m.frustumCulled = false;
  m.renderOrder = 6;
  m.visible = false;
  return m;
}

/** Target reticle for mortar landing spots: a heavy ring, a dashed inner ring, ticks and a faint fill */
function markerTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  g.strokeStyle = g.fillStyle = '#fff';
  g.globalAlpha = 0.12;
  g.beginPath(); g.arc(m, m, m - 8, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  g.lineWidth = 12;
  g.beginPath(); g.arc(m, m, m - 10, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5;
  g.setLineDash([14, 12]);
  g.beginPath(); g.arc(m, m, m * 0.5, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  for (let i = 0; i < 4; i++) {
    g.save(); g.translate(m, m); g.rotate(i * Math.PI / 2);
    g.fillRect(-4, -m + 14, 8, 40);
    g.restore();
  }
  g.fillRect(m - 10, m - 2, 20, 4); g.fillRect(m - 2, m - 10, 4, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Body layout, in body units: x right, y up, z forward, origin at the body center
// ---------------------------------------------------------------------------

function bodyLocals(v) {
  const L = {};
  const [ax, ay, az] = v.abdomen;
  const zc = -1.95 - 1.65 * (az - 1); // longer abdomens grow backward, not into the head
  L.cepha = new THREE.Matrix4().makeTranslation(0, 0, 0.15);
  L.abdomen = new THREE.Matrix4().makeRotationX(0.25).scale(new V3(ax, ay, az)).setPosition(0, 0.4, zc);
  L.thorax = plateMatrix(new THREE.Matrix4(), new V3(0, 0.5, 1.15), new V3(0, -0.12, -1), new V3(1, 0, 0), 2.15, 1, 0.12);
  L.face = plateMatrix(new THREE.Matrix4(), new V3(0, 0.45, 1.18), new V3(0, -0.82, 0.57), new V3(1, 0, 0), 1.3, 1, 0.14);
  L.brow = plateMatrix(new THREE.Matrix4(), new V3(0, 0.66, 0.45), new V3(0, 0.12, 1), new V3(1, 0, 0), 1.15, 1, 0.12);
  L.spine = plateMatrix(new THREE.Matrix4(), new V3(0, 0.4 + 0.78 * ay, zc + 1.2 * az), new V3(0, 0.22, -1), new V3(0, 1, 0), 2.5 * az, 0.8, 0.14);
  // Lancers carry a long dorsal lance over the head; the beam fires from its tip
  L.lance = plateMatrix(new THREE.Matrix4(), new V3(0, 1.0, -0.4), new V3(0, 0.08, 1), new V3(0, 1, 0), 3.4, 0.9, 0.2);
  L.spinneret = new V3(0, 0.4 + 0.35 * ay, zc - 1.5 * az);
  L.mortar = new V3(0, 0.4 + 1.0 * ay, zc + 0.3);
  return L;
}

// Points on the body, in body units
const EYES_BIG = [[-0.16, 0.2, 1.5], [0.16, 0.2, 1.5]];
const EYES_SMALL = [[-0.32, 0.36, 1.36], [0.32, 0.36, 1.36], [-0.1, 0.42, 1.32], [0.1, 0.42, 1.32]];
const MOUTH = new V3(0, -0.3, 1.75);
const EYE = new V3(0, 0.25, 1.55);
const LANCE_TIP = new V3(0, 1.25, 2.95);
const BODY_MID = new V3(0, 0.25, -0.35);
const NONE = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------------------
// The swarm
// ---------------------------------------------------------------------------

export class SpiderSwarm {
  /**
   * cb: { onWave(n), onWaveClear(n), onKill(spider), onPlayerHit(amount, fromPos, kind), onSpawn() }
   */
  constructor({ scene, world, fx, sound, tex, glowTex, cb }) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.sound = sound;
    this.cb = cb || {};
    this.list = [];
    this.free = [];
    for (let i = CAP - 1; i >= 0; i--) this.free.push(i);
    this.time = 0;
    this.kills = 0;
    this.wave = 0;
    this.phase = 'off';
    this.bolts = [];
    this.lasers = [];
    this.stepSounds = 0;
    this.buildings = world.colliders.filter((c) => c.building && c.max.y > 6 && (c.max.x - c.min.x) > 4 && (c.max.z - c.min.z) > 4);
    this.locals = {};
    for (const id in VARIANTS) this.locals[id] = bodyLocals(VARIANTS[id]);
    this.shells = 0;

    // Materials and instanced parts
    const mat = (this.mat = new THREE.MeshStandardMaterial({
      map: tex.spider, emissiveMap: tex.spiderGlow, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.4,
      metalness: 0.6, roughness: 0.42, vertexColors: true,
    }));
    // Palette swap: red paint takes the accent color, bare metal takes the tint, glow takes the glow color
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aTint; attribute vec3 aAccent; attribute vec3 aGlow;
          varying vec4 vTint; varying vec3 vAccent; varying vec3 vGlow;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vTint = aTint; vAccent = aAccent; vGlow = aGlow;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vTint; varying vec3 vAccent; varying vec3 vGlow;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 tc = diffuseColor.rgb;
            float paint = clamp((tc.r - max(tc.g, tc.b)) * 3.0, 0.0, 1.0);
            float lum = dot(tc, vec3(0.299, 0.587, 0.114));
            vec3 metal = (tc + vTint.a * (1.0 - tc)) * vTint.rgb;
            diffuseColor.rgb = min(mix(metal, lum * vAccent * 2.4, paint), vec3(1.0));
          }`)
        .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
            vec4 emissiveColor = texture2D(emissiveMap, vEmissiveMapUv);
            totalEmissiveRadiance *= max(emissiveColor.r, max(emissiveColor.g, emissiveColor.b)) * vGlow;
          #endif`);
    };
    const inst = (geo, per) => {
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(CAP * per * 4).fill(1), 4));
      for (const name of ['aAccent', 'aGlow']) geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(CAP * per * 3).fill(1), 3));
      const m = new THREE.InstancedMesh(geo, mat, CAP * per);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      for (let i = 0; i < CAP * per; i++) { m.setMatrixAt(i, _m.makeScale(0, 0, 0)); m.setColorAt(i, new THREE.Color(1, 1, 1)); }
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.per = per;
      scene.add(m);
      return m;
    };
    this.parts = {
      cepha: inst(hullGeo('thorax', 0.95, 0.52, 1.15), 1),
      abdomen: inst(hullGeo('abdomen', 1.2, 0.92, 1.65), 1),
      thorax: inst(plateGeo('thorax'), 1),
      face: inst(plateGeo('face'), 1),
      brow: inst(plateGeo('brow'), 1),
      spine: inst(plateGeo('spine'), 1),
      fangL: inst(plateGeo('fangL'), 1),
      fangR: inst(plateGeo('fangR'), 1),
      // Each leg segment is two plates crossed along its length, so it has body from any angle
      femur: inst(plateGeo('femur'), 6),
      femurX: inst(plateGeo('femur'), 6),
      tibia: inst(plateGeo('tibia'), 6),
      tibiaX: inst(plateGeo('tibia'), 6),
      joint: inst(jointGeo(), 12),
      lance: inst(plateGeo('claw'), 1),
    };

    // Glowing eyes: two point clouds (big main eyes, small side eyes), additive
    const eyes = (count, size) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * count * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAP * count * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(CAP * count).fill(1), 1));
      const pm = new THREE.PointsMaterial({
        map: glowTex, size, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      });
      // Eyes grow with the spider
      pm.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSize;')
          .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
      };
      const p = new THREE.Points(g, pm);
      p.frustumCulled = false;
      p.renderOrder = 5;
      p.per = count;
      scene.add(p);
      return p;
    };
    this.eyesBig = eyes(2, 2.7);
    this.eyesSmall = eyes(4, 1.4);

    // Silk draglines
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 6), 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAP * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.silk = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.silk.frustumCulled = false;
    scene.add(this.silk);

    // Bolts, web globs and mortar shells, colored per instance
    this.boltMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.34, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 240);
    this.boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boltMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.boltMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Mortar target markers on the ground, warning where shells will land
    const ringMat = new THREE.MeshBasicMaterial({
      map: markerTexture(), color: new THREE.Color(2.2, 0.45, 0.08), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 16; i++) {
      const r = new THREE.Mesh(ringGeo, ringMat.clone());
      r.visible = false;
      r.renderOrder = 3;
      r.frustumCulled = false;
      scene.add(r);
      this.rings.push(r);
    }
    this.boltMesh.frustumCulled = false;
    this.boltMesh.count = 0;
    scene.add(this.boltMesh);

    // Laser pool: each laser has an aiming line and a beam
    this.laserPool = [];
    for (let i = 0; i < 10; i++) {
      const line = beamMesh(0xff1a24), beam = beamMesh(0xff2a30), glow = beamMesh(0xff1010);
      scene.add(line, beam, glow);
      this.laserPool.push({ line, beam, glow, busy: false });
    }
  }

  get alive() { return this.list.reduce((n, s) => n + (s.alive ? 1 : 0), 0); }
  get hostiles() { return this.alive + Math.max(0, this.toSpawn || 0); }
  get boss() { return this.list.find((s) => s.boss && s.alive) || null; }

  // ---- game flow -------------------------------------------------------------------

  start() {
    this.clear();
    this.wave = 0;
    this.kills = 0;
    this.phase = 'lull';
    this.phaseT = 3.5;
  }

  clear() {
    for (const s of [...this.list]) this.remove(s);
    for (const b of this.bolts) if (b.ring) b.ring.visible = false;
    this.bolts.length = 0;
    for (const L of this.lasers) this.endLaser(L);
    this.lasers.length = 0;
    this.toSpawn = 0;
  }

  updateWaves(dt, ctx) {
    if (this.phase === 'lull') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.wave++;
        this.toSpawn = 6 + this.wave * 6;
        this.maxAlive = Math.min(CAP, 6 + this.wave * 5);
        this.spawnEvery = Math.max(0.22, 1.5 - this.wave * 0.16);
        this.spawnT = 0.5;
        this.phase = 'active';
        this.bossDue = this.wave % BOSS_EVERY === 0;
        if (this.bossDue) this.toSpawn++;
        // Variants joining the fight this wave, for the wave banner
        const fresh = MIX.filter((m) => m[2] === this.wave).map((m) => VARIANTS[m[0]].name);
        this.cb.onWave && this.cb.onWave(this.wave, fresh, this.bossDue);
      }
    } else if (this.phase === 'active') {
      this.spawnT -= dt;
      const alive = this.alive;
      if (this.bossDue && alive < CAP - 4) {
        if (this.spawnPack(1, ctx, 'brood')) { this.bossDue = false; this.toSpawn--; }
      } else if (this.spawnT <= 0 && this.toSpawn > 0 && alive < this.maxAlive) {
        const [id, , , pack] = this.pickVariant();
        const n = Math.min(this.toSpawn, this.maxAlive - alive, pack[0] + Math.floor(Math.random() * (pack[1] - pack[0] + 1)));
        this.toSpawn -= this.spawnPack(n, ctx, id);
        this.spawnT = this.spawnEvery * rand(0.6, 1.4);
      }
      if (this.toSpawn <= 0 && alive === 0) {
        this.phase = 'lull';
        this.phaseT = 7;
        this.cb.onWaveClear && this.cb.onWaveClear(this.wave);
      }
    }
  }

  pickVariant() {
    const open = MIX.filter((m) => m[2] <= Math.max(1, this.wave));
    let r = Math.random() * open.reduce((t, m) => t + m[1], 0);
    for (const m of open) if ((r -= m[1]) <= 0) return m;
    return open[0];
  }

  // ---- surface queries ---------------------------------------------------------------

  ray(o, d, max) { return this.world.raycast(o, d, max, { targets: false }); }

  /** A point on one face of a building collider. face: 0 top, 1 +x, 2 -x, 3 +z, 4 -z */
  facePoint(c, face, u, v, out) {
    const m = 1.6;
    const lx = (a, b, t) => a + m + (b - a - 2 * m) * t;
    const n = new V3();
    if (face === 0) { out.set(lx(c.min.x, c.max.x, u), c.max.y, lx(c.min.z, c.max.z, v)); n.set(0, 1, 0); }
    else {
      const y = Math.max(c.min.y + 3, 3) + (c.max.y - 1.5 - Math.max(c.min.y + 3, 3)) * v;
      if (face === 1) { out.set(c.max.x, y, lx(c.min.z, c.max.z, u)); n.set(1, 0, 0); }
      if (face === 2) { out.set(c.min.x, y, lx(c.min.z, c.max.z, u)); n.set(-1, 0, 0); }
      if (face === 3) { out.set(lx(c.min.x, c.max.x, u), y, c.max.z); n.set(0, 0, 1); }
      if (face === 4) { out.set(lx(c.min.x, c.max.x, u), y, c.min.z); n.set(0, 0, -1); }
    }
    return n;
  }

  /** The face point is real, exposed surface on that collider (not buried against a neighbor) */
  exposed(p, n, c) {
    const h = this.ray(_a.copy(p).addScaledVector(n, 2.5), _b.copy(n).negate(), 3.2);
    return h && h.collider === c && Math.abs(h.dist - 2.5) < 0.2;
  }

  /**
   * Find a perch: an exposed point on a building around `center`, between rMin and
   * rMax away. With `toward`, walls must face that point and the perch must see it.
   */
  findPerch(center, rMin, rMax, { toward = null, see = false, roof = 0.3, avoidView = null, tries = 14 } = {}) {
    const near = this.buildings.filter((c) => {
      const cx = (c.min.x + c.max.x) / 2 - center.x, cz = (c.min.z + c.max.z) / 2 - center.z, d = Math.hypot(cx, cz);
      return d > rMin && d < rMax;
    });
    if (!near.length) return null;
    const p = new V3();
    for (let i = 0; i < tries; i++) {
      const c = near[Math.floor(Math.random() * near.length)];
      let face = 0;
      if (Math.random() > roof) {
        if (toward) {
          const dx = toward.x - (c.min.x + c.max.x) / 2, dz = toward.z - (c.min.z + c.max.z) / 2;
          face = Math.abs(dx) / (c.max.x - c.min.x) > Math.abs(dz) / (c.max.z - c.min.z) ? (dx > 0 ? 1 : 2) : (dz > 0 ? 3 : 4);
        } else face = 1 + Math.floor(Math.random() * 4);
      }
      const n = this.facePoint(c, face, Math.random(), face ? rand(0.15, 0.95) : Math.random(), p);
      if (face && p.y < 4) continue;
      if (!this.exposed(p, n, c)) continue;
      if (avoidView && avoidView(p)) continue;
      if (see && toward && !this.clearLine(_c.copy(p).addScaledVector(n, 1.8), toward)) continue;
      return { point: p.clone(), normal: n, collider: c };
    }
    return null;
  }

  clearLine(a, b) {
    const d = _d.subVectors(b, a), L = d.length();
    if (L < 1e-3) return true;
    return !this.ray(a, d.divideScalar(L), L - 1.5);
  }

  // ---- spawning ------------------------------------------------------------------------

  spawnPack(n, ctx, id = 'stalker') {
    const P = ctx.player.pos, cam = ctx.camera, v = VARIANTS[id];
    // Spawn out of sight: behind the camera, or far off
    const inView = (p) => {
      _e.copy(p).project(cam);
      return _e.z < 1 && Math.abs(_e.x) < 1.1 && Math.abs(_e.y) < 1.1 && p.distanceTo(P) < 150;
    };
    const perch = this.findPerch(P, 75, 230, { roof: v.boss ? 0.7 : 0.45, avoidView: inView, tries: 24 });
    if (!perch) return 0;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const p = i === 0 ? perch : this.findPerch(perch.point, 0, 30, { roof: 0.5, tries: 6 }) || perch;
      if (this.spawn(p, id)) made++;
    }
    if (made) {
      if (v.boss) this.sound.broodRoar(perch.point);
      else if (id === 'skitter') this.sound.skitterChirp(perch.point);
      else this.sound.spiderScreech(perch.point);
      this.cb.onSpawn && this.cb.onSpawn(made, v);
    }
    return made;
  }

  spawn(perch, id = 'stalker') {
    if (!this.free.length) return null;
    const v = VARIANTS[id];
    const slot = this.free.pop();
    const sc = rand(v.size[0], v.size[1]);
    // Bigger ones of a kind are a little tougher, up to the variant's hp
    const hp = v.hp * (0.85 + 0.15 * (sc - v.size[0]) / (v.size[1] - v.size[0] || 1));
    const s = {
      kind: 'spider', v, name: v.name, boss: !!v.boss, legs: v.legs, removed: false,
      slot, alive: true, scale: sc, hp, maxHp: hp, radius: 2.2 * sc,
      pos: new V3(), vel: new V3(), p: perch.point.clone(), n: perch.normal.clone(), f: new V3(), support: perch.collider,
      ns: perch.normal.clone(), fs: new V3(), c: new V3(), moveVel: new V3(),
      state: 'emerge', timer: 0.8, t: 0, goal: null, losT: rand(0, 0.3), see: false, seeT: 0,
      cool: { plasma: rand(1.5, 3), laser: rand(4, 8), web: rand(1.5, 3), mortar: rand(2, 4), pounce: rand(0.5, 1.5), brood: rand(3, 5) },
      burst: 0, burstT: 0, laser: null, brood: 0,
      pitch: 0, pitchT: 0, crouch: 0, fang: 0, flash: 0, glow: 0, speed: SPEED * v.speed * rand(0.9, 1.15) / Math.sqrt(sc),
      best: Infinity, stuckT: 0, flight: null, silk: null, spin: new V3(), deadT: 0,
      feet: [],
    };
    // A random heading on the surface
    s.f.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).addScaledVector(s.n, -s.f.dot(s.n));
    if (s.f.lengthSq() < 1e-4) s.f.set(1, 0, 0).addScaledVector(s.n, -s.n.x);
    s.f.normalize();
    s.fs.copy(s.f);
    s.c.copy(s.p).addScaledVector(s.n, BODY_H * sc);
    s.pos.copy(s.c);
    // Legs unfold from a curl onto their footholds
    const fr = this.frame(s);
    for (let i = 0; i < 6; i++) {
      const L = LEGS[LEG_PAIR[i]], sd = LEG_SIDE[i];
      const curl = new V3().copy(s.c).addScaledVector(fr.right, sd * L.rest[0] * 0.3 * sc).addScaledVector(fr.fwd, L.rest[1] * 0.3 * sc).addScaledVector(s.n, 0.2 * sc);
      const foot = { pos: curl.clone(), from: curl.clone(), to: curl.clone(), t: 0, dur: 0.45 + Math.random() * 0.25 };
      const hold = this.foothold(s, this.hipWorld(s, i, fr, _g), this.restPoint(s, i, _h));
      if (hold) foot.to.copy(hold);
      s.feet.push(foot);
    }
    this.list.push(s);
    this.world.targets.push(s);
    this.paint(s);
    return s;
  }

  /** Write the spider's palette (with a little per-spider variation) into its instances */
  paint(s) {
    const pal = s.v.palette, k = rand(0.9, 1.1);
    const tint = pal.tint.map((x) => x * k);
    for (const key in this.parts) {
      const mesh = this.parts[key], g = mesh.geometry;
      for (let i = 0; i < mesh.per; i++) {
        const idx = s.slot * mesh.per + i;
        g.attributes.aTint.setXYZW(idx, tint[0], tint[1], tint[2], pal.lift);
        g.attributes.aAccent.setXYZ(idx, ...pal.accent);
        g.attributes.aGlow.setXYZ(idx, ...pal.glow);
      }
      g.attributes.aTint.needsUpdate = g.attributes.aAccent.needsUpdate = g.attributes.aGlow.needsUpdate = true;
    }
    for (const pts of [this.eyesBig, this.eyesSmall]) {
      const a = pts.geometry.attributes.aSize;
      for (let i = 0; i < pts.per; i++) a.setX(s.slot * pts.per + i, s.scale / 1.35);
      a.needsUpdate = true;
    }
  }

  remove(s) {
    if (s.removed) return;
    s.removed = true;
    s.alive = false;
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
    const t = this.world.targets.indexOf(s);
    if (t >= 0) this.world.targets.splice(t, 1);
    if (s.laser) this.endLaser(s.laser);
    // Hide its instances
    _m.makeScale(0, 0, 0);
    for (const key in this.parts) {
      const mesh = this.parts[key];
      for (let k = 0; k < mesh.per; k++) mesh.setMatrixAt(s.slot * mesh.per + k, _m);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const pts of [this.eyesBig, this.eyesSmall]) {
      const c = pts.geometry.attributes.color;
      for (let k = 0; k < pts.per; k++) c.setXYZ(s.slot * pts.per + k, 0, 0, 0);
      c.needsUpdate = true;
    }
    const sc = this.silk.geometry.attributes.color;
    sc.setXYZ(s.slot * 2, 0, 0, 0); sc.setXYZ(s.slot * 2 + 1, 0, 0, 0);
    sc.needsUpdate = true;
    this.free.push(s.slot);
  }

  // ---- damage --------------------------------------------------------------------------

  damage(s, amount, point) {
    if (!s.alive) return false;
    s.hp -= amount;
    s.flash = 1;
    if (s.hp > 0) {
      // Hit spiders flinch and lose their footing for a moment if it's a big hit
      if (amount > 25 && s.state !== 'jump') s.pitch = -0.25;
      return false;
    }
    this.kill(s, point);
    return true;
  }

  kill(s, point) {
    s.alive = false;
    s.state = 'dead';
    s.deadT = 0;
    if (s.laser) this.endLaser(s.laser);
    const t = this.world.targets.indexOf(s);
    if (t >= 0) this.world.targets.splice(t, 1);
    this.kills++;
    const fx = this.fx, g = s.v.palette.glow, glow = _col.setRGB(g[0], g[1], g[2]).getHex();
    fx.flash(s.c, 5 * s.scale, glow, 0.2);
    fx.sparksBurst(s.c, s.ns, 30, glow, 34);
    for (let i = 0; i < 10; i++) {
      fx.fire.emit(s.c.x, s.c.y, s.c.z, rand(-6, 6), rand(-2, 8), rand(-6, 6), rand(0.25, 0.5), 1.5 * s.scale, 3.5 * s.scale, g[0] * 3, g[1] * 3, g[2] * 3, 1, g[0], g[1], g[2], 0, 3);
    }
    fx.light(s.c, glow, 60, 0.25, 40);
    this.sound.spiderDie(s.c);
    this.cb.onKill && this.cb.onKill(s);
    // Skitterers burst when shot, and take anything close along with them
    if (s.v.volatile) { this.detonate(s); return; }
    if (s.boss) { fx.explosion(s.c, 1.6); this.sound.broodRoar(s.c, 1); }
    // The corpse drops off its surface, tumbling, legs curling
    s.vel.copy(s.ns).multiplyScalar(rand(4, 8)).add(_a.set(rand(-3, 3), rand(2, 6), rand(-3, 3)));
    s.spin.set(rand(-4, 4), rand(-4, 4), rand(-4, 4)).multiplyScalar(1 / s.scale);
  }

  // ---- per-frame -------------------------------------------------------------------------

  /** ctx: { player: { pos, vel, chest, alive }, camera } */
  update(dt, ctx) {
    this.time += dt;
    this.stepSounds = 0;
    this.P = ctx.player;
    this.updateWaves(dt, ctx);
    // Iterate a copy: spiders can be removed mid-frame (detonations, chain explosions)
    for (const s of [...this.list]) {
      if (s.removed) continue;
      this.think(s, dt, ctx);
      if (!s.removed) this.render(s, dt);
    }
    this.updateBolts(dt, ctx);
    this.updateLasers(dt, ctx);
    this.updateSilk(dt);
    for (const key in this.parts) {
      this.parts[key].instanceMatrix.needsUpdate = true;
      if (this.parts[key].instanceColor) this.parts[key].instanceColor.needsUpdate = true;
    }
    for (const pts of [this.eyesBig, this.eyesSmall]) {
      pts.geometry.attributes.position.needsUpdate = true;
      pts.geometry.attributes.color.needsUpdate = true;
    }
  }

  think(s, dt, ctx) {
    const P = ctx.player;
    s.t += dt;
    s.flash = Math.max(0, s.flash - dt * 6);
    if (s.state === 'dead') { this.corpse(s, dt); return; }
    for (const k in s.cool) s.cool[k] -= dt;
    s.losT -= dt;
    s.glow = Math.min(1, s.glow + dt * 1.5);
    if (s.losT <= 0) {
      s.losT = rand(0.25, 0.45);
      const eye = this.bodyPoint(s, EYE, _a);
      s.see = P.alive && eye.distanceTo(P.chest) < 240 && this.clearLine(eye, P.chest);
    }
    s.seeT = s.see ? s.seeT + dt : 0;
    // A spider lost somewhere far off for a long time goes back into the wave's pool
    s.lostT = s.see ? 0 : (s.lostT || 0) + dt;
    if (s.lostT > 40 && s.state === 'crawl' && s.c.distanceTo(P.pos) > 120) {
      this.remove(s);
      this.toSpawn++;
      return;
    }
    s.moveVel.set(0, 0, 0);

    // Skitterers blow up when they reach the mech
    if (s.v.volatile && P.alive && capsuleDist(s.c, P.pos) < 2 + s.scale) { this.detonate(s); return; }
    // The Broodmother gives birth to skitterers
    if (s.boss && s.cool.brood <= 0 && (s.state === 'crawl' || s.state === 'perch')) this.birth(s);

    switch (s.state) {
      case 'emerge':
        s.timer -= dt;
        if (s.timer <= 0) { s.state = 'crawl'; s.goal = null; }
        break;
      case 'crawl': if (s.v.weapon === 'pounce') this.skitterAI(s, dt, P); else this.crawlAI(s, dt, P); break;
      case 'perch': this.perchAI(s, dt, P); break;
      case 'crouch':
        s.timer -= dt;
        s.crouch = Math.min(1, s.crouch + dt * 6);
        if (s.timer <= 0) this.launch(s);
        break;
      case 'jump': case 'fall': this.flight(s, dt); break;
    }
    if (s.removed) return;
    if (s.state !== 'crouch') s.crouch = Math.max(0, s.crouch - dt * 5);

    // Rear up toward the player while perched
    let pitchT = 0;
    if (s.state === 'perch' && s.see) {
      const fr = this.frame(s);
      _a.subVectors(P.chest, s.c);
      pitchT = clamp(Math.atan2(_a.dot(fr.up), Math.max(0.1, _a.dot(fr.fwd))), 0, 0.9);
    }
    s.pitch += (pitchT - s.pitch) * (1 - Math.exp(-dt * 5));
    s.fang += ((s.burst > 0 || (s.laser && s.laser.phase === 'charge') ? 1 : 0.1 + 0.1 * Math.sin(s.t * 9)) - s.fang) * (1 - Math.exp(-dt * 10));

    if (s.state === 'crawl' || s.state === 'perch') this.weapons(s, dt, P);
    this.legs(s, dt);
    s.pos.copy(s.c);
    s.vel.copy(s.moveVel);
  }

  // ---- AI -----------------------------------------------------------------------------

  crawlAI(s, dt, P) {
    s.timer -= dt;
    if (!s.goal || s.timer <= 0) this.chooseGoal(s, P);
    this.steer(s, dt);
  }

  /** Skitterers rush the mech along any surface and pounce on it, from the street or off a wall */
  skitterAI(s, dt, P) {
    const onGround = !s.support || s.support.low || s.p.y < 1;
    const d = s.c.distanceTo(P.chest);
    if (P.alive && s.see && s.cool.pounce <= 0 && d > 6 && d < (onGround ? 34 : 60)) { this.pounce(s, P); return; }
    s.timer -= dt;
    if (!s.goal || s.timer <= 0) {
      s.timer = rand(0.8, 1.4);
      s.best = Infinity;
      s.stuckT = 0;
      s.goal = onGround ? { point: P.pos.clone(), charge: true } : { point: new V3(P.pos.x, 0, P.pos.z), descend: true, charge: true };
    }
    this.steer(s, dt);
  }

  /** Crawl along the surface toward the current goal */
  steer(s, dt) {
    if (s.state !== 'crawl') return;
    const g = s.goal;
    if (!g) return;
    const onGround = !s.support || s.support.low || s.p.y < 1;
    // Steer along the surface toward the goal; descending spiders head for the street first
    _a.subVectors(g.point, s.p);
    const dist = _a.length();
    if (g.descend && !onGround) _a.set(_a.x * 0.15, -40, _a.z * 0.15);
    _a.addScaledVector(s.n, -_a.dot(s.n));
    // A goal mostly straight through the surface is on another face. On a wall, head up
    // (toward a roof) or down; the edge wrap in crawl() carries the spider over.
    if (_a.length() < dist * 0.3 && Math.abs(s.n.y) < 0.5) _a.set(0, g.point.y > s.p.y - 3 ? 1 : -1, 0).addScaledVector(s.n, -s.n.y);
    if (dist < 2.5) {
      if (g.charge && onGround) { s.goal = null; s.timer = 0; }
      else { s.state = 'perch'; s.timer = rand(2.5, 5.5) * s.v.linger; }
      return;
    }
    this.turn(s, _a.normalize(), 5, dt);
    const speed = s.speed * s.scale * (s.see ? 0.85 : 1);
    this.crawl(s, speed * dt);
    s.moveVel.copy(s.f).multiplyScalar(speed);
    // Give up on goals that stop getting closer
    if (dist < s.best - 1) { s.best = dist; s.stuckT = 0; } else if ((s.stuckT += dt) > 3) { s.goal = null; }
    // City limits
    const B = this.world.bounds;
    if (s.p.x < B.minX + 4 || s.p.x > B.maxX - 4 || s.p.z < B.minZ + 4 || s.p.z > B.maxZ - 4) {
      if (onGround) s.goal = { point: new V3((B.minX + B.maxX) / 2, 0, (B.minZ + B.maxZ) / 2), charge: true };
    }
  }

  perchAI(s, dt, P) {
    s.timer -= dt;
    // Face the player along the surface, with a nervous twitch now and then
    _a.subVectors(P.chest, s.p).addScaledVector(s.n, -_a.dot(s.n));
    if (_a.lengthSq() > 0.5) this.turn(s, _a.normalize(), 2.5, dt);
    if (Math.random() < dt * 0.8) {
      _b.crossVectors(s.n, s.f).multiplyScalar(rand(-0.6, 0.6));
      s.f.add(_b).addScaledVector(s.n, -s.f.dot(s.n)).normalize();
    }
    if (s.timer <= 0 || (!s.see && s.t > 2 && s.seeT === 0 && Math.random() < dt * 1.5)) {
      s.state = 'crawl';
      s.goal = null;
    }
  }

  turn(s, dir, rate, dt) {
    if (s.f.dot(dir) < -0.9) dir = _q.crossVectors(s.n, s.f);
    s.f.lerp(dir, Math.min(1, rate * dt)).addScaledVector(s.n, -s.f.dot(s.n)).normalize();
  }

  chooseGoal(s, P) {
    const v = s.v;
    s.timer = rand(5, 9);
    s.best = Infinity;
    s.stuckT = 0;
    const onGround = !s.support || s.support.low || s.p.y < 1;
    const r = Math.random();
    const toP = P.pos.distanceTo(s.p);
    // Leap to a perch that sees the player, at the distance this kind likes
    if (r < v.leap + (onGround ? 0.1 : 0)) {
      const perch = this.findPerch(P.pos, v.perch[0], v.perch[1], { toward: P.chest, see: true, roof: v.roof, tries: 10 });
      if (perch && perch.collider !== s.support && this.jumpPath(s, perch)) return;
    }
    // Climb to another spot on the building it is on; snipers and mortars climb high
    if (!onGround && (r < 0.85 || v.high) && s.support && s.support.building) {
      const c = s.support, p = new V3();
      for (let i = 0; i < 4; i++) {
        const face = Math.random() < (v.high ? v.roof : 0.35) ? 0 : (() => {
          const dx = P.pos.x - (c.min.x + c.max.x) / 2, dz = P.pos.z - (c.min.z + c.max.z) / 2;
          return Math.abs(dx) / (c.max.x - c.min.x) > Math.abs(dz) / (c.max.z - c.min.z) ? (dx > 0 ? 1 : 2) : (dz > 0 ? 3 : 4);
        })();
        const n = this.facePoint(c, face, Math.random(), face ? rand(v.high ? 0.6 : 0.2, 0.95) : Math.random(), p);
        if (this.exposed(p, n, c)) { s.goal = { point: p.clone(), normal: n, collider: c }; return; }
      }
    }
    if (onGround) {
      // Rush the player along the street, or climb whatever is nearest
      if (!v.high && toP > 30 && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2, d = rand(14, 30);
        s.goal = { point: new V3(P.pos.x + Math.cos(a) * d, 0, P.pos.z + Math.sin(a) * d), charge: true };
      } else {
        const perch = this.findPerch(s.p, 0, 45, { roof: v.high ? 0.5 : 0, tries: 8 });
        s.goal = perch || { point: P.pos.clone(), charge: true };
        if (perch && this.jumpPath(s, perch)) return;
      }
    } else if (v.high) {
      // Snipers and mortars stay up high: hop to another perch, or wait and look again
      const perch = this.findPerch(s.p, 10, 90, { toward: P.chest, see: true, roof: v.roof, tries: 8 });
      if (perch && this.jumpPath(s, perch)) return;
      s.goal = null;
      s.state = 'perch';
      s.timer = rand(1.5, 3);
    } else {
      // Drop to the street and rush the player
      s.goal = { point: new V3(P.pos.x, 0, P.pos.z), descend: true, charge: true };
    }
  }

  /** Skitterer leap straight at the mech's chest, leading it */
  pounce(s, P) {
    const from = s.c.clone();
    const d = from.distanceTo(P.chest), T = clamp(d / 32, 0.35, 1.4);
    const v = new V3().copy(P.chest).addScaledVector(P.vel, T * 0.7).sub(from).divideScalar(T);
    v.y += 0.5 * GRAVITY * T;
    s.flight = { vel: v, target: null, from, pounce: true };
    s.goal = null;
    s.state = 'crouch';
    s.timer = 0.16;
    s.cool.pounce = rand(1.5, 2.5);
    this.sound.skitterChirp(s.c);
  }

  /** A skitterer bursts, hurting the mech and any spider close by */
  detonate(s) {
    const p = s.c.clone(), P = this.P;
    this.remove(s);
    this.fx.explosion(p, 0.9 * s.scale, {});
    this.fx.flash(p, 9, 0x9cff40, 0.2);
    this.fx.sparksBurst(p, UP, 24, 0x9cff40, 30);
    this.sound.explosion(p, 1);
    if (P && P.alive) {
      const d = capsuleDist(p, P.pos);
      if (d < 9) this.cb.onPlayerHit && this.cb.onPlayerHit(8 + 26 * (1 - d / 9), p, 'blast');
    }
    this.world.damageRadius(p, 6, 30);
    if (this.world.destruct) this.world.destruct.blast(p, 1.5, 120, { enemy: true });
  }

  /** The Broodmother sets down a pair of skitterers beside her */
  birth(s) {
    s.cool.brood = rand(7, 10);
    const kids = this.list.filter((k) => k.mother === s && k.alive).length;
    if (kids >= 6 || this.free.length < 4) return;
    const fr = this.frame(s);
    for (const sd of [-1, 1]) {
      const at = s.p.clone().addScaledVector(fr.right, sd * 2.2 * s.scale).addScaledVector(fr.fwd, -1.5 * s.scale);
      const k = this.spawn({ point: at, normal: s.n.clone(), collider: s.support }, 'skitter');
      if (!k) break;
      k.mother = s;
      k.timer = 0.4;
      k.f.copy(fr.right).multiplyScalar(sd);
    }
    this.fx.sparksBurst(this.bodyPoint(s, this.locals.brood.spinneret, _a), s.n, 20, 0x9cff40, 18);
    this.sound.broodRoar(s.c, 0.5);
  }

  // ---- locomotion ------------------------------------------------------------------------

  /** Walk dist along the surface, wrapping onto walls ahead and around edges */
  crawl(s, dist) {
    const sc = s.scale;
    let guard = 0;
    while (dist > 1e-4 && guard++ < 6) {
      const step = Math.min(dist, 0.45);
      // Wall ahead (concave edge): the low and high probes both hit something facing us
      const lo = this.ray(_a.copy(s.p).addScaledVector(s.n, 0.5 * sc), s.f, step + BODY_H * sc);
      if (lo && lo.normal.dot(s.f) < -0.5) {
        const hi = this.ray(_b.copy(s.p).addScaledVector(s.n, 1.8 * sc), s.f, step + BODY_H * sc + 0.6);
        if (hi && hi.normal.dot(s.f) < -0.5) {
          s.f.copy(s.n);
          s.n.copy(lo.normal);
          s.p.copy(lo.point);
          s.support = lo.collider;
          dist -= step;
          continue;
        }
      }
      // Step forward and find the surface under the new spot (stepping over curbs and cars)
      _c.copy(s.p).addScaledVector(s.f, step);
      const probe = this.ray(_d.copy(_c).addScaledVector(s.n, 2.2), _e.copy(s.n).negate(), 2.2 + 2.6 * sc);
      if (probe && probe.normal.dot(s.n) > 0.7) {
        s.p.copy(probe.point);
        s.support = probe.collider;
      } else {
        // Past an edge (convex): the face we walked off of is just behind and below
        const wrap = this.ray(_d.copy(_c).addScaledVector(s.n, -0.6 * sc), _e.copy(s.f).negate(), step + 1.6);
        if (wrap && wrap.normal.dot(s.f) > 0.5) {
          const oldN = _g.copy(s.n);
          s.n.copy(wrap.normal);
          s.f.copy(oldN).negate();
          s.p.copy(wrap.point);
          s.support = wrap.collider;
        } else {
          // Nothing to hold on to
          s.state = 'fall';
          s.flight = { target: null };
          s.vel.copy(s.f).multiplyScalar(4);
          return;
        }
      }
      dist -= step;
    }
  }

  /** Plan a leap from the current spot to a perch; returns true and starts crouching if the arc is clear */
  jumpPath(s, perch) {
    const from = _a.copy(s.p).addScaledVector(s.n, BODY_H * s.scale);
    const to = _b.copy(perch.point).addScaledVector(perch.normal, BODY_H * s.scale);
    const d = from.distanceTo(to);
    if (d > 120 || d < 6) return false;
    const T = clamp(d / 34, 0.6, 2.4);
    const v = new V3().subVectors(to, from).divideScalar(T);
    v.y += 0.5 * GRAVITY * T;
    // Walk the arc in segments; it must reach the perch without hitting anything else
    let prev = from.clone();
    const k = 7;
    for (let i = 1; i <= k; i++) {
      const t = (T * i) / k;
      const cur = new V3(from.x + v.x * t, from.y + v.y * t - 0.5 * GRAVITY * t * t, from.z + v.z * t);
      const seg = _c.subVectors(cur, prev), L = seg.length();
      const hit = this.ray(prev, seg.divideScalar(L), L);
      if (hit && hit.point.distanceTo(perch.point) > 3.5) return false;
      prev = cur;
    }
    s.goal = perch;
    s.flight = { vel: v, target: perch, from: from.clone() };
    s.state = 'crouch';
    s.timer = 0.24;
    return true;
  }

  launch(s) {
    const fl = s.flight;
    s.state = 'jump';
    s.c.copy(fl.from);
    s.vel.copy(fl.vel);
    s.moveVel.copy(fl.vel); // think() hands moveVel back to vel at the end of the frame
    fl.t = 0;
    s.support = null;
    s.silk = { a: s.p.clone(), life: 1 };
    this.fx.dust(s.p, 0.5, 5);
    if (Math.random() < 0.35) this.sound.spiderScreech(s.c);
    else this.sound.spiderLeap(s.c);
  }

  flight(s, dt) {
    const fl = s.flight || {};
    fl.t = (fl.t || 0) + dt;
    s.vel.y -= GRAVITY * dt;
    const sp = s.vel.length();
    const dir = _a.copy(s.vel).divideScalar(sp || 1);
    if (fl.pounce && this.P && this.P.alive && capsuleDist(s.c, this.P.pos) < 1.8 + s.scale) { this.detonate(s); return; }
    const hit = fl.t > 0.06 ? this.ray(s.c, dir, sp * dt + 0.9 * s.scale) : null;
    if (hit) { this.land(s, hit); return; }
    s.c.addScaledVector(s.vel, dt);
    s.moveVel.copy(s.vel);
    // Turn the underside toward the landing surface (or the ground) while in the air
    const n = fl.target ? fl.target.normal : UP;
    s.n.lerp(n, Math.min(1, dt * 3.5)).normalize();
    _b.copy(s.vel).addScaledVector(s.n, -s.vel.dot(s.n));
    if (_b.lengthSq() > 1) s.f.lerp(_b.normalize(), Math.min(1, dt * 4));
    s.f.addScaledVector(s.n, -s.f.dot(s.n)).normalize();
    if (s.c.y < this.world.city.L.water - 6) this.remove(s);
  }

  land(s, hit) {
    s.n.copy(hit.normal);
    s.p.copy(hit.point);
    s.support = hit.collider;
    _a.copy(s.vel).addScaledVector(s.n, -s.vel.dot(s.n));
    if (_a.lengthSq() < 0.01) _a.copy(s.f).addScaledVector(s.n, -s.f.dot(s.n));
    if (_a.lengthSq() < 0.01) _a.set(1, 0, 0).addScaledVector(s.n, -s.n.x);
    s.f.copy(_a.normalize());
    s.vel.set(0, 0, 0);
    const reached = s.goal && s.goal.point && s.p.distanceTo(s.goal.point) < 6;
    s.state = reached ? 'perch' : 'crawl';
    s.timer = reached ? rand(2.5, 5) : 0;
    if (!reached) s.goal = null;
    s.crouch = 0.8;
    if (s.silk) s.silk.end = this.bodyPoint(s, this.locals[s.v.id].spinneret, new V3());
    // Every foot grabs a hold on the new surface at once
    const fr = this.frame(s);
    for (let i = 0; i < 6; i++) {
      const f = s.feet[i], hold = this.foothold(s, this.hipWorld(s, i, fr, _g), this.restPoint(s, i, _h));
      f.from.copy(f.pos);
      if (hold) f.to.copy(hold);
      f.t = 0;
      f.dur = rand(0.08, 0.16);
    }
    this.fx.dust(s.p, 0.6 * s.scale, 6);
    this.fx.sparksBurst(s.p, s.n, 6, 0xffc070, 12);
    this.sound.spiderLand(s.p);
  }

  corpse(s, dt) {
    s.deadT += dt;
    s.vel.y -= GRAVITY * dt;
    const sp = s.vel.length();
    const hit = this.ray(s.c, _a.copy(s.vel).divideScalar(sp || 1), sp * dt + 0.6);
    // Tumble as it falls
    _q.copy(s.spin).multiplyScalar(dt);
    s.fs.applyAxisAngle(_b.copy(_q).normalize(), _q.length()).normalize();
    s.ns.applyAxisAngle(_b, _q.length()).normalize();
    if (hit || s.deadT > 5 || s.c.y < this.world.city.L.water - 4) {
      const p = hit ? hit.point : s.c;
      this.fx.explosion(p, 0.75 * s.scale, { normal: hit ? hit.normal : UP });
      this.sound.explosion(p, 0.7);
      this.world.damageRadius(p, 4, 12);
      if (this.world.destruct) this.world.destruct.blast(p, 1.2, 80, { enemy: true });
      this.remove(s);
      return;
    }
    s.c.addScaledVector(s.vel, dt);
    if (Math.random() < dt * 30) this.fx.smoke.emit(s.c.x, s.c.y, s.c.z, rand(-1, 1), rand(1, 3), rand(-1, 1), 1.5, 1, 4, 0.12, 0.1, 0.1, 0.7, 0.3, 0.3, 0.3, 0, 0.5, 0.3);
    if (Math.random() < dt * 20) this.fx.fire.emit(s.c.x, s.c.y, s.c.z, 0, 2, 0, 0.3, 1.2, 0.3, 3, 0.6, 0.2, 1, 1, 0.1, 0.05, 0);
    this.legs(s, dt);
  }

  // ---- body frame and legs ------------------------------------------------------------------

  /** Logical body frame from the surface normal and heading */
  frame(s) {
    const up = (this._fu || (this._fu = new V3())).copy(s.n);
    const fwd = (this._ff || (this._ff = new V3())).copy(s.f).addScaledVector(up, -s.f.dot(up)).normalize();
    const right = (this._fr || (this._fr = new V3())).crossVectors(up, fwd);
    return { up, fwd, right };
  }

  hipWorld(s, i, fr, out) {
    const L = LEGS[LEG_PAIR[i]], sc = s.scale, sd = LEG_SIDE[i];
    return out.copy(s.p).addScaledVector(fr.up, (BODY_H + L.hip[1]) * sc)
      .addScaledVector(fr.right, sd * L.hip[0] * sc).addScaledVector(fr.fwd, L.hip[2] * sc);
  }

  restPoint(s, i, out) {
    const L = LEGS[LEG_PAIR[i]], sc = s.scale * s.legs, fr = this.frame(s);
    return out.copy(s.p).addScaledVector(fr.right, LEG_SIDE[i] * L.rest[0] * sc).addScaledVector(fr.fwd, L.rest[1] * sc)
      .addScaledVector(s.moveVel, 0.16);
  }

  /** Where a foot reaching for `rest` from `hip` comes down: on the surface, a wall in the way, or around an edge */
  foothold(s, hip, rest) {
    const d = _d.subVectors(rest, hip), L = d.length();
    const hit = this.ray(hip, d.divideScalar(L), L * 1.4);
    if (hit) return hit.point.clone();
    _e.subVectors(s.p, rest).addScaledVector(s.n, -_e.dot(s.n));
    if (_e.lengthSq() < 1e-4) return null;
    const wrap = this.ray(_g.copy(rest).addScaledVector(s.n, -0.9 * s.scale), _e.normalize(), 3.5 * s.scale);
    return wrap ? wrap.point.clone() : null;
  }

  legs(s, dt) {
    const sc = s.scale * s.legs;
    const grounded = s.state === 'crawl' || s.state === 'perch' || s.state === 'emerge' || s.state === 'crouch';
    const fr = this.frame(s);
    if (grounded) {
      const swinging = [false, false];
      for (const i of [0, 1, 2, 3, 4, 5]) if (s.feet[i].t < 1) swinging[LEG_GROUP[i]] = true;
      const speed = s.moveVel.length();
      const thr = (speed > 0.5 ? STEP : 0.55) * sc;
      // Most-strained legs first
      const order = [0, 1, 2, 3, 4, 5].map((i) => [i, s.feet[i].t >= 1 ? s.feet[i].pos.distanceTo(this.restPoint(s, i, _h)) : 0]).sort((a, b) => b[1] - a[1]);
      for (const [i, err] of order) {
        const f = s.feet[i], grp = LEG_GROUP[i];
        if (f.t < 1 || err < thr) continue;
        if (swinging[1 - grp] && err < thr * 2.6) continue;
        const hold = this.foothold(s, this.hipWorld(s, i, fr, _g), this.restPoint(s, i, _h));
        // Only step if the new hold is actually closer to where the foot wants to be
        if (!hold || hold.distanceTo(_h) > err - 0.15 * sc) continue;
        f.from.copy(f.pos);
        f.to.copy(hold);
        f.t = 0;
        f.dur = clamp(0.26 - speed * 0.009, 0.1, 0.24);
        swinging[grp] = true;
      }
    }
    for (let i = 0; i < 6; i++) {
      const f = s.feet[i];
      if (grounded || s.state === 'jump' && f.t < 1) {
        if (f.t < 1) {
          f.t = Math.min(1, f.t + dt / f.dur);
          const k = ease(f.t);
          f.pos.lerpVectors(f.from, f.to, k).addScaledVector(s.n, Math.sin(Math.PI * f.t) * (0.55 + 0.03 * s.speed) * sc);
          if (f.t >= 1) {
            f.pos.copy(f.to);
            if (this.stepSounds < 3 && this.camPos && f.pos.distanceToSquared(this.camPos) < 70 * 70) { this.stepSounds++; this.sound.spiderStep(f.pos); }
          }
        }
        if (!grounded && f.t >= 1) f.t = 1;
        if (grounded) continue;
      }
      // In the air or dead: legs reach out for the landing, or curl up
      const L = LEGS[LEG_PAIR[i]], sd = LEG_SIDE[i];
      const dead = s.state === 'dead';
      const kx = dead ? 0.22 : 0.9, kz = dead ? 0.25 : 0.95, ky = dead ? 0.35 : -0.5;
      _a.copy(s.c).addScaledVector(fr.right, sd * L.rest[0] * kx * sc).addScaledVector(fr.fwd, (L.rest[1] * kz + (dead ? 0 : 0.6)) * sc)
        .addScaledVector(fr.up, ky * sc);
      if (dead) { // curl relative to the tumbling rendered frame
        _b.crossVectors(s.ns, s.fs);
        _a.copy(s.c).addScaledVector(_b, sd * L.rest[0] * kx * sc).addScaledVector(s.fs, L.rest[1] * kz * sc).addScaledVector(s.ns, ky * sc);
      }
      f.pos.lerp(_a, Math.min(1, dt * (dead ? 6 : 10)));
      f.t = 1;
    }
  }

  // ---- weapons ----------------------------------------------------------------------------------

  weapons(s, dt, P) {
    const v = s.v, aggr = 1 + this.wave * 0.07;
    if (s.burst > 0) {
      s.burstT -= dt;
      if (s.burstT <= 0) {
        if (v.weapon === 'fan') this.fireFan(s, P);
        else this.fireBolt(s, P, v.weapon === 'web' ? 'web' : 'plasma');
        s.burst--;
        s.burstT = v.weapon === 'web' ? 0.24 : v.weapon === 'fan' ? 0.3 : 0.16;
      }
    }
    if (!s.see || s.seeT < 0.4) return;
    const d = s.c.distanceTo(P.chest), room = this.bolts.length < 220;
    switch (v.weapon) {
      case 'plasma':
        if (s.cool.plasma <= 0 && d < 175 && room) {
          s.burst = 1 + Math.floor(Math.random() * 3);
          s.burstT = 0.1;
          s.cool.plasma = rand(2.4, 4.4) / aggr;
        }
        if (s.state === 'perch' && !s.laser && s.cool.laser <= 0 && d < 230 && this.lasers.length < 6) {
          this.startLaser(s, P, LASERS.red);
          s.cool.laser = rand(6, 10.5) / aggr;
        }
        break;
      case 'web': // two sticky globs that slow the mech
        if (s.cool.web <= 0 && d < 110 && room) {
          s.burst = 2;
          s.burstT = 0.1;
          s.cool.web = rand(3.5, 5.5) / aggr;
        }
        break;
      case 'lance': // long charge, heavy beam, from a high perch
        if (s.state === 'perch' && !s.laser && s.cool.laser <= 0 && d < 280 && this.lasers.length < 8) {
          this.startLaser(s, P, LASERS.lance);
          s.cool.laser = rand(4.5, 7) / aggr;
        }
        break;
      case 'mortar': // lobbed shells, with a warning ring where they will land
        if (s.cool.mortar <= 0 && d > 20 && d < 200 && room) {
          this.lobShell(s, P);
          s.cool.mortar = rand(3, 4.8) / aggr;
        }
        break;
      case 'fan': // volleys of five bolts in a fan
        if (s.cool.plasma <= 0 && d < 200 && room) {
          s.burst = 3;
          s.burstT = 0.1;
          s.cool.plasma = rand(3, 4.2);
        }
        break;
    }
  }

  fireBolt(s, P, kind = 'plasma', yaw = 0) {
    const B = BOLTS[kind];
    const o = this.bodyPoint(s, MOUTH, new V3());
    const d = o.distanceTo(P.chest), t = d / B.speed;
    const spread = kind === 'fan' ? 0.3 + d * 0.008 : 0.6 + d * 0.022;
    const aim = _a.copy(P.chest).addScaledVector(P.vel, t * 0.75).add(_b.set(rand(-1, 1), rand(-0.6, 0.8), rand(-1, 1)).multiplyScalar(spread));
    const v = aim.sub(o).normalize();
    if (yaw) v.applyAxisAngle(UP, yaw);
    this.bolts.push({ kind, B, pos: o, vel: v.multiplyScalar(B.speed).clone(), life: 5, from: o.clone() });
    this.fx.flash(o, 1.8, B.hit, 0.08);
    if (kind === 'web') this.sound.webShot(o);
    else this.sound.plasmaShot(o);
  }

  fireFan(s, P) {
    for (const yaw of [-0.28, -0.14, 0, 0.14, 0.28]) this.fireBolt(s, P, 'fan', yaw);
  }

  /** Lob a shell at where the mech will be, and mark the spot */
  lobShell(s, P) {
    const B = BOLTS.shell;
    const o = this.bodyPoint(s, this.locals[s.v.id].mortar, new V3());
    const T = clamp(o.distanceTo(P.pos) / 40, 1.3, 2.6);
    const tgt = _a.copy(P.pos).addScaledVector(P.vel, T * 0.6).add(_b.set(rand(-4, 4), 0, rand(-4, 4)));
    const g = this.ray(_c.set(tgt.x, tgt.y + 30, tgt.z), _d.set(0, -1, 0), 60);
    const at = g ? g.point : tgt.clone();
    const vel = new V3().subVectors(at, o).divideScalar(T);
    vel.y += 0.5 * B.gravity * T;
    const ring = this.rings.find((r) => !r.visible) || null;
    if (ring) {
      ring.visible = true;
      ring.position.set(at.x, at.y + 0.15, at.z);
      ring.scale.setScalar(B.splash);
      ring.userData = { t: 0, T };
    }
    this.bolts.push({ kind: 'shell', B, pos: o, vel, life: T + 3, from: o.clone(), ring });
    this.fx.flash(o, 3, B.hit, 0.12);
    for (let i = 0; i < 6; i++) this.fx.smoke.emit(o.x, o.y, o.z, rand(-2, 2), rand(2, 5), rand(-2, 2), 1.2, 1, 4, 0.3, 0.28, 0.25, 0.6, 0.4, 0.4, 0.4, 0, 1, 0.3);
    this.sound.mortarLaunch(o);
  }

  updateBolts(dt, ctx) {
    const P = ctx.player, fx = this.fx;
    let n = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i], B = b.B;
      b.life -= dt;
      if (B.gravity) b.vel.y -= B.gravity * dt;
      const step = b.vel.length() * dt;
      _a.copy(b.vel).normalize();
      const hit = this.ray(b.pos, _a, step);
      const prev = _b.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      // Player: distance from the bolt to the mech's capsule
      const ph = P.alive && capsuleDist(b.pos, P.pos) < 1.9;
      if (b.ring) {
        // The warning ring pulses faster as the shell comes down
        const u = b.ring.userData;
        u.t += dt;
        const k = Math.min(1, u.t / u.T);
        b.ring.material.opacity = (0.35 + 0.65 * Math.abs(Math.sin(u.t * (5 + 20 * k)))) * Math.min(1, u.t * 4);
      }
      if (ph || hit || b.life <= 0) {
        this.impact(b, ph ? b.pos : hit ? hit.point : b.pos, hit ? hit.normal : _c.copy(_a).negate(), ph, P, ph ? null : hit);
        this.bolts.splice(i, 1);
        continue;
      }
      // Glowing trail; shells smoke
      const t = B.trail;
      fx.fire.emit(b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, 0.16, 1.3 * B.size, 0.2, t[0], t[1], t[2], 0.9, 1, 0.1, 0.3, 0);
      fx.fire.emit((b.pos.x + prev.x) / 2, (b.pos.y + prev.y) / 2, (b.pos.z + prev.z) / 2, 0, 0, 0, 0.12, 0.8 * B.size, 0.1, t[0] * 0.8, t[1] * 0.8, t[2] * 0.8, 0.8, 1, 0.1, 0.3, 0);
      if (b.kind === 'shell' && Math.random() < 0.6) fx.smoke.emit(b.pos.x, b.pos.y, b.pos.z, 0, 0.5, 0, 1, 0.8, 3, 0.35, 0.33, 0.3, 0.5, 0.4, 0.4, 0.4, 0, 0.6, 0.2);
      _m.makeScale(B.size, B.size, B.size).setPosition(b.pos);
      this.boltMesh.setMatrixAt(n, _m);
      this.boltMesh.setColorAt(n++, _col.setRGB(B.color[0], B.color[1], B.color[2]));
    }
    this.boltMesh.count = n;
    this.boltMesh.instanceMatrix.needsUpdate = true;
    this.boltMesh.instanceColor.needsUpdate = true;
  }

  impact(b, p, nrm, direct, P, hit) {
    const B = b.B, fx = this.fx, hurt = this.cb.onPlayerHit, D = this.world.destruct;
    if (b.ring) b.ring.visible = false;
    // Spider fire chips the city too, though less than the mech's
    if (D && hit && !B.web) {
      if (b.kind === 'shell') D.blast(_e.copy(p).addScaledVector(nrm, -0.3), 1.8, 140, { enemy: true });
      else D.bullet(hit, { radius: 0.6, power: 38, dir: _e.copy(b.vel).normalize(), enemy: true, chunks: 2, speed: 5 });
    }
    if (b.kind === 'shell') {
      fx.explosion(p, 0.85, { normal: nrm });
      this.sound.explosion(p, 0.8);
      const d = capsuleDist(p, P.pos);
      if (P.alive && d < B.splash && hurt) hurt(4 + B.dmg * (1 - d / B.splash), b.from, 'shell');
      return;
    }
    fx.beamHit(p, nrm, B.hit);
    if (b.kind === 'web') {
      for (let i = 0; i < 8; i++) fx.smoke.emit(p.x, p.y, p.z, rand(-3, 3), rand(-1, 3), rand(-3, 3), rand(0.8, 1.6), 0.8, 3.2, 0.9, 0.95, 1, 0.7, 0.9, 0.95, 1, 0, 2, 0.2);
    }
    if (direct) {
      hurt && hurt(B.dmg, b.from, b.kind);
      if (B.web) this.cb.onWeb && this.cb.onWeb(B.web);
    } else if (P.alive && !B.web && capsuleDist(p, P.pos) < 4.5) hurt && hurt(3, b.from, b.kind);
    if (nrm.y > 0.9 && !B.web) fx.scorch(p.x, p.z, 1.6, p.y + 0.03);
    this.sound.impact(p);
  }

  startLaser(s, P, cfg) {
    const slot = this.laserPool.find((l) => !l.busy);
    if (!slot) return;
    slot.busy = true;
    slot.line.material.uniforms.uColor.value.set(cfg.line);
    slot.beam.material.uniforms.uColor.value.set(cfg.beam);
    slot.glow.material.uniforms.uColor.value.set(cfg.halo);
    const L = { s, slot, cfg, phase: 'charge', t: 0, aim: P.chest.clone().add(_a.set(rand(-6, 6), rand(-2, 4), rand(-6, 6))), dir: new V3(), from: new V3(), end: new V3() };
    s.laser = L;
    this.lasers.push(L);
    this.sound.laserCharge(s.c, cfg.charge);
  }

  endLaser(L) {
    if (L.done) return;
    L.done = true;
    L.slot.busy = false;
    L.slot.line.visible = L.slot.beam.visible = L.slot.glow.visible = false;
    if (L.s) L.s.laser = null;
    const i = this.lasers.indexOf(L);
    if (i >= 0) this.lasers.splice(i, 1);
  }

  updateLasers(dt, ctx) {
    const P = ctx.player;
    for (const L of [...this.lasers]) {
      const s = L.s, cfg = L.cfg;
      if (!s.alive || s.state === 'dead') { this.endLaser(L); continue; }
      L.t += dt;
      this.bodyPoint(s, s.v.lance ? LANCE_TIP : EYE, L.from);
      if (L.phase === 'charge') {
        // The aim drags after the player, then locks just before firing
        if (L.t < cfg.lock) L.aim.lerp(P.chest, 1 - Math.exp(-dt * 3.2));
        L.dir.subVectors(L.aim, L.from).normalize();
        const hit = this.ray(L.from, L.dir, 320);
        L.end.copy(hit ? hit.point : _a.copy(L.from).addScaledVector(L.dir, 320));
        const flick = 0.35 + 0.65 * Math.abs(Math.sin(L.t * 40)) * Math.min(1, L.t * 3);
        this.drawBeam(L.slot.line, L.from, L.end, (0.07 + L.t * 0.05) * cfg.width / 0.45, flick * 0.8, 0);
        s.glow = 1 + L.t * 2;
        if (Math.random() < dt * 40) {
          const c = _col.set(cfg.beam);
          this.fx.fire.emit(L.from.x, L.from.y, L.from.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 0.15, 0.6 * cfg.width / 0.45, 0.1, c.r * 3, c.g * 3, c.b * 3, 1, c.r, c.g, c.b, 0);
        }
        if (L.t >= cfg.charge) {
          L.phase = 'fire';
          L.t = 0;
          L.slot.line.visible = false;
          this.sound.laserFire(L.from);
          this.fx.flash(L.from, 4 * cfg.width / 0.45, cfg.beam, 0.15);
          this.fx.light(L.from, cfg.beam, 50, 0.25, 40);
          // Hit test once, along the locked line
          const onMech = P.alive && segCapsuleHit(L.from, L.end, P.pos, 1.9);
          if (onMech) {
            L.end.copy(onMech);
            this.cb.onPlayerHit && this.cb.onPlayerHit(cfg.dmg, L.from.clone(), 'laser');
          }
          this.fx.beamHit(L.end, _a.copy(L.dir).negate(), cfg.beam);
          if (!onMech && this.world.destruct) this.world.destruct.blast(L.end, 0.6 + cfg.width, 95, { enemy: true });
          if (L.end.y < 0.6) this.fx.scorch(L.end.x, L.end.z, 2.5, L.end.y + 0.03);
        }
      } else {
        const k = Math.max(0, 1 - L.t / cfg.dur);
        this.drawBeam(L.slot.beam, L.from, L.end, cfg.width * (0.6 + 0.4 * k), k, 1.2);
        this.drawBeam(L.slot.glow, L.from, L.end, cfg.glow * (0.6 + 0.4 * k), k * 0.7, 0);
        if (Math.random() < dt * 60) this.fx.sparksBurst(L.end, _a.copy(L.dir).negate(), 2, cfg.beam, 20);
        if (L.t >= cfg.dur) this.endLaser(L);
      }
    }
  }

  drawBeam(mesh, a, b, width, alpha, core) {
    const len = a.distanceTo(b);
    mesh.visible = alpha > 0.01 && len > 0.1;
    if (!mesh.visible) return;
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP, _e.subVectors(b, a).divideScalar(len));
    mesh.scale.set(1, len, 1);
    const u = mesh.material.uniforms;
    u.uWidth.value = width; u.uAlpha.value = alpha; u.uCore.value = core; u.uTime.value = this.time;
  }

  updateSilk(dt) {
    const pos = this.silk.geometry.attributes.position, col = this.silk.geometry.attributes.color;
    for (const s of this.list) {
      const k = s.slot * 2;
      if (!s.silk) { col.setXYZ(k, 0, 0, 0); col.setXYZ(k + 1, 0, 0, 0); continue; }
      const end = s.silk.end || this.bodyPoint(s, this.locals[s.v.id].spinneret, _a);
      if (s.silk.end) s.silk.life -= dt * 0.6;
      if (s.silk.life <= 0) { s.silk = null; col.setXYZ(k, 0, 0, 0); col.setXYZ(k + 1, 0, 0, 0); continue; }
      const c = 0.55 * s.silk.life;
      pos.setXYZ(k, s.silk.a.x, s.silk.a.y, s.silk.a.z);
      pos.setXYZ(k + 1, end.x, end.y, end.z);
      col.setXYZ(k, c, c, c * 1.05); col.setXYZ(k + 1, c, c, c * 1.05);
    }
    pos.needsUpdate = col.needsUpdate = true;
  }

  // ---- rendering --------------------------------------------------------------------------------

  /** World position of a body-local point on the rendered body */
  bodyPoint(s, local, out) {
    if (!s.bodyM) return out.copy(s.c);
    return out.copy(local).applyMatrix4(s.bodyM);
  }

  render(s, dt) {
    const sc = s.scale, slot = s.slot;
    // Ease the rendered frame into the logical one (instant while airborne or dead)
    if (s.state !== 'dead') {
      const k = s.state === 'jump' || s.state === 'fall' ? 1 : 1 - Math.exp(-dt * 11);
      s.ns.lerp(s.n, k).normalize();
      s.fs.lerp(s.f, k);
      if (s.state !== 'jump' && s.state !== 'fall') s.c.lerp(_a.copy(s.p).addScaledVector(s.n, BODY_H * sc), 1 - Math.exp(-dt * 14));
    }
    const up = _u.copy(s.ns);
    const fwd = _a.copy(s.fs).addScaledVector(up, -s.fs.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
    fwd.normalize();
    // Rear up (or flinch), pivoting near the back of the body; crouch lowers it
    const a = s.pitch, ca = Math.cos(a), sa = Math.sin(a);
    const f2 = _b.copy(fwd).multiplyScalar(ca).addScaledVector(up, sa);
    const u2 = _c.copy(up).multiplyScalar(ca).addScaledVector(fwd, -sa);
    const right = _d.crossVectors(u2, f2);
    const swing = s.feet.reduce((n, f) => n + (f.t < 1 ? 1 : 0), 0);
    const center = _e.copy(s.c).addScaledVector(fwd, -0.8 * sc).addScaledVector(f2, 0.8 * sc)
      .addScaledVector(up, (-0.45 * s.crouch + 0.04 * swing) * sc);
    const bodyM = (s.bodyM || (s.bodyM = new THREE.Matrix4()));
    bodyM.makeBasis(_g.copy(right).multiplyScalar(sc), _h.copy(u2).multiplyScalar(sc), _q.copy(f2).multiplyScalar(sc)).setPosition(center);
    // Hit sphere and lock point in the middle of the body, between head and abdomen
    s.pos.copy(BODY_MID).applyMatrix4(bodyM);

    const P = this.parts, Lc = this.locals[s.v.id];
    const put = (mesh, k, m) => mesh.setMatrixAt(slot * mesh.per + k, m);
    put(P.cepha, 0, _m.multiplyMatrices(bodyM, Lc.cepha));
    const breathe = 1 + 0.035 * Math.sin(s.t * 3.2 + slot);
    _m2.copy(Lc.abdomen).scale(_g.set(breathe, breathe, 1));
    put(P.abdomen, 0, _m.multiplyMatrices(bodyM, _m2));
    put(P.thorax, 0, _m.multiplyMatrices(bodyM, Lc.thorax));
    put(P.face, 0, _m.multiplyMatrices(bodyM, Lc.face));
    put(P.brow, 0, _m.multiplyMatrices(bodyM, Lc.brow));
    put(P.spine, 0, _m.multiplyMatrices(bodyM, Lc.spine));
    put(P.lance, 0, s.v.lance ? _m.multiplyMatrices(bodyM, Lc.lance) : NONE);
    for (const [mesh, sd] of [[P.fangL, -1], [P.fangR, 1]]) {
      const o = 0.12 + s.fang * 0.55;
      plateMatrix(_m2, _g.set(sd * 0.24, 0.0, 1.5), _h.set(sd * o, -0.85, 0.5), _q.set(0, 0, 1), 0.95, 1, 0.12);
      put(mesh, 0, _m.multiplyMatrices(bodyM, _m2));
    }

    // Legs: two-bone IK from each hip to its foot, knees thrown high and outward
    const a1 = FEMUR * sc * s.legs, b1 = TIBIA * sc * s.legs;
    for (let i = 0; i < 6; i++) {
      const L = LEGS[LEG_PAIR[i]], sd = LEG_SIDE[i];
      const hip = _g.set(sd * L.hip[0], L.hip[1], L.hip[2]).applyMatrix4(bodyM);
      const foot = s.feet[i].pos;
      const D = _h.subVectors(foot, hip);
      let d = D.length();
      const dir = D.divideScalar(d || 1);
      d = clamp(d, Math.abs(a1 - b1) + 0.05, a1 + b1 - 0.02);
      const cosA = clamp((a1 * a1 + d * d - b1 * b1) / (2 * a1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
      const out = _q.subVectors(hip, center).addScaledVector(u2, -_q.dot(u2)).normalize();
      const pole = _r.copy(u2).addScaledVector(out, 0.45);
      pole.addScaledVector(dir, -pole.dot(dir));
      if (pole.lengthSq() < 1e-6) pole.copy(out);
      pole.normalize();
      const knee = this._knee || (this._knee = new V3());
      knee.copy(hip).addScaledVector(dir, a1 * cosA).addScaledVector(pole, a1 * sinA);
      const tip = this._tip || (this._tip = new V3());
      tip.copy(hip).addScaledVector(dir, d);
      const pl = this._pole || (this._pole = new V3());
      pl.copy(pole);
      const axis = this._axis || (this._axis = new V3());
      axis.crossVectors(dir, pl).normalize();
      plateMatrix(_m, hip, _n.subVectors(knee, hip), pl, a1, 0.78, 0.26 * sc);
      put(P.femur, i, _m);
      plateMatrix(_m, hip, _n.subVectors(knee, hip), axis, a1, 0.55, 0.22 * sc);
      put(P.femurX, i, _m);
      plateMatrix(_m, knee, _n.subVectors(tip, knee), pl, b1, 0.62, 0.22 * sc);
      put(P.tibia, i, _m);
      plateMatrix(_m, knee, _n.subVectors(tip, knee), axis, b1, 0.44, 0.18 * sc);
      put(P.tibiaX, i, _m);
      // Joint discs at hip and knee, turned to the leg's plane
      for (const [k, at, r] of [[i * 2, hip, 0.34], [i * 2 + 1, knee, 0.3]]) {
        const z = _n.crossVectors(pl, axis);
        _m.makeBasis(_a.copy(pl).multiplyScalar(r * sc), _b.copy(axis).multiplyScalar(0.26 * sc), z.multiplyScalar(r * sc)).setPosition(at);
        put(P.joint, k, _m);
      }
    }

    // Hit flash: brighten every part of this spider
    const fk = 1 + s.flash * 4;
    if (fk !== s.lastFlash) {
      s.lastFlash = fk;
      const col = this._col || (this._col = new THREE.Color());
      col.setRGB(fk, fk * (1 - s.flash * 0.3), fk * (1 - s.flash * 0.3));
      for (const key in P) for (let k = 0; k < P[key].per; k++) P[key].setColorAt(slot * P[key].per + k, col);
    }

    // Eyes
    const dead = s.state === 'dead';
    const glow = dead ? Math.max(0, 1 - s.deadT * 2) : Math.min(2.2, s.glow * (0.85 + 0.15 * Math.sin(s.t * 7 + slot)));
    for (const [pts, list] of [[this.eyesBig, EYES_BIG], [this.eyesSmall, EYES_SMALL]]) {
      const pa = pts.geometry.attributes.position, ca2 = pts.geometry.attributes.color;
      list.forEach((e, k) => {
        _a.set(e[0], e[1], e[2]).applyMatrix4(bodyM);
        pa.setXYZ(slot * pts.per + k, _a.x, _a.y, _a.z);
        ca2.setXYZ(slot * pts.per + k, glow * 1.4, glow * 0.1, glow * 0.07);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The player mech as a capsule from its hips to its head
// ---------------------------------------------------------------------------

function capsuleDist(p, base) {
  const y = clamp(p.y, base.y + 1.5, base.y + 6.8);
  return Math.hypot(p.x - base.x, p.y - y, p.z - base.z);
}

/** First point along a-b inside the capsule, or null */
function segCapsuleHit(a, b, base, r) {
  // Sample the segment; the beam is long and the capsule is fat, so this is plenty
  const n = Math.ceil(a.distanceTo(b) / 0.8);
  for (let i = 0; i <= n; i++) {
    _a.lerpVectors(a, b, i / n);
    if (capsuleDist(_a, base) < r) return _a.clone();
  }
  return null;
}
