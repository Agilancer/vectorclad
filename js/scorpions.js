import * as THREE from './three.js';
import {
  plateGeo, hullGeo, jointGeo, plateMatrix, paletteMaterial, paletteMesh, paintInstances,
  mirrorLegs, solveLeg, capsuleDist, markerTexture,
} from './frameParts.js';

// ---------------------------------------------------------------------------
// Scorpion-frames: eight-legged ground hunters that fight up close.
//
// They are built from the same atlas, palette swap and surface crawling as the
// spider-frames (js/spiders.js runs them in the same swarm and waves), with a
// body plan of their own:
//   - A flat carapace and a long segmented body, eight legs stepping in
//     alternating tetrapods, a pair of pincers on two-bone arms, and a
//     five-segment tail ending in a venom bulb and a curved stinger.
//   - The tail is posed with planar CCD: each joint only curls forward, so it
//     arches over the back at rest, cocks back to wind up, and whips over the
//     head onto its target when it stings.
//   - Pincers open as they wind up and snap shut as they strike. Every hit is
//     tested against where the rendered pincer or stinger tip actually is, so
//     a dash during the wind-up dodges it.
//
// The weakness: a scorpion can only climb about 100 ft up a wall. Past that its
// grip gives out and it slips back down, so a mech on a high roof (or high in
// the air) is out of reach of everything but a few ranged kinds. Scorpions
// never leap; they drop in through summoning portals (js/summons.js), and
// Burrowers dig under the street from there.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const ease = (t) => t * t * (3 - 2 * t);

const SCAP = 128;             // most scorpions alive at once (room for every kind the summon menu can call at full count)
const CLIMB_FT = 100;         // how far up a wall they can climb
const FT = 0.3048;

// ---------------------------------------------------------------------------
// Variants. Each kind has its own palette and one thing that sets it apart:
//   burrow: tunnels under the street (and buildings) and bursts up under the mech
//   stealth: runs dark, can't be locked on, circles round to strike from behind
//   rage: below this share of its armor it goes berserk
//   grab: seconds a pincer hit pins the mech; dmg scales all its hits
//   shock: boost a sting drains; zap: arcs lightning from its tail at range
//   flame: sprays fire from its tail and leaves the street burning
//   venom: seconds of armor corrosion a sting injects; spit: lobs venom globs at range
// Palettes as for spiders; neon makes the paint itself glow.
// ---------------------------------------------------------------------------
export const SCORPIONS = {
  burrower: {
    name: 'BURROWER', size: [1.0, 1.2], hp: 32, speed: 1.15, legs: 1, burrow: true,
    palette: { tint: [1.75, 1.3, 0.8], lift: 0.26, accent: [0.66, 0.38, 0.12], glow: [1, 0.6, 0.16] },
  },
  prowler: {
    name: 'PROWLER', size: [0.95, 1.1], hp: 26, speed: 1.3, legs: 1.08, stealth: true,
    palette: { tint: [0.3, 0.3, 0.34], lift: 0, accent: [0.16, 0.15, 0.18], glow: [0.95, 0.15, 0.25] },
  },
  berserker: {
    name: 'BERSERKER', size: [1.15, 1.35], hp: 46, speed: 1.05, legs: 1, rage: 0.5,
    palette: { tint: [1.0, 0.42, 0.4], lift: 0.04, accent: [0.5, 0.02, 0.03], glow: [1, 0.12, 0.05] },
  },
  emperor: {
    name: 'EMPEROR', size: [2.0, 2.25], hp: 160, speed: 0.72, legs: 1, elite: true, grab: 1.8, dmg: 1.5,
    palette: { tint: [0.82, 0.55, 1.4], lift: 0.06, accent: [1, 0.72, 0.18], glow: [0.85, 0.3, 1] },
  },
  shocktail: {
    name: 'SHOCKTAIL', size: [1.05, 1.25], hp: 34, speed: 0.95, legs: 1, shock: 45, zap: true,
    palette: { tint: [0.45, 0.5, 0.62], lift: 0, accent: [0.1, 0.6, 1.6], neon: 1.1, glow: [0.25, 0.75, 1.8] },
  },
  scorcher: {
    name: 'SCORCHER', size: [1.1, 1.3], hp: 38, speed: 0.9, legs: 1, flame: true,
    palette: { tint: [0.5, 0.47, 0.46], lift: 0, accent: [1.2, 0.5, 0.03], neon: 1.1, glow: [1.8, 0.6, 0.05] },
  },
  venomtail: {
    name: 'VENOMTAIL', size: [1.0, 1.2], hp: 30, speed: 1.0, legs: 1, venom: 6, spit: true,
    palette: { tint: [0.42, 0.5, 0.42], lift: 0, accent: [0.4, 1.3, 0.05], neon: 1.1, glow: [0.5, 1.8, 0.1] },
  },
};
for (const id in SCORPIONS) Object.assign(SCORPIONS[id], { id, scorpion: true });

// Attacks: wind-up (the telegraph), strike, recover, in seconds; claw and sting damage before the mech's hit scale
const ACTS = {
  claw: { windup: 0.3, strike: 0.14, recover: 0.3, dmg: 8 },
  sting: { windup: 0.55, strike: 0.16, recover: 0.5, dmg: 20 },
  spit: { windup: 0.4, strike: 0.3, recover: 0.4 },
  zap: { windup: 0.15, strike: 1.3, recover: 0.35 },   // the laser times its own charge inside the strike
  flame: { windup: 0.45, strike: 1.7, recover: 0.45 },
};
const VENOM_GLOB = { dmg: 5, size: 1.25, color: [0.9, 3.2, 0.3], trail: [0.5, 2.2, 0.15], hit: 0x8cff3a, venom: 2.5, gravity: 18 };
const ZAP = { charge: 0.8, lock: 0.62, dmg: 11, width: 0.32, glow: 1.4, dur: 0.3, line: 0x3a9cff, beam: 0xbfe8ff, halo: 0x2a70ff, zap: true, shock: 25 };
const FLAME_RANGE = 26;
const STING_HEIGHTS = [3.8, 5.4, 2.6];   // where on the mech a sting can land, above its feet

// ---------------------------------------------------------------------------
// Body plan, in body units: x right, y up, z forward, origin at the body center
// ---------------------------------------------------------------------------

const EYE = new V3(0, 0.5, 1.3);
const HEAD = 1.8, TAIL_END = 2.35;   // how far the front of the carapace and the back of the body are from the center
const BODY_MID = new V3(0, 0.35, -0.4);
const EYES_BIG = [[-0.12, 0.47, 1.24], [0.12, 0.47, 1.24]];
const EYES_SMALL = [[-0.5, 0.3, 1.58], [0.5, 0.3, 1.58], [-0.42, 0.33, 1.68], [0.42, 0.33, 1.68]];

// Eight legs along the carapace in alternating tetrapods (L0 R1 L2 R3 / R0 L1 R2 L3), knees thrown wide.
// Every scorpion is drawn twice the size its variant lists.
const SCORPION_RIG = {
  scale: 2, bodyH: 0.8, lift: 0.42, knee: 1.5, eye: EYE, femur: 1.45, tibia: 1.75,
  legs: mirrorLegs([
    { hip: [0.6, -0.04, 1.05], rest: [2.55, 2.0] },
    { hip: [0.72, -0.04, 0.62], rest: [3.0, 0.75] },
    { hip: [0.74, -0.04, 0.2], rest: [3.05, -0.5] },
    { hip: [0.66, -0.04, -0.22], rest: [2.75, -1.75] },
  ]),
};

// Tail: five segments from the back of the body, then the venom bulb and the stinger, bent by a fixed amount.
// Angles: the first segment's angle up from straight back, then how much each joint curls it forward.
const TAIL_BASE = new V3(0, 0.45, -2.35);
const TAIL_LEN = [0.72, 0.74, 0.78, 0.82, 0.9];
const TAIL_W = [0.42, 0.4, 0.39, 0.38, 0.4];
const TAIL_LIM = [[0.55, 2.4], [0.05, 0.95], [0.05, 0.95], [0.05, 0.95], [0.05, 0.95]];
const TAIL_REST = [1.3, 0.45, 0.45, 0.45, 0.4];
const TAIL_COCK = [1.1, 0.62, 0.62, 0.58, 0.52];   // wound back before a sting
const TAIL_RAISE = [1.55, 0.32, 0.3, 0.28, 0.25];  // reared up to spit, arc or spray
const BULB = 0.8, STINGER = 0.95, BULB_BEND = 0.4, STINGER_BEND = 0.7;

// Pincers: shoulder (right side), two-bone arm, then the claw's hand and fingers
const SHOULDER = [0.42, 0.02, 1.5];
const ARM = 1.2, FOREARM = 1.1, MANUS = 1.05, FINGER = 1.15;
const WRIST_REST = [0.95, -0.2, 2.75];

