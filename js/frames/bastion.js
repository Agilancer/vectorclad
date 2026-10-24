import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, cylZ, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade } from '../mech.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// TK-40 Bastion: a walking fortress. Column legs braced by hydraulic rams on
// outrigger feet; a tall box of a body faced with glacis bands; slab shields
// hanging off the shoulders; a squat turret head with a bar of eyes; and a
// weapons deck across its back for the biggest guns in the bay.
// ---------------------------------------------------------------------------

const RIG = {
  scale: 1.34,
  leg: { hipDrop: 0.26, thigh: 1.7, shin: 2.0, foot: 0.7 },
  gait: { bodyH: 3.92, dip: 0.2, homeX: 1.42, lift: 0.3, cadence: 1.2, sway: 0.15, twist: 0.06, settle: 0.5, settleTime: 0.55 },
  idleFeet: [[-1.44, -0.32], [1.5, 0.46]],
  stance: { splay: 0.12, yaw: 0.08 },
  pole: [0.45, 0.05, 1],
  fk: { air: [[-0.1, 0.6], [-0.6, 1.1]], dash: [[0.15, 0.75], [-0.05, 0.7]], crouch: [-0.5, 1.0] },
  crouchDrop: 0.7,
  hunch: 0.1, hunchIdle: 0.04, armOut: 0.3,
};

