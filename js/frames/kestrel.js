import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, cylZ, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, loftZ } from '../mech.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// LT-3 Kestrel: a light scout on stilts. A wedge-shaped cockpit pod rides on an
// exposed spine over a hip axle with drum actuators; slab-armored thighs hang
// from it over long, segmented shins with chevron lights, ending in wide skid
// feet. Long, thin arms, a sensor cap on the pod, and a small booster pack.
// ---------------------------------------------------------------------------

const RIG = {
  scale: 0.94,
  leg: { hipDrop: 0.1, thigh: 2.0, shin: 2.8, foot: 0.45 },
  gait: { bodyH: 4.72, dip: 0.15, homeX: 0.98, lift: 0.42, cadence: 0.92, sway: 0.1, twist: 0.08, settle: 0.4 },
  idleFeet: [[-0.98, -0.55], [1.04, 0.72]],
  stance: { splay: 0.1, yaw: 0.1 },
  pole: [0.32, 0.05, 1],
  fk: { air: [[-0.1, 0.72], [-0.95, 1.45]], dash: [[0.25, 0.95], [0.0, 0.85]], crouch: [-0.62, 1.22] },
  crouchDrop: 1.05,
  hunch: 0.1, hunchIdle: 0.08, armOut: 0.13,
};

export class Kestrel extends Mech {
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
    // Small dark hip block on a long axle, ribbed underneath
    place(p, P(loft([
      { y: 0.3, w: 0.62, d: 0.62, c: 0.14 },
      { y: 0.0, w: 0.78, d: 0.74, c: 0.16 },
      { y: -0.26, w: 0.42, d: 0.5, c: 0.12 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.16, 1.3), M.joint), 0, -0.08, 0);
    for (const y of [-0.12, -0.22]) place(p, P(chamferBox(0.46, 0.04, 0.5, 0.02), M.joint), 0, y, 0);
    // Codpiece with a light, and a plate over the axle at the back
    place(p, P(frontPrism([[-0.22, 0.14], [0.22, 0.14], [0.14, -0.16], [0, -0.3], [-0.14, -0.16]], 0.12, 0.03), M.armor, { all: B.plainA }), 0, 0.02, 0.38);
    place(p, new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.02), M.eye), 0, 0.06, 0.45).userData.noOutline = true;
    place(p, P(frontPrism([[-0.3, 0.18], [0.3, 0.18], [0.2, -0.2], [-0.2, -0.2]], 0.1, 0.03), M.armor, { all: B.plainA }), 0, 0.02, -0.38);
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 0.7, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    // Drum actuator on the end of the axle
    place(hip, P(cylX(0.32, 0.36, 16), M.joint));
    place(hip, P(cylX(0.22, 0.06, 14), M.trim), s * 0.2, 0, 0);
    place(hip, P(cylX(0.34, 0.06, 16), M.second), s * -0.16, 0, 0);
    // Thigh: a thin strut behind a big slab of armor, like cargo plates
    place(hip, P(new THREE.CylinderGeometry(0.12, 0.13, TH - 0.2, 10), M.joint), 0, -TH / 2, -0.06);
    place(hip, P(loft([
      { y: 0.02, w: 0.42, d: 0.86, c: 0.12, z: 0.04 },
      { y: -0.55, w: 0.5, d: 1.08, c: 0.15, z: 0.1 },
      { y: -1.45, w: 0.44, d: 0.9, c: 0.13, z: 0.08 },
      { y: -1.78, w: 0.32, d: 0.58, c: 0.1, z: 0.04 },
    ]), M.armor, { all: B.plainA, x: B.plainA }), s * 0.12, -0.1, 0);
    // Front plate with a light slot, and a cross-braced panel on the outside
    place(hip, P(frontPrism([[-0.2, 0.0], [0.2, 0.0], [0.22, -0.95], [0.0, -1.12], [-0.22, -0.95]], 0.08, 0.025), M.white, { all: B.plainA }), s * 0.12, -0.3, 0.64);
    place(hip, new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.02), M.eye), s * 0.12, -0.42, 0.69).userData.noOutline = true;
    const xb = place(hip, P(chamferBox(0.04, 0.62, 0.62, 0.02), M.second), s * 0.385, -0.75, 0.12);
    for (const r of [0.78, -0.78]) place(xb, P(chamferBox(0.03, 0.72, 0.06, 0.01), M.joint), s * 0.02, 0, 0, r, 0, 0);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    // Disc actuator on the outside of the knee, and a cap in front
    place(knee, P(cylX(0.2, 0.42), M.joint));
    place(knee, P(cylX(0.26, 0.12, 16), M.second), s * 0.22, 0, 0);
    place(knee, P(cylX(0.13, 0.04, 12), M.trim), s * 0.29, 0, 0);
    place(knee, P(blade([[0.06, -0.3], [0.3, -0.12], [0.34, 0.22], [0.14, 0.36], [0.02, 0.1]], 0.36, [1, 1], [1, 0.6]), M.armor, { all: B.plainA }), 0, 0, 0.06);

    // Shin: a slender core with a stack of overlapping plates down its front
    place(knee, P(loft([
      { y: -0.05, w: 0.44, d: 0.54, c: 0.11, z: -0.02 },
      { y: -1.2, w: 0.36, d: 0.46, c: 0.09, z: -0.03 },
      { y: -SH + 0.2, w: 0.3, d: 0.38, c: 0.08, z: 0 },
    ]), M.armor, { all: B.plainA, x: B.sideVents }));
    for (let i = 0; i < 4; i++) {
      const y = -0.42 - i * 0.56, w = 0.4 - i * 0.03;
      const seg = place(knee, P(frontPrism([[-w / 2, 0.24], [w / 2, 0.24], [w / 2 + 0.02, -0.2], [0, -0.3], [-w / 2 - 0.02, -0.2]], 0.12, 0.03),
        i % 2 ? M.white : M.armor, { all: B.plainA }), 0, y, 0.2 + i * 0.01, 0.1);
      if (i === 0 || i === 2) place(seg, P(frontPrism([[-0.07, 0.0], [0.07, 0.0], [0.0, -0.06]], 0.02, 0.004), M.eye), 0, 0.08, 0.07).userData.noOutline = true;
    }
    // Twin struts down the back and a calf vernier bay
    for (const x of [-0.1, 0.1]) place(knee, P(new THREE.CylinderGeometry(0.045, 0.045, SH - 0.5, 8), M.joint), x, -SH / 2, -0.24);
    const bayY = -0.85;
    place(knee, P(chamferBox(0.3, 0.32, 0.1, 0.04), M.frame, { all: B.ventDark }), 0, bayY, -0.27);
    const calf = new Thruster(knee, new V3(0, bayY + 0.02, -0.3), new V3(0, -0.85, -0.6), 0.1, this.glowTex);
    this.thrusters.calf.push(calf);
    const pivot = new THREE.Group();
    pivot.position.set(0, bayY + 0.18, -0.34);
    knee.add(pivot);
    place(pivot, P(chamferBox(0.32, 0.34, 0.05, 0.03), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.17, 0);
    calf.flaps.push({ pivot, open: 1.2 });

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    // Achilles ram from the back of the shin to the heel
    this.pistons.push(new Piston(knee, new V3(0, -SH + 0.75, -0.2), ankle, new V3(0, -0.2, -0.42), 0.045, M));
    place(ankle, P(cylX(0.17, 0.34), M.joint));
    for (const x of [-0.19, 0.19]) place(ankle, P(cylX(0.1, 0.04, 10), M.trim), x, 0, 0);
    place(ankle, P(loft([{ y: 0.12, w: 0.3, d: 0.36, c: 0.08 }, { y: -0.2, w: 0.42, d: 0.5, c: 0.1 }]), M.second, { all: B.plainB }));
    // Skid foot: a toe pad and a heel pad on a flat sole, with a tube outrigger out front
    place(ankle, P(chamferBox(0.56, 0.1, 1.36, 0.04), M.joint), 0, -0.4, 0.12);
    place(ankle, P(loft([
      { y: -0.14, w: 0.5, d: 0.5, c: 0.1, z: 0.42 },
      { y: -0.36, w: 0.64, d: 0.66, c: 0.12, z: 0.46 },
    ]), M.armor, { all: B.plainA, y: B.plainB }));
    place(ankle, P(loft([
      { y: -0.12, w: 0.36, d: 0.34, c: 0.08, z: -0.36 },
      { y: -0.36, w: 0.5, d: 0.44, c: 0.1, z: -0.4 },
    ]), M.armor, { all: B.plainA, y: B.plainB }));
    for (const x of [-0.2, 0.2]) place(ankle, P(cylZ(0.045, 0.045, 0.5, 8), M.trim), x, -0.32, 0.92);
    place(ankle, P(cylX(0.045, 0.44, 8), M.trim), 0, -0.32, 1.16);
    for (const x of [-0.2, 0.2]) place(ankle, P(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), M.joint), x, -0.37, 1.16);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.3, -0.06), new V3(0, -1, -0.12), 0.13, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.28;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Exposed spine: ribbed rings between gold struts
    place(waist, P(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 10), M.joint), 0, 0.18, -0.05);
    for (const y of [0.02, 0.18, 0.34]) place(waist, P(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12), M.second), 0, y, -0.05);
    for (const sd of [-1, 1]) place(waist, P(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), M.trim), sd * 0.24, 0.2, 0.16, 0, 0, sd * 0.1);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.46;
    waist.add(chest);
    // Cockpit pod: a wedge, deep and wide, sloping down to a blunt nose
    place(chest, P(loft([
      { y: 0.0, w: 1.28, d: 1.44, c: 0.24, z: 0.0 },
      { y: 0.42, w: 1.68, d: 2.0, c: 0.32, z: 0.08 },
      { y: 1.0, w: 1.64, d: 1.92, c: 0.32, z: -0.06 },
      { y: 1.3, w: 1.2, d: 1.32, c: 0.26, z: -0.2 },
    ]), M.armor, { all: B.plainA, x: B.plainA }));
    // Nose: sloped glacis over a dark chin, a vent in the chin
    const nose = place(chest, P(frontPrism([[-0.7, 0.36], [0.7, 0.36], [0.6, -0.34], [-0.6, -0.34]], 0.14, 0.04), M.white, { all: B.plainA }), 0, 0.72, 1.04, -0.62);
    place(nose, P(chamferBox(0.9, 0.08, 0.04, 0.02), M.trim), 0, 0.22, 0.08);
    place(chest, P(chamferBox(0.86, 0.34, 0.2, 0.06), M.second, { pz: B.ventDark, all: B.mechA }), 0, 0.24, 0.9, 0.25);
    // Slab side armor, each side with a round sensor housing and a light
    for (const sd of [-1, 1]) {
      const side = place(chest, P(chamferBox(0.08, 0.66, 1.3, 0.05), M.armor, { all: B.plainA }), sd * 0.86, 0.66, 0.04);
      place(side, new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.32), M.eye), sd * 0.05, 0.2, 0.3).userData.noOutline = true;
      place(chest, P(cylX(0.27, 0.12, 18), M.second), sd * 0.92, 0.5, 0.56);
      place(chest, P(cylX(0.18, 0.06, 16), M.joint), sd * 0.99, 0.5, 0.56);
      place(chest, new THREE.Mesh(cylX(0.06, 0.02, 10), M.eye), sd * 1.025, 0.5, 0.56).userData.noOutline = true;
      // Raised fins along the roof
      place(chest, P(blade([[0.5, 0.0], [0.2, 0.12], [-0.6, 0.18], [-0.7, 0.0]], 0.07, [0.6, 1]), M.armor, { all: B.plainA }), sd * 0.42, 1.26, -0.06);
    }
    this.plate(chest, 'a01', 0.36, 0, 0.6, -0.92, 0, Math.PI);

    // Side hardpoints, outboard of the pod at cockpit height: a gun beside the head, like a scout's
    for (const [key, sd] of [['shoulderR', -1], ['shoulderL', 1]]) {
      place(chest, P(chamferBox(0.3, 0.16, 0.5, 0.04), M.joint), sd * 1.04, 0.98, -0.05);
      this.mount(key, chest, sd * 1.18, 1.06, -0.15);
    }
  }

  buildHead() {
    const M = this.mats;
    // Sensor cap riding on the pod's roof: a low wedge with a light slit across each front corner
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.28, 0.18);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.24, 0.3, 0.16, 12), M.joint), 0, 0.02, 0);
    place(head, P(loftZ([
      { z: -0.42, w: 0.86, h: 0.3, y: 0.24, c: 0.08 },
      { z: 0.12, w: 0.9, h: 0.34, y: 0.26, c: 0.1 },
      { z: 0.5, w: 0.66, h: 0.2, y: 0.2, c: 0.06 },
    ]), M.armor, { all: B.plainA }));
    place(head, P(frontPrism([[-0.36, 0.1], [0.36, 0.1], [0.3, -0.08], [-0.3, -0.08]], 0.08, 0.02), M.joint), 0, 0.2, 0.5, -0.2);
    for (const sd of [-1, 1]) {
      const slit = place(head, new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.012), M.eye), sd * 0.22, 0.22, 0.555, -0.2, -sd * 0.25, 0);
      slit.userData.noOutline = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x5fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.6 }));
      glow.scale.setScalar(0.28);
      glow.renderOrder = 6;
      place(head, glow, sd * 0.22, 0.22, 0.58);
    }
    // Antenna raked back off the cap, with a small dish behind it
    const ant = place(head, P(new THREE.CylinderGeometry(0.012, 0.03, 1.4, 6), M.trim), 0.3, 0.9, -0.42, -0.55, 0, -0.12);
    place(ant, P(chamferBox(0.06, 0.18, 0.04, 0.01), M.joint), 0, -0.4, 0);
    place(head, P(cylZ(0.14, 0.05, 0.08, 12), M.second), -0.3, 0.46, -0.3, -0.6, 0, 0);
    place(head, P(chamferBox(0.22, 0.05, 0.44, 0.02), M.trim), 0, 0.42, -0.04);
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.08, 0.4, 0.04);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    // Shoulder: a drum actuator on the side of the pod
    place(sh, P(cylX(0.24, 0.34, 16), M.joint));
    place(sh, P(cylX(0.16, 0.05, 14), M.trim), s * 0.18, 0, 0);
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.1, 0.06, 0);
    sh.add(pauldron);
    place(pauldron, P(blade([[0.32, 0.12], [0.36, -0.12], [0.0, -0.34], [-0.36, -0.2], [-0.3, 0.16]], 0.1, [0.7, 1]), M.armor, { all: B.plainA }), s * 0.22, 0, 0);
    // Upper arm: thin strut and shell with a light down the front
    place(sh, P(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 10), M.joint), 0, -0.55, 0);
    place(sh, P(loft([{ y: -0.22, w: 0.32, d: 0.36, c: 0.08 }, { y: -0.92, w: 0.28, d: 0.34, c: 0.07 }]), M.armor, { all: B.plainA }), s * 0.02, 0, 0);
    place(sh, new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.28, 0.02), M.eye), s * 0.02, -0.45, 0.19).userData.noOutline = true;

    const elbow = new THREE.Group();
    elbow.position.y = -1.08;
    sh.add(elbow);
    place(elbow, P(cylX(0.15, 0.36), M.joint));
    place(elbow, P(cylX(0.18, 0.08, 14), M.second), s * 0.19, 0, 0);
    // Forearm: an armored box with a dark recessed panel and a crossed plate
    place(elbow, P(loft([
      { y: -0.04, w: 0.36, d: 0.44, c: 0.09 },
      { y: -0.55, w: 0.46, d: 0.56, c: 0.11, z: 0.02 },
      { y: -1.08, w: 0.4, d: 0.5, c: 0.1, z: 0.02 },
      { y: -1.2, w: 0.3, d: 0.38, c: 0.08 },
    ]), M.armor, { all: B.plainA }));
    place(elbow, P(chamferBox(0.04, 0.5, 0.3, 0.03), M.joint), s * 0.235, -0.56, 0.02);
    const xp = place(elbow, P(chamferBox(0.03, 0.28, 0.24, 0.02), M.white, { all: B.plainA }), s * 0.23, -0.95, -0.06);
    for (const r of [0.75, -0.75]) place(xp, P(chamferBox(0.02, 0.26, 0.03, 0.005), M.joint), s * 0.02, 0, 0, r, 0, 0);
    this.pistons.push(new Piston(sh, new V3(0, -0.5, 0.2), elbow, new V3(0, -0.28, 0.26), 0.04, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.34, -0.55, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.7);
    elbow.add(shieldMount);

    // Small hand: palm block and claw fingers
    const hand = new THREE.Group();
    hand.position.set(0, -1.28, 0.02);
    elbow.add(hand);
    place(hand, P(chamferBox(0.28, 0.3, 0.34, 0.06), M.joint), 0, -0.12, 0);
    for (const x of [-0.08, 0.08]) place(hand, P(chamferBox(0.08, 0.26, 0.1, 0.02), M.second), x, -0.32, 0.1, 0.4);
    place(hand, P(chamferBox(0.08, 0.2, 0.1, 0.02), M.second), -s * 0.15, -0.2, 0.12, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.2, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 0.6, -0.92);
    this.chest.add(bp);
    // Compact booster pack tucked under the back of the pod
    place(bp, P(loft([
      { y: 0.36, w: 0.9, d: 0.4, c: 0.1, z: -0.12 },
      { y: -0.1, w: 1.0, d: 0.52, c: 0.14, z: -0.18 },
      { y: -0.5, w: 0.8, d: 0.42, c: 0.12, z: -0.14 },
    ]), M.second, { all: B.plainA, x: B.vent }));
    this.plate(bp, 'hotPanel', 0.26, 0, -0.08, -0.45, 0, Math.PI);
    for (const s of [-1, 1]) {
      const hx = s * 0.3;
      const dir = new V3(s * 0.08, -1, -0.5).normalize();
      const mountPos = new V3(hx, -0.56, -0.3);
      const ring = place(bp, P(new THREE.CylinderGeometry(0.24, 0.27, 0.1, 14), M.joint), mountPos.x, mountPos.y, mountPos.z);
      ring.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.3, this.glowTex, {
        actuators: [new V3(hx + 0.2, -0.45, -0.2), new V3(hx - 0.2, -0.45, -0.2)],
      }));
      // Stabilizer vane and a vernier on each top corner
      const vane = new THREE.Group();
      vane.position.set(s * 0.42, 0.26, -0.3);
      vane.rotation.set(0.3, s * 0.3, -s * 0.5);
      bp.add(vane);
      place(vane, P(blade([[0.1, 0.0], [-0.3, 0.16], [-0.9, 0.5], [-0.84, 0.3], [-0.3, -0.12]], 0.06, [0.4, 1]), M.armor, { all: B.plainA }));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.46, 0.14, -0.42), new V3(s * 0.3, 0.05, -1), 0.12, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 18, 1.8);
    this.thrustLight.position.set(0, -1.4, -0.6);
    bp.add(this.thrustLight);
  }
}
