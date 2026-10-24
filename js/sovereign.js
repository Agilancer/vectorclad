import * as THREE from './three.js';
import { frontPrism, sidePrism, chamferBox, cylX, cylZ, loft, place } from './atlas.js';
import { Mech, Thruster, Piston, LEG, warp, blade, loftZ } from './mech.js';

// ---------------------------------------------------------------------------
// BK-09 Sovereign: a black and gold heavy on the Vanguard's rig, after the
// Blueflow art with its palette swapped (blue plate to matte black, light-blue
// lines to gold, white to champagne, gray frame to gunmetal). Hunched under two
// great crescent pauldrons, its small beaked head sunk between them, it stands
// wide on thick rounded legs with curved greaves and heavy feet.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const mirror = (pts, s) => pts.map(([x, y]) => [x * s, y]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- textures and materials -------------------------------------------------

const PANELS = ['torso', 'shoulder', 'shin', 'joints', 'vents', 'hex', 'ceremonial', 'siege'];

/** Load the Sovereign's pages from textures/sovereign (base is the path to the repo root). */
export async function loadSovereignTextures(renderer, base = '') {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const get = async (name, srgb) => {
    const t = await loader.loadAsync(`${base}textures/sovereign/${name}.webp`);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    return t;
  };
  const tex = {};
  await Promise.all([
    ...['black', 'gold', 'champagne', ...PANELS].map(async (k) => { tex[k] = await get(k, true); }),
    ...PANELS.map(async (k) => { tex[k + 'MR'] = await get(k + '-mr', false); }),
  ]);
  return tex;
}

export function makeSovereignMaterials(tex) {
  const std = (p) => new THREE.MeshStandardMaterial(p);
  const m = {
    // Matte black plate over the whole frame
    armor: std({ map: tex.black, bumpMap: tex.black, bumpScale: 0.4, roughness: 0.62, metalness: 0.28 }),
    // Pale satin gold for the shoulder, arm and heel plates
    champ: std({ map: tex.champagne, bumpMap: tex.champagne, bumpScale: 0.3, roughness: 0.42, metalness: 0.62, color: 0xd2b896 }),
    // Rich gold and darker brass for the machinery, trim and fittings
    gold: std({ map: tex.gold, roughness: 0.3, metalness: 0.9 }),
    brass: std({ map: tex.gold, roughness: 0.42, metalness: 0.85, color: 0x8a6a42 }),
    joint: std({ color: 0x1b1c1f, roughness: 0.42, metalness: 0.75 }),
    frame: std({ color: 0x2c2d31, roughness: 0.4, metalness: 0.7 }),
    // Gunmetal for the frame showing between the plates
    gun: std({ color: 0x4d5056, roughness: 0.38, metalness: 0.8 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xffc35a, toneMapped: false }),
    sensor: new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }),
  };
  m.trim = m.gold;
  m.red = m.brass;
  // Paneled pages for the boxy parts, their gold trim metallic and their plate matte
  for (const k of PANELS) {
    m[k] = std({ map: tex[k], bumpMap: tex[k], bumpScale: 1.2, roughnessMap: tex[k + 'MR'], metalnessMap: tex[k + 'MR'], roughness: 1, metalness: 1, color: 0x8c8a86 });
  }
  return m;
}

// ---- geometry helpers ---------------------------------------------------------

/**
 * Box-projected UVs in model units: each triangle takes the plane it faces most,
 * and `k` texture repeats per unit. Repeating pages keep one panel scale everywhere.
 */
function boxUV(geo, k = 0.5, ou = 0, ov = 0) {
  if (geo.index) geo = geo.toNonIndexed();
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  const a = new V3(), b = new V3(), c = new V3(), n = new V3(), e = new V3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(e.subVectors(c, a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let j = 0; j < 3; j++) {
      const v = j === 0 ? a : j === 1 ? b : c;
      let u, w;
      if (ax >= ay && ax >= az) { u = n.x > 0 ? -v.z : v.z; w = v.y; }
      else if (ay >= az) { u = v.x; w = n.y > 0 ? -v.z : v.z; }
      else { u = n.z > 0 ? v.x : -v.x; w = v.y; }
      uv[(i + j) * 2] = u * k + ou;
      uv[(i + j) * 2 + 1] = w * k + ov;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** A shadowed mesh with box UVs at k repeats per unit */
function S(geo, mat, k = 0.6, ou = 0, ov = 0) {
  const m = new THREE.Mesh(boxUV(geo, k, ou, ov), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A thin plate cut to a side profile ([z, y] points), w thick across X */
function sideplate(pts, w, bevel = 0.015) { return sidePrism(pts, w, bevel); }

/**
 * Smooth loft along Y through superellipse sections { y, w, d, x?, z?, p? }:
 * w wide, d deep, centered on x/z; p is the squareness (2 an ellipse, 4 a soft box).
 * Smooth-shaded sides with flat caps, for the rounded armor.
 */
function sloft(secs, n = 24) {
  const pos = [], idx = [];
  const ring = (s) => {
    const p = s.p || 2.6, e = 2 / p, start = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
      pos.push((s.x || 0) + Math.sign(c) * Math.pow(Math.abs(c), e) * s.w / 2, s.y, (s.z || 0) + Math.sign(sn) * Math.pow(Math.abs(sn), e) * s.d / 2);
    }
    return start;
  };
  const rings = secs.map(ring);
  // Wind each band so its faces point away from the axis
  const flip = secs[0].y > secs[secs.length - 1].y;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = rings[r] + i, b = rings[r] + (i + 1) % n, c = rings[r + 1] + (i + 1) % n, d = rings[r + 1] + i;
      if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
    }
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sides.setIndex(idx);
  sides.computeVertexNormals();
  // Flat caps on their own vertices
  const cap = (s, up) => {
    const g = new THREE.BufferGeometry(), cp = [(s.x || 0), s.y, (s.z || 0)], ci = [];
    const p = s.p || 2.6, e = 2 / p;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
      cp.push((s.x || 0) + Math.sign(c) * Math.pow(Math.abs(c), e) * s.w / 2, s.y, (s.z || 0) + Math.sign(sn) * Math.pow(Math.abs(sn), e) * s.d / 2);
      const a = 1 + i, b = 1 + (i + 1) % n;
      if (up) ci.push(0, b, a); else ci.push(0, a, b);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    g.setIndex(ci);
    g.computeVertexNormals();
    return g.toNonIndexed();
  };
  const hi = secs[0].y > secs[secs.length - 1].y ? 0 : secs.length - 1;
  const lo = secs.length - 1 - hi;
  return mergeGeos([sides.toNonIndexed(), cap(secs[hi], true), cap(secs[lo], false)]);
}

/** Join non-indexed geometries with position and normal attributes */
function mergeGeos(list) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** n+1 points along fn(t), t from 0 to 1 */
const arc = (fn, n = 10) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));

/** A smooth dome: a sphere squashed to w×h×d, its lower part cut flat at y = cut (fraction of h/2) */
function dome(w, h, d, cut = -0.2, seg = 20) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.6));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i);
    if (y < cut) y = cut;
    p.setXYZ(i, p.getX(i) * w / 2, y * h / 2, p.getZ(i) * d / 2);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------

