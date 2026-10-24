import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, cylZ, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, loftZ, mirror } from '../mech.js';
import { port, strip, slats } from './kit.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// RJ-6 Locust: a reverse-joint light. Its knees bend backward like a bird's,
// with a shock ram behind each one, down to pointed tip-toe feet. A hunched
// chevron torso hangs between two great ribbed shoulder drums; the head rides
// low and forward under swept V-fins with a single green eye. Long thin arms
// carry blades along their forearms, and a jump pack with raked vanes on its
// back throws it high.
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
  hunch: 0.22, hunchIdle: 0.08, armOut: 0.2,
};

const PA = { all: B.plainA }, PB = { all: B.plainB };

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
    // Chevron codpiece in two layers
    place(p, P(frontPrism([[-0.3, 0.16], [0.3, 0.16], [0.18, -0.16], [0, -0.4], [-0.18, -0.16]], 0.14, 0.03), M.armor, PA), 0, 0, 0.42);
    place(p, P(frontPrism([[-0.2, 0.08], [0, -0.16], [0.2, 0.08], [0.2, -0.02], [0, -0.26], [-0.2, -0.02]], 0.05, 0.01), M.accent, PA), 0, 0, 0.5);
    // Tail plate raking back over the hips
    place(p, P(blade([[0.0, 0.2], [-0.5, 0.16], [-1.0, -0.12], [-0.44, -0.22], [0.0, -0.12]], 0.4, [0.5, 1]), M.armor, PA), 0, 0.02, -0.36);
    place(p, P(blade([[-0.3, 0.17], [-0.9, -0.08], [-0.86, -0.12], [-0.3, 0.11]], 0.12, [0.5, 1]), M.accent, PA), 0, 0.03, -0.36);
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 0.72, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(cylX(0.34, 0.4, 16), M.joint));
    place(hip, P(cylX(0.24, 0.06, 14), M.accent, PA), s * 0.22, 0, 0);
    // Thigh: a big orange haunch tapering to the reverse knee, plated on the outside
    place(hip, P(loft([
      { y: 0.1, w: 0.62, d: 0.9, c: 0.18, z: 0.02 },
      { y: -0.6, w: 0.72, d: 1.04, c: 0.22, z: -0.02 },
      { y: -1.4, w: 0.5, d: 0.7, c: 0.15, z: -0.04 },
      { y: -TH + 0.2, w: 0.36, d: 0.46, c: 0.1, z: 0 },
    ]), M.armor, { all: B.plainA, x: B.plainA }), s * 0.06, 0, 0);
    place(hip, P(blade([[0.52, 0.06], [0.48, -0.7], [0.1, -1.36], [-0.42, -1.2], [-0.56, -0.3], [-0.24, 0.1]], 0.1, [0.6, 1], [0.6, 1]), M.second, PB), s * 0.42, 0, 0);
    place(hip, P(blade([[0.42, -0.1], [0.38, -0.66], [0.06, -1.14], [-0.12, -1.06], [0.2, -0.6], [0.24, -0.1]], 0.06, [0.6, 1]), M.accent, PA), s * 0.48, 0, 0);
    place(hip, P(frontPrism([[-0.26, 0.0], [0.26, 0.0], [0.24, -0.9], [0.0, -1.1], [-0.24, -0.9]], 0.1, 0.03), M.armor, PA), s * 0.06, -0.1, 0.52);
    for (let k = 0; k < 3; k++) place(hip, P(chamferBox(0.36, 0.04, 0.04, 0.01), M.trim), s * 0.06, -0.3 - k * 0.12, 0.58);
    this.mount(s > 0 ? 'legL' : 'legR', hip, s * 0.5, -0.72, -0.02, 0, 0, -s * Math.PI / 2);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    // The knee points backward: a drum joint with a spur raking back
    place(knee, P(cylX(0.24, 0.5), M.joint));
    for (const x of [-0.27, 0.27]) place(knee, P(cylX(0.15, 0.05, 12), M.accent, PA), x, 0, 0);
    place(knee, P(blade([[-0.1, 0.2], [-0.7, 0.36], [-0.8, 0.1], [-0.22, -0.2]], 0.3, [0.4, 1]), M.armor, PA));
    this.pistons.push(new Piston(hip, new V3(0, -0.6, -0.42), knee, new V3(0, -0.9, -0.2), 0.08, M));
    // Shin: a long orange blade tapering to a point at the ankle, a dark spine down its back, a green light
    for (const x of [-0.1, 0.1]) place(knee, P(new THREE.CylinderGeometry(0.06, 0.04, SH - 0.3, 8), M.joint), x, -SH / 2, -0.1);
    place(knee, P(blade([[0.3, 0.1], [0.42, -0.6], [0.32, -1.5], [0.12, -SH + 0.06], [-0.04, -SH + 0.22], [-0.18, -1.2], [-0.24, -0.1]], 0.44, [0.7, 1], [0.35, 1]), M.armor, PA));
    place(knee, P(blade([[-0.18, -0.2], [-0.22, -1.3], [-0.06, -SH + 0.3], [-0.12, -1.2], [-0.1, -0.2]], 0.3, [1, 1], [0.5, 1]), M.second, PB));
    for (const sd of [-1, 1]) place(knee, P(blade([[0.44, -0.5], [0.36, -1.4], [0.33, -1.4], [0.41, -0.5]], 0.04, [1, 1]), M.accent, PA), sd * 0.2, 0, 0);
    for (const sd of [-1, 1]) strip(knee, M.eye, 0.02, 0.9, 0.04, sd * 0.2, -1.1, 0.0, 0.08, 0, 0);
    this.thrusters.calf.push(new Thruster(knee, new V3(0, -SH + 0.55, -0.2), new V3(0, -0.9, -0.45), 0.12, this.glowTex));

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.15, 14, 10), M.joint));
    // Pointed foot: the leg ends in a dark spike on a small pad
    place(ankle, P(blade([[0.14, 0.12], [0.16, -0.24], [0.04, -0.48], [-0.08, -0.26], [-0.12, 0.12]], 0.26, [1, 1], [0.35, 1]), M.second, PB));
    place(ankle, P(blade([[0.16, -0.06], [0.16, -0.24], [0.1, -0.34], [0.12, -0.06]], 0.2, [1, 1], [0.5, 1]), M.armor, PA));
    place(ankle, P(chamferBox(0.2, 0.04, 0.26, 0.02), M.joint), 0, -0.485, 0.02);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.3, -0.06), new V3(0, -1, -0.12), 0.12, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.26;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    place(waist, P(new THREE.CylinderGeometry(0.24, 0.3, 0.6, 12), M.joint), 0, 0.16, -0.04);
    for (let i = 0; i < 2; i++) place(waist, P(chamferBox(0.5 - i * 0.06, 0.14, 0.12, 0.04), M.second, PB), 0, 0.3 - i * 0.16, 0.24 - i * 0.02, -0.1);
    for (const sd of [-1, 1]) place(waist, P(new THREE.CylinderGeometry(0.035, 0.035, 0.56, 8), M.frame, PB), sd * 0.24, 0.2, 0.16, 0, 0, sd * 0.12);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.42;
    waist.add(chest);
    // A low, wide torso slung between the shoulder drums
    place(chest, P(loft([
      { y: 0.0, w: 0.8, d: 0.76, c: 0.18, z: 0.0 },
      { y: 0.42, w: 1.5, d: 1.1, c: 0.28, z: 0.04 },
      { y: 0.9, w: 1.56, d: 1.1, c: 0.28, z: 0.0 },
      { y: 1.08, w: 1.1, d: 0.86, c: 0.22, z: -0.04 },
    ]), M.armor, { all: B.plainA, x: B.plainA }));
    // Front: two angled plates over a dark keel, white tick marks, a light
    for (const sd of [-1, 1]) {
      place(chest, P(frontPrism(mirror([[0.06, 0.1], [0.6, 0.3], [0.66, 0.86], [0.2, 0.96], [0.06, 0.7]], sd), 0.12, 0.03), M.armor, PA), 0, 0, 0.58, 0, sd * 0.16, 0);
      place(chest, P(chamferBox(0.14, 0.04, 0.03, 0.01), M.accent, PA), sd * 0.44, 0.78, 0.66);
      place(chest, P(chamferBox(0.04, 0.2, 0.03, 0.01), M.accent, PA), sd * 0.54, 0.66, 0.65);
    }
    place(chest, P(frontPrism([[-0.08, 0.1], [0.08, 0.1], [0.1, 0.7], [0, 0.8], [-0.1, 0.7]], 0.14, 0.02), M.second, PB), 0, 0, 0.62);
    strip(chest, M.eye, 0.03, 0.3, 0.02, 0, 0.4, 0.7);
    // Back: a green ring set in a dark disc, between two vent stacks
    place(chest, P(cylZ(0.38, 0.38, 0.08, 22), M.second, PB), 0, 0.56, -0.58);
    const ring = place(chest, new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 28), M.eye), 0, 0.56, -0.63);
    ring.userData.noOutline = true;
    for (const sd of [-1, 1]) slats(chest, M.joint, 5, sd * 0.56, 0.3, -0.58, [0, 0.1, 0], 0.2, 0.04, 0.06);
    // Flank louvres
    for (const sd of [-1, 1]) slats(chest, M.joint, 3, sd * 0.79, 0.5, 0.16, [0, 0, -0.16], 0.06, 0.34, 0.05);
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.0, 0.56);
    head.scale.setScalar(1.15);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 10), M.joint), 0, -0.04, -0.12);
    // A small armored skull with a round green eye in a dark socket
    place(head, P(loftZ([
      { z: -0.26, w: 0.46, h: 0.4, y: 0.12, c: 0.12 },
      { z: 0.12, w: 0.5, h: 0.42, y: 0.12, c: 0.13 },
      { z: 0.32, w: 0.34, h: 0.3, y: 0.08, c: 0.09 },
    ]), M.armor, PA));
    place(head, P(cylZ(0.13, 0.13, 0.08, 16), M.joint), 0, 0.1, 0.32);
    place(head, new THREE.Mesh(cylZ(0.085, 0.085, 0.04, 16), M.lens), 0, 0.1, 0.36);
    place(head, new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), M.eye), 0, 0.1, 0.39).userData.noOutline = true;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x7dff4f, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.8 }));
    glow.scale.setScalar(0.42);
    glow.renderOrder = 6;
    place(head, glow, 0, 0.1, 0.42);
    // Two tall fins raked up and back off the crown, dark with a green light and an orange edge
    for (const sd of [-1, 1]) {
      const fin = new THREE.Group();
      fin.position.set(sd * 0.18, 0.22, -0.12);
      fin.rotation.set(-0.1, -sd * 0.8, 0, 'YXZ');
      fin.scale.setScalar(0.82);
      head.add(fin);
      place(fin, P(blade([[0.16, 0.0], [0.06, 0.3], [-0.4, 1.36], [-0.66, 1.3], [-0.3, 0.0]], 0.08, [0.7, 1], [0.6, 1]), M.second, PB));
      place(fin, P(blade([[0.16, 0.0], [0.06, 0.3], [-0.4, 1.36], [-0.46, 1.34], [0.0, 0.28], [0.08, 0.0]], 0.1, [0.7, 1]), M.armor, PA));
      strip(fin, M.eye, 0.02, 0.9, 0.025, sd * 0.05, 0.66, -0.3, 0.38, 0, 0);
    }
    place(head, P(frontPrism([[-0.14, 0.0], [0.14, 0.0], [0.08, -0.1], [-0.08, -0.1]], 0.12, 0.02), M.second, PB), 0, -0.04, 0.26);
    for (const sd of [-1, 1]) place(head, P(blade([[0.3, -0.02], [0.06, 0.24], [-0.24, 0.26], [-0.22, -0.04]], 0.05, [1, 0.6]), M.armor, PA), sd * 0.27, 0, 0, 0, -sd * 0.1, 0);
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 0.98, 0.8, 0.0);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.24, 14, 10), M.joint));
    // Shoulder drum: a great smooth cylinder on its side with a dark end cap, a seam and a white triangle mark
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.38, 0.22, 0);
    sh.add(pauldron);
    place(pauldron, P(cylX(0.62, 0.88, 26), M.armor, PA));
    place(pauldron, P(cylX(0.632, 0.05, 26), M.second, PB), -s * 0.16, 0, 0);
    place(pauldron, P(cylX(0.52, 0.1, 24), M.second, PB), s * 0.46, 0, 0);
    place(pauldron, P(cylX(0.34, 0.04, 20), M.joint), s * 0.52, 0, 0);
    place(pauldron, P(frontPrism(mirror([[0.0, -0.1], [0.18, -0.1], [0.18, 0.08]], s), 0.02, 0.004), M.accent, PA), s * 0.18, 0.0, 0.625);
    place(pauldron, P(chamferBox(0.06, 0.24, 0.04, 0.01), M.accent, PA), -s * 0.3, 0.06, 0.615);
    place(pauldron, P(chamferBox(0.3, 0.08, 0.3, 0.02), M.joint), -s * 0.12, -0.62, 0.1);

    // Long thin upper arm
    place(sh, P(new THREE.CylinderGeometry(0.1, 0.1, 0.86, 10), M.joint), 0, -0.48, 0);
    place(sh, P(loft([{ y: -0.34, w: 0.28, d: 0.34, c: 0.07 }, { y: -0.82, w: 0.3, d: 0.36, c: 0.08 }]), M.second, PB), s * 0.02, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -0.94;
    sh.add(elbow);
    place(elbow, P(cylX(0.15, 0.36), M.joint));
    // Forearm: an orange gauntlet under a long dark blade sleeve that runs past the hand, with a green light
    place(elbow, P(loft([
      { y: -0.04, w: 0.34, d: 0.42, c: 0.09 },
      { y: -0.5, w: 0.44, d: 0.54, c: 0.12, z: 0.02 },
      { y: -1.0, w: 0.4, d: 0.5, c: 0.1, z: 0.02 },
      { y: -1.12, w: 0.32, d: 0.4, c: 0.08 },
    ]), M.armor, PA));
    const edge = new THREE.Group();
    edge.position.set(s * 0.25, 0, 0);
    elbow.add(edge);
    place(edge, P(blade([[0.3, 0.1], [0.34, -0.8], [0.2, -1.5], [0.02, -1.74], [-0.18, -1.36], [-0.28, 0.0]], 0.14, [1, 1], [0.6, 1]), M.second, PB));
    place(edge, P(blade([[0.34, -0.2], [0.36, -0.8], [0.32, -0.8], [0.3, -0.2]], 0.18, [1, 1]), M.armor, PA));
    strip(edge, M.eye, 0.02, 0.8, 0.03, s * 0.075, -0.9, 0.12, -0.12, 0, 0);
    this.pistons.push(new Piston(sh, new V3(0, -0.4, 0.18), elbow, new V3(0, -0.26, 0.24), 0.04, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.34, -0.5, 0.04);
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
    place(hand, P(chamferBox(0.3, 0.16, 0.38, 0.04), M.second, PB), 0, -0.32, 0.06, 0.35);
    place(hand, P(chamferBox(0.09, 0.22, 0.11, 0.02), M.joint), -s * 0.15, -0.2, 0.15, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.22, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, pauldronLag: 0.65, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 0.74, -0.56);
    this.chest.add(bp);
    // Jump pack: a wedge hull between two raked vanes, with the jets under its belly
    place(bp, P(loft([
      { y: 0.42, w: 0.9, d: 0.4, c: 0.12, z: -0.12 },
      { y: -0.2, w: 1.1, d: 0.6, c: 0.16, z: -0.2 },
      { y: -0.6, w: 0.86, d: 0.5, c: 0.13, z: -0.18 },
    ]), M.armor, { all: B.plainA, x: B.vent }));
    place(bp, P(frontPrism([[-0.3, 0.3], [0.3, 0.3], [0.36, -0.36], [0, -0.5], [-0.36, -0.36]], 0.08, 0.02), M.second, { all: B.mechA }), 0, 0.0, -0.5);
    strip(bp, M.eye, 0.03, 0.4, 0.02, 0, -0.02, -0.55);
    for (const s of [-1, 1]) {
      const vane = new THREE.Group();
      vane.position.set(s * 0.5, 0.2, -0.32);
      vane.rotation.set(-0.55, s * 0.5, -s * 0.5);
      bp.add(vane);
      place(vane, P(blade([[0.14, -0.2], [0.04, 0.3], [-0.4, 1.1], [-0.6, 1.14], [-0.6, 0.4], [-0.3, -0.24]], 0.08, [0.5, 1], [0.6, 1]), M.armor, PA));
      place(vane, P(blade([[0.1, 0.2], [-0.36, 1.02], [-0.42, 1.04], [0.0, 0.2]], 0.1, [0.5, 1]), M.accent, PA));
      port(this, vane, 0.07, s * 0.045, 0.5, -0.36, 0, s * Math.PI / 2, 0);
      // Jump jets under the hull
      const hx = s * 0.3;
      const dir = new V3(0, -1, -0.3).normalize();
      const mountPos = new V3(hx, -0.62, -0.32);
      const ring = place(bp, P(new THREE.CylinderGeometry(0.28, 0.32, 0.1, 16), M.joint), mountPos.x, mountPos.y, mountPos.z);
      ring.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.36, this.glowTex, {
        actuators: [new V3(hx + 0.24, -0.5, -0.22), new V3(hx - 0.24, -0.5, -0.22), new V3(hx, -0.52, -0.5)],
      }));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.52, 0.0, -0.36), new V3(s * 0.25, 0.1, -1), 0.12, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 18, 1.8);
    this.thrustLight.position.set(0, -1.4, -0.6);
    bp.add(this.thrustLight);
  }
}