export class Bastion extends Mech {
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
      { y: 0.36, w: 1.7, d: 1.3, c: 0.2 },
      { y: 0.02, w: 1.9, d: 1.4, c: 0.22 },
      { y: -0.4, w: 1.0, d: 0.94, c: 0.16 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.32, 2.2), M.joint), 0, -0.18, 0);
    // Skirt: a front slab, a rear slab and side slabs that swing with the thighs
    place(p, P(frontPrism([[-0.62, 0.26], [0.62, 0.26], [0.56, -0.5], [-0.56, -0.5]], 0.18, 0.04), M.armor, { all: B.plainA }), 0, 0.0, 0.74, -0.1);
    place(p, P(chamferBox(0.9, 0.08, 0.06, 0.02), M.trim), 0, 0.12, 0.84);
    place(p, P(frontPrism([[-0.8, 0.26], [0.8, 0.26], [0.7, -0.5], [-0.7, -0.5]], 0.16, 0.04), M.armor, { all: B.plainA }), 0, 0.0, -0.74, 0.1);
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 1.04, 0.2, 0.0);
      g.rotation.z = s * 0.08;
      p.add(g);
      place(g, P(chamferBox(0.16, 1.0, 1.2, 0.06), M.armor, { all: B.plainA }), s * 0.16, -0.3, 0);
      place(g, P(chamferBox(0.04, 0.8, 0.12, 0.01), M.white), s * 0.25, -0.3, 0.4);
      return g;
    });
    for (const [key, s] of [['hipR', -1], ['hipL', 1]]) {
      place(p, P(chamferBox(0.56, 0.22, 0.56, 0.06), M.joint), s * 0.9, 0.38, -0.82);
      this.mount(key, p, s * 1.04, 0.5, -0.9, 0, 0, -s * Math.PI / 2);
    }
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 1.0, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(cylX(0.42, 0.7, 16), M.joint));
    place(hip, P(cylX(0.3, 0.08, 14), M.trim), s * 0.38, 0, 0);
    // Column thigh: a boxy block with a slab in front
    place(hip, P(loft([
      { y: -0.12, w: 0.9, d: 1.0, c: 0.14, z: 0.0 },
      { y: -TH + 0.3, w: 0.8, d: 0.9, c: 0.13, z: 0.04 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    place(hip, P(chamferBox(0.94, TH - 0.5, 0.14, 0.05), M.armor, { all: B.plainA }), 0, -TH / 2 - 0.05, 0.56);
    place(hip, P(chamferBox(0.1, 0.5, 0.06, 0.02), M.white), s * 0.3, -0.5, 0.64);
    this.plate(hip, 'caution', 0.66, s * 0.47, -0.8, 0, 0, s * Math.PI / 2);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, P(cylX(0.36, 0.96), M.joint));
    // Box knee guard
    place(knee, P(loft([
      { y: 0.36, w: 0.82, d: 0.3, c: 0.08, z: 0.48 },
      { y: -0.3, w: 0.9, d: 0.36, c: 0.1, z: 0.56 },
    ]), M.armor, { all: B.plainA }));
    place(knee, P(chamferBox(0.6, 0.12, 0.1, 0.03), M.white), 0, 0.05, 0.76);
    // Paired rams down the front of the leg, thigh to shin
    for (const x of [-0.3, 0.3]) this.pistons.push(new Piston(hip, new V3(x, -0.3, 0.68), knee, new V3(x, -0.8, 0.64), 0.09, M));

    // Shin: a tall block with a layered slab front and a vented calf
    place(knee, P(loft([
      { y: -0.1, w: 0.96, d: 1.1, c: 0.15, z: -0.06 },
      { y: -1.0, w: 1.0, d: 1.16, c: 0.16, z: -0.1 },
      { y: -SH + 0.2, w: 0.84, d: 0.94, c: 0.13, z: -0.02 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    for (let i = 0; i < 2; i++) {
      place(knee, P(chamferBox(1.0 - i * 0.08, 0.86, 0.14, 0.05), M.armor, { all: B.plainA }), 0, -0.6 - i * 0.82, 0.58 - i * 0.02, 0.06);
    }
    const bayY = -0.95;
    place(knee, P(chamferBox(0.6, 0.46, 0.1, 0.05), M.frame, { all: B.ventDark }), 0, bayY, -0.68);
    const calfThr = [];
    for (const x of [-0.16, 0.16]) {
      const t = new Thruster(knee, new V3(x, bayY + 0.04, -0.72), new V3(0, -0.85, -0.6), 0.15, this.glowTex);
      calfThr.push(t);
      this.thrusters.calf.push(t);
    }
    {
      const pivot = new THREE.Group();
      pivot.position.set(0, bayY + 0.25, -0.78);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.64, 0.48, 0.06, 0.04), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.24, 0);
      for (const t of calfThr) t.flaps.push({ pivot, open: 1.2 });
    }
    this.mount(s > 0 ? 'legL' : 'legR', knee, s * 0.56, -1.0, -0.06, 0, 0, -s * Math.PI / 2);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(cylX(0.32, 0.86), M.joint));
    place(ankle, P(loft([{ y: 0.24, w: 0.76, d: 0.84, c: 0.12 }, { y: -0.26, w: 0.9, d: 1.0, c: 0.14 }]), M.second, { all: B.plainB }));
    // Outrigger foot: a broad pad with stabilizer claws out to the front, the sides and the back
    place(ankle, P(loft([
      { y: -0.2, w: 1.1, d: 1.3, c: 0.18, z: 0.15 },
      { y: -0.68, w: 1.3, d: 1.6, c: 0.22, z: 0.2 },
    ]), M.armor, { all: B.plainA, y: B.plainB }));
    for (const [x, z, ry, len] of [[-0.36, 1.02, 0.12, 0.62], [0.36, 1.02, -0.12, 0.62], [-0.72, 0.3, 1.2, 0.42], [0.72, 0.3, -1.2, 0.42], [0, -0.66, Math.PI, 0.5]]) {
      const claw = new THREE.Group();
      claw.position.set(x, -0.5, z);
      claw.rotation.y = ry;
      ankle.add(claw);
      place(claw, P(blade([[0.0, 0.14], [len, -0.1], [len, -0.2], [0.0, -0.2]], 0.3, [1, 0.5]), M.second, { all: B.plainB }));
      place(claw, P(chamferBox(0.32, 0.06, 0.12, 0.02), M.white), 0, 0.12, len * 0.4);
    }
    place(ankle, P(chamferBox(1.3, 0.05, 1.9, 0.02), M.joint), 0, -0.68, 0.18);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.5, 0.0), new V3(0, -1, -0.1), 0.22, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.36;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Turret ring
    place(waist, P(new THREE.CylinderGeometry(0.74, 0.8, 0.5, 18), M.joint), 0, 0.2, 0);
    place(waist, P(new THREE.CylinderGeometry(0.84, 0.84, 0.1, 18), M.trim), 0, 0.42, 0);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.48;
    waist.add(chest);
    // The box: tall, barely tapering, with chamfered corners
    place(chest, P(loft([
      { y: 0.0, w: 2.1, d: 1.7, c: 0.24, z: -0.05 },
      { y: 1.1, w: 2.5, d: 1.9, c: 0.28, z: -0.05 },
      { y: 2.0, w: 2.5, d: 1.84, c: 0.28, z: -0.1 },
      { y: 2.22, w: 2.1, d: 1.5, c: 0.24, z: -0.14 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    // Glacis: three bands of slab armor stepping down the front
    for (let i = 0; i < 3; i++) {
      const w = 2.36 - i * 0.18;
      place(chest, P(frontPrism([[-w / 2, 0.32], [w / 2, 0.32], [w / 2 - 0.08, -0.32], [-w / 2 + 0.08, -0.32]], 0.2, 0.04), M.armor, { all: B.plainA }),
        0, 1.78 - i * 0.62, 0.92 - i * 0.04, -0.12);
    }
    place(chest, P(chamferBox(1.2, 0.08, 0.06, 0.02), M.white), 0, 1.98, 1.06, -0.12);
    this.plate(chest, 'danger', 0.54, 0.62, 0.62, 0.98, -0.1);
    this.plate(chest, 'stripes', 0.16, -0.78, 0.62, 0.98, -0.1);
    // Smoke dischargers on the upper corners
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 3; k++) place(chest, P(cylZ(0.08, 0.08, 0.34, 10), M.joint), sd * (0.86 + k * 0.14), 2.18, 0.72, -0.5, 0, 0);
      place(chest, P(chamferBox(0.5, 0.14, 0.4, 0.04), M.armor, { all: B.plainA }), sd * 1.0, 2.1, 0.62);
    }
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 2.22, 0.36);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    // Squat turret: a wide flat dome with a bar of eyes, a cupola and antennas
    place(head, P(loft([
      { y: 0.0, w: 1.0, d: 1.0, c: 0.3 },
      { y: 0.3, w: 1.1, d: 1.1, c: 0.34 },
      { y: 0.5, w: 0.8, d: 0.8, c: 0.26 },
    ]), M.armor, { all: B.plainA }));
    place(head, P(chamferBox(0.86, 0.14, 0.2, 0.05), M.joint), 0, 0.22, 0.48);
    for (let i = -2; i <= 2; i++) {
      place(head, new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.02), M.eye), i * 0.15, 0.22, 0.585).userData.noOutline = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x7fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.45 }));
      glow.scale.setScalar(0.18);
      glow.renderOrder = 6;
      place(head, glow, i * 0.15, 0.22, 0.6);
    }
    place(head, P(new THREE.CylinderGeometry(0.2, 0.24, 0.22, 12), M.second), -0.18, 0.6, -0.1);
    place(head, P(cylZ(0.05, 0.05, 0.3, 8), M.joint), -0.18, 0.62, 0.12);
    for (const [x, h] of [[0.32, 1.3], [0.44, 0.8]]) place(head, P(new THREE.CylinderGeometry(0.012, 0.025, h, 6), M.trim), x, 0.5 + h / 2, -0.3, -0.25, 0, -0.08);
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.56, 1.7, -0.06);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(cylX(0.42, 0.6, 16), M.joint));
    // Slab shield hanging off the shoulder over the upper arm
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.46, 0.2, 0);
    sh.add(pauldron);
    place(pauldron, P(chamferBox(0.9, 0.24, 1.36, 0.06), M.armor, { all: B.plainA }), s * 0.06, 0.18, 0);
    const slab = place(pauldron, P(chamferBox(0.18, 1.7, 1.4, 0.08), M.armor, { all: B.plainA, x: B.plainA }), s * 0.46, -0.52, 0.02, 0, 0, -s * 0.06);
    this.plate(slab, 'hazardPad', 0.5, s * 0.1, 0.12, 0.1, 0, s * Math.PI / 2);
    place(slab, P(chamferBox(0.04, 1.4, 0.1, 0.01), M.white), s * 0.1, -0.05, -0.56);

    place(sh, P(new THREE.CylinderGeometry(0.24, 0.24, 1.0, 12), M.joint), 0, -0.58, 0);
    place(sh, P(loft([{ y: -0.36, w: 0.66, d: 0.72, c: 0.12 }, { y: -1.02, w: 0.62, d: 0.68, c: 0.12 }]), M.second, { all: B.plainB }), s * 0.02, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.18;
    sh.add(elbow);
    place(elbow, P(cylX(0.28, 0.66), M.joint));
    for (const x of [-0.35, 0.35]) place(elbow, P(cylX(0.18, 0.06, 12), M.trim), x, 0, 0);
    // Boxy forearm with a vent and a white band
    place(elbow, P(loft([
      { y: -0.04, w: 0.72, d: 0.8, c: 0.14 },
      { y: -0.7, w: 0.84, d: 0.94, c: 0.16, z: 0.02 },
      { y: -1.22, w: 0.76, d: 0.86, c: 0.15, z: 0.02 },
      { y: -1.36, w: 0.6, d: 0.7, c: 0.12 },
    ]), M.armor, { all: B.plainA }));
    place(elbow, P(chamferBox(0.86, 0.08, 0.96, 0.03), M.white), 0, -1.05, 0.02);
    place(elbow, P(chamferBox(0.05, 0.4, 0.5, 0.03), M.joint, { all: B.ventDark }), s * 0.43, -0.6, 0.02);
    this.pistons.push(new Piston(sh, new V3(0, -0.5, 0.38), elbow, new V3(0, -0.36, 0.46), 0.08, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.52, -0.7, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.9);
    elbow.add(shieldMount);

    const hand = new THREE.Group();
    hand.position.set(0, -1.44, 0.04);
    elbow.add(hand);
    place(hand, P(chamferBox(0.5, 0.46, 0.58, 0.09), M.joint), 0, -0.18, 0);
    place(hand, P(chamferBox(0.5, 0.22, 0.56, 0.06), M.armor, { all: B.plainA }), 0, -0.44, 0.08, 0.35);
    place(hand, P(chamferBox(0.15, 0.32, 0.17, 0.04), M.joint), -s * 0.25, -0.28, 0.22, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.32, 0.03);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 1.1, -1.02);
    this.chest.add(bp);
    place(bp, P(loft([
      { y: 0.9, w: 2.2, d: 0.6, c: 0.14, z: -0.2 },
      { y: -0.2, w: 2.3, d: 0.8, c: 0.16, z: -0.3 },
      { y: -0.9, w: 1.9, d: 0.66, c: 0.14, z: -0.26 },
    ]), M.armor, { all: B.plainA, x: B.vent }));
    place(bp, P(chamferBox(1.2, 1.0, 0.12, 0.08), M.second, { all: B.mechA }), 0, 0.05, -0.72);
    this.plate(bp, 'hotPanel', 0.46, 0, 0.05, -0.8, 0, Math.PI);
    // Weapons deck: a plinth across the top for the back mount, with the shoulder mounts at its ends
    place(bp, P(chamferBox(2.5, 0.2, 1.0, 0.06), M.joint), 0, 1.04, -0.1);
    place(bp, P(chamferBox(2.54, 0.06, 0.1, 0.02), M.trim), 0, 1.04, 0.42);
    place(bp, P(new THREE.CylinderGeometry(0.4, 0.46, 0.16, 16), M.second), 0, 1.2, -0.06);
    this.mount('backC', bp, 0, 1.28, -0.1, -0.06);
    this.mount('shoulderR', bp, -1.02, 1.16, 0.0, -0.08);
    this.mount('shoulderL', bp, 1.02, 1.16, 0.0, -0.08);
    for (const s of [-1, 1]) {
      // Four engines in a row: two big mains inboard and two verniers outboard
      const hx = s * 0.5;
      place(bp, P(loft([
        { y: -0.5, w: 0.76, d: 0.9, c: 0.16, z: -0.4 },
        { y: -1.1, w: 0.8, d: 0.94, c: 0.18, z: -0.46 },
        { y: -1.3, w: 0.66, d: 0.76, c: 0.16, z: -0.48 },
      ]), M.second, { x: B.hot, all: B.plainA }), hx, 0, 0);
      const dir = new V3(0, -1, -0.4).normalize();
      const mountPos = new V3(hx, -1.3, -0.66);
      const ring = place(bp, P(new THREE.CylinderGeometry(0.46, 0.5, 0.14, 16), M.joint), mountPos.x, mountPos.y, mountPos.z);
      ring.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.6, this.glowTex, {
        actuators: [new V3(hx + 0.38, -1.15, -0.54), new V3(hx - 0.38, -1.15, -0.54), new V3(hx, -1.18, -0.92)],
      }));
      place(bp, P(loft([{ y: -0.1, w: 0.4, d: 0.6, c: 0.1, z: -0.34 }, { y: -0.8, w: 0.44, d: 0.64, c: 0.11, z: -0.38 }]), M.second, { all: B.plainA, x: B.ventB }), s * 1.12, 0, 0);
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 1.12, -0.86, -0.5), new V3(s * 0.2, -0.6, -1), 0.24, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 26, 1.8);
    this.thrustLight.position.set(0, -2.2, -1.0);
    bp.add(this.thrustLight);
  }
}
