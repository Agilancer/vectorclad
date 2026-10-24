import * as THREE from './three.js';

// ---------------------------------------------------------------------------
// People: the city's inhabitants, at their true size beside the 12 m mech.
//
// Fifty models, each a build (height and girth, a few children), a skin
// tone, a haircut, clothes (shirts and jackets, short or long sleeves,
// trousers, shorts or skirts, shoes) and now and then a hat or a bag, from
// suits and hi-vis vests to nurses, cooks, joggers and tourists. A body is a
// dozen parts on a simple rig of joint angles, and every part of every
// person is one InstancedMesh, so the whole crowd draws in a handful of
// calls.
//
// They idle, walk, run, die, slide backward off a ledge and fall:
//   - Most walk the sidewalks round the blocks near the mech, crossing the
//     streets at the corners, stopping now and then. Out of range they are
//     moved on to blocks near it again, out of its sight.
//   - Explosions, the mech coming close and buildings coming down send them
//     running. Blasts throw them, and the mech treads on them.
//   - Buildings are full of them. When a building is first broken open, the
//     floors round the hole fill with people (and furniture, js/furniture.js),
//     some buildings far more than others. Every hole spills them, the more
//     the bigger it is: on the floors it broke into, about half of those near
//     it slide backward into it as the floor sags, arms flailing, and go over
//     the edge; the newcomers nearest it are thrown out through it, skidding
//     across the floor; the rest scramble away. Later blasts throw them out
//     through the hole too, and when the floor under them goes, they fall.
//   - A fall from more than a storey or so ends in a little red splat.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a, r = Math.random) => a[Math.floor(r() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new V3(), _w = new V3(), _s = new V3(), _a = new V3(), _b = new V3(), _up = new V3(0, 1, 0);

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- models ---------------------------------------------------------------

const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const SKIN = ['#f3d2bd', '#e8b996', '#d9a37e', '#c68863', '#a86f4c', '#8d5a3b', '#6e4329', '#4f2f1d'].map(hex);
const HAIR = ['#1c1410', '#2e1f16', '#4a3022', '#6b4a2f', '#9b6b3c', '#c9a063', '#e2cf9c', '#8a8a8a', '#d8d8d8', '#7a2a18', '#b23a1d'].map(hex);
const CLOTH = ['#1f2a44', '#2e3b5e', '#3d5a80', '#5b7aa6', '#8fb3d9', '#e8e8e8', '#f5f1e6', '#202020', '#3a3a3a', '#6b6b6b', '#a7a7a7',
  '#7a1f1f', '#b03030', '#d9534f', '#e07b39', '#f2c14e', '#6a994e', '#386641', '#2a9d8f', '#264653', '#7b4f9d', '#c77dff', '#e5989b', '#8d6346', '#c2a878', '#5c4033'].map(hex);
const DENIM = ['#2d3e5c', '#3b5378', '#4f6d96', '#1e2a3d', '#55607a'].map(hex);
const SHOES = ['#151515', '#2b2b2b', '#5a3a22', '#7a5230', '#e6e6e6', '#9a9a9a', '#8a1c1c'].map(hex);

/**
 * A model: { h: height in m, w: girth, skin, hair: { style, color }, top, sleeves (long), bottom:
 * { kind: pants | shorts | skirt, color }, shoes, hat: null | { kind: cap | brim | hard | beanie, color },
 * bag: null | pack | purse, bagColor }. Hair styles: short, long, bun, bald, afro, crop.
 */
function makeModels() {
  const r = seeded(4021), models = [];
  const add = (o) => models.push(Object.assign({
    h: 1.72, w: 1, skin: pick(SKIN, r), hair: { style: 'short', color: pick(HAIR, r) }, top: pick(CLOTH, r), sleeves: true,
    bottom: { kind: 'pants', color: pick(DENIM, r) }, shoes: pick(SHOES, r), hat: null, bag: null, bagColor: pick(CLOTH, r),
  }, o));
  // Twenty people you'd meet in a city
  add({ name: 'office worker', top: hex('#2e3b5e'), bottom: { kind: 'pants', color: hex('#202020') }, shoes: hex('#151515'), bag: 'purse', bagColor: hex('#3a2a1a') });
  add({ name: 'banker', h: 1.82, top: hex('#202020'), bottom: { kind: 'pants', color: hex('#202020') }, shoes: hex('#151515'), hair: { style: 'crop', color: HAIR[7] } });
  add({ name: 'businesswoman', h: 1.66, top: hex('#7a1f1f'), bottom: { kind: 'skirt', color: hex('#202020') }, hair: { style: 'bun', color: HAIR[1] }, bag: 'purse', bagColor: hex('#151515') });
  add({ name: 'construction worker', h: 1.8, w: 1.15, top: hex('#f2c14e'), sleeves: false, bottom: { kind: 'pants', color: hex('#3b5378') }, shoes: hex('#7a5230'), hat: { kind: 'hard', color: hex('#f5a300') } });
  add({ name: 'police officer', h: 1.8, w: 1.08, top: hex('#1f2a44'), bottom: { kind: 'pants', color: hex('#1f2a44') }, shoes: hex('#151515'), hat: { kind: 'brim', color: hex('#1a1f2e') } });
  add({ name: 'nurse', h: 1.65, top: hex('#8fd3c7'), sleeves: false, bottom: { kind: 'pants', color: hex('#8fd3c7') }, shoes: hex('#e6e6e6'), hair: { style: 'bun', color: HAIR[3] } });
  add({ name: 'cook', h: 1.75, w: 1.12, top: hex('#f5f1e6'), bottom: { kind: 'pants', color: hex('#3a3a3a') }, hat: { kind: 'beanie', color: hex('#f5f1e6') } });
  add({ name: 'jogger', h: 1.76, w: 0.9, top: hex('#e07b39'), sleeves: false, bottom: { kind: 'shorts', color: hex('#202020') }, shoes: hex('#e6e6e6'), hat: { kind: 'cap', color: hex('#202020') } });
  add({ name: 'tourist', h: 1.7, w: 1.1, top: hex('#e5989b'), sleeves: false, bottom: { kind: 'shorts', color: hex('#c2a878') }, bag: 'pack', bagColor: hex('#2a9d8f'), hat: { kind: 'brim', color: hex('#c2a878') } });
  add({ name: 'student', h: 1.68, w: 0.92, top: hex('#6a994e'), bag: 'pack', bagColor: hex('#264653'), hair: { style: 'long', color: HAIR[4] } });
  add({ name: 'courier', h: 1.74, top: hex('#d9534f'), bottom: { kind: 'shorts', color: hex('#202020') }, bag: 'pack', bagColor: hex('#f2c14e'), hat: { kind: 'cap', color: hex('#d9534f') } });
  add({ name: 'retiree', h: 1.64, w: 1.08, top: hex('#c2a878'), bottom: { kind: 'pants', color: hex('#6b6b6b') }, hair: { style: 'short', color: HAIR[8] }, hat: { kind: 'brim', color: hex('#5c4033') } });
  add({ name: 'grandmother', h: 1.56, w: 1.06, top: hex('#7b4f9d'), bottom: { kind: 'skirt', color: hex('#3a3a3a') }, hair: { style: 'bun', color: HAIR[8] }, bag: 'purse', bagColor: hex('#5c4033') });
  add({ name: 'child', h: 1.2, w: 0.85, top: hex('#f2c14e'), bottom: { kind: 'shorts', color: hex('#3d5a80') }, bag: 'pack', bagColor: hex('#b03030') });
  add({ name: 'girl', h: 1.3, w: 0.85, top: hex('#c77dff'), bottom: { kind: 'skirt', color: hex('#e5989b') }, hair: { style: 'long', color: HAIR[5] } });
  add({ name: 'skater', h: 1.74, w: 0.95, top: hex('#202020'), bottom: { kind: 'pants', color: hex('#6b6b6b') }, hat: { kind: 'beanie', color: hex('#b03030') } });
  add({ name: 'mechanic', h: 1.78, w: 1.15, top: hex('#3d5a80'), bottom: { kind: 'pants', color: hex('#3d5a80') }, shoes: hex('#151515'), hat: { kind: 'cap', color: hex('#3d5a80') } });
  add({ name: 'doctor', h: 1.75, top: hex('#f5f1e6'), bottom: { kind: 'pants', color: hex('#2e3b5e') }, hair: { style: 'crop', color: HAIR[0] } });
  add({ name: 'musician', h: 1.77, top: hex('#3a3a3a'), bottom: { kind: 'pants', color: hex('#202020') }, hair: { style: 'afro', color: HAIR[0] }, bag: 'pack', bagColor: hex('#202020') });
  add({ name: 'runner', h: 1.7, w: 0.88, top: hex('#2a9d8f'), sleeves: false, bottom: { kind: 'shorts', color: hex('#264653') }, shoes: hex('#e07b39'), hair: { style: 'bun', color: HAIR[6] } });
  // And thirty more from the city's wardrobe
  const styles = ['short', 'short', 'long', 'bun', 'bald', 'afro', 'crop', 'long'];
  for (let i = 0; i < 30; i++) {
    const woman = r() < 0.5, kid = r() < 0.1;
    const bottom = r() < 0.2 && woman ? 'skirt' : r() < 0.18 ? 'shorts' : 'pants';
    add({
      name: `passerby ${i + 1}`,
      h: kid ? rand(1.15, 1.4) : woman ? 1.55 + r() * 0.2 : 1.65 + r() * 0.25, w: kid ? 0.85 : 0.88 + r() * 0.35,
      hair: { style: pick(woman ? ['long', 'bun', 'short', 'long', 'afro'] : styles, r), color: pick(HAIR, r) },
      top: pick(CLOTH, r), sleeves: r() < 0.65,
      bottom: { kind: bottom, color: bottom === 'pants' && r() < 0.6 ? pick(DENIM, r) : pick(CLOTH, r) },
      hat: r() < 0.22 ? { kind: pick(['cap', 'brim', 'beanie'], r), color: pick(CLOTH, r) } : null,
      bag: r() < 0.3 ? pick(['pack', 'purse'], r) : null,
    });
  }
  return models;
}
export const MODELS = makeModels();