const UP = new V3(0, 1, 0), DOWN = new V3(0, -1, 0), FWD = new V3(0, 0, 1);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _g = new V3(), _h = new V3(), _q = new V3();
const _f = new V3(), _u = new V3(), _w = new V3(), _t = new V3();
const _p0 = new V3(), _p1 = new V3(), _dir = new V3(), _dor = new V3(), _tn = new V3(), _ty = new V3();
const _elbow = new V3(), _wrist = new V3(), _pole = new V3(), _axis = new V3(), _mr = new V3(), _mu = new V3(), _in = new V3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _col = new THREE.Color();
const CH = new Float32Array(16);   // tail chain scratch: joint points (U, V) then the bulb's end and the stinger tip

/** Lay out the tail in its plane (U forward, V up, from the base); returns the stinger's absolute angle */
function tailChain(ang, out) {
  let u = 0, v = 0, phi = 0;
  for (let i = 0; i < 5; i++) {
    out[i * 2] = u; out[i * 2 + 1] = v;
    phi = i ? phi + ang[i] : ang[0];
    u -= Math.cos(phi) * TAIL_LEN[i]; v += Math.sin(phi) * TAIL_LEN[i];
  }
  out[10] = u; out[11] = v;
  phi += BULB_BEND; u -= Math.cos(phi) * BULB; v += Math.sin(phi) * BULB;
  out[12] = u; out[13] = v;
  phi += STINGER_BEND; u -= Math.cos(phi) * STINGER; v += Math.sin(phi) * STINGER;
  out[14] = u; out[15] = v;
  return phi;
}

/** CCD: curl the tail joints so the stinger tip reaches (U, V). Returns how far short it ends. */
function reachTail(ang, U, V, iters = 6) {
  for (let it = 0; it < iters; it++) {
    for (let j = 4; j >= 0; j--) {
      tailChain(ang, CH);
      const ju = CH[j * 2], jv = CH[j * 2 + 1];
      const now = Math.atan2(CH[15] - jv, -(CH[14] - ju)), want = Math.atan2(V - jv, -(U - ju));
      ang[j] = clamp(ang[j] + wrap(want - now), TAIL_LIM[j][0], TAIL_LIM[j][1]);
    }
  }
  tailChain(ang, CH);
  return Math.hypot(CH[14] - U, CH[15] - V);
}

// Instance layout per scorpion, by part
const N_LEGS = 8;
const FEMUR_ARM = 16, TIBIA_ARM = 16, TIBIA_FINGER = 20, TIBIA_STING = 28;
const JOINT_TAIL = 16, JOINT_ARM = 21;

