import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, warp, loftZ, mirror } from '../mech.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// HV-90 Goliath: a heavy brawler that stands like a gorilla. A barrel chest and
// shoulder blocks that rise past its head, which sits low and forward between
// them behind a toothed chin guard. Long, thick arms end in big fists; the legs
// are short and wide, on white knee caps and broad feet. A reactor block on its
// back vents through stacks over two big main engines.
// ---------------------------------------------------------------------------

const RIG = {
  scale: 1.28,
  leg: { hipDrop: 0.2, thigh: 1.55, shin: 1.8, foot: 0.62 },
  gait: { bodyH: 3.32, dip: 0.26, homeX: 1.42, lift: 0.3, cadence: 1.15, sway: 0.2, twist: 0.12, settle: 0.5, settleTime: 0.5 },
  idleFeet: [[-1.48, -0.38], [1.52, 0.52]],
  stance: { splay: 0.2, yaw: 0.2 },
  pole: [0.9, 0.05, 1],
  fk: { air: [[-0.15, 0.78], [-0.7, 1.25]], dash: [[0.15, 0.9], [-0.1, 0.8]], crouch: [-0.55, 1.05] },
  crouchDrop: 0.72,
  hunch: 0.36, hunchIdle: 0.12, armOut: 0.3,
};

export class Goliath extends Mech {
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
      { y: 0.36, w: 1.5, d: 1.2, c: 0.26 },
      { y: 0.04, w: 1.76, d: 1.34, c: 0.3 },
      { y: -0.36, w: 0.92, d: 0.9, c: 0.2 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.3, 2.1), M.joint), 0, -0.16, 0);
    // Heavy codpiece in two layers and a rear plate
    place(p, P(frontPrism([[-0.5, 0.24], [0.5, 0.24], [0.34, -0.26], [0, -0.56], [-0.34, -0.26]], 0.2, 0.04), M.armor, { all: B.plainA }), 0, 0.02, 0.68);
    place(p, P(frontPrism([[-0.26, 0.12], [0.26, 0.12], [0.16, -0.16], [0, -0.3], [-0.16, -0.16]], 0.08, 0.02), M.white, { all: B.plainA }), 0, -0.04, 0.8);
    place(p, P(frontPrism([[-0.7, 0.26], [0.7, 0.26], [0.5, -0.36], [-0.5, -0.36]], 0.16, 0.04), M.armor, { all: B.plainA }), 0, 0.02, -0.68);
    // Side skirt blocks that swing with the thighs, and the hip hardpoints behind them
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 1.0, 0.18, 0.05);
      g.rotation.z = s * 0.14;
      p.add(g);
      place(g, P(loft([
        { y: 0.2, w: 0.3, d: 1.06, c: 0.08, z: 0.04 },
        { y: -0.6, w: 0.28, d: 0.9, c: 0.08, z: 0.08 },
      ]), M.armor, { all: B.plainA, x: B.plainA }), s * 0.26, 0, 0);
      place(g, P(chamferBox(0.06, 0.06, 0.8, 0.02), M.trim), s * 0.41, 0.08, 0.06);
      return g;
    });
    for (const [key, s] of [['hipR', -1], ['hipL', 1]]) {
      place(p, P(chamferBox(0.5, 0.2, 0.5, 0.06), M.joint), s * 0.86, 0.32, -0.78);
      this.mount(key, p, s * 1.0, 0.42, -0.86, 0, 0, -s * Math.PI / 2);
    }
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 0.95, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(new THREE.SphereGeometry(0.42, 16, 10), M.joint));
    // Thick thigh with a layered front plate
    place(hip, P(loft([
      { y: -0.1, w: 0.96, d: 1.1, c: 0.24, z: 0.02 },
      { y: -0.7, w: 1.02, d: 1.18, c: 0.26, z: 0.06 },
      { y: -TH + 0.3, w: 0.76, d: 0.86, c: 0.2, z: 0.04 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    place(hip, P(frontPrism([[-0.4, -0.1], [0.4, -0.1], [0.42, -0.84], [0.0, -1.1], [-0.42, -0.84]], 0.14, 0.04), M.armor, { all: B.plainA }), 0, 0, 0.6);
    place(hip, P(blade([[0.5, 0.0], [0.5, -0.9], [0.1, -1.2], [-0.5, -1.0], [-0.62, -0.2], [-0.3, 0.06]], 0.14, [0.5, 1], [0.7, 1]), M.armor, { all: B.plainA }), s * 0.52, -0.05, 0);
    this.plate(hip, 'r07', 0.3, s * 0.6, -0.55, 0.02, 0, s * Math.PI / 2);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, P(cylX(0.36, 0.9), M.joint));
    for (const x of [-0.47, 0.47]) place(knee, P(cylX(0.22, 0.08, 12), M.trim), x, 0, 0);
    // Big white knee cap
    const cap = warp(new THREE.SphereGeometry(1, 10, 7), (v) => {
      v.set(v.x * 0.5, v.y * 0.56, v.z * 0.38);
      if (v.z < 0) v.z *= 0.2;
      v.y += Math.max(0, v.z) * 0.3;
    });
    place(knee, P(cap, M.white, { all: B.plainA }), 0, 0.05, 0.36);
    place(knee, P(chamferBox(0.5, 0.06, 0.06, 0.02), M.joint), 0, 0.05, 0.75);
    this.pistons.push(new Piston(hip, new V3(s * 0.3, -0.4, -0.45), knee, new V3(s * 0.3, -0.5, -0.4), 0.09, M));
    this.pistons.push(new Piston(hip, new V3(-s * 0.3, -0.4, -0.45), knee, new V3(-s * 0.3, -0.5, -0.4), 0.09, M));

    // Wide greave and calf block
    place(knee, P(loft([
      { y: -0.1, w: 0.98, d: 1.12, c: 0.24, z: -0.04 },
      { y: -0.75, w: 1.04, d: 1.24, c: 0.26, z: -0.1 },
      { y: -SH + 0.25, w: 0.78, d: 0.9, c: 0.2, z: -0.02 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    place(knee, P(frontPrism([[-0.44, -0.12], [0.44, -0.12], [0.46, -0.9], [0.3, -1.42], [-0.3, -1.42], [-0.46, -0.9]], 0.16, 0.04), M.armor, { all: B.plainA }), 0, 0, 0.6);
    place(knee, P(frontPrism([[-0.3, 0.0], [0.3, 0.0], [0.24, -0.34], [-0.24, -0.34]], 0.06, 0.02), M.white, { all: B.plainA }), 0, -0.5, 0.7);
    place(knee, P(blade([[-0.3, -0.12], [-0.86, -0.3], [-0.88, -1.1], [-0.4, -1.4]], 0.6, [0.6, 1]), M.armor, { all: B.plainA }));
    const bayY = -0.85;
    place(knee, P(chamferBox(0.56, 0.4, 0.1, 0.05), M.frame, { all: B.ventDark }), 0, bayY, -0.78);
    const calfThr = [];
    for (const x of [-0.14, 0.14]) {
      const t = new Thruster(knee, new V3(x, bayY + 0.04, -0.82), new V3(0, -0.85, -0.6), 0.14, this.glowTex);
      calfThr.push(t);
      this.thrusters.calf.push(t);
    }
    {
      const pivot = new THREE.Group();
      pivot.position.set(0, bayY + 0.22, -0.88);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.6, 0.42, 0.06, 0.04), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.21, 0);
      for (const t of calfThr) t.flaps.push({ pivot, open: 1.2 });
    }
    // Leg hardpoint on the outside of the greave
    this.mount(s > 0 ? 'legL' : 'legR', knee, s * 0.58, -0.8, -0.06, 0, 0, -s * Math.PI / 2);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.32, 14, 10), M.trim));
    place(ankle, P(loft([{ y: 0.3, w: 0.7, d: 0.8, c: 0.16 }, { y: -0.2, w: 0.84, d: 0.96, c: 0.2 }]), M.second, { all: B.plainB }));
    // Broad foot: a toe block with a white cap, side guards and a heel block
    place(ankle, P(loft([
      { y: -0.14, w: 0.9, d: 1.0, c: 0.2, z: 0.36 },
      { y: -0.6, w: 1.08, d: 1.36, c: 0.24, z: 0.42 },
    ]), M.armor, { all: B.plainA, y: B.plainB }));
    place(ankle, P(loft([
      { y: -0.3, w: 0.86, d: 0.36, c: 0.12, z: 1.0 },
      { y: -0.6, w: 1.0, d: 0.46, c: 0.14, z: 1.06 },
    ]), M.white, { all: B.plainA }));
    for (const sd of [-1, 1]) place(ankle, P(blade([[0.9, -0.6], [0.6, -0.2], [-0.2, -0.12], [-0.5, -0.6]], 0.08, [1, 0.6]), M.second, { all: B.plainB }), sd * 0.56, 0, 0);
    place(ankle, P(loft([
      { y: -0.1, w: 0.6, d: 0.5, c: 0.14, z: -0.5 },
      { y: -0.6, w: 0.8, d: 0.64, c: 0.16, z: -0.56 },
    ]), M.armor, { all: B.plainA, y: B.plainB }));
    place(ankle, P(chamferBox(1.02, 0.05, 2.0, 0.02), M.joint), 0, -0.6, 0.24);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.44, 0.1), new V3(0, -1, -0.12), 0.2, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.34;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    place(waist, P(new THREE.CylinderGeometry(0.56, 0.66, 0.74, 14), M.joint), 0, 0.2, -0.06);
    // Layered belly plates
    for (let i = 0; i < 3; i++) {
      place(waist, P(chamferBox(0.86 - i * 0.08, 0.22, 0.16, 0.05), i === 1 ? M.white : M.armor, { all: B.plainA }), 0, 0.42 - i * 0.2, 0.52 - i * 0.03, -0.12);
    }

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.56;
    waist.add(chest);
    // Barrel chest, deepest and widest up at the shoulders
    place(chest, P(loft([
      { y: 0.0, w: 1.5, d: 1.3, c: 0.3, z: -0.05 },
      { y: 0.7, w: 2.6, d: 1.96, c: 0.46, z: 0.0 },
      { y: 1.5, w: 2.84, d: 2.06, c: 0.5, z: -0.1 },
      { y: 1.96, w: 2.0, d: 1.5, c: 0.4, z: -0.24 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    // Pectoral plates sweeping up to the shoulders over a center keel
    for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, 0, 0.96);
      g.rotation.y = sd * 0.3;
      chest.add(g);
      place(g, P(frontPrism(mirror([[0.06, 0.3], [0.9, 0.42], [1.32, 0.96], [1.26, 1.62], [0.5, 1.78], [0.06, 1.46]], sd), 0.22, 0.04), M.armor, { all: B.plainA }));
      place(g, P(frontPrism(mirror([[0.7, 0.9], [1.12, 1.1], [1.08, 1.18], [0.66, 1.0]], sd), 0.05, 0.01), M.trim), 0, 0, 0.12);
      // Intake grille under each plate
      place(chest, P(chamferBox(0.5, 0.3, 0.12, 0.05), M.joint, { pz: B.ventDark, all: B.mechA }), sd * 0.58, 0.32, 0.92, 0.2);
    }
    place(chest, P(blade([[0.0, 0.3], [0.18, 0.6], [0.14, 1.3], [0.0, 1.46]], 0.2, [1, 0.5]), M.second, { all: B.plainA }), 0, 0, 1.0);
    place(chest, P(chamferBox(0.08, 0.08, 0.05, 0.01), M.eye), 0, 0.5, 1.14).userData.noOutline = true;
    // Shoulder hardpoints high on the back, above the shoulder blocks
    for (const [key, sd] of [['shoulderR', -1], ['shoulderL', 1]]) {
      place(chest, P(chamferBox(0.7, 0.18, 0.8, 0.06), M.joint), sd * 1.1, 1.98, -0.72);
      this.mount(key, chest, sd * 1.1, 2.06, -0.8, -0.1);
    }
  }

  buildHead() {
    const M = this.mats;
    // Small head sunk low and forward between the shoulders
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.42, 1.02);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.22, 0.28, 0.4, 10), M.joint), 0, 0.02, -0.2);
    place(head, P(loftZ([
      { z: -0.34, w: 0.7, h: 0.58, y: 0.26, c: 0.16 },
      { z: 0.16, w: 0.74, h: 0.56, y: 0.24, c: 0.16 },
      { z: 0.46, w: 0.5, h: 0.38, y: 0.18, c: 0.1 },
    ]), M.armor, { all: B.plainA }));
    // Brow ridge over a dark visor band with two eyes
    place(head, P(blade([[0.5, 0.42], [0.2, 0.58], [-0.3, 0.6], [-0.36, 0.44], [0.1, 0.4]], 0.66, [1, 0.6]), M.armor, { all: B.plainA }));
    place(head, P(frontPrism([[-0.3, 0.07], [0.3, 0.07], [0.26, -0.07], [-0.26, -0.07]], 0.06, 0.015), M.joint), 0, 0.3, 0.47, -0.12);
    for (const sd of [-1, 1]) {
      place(head, new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.02), M.eye), sd * 0.14, 0.3, 0.5, -0.12, -sd * 0.15, 0).userData.noOutline = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff9a4a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.55 }));
      glow.scale.setScalar(0.3);
      glow.renderOrder = 6;
      place(head, glow, sd * 0.14, 0.3, 0.53);
      this.eyeGlows = (this.eyeGlows || []).concat(glow);
    }
    // White chin guard with vertical teeth slots
    const jaw = place(head, P(loftZ([
      { z: -0.1, w: 0.62, h: 0.24, y: 0.0, c: 0.07 },
      { z: 0.5, w: 0.46, h: 0.2, y: 0.02, c: 0.06 },
    ]), M.white, { all: B.plainA }));
    for (let i = -2; i <= 2; i++) place(jaw, P(chamferBox(0.035, 0.14, 0.03, 0.01), M.joint), i * 0.07, 0.02, 0.5);
    for (const sd of [-1, 1]) {
      place(head, P(blade([[0.3, 0.06], [0.1, 0.24], [-0.3, 0.34], [-0.36, 0.0], [0.0, -0.1]], 0.06, [1, 0.6]), M.armor, { all: B.plainA }), sd * 0.38, 0.12, 0.0, 0, -sd * 0.12, 0);
    }
    place(head, P(new THREE.CylinderGeometry(0.012, 0.025, 0.7, 6), M.trim), -0.22, 0.72, -0.2, -0.4, 0, 0.1);
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.72, 1.36, -0.1);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.48, 16, 12), M.joint));
    // Shoulder block that rises above the head, with a white bracket emblem
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.28, 0.32, 0);
    sh.add(pauldron);
    const blockGeo = warp(new THREE.BoxGeometry(1.2, 1.24, 1.56, 2, 2, 2), (v, n) => {
      v.y -= n.z * 0.1;                 // lean back
      v.x *= 1 - 0.18 * n.y;            // narrower on top
      if (n.y > 0.99) v.z *= 0.86;      // chamfered top front and back
    });
    place(pauldron, P(blockGeo, M.armor, { all: B.plainA, x: B.plainA }), s * 0.2, 0.1, 0.02);
    place(pauldron, P(chamferBox(1.0, 0.12, 1.4, 0.04), M.second), s * 0.22, -0.56, 0.02);
    place(pauldron, P(frontPrism(mirror([[0.16, 0.22], [0.0, 0.22], [-0.1, 0.0], [0.0, -0.22], [0.16, -0.22], [0.08, -0.12], [0.02, 0.0], [0.08, 0.12]], s), 0.04, 0.01), M.white), s * 0.25, 0.22, 0.81);
    place(pauldron, P(frontPrism([[-0.5, 0.06], [0.5, 0.06], [0.5, -0.06], [-0.5, -0.06]], 1.3, 0.02), M.trim), s * 0.22, 0.5, 0.0);
    this.plate(pauldron, 'danger', 0.62, s * 0.81, 0.06, 0.04, 0, s * Math.PI / 2);

    // Thick upper arm
    place(sh, P(new THREE.CylinderGeometry(0.26, 0.26, 1.1, 12), M.joint), 0, -0.62, 0);
    place(sh, P(loft([{ y: -0.42, w: 0.74, d: 0.8, c: 0.18 }, { y: -1.12, w: 0.7, d: 0.76, c: 0.17 }]), M.second, { all: B.plainB }), s * 0.04, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.3;
    sh.add(elbow);
    place(elbow, P(cylX(0.32, 0.76), M.joint));
    for (const x of [-0.4, 0.4]) place(elbow, P(cylX(0.2, 0.06, 12), M.trim), x, 0, 0);
    // Gauntlet: a huge forearm block, white knuckle plates
    place(elbow, P(loft([
      { y: -0.04, w: 0.8, d: 0.9, c: 0.2, z: -0.02 },
      { y: -0.6, w: 1.0, d: 1.1, c: 0.25, z: 0.03 },
      { y: -1.24, w: 0.92, d: 1.0, c: 0.23, z: 0.03 },
      { y: -1.42, w: 0.72, d: 0.8, c: 0.18 },
    ]), M.armor, { all: B.plainA }));
    place(elbow, P(blade([[0.52, -0.2], [0.56, -1.2], [0.2, -1.42], [-0.5, -1.2], [-0.8, 0.2], [-0.4, 0.26]], 0.14, [0.5, 1]), M.armor, { all: B.plainA }), s * 0.52, 0, 0);
    place(elbow, P(chamferBox(0.06, 0.5, 0.6, 0.03), M.joint, { all: B.ventDark }), s * 0.6, -0.65, 0.04);
    this.pistons.push(new Piston(sh, new V3(0, -0.5, 0.42), elbow, new V3(0, -0.4, 0.52), 0.09, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.62, -0.7, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.9);
    elbow.add(shieldMount);

    // Big fist
    const hand = new THREE.Group();
    hand.position.set(0, -1.5, 0.04);
    elbow.add(hand);
    place(hand, P(chamferBox(0.6, 0.5, 0.68, 0.12), M.joint), 0, -0.2, 0);
    place(hand, P(chamferBox(0.62, 0.26, 0.5, 0.08), M.white, { all: B.plainA }), 0, -0.48, 0.14, 0.4);
    for (const x of [-0.18, 0, 0.18]) place(hand, P(chamferBox(0.14, 0.1, 0.14, 0.03), M.joint), x, -0.4, 0.4);
    place(hand, P(chamferBox(0.18, 0.38, 0.2, 0.05), M.joint), -s * 0.3, -0.3, 0.24, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.36, 0.04);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 1.0, -1.08);
    this.chest.add(bp);
    // Reactor block with vent stacks
    place(bp, P(loft([
      { y: 0.8, w: 1.7, d: 0.7, c: 0.2, z: -0.26 },
      { y: 0.0, w: 1.96, d: 0.9, c: 0.26, z: -0.34 },
      { y: -0.7, w: 1.6, d: 0.76, c: 0.22, z: -0.3 },
    ]), M.armor, { all: B.plainA, x: B.vent }));
    place(bp, P(chamferBox(0.9, 1.0, 0.12, 0.08), M.second, { all: B.mechA }), 0, 0.1, -0.8);
    this.plate(bp, 'hotPanel', 0.5, 0, 0.1, -0.88, 0, Math.PI);
    for (const s of [-1, 1]) {
      for (const k of [0, 1]) {
        const x = s * (0.3 + k * 0.28);
        place(bp, P(new THREE.CylinderGeometry(0.11, 0.13, 0.9, 10), M.joint), x, 1.0, -0.62, -0.35, 0, 0);
        place(bp, P(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10), M.trim), x, 1.42, -0.78, -0.35, 0, 0);
      }
      // Main engine housing under each lower corner
      const hx = s * 0.56;
      place(bp, P(loft([
        { y: -0.3, w: 0.74, d: 0.9, c: 0.18, z: -0.4 },
        { y: -0.9, w: 0.78, d: 0.94, c: 0.2, z: -0.46 },
        { y: -1.1, w: 0.64, d: 0.76, c: 0.18, z: -0.48 },
      ]), M.second, { x: B.hot, all: B.plainA }), hx, 0, 0);
      const dir = new V3(0, -1, -0.45).normalize();
      const mountPos = new V3(hx, -1.1, -0.68);
      const ring = place(bp, P(new THREE.CylinderGeometry(0.46, 0.5, 0.14, 16), M.joint), mountPos.x, mountPos.y, mountPos.z);
      ring.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.6, this.glowTex, {
        actuators: [new V3(hx + 0.38, -0.95, -0.56), new V3(hx - 0.38, -0.95, -0.56), new V3(hx, -0.98, -0.95)],
      }));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.94, 0.3, -0.62), new V3(s * 0.25, 0.05, -1), 0.2, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 26, 1.8);
    this.thrustLight.position.set(0, -2.0, -1.0);
    bp.add(this.thrustLight);
  }
}