// ---- parts ----------------------------------------------------------------

/** Unit geometries for the parts, in meters for a 1.75 m person; limbs hang from their joint down -y */
function partGeometries() {
  const limb = (r0, r1, len) => { const g = new THREE.CylinderGeometry(r0, r1, len, 7, 1); g.translate(0, -len / 2, 0); return g; };
  const torso = new THREE.CylinderGeometry(0.2, 0.16, 0.55, 8, 1);
  torso.scale(1, 1, 0.58); torso.translate(0, 0.275, 0);
  const pelvis = new THREE.CylinderGeometry(0.17, 0.16, 0.2, 8, 1);
  pelvis.scale(1, 1, 0.62);
  const head = new THREE.SphereGeometry(0.105, 10, 8); head.scale(0.92, 1.1, 1); head.translate(0, 0.14, 0);
  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.08, 6); neck.translate(0, 0.03, 0);
  const headAll = merge([head, neck]);
  const cap = new THREE.SphereGeometry(0.118, 10, 6, 0, TAU, 0, Math.PI * 0.55); cap.scale(0.95, 1.08, 1.05); cap.translate(0, 0.155, -0.008);
  const back = new THREE.BoxGeometry(0.2, 0.26, 0.05); back.translate(0, 0.07, -0.09);
  const bun = new THREE.SphereGeometry(0.06, 8, 6); bun.translate(0, 0.25, -0.08);
  const hat = new THREE.CylinderGeometry(0.11, 0.115, 0.1, 10); hat.translate(0, 0.27, 0);
  const brim = new THREE.CylinderGeometry(0.18, 0.18, 0.015, 12); brim.translate(0, 0.225, 0);
  const visor = new THREE.BoxGeometry(0.16, 0.012, 0.1); visor.translate(0, 0.23, 0.12);
  const skirt = new THREE.CylinderGeometry(0.17, 0.27, 0.42, 10, 1, true); skirt.scale(1, 1, 0.75); skirt.translate(0, -0.2, 0);
  const pack = new THREE.BoxGeometry(0.28, 0.36, 0.16); pack.translate(0, 0.3, -0.18);
  const purse = new THREE.BoxGeometry(0.06, 0.2, 0.22); purse.translate(0.25, -0.05, 0);
  const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.24); shoe.translate(0, -0.035, 0.04);
  return {
    pelvis, torso, head: headAll, hair: cap, hairBack: back, bun, hatTop: hat, hatBrim: merge([brim]), visor, skirt, pack, purse,
    uarm: limb(0.052, 0.045, 0.3), farm: limb(0.044, 0.038, 0.3), thigh: limb(0.08, 0.062, 0.43), shin: limb(0.06, 0.048, 0.43), shoe,
  };
}

