import * as THREE from './three.js';
import { frontPrism, sidePrism, chamferBox, cylX, cylZ, loft, place } from './atlas.js';
import { Mech, Thruster, Piston, LEG, warp, blade, loftZ } from './mech.js';

// ---------------------------------------------------------------------------
// BK-09 Sovereign: a black and gold lancer on the Vanguard's rig. Two great
// binders stand off its back in a V, long blade skirts hang to its shins, its
// legs end in spikes with champagne heel fins, and its shoulders and outer arms
// are plated in champagne gold over brass machinery.
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

// Deterministic noise, so the markings come out the same every load
let markSeed = 11;
const rnd = () => (markSeed = (markSeed * 16807) % 2147483647) / 2147483647;

/**
 * A cluster of tiny gold marks, like stencilled lettering and service lines: rows of
 * short bars `w` wide, in the plane of a group at (x, y, z) turned by ry (its +Z is the
 * face normal) and tilted by rx and rz. One merged mesh per cluster.
 */
function marks(parent, mat, x, y, z, ry = 0, rows = 2, w = 0.3, rx = 0, rz = 0) {
  const pos = [], nor = [];
  for (let r = 0; r < rows; r++) {
    const len = w * (r === 0 ? 1 : 0.4 + 0.5 * rnd());
    for (let u = 0; u < len;) {
      const l = 0.012 + (r === 0 && rnd() < 0.2 ? 0.12 : 0.045) * rnd();
      const b = new THREE.BoxGeometry(Math.min(l, len - u), r === 0 ? 0.014 : 0.01, 0.006).translate(u + l / 2 - w / 2, -r * 0.03, 0).toNonIndexed();
      pos.push(...b.attributes.position.array);
      nor.push(...b.attributes.normal.array);
      u += l + 0.008 + (rnd() < 0.15 ? 0.03 : 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const m = place(parent, new THREE.Mesh(g, mat), x, y, z, rx, ry, rz);
  m.userData.noOutline = true;
  return m;
}

// ---------------------------------------------------------------------------

export class Sovereign extends Mech {
  constructor(mats, glowTex) {
    super(mats, glowTex);
    // Standing: right foot forward, as on the reference
    this.idleFeet = [new V3(-1.02, 0, 0.78), new V3(1.12, 0, -0.62)];
    for (const A of this.arms) {
      A.upper = A.elbow.position.length();
      A.fore = new V3().copy(A.hand.position).add(A.mount.position).length();
    }
  }

  // ---- construction ----------------------------------------------------------

  buildPelvis() {
    const M = this.mats, p = this.pelvis;
    // Machinery core on a hip axle
    place(p, S(loft([
      { y: 0.3, w: 0.86, d: 0.7, c: 0.16 },
      { y: 0.0, w: 1.0, d: 0.78, c: 0.2 },
      { y: -0.34, w: 0.52, d: 0.56, c: 0.14 },
    ]), M.joints, 1.4));
    place(p, S(cylX(0.18, 1.5), M.joint), 0, -0.18, 0);
    // Pointed black codpiece, rear plate
    place(p, S(frontPrism([[-0.26, 0.2], [0.26, 0.2], [0.17, -0.24], [0, -0.46], [-0.17, -0.24]], 0.18, 0.03), M.armor), 0, 0, 0.4);
    place(p, S(chamferBox(0.2, 0.05, 0.04, 0.015), M.gold), 0, 0.1, 0.5);
    place(p, S(frontPrism([[-0.42, 0.22], [0.42, 0.22], [0.3, -0.4], [-0.3, -0.4]], 0.12, 0.03), M.armor), 0, 0, -0.42);

    // Big exposed hip discs: a black rim around dark spokes and a gold hub
    for (const s of [-1, 1]) {
      const d = new THREE.Group();
      d.position.set(s * 0.98, -0.1, -0.04);
      p.add(d);
      place(d, S(cylX(0.56, 0.14, 28), M.armor));
      place(d, S(cylX(0.47, 0.16, 28), M.joint));
      const ring = place(d, S(new THREE.TorusGeometry(0.4, 0.024, 6, 32), M.gold), s * 0.085, 0, 0, 0, Math.PI / 2, 0);
      ring.userData.noOutline = true;
      for (let k = 0; k < 6; k++) {
        const sp = new THREE.Group();
        sp.rotation.x = (k / 6) * Math.PI * 2;
        d.add(sp);
        place(sp, S(chamferBox(0.05, 0.38, 0.07, 0.015), M.frame), s * 0.08, 0.25, 0);
      }
      place(d, S(cylX(0.15, 0.22, 16), M.gold));
      place(d, S(cylX(0.06, 0.26, 12), M.joint));
    }

    // Long blade skirts hanging to the shins at the front. The outer group
    // (hipPads) follows the thigh; the inner one sets the plate's flare.
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.34, 0.14, 0.44);
      p.add(g);
      const k = new THREE.Group();
      k.rotation.set(-0.06, s * 0.3, s * 0.07);
      g.add(k);
      place(k, S(frontPrism(mirror([[-0.34, 0.1], [0.44, 0.1], [0.54, -0.3], [0.44, -2.2], [0.2, -3.05], [-0.04, -2.6], [-0.34, -0.5]], s), 0.12, 0.03), M.armor, 0.5));
      // Gold slot down the outer edge and a few gold marks
      place(k, S(chamferBox(0.03, 1.9, 0.02, 0.01), M.gold), s * 0.36, -1.25, 0.065, 0, 0, -s * 0.05).userData.noOutline = true;
      place(k, S(chamferBox(0.12, 0.025, 0.02, 0.008), M.gold), -s * 0.06, -0.55, 0.065).userData.noOutline = true;
      place(k, S(chamferBox(0.06, 0.025, 0.02, 0.008), M.gold), -s * 0.1, -0.62, 0.065).userData.noOutline = true;
      marks(k, M.gold, -s * 0.02, -1.5, 0.066, 0, 3, 0.3);
      marks(k, M.gold, s * 0.06, -2.15, 0.066, 0, 2, 0.16);
      return g;
    });
    // Side skirts sweeping back over the hip discs, and a rear skirt
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 1.12, 0.26, -0.1);
      g.rotation.set(0.1, 0, s * 0.14);
      p.add(g);
      place(g, S(sideplate([[0.42, 0.1], [0.4, -0.6], [0.18, -2.3], [0.02, -2.6], [-0.2, -1.6], [-0.5, -0.3], [-0.42, 0.1]], 0.1), M.armor, 0.5));
      place(g, S(sideplate([[0.2, -0.3], [0.16, -0.6], [-0.1, -1.0], [-0.14, -0.7], [0.0, -0.3]], 0.02), M.gold), s * 0.06, 0, 0).userData.noOutline = true;
      marks(g, M.gold, s * 0.053, -0.35, -0.2, s * Math.PI / 2, 2, 0.22);
    }
    const rear = new THREE.Group();
    rear.position.set(0, 0.1, -0.48);
    rear.rotation.x = 0.22;
    p.add(rear);
    place(rear, S(frontPrism([[-0.5, 0.1], [0.5, 0.1], [0.42, -0.9], [0, -1.3], [-0.42, -0.9]], 0.1, 0.03), M.armor, 0.5));
  }

  buildLeg(s) {
    const M = this.mats;
    const hip = new THREE.Group();
    hip.position.set(s * 0.62, -LEG.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, S(new THREE.SphereGeometry(0.26, 16, 10), M.joint));
    // Thigh: a frame strut in brass-trimmed machinery, mostly hidden by the skirts
    const TH = LEG.thigh;
    place(hip, S(new THREE.CylinderGeometry(0.15, 0.17, TH - 0.2, 10), M.joint), 0, -TH / 2, -0.02);
    place(hip, S(loft([
      { y: -0.1, w: 0.6, d: 0.72, c: 0.16 },
      { y: -0.9, w: 0.56, d: 0.7, c: 0.16, z: 0.04 },
      { y: -TH + 0.32, w: 0.42, d: 0.5, c: 0.12, z: 0.03 },
    ]), M.frame));
    for (const x of [-0.14, 0.14]) place(hip, S(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 8), M.gold), x, -0.85, 0.32, 0.05, 0, 0);
    place(hip, S(new THREE.TorusGeometry(0.29, 0.025, 6, 18), M.brass), 0, -0.45, 0.03, Math.PI / 2, 0, 0);
    place(hip, S(frontPrism([[-0.24, -0.2], [0.24, -0.2], [0.22, -1.0], [0, -1.2], [-0.22, -1.0]], 0.1, 0.03), M.armor), 0, 0, 0.38);
    place(hip, S(sideplate([[0.36, -0.1], [0.32, -1.1], [-0.2, -1.3], [-0.42, -0.3]], 0.08), M.armor), s * 0.32, 0, 0);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, S(cylX(0.23, 0.58), M.joint));
    for (const x of [-0.3, 0.3]) place(knee, S(cylX(0.12, 0.05, 12), M.gold), x, 0, 0);
    // Angular knee block with a small champagne crest
    place(knee, S(blade([[0.52, 0.32], [0.64, -0.12], [0.44, -0.6], [0.06, -0.66], [-0.12, -0.1], [0.12, 0.36]], 0.62, [1, 1], [0.85, 1]), M.armor));
    place(knee, S(chamferBox(0.2, 0.12, 0.03, 0.03), M.champ), 0, -0.2, 0.6, -0.25, 0, 0);
    marks(knee, M.gold, s * 0.31, -0.25, 0.2, s * Math.PI / 2, 2, 0.24);
    this.pistons.push(new Piston(hip, new V3(s * 0.24, -0.5, -0.3), knee, new V3(s * 0.24, -0.5, -0.34), 0.06, M, M.brass));

    // Shin: one long wedge, deep at the knee and tapering toward the spike
    const SH = LEG.shin;
    place(knee, S(blade([[0.42, -0.2], [0.48, -0.95], [0.32, -1.9], [0.16, -SH + 0.05], [-0.14, -SH + 0.05], [-0.32, -1.6], [-0.44, -0.6], [-0.3, -0.15]],
      0.58, [1, 1], [0.6, 1]), M.armor, 0.5));
    place(knee, S(chamferBox(0.02, 0.5, 0.04, 0.006), M.gold), s * 0.24, -0.9, 0.36, 0.08, 0, 0).userData.noOutline = true;
    marks(knee, M.gold, s * 0.258, -0.7, 0.0, s * Math.PI / 2, 3, 0.34);
    marks(knee, M.gold, s * 0.224, -1.6, 0.02, s * Math.PI / 2, 2, 0.2);
    // Champagne heel fins with saw-toothed lower edges, swept back off the calf
    const fin = [[-0.12, -1.25], [-0.6, -1.42], [-1.15, -1.82], [-1.2, -2.75], [-1.04, -2.56], [-0.94, -2.86], [-0.76, -2.64], [-0.64, -2.92], [-0.46, -2.66], [-0.16, -2.6]];
    for (const [x, y, z, sc] of [[0.15, 0, 0, 1], [-0.15, 0.04, 0.04, 0.94], [0, 0.18, 0.1, 0.8]]) {
      const f = place(knee, S(sideplate(fin, 0.05), M.champ, 0.8), x, y, z);
      f.scale.set(1, 1, sc);
    }
    place(knee, S(chamferBox(0.36, 0.3, 0.1, 0.04), M.joint), 0, -1.45, -0.36);
    for (const x of [-0.07, 0.07]) {
      this.thrusters.calf.push(new Thruster(knee, new V3(x, -1.42, -0.4), new V3(0, -0.85, -0.6), 0.09, this.glowTex));
    }

    const mount = new THREE.Group();
    mount.position.set(s * 0.32, -1.05, -0.06);
    mount.rotation.z = -s * Math.PI / 2;
    knee.add(mount);

    // Spike foot under a small ankle guard
    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, S(new THREE.SphereGeometry(0.17, 14, 10), M.joint));
    place(ankle, S(loft([
      { y: 0.26, w: 0.3, d: 0.46, c: 0.08, z: 0.02 },
      { y: -0.08, w: 0.28, d: 0.4, c: 0.08, z: 0.05 },
      { y: -LEG.foot, w: 0.05, d: 0.08, c: 0.02, z: 0.1 },
    ]), M.armor));
    return { s, hip, knee, ankle, mount };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.3;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Exposed spine with brass struts
    place(waist, S(new THREE.CylinderGeometry(0.3, 0.36, 0.72, 14), M.joints, 1.8), 0, 0.2, -0.04);
    for (const sd of [-1, 1]) place(waist, S(new THREE.CylinderGeometry(0.04, 0.04, 0.64, 8), M.gold), sd * 0.25, 0.24, 0.22, 0, 0, sd * 0.12);
    place(waist, S(loft([{ y: 0.44, w: 0.5, d: 0.24, c: 0.07, z: 0.3 }, { y: 0.04, w: 0.32, d: 0.2, c: 0.06, z: 0.27 }]), M.armor));

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.5;
    waist.add(chest);
    // Core
    place(chest, S(loft([
      { y: 0.0, w: 0.9, d: 0.76, c: 0.18, z: -0.08 },
      { y: 0.55, w: 1.7, d: 1.14, c: 0.3, z: -0.1 },
      { y: 1.1, w: 1.96, d: 1.2, c: 0.32, z: -0.14 },
      { y: 1.36, w: 1.4, d: 0.92, c: 0.26, z: -0.2 },
    ]), M.armor, 0.5));
    // Side machinery showing under the plates
    for (const sd of [-1, 1]) place(chest, S(chamferBox(0.5, 0.6, 0.12, 0.08), M.vents, 1.6), sd * 0.95, 0.65, -0.12, 0, sd * Math.PI / 2, 0);
    // Faceted chest plates sweeping back to the shoulders, edged in gold
    for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, 0, 0.64);
      g.rotation.y = sd * 0.36;
      chest.add(g);
      place(g, S(frontPrism(mirror([[0.03, 0.3], [0.7, 0.46], [1.0, 0.92], [0.92, 1.3], [0.3, 1.38], [0.03, 1.16]], sd), 0.18, 0.035), M.armor, 0.5));
      place(g, S(frontPrism(mirror([[0.62, 0.6], [0.94, 0.94], [0.9, 0.99], [0.58, 0.66]], sd), 0.04, 0.005), M.gold), 0, 0, 0.1).userData.noOutline = true;
      marks(g, M.gold, sd * 0.42, 0.62, 0.091, 0, 2, 0.22);
      // Champagne collar block at the base of the neck, capped with a round knob
      const col = new THREE.Group();
      col.position.set(sd * 0.56, 1.22, 0.12);
      col.rotation.set(0.15, -sd * 0.3, -sd * 0.25);
      chest.add(col);
      place(col, S(blade([[0.36, -0.08], [0.3, 0.16], [-0.04, 0.3], [-0.34, 0.22], [-0.3, -0.1]], 0.3, [1, 1], [1, 0.7]), M.champ, 0.8));
      place(col, S(cylX(0.08, 0.36, 14), M.champ), 0, 0.12, 0.2);
    }
    // Keel and a V plate pointing down to the waist
    place(chest, S(blade([[0.0, 0.32], [0.16, 0.52], [0.12, 1.0], [0.0, 1.1]], 0.14, [1, 0.5]), M.armor), 0, 0, 0.72);
    place(chest, S(frontPrism([[-0.46, 0.42], [0.46, 0.42], [0.25, 0.02], [0, -0.3], [-0.25, 0.02]], 0.14, 0.03), M.armor), 0, 0, 0.6);
    place(chest, S(chamferBox(0.1, 0.05, 0.04, 0.012), M.eye), 0, 0.22, 0.68).userData.noOutline = true;

    // Back weapon mounts sit over the binder pack
    for (const [key, s] of [['shoulderR', -1], ['shoulderL', 1]]) {
      const m = new THREE.Group();
      m.position.set(s * 0.5, 1.5, -0.95);
      m.rotation.x = -0.12;
      chest.add(m);
      this.mounts[key] = m;
    }
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.42, 0.5);
    head.scale.setScalar(1.3);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, S(new THREE.CylinderGeometry(0.13, 0.16, 0.34, 10), M.joint), 0, 0.0, -0.12);
    // Small skull under a long crest that juts forward like a beak
    place(head, S(loftZ([
      { z: -0.22, w: 0.34, h: 0.34, y: 0.12, c: 0.1 },
      { z: 0.14, w: 0.32, h: 0.3, y: 0.1, c: 0.1 },
      { z: 0.34, w: 0.14, h: 0.14, y: 0.06, c: 0.04 },
    ]), M.joint));
    place(head, S(blade([[0.95, 0.16], [0.5, 0.32], [-0.1, 0.4], [-0.5, 0.3], [-0.2, 0.18], [0.3, 0.1]], 0.24, [1, 0.25], [1, 1], 0.01), M.armor));
    place(head, S(chamferBox(0.06, 0.03, 0.2, 0.01), M.gold), 0, 0.33, 0.1, -0.12, 0, 0).userData.noOutline = true;
    // Visor slit under the crest
    place(head, new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.1), M.eye), 0, 0.08, 0.3).userData.noOutline = true;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.5 }));
    glow.scale.setScalar(0.35);
    place(head, glow, 0, 0.08, 0.34);
    for (const sd of [-1, 1]) {
      // Cheek plates closing over the jaw
      place(head, S(blade([[0.38, 0.12], [0.2, 0.18], [-0.2, 0.2], [-0.28, -0.04], [0.0, -0.1], [0.3, -0.02]], 0.06, [1, 0.5]), M.armor), sd * 0.18, 0, 0, 0, -sd * 0.2, sd * 0.1);
      // Horns swept up and back off the crown
      place(head, S(blade([[0.22, 0.0], [0.12, 0.24], [-0.2, 0.5], [-0.74, 0.8], [-0.58, 0.5], [-0.42, 0.2], [-0.3, 0.0]], 0.08, [0.5, 1], [1, 1], 0.006), M.armor), sd * 0.11, 0.3, 0.0, 0, 0, -sd * 0.22);
    }
    for (const sd of [-1, 1]) {
      this.pistons.push(new Piston(this.chest, new V3(sd * 0.42, 1.3, 0.0), head, new V3(sd * 0.16, 0.08, -0.1), 0.04, this.mats, M.brass));
    }
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.3, 1.0, -0.04);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, S(new THREE.SphereGeometry(0.28, 14, 10), M.joint));
    // Shoulder: black shell under layered champagne plates
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.26, 0.12, 0);
    sh.add(pauldron);
    const dome = warp(new THREE.SphereGeometry(1, 9, 6), (v) => {
      v.set(v.x * 0.6, v.y * 0.46, v.z * 0.76);
      if (v.y < -0.1) v.y = -0.1 + (v.y + 0.1) * 0.35;
      v.z += Math.max(0, v.y) * 0.25;
    });
    place(pauldron, S(dome, M.armor), s * 0.08, 0.02, 0);
    place(pauldron, S(blade([[0.62, 0.26], [0.72, -0.14], [0.4, -0.46], [-0.52, -0.38], [-0.68, 0.06], [-0.26, 0.42]], 0.7, [0.8, 1], [0.7, 1]), M.champ, 0.8), s * 0.16, 0.22, 0);
    place(pauldron, S(sideplate([[0.56, 0.0], [0.24, 0.2], [-0.4, 0.14], [-0.52, -0.24], [0.06, -0.44], [0.5, -0.3]], 0.06), M.champ, 0.8), s * 0.62, -0.5, 0.02, 0, 0, s * 0.18);
    place(pauldron, S(sideplate([[0.4, 0.0], [0.16, 0.12], [-0.3, 0.08], [-0.38, -0.2], [0.04, -0.32], [0.36, -0.22]], 0.05), M.armor), s * 0.64, -0.78, 0.0, 0, 0, s * 0.26);
    marks(pauldron, M.gold, s * 0.59, 0.0, -0.1, s * Math.PI / 2, 2, 0.26);
    place(pauldron, S(sideplate([[0.7, 0.08], [0.3, 0.36], [-0.5, 0.26], [-0.64, -0.36], [0.1, -0.7], [0.62, -0.42]], 0.07), M.champ, 0.8), s * 0.54, -0.14, 0);
    place(pauldron, S(sideplate([[0.36, -0.12], [0.0, 0.08], [-0.36, -0.04], [-0.3, -0.36], [0.24, -0.42]], 0.03), M.armor), s * 0.59, -0.16, 0);
    place(pauldron, S(cylX(0.08, 0.2, 12), M.gold), s * 0.6, -0.17, 0.48);

    // Upper arm: brass machinery with a long champagne plate on the outside
    place(sh, S(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 10), M.joint), 0, -0.5, 0);
    place(sh, S(loft([{ y: -0.32, w: 0.36, d: 0.42, c: 0.1 }, { y: -0.84, w: 0.4, d: 0.46, c: 0.11 }]), M.frame), 0, 0, 0);
    for (const y of [-0.45, -0.7]) place(sh, S(new THREE.TorusGeometry(0.2, 0.025, 6, 18), M.brass), 0, y, 0, Math.PI / 2, 0, 0);
    place(sh, S(sideplate([[0.24, -0.26], [0.3, -0.62], [0.18, -1.02], [-0.12, -0.96], [-0.26, -0.5], [-0.12, -0.22]], 0.06), M.champ, 0.8), s * 0.24, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.0;
    sh.add(elbow);
    place(elbow, S(cylX(0.18, 0.44), M.joint));
    for (const x of [-0.24, 0.24]) place(elbow, S(cylX(0.1, 0.05, 10), M.gold), x, 0, 0);
    // Forearm: dark frame wrapped in brass rings and rams
    place(elbow, S(loft([
      { y: -0.06, w: 0.38, d: 0.44, c: 0.1 },
      { y: -0.55, w: 0.46, d: 0.54, c: 0.12 },
      { y: -1.12, w: 0.36, d: 0.42, c: 0.1 },
    ]), M.frame));
    for (const y of [-0.3, -0.62, -0.94]) place(elbow, S(new THREE.TorusGeometry(0.22, 0.03, 6, 18), M.brass), 0, y, 0, Math.PI / 2, 0, 0);
    for (const x of [-0.16, 0.16]) place(elbow, S(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), M.gold), x, -0.6, 0.24);
    place(elbow, S(blade([[0.3, -0.1], [0.32, -0.9], [0.18, -1.12], [0.06, -1.0], [0.08, -0.1]], 0.3, [1, 1]), M.armor), 0, 0, 0);
    // Champagne blade along the outer forearm, rising past the elbow
    place(elbow, S(sideplate([[0.26, -1.08], [0.3, -0.6], [0.18, 0.05], [0.04, 0.5], [-0.06, 0.18], [-0.2, -0.5], [-0.12, -1.12]], 0.07), M.champ, 0.8), s * 0.28, 0, 0);
    this.pistons.push(new Piston(sh, new V3(0, -0.42, 0.22), elbow, new V3(0, -0.3, 0.28), 0.05, M, M.brass));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.44, -0.55, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.8);
    elbow.add(shieldMount);

    // Hand: dark palm, brass knuckles and articulated fingers, relaxed
    const hand = new THREE.Group();
    hand.position.set(0, -1.22, 0.02);
    elbow.add(hand);
    place(hand, S(chamferBox(0.3, 0.34, 0.36, 0.06), M.joint), 0, -0.14, 0);
    place(hand, S(chamferBox(0.06, 0.26, 0.3, 0.02), M.armor), s * 0.16, -0.12, 0);
    place(hand, S(chamferBox(0.32, 0.05, 0.08, 0.02), M.gold), 0, -0.3, 0.14);
    for (let f = 0; f < 4; f++) {
      const fg = new THREE.Group();
      fg.position.set(0, -0.32, 0.15 - f * 0.1);
      fg.rotation.set(0, 0, -s * 0.25);
      hand.add(fg);
      place(fg, S(chamferBox(0.07, 0.15, 0.07, 0.02), M.brass), 0, -0.07, 0);
      const tip = new THREE.Group();
      tip.position.y = -0.15;
      tip.rotation.z = -s * 0.45;
      fg.add(tip);
      place(tip, S(chamferBox(0.06, 0.13, 0.06, 0.02), M.brass), 0, -0.06, 0);
    }
    place(hand, S(chamferBox(0.08, 0.18, 0.08, 0.02), M.brass), -s * 0.15, -0.26, 0.16, 0.3, 0, s * 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.26, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = new THREE.Group();
    bp.position.set(0, 0.72, -0.66);
    this.chest.add(bp);
    this.backpack = bp;
    place(bp, S(loft([
      { y: 0.62, w: 1.1, d: 0.5, c: 0.14, z: -0.2 },
      { y: 0.05, w: 1.26, d: 0.6, c: 0.18, z: -0.25 },
      { y: -0.4, w: 1.0, d: 0.5, c: 0.16, z: -0.22 },
    ]), M.vents, 1.4));
    this.binders = [];
    for (const s of [-1, 1]) {
      // Main thrusters under the pack
      const hx = s * 0.34;
      place(bp, S(loft([
        { y: -0.2, w: 0.5, d: 0.6, c: 0.14, z: -0.34 },
        { y: -0.66, w: 0.52, d: 0.64, c: 0.15, z: -0.4 },
      ]), M.armor), hx, 0, 0);
      const dir = new V3(0, -1, -0.45).normalize();
      this.thrusters.main.push(new Thruster(bp, new V3(hx, -0.68, -0.52), dir, 0.36, this.glowTex));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.56, 0.3, -0.5), new V3(s * 0.25, 0.05, -1), 0.13, this.glowTex));

      // Binder: a great slab hinged off the pack's shoulder, its top swept up and
      // forward over the shoulder, its lower leaf trailing down past the hip to a cannon port
      const hinge = new THREE.Group();
      hinge.position.set(s * 0.72, 0.52, -0.36);
      bp.add(hinge);
      place(hinge, S(chamferBox(0.4, 0.4, 0.5, 0.08), M.joint), 0, 0, -0.06);
      place(hinge, S(cylX(0.15, 0.62, 14), M.gold), s * 0.12, 0, -0.06);
      const bd = new THREE.Group();
      bd.position.set(s * 0.62, 0, -0.12);
      bd.rotation.order = 'YXZ';
      bd.rotation.set(0.4, s * 0.1, -s * 0.1);
      hinge.add(bd);
      // Upper slab with a notched crown, a raised outer plate and a paneled inner face
      place(bd, S(sideplate([[0.6, -0.3], [0.62, 2.3], [0.42, 2.72], [0.12, 2.62], [0.0, 2.96], [-0.5, 2.8], [-0.64, 2.2], [-0.62, -0.1], [-0.4, -0.36]], 0.4, 0.05), M.armor, 0.35));
      place(bd, S(sideplate([[0.44, 0.3], [0.46, 2.1], [0.3, 2.4], [-0.38, 2.3], [-0.46, 1.9], [-0.44, 0.5], [-0.2, 0.3]], 0.06, 0.02), M.armor, 0.35, 0.3, 0.1), s * 0.22, 0, 0);
      place(bd, S(sideplate([[0.4, 0.1], [0.42, 2.0], [-0.4, 2.2], [-0.44, 0.2]], 0.03, 0.01), M.frame), -s * 0.205, 0, 0);
      marks(bd, M.gold, -s * 0.222, 1.5, 0.05, -s * Math.PI / 2, 3, 0.4);
      marks(bd, M.gold, s * 0.256, 1.4, -0.05, s * Math.PI / 2, 3, 0.36);
      marks(bd, M.gold, s * 0.256, 0.5, 0.1, s * Math.PI / 2, 2, 0.24);
      for (const [y, z, l] of [[2.0, 0.22, 0.34], [1.92, 0.32, 0.12], [0.9, -0.24, 0.26], [0.82, -0.3, 0.1]]) {
        place(bd, S(chamferBox(0.02, 0.025, l, 0.006), M.gold), s * 0.255, y, z).userData.noOutline = true;
      }
      place(bd, S(cylX(0.13, 0.46, 14), M.joint), 0, 2.4, -0.26);
      place(bd, S(cylX(0.07, 0.5, 10), M.gold), 0, 2.4, -0.26);
      // Lower leaf on a round knuckle, kinked a little further back
      const leaf = new THREE.Group();
      leaf.position.set(0, -0.2, 0);
      leaf.rotation.x = -0.1;
      bd.add(leaf);
      place(leaf, S(cylX(0.3, 0.5, 18), M.joint));
      place(leaf, S(cylX(0.18, 0.56, 16), M.armor));
      place(leaf, S(cylX(0.08, 0.6, 12), M.gold));
      place(leaf, S(sideplate([[0.56, -0.1], [0.6, -2.5], [0.44, -2.8], [-0.4, -2.8], [-0.56, -2.5], [-0.58, -0.3], [-0.3, 0.1]], 0.46, 0.05), M.armor, 0.35));
      place(leaf, S(sideplate([[0.4, -0.5], [0.42, -2.4], [-0.36, -2.5], [-0.4, -0.6]], 0.06, 0.02), M.armor, 0.35, 0.2, 0.2), s * 0.25, 0, 0);
      place(leaf, S(chamferBox(0.26, 0.14, 0.6, 0.03), M.joint), 0, -2.79, 0, Math.PI / 2, 0, 0);
      place(leaf, S(chamferBox(0.16, 0.06, 0.5, 0.02), M.gold), 0, -2.82, 0, Math.PI / 2, 0, 0);
      place(leaf, S(chamferBox(0.02, 0.025, 0.4, 0.006), M.gold), s * 0.285, -1.7, 0.12).userData.noOutline = true;
      marks(leaf, M.gold, s * 0.282, -0.9, -0.1, s * Math.PI / 2, 3, 0.36);
      marks(leaf, M.gold, s * 0.282, -2.3, 0.1, s * Math.PI / 2, 2, 0.2);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, -2.84, 0);
      leaf.add(muzzle);
      this.binders.push({ s, hinge, bd, leaf, muzzle });
    }
    this.thrustLight = new THREE.PointLight(0xffc27a, 0, 22, 1.8);
    this.thrustLight.position.set(0, -1.6, -0.9);
    bp.add(this.thrustLight);
  }

  // ---- animation -----------------------------------------------------------

  animate(dt, st) {
    const r = super.animate(dt, st);
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
        const hy = (st.bodyYaw || 0) + w.twist, cx = -s * 0.36, cz = 0.8;
        const hold = new V3(cx * Math.cos(hy) + cz * Math.sin(hy), -0.42 + breath * 0.01, -cx * Math.sin(hy) + cz * Math.cos(hy)).applyQuaternion(qc).normalize();
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
// SR-9 Regalia rifle: the Sovereign's hand weapon, built like the second-wave
// arsenal from angular slabs cut to a side profile, with a faceted barrel, vent
// slots, a lens and lit accent lines. Built along +Z with the grip at the origin;
// userData.foregrip is where the free hand takes hold.
// ---------------------------------------------------------------------------

export function buildSovereignRifle(M) {
  const g = new THREE.Group();
  const amber = M.eye;
  const slab = (pts, w, mat, k = 0.6, bevel = 0.02) => S(sidePrism(pts, w, bevel), mat, k);
  const line = (sx, sy, sz, x, y, z) => { const m = place(g, new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), amber), x, y, z); m.userData.noOutline = true; return m; };
  // Receiver with a long stock, champagne cheek plates and a gold spine
  place(g, slab([[-1.3, -0.24], [-1.3, 0.2], [-1.08, 0.38], [0.6, 0.42], [1.25, 0.32], [1.35, 0.04], [0.45, -0.1], [-0.25, -0.1], [-0.42, -0.28]], 0.3, M.armor));
  for (const sd of [-1, 1]) {
    place(g, slab([[-0.9, 0.04], [0.5, 0.08], [0.62, 0.3], [-0.8, 0.32]], 0.02, M.champ, 0.8), sd * 0.16, 0, 0);
    line(0.012, 0.022, 1.0, sd * 0.172, 0.2, -0.15);
  }
  place(g, slab([[-1.0, 0.38], [0.8, 0.42], [0.8, 0.46], [-1.0, 0.43]], 0.2, M.gold));
  // Barrel in a vented shroud, ending in a slotted brake
  place(g, S(cylZ(0.085, 0.085, 2.4, 6).rotateZ(Math.PI / 6), M.frame), 0, 0.2, 2.4);
  place(g, slab([[1.2, 0.42], [2.5, 0.38], [2.62, 0.22], [2.5, 0.02], [1.2, -0.02]], 0.26, M.armor));
  for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) place(g, S(chamferBox(0.02, 0.07, 0.12, 0.005), M.joint), sd * 0.132, 0.22, 1.45 + i * 0.22);
  place(g, slab([[3.45, 0.32], [3.75, 0.3], [3.78, 0.1], [3.45, 0.08]], 0.24, M.armor, 0.6));
  place(g, S(new THREE.TorusGeometry(0.11, 0.025, 6, 16), M.gold), 0, 0.2, 3.42);
  for (const sd of [-1, 1]) place(g, S(chamferBox(0.02, 0.05, 0.16, 0.005), M.joint), sd * 0.122, 0.2, 3.62);
  // Long sight with an amber lens, champagne magazine, grip and foregrip
  place(g, slab([[-0.4, 0.44], [0.7, 0.46], [0.82, 0.56], [0.76, 0.66], [-0.3, 0.66], [-0.42, 0.56]], 0.14, M.armor));
  place(g, new THREE.Mesh(cylZ(0.045, 0.045, 0.03, 10), amber), 0, 0.56, 0.83).userData.noOutline = true;
  place(g, slab([[0.2, -0.08], [0.55, -0.08], [0.5, -0.62], [0.22, -0.6]], 0.2, M.champ, 0.8));
  place(g, slab([[-0.12, 0.04], [0.12, 0.04], [0.04, -0.46], [-0.2, -0.46], [-0.18, -0.36]], 0.17, M.frame));
  place(g, slab([[1.3, 0.0], [1.5, 0.0], [1.46, -0.42], [1.3, -0.42]], 0.14, M.frame));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.2, 3.8);
  g.add(muzzle);
  const foregrip = new THREE.Object3D();
  foregrip.position.set(0, -0.26, 1.4);
  g.add(foregrip);
  g.userData.foregrip = foregrip;
  g.userData.muzzles = [muzzle];
  return g;
}