export class Sovereign extends Mech {
  constructor(mats, glowTex) {
    super(mats, glowTex);
    // A wide, planted stance
    this.idleFeet = [new V3(-1.62, 0, 0.42), new V3(1.68, 0, -0.3)];
    for (const A of this.arms) {
      A.upper = A.elbow.position.length();
      A.fore = new V3().copy(A.hand.position).add(A.mount.position).length();
    }
  }

  // ---- construction ----------------------------------------------------------

  buildPelvis() {
    const M = this.mats, p = this.pelvis;
    // Gunmetal frame on a hip axle, a black belt and a champagne tag on the codpiece
    place(p, S(sloft([
      { y: 0.32, w: 1.1, d: 0.76, p: 3 },
      { y: 0.0, w: 1.4, d: 0.86, p: 3 },
      { y: -0.36, w: 0.58, d: 0.6, p: 3 },
    ]), M.gun));
    place(p, S(cylX(0.2, 2.1), M.gun), 0, -0.18, 0);
    place(p, S(frontPrism([[-0.36, 0.22], [0.36, 0.22], [0.26, -0.2], [0.1, -0.44], [-0.1, -0.44], [-0.26, -0.2]], 0.2, 0.04), M.armor), 0, 0, 0.42);
    place(p, S(chamferBox(0.24, 0.13, 0.04, 0.02), M.champ), 0.04, -0.06, 0.53, 0, 0, -0.08);
    place(p, S(frontPrism([[-0.05, 0.04], [0.05, 0.04], [0, -0.05]], 0.03, 0.005), M.gold), -0.12, 0.12, 0.53).userData.noOutline = true;
    place(p, S(frontPrism([[-0.46, 0.24], [0.46, 0.24], [0.34, -0.36], [-0.34, -0.36]], 0.14, 0.03), M.armor), 0, 0, -0.44);
    // Short front flaps that follow the thighs
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.42, 0.06, 0.4);
      p.add(g);
      const k = new THREE.Group();
      k.rotation.set(-0.1, s * 0.35, 0);
      g.add(k);
      place(k, S(frontPrism(mirror([[-0.18, 0.08], [0.24, 0.08], [0.26, -0.4], [0.08, -0.62], [-0.16, -0.36]], s), 0.08, 0.025), M.armor));
      place(k, S(frontPrism(mirror([[0.16, 0.0], [0.2, 0.0], [0.2, -0.36], [0.07, -0.54], [0.06, -0.48], [0.16, -0.34]], s), 0.02, 0.004), M.gold), 0, 0, 0.05).userData.noOutline = true;
      return g;
    });
  }

  buildLeg(s) {
    const M = this.mats;
    const hip = new THREE.Group();
    hip.position.set(s * 0.88, -LEG.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, S(new THREE.SphereGeometry(0.3, 16, 10), M.gun));
    // Thigh: a bulbous black drum over the hip, with a champagne crescent band
    // round its inner face, swelling into a thick thigh
    const TH = LEG.thigh;
    place(hip, S(dome(1.4, 0.8, 1.42, -0.2), M.armor), s * 0.12, -0.02, 0.02);
    place(hip, S(new THREE.TorusGeometry(0.6, 0.075, 8, 28, Math.PI * 1.1), M.champ), -s * 0.1, -0.12, 0.08, 0, Math.PI / 2, -Math.PI * 0.3);
    place(hip, S(sloft([
      { y: 0.08, w: 1.36, d: 1.4, x: s * 0.12, p: 2.4 },
      { y: -0.65, w: 1.3, d: 1.36, x: s * 0.12, z: 0.04, p: 2.4 },
      { y: -1.25, w: 1.04, d: 1.1, x: s * 0.08, z: 0.06, p: 2.6 },
      { y: -TH + 0.18, w: 0.7, d: 0.78, z: 0.02, p: 2.8 },
    ]), M.armor, 0.5));
    // Gold seam lines on the thigh front, and a gunmetal strut behind
    place(hip, S(chamferBox(0.03, 0.9, 0.03, 0.01), M.gold), s * 0.3, -0.75, 0.7, -0.06, 0, 0).userData.noOutline = true;
    place(hip, S(sidePrism(arc((t) => [0.5 - 0.9 * t, -0.25 - 0.6 * Math.sin(Math.PI * t)], 10).concat(arc((t) => [-0.4 + 0.9 * t, -0.2 - 0.52 * Math.sin(Math.PI * (1 - t))], 10)), 0.02, 0.004), M.gold), s * 0.78, 0, 0).userData.noOutline = true;
    place(hip, S(new THREE.CylinderGeometry(0.16, 0.18, TH - 0.4, 12), M.gun), 0, -TH / 2 - 0.1, -0.3);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, S(cylX(0.3, 0.86, 18), M.gun));
    for (const x of [-0.45, 0.45]) place(knee, S(cylX(0.16, 0.05, 14), M.gold), x, 0, 0);
    // Knee cap with a champagne panel and a spur raking out the side
    place(knee, S(sloft([
      { y: 0.4, w: 0.76, d: 0.34, z: 0.48, p: 3 },
      { y: -0.1, w: 0.9, d: 0.44, z: 0.56, p: 3 },
      { y: -0.55, w: 0.64, d: 0.34, z: 0.46, p: 3 },
    ]), M.armor));
    place(knee, S(frontPrism([[-0.2, 0.2], [0.2, 0.2], [0.15, -0.12], [0, -0.26], [-0.15, -0.12]], 0.05, 0.012), M.champ), 0, 0, 0.8, -0.12, 0, 0);
    place(knee, S(blade([[0.3, 0.1], [0.0, 0.3], [-0.5, 0.62], [-0.38, 0.3], [0.1, -0.12]], 0.06, [0.4, 1], [1, 1], 0.008), M.armor), s * 0.5, -0.05, 0.1, 0, 0, -s * 0.3);

    // Shin: thick and rounded, swelling at the calf, with a gold-lit channel down the
    // front and a long curved greave bowing out along the outside
    const SH = LEG.shin;
    place(knee, S(sloft([
      { y: -0.05, w: 0.96, d: 1.08, z: -0.02, p: 2.5 },
      { y: -0.75, w: 1.1, d: 1.26, z: -0.06, p: 2.5 },
      { y: -1.7, w: 0.9, d: 1.06, z: -0.02, p: 2.6 },
      { y: -SH + 0.18, w: 0.64, d: 0.76, z: 0.04, p: 2.8 },
    ]), M.armor, 0.5));
    place(knee, S(chamferBox(0.28, SH - 0.7, 0.08, 0.06), M.gun), 0, -SH / 2 - 0.15, 0.6, 0.08, 0, 0);
    place(knee, S(chamferBox(0.07, SH - 0.9, 0.04, 0.02), M.gold), 0, -SH / 2 - 0.15, 0.65, 0.08, 0, 0).userData.noOutline = true;
    const greave = arc((t) => [0.5 - 0.3 * t + 0.08 * Math.sin(Math.PI * t), 0.3 - (SH + 0.1) * t], 12);
    const greaveBack = arc((t) => [-0.62 + 0.3 * t - 0.22 * Math.sin(Math.PI * t), -SH + 0.2 + (SH + 0.1) * t], 12);
    const gv = new THREE.Group();
    gv.position.set(s * 0.56, 0, 0);
    gv.rotation.z = s * 0.06;
    knee.add(gv);
    place(gv, S(sidePrism([...greave, ...greaveBack], 0.16, 0.05), M.armor, 0.5));
    place(gv, S(sidePrism([...arc((t) => [0.26 - 0.2 * t - 0.12 * Math.sin(Math.PI * t), -0.1 - 2.2 * t], 10), ...arc((t) => [0.18 - 0.2 * (1 - t) - 0.12 * Math.sin(Math.PI * (1 - t)), -2.3 + 2.2 * t], 10)], 0.02, 0.004), M.gold), s * 0.085, 0, 0).userData.noOutline = true;
    this.pistons.push(new Piston(hip, new V3(s * 0.2, -0.6, -0.4), knee, new V3(s * 0.2, -0.45, -0.42), 0.07, M, M.gun));
    place(knee, S(chamferBox(0.36, 0.3, 0.1, 0.04), M.gun), 0, -0.9, -0.5);
    for (const x of [-0.08, 0.08]) {
      this.thrusters.calf.push(new Thruster(knee, new V3(x, -0.88, -0.56), new V3(0, -0.85, -0.6), 0.09, this.glowTex));
    }

    const mount = new THREE.Group();
    mount.position.set(s * 0.5, -1.05, -0.06);
    mount.rotation.z = -s * Math.PI / 2;
    knee.add(mount);

    // Heavy foot: gunmetal sole and raised heel, black toe cap edged in gold,
    // a round ankle disc and spurs sweeping up off it
    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, S(new THREE.SphereGeometry(0.22, 14, 10), M.gun));
    place(ankle, S(sloft([{ y: 0.4, w: 0.66, d: 0.74, z: 0.02, p: 2.8 }, { y: 0.08, w: 0.74, d: 0.8, z: 0.06, p: 2.8 }, { y: -0.12, w: 0.7, d: 0.7, z: 0.1, p: 3 }]), M.armor));
    for (const sd of [-1, 1]) {
      place(ankle, S(cylX(0.24, 0.08, 18), M.gun), sd * 0.38, 0, 0);
      place(ankle, S(cylX(0.14, 0.1, 14), M.champ), sd * 0.4, 0, 0);
      place(ankle, S(blade([[0.1, 0.0], [-0.08, 0.1], [-0.5, 0.7], [-0.42, 0.72], [-0.16, -0.1]], 0.06, [0.4, 1], [1, 1], 0.008), M.armor), sd * 0.44, 0.05, -0.05);
    }
    place(ankle, S(sidePrism([[1.2, -0.42], [1.2, -0.55], [-0.72, -0.55], [-0.72, -0.3], [-0.36, -0.22], [0.5, -0.3]], 0.96, 0.05), M.gun));
    place(ankle, S(sloft([
      { y: -0.1, w: 0.78, d: 0.86, z: 0.2, p: 3.2 },
      { y: -0.42, w: 0.94, d: 1.4, z: 0.4, p: 3.6 },
    ]), M.armor));
    place(ankle, S(sidePrism([[1.22, -0.42], [1.1, -0.26], [0.7, -0.16], [0.62, -0.42]], 0.9, 0.03), M.armor), 0, 0, 0);
    for (const sd of [-1, 1]) place(ankle, S(chamferBox(0.02, 0.025, 0.5, 0.006), M.gold), sd * 0.475, -0.32, 0.6, 0.2, 0, 0).userData.noOutline = true;
    place(ankle, S(chamferBox(0.76, 0.2, 0.36, 0.06), M.armor), 0, -0.34, -0.6);
    return { s, hip, knee, ankle, mount };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.3;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Gunmetal spine with black belly plates
    place(waist, S(new THREE.CylinderGeometry(0.32, 0.4, 0.74, 16), M.gun), 0, 0.2, -0.04);
    place(waist, S(sloft([{ y: 0.46, w: 0.62, d: 0.3, z: 0.26, p: 3 }, { y: 0.04, w: 0.4, d: 0.24, z: 0.24, p: 3 }]), M.armor));

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.5;
    waist.add(chest);
    // Rounded core under a hooded collar
    place(chest, S(sloft([
      { y: 0.0, w: 1.0, d: 0.8, z: -0.06, p: 2.6 },
      { y: 0.6, w: 2.0, d: 1.36, z: -0.08, p: 2.8 },
      { y: 1.15, w: 2.4, d: 1.44, z: -0.14, p: 3 },
      { y: 1.52, w: 1.8, d: 1.06, z: -0.24, p: 3 },
    ]), M.armor, 0.5));
    // Gunmetal sternum frame between two rounded champagne chest plates, each edged in gold
    place(chest, S(sloft([{ y: 1.25, w: 0.32, d: 0.3, z: 0.62, p: 3 }, { y: 0.1, w: 0.22, d: 0.26, z: 0.5, p: 3 }]), M.gun));
    for (const sd of [-1, 1]) {
      const pg = new THREE.Group();
      pg.position.set(0, 0, 0.64);
      pg.rotation.set(0.14, sd * 0.32, 0);
      chest.add(pg);
      place(pg, S(frontPrism(mirror([[0.06, 0.4], [0.62, 0.52], [0.8, 0.86], [0.66, 1.24], [0.2, 1.3], [0.06, 1.1]], sd), 0.2, 0.06), M.armor, 0.5));
      place(pg, S(frontPrism(mirror([[0.12, 0.5], [0.56, 0.6], [0.68, 0.86], [0.58, 1.12], [0.22, 1.16], [0.12, 1.0]], sd), 0.12, 0.05), M.champ, 0.8), 0, 0, 0.1);
      place(pg, S(frontPrism(mirror([[0.6, 0.56], [0.64, 0.56], [0.75, 0.86], [0.63, 1.18], [0.6, 1.16], [0.7, 0.86]], sd), 0.02, 0.004), M.gold), 0, 0, 0.17).userData.noOutline = true;
      // Black plates wrapping round the ribs, and side vents
      place(chest, S(sidePrism([[0.62, 0.2], [0.5, 0.9], [0.1, 1.3], [-0.5, 1.2], [-0.62, 0.4], [-0.1, 0.0]], 0.1, 0.03), M.armor, 0.5), sd * 1.08, 0, -0.1);
      place(chest, S(chamferBox(0.5, 0.42, 0.1, 0.06), M.vents, 1.6), sd * 1.02, 0.5, -0.12, 0, sd * Math.PI / 2, 0);
    }
    // Collar: black hood plates rising behind the head, champagne inner faces
    for (const sd of [-1, 1]) {
      const c = new THREE.Group();
      c.position.set(sd * 0.6, 1.3, -0.1);
      c.rotation.set(-0.2, 0, -sd * 0.45);
      c.scale.setScalar(0.8);
      chest.add(c);
      place(c, S(blade([[0.5, -0.05], [0.36, 0.3], [-0.1, 0.5], [-0.5, 0.36], [-0.46, -0.1]], 0.3, [1, 1], [1, 0.6]), M.armor));
      place(c, S(blade([[0.36, 0.05], [0.26, 0.26], [-0.04, 0.38], [-0.3, 0.3], [-0.3, 0.05]], 0.05), M.champ), -sd * 0.16, 0.02, 0.02);
    }
    place(chest, S(chamferBox(0.12, 0.05, 0.04, 0.012), M.eye), 0, 0.28, 0.6).userData.noOutline = true;

    for (const [key, s] of [['shoulderR', -1], ['shoulderL', 1]]) {
      const m = new THREE.Group();
      m.position.set(s * 0.62, 1.52, -0.95);
      m.rotation.x = -0.12;
      chest.add(m);
      this.mounts[key] = m;
    }
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    // Sunk low and forward between the shoulders
    head.position.set(0, 1.72, 0.6);
    head.scale.setScalar(1.45);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, S(new THREE.CylinderGeometry(0.15, 0.18, 0.34, 12), M.gun), 0, 0, -0.12);
    // Gunmetal face under a black helmet that comes to a beak, a champagne crest
    place(head, S(sloft([
      { y: 0.36, w: 0.34, d: 0.46, z: 0.0, p: 2.6 },
      { y: 0.12, w: 0.44, d: 0.56, z: 0.04, p: 2.6 },
      { y: -0.1, w: 0.36, d: 0.44, z: 0.06, p: 2.6 },
    ]), M.gun));
    place(head, S(blade([[0.48, 0.12], [0.3, 0.36], [0.0, 0.48], [-0.3, 0.42], [-0.3, 0.16], [0.0, 0.1], [0.3, 0.02]], 0.48, [1, 0.45], [1, 0.7], 0.02), M.armor));
    place(head, S(blade([[0.46, 0.3], [0.3, 0.44], [0.0, 0.56], [-0.28, 0.56], [-0.1, 0.44], [0.2, 0.32]], 0.2, [1, 0.5], [1, 1], 0.012), M.champ));
    for (const sd of [-1, 1]) {
      place(head, S(blade([[0.26, 0.1], [0.1, 0.24], [-0.2, 0.26], [-0.26, -0.04], [0.0, -0.12], [0.24, -0.06]], 0.06, [1, 0.5]), M.armor), sd * 0.22, 0, 0, 0, -sd * 0.2, sd * 0.08);
      place(head, S(blade([[0.0, 0.0], [-0.1, 0.06], [-0.42, 0.3], [-0.36, 0.34], [-0.12, 0.1]], 0.04, [0.5, 1], [1, 1], 0.006), M.armor), sd * 0.18, 0.36, -0.08, 0, 0, -sd * 0.3);
    }
    // Visor: a gold slit with a glow
    place(head, new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.12), M.eye), 0, 0.12, 0.3).userData.noOutline = true;
    place(head, S(frontPrism([[-0.12, 0.0], [0.12, 0.0], [0.08, -0.14], [0, -0.2], [-0.08, -0.14]], 0.06, 0.01), M.champ), 0, 0.04, 0.32);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.5 }));
    glow.scale.setScalar(0.4);
    place(head, glow, 0, 0.12, 0.34);
    for (const sd of [-1, 1]) {
      this.pistons.push(new Piston(this.chest, new V3(sd * 0.4, 1.25, 0.1), head, new V3(sd * 0.18, 0.04, -0.1), 0.045, this.mats, M.gun));
    }
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.52, 1.14, -0.04);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, S(new THREE.SphereGeometry(0.32, 14, 10), M.gun));
    // Pauldron: a great swept crescent of black plate rising above the head, banded
    // in champagne along its crest and gunmetal inside, traced in gold
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.12, 0.2, 0);
    sh.add(pauldron);
    // The crescent leans out over the shoulder
    const lean = new THREE.Group();
    lean.position.set(s * 0.3, 0.05, 0);
    lean.rotation.z = -s * 0.42;
    pauldron.add(lean);
    place(pauldron, S(sloft([{ y: 0.42, w: 0.9, d: 1.0, x: s * 0.2, p: 3.4 }, { y: 0.1, w: 1.16, d: 1.24, x: s * 0.2, p: 3.4 }, { y: -0.4, w: 1.0, d: 1.1, x: s * 0.24, p: 3.4 }]), M.armor, 0.5));
    place(pauldron, S(chamferBox(0.5, 0.05, 0.03, 0.01), M.gold), s * 0.24, -0.12, 0.62).userData.noOutline = true;
    place(pauldron, S(chamferBox(0.4, 0.2, 0.04, 0.04), M.champ), s * 0.24, 0.12, 0.62);
    // One taper by height for every layer, so the bands and trims stay on the plate's faces
    const taper = (v) => { const t = clamp((v.y + 0.62) / 2.04, 0, 1); v.z *= 1 - 0.45 * t; v.z -= 0.2 * t; };
    const cres = [[-0.1, -0.5], [0.5, -0.62], [0.95, -0.42], [1.2, 0.0], [1.24, 0.45], [1.08, 0.95], [0.8, 1.42], [0.64, 1.1], [0.5, 0.72], [0.3, 0.48], [0.0, 0.4], [-0.22, 0.2]];
    place(lean, S(warp(frontPrism(mirror(cres, s), 1.25, 0.08), taper), M.armor, 0.5), 0, 0, -0.05);
    // Champagne band along the outer crest, gunmetal along the inner edge, gold between
    const band = [[0.6, -0.04], [0.98, 0.08], [1.08, 0.5], [0.95, 0.95], [0.76, 1.28], [0.66, 1.02], [0.7, 0.58]];
    place(lean, S(warp(frontPrism(mirror(band, s), 1.3, 0.04), taper), M.champ, 0.8), -s * 0.3, -0.05, -0.05);
    const inner = [[0.04, 0.34], [0.34, 0.42], [0.56, 0.66], [0.64, 1.0], [0.56, 0.96], [0.42, 0.66], [0.12, 0.48]];
    place(lean, S(warp(frontPrism(mirror(inner, s), 1.28, 0.03), taper), M.gun), -s * 0.3, -0.05, -0.05);
    const edge = arc((t) => [1.08 - 0.42 * t * t - 0.1 * t, -0.2 + 1.5 * t], 10);
    place(lean, S(warp(frontPrism(mirror([...edge, ...edge.slice().reverse().map(([x, y]) => [x - 0.04, y])], s), 1.33, 0.004), taper), M.gold), -s * 0.3, -0.05, -0.05).userData.noOutline = true;
    const trim = [[0.56, -0.06], [0.6, -0.06], [0.68, 0.58], [0.64, 1.04], [0.6, 1.02], [0.64, 0.58]];
    place(lean, S(warp(frontPrism(mirror(trim, s), 1.33, 0.004), taper), M.gold), -s * 0.3, -0.05, -0.05).userData.noOutline = true;
    // Gunmetal inner face and a shoulder block under the crescent
    place(pauldron, S(sloft([{ y: 0.1, w: 0.8, d: 0.9, x: s * 0.24, p: 3 }, { y: -0.55, w: 0.72, d: 0.8, x: s * 0.26, p: 3 }]), M.armor));
    place(pauldron, S(cylX(0.1, 0.24, 12), M.gold), s * 0.86, -0.3, 0.46);

    // Upper arm: gunmetal with a black outer plate
    place(sh, S(new THREE.CylinderGeometry(0.17, 0.17, 0.9, 12), M.gun), 0, -0.5, 0);
    place(sh, S(sloft([{ y: -0.3, w: 0.44, d: 0.5, p: 2.8 }, { y: -0.86, w: 0.48, d: 0.52, p: 2.8 }]), M.armor), s * 0.04, 0, 0);
    place(sh, S(chamferBox(0.03, 0.4, 0.02, 0.01), M.gold), s * 0.29, -0.6, 0.12).userData.noOutline = true;

    const elbow = new THREE.Group();
    elbow.position.y = -1.0;
    sh.add(elbow);
    place(elbow, S(cylX(0.2, 0.5, 16), M.gun));
    for (const x of [-0.27, 0.27]) place(elbow, S(cylX(0.11, 0.05, 12), M.gold), x, 0, 0);
    // Forearm: a rounded black guard with a champagne panel and gold edge lines
    place(elbow, S(sloft([
      { y: -0.05, w: 0.46, d: 0.52, p: 2.6 },
      { y: -0.6, w: 0.72, d: 0.8, z: 0.02, p: 2.6 },
      { y: -1.12, w: 0.44, d: 0.5, p: 2.8 },
    ]), M.armor, 0.5));
    place(elbow, S(sidePrism([[0.3, -0.2], [0.36, -0.7], [0.2, -1.05], [-0.1, -1.0], [-0.2, -0.5], [-0.1, -0.15]], 0.04, 0.01), M.champ), s * 0.36, 0, 0);
    place(elbow, S(sidePrism([[0.38, -0.12], [0.42, -0.72], [0.26, -1.1], [0.22, -1.06], [0.36, -0.72], [0.33, -0.15]], 0.02, 0.004), M.gold), s * 0.385, 0, 0).userData.noOutline = true;
    this.pistons.push(new Piston(sh, new V3(0, -0.42, 0.26), elbow, new V3(0, -0.3, 0.32), 0.055, M, M.gun));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.46, -0.55, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.8);
    elbow.add(shieldMount);

    // Hand: gunmetal palm and fingers, a gold knuckle bar
    const hand = new THREE.Group();
    hand.position.set(0, -1.22, 0.02);
    elbow.add(hand);
    place(hand, S(chamferBox(0.32, 0.34, 0.38, 0.06), M.gun), 0, -0.14, 0);
    place(hand, S(chamferBox(0.06, 0.26, 0.32, 0.02), M.armor), s * 0.17, -0.12, 0);
    place(hand, S(chamferBox(0.34, 0.05, 0.08, 0.02), M.gold), 0, -0.3, 0.15);
    for (let f = 0; f < 4; f++) {
      const fg = new THREE.Group();
      fg.position.set(0, -0.32, 0.16 - f * 0.105);
      fg.rotation.set(0, 0, -s * 0.25);
      hand.add(fg);
      place(fg, S(chamferBox(0.075, 0.15, 0.075, 0.02), M.gun), 0, -0.07, 0);
      const tip = new THREE.Group();
      tip.position.y = -0.15;
      tip.rotation.z = -s * 0.45;
      fg.add(tip);
      place(tip, S(chamferBox(0.065, 0.13, 0.065, 0.02), M.armor), 0, -0.06, 0);
    }
    place(hand, S(chamferBox(0.085, 0.18, 0.085, 0.02), M.gun), -s * 0.16, -0.26, 0.17, 0.3, 0, s * 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.26, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = new THREE.Group();
    bp.position.set(0, 0.76, -0.7);
    this.chest.add(bp);
    this.backpack = bp;
    // Booster pack: a vented core between two rounded booster housings
    place(bp, S(sloft([
      { y: 0.66, w: 1.2, d: 0.5, z: -0.2, p: 3.2 },
      { y: 0.05, w: 1.36, d: 0.62, z: -0.26, p: 3.2 },
      { y: -0.42, w: 1.06, d: 0.52, z: -0.22, p: 3.2 },
    ]), M.vents, 1.4));
    for (const s of [-1, 1]) {
      const hx = s * 0.5;
      place(bp, S(sloft([
        { y: 0.5, w: 0.52, d: 0.62, x: hx, z: -0.4, p: 2.6 },
        { y: -0.2, w: 0.6, d: 0.74, x: hx, z: -0.46, p: 2.6 },
        { y: -0.66, w: 0.52, d: 0.64, x: hx, z: -0.44, p: 2.6 },
      ]), M.armor, 0.5));
      place(bp, S(chamferBox(0.03, 0.7, 0.02, 0.01), M.gold), hx + s * 0.29, 0.0, -0.46).userData.noOutline = true;
      const dir = new V3(0, -1, -0.45).normalize();
      this.thrusters.main.push(new Thruster(bp, new V3(hx, -0.68, -0.54), dir, 0.38, this.glowTex));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.84, 0.25, -0.5), new V3(s * 0.25, 0.05, -1), 0.13, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0xffc27a, 0, 22, 1.8);
    this.thrustLight.position.set(0, -1.6, -0.9);
    bp.add(this.thrustLight);
  }

  // ---- animation -----------------------------------------------------------

  animate(dt, st) {
    const r = super.animate(dt, st);
    // Hunched further over the hips than the Vanguard, head held up to look ahead
    this.waist.rotation.x += 0.16;
    this.head.rotation.x -= 0.14;
    this.poseArms(dt, st);
    this.root.updateMatrixWorld(true);
    for (const p of this.pistons) p.update();
    return r;
  }

  /**
   * Arms carry a gun like a soldier would: the gun arm sits at low ready across
   * the body and swings up along the line of sight to aim (arm IK), and the free
   * hand takes the foregrip. Empty arms hang loose and swing with the stride.
   */
  poseArms(dt, st) {
    const w = this.w, W = w.walk || 0;
    const idle = (1 - w.gait) * (1 - w.air) * (1 - w.dash) * (1 - w.crouch);
    const breath = Math.sin(st.time * 1.5);
    const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), eu = new THREE.Euler();
    this.chest.updateWorldMatrix(true, false);
    const qc = this.chest.getWorldQuaternion(new THREE.Quaternion()).invert();
    const yawW = (st.bodyYaw || 0) + st.aimYaw, cp = Math.cos(st.aimPitch);
    const aimDir = new V3(Math.sin(yawW) * cp, Math.sin(st.aimPitch), Math.cos(yawW) * cp).applyQuaternion(qc);
    const armed = st.armed || [false, false];
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], s = A.s;
      const swing = -Math.sin(this.armPhase + (i === 0 ? 0 : Math.PI)) * 0.28 * W * (1 - w.dash);
      let shx = 0.05 + (armed[i] ? swing * 0.3 : swing), shy = 0, shz = s * (0.16 + 0.1 * idle), elx = -0.5;
      shx += (-0.08 - shx) * idle; shy += (-s * 0.06 - shy) * idle; elx += (-0.32 - elx) * idle;
      shx += breath * 0.015 * idle;
      shx += (0.35 - shx) * w.dash * 0.8;
      shz += s * 0.25 * w.air;
      q.setFromEuler(eu.set(shx, shy, shz, 'YXZ'));
      if (armed[i]) {
        const a = w.aim[i];
        // Low ready: a two-handed gun angled down across the body, a sidearm held down at the side
        const side = !st.support;
        const hy = (st.bodyYaw || 0) + w.twist, cx = side ? s * 0.12 : -s * 0.36, cz = side ? 0.42 : 0.8;
        const hold = new V3(cx * Math.cos(hy) + cz * Math.sin(hy), (side ? -0.9 : -0.42) + breath * 0.01, -cx * Math.sin(hy) + cz * Math.cos(hy)).applyQuaternion(qc).normalize();
        hold.lerp(aimDir, a).normalize();
        this.armAim(A, hold, q2);
        const k = Math.max(a, 1 - w.dash * 0.75 - w.air * 0.25);
        q.slerp(q2, k);
        elx += (A.ikEl - elx) * k;
      }
      const r = w.reload[i];
      if (r > 0.001) {
        q.slerp(q2.setFromEuler(eu.set(0.15, -s * 0.3, shz, 'YXZ')), r);
        elx += (-1.7 - elx) * r;
      }
      A.sh.quaternion.copy(q);
      A.sh.rotateX(w.recoil[i] * 0.16);
      A.elbow.rotation.x = Math.min(0, elx - w.recoil[i] * 0.35);
      A.hand.rotation.x = -0.05 + w.recoil[i] * 0.12;
      const down = new V3(0, -1, 0).applyQuaternion(A.sh.quaternion);
      A.pauldron.rotation.x = 0.4 * Math.atan2(down.z, -down.y);
    }
    // The free hand takes the foregrip of the gun in the other
    if (st.support && this.mounts.rightHand) {
      const g = this.mounts.rightHand.children[0], fg = g && g.userData.foregrip;
      const k = (1 - w.dash) * (1 - w.reload[0]) * (1 - w.air * 0.6) * (1 - w.reload[1]);
      if (fg && k > 0.01) {
        const A = this.arms[1];
        this.arms[0].sh.updateWorldMatrix(true, true);
        const T = fg.getWorldPosition(new V3());
        this.chest.worldToLocal(T).sub(A.sh.position);
        this.armReach(A, T, q2);
        A.sh.quaternion.slerp(q2, k);
        A.elbow.rotation.x += (A.ikEl - A.elbow.rotation.x) * k;
        A.hand.rotation.x += (0.5 - A.hand.rotation.x) * k;
      }
    }
  }

  /** Arm IK for a held gun: forearm along d (chest space), elbow low and a little out. */
  armAim(A, d, out) {
    const U = A.upper, s = A.s;
    const o = new V3(s * 0.2 * U, -0.52 * U, 0.2 * U);
    const od = o.dot(d);
    const u = -od + Math.sqrt(Math.max(0, od * od - o.lengthSq() + U * U));
    const up = o.addScaledVector(d, u).normalize();
    return this.armBasis(A, up, d, out);
  }

  /** Two-bone arm IK reaching the hand to T (chest space, from the shoulder), elbow down and out */
  armReach(A, T, out) {
    const U = A.upper, F = A.fore - 0.12, s = A.s;
    const D = clamp(T.length(), Math.abs(U - F) + 0.05, U + F - 0.02);
    const cosA = clamp((U * U + D * D - F * F) / (2 * U * D), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const t = T.clone().normalize();
    const pole = new V3(s * 0.7, -1, -0.15).normalize();
    pole.addScaledVector(t, -pole.dot(t)).normalize();
    const up = t.clone().multiplyScalar(cosA).addScaledVector(pole, sinA);
    const fore = T.clone().addScaledVector(up, -U).normalize();
    return this.armBasis(A, up, fore, out);
  }

  /** Shoulder orientation with the upper arm along up and the forearm bending toward fore */
  armBasis(A, up, fore, out) {
    const Y = up.clone().negate();
    const Z = fore.clone().addScaledVector(up, -up.dot(fore));
    if (Z.lengthSq() < 1e-5) Z.set(0, 0, 1).addScaledVector(up, -up.z);
    Z.normalize();
    const X = new V3().crossVectors(Y, Z);
    out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    A.ikEl = -Math.acos(clamp(up.dot(fore), -1, 1));
    return out;
  }
}

