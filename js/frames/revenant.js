import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, warp, loftZ, mirror } from '../mech.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// KR-11 Revenant: a knight-pattern medium. A great helm with a crest fin and a
// mono-eye that sweeps behind its visor slit; layered pauldrons with raised
// rims; a cuirass with a center ridge over segmented abdominal lames; tassets
// over the hips; poleyn knees, greaves and pointed sabatons. Twin upright
// booster pods on its back carry the shoulder hardpoints.
// ---------------------------------------------------------------------------

const RIG = {
  leg: { hipDrop: 0.2, thigh: 1.85, shin: 2.45, foot: 0.6 },
  gait: { bodyH: 4.38, homeX: 1.12, dip: 0.2, sway: 0.13 },
  idleFeet: [[-1.14, -0.55], [1.2, 0.8]],
  pole: [0.5, 0.05, 1],
  hunch: 0.16, hunchIdle: 0.08, armOut: 0.24,
};

export class Revenant extends Mech {
  constructor(mats, glowTex) { super(mats, glowTex, RIG); }

  build() {
    this.buildPelvis();
    this.legs = [-1, 1].map((s) => this.buildLeg(s));
    this.buildTorso();
    this.buildHead();
    this.arms = [-1, 1].map((s) => this.buildArm(s));
    this.buildBackpack();
  }

