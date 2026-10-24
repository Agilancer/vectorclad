import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, cylZ, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, loftZ } from '../mech.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// RJ-6 Locust: a reverse-joint light. Its knees bend backward like a bird's,
// with a shock ram behind each one, over three-toed talons. A low wedge body
// rides between big thighs that carry the leg hardpoints; the head is a
// cluster of four eyes like a jumping spider's, and a pair of jump-jet
// nacelles on its back throw it high.
// ---------------------------------------------------------------------------

const RIG = {
  scale: 0.92,
  bend: -1,
  leg: { hipDrop: 0.16, thigh: 1.95, shin: 2.25, foot: 0.5 },
  gait: { bodyH: 3.62, homeX: 1.04, dip: 0.24, lift: 0.42, cadence: 0.9, sway: 0.12, twist: 0.08, settle: 0.4 },
  pole: [0.25, 0.05, -1],
  idleFeet: [[-1.04, -0.3], [1.1, 0.5]],
  stance: { splay: 0.12, yaw: 0.1 },
  // Knees fold back: thighs swing back and shins forward
  fk: { air: [[0.75, -1.4], [1.05, -1.85]], dash: [[0.45, -0.95], [0.7, -1.25]], crouch: [-0.6, 1.2] },
  crouchDrop: 0.9,
  hunch: 0.16, hunchIdle: 0.06, armOut: 0.17,
};