// ---------------------------------------------------------------------------
// HG-4 Warden sidearm: a heavy one-handed gun, built like the second-wave arsenal
// from angular slabs cut to a side profile, with a faceted barrel, vent slots, a
// lens and lit accent lines. Built along +Z with the grip at the origin.
// ---------------------------------------------------------------------------

export function buildSovereignSidearm(M) {
  const g = new THREE.Group();
  const slab = (pts, w, mat, k = 0.6, bevel = 0.02) => S(sidePrism(pts, w, bevel), mat, k);
  const line = (sx, sy, sz, x, y, z) => { const m = place(g, new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), M.eye), x, y, z); m.userData.noOutline = true; return m; };
  // Slide over a gunmetal frame, champagne side plates traced in gold light
  place(g, slab([[-0.42, 0.06], [-0.42, 0.34], [-0.3, 0.46], [1.25, 0.46], [1.42, 0.36], [1.42, 0.12], [1.1, 0.06]], 0.3, M.armor));
  place(g, slab([[-0.3, -0.06], [-0.3, 0.08], [1.2, 0.08], [1.3, -0.04], [0.5, -0.1]], 0.26, M.gun));
  for (const sd of [-1, 1]) {
    place(g, slab([[-0.2, 0.14], [0.9, 0.14], [1.05, 0.38], [-0.1, 0.4]], 0.02, M.champ, 0.8), sd * 0.16, 0, 0);
    line(0.012, 0.02, 0.8, sd * 0.172, 0.26, 0.4);
    for (let i = 0; i < 4; i++) place(g, S(chamferBox(0.02, 0.12, 0.05, 0.005), M.gun), sd * 0.152, 0.3, 1.0 + i * 0.09);
  }
  // Faceted barrel in a gold-ringed brake, a lens under the muzzle
  place(g, S(cylZ(0.08, 0.08, 0.5, 6).rotateZ(Math.PI / 6), M.gun), 0, 0.26, 1.6);
  place(g, slab([[1.6, 0.4], [1.9, 0.38], [1.92, 0.14], [1.6, 0.12]], 0.24, M.armor));
  place(g, S(new THREE.TorusGeometry(0.1, 0.022, 6, 16), M.gold), 0, 0.26, 1.58);
  place(g, slab([[1.0, -0.04], [1.5, -0.04], [1.46, -0.16], [1.0, -0.14]], 0.16, M.gun));
  place(g, new THREE.Mesh(cylZ(0.04, 0.04, 0.03, 10), M.eye), 0, -0.1, 1.51).userData.noOutline = true;
  // Grip with a champagne magazine base, trigger guard and a rear sight
  place(g, slab([[-0.14, 0.04], [0.14, 0.04], [0.06, -0.5], [-0.22, -0.5], [-0.2, -0.38]], 0.2, M.gun));
  place(g, slab([[0.06, -0.48], [-0.22, -0.48], [-0.24, -0.58], [0.08, -0.58]], 0.22, M.champ, 0.8));
  place(g, slab([[0.14, 0.0], [0.44, 0.0], [0.44, -0.2], [0.38, -0.2], [0.38, -0.05], [0.16, -0.05]], 0.06, M.gun));
  place(g, slab([[-0.36, 0.46], [-0.18, 0.46], [-0.2, 0.54], [-0.34, 0.54]], 0.16, M.gold));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.26, 1.95);
  g.add(muzzle);
  g.userData.muzzles = [muzzle];
  return g;
}
