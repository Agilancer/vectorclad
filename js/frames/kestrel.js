import * as THREE from '../three.js';
import { B, frontPrism, topPrism, chamferBox, cylX, cylZ, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, loftZ } from '../mech.js';
import { strip, slats } from './kit.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// LT-3 Kestrel: a light scout on stilts. An angular cockpit pod with a canopy
// hump and a tall wedge fin rides on an exposed ribbed spine, its guns on its
// front flanks. Drum actuators with dial caps at every big joint; long arms
// hanging off shoulder drums; slab-plated thighs with white X-marked panels;
// long segmented shins with chevron lights; skid feet with tube outriggers.
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
  hunch: 0.12, hunchIdle: 0.08, armOut: 0.14,
};

const PA = { all: B.plainA }, PB = { all: B.plainB };

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

  /** A drum actuator end: a disc with a raised rim and a slotted dial, facing out along X (side s). */
  dial(parent, r, x, y, z, s) {
    const M = this.mats;
    place(parent, P(cylX(r, 0.08, 18), M.accent, PA), x, y, z);
    place(parent, P(cylX(r * 0.78, 0.06, 18), M.armor, PA), x + s * 0.04, y, z);
    place(parent, P(chamferBox(0.03, r * 1.2, r * 0.22, 0.01), M.joint), x + s * 0.075, y, z, 0.6, 0, 0);
  }

  /** A white panel marked with an X, facing +Z. */
  xPanel(parent, w, h, x, y, z, rx = 0, ry = 0) {
    const M = this.mats;
    const g = place(parent, P(chamferBox(w, h, 0.05, Math.min(w, h) * 0.14, 0.015), M.accent, PA), x, y, z, rx, ry, 0);
    const a = Math.atan2(h, w), L = Math.hypot(w, h) * 0.6;
    for (const r of [a, -a]) place(g, P(chamferBox(L, 0.025, 0.02, 0.008, 0.004), M.joint), 0, 0, 0.03, 0, 0, r);
    return g;
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
    // Codpiece with a light, a plate over the axle at the back, and a slotted hub by the hip
    place(p, P(frontPrism([[-0.22, 0.14], [0.22, 0.14], [0.14, -0.16], [0, -0.3], [-0.14, -0.16]], 0.12, 0.03), M.armor, PA), 0, 0.02, 0.38);
    strip(p, M.eye, 0.16, 0.025, 0.02, 0, 0.06, 0.45);
    place(p, P(frontPrism([[-0.3, 0.18], [0.3, 0.18], [0.2, -0.2], [-0.2, -0.2]], 0.1, 0.03), M.armor, PA), 0, 0.02, -0.38);
    place(p, P(cylZ(0.16, 0.16, 0.08, 16), M.second, PB), -0.26, 0.12, 0.38);
    place(p, P(chamferBox(0.2, 0.03, 0.02, 0.01), M.joint), -0.26, 0.12, 0.43, 0, 0, 0.5);
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 0.7, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    // Drum actuator on the end of the axle
    place(hip, P(cylX(0.32, 0.36, 18), M.joint));
    place(hip, P(cylX(0.34, 0.06, 18), M.second, PB), s * -0.16, 0, 0);
    this.dial(hip, 0.24, s * 0.2, 0, 0, s);
    // Thigh: a thin strut behind a big slab of armor, like cargo plates, white X panels up top
    place(hip, P(new THREE.CylinderGeometry(0.12, 0.13, TH - 0.2, 10), M.joint), 0, -TH / 2, -0.06);
    place(hip, P(loft([
      { y: 0.02, w: 0.42, d: 0.86, c: 0.12, z: 0.04 },
      { y: -0.55, w: 0.5, d: 1.08, c: 0.15, z: 0.1 },
      { y: -1.45, w: 0.44, d: 0.9, c: 0.13, z: 0.08 },
      { y: -1.78, w: 0.32, d: 0.58, c: 0.1, z: 0.04 },
    ]), M.armor, { all: B.plainA, x: B.plainA }), s * 0.12, -0.1, 0);
    place(hip, P(frontPrism([[-0.2, 0.0], [0.2, 0.0], [0.22, -0.95], [0.0, -1.12], [-0.22, -0.95]], 0.08, 0.025), M.armor, PA), s * 0.12, -0.3, 0.62);
    this.xPanel(hip, 0.3, 0.34, s * 0.12, -0.5, 0.67);
    strip(hip, M.eye, 0.14, 0.03, 0.02, s * 0.12, -0.24, 0.67);
    const side = new THREE.Group();
    side.position.set(s * 0.385, -0.75, 0.12);
    side.rotation.y = s * Math.PI / 2;
    hip.add(side);
    this.xPanel(side, 0.62, 0.62, 0, 0, 0);
    place(hip, P(chamferBox(0.5, 0.06, 1.0, 0.02), M.joint), s * 0.12, -1.14, 0.08);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    // Disc actuator with a dial on the outside of the knee, and a cap in front
    place(knee, P(cylX(0.2, 0.42), M.joint));
    place(knee, P(cylX(0.27, 0.12, 18), M.second, PB), s * 0.22, 0, 0);
    this.dial(knee, 0.2, s * 0.3, 0, 0, s);
    place(knee, P(blade([[0.06, -0.3], [0.3, -0.12], [0.34, 0.22], [0.14, 0.36], [0.02, 0.1]], 0.36, [1, 1], [1, 0.6]), M.armor, PA), 0, 0, 0.06);

    // Shin: a slender core with a stack of overlapping plates down its front, chevron lights in two
    place(knee, P(loft([
      { y: -0.05, w: 0.44, d: 0.54, c: 0.11, z: -0.02 },
      { y: -1.2, w: 0.36, d: 0.46, c: 0.09, z: -0.03 },
      { y: -SH + 0.2, w: 0.3, d: 0.38, c: 0.08, z: 0 },
    ]), M.armor, { all: B.plainA, x: B.sideVents }));
    for (let i = 0; i < 4; i++) {
      const y = -0.42 - i * 0.56, w = 0.4 - i * 0.03;
      const seg = place(knee, P(frontPrism([[-w / 2, 0.24], [w / 2, 0.24], [w / 2 + 0.02, -0.2], [0, -0.3], [-w / 2 - 0.02, -0.2]], 0.12, 0.03),
        i % 2 ? M.accent : M.armor, PA), 0, y, 0.2 + i * 0.01, 0.1);
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
    this.dial(ankle, 0.13, s * 0.19, 0, 0, s);
    place(ankle, P(loft([{ y: 0.12, w: 0.3, d: 0.36, c: 0.08 }, { y: -0.2, w: 0.42, d: 0.5, c: 0.1 }]), M.second, PB));
    // Skid foot: a toe pad and a heel pad on a flat sole, with a tube outrigger out front
    place(ankle, P(chamferBox(0.56, 0.1, 1.36, 0.04), M.joint), 0, -0.4, 0.12);
    place(ankle, P(loft([
      { y: -0.14, w: 0.5, d: 0.5, c: 0.1, z: 0.42 },
      { y: -0.36, w: 0.64, d: 0.66, c: 0.12, z: 0.46 },
    ]), M.armor, { all: B.plainA, y: B.plainB }));
    place(ankle, P(chamferBox(0.22, 0.08, 0.14, 0.02), M.accent, PA), 0, -0.12, 0.62);
    place(ankle, P(loft([
      { y: -0.12, w: 0.36, d: 0.34, c: 0.08, z: -0.36 },
      { y: -0.36, w: 0.5, d: 0.44, c: 0.1, z: -0.4 },
    ]), M.armor, { all: B.plainA, y: B.plainB }));
    for (const x of [-0.2, 0.2]) place(ankle, P(cylZ(0.045, 0.045, 0.5, 8), M.frame, PB), x, -0.32, 0.92);
    place(ankle, P(cylX(0.045, 0.44, 8), M.frame, PB), 0, -0.32, 1.16);
    for (const x of [-0.2, 0.2]) place(ankle, P(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), M.joint), x, -0.37, 1.16);
    place(ankle, P(chamferBox(0.1, 0.08, 0.1, 0.02), M.armor, PA), 0, -0.26, 1.16);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.3, -0.06), new V3(0, -1, -0.12), 0.13, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.28;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Exposed spine: a stack of ribs between struts
    place(waist, P(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 10), M.joint), 0, 0.18, -0.05);
    for (const y of [-0.02, 0.1, 0.22, 0.34]) place(waist, P(chamferBox(0.6, 0.06, 0.44, 0.03), M.second, PB), 0, y, 0.0);
    for (const sd of [-1, 1]) place(waist, P(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), M.frame, PB), sd * 0.24, 0.2, 0.16, 0, 0, sd * 0.1);
    strip(waist, M.eye, 0.1, 0.03, 0.02, 0, 0.1, 0.24);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.46;
    waist.add(chest);
    // Cockpit pod: an angular hull, deep and wide, sloping down to a blunt nose
    place(chest, P(loft([
      { y: 0.0, w: 1.3, d: 1.4, c: 0.16, z: 0.0 },
      { y: 0.4, w: 1.8, d: 1.9, c: 0.2, z: 0.08 },
      { y: 1.02, w: 1.8, d: 1.86, c: 0.2, z: -0.04 },
      { y: 1.26, w: 1.42, d: 1.5, c: 0.16, z: -0.12 },
    ]), M.armor, { all: B.plainA, x: B.plainA }));
    // Prow: the pod's front comes to a blunt point in three layers, a roof lip, an armored band and a dark chin
    const prow = (w, tip, h, y, z, mat, faces) => place(chest, P(topPrism([[-w, 0], [w, 0], [w * 0.72, tip * 0.6], [w * 0.22, tip], [-w * 0.22, tip], [-w * 0.72, tip * 0.6]], h, 0.03), mat, faces), 0, y, z);
    prow(0.9, 0.56, 0.16, 1.08, 0.6, M.armor, PA).rotation.x = 0.08;
    prow(0.84, 0.44, 0.3, 0.82, 0.62, M.second, { all: B.mechA });
    prow(0.86, 0.5, 0.3, 0.5, 0.64, M.armor, PA);
    place(chest, P(chamferBox(1.3, 0.05, 0.05, 0.02), M.accent, PA), 0, 1.0, 1.2);
    strip(chest, M.eye, 0.34, 0.035, 0.02, 0.3, 0.74, 1.08);
    slats(chest, M.joint, 2, 0.5, 0.74, 1.0, [0.12, 0, -0.04], 0.04, 0.16, 0.04);
    place(chest, P(chamferBox(0.5, 0.04, 0.05, 0.01), M.accent, PA), 0.2, 0.46, 1.16);
    // Big round sensor disc ringed in white on the front right corner, facing forward and out
    const disc = new THREE.Group();
    disc.position.set(-0.84, 0.7, 0.96);
    disc.rotation.y = -0.7;
    chest.add(disc);
    place(disc, P(cylZ(0.34, 0.34, 0.14, 22), M.accent, PA));
    place(disc, P(cylZ(0.27, 0.27, 0.06, 22), M.armor, PA), 0, 0, 0.08);
    place(disc, P(chamferBox(0.42, 0.04, 0.04, 0.01), M.joint), 0, 0, 0.12, 0, 0, 0.6);
    place(disc, P(cylZ(0.08, 0.08, 0.04, 14), M.joint), 0, 0, 0.12);
    // Side armor, each side with a round sensor housing ringed in white
    for (const sd of [-1, 1]) {
      const side = place(chest, P(chamferBox(0.08, 0.66, 1.3, 0.05), M.armor, PA), sd * 0.86, 0.66, 0.04);
      strip(side, M.eye, 0.02, 0.04, 0.32, sd * 0.05, 0.2, 0.3);
      place(chest, P(cylX(0.27, 0.12, 18), M.accent, PA), sd * 0.92, 0.46, -0.2);
      place(chest, P(cylX(0.21, 0.08, 18), M.armor, PA), sd * 0.96, 0.46, -0.2);
      place(chest, P(chamferBox(0.03, 0.3, 0.05, 0.01), M.joint), sd * 1.0, 0.46, -0.2, 0.7, 0, 0);
    }
    // The tall wedge fin rising off the left of the roof, with a light
    const fin = new THREE.Group();
    fin.position.set(0.56, 1.1, -0.1);
    fin.rotation.set(0, 0, -0.32);
    chest.add(fin);
    place(fin, P(blade([[0.7, 0.0], [0.5, 0.36], [-0.5, 0.92], [-0.9, 0.86], [-0.7, 0.2], [-0.2, -0.04]], 0.36, [0.7, 1], [0.6, 1]), M.armor, PA));
    place(fin, P(blade([[0.5, 0.38], [-0.5, 0.94], [-0.56, 0.9], [0.44, 0.34]], 0.38, [0.7, 1]), M.accent, PA));
    strip(fin, M.eye, 0.04, 0.03, 0.3, 0.14, 0.42, 0.24, -0.5, 0, 0);
    this.plate(chest, 'a01', 0.36, 0, 0.6, -0.92, 0, Math.PI);

    // Guns on the pod's front flanks, like a scout's
    for (const [key, sd] of [['shoulderR', -1], ['shoulderL', 1]]) {
      place(chest, P(chamferBox(0.22, 0.14, 0.5, 0.04), M.joint), sd * 0.9, 0.5, 0.56);
      this.mount(key, chest, sd * 1.02, 0.5, 0.5);
    }
  }

  buildHead() {
    const M = this.mats;
    // Canopy hump on the right of the roof: an angular hood with a light along its brow, a sensor drum and an antenna
    const head = (this.head = new THREE.Group());
    head.position.set(-0.22, 1.24, 0.24);
    head.scale.setScalar(1.22);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.24, 0.3, 0.16, 12), M.joint), 0, 0.02, 0);
    place(head, P(loftZ([
      { z: -0.5, w: 0.7, h: 0.3, y: 0.22, c: 0.08 },
      { z: 0.1, w: 0.8, h: 0.42, y: 0.28, c: 0.12 },
      { z: 0.46, w: 0.62, h: 0.26, y: 0.2, c: 0.08 },
    ]), M.armor, PA));
    place(head, P(frontPrism([[-0.34, 0.1], [0.34, 0.1], [0.28, -0.08], [-0.28, -0.08]], 0.08, 0.02), M.second, PB), 0, 0.2, 0.46, -0.24);
    // The brow light: a bar across the front and down the right corner
    strip(head, M.eye, 0.36, 0.03, 0.02, 0.02, 0.3, 0.5, -0.24);
    strip(head, M.eye, 0.03, 0.16, 0.02, -0.18, 0.22, 0.5, -0.24);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x5fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.5 }));
    glow.scale.setScalar(0.3);
    glow.renderOrder = 6;
    place(head, glow, -0.18, 0.24, 0.54);
    place(head, P(chamferBox(0.32, 0.05, 0.6, 0.02), M.accent, PA), 0.08, 0.44, -0.06);
    place(head, P(cylX(0.13, 0.14, 14), M.second, PB), -0.44, 0.26, 0.0);
    place(head, P(cylX(0.09, 0.04, 14), M.accent, PA), -0.52, 0.26, 0.0);
    const ant = place(head, P(new THREE.CylinderGeometry(0.012, 0.03, 1.3, 6), M.frame, PB), 0.2, 0.84, -0.4, -0.55, 0, -0.12);
    place(ant, P(chamferBox(0.06, 0.18, 0.04, 0.01), M.joint), 0, -0.4, 0);
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.12, 0.92, -0.1);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    // Shoulder: a long drum standing out from the pod's corner, white-ringed, with a light along its top
    place(sh, P(cylX(0.32, 0.74, 20), M.armor, PA), s * 0.02, 0, 0);
    for (const x of [-0.3, 0.3]) place(sh, P(cylX(0.335, 0.06, 20), M.accent, PA), s * x, 0, 0);
    this.dial(sh, 0.26, s * 0.4, 0, 0, s);
    strip(sh, M.eye, 0.26, 0.04, 0.04, s * 0.06, 0.24, 0.2, -0.6, 0, 0);
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.08, 0.1, 0);
    sh.add(pauldron);
    place(pauldron, P(blade([[0.34, 0.14], [0.38, -0.08], [0.0, -0.22], [-0.38, -0.14], [-0.32, 0.18]], 0.46, [0.8, 1], [0.8, 1]), M.armor, PA), 0, 0.12, 0);
    place(sh, P(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 10), M.joint), 0, -0.55, 0);
    place(sh, P(loft([{ y: -0.22, w: 0.34, d: 0.38, c: 0.08 }, { y: -0.92, w: 0.3, d: 0.36, c: 0.07 }]), M.armor, PA), s * 0.02, 0, 0);
    strip(sh, M.eye, 0.03, 0.3, 0.02, s * 0.1, -0.45, 0.2);

    const elbow = new THREE.Group();
    elbow.position.y = -1.08;
    sh.add(elbow);
    place(elbow, P(cylX(0.15, 0.36), M.joint));
    this.dial(elbow, 0.17, s * 0.2, 0, 0, s);
    // Forearm: an armored box with a dark recessed panel and a white X plate near the wrist
    place(elbow, P(loft([
      { y: -0.04, w: 0.36, d: 0.44, c: 0.09 },
      { y: -0.55, w: 0.46, d: 0.56, c: 0.11, z: 0.02 },
      { y: -1.08, w: 0.4, d: 0.5, c: 0.1, z: 0.02 },
      { y: -1.2, w: 0.3, d: 0.38, c: 0.08 },
    ]), M.armor, PA));
    place(elbow, P(chamferBox(0.04, 0.5, 0.3, 0.03), M.joint), s * 0.235, -0.52, 0.02);
    const xp = new THREE.Group();
    xp.position.set(s * 0.23, -0.95, -0.02);
    xp.rotation.y = s * Math.PI / 2;
    elbow.add(xp);
    this.xPanel(xp, 0.26, 0.24, 0, 0, 0);
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
    for (const x of [-0.08, 0.08]) place(hand, P(chamferBox(0.08, 0.26, 0.1, 0.02), M.second, PB), x, -0.32, 0.1, 0.4);
    place(hand, P(chamferBox(0.08, 0.2, 0.1, 0.02), M.second, PB), -s * 0.15, -0.2, 0.12, 0.3);
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
      place(vane, P(blade([[0.1, 0.0], [-0.3, 0.16], [-0.9, 0.5], [-0.84, 0.3], [-0.3, -0.12]], 0.06, [0.4, 1]), M.armor, PA));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.46, 0.14, -0.42), new V3(s * 0.3, 0.05, -1), 0.12, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 18, 1.8);
    this.thrustLight.position.set(0, -1.4, -0.6);
    bp.add(this.thrustLight);
  }
}
