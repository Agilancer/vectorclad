import * as THREE from './three.js';
import {
  plateGeo, jointGeo, plateMatrix, paletteMaterial, paletteMesh, paintInstances, solveLeg, beamMesh, drawBeam, capsuleDist, segCapsuleHit,
} from './frameParts.js';
import { canvasTexture } from './atlas.js';

// ---------------------------------------------------------------------------
// The millipede: a black war machine hundreds of meters long that crawls in
// over the rooftops and lies draped across several city blocks.
//
// Its body is a chain of rigid sections. Each one carries three layers of armor
// plates (black, then steel, then bronze) over a reactor core with a rainbow gem
// at its heart. Plates break off one at a time under fire, the way the city's
// walls do, but nothing else wears them down: not the roofs it lies on, not its
// own coils. Once a hole goes through all three layers the core is open to fire.
//
// While any core still burns, the head is too heavily armored to hurt. With the
// last core gone it fires the thrusters in its neck, tears free, flies off, turns
// and hunts the mech with twin red beams from its eyes. Killed, it rams its way
// through twenty or thirty buildings, climbs, spins up and blows apart.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Layout, in world units. Sections run tail to head along the route it lies on.
const SEGS = 10;              // armored sections, each with a reactor core
const SEG_LEN = 17;
const HALF = SEG_LEN / 2;
const GAP = 2.4;              // flexible joint between sections
const TIP_LEN = 10;           // unarmored tail tip
const NECK = 9;
const SPAN = SEG_LEN + GAP;
const SEG0 = TIP_LEN + GAP;   // where the first section starts, from the tail end
const HEAD_S = SEG0 + SEGS * SPAN - GAP + NECK; // tail end to the head
const ARRIVE = 170;           // how far it crawls in along its route
const CRAWL = 13;             // its speed doing so

// Armor: ROWS plates round the top and sides (ARC radians each way from the top), COLS along each section
const ROWS = 7, COLS = 6, ARC = 1.95;
const DTH = (2 * ARC) / ROWS, DZ = SEG_LEN / COLS;
const PER_SEG = ROWS * COLS;
const LAYERS = [
  { r: 5.7, thick: 0.8, hp: 40 },    // black outer shell
  { r: 4.85, thick: 0.72, hp: 50 },  // steel
  { r: 4.05, thick: 0.66, hp: 60 },  // bronze
];
const R_OUT = LAYERS[0].r;
const R_BELLY = 4.7;          // the keel along its underside (it never comes off)
const R_CORE = 2.3, CORE_HALF = 3.1, CORE_HP = 70;
const HEAD_HP = 1900;         // about fifteen direct bazooka hits
const LIFT = 4.4;             // the body's axis above what it lies on
const SLOPE = 0.65;           // steepest it drapes from one roof down to the next
const FEMUR = 7, TIBIA = 8.6;
const FRAGS = 48;             // flying armor plates per layer

// Eye beams
const EYE = { charge: 0.9, fire: 3.2, cool: [2.4, 4], dps: 16, track: 15 };

const PALETTE = { tint: [0.3, 0.3, 0.34], lift: 0, accent: [0.95, 0.05, 0.04], glow: [1.3, 0.1, 0.06] };
const FIREWORKS = [0xff3040, 0x40ff70, 0x4080ff, 0xffd040, 0xff40e0, 0x40f0ff, 0xffffff, 0xff8020];

const UP = new V3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _g = new V3(), _n = new V3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _s = new V3();
const _f1 = new V3(), _f2 = new V3(), _f3 = new V3();
const _eu = new THREE.Euler();
const _col = new THREE.Color();

// ---------------------------------------------------------------------------
// Textures and geometry
// ---------------------------------------------------------------------------

/** Plate detail (light, tinted by each layer's color) and the lit seam that runs round each plate */
function panelTextures() {
  const map = canvasTexture(256, (g, s) => {
    g.fillStyle = '#cfcfcf';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${rand(0.03, 0.08)})`;
      g.fillRect(0, Math.random() * s, s, rand(1, 3));
    }
    const b = 14;
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, s, b * 0.5);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, s - b * 0.6, s, b * 0.6);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, b * 0.5, s); g.fillRect(s - b * 0.5, 0, b * 0.5, s);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3; g.strokeRect(b * 1.6, b * 1.6, s - b * 3.2, s - b * 3.2);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; g.strokeRect(b * 1.6 + 2, b * 1.6 + 2, s - b * 3.2, s - b * 3.2);
    for (const [x, y] of [[b, b], [s - b, b], [b, s - b], [s - b, s - b], [s / 2, b], [s / 2, s - b]]) {
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(x + 1, y + 1, 4.5, 0, 6.28); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(x, y, 3.5, 0, 6.28); g.fill();
    }
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(255,255,255,${rand(0.08, 0.2)})`; g.lineWidth = 1;
      const x = rand(0, s), y = rand(0, s);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-30, 30), y + rand(-8, 8)); g.stroke();
    }
  });
  const glow = canvasTexture(256, (g, s) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, s, s);
    const gr = g.createLinearGradient(0, s * 0.5 - 9, 0, s * 0.5 + 9);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(s * 0.3, s * 0.5 - 7, s * 0.4, 14);
    for (const x of [s * 0.11, s * 0.89]) for (let k = -2; k <= 2; k++) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - 9, s * 0.5 + k * 9 - 2, 18, 4); }
  });
  return { map, glow };
}

/**
 * Armor: lit seams, and instance colors that darken a plate as it's damaged (and put out
 * its seams with its section) or, above white, make it flash
 */
function armorMaterial(map, glow, color, metalness, roughness, emissive) {
  const m = new THREE.MeshStandardMaterial({ map, color, metalness, roughness, emissiveMap: glow, emissive });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        totalEmissiveRadiance *= clamp(vColor.g * 2.0 - 0.6, 0.0, 1.0);
        totalEmissiveRadiance += max(vColor.rgb - 1.0, 0.0) * 0.6;
      #endif`);
  };
  m.customProgramCacheKey = () => 'millipede-armor';
  return m;
}

