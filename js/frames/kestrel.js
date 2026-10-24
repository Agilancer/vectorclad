import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, cylZ, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, loftZ, mirror, warp } from '../mech.js';
import { port, strip, slats } from './kit.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// LT-3 Kestrel: a light scout on stilts. A hunched cockpit pod with a chevron
// glacis and a tinted canopy rides on an exposed spine; a camera head with a
// row of lenses sits on its brow. Big flat shoulder blocks edged in copper
// hang over long, thin arms. Slab-plated thighs over long segmented shins
// with chevron lights end in tip-toe feet. A slim booster pack carries the
// shoulder guns over its back.
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
  hunch: 0.16, hunchIdle: 0.1, armOut: 0.16,
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
    // Chevron codpiece with a copper keel and a light, a plate over the axle at the back
    place(p, P(frontPrism([[-0.24, 0.14], [0.24, 0.14], [0.14, -0.16], [0, -0.34], [-0.14, -0.16]], 0.12, 0.03), M.armor, PA), 0, 0.02, 0.38);
    place(p, P(frontPrism([[-0.04, 0.1], [0.04, 0.1], [0.04, -0.14], [0, -0.24], [-0.04, -0.14]], 0.04, 0.01), M.accent, PA), 0, 0.02, 0.45);
    strip(p, M.eye, 0.16, 0.025, 0.02, 0, 0.08, 0.45);
    place(p, P(frontPrism([[-0.3, 0.18], [0.3, 0.18], [0.2, -0.2], [-0.2, -0.2]], 0.1, 0.03), M.armor, PA), 0, 0.02, -0.38);
    // Narrow side blades
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.46, 0.14, 0.02);
      g.rotation.z = s * 0.14;
      p.add(g);
      place(g, P(blade([[0.3, 0.06], [-0.3, 0.1], [-0.6, -0.12], [-0.3, -0.4], [0.24, -0.34]], 0.06, [0.5, 1]), M.armor, PA), s * 0.04, 0, 0);
      return g;
    });
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 0.7, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    // Drum actuator on the end of the axle
    place(hip, P(cylX(0.32, 0.36, 16), M.joint));
    place(hip, P(cylX(0.22, 0.06, 14), M.accent, PA), s * 0.2, 0, 0);
    place(hip, P(cylX(0.34, 0.06, 16), M.second, PB), s * -0.16, 0, 0);
    // Thigh: a thin strut behind a slab of armor, a copper-striped outer plate
    place(hip, P(new THREE.CylinderGeometry(0.12, 0.13, TH - 0.2, 10), M.joint), 0, -TH / 2, -0.06);
    place(hip, P(loft([
      { y: 0.02, w: 0.4, d: 0.84, c: 0.12, z: 0.04 },
      { y: -0.55, w: 0.48, d: 1.04, c: 0.15, z: 0.1 },
      { y: -1.45, w: 0.42, d: 0.86, c: 0.13, z: 0.08 },
      { y: -1.78, w: 0.3, d: 0.56, c: 0.1, z: 0.04 },
    ]), M.armor, { all: B.plainA, x: B.plainA }), s * 0.12, -0.1, 0);
    place(hip, P(frontPrism([[-0.2, 0.0], [0.2, 0.0], [0.22, -0.95], [0.0, -1.12], [-0.22, -0.95]], 0.08, 0.025), M.armor, PA), s * 0.12, -0.3, 0.62);
    strip(hip, M.eye, 0.14, 0.03, 0.02, s * 0.12, -0.42, 0.67);
    place(hip, P(blade([[0.5, -0.2], [0.46, -1.0], [0.1, -1.5], [-0.3, -1.3], [-0.4, -0.3]], 0.05, [0.6, 1]), M.second, PB), s * 0.37, -0.1, 0.06);
    place(hip, P(chamferBox(0.04, 1.0, 0.05, 0.01), M.accent, PA), s * 0.4, -0.8, 0.4, -0.12);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    // Disc actuator on the outside of the knee, a pointed copper cap in front
    place(knee, P(cylX(0.2, 0.42), M.joint));
    place(knee, P(cylX(0.26, 0.12, 16), M.second, PB), s * 0.22, 0, 0);
    place(knee, P(cylX(0.13, 0.04, 12), M.accent, PA), s * 0.29, 0, 0);
    place(knee, P(blade([[0.06, -0.3], [0.32, -0.12], [0.38, 0.22], [0.14, 0.44], [0.02, 0.1]], 0.36, [1, 1], [1, 0.5]), M.armor, PA), 0, 0, 0.06);
    place(knee, P(blade([[0.36, -0.06], [0.4, 0.2], [0.2, 0.38], [0.32, 0.16]], 0.18, [1, 1]), M.accent, PA), 0, 0, 0.06);

    // Shin: a slender core with a stack of overlapping plates down its front
    place(knee, P(loft([
      { y: -0.05, w: 0.44, d: 0.54, c: 0.11, z: -0.02 },
      { y: -1.2, w: 0.36, d: 0.46, c: 0.09, z: -0.03 },
      { y: -SH + 0.2, w: 0.28, d: 0.36, c: 0.08, z: 0 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    for (let i = 0; i < 4; i++) {
      const y = -0.42 - i * 0.56, w = 0.42 - i * 0.04;
      const seg = place(knee, P(frontPrism([[-w / 2, 0.24], [w / 2, 0.24], [w / 2 + 0.02, -0.2], [0, -0.3], [-w / 2 - 0.02, -0.2]], 0.12, 0.03),
        M.armor, PA), 0, y, 0.2 + i * 0.01, 0.1);
      if (i === 0 || i === 2) place(seg, P(frontPrism([[-0.07, 0.0], [0.07, 0.0], [0.0, -0.06]], 0.02, 0.004), M.eye), 0, 0.08, 0.07).userData.noOutline = true;
      else place(seg, P(chamferBox(w * 0.8, 0.04, 0.02, 0.01), M.accent, PA), 0, 0.14, 0.07);
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
    // Achilles ram from the back of the shin to the raised heel
    this.pistons.push(new Piston(knee, new V3(0, -SH + 0.75, -0.2), ankle, new V3(0, -0.06, -0.4), 0.045, M));
    place(ankle, P(cylX(0.17, 0.34), M.joint));
    for (const x of [-0.19, 0.19]) place(ankle, P(cylX(0.1, 0.04, 10), M.accent, PA), x, 0, 0);
    place(ankle, P(loft([{ y: 0.12, w: 0.3, d: 0.36, c: 0.08 }, { y: -0.16, w: 0.38, d: 0.46, c: 0.1, z: 0.04 }]), M.second, PB));
    // Tip-toe foot: a long instep sloping down to a pointed toe pad, the heel raised off the ground on a spur
    place(ankle, P(blade([[-0.2, -0.04], [0.2, -0.1], [0.94, -0.36], [1.04, -0.45], [0.5, -0.45], [-0.06, -0.26]], 0.42, [1, 0.45], [0.8, 1]), M.armor, { all: B.plainA, y: B.plainB }));
    place(ankle, P(blade([[0.3, -0.15], [0.9, -0.36], [0.96, -0.42], [0.36, -0.22]], 0.2, [1, 0.5]), M.accent, PA));
    place(ankle, P(blade([[0.5, -0.4], [1.04, -0.45], [0.5, -0.45]], 0.5, [1, 0.5]), M.joint));
    place(ankle, P(blade([[-0.1, -0.06], [-0.42, -0.06], [-0.6, -0.3], [-0.2, -0.22]], 0.2, [0.4, 1]), M.armor, PA));
    for (const sd of [-1, 1]) place(ankle, P(blade([[0.3, -0.26], [0.82, -0.42], [0.86, -0.45], [0.3, -0.45]], 0.1, [1, 0.3]), M.second, PB), sd * 0.2, 0, 0, 0, sd * 0.25, 0);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.24, 0.14), new V3(0, -1, -0.12), 0.13, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.28;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Exposed spine: ribbed rings between copper struts
    place(waist, P(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 10), M.joint), 0, 0.18, -0.05);
    for (const y of [0.02, 0.18, 0.34]) place(waist, P(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12), M.second, PB), 0, y, -0.05);
    for (const sd of [-1, 1]) place(waist, P(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), M.accent, PA), sd * 0.24, 0.2, 0.16, 0, 0, sd * 0.1);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.46;
    waist.add(chest);
    // Cockpit pod: hunched, deep, its brow pushed forward over the glacis
    place(chest, P(loft([
      { y: 0.0, w: 1.1, d: 1.2, c: 0.22, z: -0.04 },
      { y: 0.42, w: 1.56, d: 1.8, c: 0.3, z: 0.06 },
      { y: 1.0, w: 1.56, d: 1.84, c: 0.3, z: 0.04 },
      { y: 1.3, w: 1.1, d: 1.36, c: 0.24, z: -0.06 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    // Chevron glacis: two plates meeting in a V under a tinted canopy
    for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, 0, 1.0);
      g.rotation.y = sd * 0.2;
      chest.add(g);
      place(g, P(frontPrism(mirror([[0.0, 0.08], [0.76, 0.36], [0.8, 0.92], [0.4, 1.0], [0.0, 0.7]], sd), 0.14, 0.03), M.armor, PA), 0, 0, 0, 0.04);
      place(g, P(frontPrism(mirror([[0.04, 0.2], [0.72, 0.46], [0.72, 0.52], [0.04, 0.28]], sd), 0.03, 0.006), M.accent, PA), 0, 0, 0.08, 0.04);
    }
    place(chest, P(loftZ([
      { z: 0.3, w: 0.84, h: 0.3, y: 1.12, c: 0.1 },
      { z: 0.9, w: 0.5, h: 0.16, y: 1.04, c: 0.06 },
    ]), M.lens));
    place(chest, P(chamferBox(0.74, 0.3, 0.2, 0.06), M.second, { pz: B.ventDark, all: B.mechA }), 0, 0.2, 0.82, 0.25);
    // Side armor with round sensor housings and a light, roof fins
    for (const sd of [-1, 1]) {
      const side = place(chest, P(chamferBox(0.08, 0.62, 1.2, 0.05), M.armor, PA), sd * 0.8, 0.66, 0.04);
      strip(side, M.eye, 0.02, 0.04, 0.32, sd * 0.05, 0.2, 0.3);
      place(chest, P(cylX(0.24, 0.12, 18), M.second, PB), sd * 0.86, 0.44, 0.56);
      place(chest, P(cylX(0.16, 0.06, 16), M.joint), sd * 0.93, 0.44, 0.56);
      place(chest, new THREE.Mesh(cylX(0.06, 0.02, 10), M.eye), sd * 0.965, 0.44, 0.56).userData.noOutline = true;
      place(chest, P(blade([[0.5, 0.0], [0.2, 0.12], [-0.6, 0.18], [-0.7, 0.0]], 0.07, [0.6, 1]), M.armor, PA), sd * 0.36, 1.28, -0.1);
    }
    this.plate(chest, 'a01', 0.34, 0, 0.6, -0.92, 0, Math.PI);
  }

  buildHead() {
    const M = this.mats;
    // Camera head on the pod's brow: a low wedge with a visor band and a row of lenses
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.3, 0.3);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.22, 0.28, 0.16, 12), M.joint), 0, 0.02, 0);
    place(head, P(loftZ([
      { z: -0.42, w: 0.74, h: 0.3, y: 0.24, c: 0.08 },
      { z: 0.1, w: 0.8, h: 0.36, y: 0.26, c: 0.1 },
      { z: 0.46, w: 0.6, h: 0.24, y: 0.22, c: 0.06 },
    ]), M.armor, PA));
    place(head, P(frontPrism([[-0.34, 0.1], [0.34, 0.1], [0.3, -0.08], [-0.3, -0.08]], 0.1, 0.02), M.joint), 0, 0.22, 0.46, -0.12).userData.noOutline = true;
    for (const [x, r] of [[0, 0.075], [-0.17, 0.045], [0.17, 0.045], [-0.26, 0.03], [0.26, 0.03]]) {
      place(head, new THREE.Mesh(cylZ(r, r, 0.05, 14), M.lens), x, 0.22, 0.52);
      place(head, new THREE.Mesh(new THREE.SphereGeometry(r * 0.4, 8, 6), M.eye), x, 0.22, 0.55).userData.noOutline = true;
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x5fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.6 }));
    glow.scale.setScalar(0.34);
    glow.renderOrder = 6;
    place(head, glow, 0, 0.22, 0.58);
    // Antenna raked back off the cap, a copper ridge, a small dish
    const ant = place(head, P(new THREE.CylinderGeometry(0.012, 0.03, 1.4, 6), M.frame, PB), 0.28, 0.9, -0.42, -0.55, 0, -0.12);
    place(ant, P(chamferBox(0.06, 0.18, 0.04, 0.01), M.joint), 0, -0.4, 0);
    place(head, P(cylZ(0.14, 0.05, 0.08, 12), M.second, PB), -0.28, 0.46, -0.3, -0.6, 0, 0);
    place(head, P(chamferBox(0.18, 0.05, 0.6, 0.02), M.accent, PA), 0, 0.44, -0.04);
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.0, 0.74, 0.0);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(cylX(0.22, 0.3, 16), M.joint));
    // Shoulder block: a big flat slab over the joint, canted out, copper edged, with a vent and a port
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.26, 0.2, -0.02);
    pauldron.rotation.z = -s * 0.16;
    sh.add(pauldron);
    const slab = warp(chamferBox(0.6, 0.62, 1.3, 0.12, 0.04), (v, n) => {
      v.z *= 1 - 0.2 * n.y;   // narrower over the top
      v.y += 0.12 * n.z;      // its front raised
    });
    place(pauldron, P(slab, M.armor, PA));
    place(pauldron, P(chamferBox(0.64, 0.06, 0.08, 0.02), M.accent, PA), 0, 0.26, 0.64);
    place(pauldron, P(chamferBox(0.06, 0.06, 1.24, 0.02), M.accent, PA), s * 0.31, 0.24, 0.0);
    place(pauldron, P(chamferBox(0.04, 0.3, 0.5, 0.02), M.joint), s * 0.31, -0.06, 0.06);
    slats(pauldron, M.frame, 3, s * 0.33, -0.16, 0.06, [0, 0.1, 0], 0.03, 0.04, 0.44);
    port(this, pauldron, 0.08, 0, -0.32, -0.5, Math.PI / 2, 0, 0);
    // Upper arm: thin strut and shell with a light down the front
    place(sh, P(new THREE.CylinderGeometry(0.11, 0.11, 1.0, 10), M.joint), 0, -0.55, 0);
    place(sh, P(loft([{ y: -0.3, w: 0.3, d: 0.34, c: 0.08 }, { y: -0.92, w: 0.26, d: 0.32, c: 0.07 }]), M.armor, PA), s * 0.02, 0, 0);
    strip(sh, M.eye, 0.03, 0.26, 0.02, s * 0.02, -0.55, 0.18);

    const elbow = new THREE.Group();
    elbow.position.y = -1.08;
    sh.add(elbow);
    place(elbow, P(cylX(0.14, 0.34), M.joint));
    place(elbow, P(cylX(0.17, 0.08, 14), M.second, PB), s * 0.18, 0, 0);
    // Forearm: a slim armored shell with copper cuffs
    place(elbow, P(loft([
      { y: -0.04, w: 0.34, d: 0.42, c: 0.09 },
      { y: -0.55, w: 0.42, d: 0.52, c: 0.11, z: 0.02 },
      { y: -1.08, w: 0.38, d: 0.48, c: 0.1, z: 0.02 },
      { y: -1.2, w: 0.3, d: 0.38, c: 0.08 },
    ]), M.armor, PA));
    place(elbow, P(chamferBox(0.04, 0.5, 0.3, 0.03), M.joint), s * 0.22, -0.56, 0.02);
    for (const y of [-0.2, -1.0]) place(elbow, P(chamferBox(0.44, 0.05, 0.54, 0.02), M.accent, PA), 0, y, 0.02);
    this.pistons.push(new Piston(sh, new V3(0, -0.5, 0.2), elbow, new V3(0, -0.28, 0.26), 0.04, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.32, -0.55, 0.04);
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
    return { s, sh, pauldron, pauldronLag: 0.55, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 0.64, -0.9);
    this.chest.add(bp);
    // Slim booster pack under the back of the pod, the shoulder guns on a rail over it
    place(bp, P(loft([
      { y: 0.5, w: 0.86, d: 0.4, c: 0.1, z: -0.12 },
      { y: -0.1, w: 1.0, d: 0.52, c: 0.14, z: -0.18 },
      { y: -0.5, w: 0.78, d: 0.42, c: 0.12, z: -0.14 },
    ]), M.armor, { all: B.plainA, x: B.vent }));
    place(bp, P(frontPrism([[-0.3, 0.36], [0.3, 0.36], [0.34, -0.3], [0, -0.42], [-0.34, -0.3]], 0.08, 0.02), M.second, { all: B.mechA }), 0, 0.0, -0.46);
    strip(bp, M.eye, 0.03, 0.4, 0.02, 0, 0.0, -0.51);
    place(bp, P(chamferBox(1.9, 0.1, 0.3, 0.03), M.joint), 0, 0.5, -0.1);
    for (const [key, sd] of [['shoulderR', -1], ['shoulderL', 1]]) {
      place(bp, P(chamferBox(0.3, 0.14, 0.46, 0.04), M.second, PB), sd * 0.86, 0.6, -0.1);
      this.mount(key, bp, sd * 0.86, 0.68, -0.08);
    }
    for (const s of [-1, 1]) {
      const hx = s * 0.3;
      const dir = new V3(s * 0.08, -1, -0.5).normalize();
      const mountPos = new V3(hx, -0.56, -0.3);
      const ring = place(bp, P(new THREE.CylinderGeometry(0.24, 0.27, 0.1, 14), M.joint), mountPos.x, mountPos.y, mountPos.z);
      ring.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.3, this.glowTex, {
        actuators: [new V3(hx + 0.2, -0.45, -0.2), new V3(hx - 0.2, -0.45, -0.2)],
      }));
      // Raked stabilizer vane with a copper edge, and a vernier on each top corner
      const vane = new THREE.Group();
      vane.position.set(s * 0.4, 0.2, -0.32);
      vane.rotation.set(0.1, s * 0.3, -s * 0.62);
      bp.add(vane);
      place(vane, P(blade([[0.1, 0.0], [-0.3, 0.16], [-1.0, 0.56], [-0.96, 0.36], [-0.3, -0.14]], 0.06, [0.4, 1]), M.armor, PA));
      place(vane, P(blade([[-0.3, 0.17], [-0.96, 0.56], [-0.94, 0.5], [-0.3, 0.12]], 0.08, [0.4, 1]), M.accent, PA));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.46, 0.14, -0.42), new V3(s * 0.3, 0.05, -1), 0.12, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 18, 1.8);
    this.thrustLight.position.set(0, -1.4, -0.6);
    bp.add(this.thrustLight);
  }
}