  buildPelvis() {
    const M = this.mats, p = this.pelvis;
    place(p, P(loft([
      { y: 0.26, w: 0.9, d: 0.78, c: 0.18 },
      { y: 0.02, w: 1.04, d: 0.86, c: 0.2 },
      { y: -0.3, w: 0.54, d: 0.6, c: 0.14 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.2, 1.62), M.joint), 0, -0.16, 0);
    // Faulds: a center tasset hanging over the codpiece, a rear plate, and side tassets that swing with the thighs
    const fauld = place(p, P(frontPrism([[-0.34, 0.2], [0.34, 0.2], [0.3, -0.42], [0, -0.62], [-0.3, -0.42]], 0.12, 0.03), M.armor, { all: B.plainA }), 0, 0.02, 0.48, -0.12);
    place(fauld, P(frontPrism([[-0.05, 0.12], [0.05, 0.12], [0.05, -0.4], [0, -0.48], [-0.05, -0.4]], 0.04, 0.01), M.trim), 0, 0, 0.07);
    place(p, P(frontPrism([[-0.46, 0.2], [0.46, 0.2], [0.36, -0.42], [-0.36, -0.42]], 0.12, 0.03), M.armor, { all: B.plainA }), 0, 0, -0.46, 0.12);
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.74, 0.14, 0.04);
      g.rotation.z = s * 0.2;
      p.add(g);
      // Two overlapping lames
      place(g, P(blade([[0.42, 0.1], [-0.38, 0.12], [-0.46, -0.3], [0.0, -0.46], [0.44, -0.3]], 0.1, [1, 1], [0.8, 1]), M.armor, { all: B.plainA }), s * 0.08, 0, 0);
      place(g, P(blade([[0.38, -0.18], [-0.34, -0.16], [-0.4, -0.62], [0.0, -0.74], [0.4, -0.6]], 0.08, [1, 1], [0.8, 1]), M.armor, { all: B.plainA }), s * 0.13, -0.06, 0.02);
      place(g, P(chamferBox(0.04, 0.04, 0.8, 0.01), M.trim), s * 0.15, 0.09, 0.02);
      return g;
    });
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 0.64, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(new THREE.SphereGeometry(0.28, 16, 10), M.joint));
    // Cuisse: thigh shell with a shield-shaped front plate
    place(hip, P(new THREE.CylinderGeometry(0.16, 0.18, TH - 0.2, 10), M.joint), 0, -TH / 2, -0.02);
    place(hip, P(loft([
      { y: -0.1, w: 0.7, d: 0.8, c: 0.2, z: 0.02 },
      { y: -0.8, w: 0.68, d: 0.82, c: 0.2, z: 0.06 },
      { y: -TH + 0.3, w: 0.46, d: 0.54, c: 0.14, z: 0.04 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    place(hip, P(frontPrism([[-0.3, -0.08], [0.3, -0.08], [0.32, -0.9], [0.0, -1.32], [-0.32, -0.9]], 0.12, 0.035), M.armor, { all: B.plainA }), 0, 0, 0.44);
    place(hip, P(frontPrism([[-0.05, -0.2], [0.05, -0.2], [0.05, -0.9], [0, -1.05], [-0.05, -0.9]], 0.04, 0.01), M.trim), 0, 0, 0.51);
    place(hip, P(blade([[0.36, -0.02], [0.32, -0.9], [-0.2, -1.2], [-0.4, -0.6], [-0.3, -0.04]], 0.1, [0.5, 1], [0.7, 1]), M.armor, { all: B.plainA }), s * 0.37, 0, 0);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, P(cylX(0.24, 0.58), M.joint));
    // Poleyn: a rounded knee cop with a spike, and a fan wing on the outside
    const cop = warp(new THREE.SphereGeometry(1, 10, 7), (v) => {
      v.set(v.x * 0.32, v.y * 0.4, v.z * 0.3);
      if (v.z < 0) v.z *= 0.2;
    });
    place(knee, P(cop, M.armor, { all: B.plainA }), 0, 0.04, 0.3);
    place(knee, P(blade([[0.24, 0.0], [0.56, 0.14], [0.26, 0.2], [0.14, 0.12]], 0.1, [1, 0.3]), M.trim), 0, 0.06, 0.26);
    place(knee, P(blade([[0.3, 0.3], [0.0, 0.46], [-0.34, 0.3], [-0.24, -0.16], [0.2, -0.2]], 0.06, [1, 1], [0.6, 1]), M.armor, { all: B.plainA }), s * 0.32, 0, 0);
    this.pistons.push(new Piston(hip, new V3(s * 0.22, -0.5, -0.3), knee, new V3(s * 0.22, -0.45, -0.32), 0.06, M));

    // Greave: broad at the top, a tall pointed front plate, the calf boxed in with verniers
    place(knee, P(loft([
      { y: -0.04, w: 0.66, d: 0.8, c: 0.18, z: -0.06 },
      { y: -0.72, w: 0.66, d: 0.88, c: 0.19, z: -0.14 },
      { y: -1.6, w: 0.44, d: 0.56, c: 0.13, z: -0.06 },
      { y: -SH + 0.1, w: 0.42, d: 0.5, c: 0.12, z: 0 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    place(knee, P(frontPrism([[-0.3, -0.16], [0.3, -0.16], [0.28, -1.2], [0.16, -SH + 0.26], [-0.16, -SH + 0.26], [-0.28, -1.2]], 0.12, 0.035), M.armor, { all: B.plainA }), 0, 0, 0.42, 0.05);
    this.plate(knee, 'redPlate', 0.16, s * 0.33, -0.9, -0.06, 0, s * Math.PI / 2);
    const bayY = -1.2;
    place(knee, P(chamferBox(0.36, 0.38, 0.1, 0.04), M.frame, { all: B.ventDark }), 0, bayY, -0.52);
    const calfThr = [];
    for (const x of [-0.09, 0.09]) {
      const t = new Thruster(knee, new V3(x, bayY + 0.04, -0.56), new V3(0, -0.85, -0.6), 0.1, this.glowTex);
      calfThr.push(t);
      this.thrusters.calf.push(t);
    }
    for (const [hy, open] of [[bayY + 0.22, 1.1], [bayY + 0.02, 1.5]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, hy, -0.6);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.4, 0.22, 0.05, 0.03), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.11, 0);
      for (const t of calfThr) t.flaps.push({ pivot, open });
    }
    this.mount(s > 0 ? 'legL' : 'legR', knee, s * 0.34, -1.0, -0.08, 0, 0, -s * Math.PI / 2);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.22, 14, 10), M.trim));
    place(ankle, P(loft([{ y: 0.32, w: 0.48, d: 0.56, c: 0.12 }, { y: -0.12, w: 0.56, d: 0.66, c: 0.14 }]), M.second, { all: B.plainB }));
    // Sabaton: overlapping lames down to a pointed toe cap, and a heel block
    for (let i = 0; i < 3; i++) {
      place(ankle, P(chamferBox(0.52 - i * 0.04, 0.2, 0.36, 0.06), M.armor, { all: B.plainA }), 0, -0.26 - i * 0.07, 0.32 + i * 0.26, 0.28 - i * 0.08);
    }
    place(ankle, P(blade([[0.0, -0.3], [0.4, -0.42], [0.68, -0.58], [0.0, -0.6]], 0.44, [1, 0.3], [1, 0.6]), M.armor, { all: B.plainA, y: B.plainB }), 0, 0, 0.62);
    place(ankle, P(chamferBox(0.4, 0.36, 0.36, 0.08), M.armor, { all: B.plainA }), 0, -0.4, -0.32);
    place(ankle, P(chamferBox(0.5, 0.05, 1.5, 0.02), M.joint), 0, -0.585, 0.3);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.42, -0.1), new V3(0, -1, -0.15), 0.15, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.3;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    place(waist, P(new THREE.CylinderGeometry(0.32, 0.38, 0.72, 12), M.joint), 0, 0.2, -0.04);
    // Abdominal lames
    for (let i = 0; i < 3; i++) place(waist, P(chamferBox(0.62 - i * 0.06, 0.16, 0.12, 0.04), M.armor, { all: B.plainA }), 0, 0.5 - i * 0.16, 0.3 - i * 0.02, -0.08);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.5;
    waist.add(chest);
    // Cuirass: a barrel, broad over the shoulders
    place(chest, P(loft([
      { y: 0.0, w: 1.04, d: 0.86, c: 0.2, z: -0.06 },
      { y: 0.6, w: 1.92, d: 1.28, c: 0.34, z: -0.06 },
      { y: 1.16, w: 2.14, d: 1.3, c: 0.36, z: -0.12 },
      { y: 1.42, w: 1.5, d: 1.0, c: 0.28, z: -0.18 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    // Breastplate: two plates meeting at a raised center ridge, edged in gold
    for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, 0, 0.6);
      g.rotation.y = sd * 0.4;
      chest.add(g);
      place(g, P(frontPrism(mirror([[0.0, 0.12], [0.62, 0.36], [1.0, 0.82], [0.96, 1.34], [0.4, 1.44], [0.0, 1.3]], sd), 0.16, 0.035), M.armor, { all: B.plainA }));
      place(g, P(frontPrism(mirror([[0.06, 0.16], [0.62, 0.4], [0.6, 0.46], [0.06, 0.24]], sd), 0.04, 0.008), M.trim), 0, 0, 0.09);
    }
    place(chest, P(blade([[0.0, 0.1], [0.2, 0.4], [0.18, 1.2], [0.0, 1.36]], 0.12, [1, 0.4]), M.armor, { all: B.plainA }), 0, 0, 0.66);
    place(chest, P(chamferBox(0.08, 0.08, 0.04, 0.01), M.eye), 0, 0.84, 0.86).userData.noOutline = true;
    // Gorget: collar plates rising around the neck
    for (const sd of [-1, 1]) {
      place(chest, P(blade([[0.42, 0.0], [0.34, 0.3], [0.0, 0.42], [-0.4, 0.3], [-0.42, 0.0]], 0.2, [1, 1], [1, 0.6]), M.armor, { all: B.plainA }), sd * 0.5, 1.3, 0.06, 0, 0, -sd * 0.18);
    }
    this.plate(chest, 'e07', 0.42, 0, 0.62, -0.74, 0, Math.PI);
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.42, 0.3);
    head.scale.setScalar(1.12);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.15, 0.2, 0.36, 10), M.joint), 0, 0.04, -0.06);
    // Great helm: a rounded block narrowing to a blunt prow, with a dark visor band across its face
    place(head, P(loftZ([
      { z: -0.3, w: 0.5, h: 0.56, y: 0.34, c: 0.16 },
      { z: 0.1, w: 0.56, h: 0.62, y: 0.34, c: 0.17 },
      { z: 0.34, w: 0.44, h: 0.52, y: 0.3, c: 0.13 },
    ]), M.armor, { all: B.plainA }));
    const visor = place(head, P(loftZ([
      { z: 0.2, w: 0.58, h: 0.16, y: 0.36, c: 0.05 },
      { z: 0.38, w: 0.44, h: 0.13, y: 0.35, c: 0.04 },
    ]), M.joint));
    visor.userData.noOutline = true;
    // The slit, and the mono-eye that sweeps along it
    place(head, new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.018, 0.02), M.sensor), 0, 0.36, 0.385).userData.noOutline = true;
    const eye = (this.monoEye = new THREE.Group());
    eye.position.set(0, 0.36, 0.39);
    head.add(eye);
    place(eye, new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd0c0, toneMapped: false })));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff3a30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.85 }));
    glow.scale.setScalar(0.36);
    glow.renderOrder = 6;
    place(eye, glow, 0, 0, 0.02);
    // Breaths along the cheeks, a chin guard, and a crest fin from the brow back over the crown
    for (const sd of [-1, 1]) {
      place(head, P(blade([[0.36, 0.26], [0.1, 0.28], [-0.24, 0.36], [-0.3, 0.1], [0.06, 0.04], [0.32, 0.12]], 0.06, [1, 0.6]), M.armor, { all: B.plainA }), sd * 0.29, 0, 0, 0, -sd * 0.12, 0);
      for (let k = 0; k < 3; k++) place(head, P(chamferBox(0.012, 0.08, 0.05, 0.004), M.joint), sd * 0.322, 0.17, 0.12 - k * 0.09);
      // Swept horns
      place(head, P(blade([[0.06, 0.0], [-0.18, 0.1], [-0.56, 0.32], [-0.5, 0.2], [-0.12, -0.06]], 0.05, [0.4, 1]), M.trim), sd * 0.28, 0.52, -0.02, 0, sd * 0.3, -sd * 0.3);
    }
    place(head, P(blade([[0.38, 0.12], [0.2, 0.04], [-0.1, 0.06], [-0.04, 0.2]], 0.34, [1, 0.6]), M.armor, { all: B.plainA }), 0, 0, 0);
    const crest = place(head, P(blade([[0.36, 0.52], [0.3, 0.76], [0.06, 0.96], [-0.34, 1.02], [-0.62, 0.86], [-0.3, 0.62], [0.0, 0.6]], 0.06, [0.6, 1], [1, 0.7]), M.armor, { all: B.plainA }));
    place(crest, P(blade([[0.32, 0.74], [0.06, 0.94], [-0.3, 0.99], [-0.28, 0.95], [0.04, 0.9], [0.28, 0.72]], 0.075, [1, 1]), M.trim));
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.34, 1.0, -0.04);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.3, 14, 10), M.joint));
    // Pauldron: three curved lames stacked down the shoulder, under a raised rim
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.26, 0.12, 0);
    sh.add(pauldron);
    const lame = (w, h, d, curl) => warp(new THREE.BoxGeometry(w, h, d, 6, 1, 4), (v, n) => {
      const a = (n.x - 0.5) * 2;   // -1..1 across the shoulder
      v.y -= a * a * curl;          // droop over the sides
      v.z *= 1 - 0.2 * a * a;
    });
    place(pauldron, P(lame(0.96, 0.18, 1.0, 0.14), M.armor, { all: B.plainA }), s * 0.1, 0.3, 0);
    place(pauldron, P(lame(0.86, 0.18, 0.94, 0.14), M.armor, { all: B.plainA }), s * 0.22, 0.14, 0, 0, 0, -s * 0.32);
    place(pauldron, P(lame(0.74, 0.18, 0.88, 0.14), M.armor, { all: B.plainA }), s * 0.34, -0.06, 0, 0, 0, -s * 0.62);
    place(pauldron, P(blade([[0.5, 0.0], [0.4, 0.26], [-0.2, 0.34], [-0.56, 0.18], [-0.5, 0.0]], 0.06, [1, 1], [1, 0.4]), M.trim), s * 0.42, 0.34, 0, 0, 0, s * 0.25);
    place(pauldron, P(chamferBox(0.06, 0.06, 0.94, 0.02), M.trim), s * 0.14, 0.38, 0);
    if (s > 0) this.plate(pauldron, 'p07', 0.3, s * 0.54, -0.2, 0, 0, s * Math.PI / 2, 0.62 * s);
    else this.plate(pauldron, 'slash', 0.3, s * 0.54, -0.2, 0, 0, s * Math.PI / 2, 0.62 * s);

    place(sh, P(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 10), M.joint), 0, -0.5, 0);
    place(sh, P(loft([{ y: -0.34, w: 0.42, d: 0.48, c: 0.11 }, { y: -0.84, w: 0.46, d: 0.52, c: 0.12 }]), M.second, { all: B.plainB }), s * 0.04, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.0;
    sh.add(elbow);
    place(elbow, P(cylX(0.2, 0.5), M.joint));
    // Couter: a pointed fan over the elbow
    place(elbow, P(blade([[0.1, 0.24], [-0.38, 0.12], [-0.46, -0.1], [-0.1, -0.24]], 0.08, [0.5, 1]), M.armor, { all: B.plainA }), s * 0.28, 0, 0);
    // Vambrace flaring into a gauntlet cuff
    place(elbow, P(loft([
      { y: -0.04, w: 0.48, d: 0.56, c: 0.12, z: -0.02 },
      { y: -0.6, w: 0.56, d: 0.66, c: 0.14, z: 0.0 },
      { y: -0.92, w: 0.64, d: 0.74, c: 0.16, z: 0.02 },
      { y: -1.16, w: 0.5, d: 0.58, c: 0.13 },
    ]), M.armor, { all: B.plainA }));
    place(elbow, P(chamferBox(0.66, 0.06, 0.76, 0.03), M.trim), 0, -0.9, 0.02);
    this.plate(elbow, 'r07', 0.3, s * 0.31, -0.5, 0, 0, s * Math.PI / 2);
    this.pistons.push(new Piston(sh, new V3(0, -0.42, 0.24), elbow, new V3(0, -0.3, 0.32), 0.055, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.44, -0.55, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.8);
    elbow.add(shieldMount);

    const hand = new THREE.Group();
    hand.position.set(0, -1.22, 0.02);
    elbow.add(hand);
    place(hand, P(chamferBox(0.36, 0.38, 0.44, 0.07), M.joint), 0, -0.16, 0);
    place(hand, P(chamferBox(0.36, 0.18, 0.46, 0.05), M.armor, { all: B.plainA }), 0, -0.36, 0.06, 0.35);
    place(hand, P(chamferBox(0.38, 0.05, 0.1, 0.02), M.trim), 0, -0.08, 0.2);
    place(hand, P(chamferBox(0.11, 0.26, 0.13, 0.03), M.joint), -s * 0.18, -0.23, 0.18, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.26, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 0.72, -0.66);
    this.chest.add(bp);
    // Spine block between two upright booster pods
    place(bp, P(loft([
      { y: 0.62, w: 0.7, d: 0.44, c: 0.12, z: -0.18 },
      { y: -0.4, w: 0.8, d: 0.54, c: 0.14, z: -0.22 },
    ]), M.armor, { all: B.plainA, x: B.vent }));
    this.plate(bp, 'hotPanel', 0.32, 0, 0.1, -0.5, 0, Math.PI);
    for (const s of [-1, 1]) {
      const pod = new THREE.Group();
      pod.position.set(s * 0.62, 0.1, -0.42);
      pod.rotation.z = -s * 0.08;
      bp.add(pod);
      // Engine nacelle with a nose cone, an intake ring and fins
      place(pod, P(new THREE.CylinderGeometry(0.34, 0.36, 1.6, 14), M.second, { all: B.plainA }), 0, 0, 0);
      place(pod, P(new THREE.ConeGeometry(0.34, 0.5, 14), M.armor, { all: B.plainA }), 0, 1.05, 0);
      place(pod, P(new THREE.CylinderGeometry(0.37, 0.37, 0.12, 14), M.trim), 0, 0.72, 0);
      place(pod, P(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 14), M.joint), 0, -0.6, 0);
      place(pod, P(blade([[0.1, 0.4], [-0.5, 0.2], [-0.62, -0.5], [0.1, -0.4]], 0.06, [0.4, 1]), M.armor, { all: B.plainA }), s * 0.36, -0.1, -0.06, 0, 0, -s * 0.2);
      const dir = new V3(0, -1, -0.4).normalize();
      this.thrusters.main.push(new Thruster(pod, new V3(0, -0.82, 0), dir, 0.4, this.glowTex, {
        actuators: [new V3(0.26, -0.66, 0.14), new V3(-0.26, -0.66, 0.14), new V3(0, -0.66, -0.3)],
      }));
      // Shoulder hardpoints sit on a saddle on top of each pod
      place(bp, P(chamferBox(0.5, 0.12, 0.6, 0.04), M.joint), s * 0.86, 0.66, -0.3);
      this.mount(s > 0 ? 'shoulderL' : 'shoulderR', bp, s * 0.86, 0.72, -0.34, -0.12);
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.4, 0.5, -0.46), new V3(s * 0.25, 0.1, -1), 0.14, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 22, 1.8);
    this.thrustLight.position.set(0, -1.6, -0.9);
    bp.add(this.thrustLight);
  }

  onAnimate(dt, st, idle) {
    // The mono-eye sweeps the slit while it stands; aiming snaps it to the target side
    const t = st.time;
    const look = Math.max(this.w.aim[0], this.w.aim[1]);
    const x = (Math.sin(t * 0.9) * 0.14 + Math.sin(t * 2.3) * 0.02) * idle + Math.max(-0.14, Math.min(0.14, (st.aimYaw - this.w.twist) * 0.3)) * look;
    this.monoEye.position.x += (x - this.monoEye.position.x) * Math.min(1, dt * 8);
  }
}