export class Locust extends Mech {
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
      { y: 0.28, w: 0.7, d: 0.8, c: 0.16 },
      { y: 0.0, w: 0.86, d: 0.9, c: 0.18 },
      { y: -0.26, w: 0.46, d: 0.56, c: 0.13 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.2, 1.4), M.joint), 0, -0.1, 0);
    place(p, P(frontPrism([[-0.24, 0.14], [0.24, 0.14], [0.16, -0.18], [0, -0.34], [-0.16, -0.18]], 0.12, 0.03), M.armor, { all: B.plainA }), 0, 0, 0.44);
    // Tail plate over the hips at the back
    place(p, P(blade([[0.0, 0.2], [-0.5, 0.16], [-0.9, -0.08], [-0.4, -0.2], [0.0, -0.12]], 0.36, [0.5, 1]), M.armor, { all: B.plainA }), 0, 0.02, -0.36);
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 0.72, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(cylX(0.34, 0.4, 16), M.joint));
    place(hip, P(cylX(0.24, 0.06, 14), M.trim), s * 0.22, 0, 0);
    // Thigh: a big muscular block, thick at the hip, tapering down to the reverse knee
    place(hip, P(loft([
      { y: 0.1, w: 0.62, d: 0.9, c: 0.18, z: 0.02 },
      { y: -0.6, w: 0.72, d: 1.04, c: 0.22, z: -0.02 },
      { y: -1.4, w: 0.5, d: 0.7, c: 0.15, z: -0.04 },
      { y: -TH + 0.2, w: 0.36, d: 0.46, c: 0.1, z: 0 },
    ]), M.armor, { all: B.plainA, x: B.plainA }), s * 0.06, 0, 0);
    // Outer plate with the red stripe panel, and a front plate
    place(hip, P(blade([[0.52, 0.06], [0.48, -0.7], [0.1, -1.36], [-0.42, -1.2], [-0.56, -0.3], [-0.24, 0.1]], 0.1, [0.6, 1], [0.6, 1]), M.second, { all: B.plainA }), s * 0.42, 0, 0);
    this.plate(hip, 'redPlate', 0.18, s * 0.48, -0.5, 0.02, 0, s * Math.PI / 2);
    place(hip, P(frontPrism([[-0.26, 0.0], [0.26, 0.0], [0.24, -0.9], [0.0, -1.1], [-0.24, -0.9]], 0.1, 0.03), M.white, { all: B.plainA }), s * 0.06, -0.1, 0.52);
    // Leg hardpoint on the thigh's outer plate
    this.mount(s > 0 ? 'legL' : 'legR', hip, s * 0.5, -0.72, -0.02, 0, 0, -s * Math.PI / 2);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    // The knee points backward: a drum joint with a spur raking back
    place(knee, P(cylX(0.24, 0.5), M.joint));
    for (const x of [-0.27, 0.27]) place(knee, P(cylX(0.15, 0.05, 12), M.trim), x, 0, 0);
    place(knee, P(blade([[-0.1, 0.2], [-0.62, 0.34], [-0.7, 0.1], [-0.22, -0.2]], 0.3, [0.4, 1]), M.armor, { all: B.plainA }));
    // Shock ram from the back of the thigh down to the shin
    this.pistons.push(new Piston(hip, new V3(0, -0.6, -0.42), knee, new V3(0, -0.9, -0.2), 0.08, M));
    // Shin: twin struts behind a narrow plate, running down and forward to the ankle
    for (const x of [-0.12, 0.12]) place(knee, P(new THREE.CylinderGeometry(0.07, 0.06, SH - 0.2, 8), M.joint), x, -SH / 2, -0.04);
    place(knee, P(loft([
      { y: -0.1, w: 0.36, d: 0.44, c: 0.1, z: 0.02 },
      { y: -1.1, w: 0.3, d: 0.4, c: 0.08, z: 0.04 },
      { y: -SH + 0.2, w: 0.26, d: 0.34, c: 0.07, z: 0.02 },
    ]), M.second, { all: B.plainB }));
    place(knee, P(blade([[0.24, -0.1], [0.32, -0.8], [0.22, -SH + 0.3], [0.1, -SH + 0.4], [0.12, -0.3]], 0.3, [1, 1], [0.5, 1]), M.armor, { all: B.plainA }));
    // Jump vernier low on the back of the shin
    this.thrusters.calf.push(new Thruster(knee, new V3(0, -SH + 0.55, -0.24), new V3(0, -0.9, -0.45), 0.12, this.glowTex));

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.2, 14, 10), M.trim));
    place(ankle, P(loft([{ y: 0.12, w: 0.36, d: 0.4, c: 0.09 }, { y: -0.2, w: 0.46, d: 0.5, c: 0.11 }]), M.second, { all: B.plainB }));
    // Talons: a long center toe, two splayed side toes and a dewclaw spur
    place(ankle, P(blade([[-0.1, -0.14], [0.34, -0.2], [1.16, -0.44], [1.2, -0.5], [-0.16, -0.5]], 0.26, [1, 0.35]), M.armor, { all: B.plainA, y: B.plainB }));
    for (const sd of [-1, 1]) {
      const toe = place(ankle, P(blade([[0, -0.2], [0.82, -0.44], [0.86, -0.5], [0, -0.5]], 0.14, [1, 0.3]), M.second, { all: B.plainB }), sd * 0.18, 0, 0.06);
      toe.rotation.y = sd * 0.5;
    }
    place(ankle, P(blade([[0.0, -0.1], [-0.3, 0.0], [-0.8, -0.44], [-0.74, -0.5], [0.0, -0.5]], 0.18, [0.3, 1]), M.armor, { all: B.plainA }));
    place(ankle, P(chamferBox(0.4, 0.04, 1.2, 0.02), M.joint), 0, -0.485, 0.2);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.32, 0.1), new V3(0, -1, -0.1), 0.14, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.26;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    place(waist, P(new THREE.CylinderGeometry(0.26, 0.32, 0.6, 12), M.joint), 0, 0.16, -0.04);
    for (const sd of [-1, 1]) place(waist, P(new THREE.CylinderGeometry(0.035, 0.035, 0.56, 8), M.trim), sd * 0.22, 0.2, 0.2, 0, 0, sd * 0.12);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.42;
    waist.add(chest);
    // Thorax: a long, low wedge with a pointed nose and a raised canopy
    place(chest, P(loftZ([
      { z: -0.9, w: 1.3, h: 0.9, y: 0.6, c: 0.24 },
      { z: -0.2, w: 1.7, h: 1.2, y: 0.62, c: 0.3 },
      { z: 0.5, w: 1.5, h: 1.0, y: 0.6, c: 0.26 },
      { z: 1.0, w: 0.7, h: 0.5, y: 0.5, c: 0.14 },
    ]), M.armor, { all: B.plainA, x: B.plainA }));
    place(chest, P(loftZ([
      { z: -0.5, w: 0.9, h: 0.24, y: 1.2, c: 0.08 },
      { z: 0.4, w: 0.8, h: 0.22, y: 1.12, c: 0.08 },
    ]), M.joint));
    place(chest, P(chamferBox(1.0, 0.2, 0.5, 0.06), M.second, { pz: B.ventDark, all: B.mechA }), 0, 0.24, 0.66, 0.3);
    for (const sd of [-1, 1]) {
      // Sweeping side plates
      place(chest, P(blade([[1.0, 0.6], [0.6, 1.0], [-0.6, 1.06], [-1.0, 0.7], [-0.7, 0.2], [0.6, 0.18]], 0.08, [0.6, 1], [1, 0.7]), M.second, { all: B.plainA }), sd * 0.82, 0, 0, 0, 0, -sd * 0.12);
      place(chest, new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.7), M.eye), sd * 0.87, 0.74, 0.1).userData.noOutline = true;
    }
    this.plate(chest, 'noStep', 0.3, 0, 1.33, -0.2, -Math.PI / 2);
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 0.62, 1.04);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    // Sensor cluster: a rounded block with four eyes, two big and two small
    place(head, P(loftZ([
      { z: -0.24, w: 0.64, h: 0.5, y: 0.04, c: 0.16 },
      { z: 0.16, w: 0.62, h: 0.46, y: 0.04, c: 0.16 },
      { z: 0.3, w: 0.46, h: 0.34, y: 0.04, c: 0.1 },
    ]), M.second, { all: B.mechA }));
    place(head, P(blade([[0.32, 0.2], [0.1, 0.32], [-0.3, 0.34], [-0.26, 0.2], [0.1, 0.18]], 0.6, [1, 0.6]), M.armor, { all: B.plainA }));
    const eyes = [[0.13, 0.06, 0.1], [-0.13, 0.06, 0.1], [0.26, 0.16, 0.05], [-0.26, 0.16, 0.05]];
    for (const [x, y, r] of eyes) {
      place(head, new THREE.Mesh(cylZ(r, r, 0.05, 14), M.lens), x, y, 0.3 - (r < 0.08 ? 0.06 : 0));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff3a30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.75 }));
      glow.scale.setScalar(r * 4.2);
      glow.renderOrder = 6;
      place(head, glow, x, y, 0.35 - (r < 0.08 ? 0.06 : 0));
      place(head, new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 8, 6), M.sensor), x, y, 0.33 - (r < 0.08 ? 0.06 : 0)).userData.noOutline = true;
    }
    // Mandible plates and swept antennae
    for (const sd of [-1, 1]) {
      place(head, P(blade([[0.36, -0.1], [0.1, 0.0], [-0.2, 0.0], [-0.2, -0.2], [0.2, -0.26]], 0.05, [1, 0.5]), M.armor, { all: B.plainA }), sd * 0.2, -0.12, 0.0, 0, -sd * 0.15, 0);
      place(head, P(new THREE.CylinderGeometry(0.01, 0.025, 1.2, 6), M.trim), sd * 0.2, 0.62, -0.5, -1.0, 0, -sd * 0.2);
    }
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.0, 0.62, 0.3);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.24, 14, 10), M.joint));
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.16, 0.08, 0);
    sh.add(pauldron);
    place(pauldron, P(blade([[0.4, 0.14], [0.5, -0.14], [0.1, -0.4], [-0.4, -0.3], [-0.44, 0.1], [0.0, 0.24]], 0.12, [0.6, 1], [0.7, 1]), M.armor, { all: B.plainA }), s * 0.12, 0, 0);
    place(pauldron, P(chamferBox(0.04, 0.04, 0.7, 0.01), M.trim), s * 0.2, 0.18, 0);
    place(sh, P(new THREE.CylinderGeometry(0.12, 0.12, 0.84, 10), M.joint), 0, -0.48, 0);
    place(sh, P(loft([{ y: -0.26, w: 0.32, d: 0.38, c: 0.08 }, { y: -0.8, w: 0.34, d: 0.4, c: 0.09 }]), M.second, { all: B.plainB }), s * 0.02, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -0.94;
    sh.add(elbow);
    place(elbow, P(cylX(0.16, 0.4), M.joint));
    // Forearm with a blade fin raking back past the elbow
    place(elbow, P(loft([
      { y: -0.04, w: 0.38, d: 0.46, c: 0.1 },
      { y: -0.5, w: 0.46, d: 0.56, c: 0.12, z: 0.02 },
      { y: -1.0, w: 0.4, d: 0.5, c: 0.1, z: 0.02 },
      { y: -1.12, w: 0.32, d: 0.4, c: 0.08 },
    ]), M.armor, { all: B.plainA }));
    place(elbow, P(blade([[0.3, -0.1], [0.32, -0.8], [0.1, -1.0], [-0.3, -0.84], [-0.62, 0.3], [-0.3, 0.26]], 0.08, [0.5, 1]), M.second, { all: B.plainA }), s * 0.25, 0, 0);
    this.pistons.push(new Piston(sh, new V3(0, -0.4, 0.2), elbow, new V3(0, -0.26, 0.26), 0.045, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.36, -0.5, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.72);
    elbow.add(shieldMount);

    const hand = new THREE.Group();
    hand.position.set(0, -1.18, 0.02);
    elbow.add(hand);
    place(hand, P(chamferBox(0.3, 0.32, 0.38, 0.06), M.joint), 0, -0.13, 0);
    place(hand, P(chamferBox(0.3, 0.16, 0.38, 0.04), M.second), 0, -0.32, 0.06, 0.35);
    place(hand, P(chamferBox(0.09, 0.22, 0.11, 0.02), M.joint), -s * 0.15, -0.2, 0.15, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.22, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 0.84, -0.9);
    this.chest.add(bp);
    place(bp, P(loft([
      { y: 0.36, w: 0.9, d: 0.44, c: 0.12, z: -0.1 },
      { y: -0.3, w: 1.0, d: 0.54, c: 0.14, z: -0.16 },
    ]), M.second, { all: B.plainA, x: B.vent }));
    this.plate(bp, 'hotPanel', 0.28, 0, 0.02, -0.44, 0, Math.PI);
    for (const s of [-1, 1]) {
      // Jump-jet nacelle angled out and back, with its nozzle pointing down
      const nac = new THREE.Group();
      nac.position.set(s * 0.68, 0.0, -0.34);
      nac.rotation.set(-0.2, 0, -s * 0.2);
      bp.add(nac);
      place(nac, P(new THREE.CylinderGeometry(0.3, 0.34, 1.3, 14), M.armor, { all: B.plainA }), 0, 0, 0);
      place(nac, P(new THREE.ConeGeometry(0.3, 0.62, 14), M.armor, { all: B.plainA }), 0, 0.96, 0);
      place(nac, P(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 14), M.trim), 0, 0.2, 0);
      place(nac, P(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 14), M.joint), 0, -0.6, 0);
      place(nac, P(blade([[0.2, 0.3], [-0.4, 0.1], [-0.5, -0.5], [0.2, -0.36]], 0.05, [0.4, 1]), M.second, { all: B.plainA }), s * 0.3, 0, -0.1, 0, 0, -s * 0.3);
      this.thrusters.main.push(new Thruster(nac, new V3(0, -0.66, 0), new V3(0, -1, 0), 0.38, this.glowTex, {
        actuators: [new V3(0.24, -0.5, 0.14), new V3(-0.24, -0.5, 0.14), new V3(0, -0.5, -0.28)],
      }));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.36, 0.3, -0.42), new V3(s * 0.25, 0.1, -1), 0.12, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 18, 1.8);
    this.thrustLight.position.set(0, -1.4, -0.6);
    bp.add(this.thrustLight);
  }
}