// Lightning: camera-facing ribbons, one instance per segment. Width rides in the matrix's x column.
const ZAP_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vCol;
void main() {
  vUv = uv; vCol = instanceColor;
  mat4 m = modelMatrix * instanceMatrix;
  vec3 base = (m * vec4(0.0, position.y, 0.0, 1.0)).xyz;
  vec3 axis = normalize((m * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 side = cross(axis, cameraPosition - base);
  float L = length(side);
  side = L > 1e-5 ? side / L : vec3(1.0, 0.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(base + side * position.x * length(instanceMatrix[0].xyz), 1.0);
}`;
const ZAP_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vCol;
void main() {
  float d = abs(vUv.x - 0.5) * 2.0;
  float glow = pow(1.0 - d, 2.0);
  float core = smoothstep(0.4, 0.0, d);
  gl_FragColor = vec4(vCol * glow * 1.6 + vec3(0.85, 0.95, 1.0) * core * min(1.0, length(vCol)), 1.0);
}`;
const ZAP_CAP = 160;

// ---------------------------------------------------------------------------
// The nest: scorpion models, AI and abilities, run by the swarm
// ---------------------------------------------------------------------------

export class ScorpionNest {
  constructor(swarm, { scene, tex, glowTex }) {
    this.sw = swarm;
    this.free = [];
    for (let i = SCAP - 1; i >= 0; i--) this.free.push(i);
    this.slots = new Array(SCAP).fill(null);
    this.top = 0;
    // 100 ft in game units (the world is laid out in meters)
    this.climb = CLIMB_FT * FT * swarm.world.M;
    this.patches = [];
    this.burnT = 0;
    this.shockT = 0;

    // Parts, palette-swapped per scorpion. Hulls are unit spheres stretched per instance.
    const mat = paletteMaterial(tex.spider, tex.spiderGlow);
    const part = (geo, per) => {
      const m = paletteMesh(scene, geo, mat, SCAP * per);
      m.per = per;
      m.count = 0;
      return m;
    };
    this.parts = {
      hullT: part(hullGeo('thorax'), 3),     // carapace, both claw hands
      hullA: part(hullGeo('abdomen'), 6),    // body, five tail segments
      bulb: part(hullGeo('joint'), 1),       // venom bulb, glowing
      thorax: part(plateGeo('thorax'), 1),   // carapace plate
      face: part(plateGeo('face'), 1),
      spine: part(plateGeo('spine'), 6),     // back crest, tail keels
      fang: part(plateGeo('fangL'), 2),      // mouth pincers
      femur: part(plateGeo('femur'), 20),    // legs (crossed pairs), upper arms
      tibia: part(plateGeo('tibia'), 30),    // legs, forearms, claw fingers, stinger
      joint: part(jointGeo(), 27),           // hips and knees, tail joints, shoulders, elbows, wrists
    };

    // Eyes: two on top, four on the front corners
    const eyes = (count, size) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SCAP * count * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SCAP * count * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(SCAP * count).fill(1), 1));
      g.setDrawRange(0, 0);
      const pm = new THREE.PointsMaterial({
        map: glowTex, size, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      });
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
    this.eyesBig = eyes(2, 2.2);
    this.eyesSmall = eyes(4, 1.2);

    // Lightning ribbons
    this.zapMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1, 1, 1).translate(0, 0.5, 0), new THREE.ShaderMaterial({
      vertexShader: ZAP_VERT, fragmentShader: ZAP_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }), ZAP_CAP);
    this.zapMesh.setColorAt(0, _col.setRGB(1, 1, 1));
    this.zapMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.zapMesh.frustumCulled = false;
    this.zapMesh.renderOrder = 6;
    this.zapMesh.count = 0;
    this.zaps = 0;
    scene.add(this.zapMesh);

    // Warning rings where a burrower will burst out of the street
    const ringMat = new THREE.MeshBasicMaterial({
      map: markerTexture(), color: new THREE.Color(2.2, 1.05, 0.3), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(ringGeo, ringMat.clone());
      r.visible = false;
      r.renderOrder = 3;
      r.frustumCulled = false;
      scene.add(r);
      this.rings.push(r);
    }
  }

  clear() {
    this.patches.length = 0;
    this.shockT = 0;
    for (const r of this.rings) r.visible = false;
  }

  // ---- spawning ------------------------------------------------------------------------

  /** Open street near center, between rMin and rMax away, with `room` clear around it for the body */
  findGround(center, rMin, rMax, avoidView, tries = 20, room = 3.5) {
    const B = this.sw.world.bounds;
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, d = rand(rMin, rMax);
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      if (x < B.minX + 6 || x > B.maxX - 6 || z < B.minZ + 6 || z > B.maxZ - 6) continue;
      const hit = this.groundAt(x, z);
      if (!hit || (avoidView && avoidView(hit.point))) continue;
      let open = true;
      for (let k = 0; k < 4 && open; k++) {
        _d.set(Math.cos(k * Math.PI / 2), 0, Math.sin(k * Math.PI / 2));
        if (this.sw.ray(_c.copy(hit.point).setY(hit.point.y + 1.2), _d, room)) open = false;
      }
      if (open) return hit;
    }
    return null;
  }

  /** The street or sidewalk at (x, z), or null if a building, car or roof is there */
  groundAt(x, z) {
    const hit = this.sw.ray(_a.set(x, 60, z), DOWN, 80);
    if (!hit || hit.normal.y < 0.9 || hit.point.y > 1.2 || (hit.collider && !hit.collider.low)) return null;
    return { point: hit.point.clone(), normal: new V3(0, 1, 0), collider: hit.collider };
  }

  /** A scorpion of kind id digging out of the street at spot, or with drop, falling from it (out of a summoning portal) */
  spawn(spot, id, drop = null) {
    if (!this.free.length) return null;
    const sw = this.sw, v = SCORPIONS[id];
    const s = sw.makeFrame(spot, v, this.free.pop(), SCORPION_RIG);
    Object.assign(s, {
      kind: 'scorpion', nest: this, radius: 2.4 * s.scale,
      timer: 1.3, emergeT: 1.3, dig: 1, hidden: false, stealth: false,
      cool: { claw: rand(0.4, 1), sting: rand(1, 2.5), burrow: rand(0.5, 2), spit: rand(1.5, 3), zap: rand(2, 4), flame: rand(1.5, 3) },
      tail: [...TAIL_REST], tailYaw: 0, wrist: [new V3(-WRIST_REST[0], WRIST_REST[1], WRIST_REST[2]), new V3(...WRIST_REST)], open: [0.15, 0.15],
      hand: [new V3(0.12, -0.12, 1).normalize(), new V3(-0.12, -0.12, 1).normalize()],
      tailAct: null, clawAct: null, side: 1, stingY: STING_HEIGHTS[0], lunge: 0, slip: 0, gripT: 0, revealT: 0, rage: false, grip: null, menace: false,
      tip: new V3(), clawTip: [new V3(), new V3()], B: null, tintK: rand(0.92, 1.08),
    });
    // Face the mech as it comes up
    if (sw.P) {
      _a.subVectors(sw.P.pos, s.p).setY(0);
      if (_a.lengthSq() > 1) s.f.copy(_a.normalize());
    }
    this.slots[s.slot] = s;
    this.resize();
    sw.list.push(s);
    sw.world.targets.push(s);
    this.paint(s);
    if (drop) {
      sw.drop(s, drop);
      s.dig = 0;
      s.timer = 0;
    } else sw.fx.scorch(spot.point.x, spot.point.z, 3.2 * s.scale, spot.point.y + 0.03);
    return s;
  }

  /** How far a scorpion of kind id reaches from its middle, claws to tail, in world units */
  reach(id) {
    return SCORPIONS[id].size[1] * SCORPION_RIG.scale * 4.2;
  }

  /** Called by the swarm when a scorpion leaves for good */
  release(s) {
    this.letGo(s);
    if (s.ring) s.ring.visible = false;
    this.hide(s);
    this.slots[s.slot] = null;
    this.free.push(s.slot);
    this.resize();
  }

  /** Only draw instances up to the highest slot in use */
  resize() {
    let top = 0;
    this.slots.forEach((s, i) => { if (s) top = i + 1; });
    this.top = top;
    for (const key in this.parts) this.parts[key].count = top * this.parts[key].per;
    for (const pts of [this.eyesBig, this.eyesSmall]) pts.geometry.setDrawRange(0, top * pts.per);
  }

  hide(s) {
    _m.makeScale(0, 0, 0);
    for (const key in this.parts) {
      const mesh = this.parts[key];
      for (let k = 0; k < mesh.per; k++) mesh.setMatrixAt(s.slot * mesh.per + k, _m);
    }
    for (const pts of [this.eyesBig, this.eyesSmall]) {
      const c = pts.geometry.attributes.color;
      for (let k = 0; k < pts.per; k++) c.setXYZ(s.slot * pts.per + k, 0, 0, 0);
    }
  }

  /** Palette into the scorpion's instances; its glow dims while running dark and flares in a rage */
  paint(s) {
    const pal = s.v.palette, tint = pal.tint.map((x) => x * s.tintK);
    const glowK = s.stealth ? 0.05 : s.rage ? 2.2 : 1;
    for (const key in this.parts) {
      const mesh = this.parts[key];
      paintInstances(mesh, s.slot * mesh.per, mesh.per, pal, tint, glowK);
    }
    for (const pts of [this.eyesBig, this.eyesSmall]) {
      const a = pts.geometry.attributes.aSize;
      for (let i = 0; i < pts.per; i++) a.setX(s.slot * pts.per + i, s.scale / 1.2);
      a.needsUpdate = true;
    }
  }

  // ---- damage hooks -------------------------------------------------------------------

  /** The scorpion took a hit and lived */
  hurt(s, amount) {
    const v = s.v;
    if (v.stealth) this.reveal(s, 2);
    // A heavy hit staggers an Emperor into letting go
    if (s.grip && amount >= 30) this.letGo(s);
    if (v.rage && !s.rage && s.hp < s.maxHp * v.rage) {
      s.rage = true;
      s.speed *= 1.5;
      this.paint(s);
      this.sw.sound.scorpionRage(s.c);
      this.sw.fx.sparksBurst(s.c, s.ns, 24, 0xff3010, 22);
    }
  }

  died(s) {
    this.letGo(s);
    if (s.ring) s.ring.visible = false;
    s.tailAct = s.clawAct = null;
  }

  // ---- per-frame -------------------------------------------------------------------------

  think(s, dt, P) {
    const sw = this.sw;
    s.revealT -= dt;
    switch (s.state) {
      case 'emerge': // digging up out of the street
        s.timer -= dt;
        s.dig = ease(clamp(s.timer / s.emergeT, 0, 1));
        if (Math.random() < dt * 24) this.debris(s.p, s.scale, 2);
        if (s.timer <= 0) {
          s.state = 'crawl';
          s.dig = 0;
          s.goal = null;
          sw.sound.scorpionHiss(s.c);
        }
        break;
      case 'burrow': // digging down into it
        s.timer -= dt;
        s.dig = ease(clamp(1 - s.timer / 0.7, 0, 1));
        if (Math.random() < dt * 24) this.debris(s.p, s.scale, 2);
        if (s.timer <= 0) this.goUnder(s);
        break;
      case 'tunnel': this.tunnel(s, dt, P); break;
      case 'perch': // a fall can land it on a perch; scorpions just keep hunting
        s.state = 'crawl';
      // falls through
      case 'crawl': this.hunt(s, dt, P); this.spread(s, dt); break;
      case 'jump': case 'fall': sw.flight(s, dt); break;
    }
    if (s.removed || s.state === 'dead') return;
    if (s.tailAct) s.tailAct = this.stepAct(s, s.tailAct, dt, P);
    if (s.clawAct) s.clawAct = this.stepAct(s, s.clawAct, dt, P);
    // Prowlers run dark unless striking or just hit
    if (s.v.stealth) {
      const dark = !s.tailAct && !s.clawAct && s.revealT <= 0 && s.state !== 'emerge';
      if (dark !== s.stealth) { s.stealth = dark; this.paint(s); }
    }
    if (s.rage && Math.random() < dt * 10) {
      // Berserkers vent red steam from their joints
      const o = this.sw.bodyPoint(s, _a.set(rand(-0.6, 0.6), 0.5, rand(-1.5, 0.8)), _a);
      sw.fx.smoke.emit(o.x, o.y, o.z, rand(-1, 1), rand(2, 4), rand(-1, 1), rand(0.5, 0.9), 0.5 * s.scale, 2 * s.scale, 0.7, 0.12, 0.08, 0.5, 0.4, 0.3, 0.3, 0, 1, 0.5);
    }
    this.pose(s, dt, P);
  }

  // ---- AI ---------------------------------------------------------------------------------

  hunt(s, dt, P) {
    const v = s.v, sc = s.scale;
    const onGround = !s.support || s.support.low || s.p.y < 1;
    // Out of reach: up a tower past the climb limit, or high in the air
    const high = P.pos.y > this.climb - 0.5;
    const flat = Math.hypot(P.pos.x - s.c.x, P.pos.z - s.c.z);
    // Distance from the body to the mech's capsule
    const near = capsuleDist(s.c, P.pos);
    s.menace = P.alive && high && flat < 45;

    // Slipping back down a wall it can't climb any higher
    if (s.slip > 0) { this.slide(s, dt); return; }
    if (s.tailAct || s.clawAct) {
      if (!(s.clawAct && s.clawAct.phase === 'hold')) this.face(s, P.chest, dt);
      // An Emperor reels itself in on what it holds, and stings it
      if (s.grip && !s.tailAct) {
        if (s.cool.sting <= 0.4 && this.canSting(s, P)) s.tailAct = this.act(s, 'sting');
        else if (near > 1.9 + 1.8 * sc) this.move(s, dt, P.pos, 0.6);
      }
      return;
    }
    if (!P.alive) return;

    // Abilities that open the fight from range
    if (v.burrow && onGround && P.pos.y < 1.5 && s.cool.burrow <= 0 && flat > 30 && flat < 150) { this.burrow(s); return; }
    if (s.see && s.seeT > 0.4 && this.ranged(s, P, flat, high)) return;

    // Strike when in reach: the stinger first, else a pincer (the reach tests only run when it's close)
    const close = near < 1.9 + 7 * sc;
    if (close && s.cool.sting <= 0 && this.canSting(s, P)) { s.tailAct = this.act(s, 'sting'); return; }
    if (close && s.cool.claw <= 0) {
      for (const side of [s.side, -s.side]) {
        if (!this.canClaw(s, P, side)) continue;
        s.clawAct = this.act(s, 'claw', side);
        s.side = -side;
        return;
      }
    }

    // Close in: rush the mech (Prowlers swing round behind it), climbing as high as it can after one out of reach
    const stand = 1.9 + 2 * sc;
    if (!high && near < stand) { this.face(s, P.chest, dt); return; }
    const goal = v.stealth && !high ? this.flank(s, P) : P.pos;
    this.move(s, dt, goal, flat < 30 ? 1.15 : 1);
  }

  /**
   * Scorpions on the same surface shoulder each other aside instead of piling into one spot.
   * On a wall they spread out sideways, lining up along the height they can't climb past.
   */
  spread(s, dt) {
    if (s.state !== 'crawl') return;
    const wall = Math.abs(s.n.y) < 0.5;
    for (const o of this.slots) {
      if (!o || o === s || o.state !== 'crawl' || o.n.dot(s.n) < 0.9) continue;
      _a.subVectors(s.p, o.p);
      _a.addScaledVector(s.n, -_a.dot(s.n));
      if (wall) _a.y = 0;
      const d = _a.length(), min = (s.radius + o.radius) * 0.62;
      if (d >= min || d < 1e-3) continue;
      const push = Math.min(min - d, 6 * dt) * (o.scale / (s.scale + o.scale)) * 2;
      _a.divideScalar(d);
      _b.copy(s.p).addScaledVector(s.n, 0.5);
      if (this.sw.ray(_b, _a, push + 1.5)) continue;
      // On a wall, only if there's still wall under it a body's width further on
      if (wall && !this.sw.ray(_b.addScaledVector(_a, push + 1.5 * s.scale), _c.copy(s.n).negate(), 2)) continue;
      s.p.addScaledVector(_a, push);
    }
    if (wall) this.holdBelow(s);
  }

  /** Crawl toward goal along whatever it's on: up walls, over low roofs, down to the street */
  move(s, dt, goal, k = 1) {
    const sw = this.sw;
    const wall = Math.abs(s.n.y) < 0.5;
    _a.subVectors(goal, s.p);
    const dist = _a.length();
    // Heading down a wall to a goal below: straight down first
    if (wall && goal.y < s.p.y - 2) _a.set(_a.x * 0.15, -40, _a.z * 0.15);
    _a.addScaledVector(s.n, -_a.dot(s.n));
    // A goal mostly straight through a wall is on another face: go up or down to get round
    if (_a.length() < dist * 0.3 && wall) _a.set(0, goal.y > s.p.y - 3 ? 1 : -1, 0).addScaledVector(s.n, -s.n.y);
    // The weakness: no grip past the climb limit. Crawl along the wall instead, or scrabble at it.
    if (wall && this.over(s) > -0.6 && _a.y > 0) {
      const up = _a.y;
      _a.y = 0;
      if (_a.length() < up * 0.5) { this.scrabble(s, dt); return; }
    } else s.gripT = 0;
    if (_a.lengthSq() < 1e-6) return;
    sw.turn(s, _a.normalize(), 5, dt);
    const speed = s.speed * s.scale * k;
    sw.crawl(s, speed * dt);
    if (Math.abs(s.n.y) < 0.5) this.holdBelow(s);
    s.moveVel.copy(s.f).multiplyScalar(speed);
  }

  /** How far the top of a scorpion on a wall (its head climbing, its tail end descending) is past the climb limit */
  over(s) {
    return s.p.y + s.scale * Math.max(s.f.y * HEAD, -s.f.y * TAIL_END) - this.climb;
  }

  holdBelow(s) {
    const o = this.over(s);
    if (o > 0) s.p.y -= o;
  }

  face(s, target, dt) {
    _a.subVectors(target, s.p);
    _a.addScaledVector(s.n, -_a.dot(s.n));
    if (_a.lengthSq() > 0.25) this.sw.turn(s, _a.normalize(), 6, dt);
  }

  /** At the climb limit: claws scrape at the wall, then its grip gives and it slips back down */
  scrabble(s, dt) {
    s.gripT += dt;
    if (Math.random() < dt * 8) this.scrape(s);
    if (s.gripT > 0.9) {
      s.gripT = rand(-0.4, 0);
      s.slip = rand(0.35, 0.55);
      this.sw.sound.scrape(s.c);
    }
  }

  slide(s, dt) {
    s.slip -= dt;
    if (Math.abs(s.n.y) < 0.5) {
      s.p.y = Math.max(0.5, s.p.y - 7 * dt);
      s.moveVel.set(0, -7, 0);
    }
    if (Math.random() < dt * 20) this.scrape(s);
  }

  scrape(s) {
    const f = s.feet[Math.floor(Math.random() * 2) * 4 + Math.floor(Math.random() * 2)];
    this.sw.fx.sparksBurst(f.pos, s.n, 4, 0xffc070, 14);
  }

  /** Where a Prowler heads: wide round the mech's flank, then in from behind where its shield can't turn the strike */
  flank(s, P) {
    const fy = P.bodyYaw;
    _f.set(Math.sin(fy), 0, Math.cos(fy));
    _w.set(Math.cos(fy), 0, -Math.sin(fy));
    _a.subVectors(s.c, P.pos).setY(0);
    const d = _a.length() || 1;
    const side = Math.sign(_a.dot(_w)) || 1;
    if (_a.dot(_f) > -0.4 * d) return _g.copy(P.pos).addScaledVector(_f, -6).addScaledVector(_w, side * 10);
    return _g.copy(P.pos).addScaledVector(_f, -3);
  }

  behind(s, P) {
    _a.subVectors(s.c, P.pos).setY(0).normalize();
    return _a.x * Math.sin(P.bodyYaw) + _a.z * Math.cos(P.bodyYaw) < -0.35;
  }

  /** Ranged openers: venom spit, tail lightning, flame. Returns true if one started. */
  ranged(s, P, flat, high) {
    const v = s.v, sw = this.sw;
    if (v.spit && s.cool.spit <= 0 && (high || flat > 16) && flat < 90 && sw.bolts.length < 220) {
      s.tailAct = this.act(s, 'spit');
      s.cool.spit = rand(3.5, 5);
      return true;
    }
    if (v.zap && s.cool.zap <= 0 && !s.laser && (high || flat > 16) && flat < 110 && sw.lasers.length < 8) {
      s.tailAct = this.act(s, 'zap');
      s.cool.zap = rand(4.5, 6.5);
      return true;
    }
    if (v.flame && s.cool.flame <= 0 && s.tip.distanceTo(P.chest) < FLAME_RANGE - 4) {
      s.tailAct = this.act(s, 'flame');
      s.cool.flame = rand(4.5, 6.5);
      return true;
    }
    return false;
  }

  // ---- reach ----------------------------------------------------------------------------

  /** World point into the rendered body's frame, in body units */
  toLocal(s, w, out) {
    const B = s.B;
    _t.subVectors(w, B.c);
    return out.set(_t.dot(B.r), _t.dot(B.u), _t.dot(B.f)).divideScalar(s.scale);
  }

  /**
   * Where the stinger aims: a point on the front of the mech's armor at height y above its feet.
   * Sets U, V (from the tail's base) and yaw of the tail plane.
   */
  stingAim(s, P, out, y = s.stingY) {
    _a.subVectors(s.c, P.pos).setY(0).normalize();
    _b.set(P.pos.x, P.pos.y + y, P.pos.z).addScaledVector(_a, 1.4);
    const L = this.toLocal(s, _b, _c);
    const yaw = clamp(Math.atan2(L.x, L.z - TAIL_BASE.z), -0.7, 0.7);
    out.yaw = yaw;
    out.U = L.x * Math.sin(yaw) + (L.z - TAIL_BASE.z) * Math.cos(yaw);
    out.V = L.y - TAIL_BASE.y;
    return out;
  }

  /** Can the stinger reach the mech's armor at the torso, chest or hips? Picks the height it'll strike at. */
  canSting(s, P) {
    if (!s.B) return false;
    const aim = this._aim || (this._aim = {}), ang = this._ang || (this._ang = [0, 0, 0, 0, 0]);
    for (const y of STING_HEIGHTS) {
      this.stingAim(s, P, aim, y);
      if (aim.U < -1 || aim.V < -1.5) continue;
      for (let i = 0; i < 5; i++) ang[i] = s.tail[i];
      // The lunge carries the stinger about half a body unit further. The tip has to end
      // within the hit radius (2.2) of the mech's axis; the aim point is 1.4 in from it.
      if (reachTail(ang, aim.U - 0.5, aim.V, 8) < 0.7 / s.scale) { s.stingY = y; return true; }
    }
    return false;
  }

  /** Where a pincer reaches for, in body units: the mech's side at shoulder height, pulled onto its armor */
  clawAim(s, P, side, out) {
    _a.set(side * SHOULDER[0], SHOULDER[1], SHOULDER[2]).applyMatrix4(s.bodyM);
    _b.set(P.pos.x, clamp(_a.y, P.pos.y + 1.6, P.pos.y + 6), P.pos.z);
    _c.subVectors(_a, _b).setY(0).normalize();
    _b.addScaledVector(_c, 1.4);
    return this.toLocal(s, _b, out);
  }

  /**
   * Arm pose that puts a pincer's tip on the mech: the hand points halfway between straight ahead
   * and the target, and the wrist sits a hand's length back from the target, folding the arm in when
   * the mech is close. Writes the wrist (body units) and the hand's direction; returns whether the arm
   * reaches, allowing for the lunge.
   */
  clawPose(s, P, side, wrist, hand) {
    const L = this.clawAim(s, P, side, _b);
    _c.set(side * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    hand.subVectors(L, _c).normalize().add(FWD).normalize();
    wrist.copy(L).addScaledVector(hand, -(MANUS + FINGER * 0.65));
    return L.z > SHOULDER[2] - 0.3 && wrist.distanceTo(_c) < ARM + FOREARM + 0.3;
  }

  canClaw(s, P, side) {
    return !!s.B && this.clawPose(s, P, side, _g, _h);
  }

  // ---- attacks ---------------------------------------------------------------------------

  act(s, kind, side = 0) {
    const k = s.rage ? 0.6 : 1;
    if (kind === 'sting') this.sw.sound.stingCharge(s.c, ACTS.sting.windup * k);
    if (kind === 'claw') this.sw.sound.clawOpen(s.c);
    if (s.v.stealth) this.reveal(s, 1.2);
    return { kind, side, phase: 'windup', t: 0, dur: ACTS[kind].windup * (kind === 'claw' || kind === 'sting' ? k : 1), hit: false };
  }

  reveal(s, t) {
    s.revealT = Math.max(s.revealT, t);
    if (s.stealth) { s.stealth = false; this.paint(s); }
  }

  /** Advance an attack; returns it, or null once it's over */
  stepAct(s, a, dt, P) {
    const k = s.rage ? 0.6 : 1, cfg = ACTS[a.kind];
    a.t += dt;
    if (a.phase === 'strike') this.striking(s, a, dt, P);
    if (a.phase === 'hold' && (!this.sw.P || this.sw.P.pinT <= 0 || !s.grip)) a.t = a.dur;
    if (a.t < a.dur) return a;
    a.t = 0;
    if (a.phase === 'windup') {
      a.phase = 'strike';
      a.dur = cfg.strike * (a.kind === 'claw' || a.kind === 'sting' ? k : 1);
      this.strikeStart(s, a, P);
      return a;
    }
    if (a.phase === 'strike' && a.kind === 'claw' && s.grip) { a.phase = 'hold'; a.dur = s.v.grab; return a; }
    if (a.phase === 'strike' || a.phase === 'hold') {
      this.letGo(s);
      a.phase = 'recover';
      a.dur = cfg.recover * k;
      return a;
    }
    // Recovered: the attack's cooldown starts now
    if (a.kind === 'claw') s.cool.claw = rand(0.9, 1.6) * k * (s.v.rage ? 0.8 : 1);
    if (a.kind === 'sting') s.cool.sting = rand(2.6, 4) * k;
    return null;
  }

  strikeStart(s, a, P) {
    const sw = this.sw;
    if (a.kind === 'claw') sw.sound.clawSnap(s.c);
    else if (a.kind === 'sting') sw.sound.stingWhip(s.c);
    else if (a.kind === 'spit') this.spit(s, P);
    else if (a.kind === 'zap') sw.startLaser(s, P, ZAP);
    else if (a.kind === 'flame') a.aim = _a.set(P.pos.x, P.pos.y + 1.5, P.pos.z).addScaledVector(_b.subVectors(s.c, P.pos).setY(0).normalize(), 6).clone();
  }

  /** Every frame of a strike: the hit lands the moment the pincer or stinger reaches the mech's armor */
  striking(s, a, dt, P) {
    if (a.kind === 'claw' && !a.hit && P.alive) {
      const tip = s.clawTip[a.side > 0 ? 1 : 0];
      if (capsuleDist(tip, P.pos) < 2.1) {
        a.hit = true;
        this.land(s, tip, ACTS.claw.dmg, 'claw', P);
        if (s.v.grab) this.seize(s, a);
      }
    } else if (a.kind === 'sting' && !a.hit && P.alive) {
      if (capsuleDist(s.tip, P.pos) < 2.2) {
        a.hit = true;
        this.land(s, s.tip, ACTS.sting.dmg, 'sting', P);
      }
    } else if (a.kind === 'spit') {
      if (!a.second && a.t > 0.16) { a.second = true; this.spit(s, P); }
    } else if (a.kind === 'flame') this.spray(s, a, dt, P);
    else if (a.kind === 'zap' && a.t > 0.2 && !s.laser) a.t = a.dur;
  }

  /** A claw or sting connects */
  land(s, at, dmg, kind, P) {
    const sw = this.sw, cb = sw.cb, v = s.v;
    let k = v.dmg || 1;
    if (v.stealth && this.behind(s, P)) k *= 1.5;   // a Prowler's strike from behind
    cb.onPlayerHit && cb.onPlayerHit(dmg * k, s.c.clone(), kind);
    const g = v.palette.glow, hex = _col.setRGB(g[0], g[1], g[2]).getHex();
    _a.subVectors(s.c, at).normalize();
    sw.fx.sparksBurst(at, _a, kind === 'sting' ? 22 : 12, hex, 26);
    sw.fx.flash(at, kind === 'sting' ? 3.4 : 2.2, hex, 0.1);
    if (kind === 'sting') sw.sound.stingHit(at); else sw.sound.clawHit(at);
    if (v.venom) cb.onVenom && cb.onVenom(kind === 'sting' ? v.venom : v.venom * 0.4, s.c.clone());
    if (v.shock && kind === 'sting') {
      cb.onShock && cb.onShock(v.shock, s.c.clone());
      this.shockT = 0.5;
      sw.sound.zap(at);
    }
  }

  /** An Emperor's pincer closes on the mech and pins it, unless its shield turned the pincer away */
  seize(s, a) {
    const cb = this.sw.cb;
    if (!cb.onGrab || !cb.onGrab(s.v.grab, s.c.clone())) return;
    s.grip = { side: a.side };
    s.cool.sting = Math.min(s.cool.sting, 0.3);
  }

  letGo(s) {
    if (!s.grip) return;
    s.grip = null;
    this.sw.cb.onGrab && this.sw.cb.onGrab(0);
  }

  /** Lob a venom glob at where the mech is heading */
  spit(s, P) {
    const o = s.tip.clone(), d = o.distanceTo(P.chest);
    const T = clamp(d / 34, 0.45, 1.6);
    _a.copy(P.chest).addScaledVector(P.vel, T * 0.7).add(_b.set(rand(-1.5, 1.5), rand(-1, 1), rand(-1.5, 1.5)));
    const vel = new V3().subVectors(_a, o).divideScalar(T);
    vel.y += 0.5 * VENOM_GLOB.gravity * T;
    this.sw.bolts.push({ kind: 'venom', B: VENOM_GLOB, pos: o, vel, life: T + 2, from: o.clone() });
    this.sw.fx.flash(o, 2, VENOM_GLOB.hit, 0.08);
    this.sw.sound.venomSpit(o);
  }

  /** A Scorcher's flame: a stream that drags after the mech, burning it and setting the street alight */
  spray(s, a, dt, P) {
    const sw = this.sw, fx = sw.fx, o = s.tip;
    a.aim.lerp(_b.set(P.pos.x, P.pos.y + 1.8, P.pos.z), damp(2.2, dt));
    const dir = _c.subVectors(a.aim, o).normalize();
    for (let i = 0; i < 4; i++) {
      const sp = rand(24, 32);
      fx.fire.emit(o.x, o.y, o.z, dir.x * sp + rand(-2.5, 2.5), dir.y * sp + rand(-2.5, 2.5), dir.z * sp + rand(-2.5, 2.5),
        rand(0.55, 0.85), 0.5, rand(3, 4.5), 3.4, 1.5, 0.35, 1, 1.3, 0.22, 0.04, 0, 0.9, 3);
    }
    if (Math.random() < dt * 12) fx.smoke.emit(o.x, o.y, o.z, dir.x * 12, dir.y * 12 + 2, dir.z * 12, rand(1, 1.6), 1, 4, 0.2, 0.18, 0.16, 0.5, 0.3, 0.3, 0.3, 0, 1.2, 0.5);
    sw.sound.flame(o);
    a.tick = (a.tick || 0) - dt;
    if (a.tick > 0) return;
    a.tick = 0.15;
    // The stream stops on a tree and sets it alight
    const hit = sw.world.raycast(o, dir, FLAME_RANGE, { targets: false, trees: true });
    const reach = hit ? hit.dist : FLAME_RANGE;
    if (hit && hit.target && hit.target.kind === 'tree') sw.world.damage(hit.target, 6, hit.point);
    // Burn the mech if it stands in the stream (it widens with distance)
    if (P.alive) {
      for (let t = 2; t < reach; t += 2.5) {
        if (capsuleDist(_d.copy(o).addScaledVector(dir, t), P.pos) < 1.4 + t * 0.07) { sw.cb.onPlayerHit && sw.cb.onPlayerHit(2.4, s.c.clone(), 'fire'); break; }
      }
    }
    if (hit && hit.normal.y > 0.7 && !(hit.target && hit.target.kind === 'tree')) this.ignite(hit.point);
  }

  ignite(p) {
    for (const q of this.patches) if (q.p.distanceToSquared(p) < 5) { q.life = Math.max(q.life, 4); return; }
    if (this.patches.length >= 36) this.patches.shift();
    this.patches.push({ p: p.clone(), life: 4.5 });
    this.sw.fx.scorch(p.x, p.z, 2.4, p.y + 0.03);
    this.sw.world.blastTrees(p, 2, 0);
  }

  // ---- burrowing ----------------------------------------------------------------------------

  burrow(s) {
    s.state = 'burrow';
    s.timer = 0.7;
    s.goal = null;
    this.sw.sound.burrow(s.c);
  }

  /** Fully underground: untargetable, and moving fast under the street toward the mech */
  goUnder(s) {
    const sw = this.sw;
    s.state = 'tunnel';
    s.hidden = true;
    s.timer = 7;
    s.trailT = 0;
    s.erupt = null;
    const i = sw.world.targets.indexOf(s);
    if (i >= 0) sw.world.targets.splice(i, 1);
  }

  tunnel(s, dt, P) {
    const sw = this.sw;
    s.timer -= dt;
    if (s.erupt) {
      // A warning ring pulses where it's about to burst out
      s.erupt.t -= dt;
      const r = s.ring;
      if (r) r.material.opacity = 0.4 + 0.6 * Math.abs(Math.sin(s.erupt.t * 18));
      if (Math.random() < dt * 30) this.debris(s.erupt.at, 0.5, 1);
      if (s.erupt.t <= 0) this.surface(s, P);
      return;
    }
    // Head under the mech, straight through foundations
    _a.subVectors(P.pos, s.p).setY(0);
    const d = _a.length();
    if (d > 0.1) s.f.copy(_a.divideScalar(d));
    const speed = s.speed * s.scale * 2, step = speed * dt;
    s.p.addScaledVector(s.f, Math.min(step, d)).setY(0);
    s.n.set(0, 1, 0);
    s.c.copy(s.p).addScaledVector(s.n, s.rig.bodyH * s.scale);
    s.moveVel.copy(s.f).multiplyScalar(speed);
    // The street heaves above it
    s.trailT -= dt;
    if (s.trailT <= 0) {
      s.trailT = 0.12;
      const g = this.groundAt(s.p.x, s.p.z);
      if (g) {
        this.debris(g.point, 0.7, 2);
        if (Math.random() < 0.35) sw.fx.scorch(g.point.x, g.point.z, rand(1.2, 2), g.point.y + 0.03);
      }
      sw.sound.burrow(s.p, 0.5);
    }
    // Close enough (or tunneled long enough): pick open street to burst out of
    if (d < 2 + 3.6 * s.scale || s.timer <= 0) {
      const at = this.groundAt(s.p.x, s.p.z) || (s.timer < -3 && this.findGround(s.p, 0, 12, null, 10));
      if (!at) return;
      s.erupt = { at: at.point, collider: at.collider, t: 0.6 };
      s.ring = this.rings.find((r) => !r.visible) || null;
      if (s.ring) {
        s.ring.visible = true;
        s.ring.position.set(at.point.x, at.point.y + 0.15, at.point.z);
        s.ring.scale.setScalar(4.5 * s.scale);
      }
    }
  }

  /** Burst up out of the street, pincers first */
  surface(s, P) {
    const sw = this.sw, at = s.erupt.at;
    s.p.copy(at);
    s.n.set(0, 1, 0);
    s.support = s.erupt.collider;
    s.erupt = null;
    if (s.ring) { s.ring.visible = false; s.ring = null; }
    s.hidden = false;
    s.state = 'emerge';
    s.timer = s.emergeT = 0.35;
    s.dig = 1;
    s.c.copy(s.p).addScaledVector(s.n, s.rig.bodyH * s.scale);
    s.ns.copy(s.n);
    sw.replant(s, 0.05, 0.12);
    sw.world.targets.push(s);
    s.cool.burrow = rand(9, 13);
    s.cool.claw = Math.min(s.cool.claw, 0.3);
    sw.fx.dust(at, 1.5, 16);
    sw.fx.ring(_a.copy(at).setY(at.y + 0.2), 9 * s.scale, 0.5, UP, 0xd8b070);
    sw.fx.sparksBurst(at, UP, 20, 0xc8a070, 30);
    this.debris(at, 1.6, 12);
    sw.sound.erupt(at);
    if (P.alive && capsuleDist(at, P.pos) < 2.2 + 3 * s.scale) sw.cb.onPlayerHit && sw.cb.onPlayerHit(16, at.clone(), 'blast');
  }

  debris(p, scale, n) {
    const fx = this.sw.fx;
    for (let i = 0; i < n; i++) {
      const g = rand(0.32, 0.42);
      fx.smoke.emit(p.x + rand(-1, 1) * scale, p.y + 0.3, p.z + rand(-1, 1) * scale, rand(-3, 3) * scale, rand(2, 6) * scale, rand(-3, 3) * scale,
        rand(0.8, 1.6), 1.2 * scale, 3.6 * scale, g, g * 0.9, g * 0.78, 0.7, g, g * 0.92, g * 0.82, 0, 1.6, 0.4, rand(-1, 1));
    }
    if (Math.random() < 0.4) fx.sparksBurst(p, UP, 3, 0x9a8060, 12);
  }

  // ---- posing ------------------------------------------------------------------------------

  /** Targets for the tail, pincers, lunge and rear-up, eased toward each frame */
  pose(s, dt, P) {
    const ta = s.tailAct, ca = s.clawAct;
    // Tail
    let goal = TAIL_REST, rate = 5, yaw = 0, aim = null;
    if (ta && ta.kind === 'sting') {
      if (ta.phase === 'windup') { goal = TAIL_COCK; rate = 9; }
      else if (ta.phase === 'strike') { aim = this.stingAim(s, P, this._aim || (this._aim = {})); rate = 34; }
    } else if (ta && ta.phase !== 'recover') {
      goal = TAIL_RAISE; rate = 8;
      if (s.B) { const L = this.toLocal(s, P.chest, _a); yaw = clamp(Math.atan2(L.x, L.z - TAIL_BASE.z), -0.7, 0.7); }
    } else if (s.menace) goal = TAIL_RAISE;
    const ang = this._ang || (this._ang = [0, 0, 0, 0, 0]);
    for (let i = 0; i < 5; i++) ang[i] = goal[i] + (aim ? s.tail[i] - goal[i] : 0.04 * Math.sin(s.t * 1.7 + i * 0.8));
    if (aim) { reachTail(ang, aim.U, aim.V, 6); yaw = aim.yaw; }
    const kt = damp(rate, dt);
    for (let i = 0; i < 5; i++) s.tail[i] += (ang[i] - s.tail[i]) * kt;
    s.tailYaw += (yaw - s.tailYaw) * damp(rate * 0.7, dt);

    // Pincers
    for (const side of [-1, 1]) {
      const k = side > 0 ? 1 : 0, mine = ca && ca.side === side;
      let r = 7, open = 0.12 + 0.1 * Math.max(0, Math.sin(s.t * 2.3 + side * 1.7));
      // Wrist target (_a) and which way the hand points (_e), in body units
      _a.set(side * WRIST_REST[0], WRIST_REST[1] + 0.05 * Math.sin(s.t * 2 + side), WRIST_REST[2]);
      _e.set(-side * 0.12, -0.12, 1);
      if (mine && ca.phase === 'windup') { _a.set(side * 1.3, 0.45, 2.15); _e.set(side * 0.35, 0.45, 1); open = 0.9; r = 10; }
      else if (mine && (ca.phase === 'strike' || ca.phase === 'hold') && s.B) {
        // Reach so the closing fingers meet the mech's armor
        this.clawPose(s, P, side, _a, _e);
        open = ca.phase === 'hold' ? 0.05 : 0.9 * (1 - ca.t / ca.dur) ** 2;
        r = 30;
      } else if (s.menace) {
        _a.set(side * 0.95, 1.25, 2.4);
        _e.set(side * 0.2, 0.8, 1);
        open = 0.45 + 0.4 * Math.sin(s.t * 9 + side);
      }
      s.wrist[k].lerp(_a, damp(r, dt));
      s.hand[k].lerp(_e.normalize(), damp(r, dt)).normalize();
      s.open[k] += (open - s.open[k]) * damp(r * 1.4, dt);
    }

    // Lunge into a strike; rear up at a mech out of reach, or to spray and spit
    const strike = (ta && ta.kind === 'sting' && ta.phase === 'strike') ? 0.55 : (ca && ca.phase === 'strike') ? 0.35 : 0;
    s.lunge += (strike - s.lunge) * damp(strike ? 24 : 6, dt);
    const pitch = s.menace ? 0.32 : (ta && ta.kind !== 'sting' && ta.phase !== 'recover') ? 0.14 : (ta && ta.kind === 'sting' && ta.phase === 'windup') ? -0.07 : 0;
    s.pitch += (pitch - s.pitch) * damp(5, dt);
  }

  // ---- frame update ----------------------------------------------------------------------

  /** After every scorpion has moved: burning ground, shock arcs, and flushing the instance buffers */
  update(dt, ctx) {
    const sw = this.sw, P = ctx.player, fx = sw.fx;
    // Burning street
    this.burnT -= dt;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const q = this.patches[i];
      q.life -= dt;
      if (q.life <= 0) { this.patches.splice(i, 1); continue; }
      const k = Math.min(1, q.life);
      if (Math.random() < dt * 16) {
        fx.fire.emit(q.p.x + rand(-1.3, 1.3), q.p.y + 0.2, q.p.z + rand(-1.3, 1.3), rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5),
          rand(0.4, 0.8), 1.5 * k, 0.4, 3, 1.3, 0.3, 0.9, 1.2, 0.2, 0.05, 0, 0.5, 1.5);
      }
      if (this.burnT <= 0 && P.alive && Math.hypot(P.pos.x - q.p.x, P.pos.z - q.p.z) < 2.6 && Math.abs(P.pos.y - q.p.y) < 1.5) {
        this.burnT = 0.3;
        sw.cb.onPlayerHit && sw.cb.onPlayerHit(2.2, q.p.clone(), 'fire');
      }
    }
    // Arcs crackle over the mech after a Shocktail sting, and around a charging tail
    if (this.shockT > 0) {
      this.shockT -= dt;
      for (let i = 0; i < 3; i++) {
        _a.set(P.pos.x + rand(-2, 2), P.pos.y + rand(1.5, 6.5), P.pos.z + rand(-2, 2));
        this.zap(_a, _b.copy(_a).add(_c.set(rand(-2.5, 2.5), rand(-2.5, 2.5), rand(-2.5, 2.5))), 0.7);
      }
    }
    for (const s of sw.list) {
      if (s.nest !== this || !s.laser || s.laser.phase !== 'charge' || s.hidden) continue;
      if (Math.random() < 0.5) this.zap(s.tip, _b.copy(s.tip).add(_c.set(rand(-1.2, 1.2), rand(-1.2, 1.2), rand(-1.2, 1.2)).multiplyScalar(s.scale)), 0.5);
    }
    this.zapMesh.count = this.zaps;
    this.zapMesh.instanceMatrix.needsUpdate = true;
    if (this.zapMesh.instanceColor) this.zapMesh.instanceColor.needsUpdate = true;
    this.zaps = 0;

    // Upload only the slots in use
    for (const key in this.parts) {
      const m = this.parts[key], n = this.top * m.per;
      for (const [a, k] of [[m.instanceMatrix, 16], [m.instanceColor, 3]]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * k);
        a.needsUpdate = true;
      }
    }
    for (const pts of [this.eyesBig, this.eyesSmall]) {
      pts.geometry.attributes.position.needsUpdate = true;
      pts.geometry.attributes.color.needsUpdate = true;
    }
  }

  /** A jagged lightning arc from a to b at strength k, drawn this frame */
  zap(a, b, k) {
    const len = a.distanceTo(b);
    if (len < 0.05) return;
    _dir.subVectors(b, a).divideScalar(len);
    _tn.set(_dir.y, -_dir.x, 0);
    if (_tn.lengthSq() < 0.01) _tn.set(0, _dir.z, -_dir.y);
    _tn.normalize();
    _ty.crossVectors(_dir, _tn);
    const n = Math.max(2, Math.min(14, Math.round(len / 1.6)));
    _p0.copy(a);
    for (let i = 1; i <= n; i++) {
      _p1.copy(a).addScaledVector(_dir, (len * i) / n);
      if (i < n) _p1.addScaledVector(_tn, rand(-1, 1) * len * 0.05).addScaledVector(_ty, rand(-1, 1) * len * 0.05);
      this.ribbon(_p0, _p1, 0.28 * k + 0.08, 0.6 * k, 1.4 * k, 3 * k);
      this.ribbon(_p0, _p1, 1.3 * k, 0.12 * k, 0.35 * k, 0.9 * k);
      _p0.copy(_p1);
    }
  }

  ribbon(a, b, width, r, g, bl) {
    if (this.zaps >= ZAP_CAP) return;
    _m.makeBasis(_h.set(width, 0, 0), _q.subVectors(b, a), _g.set(0, 0, 1)).setPosition(a);
    this.zapMesh.setMatrixAt(this.zaps, _m);
    this.zapMesh.setColorAt(this.zaps++, _col.setRGB(r, g, bl));
  }

  // ---- rendering --------------------------------------------------------------------------

  render(s, dt) {
    const sc = s.scale, slot = s.slot, P = this.parts;
    if (s.hidden) {
      if (!s.drawnHidden) { this.hide(s); s.drawnHidden = true; }
      return;
    }
    s.drawnHidden = false;
    // Ease the rendered frame into the logical one (instant while airborne or dead)
    if (s.state !== 'dead') {
      const air = s.state === 'jump' || s.state === 'fall';
      const k = air ? 1 : 1 - Math.exp(-dt * 11);
      s.ns.lerp(s.n, k).normalize();
      s.fs.lerp(s.f, k);
      if (!air) s.c.lerp(_a.copy(s.p).addScaledVector(s.n, s.rig.bodyH * sc), 1 - Math.exp(-dt * 14));
    }
    const up = _u.copy(s.ns);
    const fwd = _f.copy(s.fs).addScaledVector(up, -s.fs.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
    fwd.normalize();
    // Body frame: rear up by pitch, lunge forward, crouch, and sink into the street while digging
    const B = s.B || (s.B = { c: new V3(), r: new V3(), u: new V3(), f: new V3() });
    const ca = Math.cos(s.pitch), sa = Math.sin(s.pitch);
    B.f.copy(fwd).multiplyScalar(ca).addScaledVector(up, sa);
    B.u.copy(up).multiplyScalar(ca).addScaledVector(fwd, -sa);
    B.r.crossVectors(B.u, B.f);
    const swing = s.feet.reduce((n, f) => n + (f.t < 1 ? 1 : 0), 0);
    B.c.copy(s.c).addScaledVector(fwd, s.lunge * sc).addScaledVector(up, (-0.35 * s.crouch + 0.03 * swing - s.dig * 4.8) * sc);
    const M = s.bodyM || (s.bodyM = new THREE.Matrix4());
    M.makeBasis(_g.copy(B.r).multiplyScalar(sc), _h.copy(B.u).multiplyScalar(sc), _q.copy(B.f).multiplyScalar(sc)).setPosition(B.c);
    s.pos.copy(BODY_MID).applyMatrix4(M);
    const put = (mesh, k, m) => mesh.setMatrixAt(slot * mesh.per + k, m);
    const local = (L) => _m.multiplyMatrices(M, L);

    // Carapace and body
    put(P.hullT, 0, local(BODY.carapace));
    const breathe = 1 + 0.03 * Math.sin(s.t * 3 + slot);
    _m2.copy(BODY.meso).scale(_a.set(breathe, breathe, 1));
    put(P.hullA, 0, local(_m2));
    put(P.thorax, 0, local(BODY.plate));
    put(P.face, 0, local(BODY.face));
    put(P.spine, 0, local(BODY.crest));
    for (const side of [-1, 1]) {
      const chew = 0.12 * Math.sin(s.t * 11 + side);
      plateMatrix(_m2, _a.set(side * 0.16, 0.02, 1.8), _b.set(side * (0.12 + chew), -0.45, 1), _c.set(side, 0, 0), 0.55, 0.9, 0.12);
      put(P.fang, side > 0 ? 1 : 0, local(_m2));
    }

    // Tail: lay the chain out in its plane, then place each segment along it
    const yaw = s.tailYaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
    _ty.copy(B.r).multiplyScalar(sy).addScaledVector(B.f, cy);   // the tail plane's forward
    _tn.copy(B.r).multiplyScalar(cy).addScaledVector(B.f, -sy);  // its normal
    const base = _e.copy(TAIL_BASE).applyMatrix4(M);
    tailChain(s.tail, CH);
    const at = (i, out) => out.copy(base).addScaledVector(_ty, CH[i * 2] * sc).addScaledVector(B.u, CH[i * 2 + 1] * sc);
    const dirAt = (ph) => _dir.copy(_ty).multiplyScalar(-Math.cos(ph)).addScaledVector(B.u, Math.sin(ph));
    const dorAt = (ph) => _dor.copy(_ty).multiplyScalar(-Math.sin(ph)).addScaledVector(B.u, -Math.cos(ph));
    let ph = 0;
    for (let i = 0; i < 5; i++) {
      ph = i ? ph + s.tail[i] : s.tail[0];
      const L = TAIL_LEN[i] * sc, w = TAIL_W[i] * sc;
      at(i, _p0);
      dirAt(ph); dorAt(ph);
      _m.makeBasis(_a.copy(_tn).multiplyScalar(w), _b.copy(_dor).multiplyScalar(w * 0.9), _c.copy(_dir).multiplyScalar(L * 0.54))
        .setPosition(_d.copy(_p0).addScaledVector(_dir, L * 0.5));
      put(P.hullA, 1 + i, _m);
      plateMatrix(_m, _d.copy(_p0).addScaledVector(_dor, w * 0.82), _dir, _tn, L * 1.02, 0.42, 0.08 * sc);
      put(P.spine, 1 + i, _m);
      _a.crossVectors(_tn, _dir);
      _m.makeBasis(_b.copy(_tn).multiplyScalar(w * 0.95), _c.copy(_dir).multiplyScalar(0.2 * sc), _a.multiplyScalar(w * 0.95)).setPosition(_p0);
      put(P.joint, JOINT_TAIL + i, _m);
    }
    // Venom bulb, then the stinger hooked forward off it
    let phi = ph + BULB_BEND;
    at(5, _p0);
    dirAt(phi); dorAt(phi);
    _m.makeBasis(_a.copy(_tn).multiplyScalar(0.42 * sc), _b.copy(_dor).multiplyScalar(0.4 * sc), _c.copy(_dir).multiplyScalar(BULB * 0.6 * sc))
      .setPosition(_d.copy(_p0).addScaledVector(_dir, BULB * 0.5 * sc));
    put(P.bulb, 0, _m);
    phi += STINGER_BEND;
    _p1.copy(base).addScaledVector(_ty, CH[12] * sc).addScaledVector(B.u, CH[13] * sc);
    dirAt(phi); dorAt(phi);
    plateMatrix(_m, _p1, _dir, _dor, STINGER * sc, 0.62, 0.2 * sc);
    put(P.tibia, TIBIA_STING, _m);
    plateMatrix(_m, _p1, _dir, _tn, STINGER * sc, 0.45, 0.16 * sc);
    put(P.tibia, TIBIA_STING + 1, _m);
    s.tip.copy(_p1).addScaledVector(_dir, STINGER * sc);

    // Pincers: two-bone arms with elbows thrown outward, a heavy hand, and a fixed and a hinged finger
    for (const side of [-1, 1]) {
      const k = side > 0 ? 1 : 0;
      const sh = _p0.set(side * SHOULDER[0], SHOULDER[1], SHOULDER[2]).applyMatrix4(M);
      _a.copy(s.wrist[k]).applyMatrix4(M);
      const leg = solveLeg(sh, _a, ARM * sc, FOREARM * sc, _b.copy(sh).addScaledVector(B.r, -side), B.u, 1.8);
      _elbow.copy(leg.knee); _wrist.copy(leg.tip); _pole.copy(leg.pole); _axis.copy(leg.axis);
      plateMatrix(_m, sh, _c.subVectors(_elbow, sh), _pole, ARM * sc, 0.6, 0.24 * sc);
      put(P.femur, FEMUR_ARM + k, _m);
      plateMatrix(_m, sh, _c.subVectors(_elbow, sh), _axis, ARM * sc, 0.45, 0.2 * sc);
      put(P.femur, FEMUR_ARM + 2 + k, _m);
      plateMatrix(_m, _elbow, _c.subVectors(_wrist, _elbow), _pole, FOREARM * sc, 0.55, 0.22 * sc);
      put(P.tibia, TIBIA_ARM + k, _m);
      plateMatrix(_m, _elbow, _c.subVectors(_wrist, _elbow), _axis, FOREARM * sc, 0.42, 0.18 * sc);
      put(P.tibia, TIBIA_ARM + 2 + k, _m);
      // The hand points its own way: forward at rest, at the mech in a strike
      _dir.copy(s.hand[k]).transformDirection(M);
      _mu.copy(B.u).addScaledVector(_dir, -B.u.dot(_dir)).normalize();
      _mr.crossVectors(_mu, _dir);
      _m.makeBasis(_a.copy(_mr).multiplyScalar(0.44 * sc), _b.copy(_mu).multiplyScalar(0.34 * sc), _c.copy(_dir).multiplyScalar(MANUS * 0.66 * sc))
        .setPosition(_d.copy(_wrist).addScaledVector(_dir, MANUS * 0.5 * sc));
      put(P.hullT, 1 + k, _m);
      // Fingers: the fixed one on the outside, the hinged one inside swinging open toward the body's midline
      const hinge = _d.copy(_wrist).addScaledVector(_dir, MANUS * 0.92 * sc);
      _in.copy(_mr).multiplyScalar(-side);
      const open = s.open[k];
      _e.copy(_dir).addScaledVector(_in, 0.1).normalize();
      _a.copy(hinge).addScaledVector(_in, -0.15 * sc);
      plateMatrix(_m, _a, _e, _in, FINGER * sc, 0.62, 0.2 * sc);
      put(P.tibia, TIBIA_FINGER + k * 2, _m);
      plateMatrix(_m, _a, _e, _mu, FINGER * sc, 0.42, 0.16 * sc);
      put(P.tibia, TIBIA_FINGER + 4 + k * 2, _m);
      _g.copy(_a).addScaledVector(_e, FINGER * sc);   // fixed finger's tip
      _e.copy(_dir).multiplyScalar(Math.cos(open)).addScaledVector(_in, Math.sin(open));
      _a.copy(hinge).addScaledVector(_in, 0.15 * sc);
      plateMatrix(_m, _a, _e, _h.copy(_in).negate(), FINGER * sc * 0.92, 0.62, 0.2 * sc);
      put(P.tibia, TIBIA_FINGER + k * 2 + 1, _m);
      plateMatrix(_m, _a, _e, _mu, FINGER * sc * 0.92, 0.42, 0.16 * sc);
      put(P.tibia, TIBIA_FINGER + 4 + k * 2 + 1, _m);
      s.clawTip[k].copy(_a).addScaledVector(_e, FINGER * sc * 0.92).add(_g).multiplyScalar(0.5);
      // Shoulder, elbow and wrist discs
      for (const [j, p, r] of [[0, sh, 0.26], [1, _elbow, 0.24], [2, _wrist, 0.27]]) {
        _a.crossVectors(_pole, _axis);
        _m.makeBasis(_b.copy(_pole).multiplyScalar(r * sc), _c.copy(_axis).multiplyScalar(0.24 * sc), _a.multiplyScalar(r * sc)).setPosition(p);
        put(P.joint, JOINT_ARM + k * 3 + j, _m);
      }
    }

    // Legs: two-bone IK from each hip to its planted foot, knees thrown wide
    const rig = s.rig, a1 = rig.femur * sc * s.legs, b1 = rig.tibia * sc * s.legs;
    for (let i = 0; i < N_LEGS; i++) {
      const L = rig.legs[i];
      const hip = _p0.set(L.side * L.hip[0], L.hip[1], L.hip[2]).applyMatrix4(M);
      const { knee, tip, pole, axis } = solveLeg(hip, s.feet[i].pos, a1, b1, B.c, B.u, rig.knee);
      plateMatrix(_m, hip, _c.subVectors(knee, hip), pole, a1, 0.72, 0.22 * sc);
      put(P.femur, i, _m);
      plateMatrix(_m, hip, _c.subVectors(knee, hip), axis, a1, 0.5, 0.2 * sc);
      put(P.femur, N_LEGS + i, _m);
      plateMatrix(_m, knee, _c.subVectors(tip, knee), pole, b1, 0.58, 0.2 * sc);
      put(P.tibia, i, _m);
      plateMatrix(_m, knee, _c.subVectors(tip, knee), axis, b1, 0.42, 0.16 * sc);
      put(P.tibia, N_LEGS + i, _m);
      for (const [j, p, r] of [[i * 2, hip, 0.28], [i * 2 + 1, knee, 0.25]]) {
        _a.crossVectors(pole, axis);
        _m.makeBasis(_b.copy(pole).multiplyScalar(r * sc), _c.copy(axis).multiplyScalar(0.22 * sc), _a.multiplyScalar(r * sc)).setPosition(p);
        put(P.joint, j, _m);
      }
    }

    // Hit flash: brighten every part
    const fk = 1 + s.flash * 4;
    if (fk !== s.lastFlash) {
      s.lastFlash = fk;
      _col.setRGB(fk, fk * (1 - s.flash * 0.3), fk * (1 - s.flash * 0.3));
      for (const key in P) for (let k = 0; k < P[key].per; k++) P[key].setColorAt(slot * P[key].per + k, _col);
    }

    // Eyes: red like every frame's, dimmed while a Prowler runs dark; the tail glows as a sting winds up
    const dead = s.state === 'dead';
    let glow = dead ? Math.max(0, 1 - s.deadT * 2) : Math.min(2.2, 0.85 + 0.15 * Math.sin(s.t * 7 + slot));
    if (s.stealth) glow *= 0.35;
    for (const [pts, list] of [[this.eyesBig, EYES_BIG], [this.eyesSmall, EYES_SMALL]]) {
      const pa = pts.geometry.attributes.position, c = pts.geometry.attributes.color;
      list.forEach((e, k) => {
        _a.set(e[0], e[1], e[2]).applyMatrix4(M);
        pa.setXYZ(slot * pts.per + k, _a.x, _a.y, _a.z);
        c.setXYZ(slot * pts.per + k, glow * 1.4, glow * 0.1, glow * 0.07);
      });
    }
    const ta = s.tailAct;
    if (ta && ta.kind === 'sting' && ta.phase === 'windup' && Math.random() < dt * 30) {
      const g = s.v.palette.glow;
      this.sw.fx.fire.emit(s.tip.x, s.tip.y, s.tip.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 0.15, 0.7 * sc, 0.1, g[0] * 3, g[1] * 3, g[2] * 3, 1, g[0], g[1], g[2], 0);
    }
  }
}

// Fixed body parts, in body units
const BODY = {
  carapace: new THREE.Matrix4().makeScale(0.8, 0.34, 1.05).setPosition(0, 0.08, 0.7),
  meso: new THREE.Matrix4().makeScale(0.92, 0.44, 1.5).setPosition(0, 0.12, -1.05),
  plate: plateMatrix(new THREE.Matrix4(), new V3(0, 0.4, 1.75), new V3(0, -0.14, -1), new V3(1, 0, 0), 1.75, 1, 0.1),
  face: plateMatrix(new THREE.Matrix4(), new V3(0, 0.3, 1.78), new V3(0, -0.95, 0.3), new V3(1, 0, 0), 0.72, 1, 0.12),
  crest: plateMatrix(new THREE.Matrix4(), new V3(0, 0.56, 0.3), new V3(0, -0.1, -1), new V3(1, 0, 0), 2.7, 0.38, 0.1),
};