/** A curved armor plate on top of the z axis: outer face at radius r, dth radians wide, len long, crowned by bulge */
function tileGeo(r, thick, dth, len, bulge) {
  const pos = [], nrm = [], uv = [], idx = [];
  const ri = r - thick, nT = 5, nZ = 2;
  const R = (u, v, out) => (out ? r + bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) : ri);
  const P = (u, v, out) => {
    const th = (u - 0.5) * dth, rr = R(u, v, out);
    return [rr * Math.sin(th), rr * Math.cos(th), (v - 0.5) * len];
  };
  const face = (out) => {
    const base = pos.length / 3;
    for (let j = 0; j <= nZ; j++) {
      for (let i = 0; i <= nT; i++) {
        const u = i / nT, v = j / nZ, th = (u - 0.5) * dth, s = out ? 1 : -1;
        pos.push(...P(u, v, out));
        nrm.push(Math.sin(th) * s, Math.cos(th) * s, 0);
        uv.push(u, v);
      }
    }
    for (let j = 0; j < nZ; j++) {
      for (let i = 0; i < nT; i++) {
        const a = base + j * (nT + 1) + i, b = a + 1, c = a + nT + 1, d = c + 1;
        if (out) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
    }
  };
  face(true);
  face(false);
  // Edges: flat quads, wound to face away from the plate's middle
  const mid = new V3(0, r - thick / 2, 0);
  const quad = (p0, p1, p2, p3) => {
    const A = new V3(...p0), B = new V3(...p1), D = new V3(...p3);
    const n = new V3().subVectors(B, A).cross(new V3().subVectors(D, A)).normalize();
    const ctr = new V3(...p0).add(new V3(...p1)).add(new V3(...p2)).add(D).multiplyScalar(0.25).sub(mid);
    const pts = n.dot(ctr) < 0 ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
    if (n.dot(ctr) < 0) n.negate();
    const base = pos.length / 3;
    for (const p of pts) { pos.push(...p); nrm.push(n.x, n.y, n.z); uv.push(0.02, 0.02); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const u of [0, 1]) for (let j = 0; j < nZ; j++) quad(P(u, j / nZ, true), P(u, (j + 1) / nZ, true), P(u, (j + 1) / nZ, false), P(u, j / nZ, false));
  for (const v of [0, 1]) for (let i = 0; i < nT; i++) quad(P(i / nT, v, true), P((i + 1) / nT, v, true), P((i + 1) / nT, v, false), P(i / nT, v, false));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Join geometries (already placed) into one */
function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/** What shows once the armor is gone: ribs, a spine, side rails and the cage round the core */
function frameGeo() {
  const g = [];
  for (const z of [-HALF + 0.8, -HALF * 0.55, HALF * 0.55, HALF - 0.8]) g.push(new THREE.TorusGeometry(3.15, 0.3, 8, 28).translate(0, 0, z));
  g.push(new THREE.BoxGeometry(0.9, 0.6, SEG_LEN - 0.8).translate(0, 2.95, 0));
  for (const sd of [-1, 1]) g.push(new THREE.BoxGeometry(0.5, 0.7, SEG_LEN - 0.8).translate(sd * 2.95, -0.2, 0));
  for (const z of [-CORE_HALF, CORE_HALF]) g.push(new THREE.CylinderGeometry(2.7, 2.7, 0.55, 22).rotateX(Math.PI / 2).translate(0, 0, z));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.push(new THREE.BoxGeometry(0.28, 0.28, CORE_HALF * 2).translate(Math.sin(a) * 2.5, Math.cos(a) * 2.5, 0));
  }
  return merge(g);
}

/** The keel under the armor, from one side's lowest plate round to the other's */
function bellyGeo() {
  const g = new THREE.CylinderGeometry(R_BELLY, R_BELLY, SEG_LEN * 0.985, 22, 1, true, -(Math.PI - ARC) - 0.06, 2 * (Math.PI - ARC) + 0.12);
  g.rotateX(Math.PI / 2);
  const ridge = new THREE.BoxGeometry(1.1, 0.8, SEG_LEN * 0.9).translate(0, -R_BELLY - 0.2, 0);
  return merge([g, ridge]);
}

/** Ribbed sleeve over each joint, one unit long on y */
function collarGeo() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 18, 12, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = 3.5 + 0.3 * Math.cos(y * Math.PI * 8);
    p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Tapered tail end with two spurs, pointing down -z */
function tipGeo() {
  const prof = [[0.15, -5], [1.1, -4.2], [2.5, -2.4], [3.7, 0], [4.5, 2.8], [4.7, 5]].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(prof, 22).rotateX(Math.PI / 2);
  const parts = [body];
  for (const sd of [-1, 1]) {
    parts.push(new THREE.ConeGeometry(0.55, 6, 8).translate(0, 3, 0).rotateX(-Math.PI / 2 - 0.25).rotateY(sd * 0.45).translate(sd * 1.4, 0.9, -3.5));
  }
  return merge(parts);
}

const GEM_VERT = /* glsl */`
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const GEM_FRAG = /* glsl */`
uniform float uTime; uniform float uK;
varying vec3 vN; varying vec3 vV;
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  vec3 n = normalize(vN);
  float f = pow(1.0 - abs(dot(n, vV)), 2.0);
  float h = fract(atan(n.z, n.x) / 6.2832 + n.y * 0.35 + uTime * 0.22);
  vec3 c = hue(h) * 2.2 + vec3(1.0) * (f * 1.6 + 0.25);
  gl_FragColor = vec4(c * uK, 1.0);
}`;

// ---------------------------------------------------------------------------
// The millipede
// ---------------------------------------------------------------------------

export class Millipede {
  constructor(swarm, { scene, tex, glowTex }) {
    this.sw = swarm;
    this.scene = scene;
    this.world = swarm.world;
    this.fx = swarm.fx;
    this.sound = swarm.sound;
    this.glowTex = glowTex;
    this.active = false;
    this.time = 0;
    this.frags = [];
    this.events = [];
    this.barObj = { name: 'MILLIPEDE', hp: 1, maxHp: 1, bossLabel: '' };
    this.build(tex);
  }

  // ---- construction ----------------------------------------------------------------

  inst(geo, mat, n, shadow = true) {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, WHITE); }
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  build(tex) {
    const { map, glow } = panelTextures();
    this.layerMats = [
      armorMaterial(map, glow, 0x1a1b20, 0.7, 0.36, new THREE.Color(1.1, 0.04, 0.03)),
      armorMaterial(map, glow, 0x7d828a, 0.85, 0.42, new THREE.Color(1.8, 0.7, 0.1)),
      armorMaterial(map, glow, 0xb9843f, 0.9, 0.3, new THREE.Color(0.25, 1.1, 1.7)),
    ];
    this.tileGeos = LAYERS.map((L) => tileGeo(L.r, L.thick, DTH * 0.95, DZ * 0.93, L.thick * 0.4));
    this.tiles = LAYERS.map((L, k) => this.inst(this.tileGeos[k], this.layerMats[k], SEGS * PER_SEG, k === 0));
    this.fragMesh = LAYERS.map((L, k) => this.inst(this.tileGeos[k], this.layerMats[k], FRAGS));
    this.fragOff = LAYERS.map((L) => new THREE.Matrix4().makeTranslation(0, -(L.r - L.thick / 2), 0));
    for (const m of this.fragMesh) for (let i = 0; i < FRAGS; i++) m.setColorAt(i, _col.setRGB(0.75, 0.75, 0.75));
    // Where each plate sits on its section: turned round the axis, then along it
    this.cellM = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        this.cellM.push(new THREE.Matrix4().makeRotationZ(-(-ARC + (row + 0.5) * DTH)).setPosition(0, 0, -HALF + (col + 0.5) * DZ));
      }
    }

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.85, roughness: 0.45, map });
    this.frame = this.inst(frameGeo(), frameMat, SEGS, false);
    const bellyMat = armorMaterial(map, glow, 0x141519, 0.7, 0.5, new THREE.Color(1.1, 0.05, 0.03));
    bellyMat.side = THREE.DoubleSide;
    this.belly = this.inst(bellyGeo(), bellyMat, SEGS);
    this.collars = this.inst(collarGeo(), new THREE.MeshStandardMaterial({ color: 0x121317, metalness: 0.5, roughness: 0.6 }), SEGS + 4);
    this.tipMesh = new THREE.Mesh(tipGeo(), this.layerMats[0]);
    this.tipMesh.castShadow = true;
    this.tipMesh.matrixAutoUpdate = false;
    this.tipMesh.visible = false;
    this.scene.add(this.tipMesh);

    // Reactor gems and their halos
    this.gemMat = new THREE.ShaderMaterial({ vertexShader: GEM_VERT, fragmentShader: GEM_FRAG, uniforms: { uTime: { value: 0 }, uK: { value: 1 } }, toneMapped: false });
    const gemGeo = new THREE.IcosahedronGeometry(1.9, 0).scale(1, 1, 1.4);
    this.segs = [];
    for (let i = 0; i < SEGS; i++) {
      const gem = new THREE.Mesh(gemGeo, this.gemMat);
      gem.visible = false;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      halo.visible = false;
      halo.renderOrder = 5;
      this.scene.add(gem, halo);
      const seg = {
        i, s: SEG0 + i * SPAN, gem, halo,
        a: new V3(), b: new V3(), c: new V3(), fwd: new V3(), right: new V3(), up: new V3(), M: new THREE.Matrix4(),
        hp: new Float32Array(3 * PER_SEG), flash: new Float32Array(3 * PER_SEG), flashing: false,
        core: CORE_HP, coreFlash: 0, dead: false, gone: false, open: false,
      };
      seg.t = {
        kind: 'millipede', name: 'MILLIPEDE', alive: true, stealth: false, pos: seg.c, vel: new V3(), radius: 6, seg,
        ray: (o, d, max) => this.segRay(seg, o, d, max),
        hit: (amount, point) => this.segHit(seg, amount, point),
        blast: (point, radius, amount) => this.segBlast(seg, point, radius, amount),
      };
      this.segs.push(seg);
    }
    this.tip = { a: new V3(), b: new V3(), c: new V3(), fwd: new V3(), right: new V3(), up: new V3(), M: new THREE.Matrix4(), gone: false };

    // Legs: two pairs on every section and one on the tail tip, in the spiders' plates painted black
    const pmat = paletteMaterial(tex.spider, tex.spiderGlow);
    this.legs = [];
    for (let i = 0; i < SEGS; i++) {
      for (const z of [-SEG_LEN * 0.28, SEG_LEN * 0.28]) for (const side of [-1, 1]) this.legs.push(this.makeLeg(this.segs[i], side, z));
    }
    for (const side of [-1, 1]) this.legs.push(this.makeLeg(this.tip, side, 1.5));
    const NL = this.legs.length;
    this.legParts = {
      femur: paletteMesh(this.scene, plateGeo('femur'), pmat, NL),
      femurX: paletteMesh(this.scene, plateGeo('femur'), pmat, NL),
      tibia: paletteMesh(this.scene, plateGeo('tibia'), pmat, NL),
      tibiaX: paletteMesh(this.scene, plateGeo('tibia'), pmat, NL),
      joint: paletteMesh(this.scene, jointGeo(), pmat, NL * 2),
    };
    for (const key in this.legParts) {
      const m = this.legParts[key];
      paintInstances(m, 0, m.count, PALETTE, PALETTE.tint);
      m.visible = false;
    }

    this.head = this.buildHead(map, glow);
    // Eye beams: a white-hot core in a red glow, and thin aiming lines while they charge
    this.eyeBeams = [0, 1].map(() => {
      const core = beamMesh(0xff2a18), glowB = beamMesh(0xff1008), line = beamMesh(0xff2020);
      this.scene.add(core, glowB, line);
      return { core, glow: glowB, line, end: new V3(), from: new V3() };
    });
  }

  makeLeg(F, side, z) {
    return { F, side, z, hip: new V3(), foot: new V3(), from: new V3(), to: new V3(), t: 1, dur: 0.35, dangle: false, phase: Math.random() * 6 };
  }

  buildHead(map, glow) {
    const g = new THREE.Group();
    const skinTex = map.clone();
    skinTex.wrapS = skinTex.wrapT = THREE.RepeatWrapping;
    skinTex.repeat.set(5, 3);
    skinTex.needsUpdate = true;
    const skin = new THREE.MeshStandardMaterial({ color: 0x17181c, metalness: 0.8, roughness: 0.32, map: skinTex });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0e0f12, metalness: 0.6, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c2e34, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide });
    const add = (geo, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    // Cranium, jaw and a crest of the body's own black plates
    add(new THREE.SphereGeometry(1, 28, 18).scale(4.9, 3.3, 6.2), skin, 0, 0.3, 0.4);
    add(new THREE.SphereGeometry(1, 20, 12).scale(4.1, 1.7, 4.6), dark, 0, -1.9, 2.4);
    const top = (z) => 0.3 + 3.3 * Math.sqrt(Math.max(0, 1 - ((z - 0.4) / 6.2) ** 2));
    for (const z of [3.4, 1.0, -1.4, -3.8]) {
      for (const th of [-0.56, 0, 0.56]) {
        const m = add(this.tileGeos[0], this.layerMats[0], 0, top(z) + 0.45 - R_OUT * 0.8, z);
        m.rotation.z = -th;
        m.scale.setScalar(0.8);
      }
    }
    for (const sd of [-1, 1]) {
      const brow = add(new THREE.BoxGeometry(3.2, 0.7, 1.6), skin, sd * 2.4, 2.25, 4.3);
      brow.rotation.set(-0.35, 0, sd * 0.3);
    }
    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.12, 0.08), toneMapped: false });
    const eyeLocal = [new V3(-2.6, 1.0, 4.95), new V3(2.6, 1.0, 4.95)];
    const glows = eyeLocal.map((p) => {
      const eye = add(new THREE.SphereGeometry(1, 16, 12).scale(1.5, 0.6, 0.8), eyeMat, p.x, p.y, p.z);
      eye.rotation.set(0, Math.sign(p.x) * 0.45, -Math.sign(p.x) * 0.3);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff2010, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      s.position.copy(p).add(new V3(0, 0, 0.6));
      s.scale.setScalar(4);
      s.renderOrder = 5;
      g.add(s);
      return s;
    });
    // Mandibles: a hooked fang on each side of the mouth, on a pivot
    const mands = [-1, 1].map((sd) => {
      const pivot = new THREE.Group();
      pivot.position.set(sd * 2.5, -2.2, 4.9);
      g.add(pivot);
      const fang = add(new THREE.ConeGeometry(0.9, 6.5, 10).translate(0, 3.25, 0).rotateX(Math.PI / 2), steel, 0, 0, 0, pivot);
      fang.rotation.y = -sd * 0.25;
      const hook = add(new THREE.ConeGeometry(0.6, 3.6, 8).translate(0, 1.8, 0).rotateX(Math.PI / 2), steel, 0, 0, 6.1, fang);
      hook.rotation.y = -sd * 0.95;
      pivot.userData.sd = sd;
      return pivot;
    });
    // Antennae: jointed whips
    const antMat = new THREE.MeshStandardMaterial({ color: 0x1b1c21, metalness: 0.7, roughness: 0.4 });
    const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.15, 0.1), toneMapped: false });
    const ants = [-1, 1].map((sd) => {
      const links = [];
      let parent = g;
      for (let i = 0; i < 6; i++) {
        const piv = new THREE.Group();
        if (i === 0) piv.position.set(sd * 1.8, 2.7, 4.4); else piv.position.set(0, 2.4, 0);
        parent.add(piv);
        add(new THREE.CylinderGeometry(0.18 - i * 0.02, 0.3 - i * 0.025, 2.5, 6).translate(0, 1.25, 0), antMat, 0, 0, 0, piv);
        piv.userData.sd = sd;
        links.push(piv);
        parent = piv;
      }
      add(new THREE.SphereGeometry(0.28, 8, 6), tipMat, 0, 2.5, 0, parent);
      return links;
    });
    // Neck stub with four thrusters round it
    add(new THREE.CylinderGeometry(2.9, 3.3, 6, 16).rotateX(Math.PI / 2), dark, 0, -0.3, -6.5);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.25), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 3.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const nozzles = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const n = new THREE.Group();
      n.position.set(Math.cos(a) * 3.3, -0.3 + Math.sin(a) * 3.3, -8.4);
      g.add(n);
      add(new THREE.CylinderGeometry(0.8, 1.2, 2.2, 12, 1, true).rotateX(Math.PI / 2), steel, 0, 0, 0, n);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(1.05, 7, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -4.6), flameMat);
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.55, 4, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -3.1), coreMat);
      flame.visible = core.visible = false;
      n.add(flame, core);
      nozzles.push({ n, flame, core, exit: new V3(Math.cos(a) * 3.3, -0.3 + Math.sin(a) * 3.3, -9.6) });
    }
    g.visible = false;
    this.scene.add(g);
    const kin = this;
    const H = {
      group: g, pos: g.position, q: g.quaternion, vel: new V3(), fwd: new V3(0, 0, 1),
      eyeLocal, glows, mands, ants, nozzles, state: 'off', hp: HEAD_HP, flash: 0, throttle: 0, bite: 0, cool: { fan: 3, bite: 0, roar: 6 },
      laser: { phase: 'idle', t: 0, cool: 3, aim: new V3(), acc: 0, tick: 0 },
      goal: new V3(), moveT: 0, burst: 0, burstT: 0,
    };
    H.t = {
      kind: 'millipede', name: 'MILLIPEDE', alive: true, stealth: true, pos: new V3(), vel: H.vel, radius: 6, head: true,
      ray(o, d, max, pad = 0) {
        const r = 5.6 + pad, p = this.pos;
        const ox = o.x - p.x, oy = o.y - p.y, oz = o.z - p.z;
        const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
        if (disc < 0) return null;
        let t = -b - Math.sqrt(disc);
        if (t < 0) t = c < 0 ? 0 : -1;
        if (t < 0 || t > max) return null;
        return { t, normal: new V3(ox + d.x * t, oy + d.y * t, oz + d.z * t).normalize() };
      },
      hit: (amount, point) => kin.headHit(amount, point),
      blast(point, radius, amount) {
        const gap = point.distanceTo(this.pos) - 5.6;
        if (gap < radius) kin.headHit(amount * (1 - Math.max(0, gap) / radius), null);
      },
    };
    return H;
  }

  // ---- state for the HUD ---------------------------------------------------------------

  /** The boss bar: cores left, then the head's armor */
  get bar() {
    if (!this.active) return null;
    const B = this.barObj, H = this.head;
    if (H.state === 'arrive' || H.state === 'perched') {
      B.hp = this.cores; B.maxHp = SEGS;
      B.bossLabel = `MILLIPEDE · REACTOR CORES ${this.cores}/${SEGS}`;
    } else {
      B.hp = Math.max(0, H.hp); B.maxHp = HEAD_HP;
      B.bossLabel = H.hp > 0 ? 'MILLIPEDE · HEAD' : 'MILLIPEDE · HEAD CRITICAL';
    }
    return B;
  }

  alert(text, dur = 2.4) { this.sw.cb.onAlert && this.sw.cb.onAlert(text, dur); }

  // ---- route ---------------------------------------------------------------------------------

  /** Top of the tallest building within r of (x, z), or 0 for the street */
  topAt(x, z, r) {
    let h = 0;
    this.world.query(x - r, z - r, x + r, z + r, (c) => { if (c.building && c.max.y > h) h = c.max.y; });
    return h;
  }

  /**
   * A route across the rooftops ending near the mech: the last HEAD_S units are where it
   * comes to rest, the ARRIVE units before them the way it crawls in. Of many tries, the
   * one that lies most on roofs, low, smooth and clear of the mech, starting out of sight.
   */
  planRoute(P, cam) {
    const B = this.world.bounds, ds = 2, total = ARRIVE + HEAD_S, n = Math.ceil(total / ds) + 1;
    const i0 = Math.floor(ARRIVE / ds), iBody = Math.ceil(HEAD_S / ds), k = SLOPE * ds;
    let best = null;
    for (let tries = 0; tries < 70; tries++) {
      const a = Math.random() * Math.PI * 2, dist = rand(50, 95);
      let x = P.pos.x + Math.cos(a) * dist, z = P.pos.z + Math.sin(a) * dist;
      let hd = a + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 + rand(-0.6, 0.6);
      const kappa = rand(-1, 1) / 450;
      const xs = new Float32Array(n), zs = new Float32Array(n), g = new Float32Array(n), h = new Float32Array(n);
      let ok = true;
      for (let i = n - 1; i >= 0; i--) {
        if (x < B.minX + 14 || x > B.maxX - 14 || z < B.minZ + 14 || z > B.maxZ - 14) { ok = false; break; }
        xs[i] = x; zs[i] = z;
        x -= Math.cos(hd) * ds; z -= Math.sin(hd) * ds; hd -= kappa * ds;
      }
      if (!ok) continue;
      for (let i = 0; i < n; i++) g[i] = this.topAt(xs[i], zs[i], 4);
      // Drape: the lowest line over every roof that never slopes steeper than SLOPE
      for (let i = 0; i < n; i++) h[i] = i ? Math.max(g[i], h[i - 1] - k) : g[i];
      for (let i = n - 2; i >= 0; i--) h[i] = Math.max(h[i], h[i + 1] - k);
      let cover = 0, hs = 0, hmax = 0, hall = 0, rough = 0, minD = Infinity, vis = 0;
      for (let i = 0; i < n; i++) {
        hall = Math.max(hall, h[i]);
        if (i >= i0) {
          if (g[i] >= 5) cover++;
          hs += h[i];
          hmax = Math.max(hmax, h[i]);
          if (i > i0) rough += Math.abs(h[i] - h[i - 1]);
          minD = Math.min(minD, Math.hypot(xs[i] - P.pos.x, zs[i] - P.pos.z));
        } else if (i < iBody && i % 4 === 0 && cam) {
          _a.set(xs[i], h[i] + LIFT, zs[i]);
          const d = _a.distanceTo(P.pos);
          _a.project(cam);
          if (_a.z < 1 && Math.abs(_a.x) < 1.1 && Math.abs(_a.y) < 1.1 && d < 260) vis++;
        }
      }
      const m = n - i0;
      const score = (1 - cover / m) * 90 + (hs / m) * 0.5 + Math.max(0, hmax - 55) * 2 + Math.max(0, hall - 80) * 0.8
        + rough * 0.12 + (minD < 22 ? 300 : 0) + vis * 1.5;
      if (!best || score < best.score) best = { score, x: xs, z: zs, g, h, ds, n, cover: cover / m, hmax };
    }
    return best;
  }

  routeAt(s, out) {
    const R = this.route, f = clamp(s / R.ds, 0, R.n - 1.001), i = Math.floor(f), t = f - i;
    out.x = R.x[i] + (R.x[i + 1] - R.x[i]) * t;
    out.z = R.z[i] + (R.z[i + 1] - R.z[i]) * t;
    out.y = R.h[i] + (R.h[i + 1] - R.h[i]) * t;
    return out;
  }

  // ---- coming and going --------------------------------------------------------------------

  /** Lay a route and start it crawling in. False if no route will do. */
  spawn(ctx) {
    if (this.active) return false;
    const R = this.planRoute(ctx.player, ctx.camera);
    if (!R) return false;
    this.route = R;
    this.off = ARRIVE;
    this.active = true;
    this.time = 0;
    this.cores = SEGS;
    this.events.length = 0;
    for (const seg of this.segs) {
      for (let k = 0; k < 3; k++) seg.hp.fill(LAYERS[k].hp, k * PER_SEG, (k + 1) * PER_SEG);
      seg.flash.fill(0);
      seg.core = CORE_HP;
      seg.dead = seg.gone = seg.open = false;
      seg.coreFlash = 0;
      seg.t.stealth = false;
      seg.t.alive = true;
      seg.gem.visible = seg.halo.visible = true;
      this.world.targets.push(seg.t);
    }
    this.tip.gone = false;
    for (const m of [...this.tiles, this.frame, this.belly, this.collars, ...Object.values(this.legParts)]) m.visible = true;
    for (const m of this.fragMesh) m.visible = true;
    this.tipMesh.visible = true;
    for (let i = 0; i < SEGS + 4; i++) this.collars.setMatrixAt(i, ZERO);
    const H = this.head;
    Object.assign(H, { state: 'arrive', hp: HEAD_HP, flash: 0, throttle: 0, bite: 0, burst: 0, ram: null, spin: 0, spinA: 0, warned: false });
    H.cool.fan = rand(3, 5); H.cool.bite = 0; H.cool.roar = rand(5, 9);
    H.laser.phase = 'idle'; H.laser.cool = 3;
    H.t.alive = true;
    H.t.stealth = true;
    H.group.visible = true;
    this.world.targets.push(H.t);
    this.layout();
    this.recolor();
    const L = this.segs[SEGS - 1];
    H.pos.copy(L.b).addScaledVector(L.fwd, NECK * 0.85).addScaledVector(UP, 6.5);
    this.face(L.fwd, 1);
    for (const leg of this.legs) { this.hipOf(leg); this.plant(leg, true); }
    this.sound.millipedeRoar(H.pos);
    return true;
  }

  clear() {
    this.active = false;
    this.events.length = 0;
    this.frags.length = 0;
    for (const seg of this.segs) {
      const i = this.world.targets.indexOf(seg.t);
      if (i >= 0) this.world.targets.splice(i, 1);
      seg.gem.visible = seg.halo.visible = false;
    }
    const i = this.world.targets.indexOf(this.head.t);
    if (i >= 0) this.world.targets.splice(i, 1);
    this.head.group.visible = false;
    this.head.state = 'off';
    for (const B of this.eyeBeams) B.core.visible = B.glow.visible = B.line.visible = false;
    for (const m of [...this.tiles, ...this.fragMesh, this.frame, this.belly, this.collars, ...Object.values(this.legParts)]) m.visible = false;
    this.tipMesh.visible = false;
  }

  // ---- body layout -------------------------------------------------------------------------------

  /** Place every section along the route, as far in as it has crawled */
  layout() {
    const s0 = ARRIVE - this.off;
    this.place(this.tip, s0, s0 + TIP_LEN);
    for (const seg of this.segs) this.place(seg, s0 + seg.s, s0 + seg.s + SEG_LEN);
    this.writeBody();
  }

  /** A rigid section from route position sa to sb, lifted until it clears every roof under it */
  place(F, sa, sb) {
    const A = this.routeAt(sa, F.a), B = this.routeAt(sb, F.b);
    A.y += LIFT; B.y += LIFT;
    let need = 0;
    for (let s = sa + 1; s < sb; s += 1.5) {
      const u = (s - sa) / (sb - sa);
      need = Math.max(need, this.routeAt(s, _a).y + LIFT - 0.8 - (A.y + (B.y - A.y) * u));
    }
    A.y += need; B.y += need;
    F.c.addVectors(A, B).multiplyScalar(0.5);
    F.fwd.subVectors(B, A).normalize();
    F.right.crossVectors(UP, F.fwd).normalize();
    F.up.crossVectors(F.fwd, F.right);
    F.M.makeBasis(F.right, F.up, F.fwd).setPosition(F.c);
  }

  /** Instance matrices for every plate, frame, keel and joint */
  writeBody() {
    for (const seg of this.segs) {
      const base = seg.i * PER_SEG;
      for (let k = 0; k < 3; k++) {
        const mesh = this.tiles[k];
        for (let c = 0; c < PER_SEG; c++) {
          if (seg.gone || seg.hp[k * PER_SEG + c] <= 0) mesh.setMatrixAt(base + c, ZERO);
          else mesh.setMatrixAt(base + c, _m.multiplyMatrices(seg.M, this.cellM[c]));
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      this.frame.setMatrixAt(seg.i, seg.gone ? ZERO : seg.M);
      this.belly.setMatrixAt(seg.i, seg.gone ? ZERO : seg.M);
      seg.gem.position.copy(seg.c);
      seg.halo.position.copy(seg.c);
    }
    this.frame.instanceMatrix.needsUpdate = this.belly.instanceMatrix.needsUpdate = true;
    this.tipMesh.matrix.copy(this.tip.gone ? ZERO : this.tip.M);
    // Joints: tail tip to the first section, then section to section
    let n = 0;
    const joint = (P, Q, gone) => {
      if (gone) { this.collars.setMatrixAt(n++, ZERO); return; }
      _a.subVectors(Q, P);
      const len = _a.length() + 3;
      _q.setFromUnitVectors(UP, _a.normalize());
      this.collars.setMatrixAt(n++, _m.compose(_b.addVectors(P, Q).multiplyScalar(0.5), _q, _s.set(1, len, 1)));
    };
    joint(this.tip.b, this.segs[0].a, this.tip.gone || this.segs[0].gone);
    for (let i = 1; i < SEGS; i++) joint(this.segs[i - 1].b, this.segs[i].a, this.segs[i - 1].gone || this.segs[i].gone);
    this.collarN = n;
    this.collars.instanceMatrix.needsUpdate = true;
  }

  /** The neck, a curve of three sleeves from the front section up to the head, while it's attached */
  writeNeck(show) {
    const L = this.segs[SEGS - 1], H = this.head;
    const P0 = L.b, P3 = _c.set(0, -0.3, -9).applyQuaternion(H.q).add(H.pos);
    const P1 = _d.copy(P0).addScaledVector(L.fwd, 4), P2 = _e.copy(P3).addScaledVector(H.fwd, -4);
    const bez = (u, out) => {
      const v = 1 - u;
      return out.copy(P0).multiplyScalar(v * v * v).addScaledVector(P1, 3 * v * v * u).addScaledVector(P2, 3 * v * u * u).addScaledVector(P3, u * u * u);
    };
    for (let k = 0; k < 3; k++) {
      const i = this.collarN + k;
      if (!show) { this.collars.setMatrixAt(i, ZERO); continue; }
      const A = bez(k / 3 - 0.02, _a), B = bez((k + 1) / 3 + 0.02, _b);
      _g.subVectors(B, A);
      const len = _g.length() + 1.5;
      _q.setFromUnitVectors(UP, _g.normalize());
      this.collars.setMatrixAt(i, _m.compose(_n.addVectors(A, B).multiplyScalar(0.5), _q, _s.set(0.95, len, 0.95)));
    }
    this.collars.count = this.collarN + 3;
    this.collars.instanceMatrix.needsUpdate = true;
  }

  /** Plate colors: worn darker as they're damaged, dead sections dark, struck ones flashing */
  recolor(seg = null) {
    for (const S of seg ? [seg] : this.segs) {
      const base = S.i * PER_SEG;
      let flashing = false;
      for (let k = 0; k < 3; k++) {
        const mesh = this.tiles[k], hp0 = LAYERS[k].hp;
        for (let c = 0; c < PER_SEG; c++) {
          const j = k * PER_SEG + c, f = S.flash[j];
          if (f > 0) flashing = true;
          const v = S.dead ? 0.35 : 0.62 + 0.38 * Math.max(0, S.hp[j] / hp0);
          mesh.setColorAt(base + c, _col.setRGB(v + f * 2.4, v + f * 1.7, v + f * 1.2));
        }
        mesh.instanceColor.needsUpdate = true;
      }
      const fv = S.dead ? 0.35 : 1;
      this.belly.setColorAt(S.i, _col.setRGB(fv, fv, fv));
      this.belly.instanceColor.needsUpdate = true;
      S.flashing = flashing;
    }
  }

  // ---- legs --------------------------------------------------------------------------------------

  hipOf(leg) {
    const F = leg.F;
    return leg.hip.copy(F.c).addScaledVector(F.right, leg.side * 3.9).addScaledVector(F.up, -2.6).addScaledVector(F.fwd, leg.z);
  }

  /** Find a hold for a foot: on the roof beside it, straight down, a wall alongside, or nothing (it dangles) */
  plant(leg, now = false) {
    const F = leg.F, hip = leg.hip;
    const dirs = [
      [_a.copy(F.right).multiplyScalar(leg.side * 0.78).addScaledVector(F.up, -0.62).addScaledVector(F.fwd, leg.z > 0 ? 0.12 : -0.12).normalize(), 15],
      [_b.set(0, -1, 0), 14],
      [_c.copy(F.right).multiplyScalar(leg.side).addScaledVector(UP, -0.2).normalize(), 12],
      [_d.copy(F.right).multiplyScalar(leg.side * 0.3).addScaledVector(UP, -0.95).normalize(), 15],
    ];
    let hold = null;
    for (const [d, max] of dirs) {
      const h = this.world.raycast(hip, d, max, { targets: false });
      if (h) { hold = h.point; break; }
    }
    leg.dangle = !hold;
    const to = hold || this.danglePoint(leg, _e);
    leg.from.copy(now ? to : leg.foot);
    leg.to.copy(to);
    if (now) { leg.foot.copy(to); leg.t = 1; } else { leg.t = 0; leg.dur = rand(0.28, 0.4); }
  }

  danglePoint(leg, out) {
    const F = leg.F, w = Math.sin(this.time * 1.7 + leg.phase);
    return out.copy(leg.hip).addScaledVector(F.right, leg.side * (4 + w)).addScaledVector(UP, -8.5).addScaledVector(F.fwd, w * 1.2);
  }

  updateLegs(dt, moving) {
    let steps = 0;
    for (const leg of this.legs) {
      if (leg.F.gone) continue;
      this.hipOf(leg);
      if (leg.t < 1) {
        leg.t = Math.min(1, leg.t + dt / leg.dur);
        const k = leg.t * leg.t * (3 - 2 * leg.t);
        leg.foot.lerpVectors(leg.from, leg.to, k).addScaledVector(UP, Math.sin(Math.PI * leg.t) * 2.6);
        if (leg.t >= 1 && moving && Math.random() < 0.2) this.sound.spiderLand(leg.foot);
        continue;
      }
      if (leg.dangle) {
        leg.foot.lerp(this.danglePoint(leg, _a), damp(3, dt));
        if (Math.random() < dt * 0.6 && steps < 3) { steps++; this.plant(leg); }
        continue;
      }
      // Step when the body has carried the hip too far from the foot; twitch now and then at rest
      const ideal = _a.copy(leg.hip).addScaledVector(leg.F.right, leg.side * 7.5).addScaledVector(UP, -7);
      const far = leg.foot.distanceTo(ideal) > (moving ? 6.5 : 12) || leg.foot.distanceTo(leg.hip) > FEMUR + TIBIA;
      if ((far || Math.random() < dt * 0.05) && steps < (moving ? 6 : 2)) { steps++; this.plant(leg); }
    }
  }

  renderLegs() {
    const P = this.legParts;
    this.legs.forEach((leg, i) => {
      if (leg.F.gone) {
        for (const key of ['femur', 'femurX', 'tibia', 'tibiaX']) P[key].setMatrixAt(i, ZERO);
        P.joint.setMatrixAt(i * 2, ZERO); P.joint.setMatrixAt(i * 2 + 1, ZERO);
        return;
      }
      const F = leg.F, hip = leg.hip;
      const { knee, tip, pole, axis } = solveLeg(hip, leg.foot, FEMUR, TIBIA, F.c, F.up, 0.9);
      P.femur.setMatrixAt(i, plateMatrix(_m, hip, _n.subVectors(knee, hip), pole, FEMUR, 0.8, 1.2));
      P.femurX.setMatrixAt(i, plateMatrix(_m, hip, _n.subVectors(knee, hip), axis, FEMUR, 0.6, 1.0));
      P.tibia.setMatrixAt(i, plateMatrix(_m, knee, _n.subVectors(tip, knee), pole, TIBIA, 0.66, 1.0));
      P.tibiaX.setMatrixAt(i, plateMatrix(_m, knee, _n.subVectors(tip, knee), axis, TIBIA, 0.48, 0.85));
      for (const [k, at, r] of [[i * 2, hip, 1.2], [i * 2 + 1, knee, 1.0]]) {
        _g.crossVectors(pole, axis);
        _m.makeBasis(_a.copy(pole).multiplyScalar(r), _b.copy(axis).multiplyScalar(0.7), _g.multiplyScalar(r)).setPosition(at);
        P.joint.setMatrixAt(k, _m);
      }
    });
    for (const key in P) P[key].instanceMatrix.needsUpdate = true;
  }

  // ---- armor hits ------------------------------------------------------------------------------

  /** Ray against a section: the first live plate, the core, or the keel and end frames (which stop shots) */
  segRay(seg, o, d, max) {
    if (seg.gone) return null;
    const ox = o.x - seg.c.x, oy = o.y - seg.c.y, oz = o.z - seg.c.z;
    const bb = ox * d.x + oy * d.y + oz * d.z, RB = HALF + R_OUT + 1;
    if (ox * ox + oy * oy + oz * oz - bb * bb > RB * RB || -bb + RB < 0 || -bb - RB > max) return null;
    const R = seg.right, U = seg.up, F = seg.fwd;
    const lx = ox * R.x + oy * R.y + oz * R.z, ly = ox * U.x + oy * U.y + oz * U.z, lz = ox * F.x + oy * F.y + oz * F.z;
    const dx = d.x * R.x + d.y * R.y + d.z * R.z, dy = d.x * U.x + d.y * U.y + d.z * U.z, dz = d.x * F.x + d.y * F.y + d.z * F.z;
    let best = max, nx = 0, ny = 0, nz = 0, found = false;
    const A = dx * dx + dy * dy;
    const roots = (r) => {
      if (A < 1e-9) return null;
      const B = lx * dx + ly * dy, C = lx * lx + ly * ly - r * r, disc = B * B - A * C;
      if (disc < 0) return null;
      const sq = Math.sqrt(disc);
      return [(-B - sq) / A, (-B + sq) / A];
    };
    const take = (t, sx, sy, sz) => { best = t; nx = sx; ny = sy; nz = sz; found = true; };
    // Armor plates, outer layer first: met from outside on their outer face, from inside (through a hole) on their inner face
    for (let k = 0; k < 3; k++) {
      const L = LAYERS[k];
      for (const [r, enter] of [[L.r, true], [L.r - L.thick, false]]) {
        const rt = roots(r);
        if (!rt) continue;
        const t = enter ? rt[0] : rt[1];
        if (t < 0 || t >= best) continue;
        const z = lz + dz * t;
        if (Math.abs(z) > HALF) continue;
        const x = lx + dx * t, y = ly + dy * t, th = Math.atan2(x, y);
        if (Math.abs(th) > ARC) continue;
        const cell = Math.min(ROWS - 1, Math.floor((th + ARC) / DTH)) * COLS + Math.min(COLS - 1, Math.floor((z + HALF) / DZ));
        if (seg.hp[k * PER_SEG + cell] <= 0) continue;
        const s = enter ? 1 / r : -1 / r;
        take(t, x * s, y * s, 0);
      }
    }
    // The keel underneath
    const rb = roots(R_BELLY);
    if (rb) {
      for (const t of rb) {
        if (t < 0 || t >= best) continue;
        const z = lz + dz * t, x = lx + dx * t, y = ly + dy * t;
        if (Math.abs(z) <= HALF && Math.abs(Math.atan2(x, y)) > ARC) take(t, x / R_BELLY, y / R_BELLY, 0);
      }
    }
    // The core
    const rc = roots(R_CORE);
    if (rc && rc[0] >= 0 && rc[0] < best && Math.abs(lz + dz * rc[0]) <= CORE_HALF) take(rc[0], (lx + dx * rc[0]) / R_CORE, (ly + dy * rc[0]) / R_CORE, 0);
    // The frames closing each end
    if (Math.abs(dz) > 1e-6) {
      for (const zz of [-HALF, HALF]) {
        const t = (zz - lz) / dz;
        if (t < 0 || t >= best) continue;
        const x = lx + dx * t, y = ly + dy * t;
        if (x * x + y * y <= R_OUT * R_OUT) take(t, 0, 0, Math.sign(lz - zz) || 1);
      }
    }
    if (!found) return null;
    return { t: best, normal: new V3().copy(R).multiplyScalar(nx).addScaledVector(U, ny).addScaledVector(F, nz) };
  }

  /** Point to section-local (x right, y up, z forward) */
  toLocal(seg, p, out) {
    _g.subVectors(p, seg.c);
    return out.set(_g.dot(seg.right), _g.dot(seg.up), _g.dot(seg.fwd));
  }

  /** A shot lands on a section: on the outermost plate left where it struck, or the core if it got that deep */
  segHit(seg, amount, point) {
    if (seg.gone) return false;
    const p = point || seg.c, L = this.toLocal(seg, p, _e), rho = Math.hypot(L.x, L.y), th = Math.atan2(L.x, L.y);
    if (seg.dead) { this.clang(p, 0.5); return false; }
    if (rho <= R_CORE + 0.6 && Math.abs(L.z) <= CORE_HALF + 0.4) return this.hurtCore(seg, amount, p);
    if (Math.abs(th) <= ARC + 0.05 && Math.abs(L.z) <= HALF) {
      const cell = clamp(Math.floor((th + ARC) / DTH), 0, ROWS - 1) * COLS + clamp(Math.floor((L.z + HALF) / DZ), 0, COLS - 1);
      for (let k = 0; k < 3; k++) {
        if (seg.hp[k * PER_SEG + cell] > 0 && rho >= LAYERS[k].r - LAYERS[k].thick - 0.6) { this.hurtTile(seg, k, cell, amount, p); return false; }
      }
    }
    this.clang(p, 1);
    return false;
  }

  /** A blast near a section: every plate in reach takes it, though plates under another one take little */
  segBlast(seg, point, radius, amount) {
    if (seg.gone || seg.dead || point.distanceTo(seg.c) > HALF + R_OUT + radius) return;
    const L = this.toLocal(seg, point, _e), lx = L.x, ly = L.y, lz = L.z;
    for (let row = 0; row < ROWS; row++) {
      const th = -ARC + (row + 0.5) * DTH, sn = Math.sin(th), cs = Math.cos(th);
      for (let col = 0; col < COLS; col++) {
        const cell = row * COLS + col, z = -HALF + (col + 0.5) * DZ;
        let covered = false;
        for (let k = 0; k < 3; k++) {
          const j = k * PER_SEG + cell;
          if (seg.hp[j] <= 0) continue;
          const rc = LAYERS[k].r - LAYERS[k].thick / 2;
          const d = Math.hypot(rc * sn - lx, rc * cs - ly, z - lz);
          if (d < radius) this.hurtTile(seg, k, cell, amount * (1 - d / radius) * (covered ? 0.2 : 1), null);
          covered = true;
        }
      }
    }
    if (seg.open) {
      const d = Math.hypot(lx, ly, lz) - R_CORE;
      if (d < radius) this.hurtCore(seg, amount * (1 - Math.max(0, d) / radius) * 0.8, null);
    }
  }

  hurtTile(seg, k, cell, amount, point) {
    const j = k * PER_SEG + cell;
    seg.hp[j] -= amount;
    seg.flash[j] = 1;
    seg.flashing = true;
    if (point) {
      const c = k === 0 ? 0xff6040 : k === 1 ? 0xffc060 : 0x80e0ff;
      this.fx.sparksBurst(point, _a.subVectors(point, seg.c).normalize(), 5, c, 22);
      this.sound.metalHit(point, 0.6);
    }
    if (seg.hp[j] <= 0) this.breakTile(seg, k, cell);
  }

  /** A plate comes away: it flies off the body, and the layer under it shows */
  breakTile(seg, k, cell) {
    const W = _m.multiplyMatrices(seg.M, this.cellM[cell]);
    this.tiles[k].setMatrixAt(seg.i * PER_SEG + cell, ZERO);
    this.tiles[k].instanceMatrix.needsUpdate = true;
    const L = LAYERS[k], rc = L.r - L.thick / 2;
    const pos = new V3(0, rc, 0).applyMatrix4(W), q = new THREE.Quaternion().setFromRotationMatrix(W);
    const out = _a.subVectors(pos, seg.c).normalize();
    // The oldest plate of this layer still flying goes to make room
    const same = this.frags.filter((f) => f.k === k);
    if (same.length >= FRAGS) this.frags.splice(this.frags.indexOf(same[0]), 1);
    this.frags.push({
      k, pos, q, vel: out.clone().multiplyScalar(rand(9, 18)).add(_b.set(rand(-4, 4), rand(4, 10), rand(-4, 4))),
      axis: new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), w: rand(3, 9), life: rand(6, 9), rest: false,
    });
    this.fx.sparksBurst(pos, out, 12, k === 2 ? 0x9fe8ff : 0xffb060, 30);
    for (let i = 0; i < 6; i++) this.fx.smoke.emit(pos.x, pos.y, pos.z, out.x * 4 + rand(-2, 2), out.y * 4 + rand(0, 3), out.z * 4 + rand(-2, 2), rand(1, 2), 1.2, 4, 0.2, 0.2, 0.2, 0.6, 0.4, 0.4, 0.4, 0, 1, 0.4);
    const D = this.world.destruct;
    if (D) for (let i = 0; i < 2; i++) D.debris.spawn(pos.x, pos.y, pos.z, out.x * 10 + rand(-4, 4), rand(4, 10), out.z * 10 + rand(-4, 4), 0.5, 8, rand(6, 10));
    this.sound.crash(pos, 0.4);
    // A hole through all three layers over the core opens it to fire
    if (!seg.open) {
      const col = cell % COLS;
      if (col >= 1 && col <= COLS - 2 && seg.hp[cell] <= 0 && seg.hp[PER_SEG + cell] <= 0 && seg.hp[2 * PER_SEG + cell] <= 0) {
        seg.open = true;
        this.alert('REACTOR CORE EXPOSED', 1.6);
      }
    }
  }

  hurtCore(seg, amount, point) {
    if (seg.dead) return false;
    seg.core -= amount;
    seg.coreFlash = 1;
    if (point) this.fx.sparksBurst(point, _a.subVectors(point, seg.c).normalize(), 8, 0xffffff, 26);
    if (seg.core <= 0) { this.breakCore(seg); return true; }
    return false;
  }

  /** A core goes: the gem bursts in every color and the section goes dark */
  breakCore(seg) {
    seg.dead = true;
    seg.t.stealth = true;
    seg.gem.visible = seg.halo.visible = false;
    const p = seg.c, fx = this.fx;
    fx.explosion(p, 1.8);
    fx.flash(p, 26, 0xffffff, 0.3);
    fx.light(p, 0xffffff, 160, 0.5, 70);
    for (let i = 0; i < 90; i++) {
      _col.setHSL(Math.random(), 1, 0.6);
      _a.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(14, 34));
      fx.sparks.emit(p.x, p.y, p.z, _a.x, _a.y, _a.z, rand(0.6, 1.4), 0.5, 0.08, _col.r * 4, _col.g * 4, _col.b * 4, 1, _col.r, _col.g, _col.b, 0, 1.2, -14);
    }
    this.sound.coreBreak(p);
    this.recolor(seg);
    this.cores--;
    const H = this.head;
    H.flinch = 1;
    this.sound.millipedeRoar(H.pos, 0.7);
    if (this.cores > 0) this.alert(`REACTOR CORE DESTROYED · ${this.cores} LEFT`, 2.2);
    else this.ignite();
  }

  /** Shots that glance off something it can't be hurt through */
  clang(p, k) {
    this.fx.sparksBurst(p, UP, 4, 0xffe0a0, 20);
    this.sound.metalHit(p, k * 0.5);
  }

  // ---- the head ---------------------------------------------------------------------------------

  headHit(amount, point) {
    const H = this.head;
    if (H.t.stealth || H.hp <= 0) {
      if (point) this.clang(point, 1);
      if (!H.warned && (H.state === 'perched' || H.state === 'arrive')) {
        H.warned = true;
        this.alert('HEAD ARMOR IMPERVIOUS · DESTROY THE REACTOR CORES', 3);
      }
      return false;
    }
    H.hp -= amount;
    H.flash = 1;
    if (point) this.fx.sparksBurst(point, _a.subVectors(point, H.pos).normalize(), 6, 0xff6040, 26);
    if (H.hp <= 0) { this.berserk(); return true; }
    return false;
  }

  /** Orient the head to look along `dir`, rolled by `roll`, at `rate` */
  face(dir, rate, roll = 0) {
    const H = this.head;
    _n.copy(dir).normalize();
    _a.crossVectors(UP, _n);
    if (_a.lengthSq() < 1e-6) _a.set(1, 0, 0);
    _a.normalize();
    _b.crossVectors(_n, _a);
    _m2.makeBasis(_a, _b, _n);
    _q.setFromRotationMatrix(_m2);
    if (roll) _q.multiply(_q2.setFromAxisAngle(_c.set(0, 0, 1), roll));
    H.q.slerp(_q, rate);
    H.fwd.set(0, 0, 1).applyQuaternion(H.q);
  }

  eyePos(i, out) { return out.copy(this.head.eyeLocal[i]).applyQuaternion(this.head.q).add(this.head.pos); }
  mouth(out) { return out.set(0, -2.2, 8).applyQuaternion(this.head.q).add(this.head.pos); }

  /** Up on its neck at the front of the body, watching the mech */
  perch(dt, P, arriving) {
    const H = this.head, L = this.segs[SEGS - 1];
    const base = _a.copy(L.b).addScaledVector(L.fwd, NECK * 0.85).addScaledVector(UP, 6.5);
    base.y = Math.max(base.y, this.topAt(base.x, base.z, 6) + 7);
    base.y += Math.sin(this.time * 1.2) * 0.5;
    H.flinch = Math.max(0, (H.flinch || 0) - dt * 1.5);
    base.addScaledVector(L.fwd, -H.flinch * 3).addScaledVector(UP, H.flinch * 2);
    H.pos.lerp(base, damp(arriving ? 14 : 4, dt));
    // Turn to the mech, as far as its neck allows
    const yaw0 = Math.atan2(L.fwd.x, L.fwd.z);
    let yaw = yaw0, pitch = -0.1;
    if (!arriving && P.alive) {
      _b.subVectors(P.chest, H.pos);
      yaw = yaw0 + clamp(wrap(Math.atan2(_b.x, _b.z) - yaw0), -1.25, 1.25);
      pitch = clamp(Math.atan2(_b.y, Math.hypot(_b.x, _b.z)), -0.65, 0.4);
    }
    _c.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.face(_c, damp(3, dt), Math.sin(this.time * 0.9) * 0.08);
    if (arriving) return;
    // Volleys of plasma fans, and a bite for anything that comes too close
    const cool = H.cool, sees = P.alive && this.sw.clearLine(this.mouth(_d), P.chest);
    for (const k in cool) cool[k] -= dt;
    this.fans(dt, P, sees);
    if (P.alive && cool.bite <= 0 && capsuleDist(this.mouth(_d), P.pos) < 9) {
      cool.bite = 2.4;
      H.bite = 1;
      this.sw.cb.onPlayerHit && this.sw.cb.onPlayerHit(38, H.pos.clone(), 'crush');
      this.sound.clawSnap(_d);
    }
    if (cool.roar <= 0) { cool.roar = rand(9, 15); this.sound.millipedeRoar(H.pos, 0.6); H.bite = 0.6; }
  }

  fans(dt, P, sees) {
    const H = this.head, sw = this.sw;
    if (H.burst > 0) {
      H.burstT -= dt;
      if (H.burstT <= 0) {
        H.burst--;
        H.burstT = 0.28;
        const o = this.mouth(_d);
        for (const yaw of [-0.3, -0.15, 0, 0.15, 0.3]) {
          _e.copy(P.chest).addScaledVector(P.vel, o.distanceTo(P.chest) / 40 * 0.7).sub(o).applyAxisAngle(UP, yaw).add(o);
          sw.shoot('fan', o, _e, 0.4 + o.distanceTo(P.chest) * 0.008);
        }
        H.bite = Math.max(H.bite, 0.7);
      }
    }
    if (sees && H.cool.fan <= 0 && H.burst <= 0 && P.chest.distanceTo(H.pos) < 230 && sw.bolts.length < 200) {
      H.burst = 3;
      H.burstT = 0.05;
      H.cool.fan = rand(3.6, 5.2);
    }
  }

  /** The last core is gone: the neck thrusters light */
  ignite() {
    const H = this.head;
    H.state = 'ignite';
    H.stateT = 0;
    this.alert('ALL CORES DOWN · THE HEAD IS BREAKING LOOSE', 3);
    this.sound.thrusters(H.pos);
  }

  /** It's dead on its feet: plough through the city */
  berserk() {
    const H = this.head;
    this.endLaser();
    H.state = 'ram';
    H.stateT = 0;
    H.t.stealth = true;
    H.hp = 0;
    this.alert('MILLIPEDE HEAD CRITICAL', 2.4);
    this.sound.millipedeRoar(H.pos, 1.2);
    // A tour of the buildings around it, nearest next, keeping clear of the mech
    const P = this.sw.P, todo = [];
    const seen = new Set();
    for (const c of this.sw.buildings) {
      const key = c.owner || c;
      if (seen.has(key)) continue;
      seen.add(key);
      const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
      if (P && Math.hypot(cx - P.pos.x, cz - P.pos.z) < 38) continue;
      todo.push(c);
    }
    const list = [], n = 20 + Math.floor(Math.random() * 11);
    let at = _a.copy(H.pos);
    while (list.length < n && todo.length) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < todo.length; i++) {
        const c = todo[i], d = Math.hypot((c.min.x + c.max.x) / 2 - at.x, (c.min.z + c.max.z) / 2 - at.z);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi < 0 || bd > 170) break;
      const c = todo.splice(bi, 1)[0];
      list.push(c);
      at = _b.set((c.min.x + c.max.x) / 2, 0, (c.min.z + c.max.z) / 2);
    }
    H.ram = { list, i: 0, through: false, t: 0, blastT: 0, hitT: 0, dir: new V3(), n: 0 };
  }

  updateHead(dt, P) {
    const H = this.head, fx = this.fx;
    H.stateT = (H.stateT || 0) + dt;
    H.flash = Math.max(0, H.flash - dt * 5);
    H.bite = Math.max(0, H.bite - dt * 2.5);
    let throttle = 0;
    switch (H.state) {
      case 'arrive': this.perch(dt, P, true); break;
      case 'perched': this.perch(dt, P, false); break;
      case 'ignite': {
        // Thrusters spool up while it strains against its neck
        this.perch(dt, P, false);
        throttle = Math.min(1, H.stateT / 1.2);
        H.pos.addScaledVector(UP, Math.sin(H.stateT * 40) * 0.08);
        if (Math.random() < dt * 20) fx.sparksBurst(this.segs[SEGS - 1].b, UP, 3, 0xffc070, 20);
        if (H.stateT >= 1.4) {
          // Torn free
          const p = this.segs[SEGS - 1].b;
          fx.explosion(_a.copy(p).addScaledVector(UP, 2), 1.6);
          this.sound.explosion(p, 1.4);
          this.writeNeck(false);
          H.state = 'launch';
          H.stateT = 0;
          H.t.stealth = false;
          H.vel.set(0, 26, 0).addScaledVector(H.fwd, -6);
          this.alert('THE HEAD IS LOOSE', 2);
        }
        break;
      }
      case 'launch': {
        throttle = 1;
        const alt = Math.max(50, this.topAt(H.pos.x, H.pos.z, 25) + 22);
        H.vel.y += ((alt - H.pos.y) * 1.2 - H.vel.y) * damp(2, dt);
        H.vel.x *= 1 - damp(1, dt); H.vel.z *= 1 - damp(1, dt);
        H.pos.addScaledVector(H.vel, dt);
        _a.copy(H.fwd).setY(0.9);
        this.face(_a, damp(2, dt));
        if (H.pos.y >= alt - 4 || H.stateT > 4) {
          // Off away from the mech, a fair way
          _a.subVectors(H.pos, P.pos).setY(0);
          if (_a.lengthSq() < 1) _a.set(1, 0, 0);
          _a.normalize().applyAxisAngle(UP, rand(-0.5, 0.5));
          _b.copy(P.pos).addScaledVector(_a, rand(140, 170));
          this.goalAt(_b, Math.max(48, this.topAt(_b.x, _b.z, 20) + 20));
          H.state = 'away';
          H.stateT = 0;
        }
        break;
      }
      case 'away':
        throttle = 0.8;
        this.fly(dt, H.goal, 48, null);
        if (H.pos.distanceTo(H.goal) < 14 || H.stateT > 7) { H.state = 'turn'; H.stateT = 0; this.sound.millipedeRoar(H.pos, 1); }
        break;
      case 'turn':
        throttle = 0.4;
        this.fly(dt, H.goal, 8, _a.subVectors(P.chest, H.pos), 1.4);
        if (H.stateT > 1.8) { H.state = 'attack'; H.stateT = 0; H.moveT = 0; H.laser.cool = 0.6; }
        break;
      case 'attack': throttle = this.attack(dt, P); break;
      case 'ram': throttle = 1; this.ram(dt, P); break;
      case 'rise': throttle = 1; this.rise(dt); break;
    }
    // Thruster flames and smoke
    H.throttle += (throttle - H.throttle) * damp(6, dt);
    for (const N of H.nozzles) {
      const on = H.throttle > 0.03;
      N.flame.visible = N.core.visible = on;
      if (!on) continue;
      const f = H.throttle * (0.85 + 0.25 * Math.random());
      N.flame.scale.set(0.7 + 0.4 * f, 0.7 + 0.4 * f, f * 1.2);
      N.core.scale.set(0.8, 0.8, f);
      if (Math.random() < dt * 30 * H.throttle) {
        _a.copy(N.exit).applyQuaternion(H.q).add(H.pos);
        _b.set(0, 0, -1).applyQuaternion(H.q).multiplyScalar(30).add(H.vel);
        fx.fire.emit(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, rand(0.15, 0.3), 1.6, 0.4, 3, 1.5, 0.5, 1, 1, 0.3, 0.05, 0, 1);
        fx.smoke.emit(_a.x, _a.y, _a.z, _b.x * 0.3, _b.y * 0.3, _b.z * 0.3, rand(1.2, 2.2), 1.5, 6, 0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.5, 0, 0.8, 0.3);
      }
    }
    H.t.pos.copy(H.pos);
  }

  /** A goal point at an altitude, kept inside the city */
  goalAt(p, alt) {
    const B = this.world.bounds, H = this.head;
    H.goal.set(clamp(p.x, B.minX + 20, B.maxX - 20), alt, clamp(p.z, B.minZ + 20, B.maxZ - 20));
    return H.goal;
  }

  /** Fly toward a goal, easing in, looking where it's going or at `look`, banking into turns */
  fly(dt, goal, speed, look, turnRate = 3) {
    const H = this.head;
    _f1.subVectors(goal, H.pos);
    const d = _f1.length();
    const want = _f1.multiplyScalar(d > 1e-3 ? Math.min(speed, d * 1.2) / d : 0);
    _f2.subVectors(want, H.vel);
    const lateral = _f2.dot(_f3.crossVectors(UP, H.fwd).normalize());
    H.vel.addScaledVector(_f2, damp(2, dt));
    H.pos.addScaledVector(H.vel, dt);
    // Over the roofs, never through them
    const floor = this.topAt(H.pos.x, H.pos.z, 8) + 7;
    if (H.pos.y < floor) { H.pos.y += (floor - H.pos.y) * damp(6, dt); H.vel.y = Math.max(H.vel.y, 0); }
    const dir = look || (H.vel.lengthSq() > 4 ? _f3.copy(H.vel) : H.fwd);
    this.face(dir, damp(turnRate, dt), clamp(-lateral * 0.04, -0.6, 0.6));
  }

  /** Hunting the mech from the air: shifting stations, beam volleys from the eyes, plasma fans between */
  attack(dt, P) {
    const H = this.head, L = H.laser;
    H.moveT -= dt;
    if (H.moveT <= 0) {
      // A new station round the mech, over the lowest roofs of a few tried
      H.moveT = rand(4, 7);
      let top = Infinity;
      for (let i = 0; i < 6; i++) {
        const b = Math.atan2(H.pos.z - P.pos.z, H.pos.x - P.pos.x) + rand(-1.1, 1.1), r = rand(70, 115);
        _a.set(P.pos.x + Math.cos(b) * r, 0, P.pos.z + Math.sin(b) * r);
        const t = this.topAt(_a.x, _a.z, 20);
        if (t < top) { top = t; _b.copy(_a); }
      }
      this.goalAt(_b, Math.max(40, top + 20) + rand(0, 12));
    }
    // Backs off from a mech that gets in close
    if (H.pos.distanceTo(P.pos) < 30) { _a.subVectors(H.pos, P.pos).setY(0).normalize(); H.goal.addScaledVector(_a, 40 * dt); }
    this.fly(dt, H.goal, L.phase === 'fire' ? 9 : 28, _b.subVectors(L.phase === 'idle' ? P.chest : L.aim, H.pos), 2.5);
    const sees = P.alive && this.sw.clearLine(H.pos, P.chest);
    for (const k in H.cool) H.cool[k] -= dt;
    if (L.phase === 'idle') this.fans(dt, P, sees);
    this.laser(dt, P, sees);
    return 0.45 + (L.phase === 'fire' ? 0.2 : 0);
  }

  // ---- eye beams ----------------------------------------------------------------------------------

  laser(dt, P, sees) {
    const H = this.head, L = H.laser, fx = this.fx, D = this.world.destruct;
    L.t += dt;
    // Burning into a building that's still whole turns it into pieces, which is costly: one every so often
    this.carveT = Math.max(0, (this.carveT || 0) - dt);
    if (L.phase === 'idle') {
      L.cool -= dt;
      for (const B of this.eyeBeams) B.core.visible = B.glow.visible = B.line.visible = false;
      if (L.cool <= 0 && sees && H.pos.distanceTo(P.chest) < 260) {
        L.phase = 'charge';
        L.t = 0;
        L.aim.copy(P.chest).add(_a.set(rand(-10, 10), rand(-2, 6), rand(-10, 10)));
        this.sound.laserCharge(H.pos, EYE.charge);
      }
      return;
    }
    // The aim drags after the mech: walking won't shake it, dashing will
    _a.subVectors(P.chest, L.aim);
    const gap = _a.length(), step = (L.phase === 'charge' ? 30 : EYE.track) * dt;
    if (gap > step) L.aim.addScaledVector(_a, step / gap); else L.aim.copy(P.chest);
    const glowK = L.phase === 'charge' ? 1 + L.t * 3 : 3.5;
    for (const s of H.glows) s.scale.setScalar(4 * glowK);
    let onMech = 0;
    for (let i = 0; i < 2; i++) {
      const B = this.eyeBeams[i], from = this.eyePos(i, B.from);
      const dir = _b.subVectors(L.aim, from).normalize();
      const hit = this.world.raycast(from, dir, 520, { targets: false, trees: true });
      B.end.copy(hit ? hit.point : _c.copy(from).addScaledVector(dir, 520));
      if (L.phase === 'charge') {
        const flick = 0.35 + 0.65 * Math.abs(Math.sin(L.t * 40));
        drawBeam(B.line, from, B.end, 0.08 + L.t * 0.12, flick * 0.8, 0, this.time);
        B.core.visible = B.glow.visible = false;
        continue;
      }
      B.line.visible = false;
      const m = P.alive && segCapsuleHit(from, B.end, P.pos, 1.9);
      if (m) { B.end.copy(m); onMech++; }
      else if (hit) {
        // Carves whatever it's on
        if (hit.target && hit.target.kind === 'tree') this.world.damage(hit.target, 40 * dt, hit.point);
        else if (D && !hit.target && (hit.struct || this.carveT <= 0)) {
          if (!hit.struct) this.carveT = 0.6;
          D.beam(hit, dir, dt * 0.6, { enemy: true });
        }
        if (hit.normal.y > 0.9 && Math.random() < dt * 6) fx.scorch(hit.point.x, hit.point.z, rand(2.5, 4), hit.point.y + 0.03);
      }
      const w = 1 + 0.08 * Math.sin(this.time * 60 + i);
      drawBeam(B.core, from, B.end, 0.7 * w, 1, 1.6, this.time);
      drawBeam(B.glow, from, B.end, 2.8 * w, 0.85, 0, this.time);
      if (Math.random() < dt * 40) fx.sparksBurst(B.end, _c.copy(dir).negate(), 3, 0xff3020, 30);
      if (Math.random() < dt * 14) fx.fire.emit(B.end.x, B.end.y, B.end.z, rand(-4, 4), rand(2, 8), rand(-4, 4), rand(0.3, 0.6), 2.4, 4.5, 3, 0.5, 0.3, 1, 1, 0.1, 0.05, 0, 2, 2);
      if (Math.random() < dt * 8) fx.light(B.end, 0xff2010, 50, 0.1, 30);
    }
    L.acc += EYE.dps * onMech * dt;
    L.tick -= dt;
    if (L.tick <= 0 && L.acc > 0) {
      this.sw.cb.onPlayerHit && this.sw.cb.onPlayerHit(L.acc, H.pos.clone(), 'laser');
      L.acc = 0;
      L.tick = 0.12;
    }
    if (L.phase === 'charge' && L.t >= EYE.charge) {
      L.phase = 'fire';
      L.t = 0;
      this.sound.laserFire(H.pos);
      this.sound.eyeBeam(H.pos, EYE.fire);
      for (let i = 0; i < 2; i++) fx.flash(this.eyePos(i, _a), 8, 0xff2a20, 0.2);
    } else if (L.phase === 'fire' && L.t >= EYE.fire) this.endLaser();
  }

  endLaser() {
    const L = this.head.laser;
    L.phase = 'idle';
    L.t = 0;
    L.cool = rand(...EYE.cool);
    L.acc = 0;
    for (const B of this.eyeBeams) B.core.visible = B.glow.visible = B.line.visible = false;
    for (const s of this.head.glows) s.scale.setScalar(4);
  }

  // ---- death throes ---------------------------------------------------------------------------------

  /** Through one building after another, tearing a tunnel through each */
  ram(dt, P) {
    const H = this.head, R = H.ram, fx = this.fx, D = this.world.destruct;
    R.t += dt;
    const c = R.list[R.i];
    if (!c) { this.startRise(); return; }
    const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
    const cy = clamp(c.min.y + (c.max.y - c.min.y) * 0.45, Math.max(6, c.min.y + 3), 70);
    const inside = (e) => H.pos.x > c.min.x - e && H.pos.x < c.max.x + e && H.pos.z > c.min.z - e && H.pos.z < c.max.z + e && H.pos.y < c.max.y + e;
    const speed = 80;
    if (!R.through) {
      _a.set(cx - H.pos.x, cy - H.pos.y, cz - H.pos.z).normalize().multiplyScalar(speed);
      H.vel.lerp(_a, damp(4, dt));
      if (inside(1)) {
        // Straight through the middle, level
        R.through = true;
        R.t = 0;
        R.dir.set(cx - H.pos.x, 0, cz - H.pos.z);
        if (R.dir.lengthSq() < 1) R.dir.copy(H.vel).setY(0);
        if (R.dir.lengthSq() < 1e-4) R.dir.set(1, 0, 0);
        R.dir.normalize();
        this.sound.crash(H.pos, 2.5);
        this.sw.fx.onShake(H.pos, 1.2);
      } else if (R.t > 4) { R.i++; R.t = 0; }
    } else {
      H.vel.copy(R.dir).multiplyScalar(speed);
      if (!inside(9) || R.t > 3) { R.i++; R.n++; R.t = 0; R.through = false; }
    }
    H.pos.addScaledVector(H.vel, dt);
    H.pos.y = Math.max(H.pos.y, 5);
    // Tear through whatever it's inside
    R.blastT -= dt;
    if (R.blastT <= 0) {
      let solid = false;
      this.world.query(H.pos.x - 4, H.pos.z - 4, H.pos.x + 4, H.pos.z + 4, (b) => { if (b.building && H.pos.y < b.max.y + 3 && H.pos.y > b.min.y - 3) solid = true; });
      if (solid) {
        R.blastT = 0.08;
        if (D) D.blast(H.pos, 10, 1400, { chunks: 10 });
        fx.dust(H.pos, 1.6, 6);
        fx.sparksBurst(H.pos, _a.copy(H.vel).normalize().negate(), 10, 0xffc070, 40);
        if (Math.random() < 0.3) this.sound.crash(H.pos, 1.5);
      }
    }
    // Smoking, burning, sparking
    this.burning(dt, 1);
    this.face(H.vel, damp(6, dt), Math.sin(this.time * 3) * 0.5);
    if (P.alive && (R.hitT -= dt) <= 0 && capsuleDist(H.pos, P.pos) < 8) {
      R.hitT = 1.5;
      this.sw.cb.onPlayerHit && this.sw.cb.onPlayerHit(70, H.pos.clone(), 'crush');
    }
  }

  burning(dt, k) {
    const H = this.head, fx = this.fx, p = H.pos;
    if (Math.random() < dt * 30 * k) fx.smoke.emit(p.x + rand(-3, 3), p.y + rand(-1, 3), p.z + rand(-3, 3), rand(-1, 1), rand(1, 3), rand(-1, 1), rand(2, 3.5), 3, 10, 0.12, 0.11, 0.1, 0.8, 0.3, 0.3, 0.3, 0, 0.5, 0.4);
    if (Math.random() < dt * 20 * k) fx.fire.emit(p.x + rand(-3, 3), p.y + rand(-2, 2), p.z + rand(-3, 3), rand(-2, 2), rand(1, 4), rand(-2, 2), rand(0.3, 0.6), 2.4, 1, 3, 1.2, 0.3, 1, 1, 0.2, 0.05, 0, 1);
    if (Math.random() < dt * 6 * k) fx.sparksBurst(p, UP, 6, 0xffb060, 26);
  }

  startRise() {
    const H = this.head;
    H.state = 'rise';
    H.stateT = 0;
    H.riseFrom = H.pos.clone();
    H.spin = 0;
    H.spinA = Math.atan2(H.fwd.x, H.fwd.z);
    this.sound.millipedeRoar(H.pos, 1.4);
  }

  /** Up into the sky, spinning faster and faster */
  rise(dt) {
    const H = this.head, fx = this.fx, T = H.stateT;
    const goal = _a.copy(H.riseFrom).setY(Math.max(H.riseFrom.y + 40, 95));
    _b.subVectors(goal, H.pos).multiplyScalar(1.4);
    if (_b.length() > 34) _b.setLength(34);
    H.vel.lerp(_b, damp(3, dt));
    H.pos.addScaledVector(H.vel, dt);
    H.spin = Math.min(42, 1.5 + T * T * 2.8);
    H.spinA += H.spin * dt;
    _c.set(Math.sin(H.spinA), 0.35, Math.cos(H.spinA));
    this.face(_c, 1, Math.sin(T * 7) * 0.3);
    this.burning(dt, 1.5);
    // Sparks and flame thrown off in a spiral
    const n = Math.round(dt * (40 + H.spin * 8));
    for (let i = 0; i < n; i++) {
      const a = H.spinA + Math.random() * 6.28;
      _d.set(Math.cos(a), rand(-0.2, 0.3), Math.sin(a));
      fx.sparks.emit(H.pos.x + _d.x * 5, H.pos.y + _d.y * 3, H.pos.z + _d.z * 5, _d.z * H.spin * 1.2 + _d.x * 10, rand(-4, 8), -_d.x * H.spin * 1.2 + _d.z * 10,
        rand(0.4, 0.9), 0.35, 0.05, 3, 1.8, 0.6, 1, 1, 0.4, 0.1, 0, 0.8, -12);
    }
    if ((H.whine = (H.whine || 0) - dt) <= 0) { H.whine = 0.35; this.sound.spinWhine(H.pos, Math.min(1, T / 4)); }
    if (T > 4.2) this.boom();
  }

  /** The finale: a huge blast, fireworks, a ring of smoke rolling out, and the carcass going up section by section */
  boom() {
    const H = this.head, fx = this.fx, p = H.pos.clone(), D = this.world.destruct;
    H.state = 'gone';
    H.group.visible = false;
    this.endLaser();
    const i = this.world.targets.indexOf(H.t);
    if (i >= 0) this.world.targets.splice(i, 1);
    fx.explosion(p, 6);
    for (let k = 0; k < 3; k++) fx.explosion(_a.copy(p).add(_b.set(rand(-6, 6), rand(-4, 4), rand(-6, 6))), 3.5);
    fx.flash(p, 240, 0xffffff, 0.7);
    fx.light(p, 0xffd0a0, 600, 1.5, 400);
    fx.ring(p, 170, 1.8, UP, 0xffe0b0);
    fx.ring(_a.copy(p).setY(1), 120, 2.4, UP, 0xffc080);
    // A ring of smoke rolling out level from the blast, lit from inside at first
    for (let k = 0; k < 420; k++) {
      const a = (k / 420) * Math.PI * 2 + rand(-0.01, 0.01), v = rand(55, 80), g = rand(0.5, 0.65);
      _d.set(Math.cos(a), 0, Math.sin(a));
      fx.smoke.emit(p.x + _d.x * 6, p.y + rand(-2, 2), p.z + _d.z * 6, _d.x * v, rand(-1.5, 1.5), _d.z * v, rand(4.5, 6.5), rand(7, 10), rand(28, 40),
        g, g * 0.95, g * 0.9, 0.85, g * 0.9, g * 0.9, g * 0.9, 0, 0.75, 0.05, rand(-0.5, 0.5));
    }
    for (let k = 0; k < 90; k++) {
      const a = Math.random() * Math.PI * 2, v = rand(40, 70);
      fx.fire.emit(p.x, p.y, p.z, Math.cos(a) * v, rand(-2, 2), Math.sin(a) * v, rand(0.5, 0.9), 6, 14, 3, 1.6, 0.5, 1, 1, 0.2, 0.05, 0, 1.2);
    }
    // Wreckage
    if (D) for (let k = 0; k < 40; k++) D.debris.spawn(p.x, p.y, p.z, rand(-30, 30), rand(-5, 30), rand(-30, 30), rand(0.6, 1.6), 8, rand(8, 14));
    for (let k = 0; k < 120; k++) {
      _d.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(20, 60));
      fx.sparks.emit(p.x, p.y, p.z, _d.x, _d.y, _d.z, rand(0.8, 2), 0.6, 0.1, 4, 2.5, 1, 1, 1, 0.3, 0.05, 0, 0.6, -20);
    }
    this.sound.explosion(p, 4);
    this.sound.crash(p, 5);
    fx.onShake(p, 4);
    this.sw.cb.onKill && this.sw.cb.onKill({ name: 'MILLIPEDE', boss: true, v: {}, pos: p, kind: 'millipede' });
    // Secondary blasts, fireworks, then the body goes up from the neck back
    for (let k = 0; k < 8; k++) this.later(rand(0.15, 1.3), () => { fx.explosion(_a.copy(p).add(_b.set(rand(-22, 22), rand(-12, 12), rand(-22, 22))), rand(2, 3.2)); this.sound.explosion(_a, 1.5); });
    for (let k = 0; k < 22; k++) this.later(0.35 + k * 0.18 + rand(0, 0.15), () => this.firework(_a.copy(p).add(_b.set(rand(-65, 65), rand(0, 60), rand(-65, 65)))));
    const chain = [...this.segs].reverse();
    chain.forEach((seg, k) => this.later(1.6 + k * 0.22, () => this.burst(seg)));
    this.later(1.6 + SEGS * 0.22, () => this.burst(this.tip));
    this.later(2.2 + SEGS * 0.22, () => this.finish());
  }

  later(t, fn) { this.events.push({ t, fn }); }

  firework(q) {
    const fx = this.fx, c = _col.set(FIREWORKS[Math.floor(Math.random() * FIREWORKS.length)]);
    const r = c.r, g = c.g, b = c.b, n = 140, sp = rand(28, 42);
    for (let i = 0; i < n; i++) {
      _d.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(sp * rand(0.85, 1.05));
      fx.sparks.emit(q.x, q.y, q.z, _d.x, _d.y, _d.z, rand(1.6, 2.6), 1.0, 0.2, r * 4, g * 4, b * 4, 1, r * 1.5, g * 1.5, b * 1.5, 0, 1.4, -9);
    }
    for (let i = 0; i < 36; i++) {
      _d.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(sp * rand(0.3, 0.7));
      fx.sparks.emit(q.x, q.y, q.z, _d.x, _d.y, _d.z, rand(1.8, 3), 0.5, 0.4, 4, 4, 4, 1, 1, 1, 1, 0, 1.1, -6);
    }
    fx.flash(q, 34, c.getHex(), 0.3);
    fx.light(q, c.getHex(), 120, 0.4, 90);
    this.sound.fireworkPop(q);
  }

  /** A dead section blows apart */
  burst(F) {
    const fx = this.fx, D = this.world.destruct, p = F.c.clone();
    F.gone = true;
    if (F.t) {
      const i = this.world.targets.indexOf(F.t);
      if (i >= 0) this.world.targets.splice(i, 1);
      F.gem.visible = F.halo.visible = false;
    }
    fx.explosion(p, 2.4);
    this.sound.explosion(p, 1.6);
    if (D) for (let k = 0; k < 10; k++) D.debris.spawn(p.x, p.y, p.z, rand(-14, 14), rand(4, 18), rand(-14, 14), rand(0.5, 1.2), 8, rand(8, 14));
    for (let k = 0; k < 6; k++) {
      // Some of its plates go flying
      const seg = F.t ? F : null;
      if (!seg) break;
      const cell = Math.floor(Math.random() * PER_SEG);
      for (let L = 0; L < 3; L++) if (seg.hp[L * PER_SEG + cell] > 0) { seg.hp[L * PER_SEG + cell] = 0; this.breakTile(seg, L, cell); break; }
    }
    this.writeBody();
  }

  finish() {
    this.active = false;
    for (const m of [...this.tiles, this.frame, this.belly, this.collars, ...Object.values(this.legParts)]) m.visible = false;
    this.tipMesh.visible = false;
    for (const seg of this.segs) {
      const i = this.world.targets.indexOf(seg.t);
      if (i >= 0) this.world.targets.splice(i, 1);
    }
  }

  // ---- per frame ---------------------------------------------------------------------------------

  update(dt, ctx) {
    this.updateFrags(dt);
    if (!this.active) return;
    this.time += dt;
    const P = ctx.player, H = this.head;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if ((e.t -= dt) <= 0) { this.events.splice(i, 1); e.fn(); }
    }
    if (!this.active) return;
    let moving = false;
    if (H.state === 'arrive') {
      // Crawling in, slowing as it settles
      this.off = Math.max(0, this.off - CRAWL * clamp(this.off / 30, 0.2, 1) * dt);
      moving = true;
      this.layout();
      if (Math.random() < dt * 2) this.sound.crash(this.segs[Math.floor(Math.random() * SEGS)].c, 0.5);
      if (this.off <= 0) { H.state = 'perched'; this.sound.millipedeRoar(H.pos); }
    }
    if (H.state !== 'gone') this.updateHead(dt, P);
    const attached = H.state === 'arrive' || H.state === 'perched' || H.state === 'ignite';
    this.writeNeck(attached);
    this.updateLegs(dt, moving);
    this.renderLegs();
    this.renderHead();
    // Gems turn and pulse; struck plates fade back
    this.gemMat.uniforms.uTime.value = this.time;
    for (const seg of this.segs) {
      if (seg.flashing) {
        for (let j = 0; j < seg.flash.length; j++) seg.flash[j] = Math.max(0, seg.flash[j] - dt * 6);
        this.recolor(seg);
      }
      if (seg.dead) continue;
      seg.coreFlash = Math.max(0, seg.coreFlash - dt * 4);
      seg.spin = (seg.spin || 0) + dt * 0.8;
      _q2.setFromEuler(_eu.set(Math.sin(this.time * 0.6 + seg.i) * 0.3, seg.spin, 0));
      seg.gem.quaternion.setFromRotationMatrix(_m.extractRotation(seg.M)).multiply(_q2);
      seg.gem.scale.setScalar(1 + seg.coreFlash * 0.25 + 0.04 * Math.sin(this.time * 3 + seg.i));
      seg.halo.material.color.setHSL((this.time * 0.15 + seg.i * 0.1) % 1, 1, 0.55);
      seg.halo.scale.setScalar(10 + 2 * Math.sin(this.time * 2.3 + seg.i) + seg.coreFlash * 6);
    }
  }

  renderHead() {
    const H = this.head, t = this.time;
    if (H.state === 'gone' || H.state === 'off') return;
    for (const piv of H.mands) {
      const sd = piv.userData.sd, open = 0.15 + 0.5 * H.bite + 0.05 * Math.sin(t * 2);
      piv.rotation.y = sd * open;
    }
    H.ants.forEach((links) => links.forEach((piv, k) => {
      const sd = piv.userData.sd;
      piv.rotation.x = (k === 0 ? 0.75 : 0.18) + Math.sin(t * 2.1 + k * 0.7 + sd) * 0.08 * (k + 1) * 0.5;
      piv.rotation.z = k === 0 ? -sd * 0.55 : -sd * 0.04 + Math.sin(t * 1.7 + k) * 0.05;
    }));
    const k = H.laser.phase === 'idle' ? 1 + H.flash * 2 : H.glows[0].scale.x / 4;
    for (const s of H.glows) {
      s.scale.setScalar(4 * k * (0.9 + 0.1 * Math.sin(t * 9)));
      s.material.opacity = H.state === 'ram' || H.state === 'rise' ? 0.5 + 0.5 * Math.random() : 1;
    }
  }

  updateFrags(dt) {
    const counts = [0, 0, 0];
    for (let i = this.frags.length - 1; i >= 0; i--) {
      const f = this.frags[i];
      f.life -= dt;
      if (f.life <= 0) { this.frags.splice(i, 1); continue; }
      if (!f.rest) {
        f.vel.y -= 30 * dt;
        f.pos.addScaledVector(f.vel, dt);
        f.q.premultiply(_q.setFromAxisAngle(f.axis, f.w * dt));
        const ground = this.world.groundHeight(f.pos.x, f.pos.z, f.pos.y + 1, 0.5);
        if (f.pos.y < ground + 0.4) {
          f.pos.y = ground + 0.4;
          if (f.vel.y < -6) {
            f.vel.y *= -0.3; f.vel.x *= 0.5; f.vel.z *= 0.5; f.w *= 0.5;
            if (Math.random() < 0.4) this.sound.metalHit(f.pos, 0.4);
          } else f.rest = true;
        }
      }
      const s = Math.min(1, f.life / 1.2);
      _m.compose(f.pos, f.q, _s.setScalar(s)).multiply(this.fragOff[f.k]);
      this.fragMesh[f.k].setMatrixAt(counts[f.k]++, _m);
    }
    for (let k = 0; k < 3; k++) {
      this.fragMesh[k].count = counts[k];
      this.fragMesh[k].instanceMatrix.needsUpdate = true;
    }
  }

  // ---- the mech against its body ------------------------------------------------------------------

  /** Push a standing mech (feet at pos, given height) out of the sections' bodies, sideways */
  pushOut(pos, r, height) {
    if (!this.active) return false;
    let hit = false;
    for (const F of [...this.segs, this.tip]) {
      if (F.gone) continue;
      for (const y of [1, height * 0.5, height - 0.5]) {
        _a.set(pos.x, pos.y + y, pos.z);
        _b.subVectors(_a, F.a);
        _c.subVectors(F.b, F.a);
        const u = clamp(_b.dot(_c) / _c.lengthSq(), 0, 1);
        _d.copy(F.a).addScaledVector(_c, u);
        _e.subVectors(_a, _d);
        const d = _e.length(), R = R_OUT + r;
        if (d >= R) continue;
        _e.setY(0);
        if (_e.lengthSq() < 1e-6) _e.copy(F.right);
        _e.normalize().multiplyScalar(R - d);
        pos.x += _e.x;
        pos.z += _e.z;
        hit = true;
      }
    }
    return hit;
  }
}