function merge(gs) {
  const pos = [], nor = [], idx = [];
  let off = 0;
  for (const g of gs) {
    const ng = g.index ? g : g;
    pos.push(...ng.attributes.position.array); nor.push(...ng.attributes.normal.array);
    for (const i of ng.index.array) idx.push(i + off);
    off += ng.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// Which parts each model wears, and their colors
function wardrobe(md) {
  const W = [];
  const add = (part, color, n = 1) => W.push({ part, color, n });
  add('pelvis', md.bottom.kind === 'skirt' ? md.top : md.bottom.color);
  add('torso', md.top);
  add('head', md.skin);
  const st = md.hair.style;
  if (st !== 'bald' && !(md.hat && md.hat.kind === 'hard' && st === 'crop')) add('hair', md.hair.color);
  if (st === 'long') add('hairBack', md.hair.color);
  if (st === 'bun') add('bun', md.hair.color);
  if (md.hat) {
    if (md.hat.kind === 'brim' || md.hat.kind === 'hard') add('hatBrim', md.hat.color);
    if (md.hat.kind === 'cap') add('visor', md.hat.color);
    add('hatTop', md.hat.color);
  }
  if (md.bottom.kind === 'skirt') add('skirt', md.bottom.color);
  if (md.bag) add(md.bag, md.bagColor);
  add('uarm', md.top, 2);
  add('farm', md.sleeves ? md.top : md.skin, 2);
  add('thigh', md.bottom.kind === 'pants' ? md.bottom.color : md.bottom.kind === 'skirt' ? md.skin : md.bottom.color, 2);
  add('shin', md.bottom.kind === 'pants' ? md.bottom.color : md.skin, 2);
  add('shoe', md.shoes, 2);
  // The lower limbs' colors, for laying them out with the upper ones
  W.farm = W.find((x) => x.part === 'farm').color;
  W.shin = W.find((x) => x.part === 'shin').color;
  W.shoe = md.shoes;
  return W;
}

// ---- splats -----------------------------------------------------------------

function splatTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const r = seeded(77);
  const blob = (x, y, rad, a) => { g.globalAlpha = a; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill(); };
  g.fillStyle = '#7a0a0a';
  blob(S / 2, S / 2, S * 0.2, 1);
  for (let i = 0; i < 14; i++) { const a = r() * TAU, d = S * (0.12 + r() * 0.2); blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.04 + r() * 0.08), 1); }
  for (let i = 0; i < 26; i++) { const a = r() * TAU, d = S * (0.25 + r() * 0.2); blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.01 + r() * 0.025), 1); }
  g.fillStyle = '#b01515';
  blob(S / 2 - 6, S / 2 - 5, S * 0.12, 0.6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Splats {
  constructor(scene, cap = 500) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    // Just enough offset to sit on the floor without fighting it, not so much that it shows through walls
    const mat = new THREE.MeshStandardMaterial({ map: splatTexture(), transparent: true, alphaTest: 0.3, depthWrite: false, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.cap = cap; this.next = 0; this.check = 0;
    this.at = new Float32Array(cap * 3);  // where each one lies
    this.live = new Uint8Array(cap);
  }

  add(x, y, z, size) {
    const i = this.next;
    this.at[i * 3] = x; this.at[i * 3 + 1] = y; this.at[i * 3 + 2] = z; this.live[i] = 1;
    this.next = (this.next + 1) % this.cap;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    _q.setFromAxisAngle(_up, Math.random() * TAU);
    _m.compose(_v.set(x, y, z), _q, _s.set(size * rand(0.8, 1.3), 1, size * rand(0.8, 1.3)));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * A few a frame: is the floor or street each lies on still there? A splat on a floor that was
   * blown away, or on a slab that fell, goes with it rather than hanging in the air.
   * groundAt(x, z, y): the top under (x, z) at or below y.
   */
  update(groundAt, lift) {
    const n = this.mesh.count;
    for (let k = 0; k < Math.min(24, n); k++) {
      const i = (this.check = (this.check + 1) % n);
      if (!this.live[i]) continue;
      const x = this.at[i * 3], y = this.at[i * 3 + 1], z = this.at[i * 3 + 2];
      if (groundAt(x, z, y + lift) > y - lift * 0.6) continue;
      this.live[i] = 0;
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// ---- the crowd ------------------------------------------------------------------

// How a dead body lies: position, sink, squash, heading and tilt (see People.still)
const SIG = new Float64Array(11);

export class People {
  /** opts: { scene, world, fx, sound, mobile } */
  constructor({ scene, world, fx, sound, mobile = false }) {
    this.world = world; this.city = world.city; this.fx = fx; this.sound = sound;
    this.M = world.city.M;
    this.cap = mobile ? 800 : 2000;
    this.walkers = mobile ? 110 : 280;
    this.radius = this.m(mobile ? 320 : 430);
    this.list = [];
    this.time = 0;
    this.spawnT = 0;
    this.wards = MODELS.map(wardrobe);
    // One InstancedMesh per part, sized for every person wearing it
    const G = partGeometries();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.02 });
    this.parts = {};
    for (const [name, geo] of Object.entries(G)) {
      const paired = name === 'uarm' || name === 'farm' || name === 'thigh' || name === 'shin' || name === 'shoe';
      const mesh = new THREE.InstancedMesh(geo, mat, this.cap * (paired ? 2 : 1));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = name !== 'shoe' && name !== 'visor' && name !== 'bun';
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.parts[name] = { mesh, n: 0 };
    }
    this.splats = new Splats(scene, mobile ? 250 : 600);
    // Sidewalk loops round every playable block
    const L = this.city.L;
    this.blocks = L.blocks.filter((B) => B.playable);
    this.blockAt = new Map(L.blocks.map((B) => [`${B.j},${B.k}`, B]));
    this.populated = new Map(); // struct -> centers already filled
  }

  m(x) { return x * this.M; }

  // ---- sidewalks ------------------------------------------------------------------

  /** The loop round a block, down the middle of its sidewalks: corners NW, NE, SE, SW */
  loop(B) {
    if (B.loop) return B.loop;
    const L = this.city.L, ax = L.aveWalk * 0.5, sz = L.stWalk * 0.5;
    const c = [[B.x0 - ax, B.z0 - sz], [B.x1 + ax, B.z0 - sz], [B.x1 + ax, B.z1 + sz], [B.x0 - ax, B.z1 + sz]];
    const len = [];
    for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; len.push(Math.hypot(b[0] - a[0], b[1] - a[1])); }
    return (B.loop = { c, len, total: len.reduce((a, b) => a + b, 0) });
  }

  /**
   * Position on a block's loop at distance s, offset sideways (positive: out toward the street).
   * The offset loop is the loop grown by off all round, so it turns its corners without a jump.
   */
  onLoop(B, s, off, out) {
    const lp = this.loop(B);
    s = ((s % lp.total) + lp.total) % lp.total;
    let e = 0;
    while (e < 3 && s > lp.len[e]) { s -= lp.len[e]; e++; }
    const a = lp.c[e], b = lp.c[(e + 1) % 4], f = s / lp.len[e];
    const dx = (b[0] - a[0]) / lp.len[e], dz = (b[1] - a[1]) / lp.len[e];
    // Corners NW, NE, SE, SW: out is -x or +x, and -z or +z
    const ox = (k) => (k === 0 || k === 3 ? -off : off), oz = (k) => (k < 2 ? -off : off), e1 = (e + 1) % 4;
    const x0 = a[0] + ox(e), z0 = a[1] + oz(e), x1 = b[0] + ox(e1), z1 = b[1] + oz(e1);
    out.set(x0 + (x1 - x0) * f, this.city.L.curb, z0 + (z1 - z0) * f);
    return { e, dx, dz, f };
  }

  // ---- people ----------------------------------------------------------------------

  /** A new person of model md at p: state idle; mode path (on B's loop), free, inside or air */
  add(md, p) {
    if (this.list.length >= this.cap) {
      // Make room: the dead first, then whoever is farthest from the mech (walkers, people in
      // buildings, people wandering off), never someone in mid-fall
      const P = this.player;
      let k = this.list.findIndex((q) => q.state === 'dead' && q.mode === 'dead');
      if (k < 0 && P) {
        let far = -1, best = 0;
        this.list.forEach((q, i) => { if (q.mode !== 'air' && q.mode !== 'slide') { const d = q.pos.distanceToSquared(P); if (d > best) { best = d; far = i; } } });
        k = far;
      }
      if (k < 0) return null;
      this.list.splice(k, 1);
    }
    const H = MODELS[md].h * this.M;
    const q = {
      md, H, pos: p.clone(), vel: new V3(), yaw: Math.random() * TAU, state: 'idle', mode: 'free', t: 0, phase: Math.random() * TAU,
      speed: 0, tilt: new THREE.Quaternion(), spin: new V3(), flat: 1, look: 0, fear: 0, life: 0, idleT: rand(0, 6), headYaw: 0,
      dead: 0, sink: 0, check: Math.random() * 0.3, maxY: p.y, flail: Math.random() * TAU, id: this.ids = (this.ids || 0) + 1, cache: null,
    };
    this.list.push(q);
    return q;
  }

  /** A walker on block B's loop */
  addWalker(B, s) {
    const q = this.add(Math.floor(Math.random() * MODELS.length), _v.set(0, 0, 0));
    if (!q) return null;
    q.mode = 'path'; q.B = B; q.s = s; q.dir = Math.random() < 0.5 ? 1 : -1;
    q.off = (q.dir > 0 ? -1 : 1) * this.m(rand(0.25, 0.7));
    q.pace = this.m(rand(1.15, 1.6));
    q.state = 'walk';
    this.onLoop(B, s, q.off, q.pos);
    return q;
  }

  /** Keep the sidewalks round the mech peopled: new walkers out of its sight, far ones moved on */
  repopulate(P, all = false) {
    const walkers = this.list.filter((q) => q.mode === 'path').length;
    let want = this.walkers - walkers;
    if (!all) want = Math.min(want, 6);
    const R = this.radius;
    for (let i = 0; i < want * 4 && want > 0; i++) {
      const B = pick(this.blocks);
      const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, d = Math.hypot(cx - P.x, cz - P.z);
      if (d > R * 0.8) continue;
      const s = Math.random() * this.loop(B).total;
      this.onLoop(B, s, 0, _a);
      const dp = Math.hypot(_a.x - P.x, _a.z - P.z);
      if (!all && dp < this.m(150)) continue;
      if (this.addWalker(B, s)) want--;
    }
  }

  // ---- what happens to them -----------------------------------------------------------

  /** Run from p for a while */
  scare(q, p, k = 1) {
    if (q.state === 'dead' || q.mode === 'air' || q.state === 'slide') return;
    q.fear = Math.max(q.fear, rand(6, 12) * k);
    q.from = (q.from || new V3()).copy(p);
    q.state = 'run';
  }

  /** Throw a person (or a body): off their feet, tumbling, the living flailing */
  thrown(q, vx, vy, vz) {
    q.mode = 'air';
    if (q.state !== 'dead') q.state = 'fall';
    q.vel.set(vx, vy, vz);
    q.spin.set(rand(-4, 4), rand(-2, 2), rand(-4, 4));
    q.maxY = q.pos.y;
    q.B = null;
    q.cross = null;
  }

  /**
   * Killed. splat: on the spot (a round, a hard landing), lying down at once with a red splat;
   * otherwise they topple over. Killed in mid-air, or over a drop, the body falls on.
   */
  die(q, splat = false) {
    if (q.state === 'dead') return;
    const air = q.mode === 'air';
    q.state = 'dead';
    q.mode = 'dead';
    q.dead = 0;
    if (splat) {
      q.tilt.setFromAxisAngle(_v.set(1, 0, 0), Math.random() < 0.5 ? -Math.PI / 2 : Math.PI / 2);
      q.dieT = 9;
    } else if (!air) { q.fallDir = Math.random() < 0.5 ? 1 : -1; q.dieT = 0; }
    q.tilt0 = q.tilt.clone();
    if (air || q.pos.y > this.groundAt(q.pos.x, q.pos.z, q.pos.y + this.m(0.3)) + this.m(0.3)) { q.mode = 'air'; q.maxY = q.pos.y; return; }
    q.vel.set(0, 0, 0);
    if (splat) this.splat(q);
  }

  splat(q, k = 1) {
    const g = this.groundAt(q.pos.x, q.pos.z, q.pos.y + this.m(0.4));
    this.splats.add(q.pos.x, g + this.m(0.03), q.pos.z, this.m(rand(0.9, 1.6) * k));
    const fx = this.fx;
    for (let i = 0; i < 8; i++) {
      fx.smoke.emit(q.pos.x, g + this.m(0.3), q.pos.z, rand(-2, 2), rand(1, 3), rand(-2, 2), rand(0.35, 0.7), this.m(0.25), this.m(0.6),
        0.55, 0.03, 0.03, 0.9, 0.35, 0.02, 0.02, 0, 0.5, -9);
    }
  }

  /** Something heavy came down on them (the mech's foot, a slab, a train car). Returns whether it did. */
  squish(q) {
    if (q.state === 'dead' && q.flat < 1) return false;
    q.state = 'dead'; q.mode = 'dead'; q.dead = 0;
    q.flat = 0.18;
    q.tilt.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2);
    q.tilt0 = q.tilt.clone();
    q.dieT = 9;
    q.vel.set(0, 0, 0);
    q.cross = null;
    q.pos.y = this.groundAt(q.pos.x, q.pos.z, q.pos.y + this.m(0.5));
    this.splat(q, 1.4);
    return true;
  }

  /** An explosion: thrown and killed near it (indoors, out through the hole it tears), sent running further out */
  blast(p, radius, amount) {
    const R = Math.max(radius * 1.25, this.m(5));
    for (const q of this.list) {
      if (q.state === 'dead' && q.mode !== 'dead') continue;
      const d = q.pos.distanceTo(p);
      if (d < R) {
        const k = (1 - d / R) * Math.min(1.6, 0.6 + amount / 80), s = this.indoors(q);
        if (s && q.state !== 'dead' && d > R * 0.45 && Math.abs(q.pos.y - p.y) < radius * 0.5 && Math.random() < 0.5) {
          // On the floor it tears open, clear of the worst: about half are left for the hole, to
          // slide backward into it once their floor has gone (see spill)
          q.rock = this.time;
          this.scare(q, p, 1);
          continue;
        }
        if (q.state === 'dead') { q.mode = 'air'; q.maxY = q.pos.y; }
        if (s) {
          // Indoors: out through the hole, not deeper into the building
          this.outward(s, q.pos, p, _v);
          this.thrown(q, _v.x * this.m(9 + 22 * k), this.m(2 + 6 * k), _v.z * this.m(9 + 22 * k));
        } else {
          _v.subVectors(q.pos, p).setY(0);
          if (_v.lengthSq() < 1e-6) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
          _v.normalize();
          this.thrown(q, _v.x * this.m(9 + 22 * k), this.m(4 + 12 * k), _v.z * this.m(9 + 22 * k));
        }
        // Close in, it's over before they land
        if (d < R * 0.45) q.doomed = true;
      } else if (d < R * 5) this.scare(q, p, 1);
    }
  }

  /** The standing building someone is in (over its footprint, not out in the street), or null */
  indoors(q) {
    const s = q.s, p = q.pos;
    if (!s || s.dead || q.mode === 'path' || q.mode === 'free') return null;
    const B = s.box;
    return p.x > B.min.x && p.x < B.max.x && p.z > B.min.z && p.z < B.max.z ? s : null;
  }

  /**
   * The way out of s through a hole at h from p inside it (into out): from the building's middle
   * toward the hole, give or take 30°, and drawn in toward the hole from off to its side
   */
  outward(s, p, h, out) {
    const B = s.box;
    out.set(h.x - (B.min.x + B.max.x) / 2, 0, h.z - (B.min.z + B.max.z) / 2);
    if (out.lengthSq() < 1e-6) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    out.normalize();
    // Aimed past the hole: the part of the way to it across the way out
    const dx = h.x - p.x, dz = h.z - p.z, t = dx * out.x + dz * out.z, D = this.m(10);
    const a = Math.atan2(out.x * D + dx - out.x * t, out.z * D + dz - out.z * t) + rand(-Math.PI / 6, Math.PI / 6);
    return out.set(Math.sin(a), 0, Math.cos(a));
  }

  /** Something hit near p (a round, a bolt): those right there fall, those near flinch and run */
  hit(p, r) {
    for (const q of this.list) {
      if (q.state === 'dead') continue;
      const d = q.pos.distanceTo(p);
      if (d < r + this.m(0.4)) { this.die(q, true); }
      else if (d < this.m(30)) this.scare(q, p, 0.8);
    }
  }

  /** A falling piece of building: those inside its solid cells are crushed */
  crushIn(b, inside) {
    for (const q of this.list) {
      if (q.state === 'dead' && q.flat < 1) continue;
      _a.copy(q.pos); _a.y += q.H * 0.5;
      if (inside(_a)) this.squish(q);
    }
  }

  /** What a person standing or falling at (x, z), feet at y, comes to rest on: floors, streets, or the river */
  groundAt(x, z, y) {
    const g = this.world.groundHeight(x, z, y, this.m(0.25)), D = this.world.destruct;
    return g <= 0 && D && D.ground(x, z) < 0 ? D.ground(x, z) : g;
  }

  // ---- people in buildings -----------------------------------------------------------

  /**
   * A building was broken open at (x, y, z), r across, vol m³ of it blown away: the first time
   * round there, its floors round the hole fill with people, and a crowd right by the hole, the
   * bigger it is. Then the hole spills them (see spill). Returns the places taken the first time,
   * for the furniture.
   */
  occupy(s, x, y, z, r, crowd, vol = 0) {
    if (s.body || s.dead) return;
    let list = this.populated.get(s);
    if (!list) this.populated.set(s, (list = []));
    const near = this.m(22), id0 = this.ids || 0;
    // One for about every three cubic meters blown away in a busy office, fewer in a quiet home:
    // a bullet hole lets out none or one, a crater a crowd
    const n = Math.floor((3 * vol * (0.25 + crowd)) / 8 + Math.random());
    let fresh = true, spots = null;
    for (const c of list) if ((c.x - x) ** 2 + (c.y - y) ** 2 + (c.z - z) ** 2 < near * near) { fresh = false; break; }
    if (fresh) {
      list.push(new V3(x, y, z));
      // Busy floors: three times the people a quiet building would have
      spots = this.floorSpots(s, x, y, z, this.m(16), Math.round(3 * (10 + 22 * crowd)));
      // The crowd by the hole, on the floors it broke into
      const by = this.floorSpots(s, x, y + r * 0.2, z, r * 1.6, n, 0.35);
      for (let k = 0; k < by.length + spots.length; k++) {
        if (k >= by.length && Math.random() > 0.55 + crowd * 0.15) continue;
        const q = this.add(Math.floor(Math.random() * MODELS.length), k < by.length ? by[k] : spots[k - by.length]);
        if (!q) break;
        q.mode = 'inside'; q.s = s; q.state = Math.random() < 0.6 ? 'idle' : 'walk'; q.walkT = rand(1, 4);
        q.pace = this.m(rand(0.6, 1.1));
        q.yaw = Math.random() * TAU;
      }
    }
    this.spill(s, x, y, z, r, n, id0);
    return spots;
  }

  /**
   * A fresh hole in s at (x, y, z), r across. Within three times r of it, on a floor it broke
   * into, about half the people there slide backward toward it and off the broken edge; those
   * who have only just come (newer than id0: they never felt the blast) are thrown out through it,
   * nearest first. n of them in all, besides those the blast left for the hole (see blast). The
   * rest round it scramble away.
   */
  spill(s, x, y, z, r, n, id0) {
    const m = (v) => this.m(v), R = r * 3, R4 = r * 4, near = this.near || (this.near = []);
    near.length = 0;
    for (const q of this.list) {
      if (q.s !== s || q.mode !== 'inside' || q.state === 'dead') continue;
      const dx = q.pos.x - x, dy = q.pos.y - y, dz = q.pos.z - z;
      if (dx * dx + dz * dz > R4 * R4 || Math.abs(dy) > R) continue;
      q.hd = dx * dx + dy * dy + dz * dz;
      near.push(q);
    }
    if (!near.length) return;
    near.sort((a, b) => a.hd - b.hd);
    _a.set(x, y, z);
    for (const q of near) {
      const dx = q.pos.x - x, dz = q.pos.z - z, d = Math.hypot(dx, dz), dy = q.pos.y - m(0.25) - y, rock = q.rock === this.time;
      if (d < R) {
        // Whether their floor has a hole in it: just inside its edge, on their side
        const rh = Math.sqrt(Math.max(0, r * r - dy * dy)) * 0.6, f = d > 1e-3 ? Math.min(1, rh / d) : 0;
        const cut = rh > m(0.5) && !this.solid(x + dx * f, q.pos.y - m(0.25), z + dz * f);
        if (cut && (rock || (n > 0 && Math.random() < 0.5))) {
          if (!rock) n--;
          this.slideTo(q, x, z);
          continue;
        }
        if (rock || (q.id > id0 && n > 0 && Math.abs(dy) < r * 0.75)) {
          if (!rock) n--;
          // Thrown low across the floor, skidding (see flying), to go out of the hole slowly enough
          // to come down in the street below rather than over it
          this.outward(s, q.pos, _a, _v);
          const v = Math.sqrt(m(rand(3, 6)) ** 2 + 2 * m(4.5) * (d + m(2)));
          this.thrown(q, _v.x * v, m(rand(1, 2.5)), _v.z * v);
          continue;
        }
      }
      this.scare(q, _a, 0.6);
      q.edgeT = this.time;
    }
    near.length = 0;
  }

  /** Up to n places on the floors of s within R of (x, y, z) (up and down, v of that): standing room over a solid floor */
  floorSpots(s, x, y, z, R, n, v = 0.7) {
    const g = s.g, out = [], step = this.m(0.6);
    for (let k = 0; k < n * 5 && out.length < n; k++) {
      const px = x + rand(-R, R), pz = z + rand(-R, R), py = y + rand(-R, R) * v;
      let i = g.cellAt(px, py, pz);
      if (i < 0) continue;
      // Down the column to the floor under this point
      let yi = Math.floor(i / g.nxz);
      const col = i - yi * g.nxz;
      while (yi > 0 && g.mat[col + yi * g.nxz] < 3) yi--;
      if (g.mat[col + yi * g.nxz] < 3 || yi + 1 >= g.ny) continue;
      const top = g.ys[yi + 1];
      // Room to stand: the cells over it are rooms, not walls and not outside
      const above = col + (yi + 1) * g.nxz;
      if (g.mat[above] !== 1) continue;
      const above2 = g.cellAt(px, top + this.m(1.6), pz);
      if (above2 >= 0 && g.mat[above2] >= 3) continue;
      if (top < this.city.L.curb + step) continue;
      out.push(new V3(px, top, pz));
    }
    return out;
  }

  // ---- per frame -------------------------------------------------------------------

  /** ctx: { player, grounded, feet, camera } */
  update(dt, ctx) {
    this.time += dt;
    const P = ctx.player;
    this.player = P;
    if (!this.started) { this.started = true; this.repopulate(P, true); }
    this.splats.update(this.splatGround || (this.splatGround = (x, z, y) => this.groundAt(x, z, y)), this.m(0.3));
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.4;
      this.repopulate(P);
      // Walkers left far behind are moved on; the dead and the people in buildings far behind go too
      const R2 = (this.radius * 1.15) ** 2, R3 = R2 * 2.25;
      this.list = this.list.filter((q) => {
        const d2 = (q.pos.x - P.x) ** 2 + (q.pos.z - P.z) ** 2;
        return !(q.mode === 'path' ? d2 > R2 : q.mode !== 'air' && q.mode !== 'slide' && d2 > R3);
      });
    }
    // The mech's feet
    const m = (x) => this.m(x);
    if (ctx.grounded && ctx.feet) {
      for (const f of ctx.feet) {
        for (const q of this.list) {
          if (Math.abs(q.pos.x - f.x) > m(1.8) || Math.abs(q.pos.z - f.z) > m(1.8) || q.pos.y > f.y + m(1.5) || q.pos.y < f.y - m(2)) continue;
          if (Math.hypot(q.pos.x - f.x, q.pos.z - f.z) < m(1.6) && this.squish(q)) this.sound.crunch(q.pos);
        }
      }
    }
    const near2 = m(32) ** 2;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i];
      // The mech close by sends them running
      if (q.state !== 'dead' && q.mode !== 'air' && q.mode !== 'slide' && (q.pos.x - P.x) ** 2 + (q.pos.z - P.z) ** 2 < near2 && Math.abs(q.pos.y - P.y) < m(14)) this.scare(q, P, 0.5);
      this.step(q, dt);
      if (q.gone) this.list.splice(i, 1);
    }
    this.draw(ctx.camera ? ctx.camera.position : P);
  }

  step(q, dt) {
    const m = (x) => this.m(x);
    q.t += dt;
    q.flail += dt * 9;
    if (q.fear > 0) { q.fear -= dt; if (q.fear <= 0 && q.state === 'run') q.state = q.mode === 'inside' ? 'idle' : 'walk'; }
    switch (q.mode) {
      case 'path': this.walkPath(q, dt); break;
      case 'free': this.walkFree(q, dt); break;
      case 'inside': this.inside(q, dt); break;
      case 'slide': this.sliding(q, dt); break;
      case 'air': this.flying(q, dt); break;
      case 'dead': {
        q.dead += dt;
        if (q.dieT !== undefined && q.dieT < 1) {
          q.dieT = Math.min(1, q.dieT + dt * 1.6);
          // Down: lying where they fell
          if (q.dieT >= 1) { q.tilt.setFromAxisAngle(_v.set(1, 0, 0), Math.PI / 2 * (q.fallDir || 1)); q.dieT = 9; }
        }
        // Lie a while, then sink away
        if (q.dead > 45) { q.sink += dt * m(0.25); if (q.sink > q.H * 0.5) q.gone = true; }
        // The floor under a body goes: it falls again
        q.check -= dt;
        if (q.check <= 0) {
          q.check = 0.5;
          if (q.pos.y > this.city.L.curb + m(0.5) && this.groundAt(q.pos.x, q.pos.z, q.pos.y + m(0.3)) < q.pos.y - m(0.5)) { q.mode = 'air'; q.maxY = q.pos.y; q.vel.set(0, 0, 0); }
        }
        break;
      }
    }
    // Animation phase: steps per second by gait
    const f = q.state === 'run' ? 2.6 : q.state === 'walk' ? 1.8 : q.state === 'slide' ? 4 : 0;
    q.phase += dt * f * Math.PI;
  }

  solid(x, y, z) { const D = this.world.destruct; return D ? D.solidAt(x, y, z) : y < 0; }

  walkPath(q, dt) {
    const m = (x) => this.m(x);
    if (q.cross) {
      // Crossing a street to the next block
      const c = q.cross, v = (q.state === 'run' ? q.pace * 3 : q.pace) * dt;
      c.u = Math.min(1, c.u + v / c.len);
      q.pos.lerpVectors(c.a, c.b, c.u);
      // Down off the curb onto the road, and up again at the far side
      if (c.road) { const e = this.m(2.5) / c.len; if (c.u > e && c.u < 1 - e) q.pos.y = 0; }
      q.yaw = Math.atan2(c.b.x - c.a.x, c.b.z - c.a.z);
      if (c.u >= 1) { q.B = c.B; q.s = c.s; q.cross = null; }
      return;
    }
    if (q.state === 'idle') {
      q.idleT -= dt;
      if (q.idleT <= 0) { q.state = 'walk'; q.walkT = rand(8, 30); }
    } else if (q.state === 'walk') {
      q.walkT = (q.walkT ?? rand(8, 30)) - dt;
      if (q.walkT <= 0) { q.state = 'idle'; q.idleT = rand(1.5, 6); }
    }
    if (q.state === 'run' && q.from) {
      // Away from the trouble along the loop: whichever way opens the distance
      const now = this.onLoop(q.B, q.s, q.off, _a);
      const away = (now.dx * (q.pos.x - q.from.x) + now.dz * (q.pos.z - q.from.z)) * q.dir;
      if (away < -m(2)) q.dir = -q.dir;
    }
    const v = q.state === 'run' ? q.pace * 3.4 : q.state === 'walk' ? q.pace : 0;
    if (v === 0) return;
    const lp = this.loop(q.B), before = this.onLoop(q.B, q.s, q.off, _b);
    q.s += v * dt * q.dir;
    const at = this.onLoop(q.B, q.s, q.off, q.pos);
    q.yaw = Math.atan2(at.dx * q.dir, at.dz * q.dir);
    // Rubble or a wreck on the sidewalk: turn back
    q.check -= dt;
    if (q.check <= 0) {
      q.check = 0.5;
      if (this.solid(q.pos.x + at.dx * q.dir * m(1.2), q.pos.y + m(0.8), q.pos.z + at.dz * q.dir * m(1.2))) q.dir = -q.dir;
    }
    // Round a corner: now and then straight on over the street to the next block instead
    if (at.e !== before.e && Math.random() < 0.45) {
      const dx = before.dx * q.dir, dz = before.dz * q.dir;
      const N = this.blockAt.get(`${q.B.j + Math.round(dx)},${q.B.k + Math.round(dz)}`);
      if (N && N.playable) {
        // The corner of the next block facing this one across the street
        const corner = lp.c[q.dir > 0 ? (before.e + 1) % 4 : before.e], lp2 = this.loop(N);
        let best = 0, bd = Infinity, acc = 0;
        for (let k = 0; k < 4; k++) {
          const c = lp2.c[k], d = (c[0] - corner[0]) ** 2 + (c[1] - corner[1]) ** 2;
          if (d < bd) { bd = d; best = acc; }
          acc += lp2.len[k];
        }
        // From where it stands to the same place on the far side, keeping to its side of the walk
        const a = q.pos.clone(), b = new V3();
        this.onLoop(N, best, q.off, b);
        const len = a.distanceTo(b);
        if (len < m(45)) {
          q.cross = { a, b, len, u: 0, B: N, s: best, road: true };
        }
      }
    }
  }

  walkFree(q, dt) {
    const m = (x) => this.m(x);
    // Thrown clear, or fallen out of a building: run off a while, then back to the sidewalks
    const v = q.state === 'run' ? m(5) : q.state === 'walk' ? m(1.3) : 0;
    if (q.state !== 'run' && q.state !== 'walk') {
      q.idleT -= dt;
      if (q.idleT <= 0) { q.state = 'walk'; }
    }
    q.dodge = (q.dodge || 0) - dt;
    if (q.from && q.state === 'run' && q.dodge <= 0) {
      // Turn (the short way round) to run away from the trouble
      const a = Math.atan2(q.pos.x - q.from.x, q.pos.z - q.from.z);
      let d = (a - q.yaw) % TAU;
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      q.yaw += clamp(d, -dt * 4, dt * 4);
    }
    if (v > 0) {
      q.pos.x += Math.sin(q.yaw) * v * dt;
      q.pos.z += Math.cos(q.yaw) * v * dt;
      if (this.world.resolve(q.pos, m(0.3), q.H, q.pos.y + m(0.3))) { q.yaw += rand(1, 2.5); q.dodge = 0.8; }
      const g = this.groundAt(q.pos.x, q.pos.z, q.pos.y + m(0.5));
      if (g < q.pos.y - m(0.8)) { q.mode = 'air'; q.state = 'fall'; q.maxY = q.pos.y; q.vel.set(Math.sin(q.yaw) * v, 0, Math.cos(q.yaw) * v); return; }
      q.pos.y = g;
    }
    // Calmed down at street level: walk over to the nearest block's sidewalk and carry on round it
    q.check -= dt;
    if (q.check <= 0 && q.state === 'walk' && q.fear <= 0 && q.pos.y < this.city.L.curb + m(0.5)) {
      q.check = 1;
      const B = this.nearestBlock(q.pos);
      if (B) {
        const lp = this.loop(B);
        let best = 0, bd = Infinity;
        for (let s = 0; s < lp.total; s += m(2)) { this.onLoop(B, s, 0, _a); const d = _a.distanceToSquared(q.pos); if (d < bd) { bd = d; best = s; } }
        if (bd < m(40) ** 2) {
          const b = new V3();
          this.onLoop(B, best, 0, b);
          const len = Math.max(1e-3, b.distanceTo(q.pos));
          q.mode = 'path'; q.B = B; q.s = best; q.dir = Math.random() < 0.5 ? 1 : -1; q.off = 0; q.pace = q.pace || m(1.3);
          q.cross = { a: q.pos.clone(), b, len, u: 0, B, s: best };
        }
      }
    }
  }

  nearestBlock(p) {
    let best = null, bd = Infinity;
    for (const B of this.blocks) {
      const dx = Math.max(B.x0 - p.x, 0, p.x - B.x1), dz = Math.max(B.z0 - p.z, 0, p.z - B.z1), d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = B; }
    }
    return best;
  }

  /** In a broken building: milling about the floor, until it goes or the next blast comes */
  inside(q, dt) {
    const m = (x) => this.m(x);
    q.check -= dt;
    if (q.check <= 0) {
      q.check = 0.3;
      if (q.s.dead || !this.solid(q.pos.x, q.pos.y - m(0.25), q.pos.z)) { this.thrown(q, rand(-1, 1), 0, rand(-1, 1)); return; }
    }
    if (q.state === 'idle') {
      q.idleT -= dt;
      if (q.idleT <= 0) { q.state = 'walk'; q.walkT = rand(1, 4); q.yaw = Math.random() * TAU; }
      return;
    }
    const v = q.state === 'run' ? q.pace * 3.5 : q.pace;
    if (q.state === 'walk') { q.walkT -= dt; if (q.walkT <= 0) { q.state = 'idle'; q.idleT = rand(2, 8); return; } }
    q.dodge = (q.dodge || 0) - dt;
    if (q.state === 'run' && q.from && q.dodge <= 0) q.yaw = Math.atan2(q.pos.x - q.from.x, q.pos.z - q.from.z) + Math.sin(q.t * 2) * 0.4;
    const nx = q.pos.x + Math.sin(q.yaw) * v * dt, nz = q.pos.z + Math.cos(q.yaw) * v * dt;
    // Keep to the room: no walking into walls (turning off along them a while), nor (mostly) off the edge of the floor
    if (this.solid(nx, q.pos.y + m(0.9), nz)) { q.yaw += rand(1.5, 3); q.dodge = rand(0.6, 1.4); return; }
    if (!this.solid(nx, q.pos.y - m(0.25), nz)) {
      // At a broken edge: some running slide backward off it, and by a fresh hole many do,
      // scrambling or not
      const fresh = q.edgeT !== undefined && this.time - q.edgeT < 15;
      if (Math.random() < (q.state === 'run' ? (fresh ? 0.6 : 0.25) : fresh ? 0.35 : 0)) { this.edge(q, nx, nz); return; }
      q.yaw += rand(2, 3.5); return;
    }
    q.pos.x = nx; q.pos.z = nz;
  }

  /** Over the edge of a broken floor: some slide backward off it, flailing */
  edge(q, nx, nz) {
    q.mode = 'slide'; q.state = 'slide'; q.slip = 0; q.t2 = 0;
    q.vel.set(Math.sin(q.yaw), 0, Math.cos(q.yaw)).multiplyScalar(this.m(2));
    q.yaw += Math.PI; // turned back toward the floor they're losing
  }

  /** Slide backward toward a hole at (x, z) in their floor, faster and faster as it sags into it, and off its edge */
  slideTo(q, x, z) {
    const dx = x - q.pos.x, dz = z - q.pos.z, L = Math.hypot(dx, dz) || 1;
    q.mode = 'slide'; q.state = 'slide'; q.t2 = 0;
    q.hole = (q.hole || new V3()).set(x, q.pos.y, z);
    q.slip = this.m(rand(2.2, 3.6));
    q.vel.set(dx / L, 0, dz / L).multiplyScalar(this.m(rand(1, 2.5)));
    q.yaw = Math.atan2(-dx, -dz); // facing back into the building as they go
  }

  /** Sliding backward across a floor toward its broken edge, then off it */
  sliding(q, dt) {
    const m = (x) => this.m(x);
    if (q.slip) {
      // Down the sagging floor into the hole, faster and faster
      const dx = q.hole.x - q.pos.x, dz = q.hole.z - q.pos.z, L = Math.hypot(dx, dz);
      if (L > m(0.2)) { q.vel.x += (dx / L) * q.slip * dt; q.vel.z += (dz / L) * q.slip * dt; }
      const sp = q.vel.length();
      if (sp > m(7)) q.vel.multiplyScalar(m(7) / sp);
    } else if (q.vel.length() > m(1.2)) q.vel.multiplyScalar(Math.exp(-dt * 0.6));
    q.pos.addScaledVector(q.vel, dt);
    // Into a wall or a column: back off it
    if (this.solid(q.pos.x, q.pos.y + m(0.9), q.pos.z)) { q.pos.addScaledVector(q.vel, -dt); q.vel.multiplyScalar(-0.3); }
    // Off the edge
    if (!this.solid(q.pos.x, q.pos.y - m(0.25), q.pos.z)) {
      q.slip = 0;
      this.thrown(q, q.vel.x, m(0.5), q.vel.z);
      q.spin.set(rand(-1.5, -0.5) * Math.sign(Math.random() - 0.5), 0, 0);
      return;
    }
    q.t2 = (q.t2 || 0) + dt;
    if (q.t2 > (q.slip ? 6 : 3.5)) { q.t2 = 0; q.slip = 0; q.mode = q.s ? 'inside' : 'free'; q.state = 'run'; q.fear = 4; }
  }

  /** In the air: falling, tumbling, until something solid stops them */
  flying(q, dt) {
    const m = (x) => this.m(x), G = 9.81 * this.M * 1.3;
    q.vel.y -= G * dt;
    const nx = q.pos.x + q.vel.x * dt, ny = q.pos.y + q.vel.y * dt, nz = q.pos.z + q.vel.z * dt;
    // Into a wall: drop down it
    if (this.solid(nx, ny + q.H * 0.5, nz)) { q.vel.x *= -0.2; q.vel.z *= -0.2; }
    else { q.pos.x = nx; q.pos.z = nz; }
    q.pos.y = ny;
    if (q.state !== 'dead') {
      // Tumble as they fall
      _q.setFromEuler(_e.set(q.spin.x * dt, q.spin.y * dt, q.spin.z * dt));
      q.tilt.multiply(_q);
    }
    q.maxY = Math.max(q.maxY, q.pos.y);
    // Rising (thrown up), nothing to land on yet: but not up through a ceiling
    if (q.vel.y > 0) {
      if (this.solid(q.pos.x, q.pos.y + q.H, q.pos.z)) q.vel.y = -q.vel.y * 0.2;
      return;
    }
    const g = this.groundAt(q.pos.x, q.pos.z, q.pos.y + m(0.6));
    if (q.pos.y <= g) {
      q.pos.y = g;
      const impact = -q.vel.y, hard = q.doomed || impact > m(8.5) || q.maxY - g > m(5);
      // Into the river: gone under
      if (g < 0) {
        q.gone = true;
        this.fx.smoke.emit(q.pos.x, g + m(0.2), q.pos.z, 0, m(3), 0, 0.6, m(0.3), m(1.4), 0.85, 0.9, 0.95, 0.7, 0.85, 0.9, 0.95, 0, 0.5, -6);
        return;
      }
      // Thrown across a floor in a building: skidding and tumbling along it, slowing, till they
      // stop or go over the edge of the hole they were blown at
      const h = Math.hypot(q.vel.x, q.vel.z);
      if (!hard && h > m(2.5) && q.s && !q.s.dead && g > this.city.L.curb + m(1)) {
        const k = Math.max(0, h - m(4.5) * dt) / h;
        q.vel.x *= k; q.vel.z *= k; q.vel.y = 0;
        q.spin.multiplyScalar(Math.exp(-dt * 4));
        return;
      }
      if (q.state === 'dead') {
        q.mode = 'dead'; q.vel.set(0, 0, 0);
        if (q.dieT === undefined || q.dieT < 9) { q.tilt.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2); q.dieT = 9; }
        q.tilt0 = q.tilt.clone();
        if (hard && q.flat === 1) { q.flat = 0.55; this.splat(q); }
        return;
      }
      if (hard) {
        q.mode = 'free';
        this.die(q, true);
        q.flat = 0.55;
        this.sound.crunch(q.pos);
      } else {
        // Got up again: run, out in the street or still in the building
        q.tilt.identity();
        q.vel.set(0, 0, 0);
        q.mode = this.indoors(q) && g > this.city.L.curb + m(1) ? 'inside' : 'free';
        q.state = 'run';
        q.fear = rand(6, 12);
        q.from = q.from || q.pos.clone().add(_v.set(rand(-1, 1), 0, rand(-1, 1)));
      }
    }
    if (q.pos.y < this.city.L.water - m(4)) q.gone = true;
  }

  // ---- drawing --------------------------------------------------------------------

  /** The joint angles of a pose: { legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, outL, outR, lean, bob, head } */
  pose(q, o) {
    const p = q.phase, s = Math.sin(p), c = Math.cos(p);
    o.legOut = 0.04; o.armOut = 0.08; o.head = q.headYaw; o.bob = 0; o.lean = 0; o.twist = 0;
    switch (q.state) {
      case 'walk':
        o.legL = -0.42 * s; o.legR = 0.42 * s;
        o.kneeL = Math.max(0, Math.sin(p + 1.2)) * 0.55 + 0.05; o.kneeR = Math.max(0, Math.sin(p + 1.2 + Math.PI)) * 0.55 + 0.05;
        o.armL = 0.35 * s; o.armR = -0.35 * s; o.elbowL = 0.25; o.elbowR = 0.25;
        o.bob = Math.abs(c) * 0.025; o.lean = 0.04; o.twist = 0.08 * s;
        break;
      case 'run':
        o.legL = -0.85 * s; o.legR = 0.85 * s;
        o.kneeL = Math.max(0, Math.sin(p + 1.4)) * 1.4 + 0.15; o.kneeR = Math.max(0, Math.sin(p + 1.4 + Math.PI)) * 1.4 + 0.15;
        o.armL = 0.8 * s; o.armR = -0.8 * s; o.elbowL = 1.45; o.elbowR = 1.45;
        o.bob = Math.abs(c) * 0.07; o.lean = 0.28; o.twist = 0.16 * s; o.armOut = 0.15;
        break;
      case 'slide': {
        // Leaning back, feet scrabbling at the floor, arms windmilling forward
        const f = q.flail;
        o.legL = -0.5 - 0.45 * s; o.legR = -0.5 + 0.45 * s; o.kneeL = 0.6 + 0.4 * Math.max(0, s); o.kneeR = 0.6 + 0.4 * Math.max(0, -s);
        o.armL = -1.6 + Math.sin(f) * 1.4; o.armR = -1.6 + Math.sin(f + Math.PI) * 1.4; o.elbowL = 0.3; o.elbowR = 0.3; o.armOut = 0.5;
        o.lean = -0.45; o.bob = -0.06;
        break;
      }
      case 'fall': {
        // Arms and legs flailing every which way
        const f = q.flail;
        o.legL = -0.6 + Math.sin(f * 1.1) * 0.9; o.legR = -0.6 + Math.sin(f * 1.1 + 2) * 0.9;
        o.kneeL = 0.7 + Math.sin(f * 1.7) * 0.6; o.kneeR = 0.7 + Math.sin(f * 1.7 + 1) * 0.6;
        o.armL = -2.4 + Math.sin(f) * 1.1; o.armR = -2.4 + Math.sin(f + 2.4) * 1.1; o.elbowL = 0.5 + Math.sin(f * 1.3) * 0.4; o.elbowR = 0.5;
        o.armOut = 0.7 + Math.sin(f * 0.7) * 0.3; o.legOut = 0.25; o.lean = 0.2 * Math.sin(f * 0.5);
        break;
      }
      case 'dead':
        o.legL = -0.15; o.legR = 0.2; o.kneeL = 0.3; o.kneeR = 0.1; o.armL = -0.4; o.armR = -2.6; o.elbowL = 0.6; o.elbowR = 0.2;
        o.armOut = 0.9; o.legOut = 0.22;
        break;
      default: {
        // Idle: weight shifting, the odd look round
        const b = Math.sin(q.t * 1.3 + q.phase);
        o.legL = 0.02 * b; o.legR = -0.02 * b; o.kneeL = 0.04; o.kneeR = 0.04;
        o.armL = 0.05 * b; o.armR = -0.05 * b; o.elbowL = 0.15; o.elbowR = 0.15; o.bob = 0.005 * b;
        o.head = Math.sin(q.t * 0.37 + q.phase) * 0.6;
      }
    }
    return o;
  }

  /** Every visible person's parts into the instanced meshes, nearest ones first */
  draw(cam) {
    for (const k in this.parts) this.parts[k].n = 0;
    // Out past 400 m a person is a few pixels: not drawn. Past 40 m their pose is worked out every
    // other frame, past 110 m every third (each on its own frame), and drawn from the last one in
    // between. The dead lying still are drawn from the last one for as long as they lie there.
    const far2 = this.m(400) ** 2, mid2 = this.m(110) ** 2, near2 = this.m(40) ** 2, o = {}, f = (this.frameN = (this.frameN || 0) + 1);
    for (const q of this.list) {
      const dx = q.pos.x - cam.x, dz = q.pos.z - cam.z, d2 = dx * dx + dz * dz;
      if (d2 > far2) continue;
      // (a pose from frames ago, from before they went out of sight, won't do)
      const fresh = q.cache && q.cacheF > f - 4;
      if (q.cache && (q.state === 'dead' ? q.dieT >= 1 && this.still(q) : fresh && (d2 > mid2 ? (f + q.id) % 3 : d2 > near2 && (f + q.id) % 2))) { this.replay(q); continue; }
      this.body(q, this.pose(q, o));
      q.cacheF = f;
    }
    // Only what was written goes up to the GPU
    for (const k in this.parts) {
      const P = this.parts[k];
      P.mesh.count = P.n;
      if (!P.n) continue;
      const A = P.mesh.instanceMatrix, C = P.mesh.instanceColor;
      A.clearUpdateRanges(); A.addUpdateRange(0, P.n * 16); A.needsUpdate = true;
      C.clearUpdateRanges(); C.addUpdateRange(0, P.n * 3); C.needsUpdate = true;
    }
  }

  /** Whether a body lies just as it did when its parts were last laid out (and note how it lies now) */
  still(q) {
    const s = q.sig || (q.sig = new Float64Array(SIG.length)), p = q.pos, t = q.tilt;
    SIG[0] = p.x; SIG[1] = p.y; SIG[2] = p.z; SIG[3] = q.sink; SIG[4] = q.flat; SIG[5] = q.yaw; SIG[6] = q.headYaw;
    SIG[7] = t.x; SIG[8] = t.y; SIG[9] = t.z; SIG[10] = t.w;
    let same = true;
    for (let i = 0; i < SIG.length; i++) if (s[i] !== SIG[i]) { s[i] = SIG[i]; same = false; }
    return same;
  }

  /** Draw a person from the parts laid out last time (see body) */
  replay(q) {
    const c = q.cache;
    for (let k = 0; k < c.n; k++) {
      const P = c.parts[k], i = P.n++;
      P.mesh.instanceMatrix.array.set(c.mats.subarray(k * 16, k * 16 + 16), i * 16);
      const C = P.mesh.instanceColor.array, col = c.cols[k];
      C[i * 3] = col[0]; C[i * 3 + 1] = col[1]; C[i * 3 + 2] = col[2];
    }
  }

  /** Lay out one person's parts with the rig, keeping them for replay() */
  body(q, o) {
    const md = MODELS[q.md], k = this.M * md.h / 1.75, w = md.w;
    const hipY = 0.92;
    // Root: on the ground, turned to face the way they go, tipped over when falling or lying
    _q.setFromAxisAngle(_up, q.yaw);
    const root = _r.compose(_v.set(q.pos.x, q.pos.y - q.sink, q.pos.z), _q, _s.set(k, k * q.flat, k));
    if (q.state === 'dead' && q.dieT !== undefined && q.dieT < 1) {
      // Toppling over: about the feet, picking up speed
      const a = q.dieT * q.dieT * Math.PI / 2 * (q.fallDir || 1);
      _t.makeRotationX(a);
      root.multiply(_t);
    } else if (q.state === 'fall' || q.state === 'dead') {
      // Tumbling (or lying where they fell) about the middle of the body
      _t.makeTranslation(0, q.state === 'dead' ? 0.12 : hipY, 0); root.multiply(_t);
      _t.makeRotationFromQuaternion(q.tilt); root.multiply(_t);
      _t.makeTranslation(0, q.state === 'dead' ? -0.12 : -hipY, 0); root.multiply(_t);
    }
    const W = this.wards[q.md];
    const M = this.mats || (this.mats = {
      pel: new THREE.Matrix4(), tor: new THREE.Matrix4(), head: new THREE.Matrix4(), tmp: new THREE.Matrix4(), ua: new THREE.Matrix4(), fa: new THREE.Matrix4(), th: new THREE.Matrix4(), sh: new THREE.Matrix4(),
    });
    // Pelvis and torso
    M.pel.copy(root).multiply(_t.makeTranslation(0, hipY + o.bob, 0)).multiply(_t.makeRotationY(-o.twist * 0.5));
    M.tor.copy(M.pel).multiply(_t.makeTranslation(0, 0.06, 0)).multiply(_t.makeRotationX(o.lean)).multiply(_t.makeRotationY(o.twist));
    M.head.copy(M.tor).multiply(_t.makeTranslation(0, 0.56, 0)).multiply(_t.makeRotationY(o.head * 0.8));
    const cache = q.cache || (q.cache = { n: 0, parts: [], cols: [], mats: new Float32Array(16 * 24) });
    cache.n = 0;
    for (const it of W) {
      switch (it.part) {
        case 'pelvis': this.put(cache, 'pelvis', M.pel, w, 1, w, it.color); break;
        case 'torso': case 'pack': this.put(cache, it.part, M.tor, w, 1, w, it.color); break;
        case 'purse': this.put(cache, 'purse', M.pel, w, 1, w, it.color); break;
        case 'skirt': this.put(cache, 'skirt', M.pel, w, 1, w, it.color); break;
        case 'head': case 'hair': case 'hairBack': case 'bun': case 'hatTop': case 'hatBrim': case 'visor': {
          const afro = it.part === 'hair' && MODELS[q.md].hair.style === 'afro' ? 1.35 : 1;
          this.put(cache, it.part, M.head, afro, afro, afro, it.color);
          break;
        }
        case 'uarm': {
          for (let side = -1; side <= 1; side += 2) {
            const swing = side < 0 ? o.armL : o.armR, elbow = side < 0 ? o.elbowL : o.elbowR;
            M.ua.copy(M.tor).multiply(_t.makeTranslation(side * 0.215 * w, 0.5, 0)).multiply(_t.makeRotationZ(side * o.armOut)).multiply(_t.makeRotationX(swing));
            this.put(cache, 'uarm', M.ua, 1, 1, 1, it.color);
            M.fa.copy(M.ua).multiply(_t.makeTranslation(0, -0.3, 0)).multiply(_t.makeRotationX(-elbow));
            this.put(cache, 'farm', M.fa, 1, 1, 1, W.farm);
          }
          break;
        }
        case 'thigh': {
          for (let side = -1; side <= 1; side += 2) {
            const swing = side < 0 ? o.legL : o.legR, knee = side < 0 ? o.kneeL : o.kneeR;
            M.th.copy(M.pel).multiply(_t.makeTranslation(side * 0.095 * w, -0.04, 0)).multiply(_t.makeRotationZ(side * o.legOut)).multiply(_t.makeRotationX(swing));
            this.put(cache, 'thigh', M.th, w, 1, w, it.color);
            M.sh.copy(M.th).multiply(_t.makeTranslation(0, -0.43, 0)).multiply(_t.makeRotationX(knee));
            this.put(cache, 'shin', M.sh, 1, 1, 1, W.shin);
            M.tmp.copy(M.sh).multiply(_t.makeTranslation(0, -0.43, 0)).multiply(_t.makeRotationX(-knee * 0.5));
            this.put(cache, 'shoe', M.tmp, 1, 1, 1, W.shoe);
          }
          break;
        }
        default: break; // farm, shin and shoe go with their limbs
      }
    }
  }

  /** One part of a person into its instanced mesh (scaled by sx, sy, sz in its own frame), and into their cache */
  put(cache, part, mat, sx, sy, sz, color) {
    const P = this.parts[part];
    if (!P) return;
    const i = P.n++;
    if (sx !== 1 || sy !== 1 || sz !== 1) mat = this.mats.tmp.copy(mat).multiply(_t.makeScale(sx, sy, sz));
    mat.toArray(P.mesh.instanceMatrix.array, i * 16);
    const C = P.mesh.instanceColor.array;
    C[i * 3] = color[0]; C[i * 3 + 1] = color[1]; C[i * 3 + 2] = color[2];
    const k = cache.n++;
    mat.toArray(cache.mats, k * 16);
    cache.parts[k] = P; cache.cols[k] = color;
  }
}
