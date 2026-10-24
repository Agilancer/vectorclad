import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, warp, loftZ, mirror } from '../mech.js';
import { shell, dome, port, strip, slats } from './kit.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// HV-90 Goliath: a heavy brawler that stands like a gorilla, armored in
// layered dark plates edged in red. Stacked shoulder lames rise past its head,
// which sits low and forward between them behind a visor of blue eyes. A
// barrel chest around a glowing core; long, thick arms ending in layered
// gauntlets and big fists; short, wide legs on clawed feet. Two binders hang
// off its back over the main engines.
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

const PA = { all: B.plainA }, PB = { all: B.plainB };

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

  /** A red edge strip along a plate: a thin bar of accent from (x, y) at angle rz. */
  edge(parent, len, x, y, z, rz = 0, ry = 0, t = 0.05) {
    return place(parent, P(chamferBox(len, t, t, t * 0.3, 0.01), this.mats.accent, PA), x, y, z, 0, ry, rz);
  }

  buildPelvis() {
    const M = this.mats, p = this.pelvis;
    place(p, P(loft([
      { y: 0.36, w: 1.5, d: 1.2, c: 0.26 },
      { y: 0.04, w: 1.76, d: 1.34, c: 0.3 },
      { y: -0.36, w: 0.92, d: 0.9, c: 0.2 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.3, 2.1), M.joint), 0, -0.16, 0);
    // Layered codpiece: a dark keel over a red-edged plate
    place(p, P(frontPrism([[-0.5, 0.24], [0.5, 0.24], [0.34, -0.26], [0, -0.58], [-0.34, -0.26]], 0.2, 0.04), M.armor, PA), 0, 0.02, 0.66);
    place(p, P(frontPrism([[-0.36, 0.14], [0.36, 0.14], [0.22, -0.2], [0, -0.44], [-0.22, -0.2]], 0.08, 0.02), M.accent, PA), 0, 0.0, 0.78);
    place(p, P(frontPrism([[-0.22, 0.1], [0.22, 0.1], [0.12, -0.14], [0, -0.3], [-0.12, -0.14]], 0.06, 0.015), M.armor, PA), 0, 0.0, 0.84);
    // Front skirts: two sharp lames per side that lift with the thighs
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.6, 0.28, 0.66);
      g.rotation.set(-0.1, s * 0.3, 0);
      p.add(g);
      place(g, P(frontPrism(mirror([[-0.24, 0.06], [0.36, 0.06], [0.42, -0.5], [0.1, -0.86], [-0.2, -0.6]], s), 0.12, 0.03), M.armor, PA));
      place(g, P(frontPrism(mirror([[-0.16, -0.1], [0.3, -0.1], [0.34, -0.44], [0.08, -0.74], [-0.12, -0.52]], s), 0.06, 0.015), M.second, PB), 0, -0.04, 0.08);
      this.edge(g, 0.5, s * 0.06, -0.02, 0.12, 0);
      this.skirts.push({ g, leg: s < 0 ? 0 : 1, k: 0.7, x0: -0.1 });
    }
    place(p, P(frontPrism([[-0.72, 0.26], [0.72, 0.26], [0.5, -0.4], [0, -0.56], [-0.5, -0.4]], 0.16, 0.04), M.armor, PA), 0, 0.02, -0.68, 0.16);
    // Side skirts: layered blades swept back along the hips
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 1.0, 0.2, 0.05);
      g.rotation.z = s * 0.16;
      p.add(g);
      place(g, P(blade([[0.5, 0.14], [-0.5, 0.2], [-0.9, -0.1], [-0.56, -0.66], [0.36, -0.6]], 0.16, [0.5, 1]), M.armor, PA), s * 0.22, 0, 0);
      place(g, P(blade([[0.4, -0.16], [-0.46, -0.1], [-0.7, -0.3], [-0.46, -0.74], [0.3, -0.76]], 0.1, [0.5, 1]), M.second, PB), s * 0.32, 0, 0);
      this.edge(g, 0.9, s * 0.32, 0.12, -0.04, 0, Math.PI / 2);
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
    // Thick thigh under two overlapping outer plates and a front slab
    place(hip, P(loft([
      { y: -0.1, w: 0.96, d: 1.1, c: 0.24, z: 0.02 },
      { y: -0.7, w: 1.02, d: 1.18, c: 0.26, z: 0.06 },
      { y: -TH + 0.3, w: 0.76, d: 0.86, c: 0.2, z: 0.04 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    place(hip, P(frontPrism([[-0.4, -0.1], [0.4, -0.1], [0.42, -0.84], [0.0, -1.12], [-0.42, -0.84]], 0.14, 0.04), M.armor, PA), 0, 0, 0.6);
    place(hip, P(blade([[0.56, 0.06], [0.52, -0.6], [0.0, -0.84], [-0.56, -0.64], [-0.6, 0.0]], 0.12, [0.5, 1], [0.8, 1]), M.armor, PA), s * 0.52, 0, 0);
    place(hip, P(blade([[0.5, -0.5], [0.46, -0.96], [0.06, -1.2], [-0.5, -1.02], [-0.54, -0.6]], 0.12, [0.5, 1], [0.8, 1]), M.armor, PA), s * 0.6, 0, 0);
    this.edge(hip, 0.9, s * 0.67, -0.52, 0.0, 0.08, Math.PI / 2);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, P(cylX(0.36, 0.9), M.joint));
    // Knee shield: a pointed plate rising over the joint, a red chevron, and side guards
    place(knee, P(frontPrism([[-0.44, -0.3], [0.44, -0.3], [0.5, 0.2], [0.2, 0.6], [0, 0.72], [-0.2, 0.6], [-0.5, 0.2]], 0.22, 0.05), M.armor, PA), 0, 0.0, 0.56, -0.18);
    place(knee, P(frontPrism([[-0.26, 0.0], [0, 0.24], [0.26, 0.0], [0.26, -0.08], [0, 0.14], [-0.26, -0.08]], 0.06, 0.01), M.accent, PA), 0, 0.12, 0.69, -0.18);
    for (const sd of [-1, 1]) place(knee, P(blade([[0.36, 0.26], [0.0, 0.4], [-0.4, 0.2], [-0.3, -0.24], [0.3, -0.26]], 0.08, [1, 1]), M.armor, PA), sd * 0.5, 0, 0);
    // A white rounded cap over the top of the knee, split by a dark seam
    place(knee, P(dome(0.62, 0.62, 0.42, { back: 0.25, e: 2.4 }), M.white, PA), 0, 0.44, 0.6, -0.3);
    place(knee, P(chamferBox(0.04, 0.5, 0.1, 0.01), M.joint), 0, 0.44, 0.8, -0.3);
    for (const sd of [-1, 1]) this.pistons.push(new Piston(hip, new V3(sd * 0.3, -0.4, -0.45), knee, new V3(sd * 0.3, -0.5, -0.4), 0.09, M));

    // Greave: a wide calf block under two stepped front plates
    place(knee, P(loft([
      { y: -0.1, w: 0.98, d: 1.12, c: 0.24, z: -0.04 },
      { y: -0.75, w: 1.06, d: 1.26, c: 0.26, z: -0.1 },
      { y: -SH + 0.25, w: 0.8, d: 0.92, c: 0.2, z: -0.02 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    place(knee, P(frontPrism([[-0.46, -0.3], [0.46, -0.3], [0.48, -0.9], [0.0, -1.06], [-0.48, -0.9]], 0.16, 0.04), M.armor, PA), 0, 0, 0.6, 0.04);
    place(knee, P(frontPrism([[-0.42, -0.86], [0, -1.0], [0.42, -0.86], [0.34, -1.5], [-0.34, -1.5]], 0.16, 0.04), M.armor, PA), 0, 0, 0.56, 0.02);
    this.edge(knee, 0.7, 0, -0.98, 0.66, 0);
    for (const sd of [-1, 1]) {
      place(knee, P(blade([[0.5, -0.2], [0.4, -1.2], [-0.4, -1.4], [-0.62, -0.5], [-0.3, -0.1]], 0.12, [0.6, 1], [0.8, 1]), M.armor, PA), sd * 0.56, 0, 0);
      this.edge(knee, 0.8, sd * 0.63, -0.72, 0.04, 0.2, Math.PI / 2);
    }
    const bayY = -0.85;
    place(knee, P(chamferBox(0.6, 0.44, 0.1, 0.05), M.frame, { all: B.ventDark }), 0, bayY, -0.78);
    for (const x of [-0.15, 0.15]) port(this, knee, 0.12, x, bayY - 0.02, -0.82, Math.PI - 0.5, 0, 0, this.thrusters.calf);
    {
      const pivot = new THREE.Group();
      pivot.position.set(0, bayY + 0.3, -0.88);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.64, 0.22, 0.06, 0.04), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.11, 0);
      for (const t of this.thrusters.calf.slice(-2)) t.flaps.push({ pivot, open: 1.0 });
    }
    this.mount(s > 0 ? 'legL' : 'legR', knee, s * 0.64, -0.8, -0.06, 0, 0, -s * Math.PI / 2);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.32, 14, 10), M.joint));
    place(ankle, P(loft([{ y: 0.3, w: 0.7, d: 0.8, c: 0.16 }, { y: -0.2, w: 0.84, d: 0.96, c: 0.2 }]), M.armor, PA));
    // Clawed foot: a broad block, three toe claws with red tips, a heel spur
    place(ankle, P(loft([
      { y: -0.14, w: 0.92, d: 1.0, c: 0.2, z: 0.3 },
      { y: -0.6, w: 1.1, d: 1.3, c: 0.24, z: 0.34 },
    ]), M.second, { all: B.plainB }));
    for (const [x, ry] of [[-0.34, 0.16], [0, 0], [0.34, -0.16]]) {
      const toe = new THREE.Group();
      toe.position.set(x, -0.3, 0.86);
      toe.rotation.y = ry;
      ankle.add(toe);
      place(toe, P(blade([[-0.1, 0.12], [0.36, 0.0], [0.6, -0.26], [0.0, -0.3]], 0.28, [1, 0.4], [1, 0.7]), M.armor, PA));
      place(toe, P(blade([[0.42, -0.12], [0.62, -0.28], [0.42, -0.3]], 0.2, [1, 0.4]), M.accent, PA));
    }
    place(ankle, P(blade([[-0.3, 0.0], [-0.72, -0.3], [-0.8, -0.6], [-0.3, -0.6]], 0.6, [0.6, 1]), M.armor, PA));
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
    // Layered belly lames
    for (let i = 0; i < 3; i++) {
      place(waist, P(frontPrism([[-0.46 + i * 0.04, 0.1], [0.46 - i * 0.04, 0.1], [0.4 - i * 0.04, -0.1], [-0.4 + i * 0.04, -0.1]], 0.16, 0.03), i === 1 ? M.accent : M.armor, PA), 0, 0.44 - i * 0.2, 0.52 - i * 0.03, -0.12);
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
    // Pectoral armor in two layers sweeping up to the shoulders, edged in red
    for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, 0, 0.96);
      g.rotation.y = sd * 0.3;
      chest.add(g);
      place(g, P(frontPrism(mirror([[0.1, 0.24], [0.96, 0.4], [1.36, 0.96], [1.3, 1.66], [0.5, 1.8], [0.12, 1.5]], sd), 0.22, 0.04), M.armor, PA));
      place(g, P(frontPrism(mirror([[0.3, 0.9], [1.12, 1.04], [1.22, 1.5], [0.56, 1.62], [0.3, 1.4]], sd), 0.1, 0.02), M.armor, PA), 0, 0, 0.14);
      place(g, P(frontPrism(mirror([[0.16, 0.3], [0.94, 0.46], [0.98, 0.54], [0.18, 0.4]], sd), 0.04, 0.008), M.accent, PA), 0, 0, 0.12);
      place(g, P(frontPrism(mirror([[0.34, 0.92], [1.1, 1.06], [1.12, 1.12], [0.34, 1.0]], sd), 0.04, 0.008), M.accent, PA), 0, 0, 0.2);
      // Intake louvres under each plate
      place(chest, P(chamferBox(0.56, 0.34, 0.12, 0.05), M.joint), sd * 0.6, 0.32, 0.92, 0.2);
      slats(chest, M.frame, 3, sd * 0.6, 0.22, 0.98, [0, 0.1, 0.02], 0.5, 0.04, 0.05, 0.2);
    }
    // The core: a glowing lens in a dark chevron frame over the sternum
    place(chest, P(frontPrism([[-0.3, 0.28], [0.3, 0.28], [0.36, 0.9], [0, 1.18], [-0.36, 0.9]], 0.2, 0.04), M.second, PB), 0, 0, 1.08);
    place(chest, P(frontPrism([[-0.16, 0.6], [0.16, 0.6], [0.2, 0.86], [0, 1.0], [-0.2, 0.86]], 0.06, 0.01), M.eye), 0, 0, 1.19).userData.noOutline = true;
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x4fc6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.6 }));
    core.scale.setScalar(0.9);
    core.renderOrder = 6;
    place(chest, core, 0, 0.8, 1.24);
    this.coreGlow = core;
    // High collar plates that box the head in from the sides
    for (const sd of [-1, 1]) {
      place(chest, P(blade([[0.9, 1.3], [0.7, 1.9], [0.1, 2.16], [-0.5, 2.0], [-0.4, 1.4]], 0.22, [0.6, 1], [1, 0.6]), M.armor, PA), sd * 0.7, 0, 0.2, 0, 0, -sd * 0.1);
      this.edge(chest, 0.7, sd * 0.72, 2.02, 0.32, 0.3 * sd, Math.PI / 2 - 0.3, 0.04);
    }
    // Shoulder hardpoints high on the back, above the shoulder lames
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
      { z: 0.16, w: 0.76, h: 0.56, y: 0.24, c: 0.16 },
      { z: 0.46, w: 0.54, h: 0.38, y: 0.18, c: 0.1 },
    ]), M.armor, PA));
    // A sharp brow over a dark visor holding four blue eyes
    place(head, P(blade([[0.62, 0.44], [0.24, 0.62], [-0.3, 0.66], [-0.38, 0.46], [0.1, 0.4]], 0.72, [1, 0.5]), M.armor, PA));
    place(head, P(frontPrism([[-0.32, 0.08], [0.32, 0.08], [0.24, -0.08], [-0.24, -0.08]], 0.08, 0.015), M.joint), 0, 0.3, 0.48, -0.1).userData.noOutline = true;
    for (const sd of [-1, 1]) {
      for (const [x, y, w] of [[0.08, 0.32, 0.1], [0.2, 0.3, 0.08]]) {
        place(head, new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.02), M.eye), sd * x, y, 0.53, -0.1, -sd * 0.2, -sd * 0.12).userData.noOutline = true;
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x4fc6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.55 }));
      glow.scale.setScalar(0.32);
      glow.renderOrder = 6;
      place(head, glow, sd * 0.14, 0.31, 0.56);
    }
    // Layered jaw guard and cheek plates, a red crest blade over the crown
    place(head, P(loftZ([
      { z: -0.1, w: 0.64, h: 0.24, y: 0.0, c: 0.07 },
      { z: 0.52, w: 0.44, h: 0.2, y: 0.04, c: 0.06 },
    ]), M.second, PB));
    place(head, P(frontPrism([[-0.2, 0.06], [0.2, 0.06], [0.12, -0.08], [-0.12, -0.08]], 0.06, 0.01), M.accent, PA), 0, 0.06, 0.52);
    for (const sd of [-1, 1]) {
      place(head, P(blade([[0.36, 0.06], [0.1, 0.28], [-0.32, 0.38], [-0.4, 0.0], [0.0, -0.12]], 0.07, [1, 0.6]), M.armor, PA), sd * 0.4, 0.12, 0.0, 0, -sd * 0.14, 0);
    }
    place(head, P(blade([[0.36, 0.56], [0.1, 0.84], [-0.4, 0.96], [-0.2, 0.62]], 0.06, [0.6, 1], [1, 0.5]), M.accent, PA));
    // Antenna spikes raked back off the brow
    for (const [x, rz, h] of [[-0.12, 0.2, 1.1], [0.12, -0.2, 1.1], [0.26, -0.5, 0.7]]) {
      place(head, P(new THREE.ConeGeometry(0.035, h, 5), M.frame, PB), x, 0.6 + h * 0.4, -0.1, -0.5, 0, rz);
    }
    // Cables from the jaw down into the collar
    for (const sd of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new V3(sd * 0.26, 0.04, 0.24), new V3(sd * 0.42, -0.24, 0.1), new V3(sd * 0.5, -0.4, -0.3)]);
      place(head, P(new THREE.TubeGeometry(curve, 10, 0.045, 6), M.joint));
    }
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.72, 1.36, -0.1);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.48, 16, 12), M.joint));
    // Pauldron: a tall block peaking inward past the head, over three thin lames hung down the outside of the arm
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.3, 0.3, 0);
    sh.add(pauldron);
    place(pauldron, P(shell([
      { y: -0.32, w: 1.06, d: 1.44, x: s * 0.16 },
      { y: 0.2, w: 1.22, d: 1.6, x: s * 0.1, z: 0.04 },
      { y: 0.7, w: 1.02, d: 1.36, x: -s * 0.04, z: 0.1 },
      { y: 1.0, w: 0.6, d: 0.9, x: -s * 0.14, z: 0.12 },
    ], { e: 3.2, n: 24 }), M.armor, PA), s * 0.1, 0, -0.04);
    // A layered cap over the top, a lighter inner plate, white chevron marks on the face
    place(pauldron, P(shell([
      { y: 0.72, w: 1.1, d: 1.44, x: -s * 0.02, z: 0.1 },
      { y: 0.9, w: 0.86, d: 1.2, x: -s * 0.1, z: 0.12 },
    ], { e: 3.2 }), M.second, PB), s * 0.1, 0, -0.04);
    place(pauldron, P(chamferBox(0.5, 0.4, 0.06, 0.08), M.frame, PB), s * 0.1, 0.24, 0.8);
    for (const dy of [0.1, 0.3]) place(pauldron, P(frontPrism(mirror([[0.0, 0.0], [0.14, 0.1], [0.14, 0.04], [0.06, 0.0], [0.14, -0.04], [0.14, -0.1]], -s), 0.03, 0.006), M.white), s * 0.12, dy, 0.84);
    this.edge(pauldron, 0.7, s * 0.66, 0.66, 0.12, -s * 0.9, 0, 0.06);
    this.edge(pauldron, 0.9, s * 0.42, -0.24, 0.8, 0.04, 0, 0.05);
    for (let k = 0; k < 3; k++) {
      const g = new THREE.Group();
      g.position.set(s * (0.72 + k * 0.08), -0.2 - k * 0.3, 0);
      g.rotation.z = s * (0.12 + k * 0.08);
      pauldron.add(g);
      place(g, P(blade([[0.66, 0.1], [0.62, -0.32], [0.0, -0.44], [-0.62, -0.32], [-0.7, 0.1]], 0.1, [1, 1], [0.6, 1]), M.armor, PA));
      place(g, P(chamferBox(0.05, 0.05, 1.2, 0.012, 0.01), M.accent, PA), s * 0.04, -0.34, 0);
    }
    place(pauldron, P(chamferBox(1.0, 0.12, 1.36, 0.04), M.second, PB), s * 0.3, -0.36, 0.02);
    port(this, pauldron, 0.14, s * 0.3, -0.44, -0.3, Math.PI / 2, 0, 0);
    this.plate(pauldron, 'danger', 0.36, s * 0.82, 0.12, 0.2, 0, s * Math.PI / 2, -s * 0.5);

    // Thick upper arm
    place(sh, P(new THREE.CylinderGeometry(0.26, 0.26, 1.1, 12), M.joint), 0, -0.62, 0);
    place(sh, P(loft([{ y: -0.42, w: 0.74, d: 0.8, c: 0.18 }, { y: -1.12, w: 0.7, d: 0.76, c: 0.17 }]), M.second, PB), s * 0.04, 0, 0);
    place(sh, P(blade([[0.36, -0.4], [0.3, -1.0], [-0.2, -1.14], [-0.4, -0.5]], 0.1, [0.6, 1]), M.armor, PA), s * 0.4, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.3;
    sh.add(elbow);
    place(elbow, P(cylX(0.32, 0.76), M.joint));
    // Gauntlet: a huge forearm under layered outer plates, a red band at the cuff
    place(elbow, P(loft([
      { y: -0.04, w: 0.8, d: 0.9, c: 0.2, z: -0.02 },
      { y: -0.6, w: 1.0, d: 1.1, c: 0.25, z: 0.03 },
      { y: -1.24, w: 0.94, d: 1.02, c: 0.23, z: 0.03 },
      { y: -1.42, w: 0.72, d: 0.8, c: 0.18 },
    ]), M.second, PB));
    place(elbow, P(blade([[0.56, -0.1], [0.6, -0.8], [0.2, -1.0], [-0.5, -0.84], [-0.8, 0.24], [-0.4, 0.3]], 0.14, [0.5, 1]), M.armor, PA), s * 0.52, 0, 0);
    place(elbow, P(blade([[0.6, -0.7], [0.58, -1.24], [0.2, -1.44], [-0.5, -1.24], [-0.56, -0.8]], 0.14, [0.5, 1]), M.armor, PA), s * 0.58, 0, 0);
    place(elbow, P(frontPrism([[-0.42, 0.0], [0.42, 0.0], [0.46, -0.9], [0, -1.1], [-0.46, -0.9]], 0.14, 0.03), M.armor, PA), 0, -0.2, 0.56);
    this.edge(elbow, 1.0, s * 0.66, -0.76, 0.0, 0, Math.PI / 2);
    place(elbow, P(chamferBox(1.0, 0.08, 1.08, 0.04), M.accent, PA), 0, -1.26, 0.03);
    this.pistons.push(new Piston(sh, new V3(0, -0.5, 0.42), elbow, new V3(0, -0.4, 0.52), 0.09, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.62, -0.7, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.9);
    elbow.add(shieldMount);

    // Big fist under an armored knuckle guard
    const hand = new THREE.Group();
    hand.position.set(0, -1.5, 0.04);
    elbow.add(hand);
    place(hand, P(chamferBox(0.6, 0.5, 0.68, 0.12), M.joint), 0, -0.2, 0);
    place(hand, P(chamferBox(0.64, 0.26, 0.52, 0.08), M.armor, PA), 0, -0.48, 0.14, 0.4);
    for (const x of [-0.2, -0.07, 0.07, 0.2]) {
      place(hand, P(chamferBox(0.11, 0.2, 0.12, 0.03), M.frame, PB), x, -0.5, 0.38, 0.6);
      place(hand, P(chamferBox(0.1, 0.16, 0.1, 0.03), M.joint), x, -0.62, 0.26, 1.3);
      place(hand, P(chamferBox(0.08, 0.04, 0.08, 0.01), M.accent, PA), x, -0.38, 0.44);
    }
    place(hand, P(chamferBox(0.18, 0.38, 0.2, 0.05), M.joint), -s * 0.3, -0.3, 0.24, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.36, 0.04);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, pauldronLag: 0.5, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 1.0, -1.08);
    this.chest.add(bp);
    // Reactor block: an angular hull with a grilled hatch and a glowing seam
    place(bp, P(loft([
      { y: 0.8, w: 1.7, d: 0.7, c: 0.2, z: -0.26 },
      { y: 0.0, w: 1.96, d: 0.9, c: 0.26, z: -0.34 },
      { y: -0.7, w: 1.6, d: 0.76, c: 0.22, z: -0.3 },
    ]), M.armor, { all: B.plainA, x: B.vent }));
    place(bp, P(frontPrism([[-0.5, 0.6], [0.5, 0.6], [0.6, -0.3], [0, -0.6], [-0.6, -0.3]], 0.12, 0.03), M.second, { all: B.mechA }), 0, 0.1, -0.8);
    slats(bp, M.frame, 5, 0, -0.2, -0.88, [0, 0.14, 0], 0.7, 0.05, 0.05);
    strip(bp, M.eye, 0.04, 0.8, 0.02, 0, 0.12, -0.9);
    for (const s of [-1, 1]) {
      // Binder: a long armored wing hinged at the top corner of the pack, hanging down and out
      const hinge = new THREE.Group();
      hinge.position.set(s * 0.86, 0.66, -0.4);
      hinge.rotation.set(0.42, -s * 0.5, -s * 0.36);
      bp.add(hinge);
      place(hinge, P(cylX(0.2, 0.4), M.joint));
      place(hinge, P(frontPrism(mirror([[-0.36, 0.3], [0.4, 0.36], [0.56, -1.2], [0.3, -2.3], [0.0, -2.5], [-0.3, -1.6]], s), 0.16, 0.04), M.armor, PA), 0, 0, -0.12);
      place(hinge, P(frontPrism(mirror([[-0.24, 0.1], [0.3, 0.14], [0.42, -1.16], [0.2, -2.06], [-0.18, -1.5]], s), 0.06, 0.015), M.second, PB), 0, 0, -0.23);
      place(hinge, P(frontPrism(mirror([[0.42, 0.3], [0.5, 0.3], [0.66, -1.2], [0.4, -2.36], [0.32, -2.3], [0.56, -1.2]], s), 0.12, 0.01), M.accent, PA), 0, 0, -0.14);
      for (const y of [-0.6, -1.4]) port(this, hinge, 0.11, s * 0.04, y, -0.27, 0, Math.PI, 0);
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
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.94, 0.0, -0.62), new V3(s * 0.25, 0.05, -1), 0.2, this.glowTex));
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 26, 1.8);
    this.thrustLight.position.set(0, -2.0, -1.0);
    bp.add(this.thrustLight);
  }

  onAnimate(dt, st) {
    // The core breathes, and flares with the boost
    const th = st.thrust || { main: 0 };
    this.coreGlow.material.opacity = 0.45 + 0.12 * Math.sin(st.time * 2.2) + 0.4 * Math.min(1, th.main || 0);
  }
}
