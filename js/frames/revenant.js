import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, loftZ, mirror } from '../mech.js';
import { port, vfin, strip, slats } from './kit.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// KR-11 Revenant: a lancer-pattern medium in the orbital-sniper style. A white
// head with a gold V-fin, twin green eyes and a sensor mast; a broad chest of
// angular plates under a white collar, with gold intake louvres; a narrow
// gold mechanical waist; binder pods on the shoulders with vernier ports in
// their tails; layered front, side and rear skirts; pointed white knees,
// tall shins with calf ports; and a flight pack whose two binder wings sweep
// up and back over the shoulders.
// ---------------------------------------------------------------------------

const RIG = {
  leg: { hipDrop: 0.2, thigh: 1.85, shin: 2.45, foot: 0.6 },
  gait: { bodyH: 4.38, homeX: 1.12, dip: 0.2, sway: 0.13 },
  idleFeet: [[-1.14, -0.55], [1.2, 0.8]],
  pole: [0.5, 0.05, 1],
  hunch: 0.16, hunchIdle: 0.08, armOut: 0.26,
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
      { y: 0.24, w: 0.82, d: 0.72, c: 0.18 },
      { y: 0.0, w: 0.94, d: 0.8, c: 0.2 },
      { y: -0.28, w: 0.46, d: 0.56, c: 0.14 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.2, 1.6), M.joint), 0, -0.16, 0);
    // Crotch block: a white wedge with a red keel
    place(p, P(frontPrism([[-0.24, 0.2], [0.24, 0.2], [0.2, -0.14], [0, -0.42], [-0.2, -0.14]], 0.24, 0.035), M.accent, { all: B.plainA }), 0, 0, 0.38);
    place(p, P(frontPrism([[-0.06, 0.12], [0.06, 0.12], [0.06, -0.14], [0, -0.3], [-0.06, -0.14]], 0.06, 0.01), M.red), 0, 0, 0.51);
    // Front skirts hang over each thigh and lift with it
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.32, 0.14, 0.44);
      g.rotation.set(-0.06, s * 0.16, 0);
      p.add(g);
      place(g, P(frontPrism(mirror([[-0.2, 0.06], [0.28, 0.06], [0.32, -0.58], [0.16, -0.76], [-0.18, -0.66]], s), 0.12, 0.03), M.armor, { all: B.plainA }), 0, 0, 0.02);
      place(g, P(frontPrism(mirror([[-0.1, -0.06], [0.2, -0.06], [0.22, -0.48], [0.12, -0.6], [-0.1, -0.52]], s), 0.04, 0.01), M.accent, { all: B.plainA }), 0, 0, 0.09);
      place(g, P(chamferBox(0.36, 0.035, 0.04, 0.01), M.trim), s * 0.04, 0.0, 0.1);
      this.skirts.push({ g, leg: s < 0 ? 0 : 1, k: 0.7, x0: -0.06 });
    }
    // Rear skirt with a pair of vernier ports
    const rear = new THREE.Group();
    rear.position.set(0, 0.16, -0.44);
    rear.rotation.x = 0.22;
    p.add(rear);
    place(rear, P(frontPrism([[-0.5, 0.06], [0.5, 0.06], [0.44, -0.5], [0.0, -0.62], [-0.44, -0.5]], 0.14, 0.03), M.armor, { all: B.plainA }));
    for (const s of [-1, 1]) port(this, rear, 0.1, s * 0.22, -0.28, -0.08, 0, Math.PI, 0);
    // Side skirts: tall plates with a port and a gold edge
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.76, 0.16, 0.0);
      g.rotation.z = s * 0.2;
      p.add(g);
      place(g, P(blade([[0.36, 0.08], [-0.4, 0.08], [-0.46, -0.52], [-0.1, -0.74], [0.34, -0.6]], 0.1, [1, 1], [0.85, 1]), M.armor, { all: B.plainA }), s * 0.06, 0, 0);
      place(g, P(blade([[0.26, -0.04], [-0.3, -0.04], [-0.32, -0.46], [-0.06, -0.6], [0.24, -0.5]], 0.04, [1, 1]), M.accent, { all: B.plainA }), s * 0.12, 0, 0);
      place(g, P(chamferBox(0.04, 0.04, 0.78, 0.01), M.trim), s * 0.13, 0.04, -0.02);
      port(this, g, 0.08, s * 0.15, -0.36, -0.04, 0, s * Math.PI / 2, 0);
      return g;
    });
  }

  buildLeg(s) {
    const M = this.mats, { thigh: TH, shin: SH } = this.rig.leg;
    const hip = new THREE.Group();
    hip.position.set(s * 0.64, -this.rig.leg.hipDrop, 0);
    this.pelvis.add(hip);
    place(hip, P(new THREE.SphereGeometry(0.28, 16, 10), M.joint));
    place(hip, P(cylX(0.14, 0.08, 12), M.trim), s * 0.28, 0, 0);
    // Thigh: a dark shell over the frame, a white front plate and an outer armor slab
    place(hip, P(new THREE.CylinderGeometry(0.16, 0.18, TH - 0.2, 10), M.joint), 0, -TH / 2, -0.02);
    place(hip, P(loft([
      { y: -0.14, w: 0.64, d: 0.76, c: 0.2, z: 0.02 },
      { y: -0.8, w: 0.66, d: 0.8, c: 0.2, z: 0.05 },
      { y: -TH + 0.3, w: 0.48, d: 0.56, c: 0.15, z: 0.04 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    place(hip, P(frontPrism([[-0.26, -0.2], [0.26, -0.2], [0.28, -1.0], [0.0, -1.24], [-0.28, -1.0]], 0.1, 0.03), M.accent, { all: B.plainA }), 0, 0, 0.43);
    place(hip, P(blade([[0.36, -0.1], [0.3, -1.0], [-0.06, -1.24], [-0.38, -0.86], [-0.34, -0.12]], 0.1, [0.6, 1], [0.8, 1]), M.armor, { all: B.plainA }), s * 0.36, 0, 0);
    place(hip, P(chamferBox(0.05, 0.6, 0.04, 0.01), M.trim), s * 0.42, -0.6, 0.16);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, P(cylX(0.25, 0.6), M.joint));
    // Knee guard: a white pointed cop rising over the joint, a gold keel, and armored side plates
    place(knee, P(frontPrism([[-0.3, -0.28], [0.3, -0.28], [0.34, 0.08], [0.12, 0.5], [0.0, 0.62], [-0.12, 0.5], [-0.34, 0.08]], 0.2, 0.04), M.accent, { all: B.plainA }), 0, 0.0, 0.42, -0.12);
    place(knee, P(frontPrism([[-0.04, -0.2], [0.04, -0.2], [0.04, 0.36], [0, 0.46], [-0.04, 0.36]], 0.05, 0.01), M.trim), 0, 0.0, 0.53, -0.12);
    for (const sd of [-1, 1]) place(knee, P(blade([[0.3, 0.2], [0.0, 0.34], [-0.3, 0.18], [-0.2, -0.2], [0.24, -0.22]], 0.06, [1, 1]), M.second, { all: B.plainB }), sd * 0.34, 0, 0);
    this.pistons.push(new Piston(hip, new V3(s * 0.22, -0.5, -0.3), knee, new V3(s * 0.22, -0.45, -0.32), 0.06, M));

    // Shin: flared top, a long V-front plate, a wide calf with ports, pinched ankle
    place(knee, P(loft([
      { y: -0.06, w: 0.72, d: 0.86, c: 0.2, z: -0.06 },
      { y: -0.7, w: 0.74, d: 0.96, c: 0.22, z: -0.14 },
      { y: -1.5, w: 0.6, d: 0.74, c: 0.18, z: -0.08 },
      { y: -SH + 0.18, w: 0.48, d: 0.56, c: 0.14, z: 0 },
    ]), M.armor, { all: B.plainA, x: B.sideVents }));
    place(knee, P(frontPrism([[-0.3, -0.3], [0.3, -0.3], [0.3, -1.2], [0.2, -SH + 0.34], [0, -SH + 0.18], [-0.2, -SH + 0.34], [-0.3, -1.2]], 0.1, 0.03), M.armor, { all: B.plainA }), 0, 0, 0.45, 0.06);
    place(knee, P(frontPrism([[-0.14, -0.5], [0.14, -0.5], [0.0, -0.78]], 0.06, 0.01), M.accent, { all: B.plainA }), 0, 0, 0.51, 0.06);
    place(knee, P(chamferBox(0.04, 0.9, 0.04, 0.01), M.trim), s * 0.38, -1.0, 0.1);
    this.plate(knee, s > 0 ? 'redPlate' : 'r07', 0.18, s * 0.37, -0.62, -0.12, 0, s * Math.PI / 2);
    // Calf: two vernier ports under a pair of flaps that open when they fire
    const bayY = -1.15;
    place(knee, P(chamferBox(0.5, 0.56, 0.1, 0.06), M.second, { all: B.ventDark }), 0, bayY, -0.6);
    for (const x of [-0.12, 0.12]) port(this, knee, 0.11, x, bayY - 0.04, -0.62, Math.PI - 0.55, 0, 0, this.thrusters.calf);
    for (const [hy, open] of [[bayY + 0.3, 1.0]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, hy, -0.66);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.52, 0.2, 0.05, 0.03), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.1, 0);
      for (const t of this.thrusters.calf.slice(-2)) t.flaps.push({ pivot, open });
    }
    this.mount(s > 0 ? 'legL' : 'legR', knee, s * 0.4, -1.0, -0.08, 0, 0, -s * Math.PI / 2);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.22, 14, 10), M.joint));
    // Ankle guard and a pointed foot: dark sole block, white toe cap, red toe tip, a heel spur
    place(ankle, P(loft([{ y: 0.36, w: 0.5, d: 0.6, c: 0.13 }, { y: -0.08, w: 0.6, d: 0.7, c: 0.15 }]), M.armor, { all: B.plainA }), 0, 0, -0.02);
    place(ankle, P(loft([
      { y: -0.2, w: 0.56, d: 1.36, c: 0.14, z: 0.2 },
      { y: -0.52, w: 0.62, d: 1.5, c: 0.16, z: 0.24 },
    ]), M.second, { all: B.plainB }));
    place(ankle, P(blade([[0.24, -0.16], [0.6, -0.26], [1.02, -0.46], [1.0, -0.56], [0.24, -0.56]], 0.5, [1, 0.35], [1, 0.7]), M.accent, { all: B.plainA, y: B.plainB }), 0, 0, 0);
    place(ankle, P(blade([[0.86, -0.38], [1.06, -0.5], [1.06, -0.57], [0.86, -0.57]], 0.24, [1, 0.5]), M.red), 0, 0, 0);
    place(ankle, P(blade([[-0.2, -0.1], [-0.56, -0.36], [-0.66, -0.58], [-0.2, -0.58]], 0.36, [0.6, 1]), M.armor, { all: B.plainA }), 0, 0, 0);
    place(ankle, P(chamferBox(0.6, 0.05, 1.7, 0.02), M.joint), 0, -0.585, 0.22);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.42, -0.1), new V3(0, -1, -0.15), 0.15, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.3;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Mechanical waist: stacked gold collars on a spine, with rams on either side
    place(waist, P(new THREE.CylinderGeometry(0.26, 0.3, 0.74, 12), M.joint), 0, 0.22, -0.04);
    for (const [y, w] of [[0.02, 0.76], [0.2, 0.62], [0.38, 0.7]]) {
      place(waist, P(loft([{ y: y + 0.07, w, d: w * 0.74, c: 0.12 }, { y: y - 0.07, w: w * 0.94, d: w * 0.7, c: 0.12 }]), M.trim), 0, 0, -0.02);
    }
    for (const sd of [-1, 1]) {
      place(waist, P(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), M.frame, { all: B.plainB }), sd * 0.4, 0.2, 0.12, 0, 0, sd * 0.12);
      place(waist, P(chamferBox(0.12, 0.3, 0.3, 0.04), M.second, { all: B.plainB }), sd * 0.4, 0.2, -0.12);
    }
    place(waist, P(chamferBox(0.34, 0.22, 0.12, 0.05), M.accent, { all: B.plainA }), 0, 0.22, 0.32, -0.06);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.5;
    waist.add(chest);
    // Chest core, broad over the shoulders
    place(chest, P(loft([
      { y: 0.0, w: 1.0, d: 0.8, c: 0.2, z: -0.06 },
      { y: 0.6, w: 1.9, d: 1.24, c: 0.32, z: -0.06 },
      { y: 1.12, w: 2.12, d: 1.28, c: 0.34, z: -0.1 },
      { y: 1.4, w: 1.4, d: 1.0, c: 0.26, z: -0.16 },
    ]), M.second, { all: B.plainB, x: B.sideVents }));
    // Breastplates: angular blocks meeting at the sternum, each with an intake of gold louvres
    for (const sd of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, 0, 0.58);
      g.rotation.y = sd * 0.24;
      chest.add(g);
      place(g, P(frontPrism(mirror([[0.05, 0.26], [0.82, 0.46], [1.04, 0.86], [1.0, 1.3], [0.36, 1.38], [0.05, 1.22]], sd), 0.22, 0.04), M.armor, { all: B.plainA }));
      place(g, P(chamferBox(0.46, 0.34, 0.08, 0.06), M.joint), sd * 0.6, 0.9, 0.1);
      for (let k = 0; k < 4; k++) place(g, P(chamferBox(0.42, 0.04, 0.06, 0.01), M.trim), sd * 0.6, 0.78 + k * 0.08, 0.14, -0.35);
      place(g, P(frontPrism(mirror([[0.1, 0.32], [0.8, 0.5], [0.82, 0.55], [0.1, 0.38]], sd), 0.03, 0.006), M.trim), 0, 0, 0.12);
    }
    // Sternum keel, the cockpit hatch and a light
    place(chest, P(blade([[0.0, 0.18], [0.18, 0.42], [0.16, 1.14], [0.0, 1.3]], 0.16, [1, 0.4]), M.accent, { all: B.plainA }), 0, 0, 0.66);
    strip(chest, M.eye, 0.05, 0.22, 0.02, 0, 0.62, 0.86);
    // White collar around the neck, rising to two points at the shoulders
    place(chest, P(frontPrism([[-0.7, 1.26], [0.7, 1.26], [0.6, 1.56], [0.24, 1.48], [0, 1.34], [-0.24, 1.48], [-0.6, 1.56]], 0.56, 0.04), M.accent, { all: B.plainA }), 0, 0, 0.3);
    // Lower-chest chevron
    place(chest, P(frontPrism([[-0.52, 0.34], [0.52, 0.34], [0.0, 0.04]], 0.1, 0.02), M.accent, { all: B.plainA }), 0, 0, 0.66, 0.06);
    // Flank louvres
    for (const sd of [-1, 1]) slats(chest, M.joint, 4, sd * 1.0, 0.78, 0.1, [0, 0, -0.12], 0.08, 0.34, 0.04);
    this.plate(chest, 'e07', 0.36, 0, 0.64, -0.72, 0, Math.PI);
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.44, 0.3);
    head.scale.setScalar(1.05);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.15, 0.2, 0.36, 10), M.joint), 0, 0.04, -0.06);
    // Helmet: a white faceted block narrowing to the face
    place(head, P(loftZ([
      { z: -0.3, w: 0.48, h: 0.5, y: 0.34, c: 0.16 },
      { z: 0.06, w: 0.54, h: 0.56, y: 0.36, c: 0.16 },
      { z: 0.3, w: 0.42, h: 0.46, y: 0.32, c: 0.12 },
    ]), M.accent, { all: B.plainA }));
    // Faceplate with the twin eyes under the brow
    place(head, P(frontPrism([[-0.18, 0.18], [0.18, 0.18], [0.2, 0.42], [-0.2, 0.42]], 0.06, 0.01), M.joint), 0, 0, 0.31).userData.noOutline = true;
    for (const sd of [-1, 1]) {
      place(head, P(frontPrism(mirror([[0.02, 0.33], [0.17, 0.35], [0.19, 0.41], [0.03, 0.38]], sd), 0.02, 0.004), M.eye), 0, 0, 0.345).userData.noOutline = true;
    }
    place(head, P(frontPrism([[-0.24, 0.42], [0.24, 0.42], [0.2, 0.5], [0.0, 0.53], [-0.2, 0.5]], 0.14, 0.02), M.accent, { all: B.plainA }), 0, 0, 0.3);
    // Red chin and the mouth vents
    place(head, P(frontPrism([[-0.12, 0.14], [0.12, 0.14], [0.08, 0.06], [-0.08, 0.06]], 0.1, 0.015), M.red), 0, 0, 0.32);
    for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) place(head, P(chamferBox(0.016, 0.08, 0.02, 0.004), M.frame, { all: B.plainB }), sd * (0.04 + k * 0.045), 0.25, 0.35);
    // Gold V-fin on the forehead and a sensor mast off the left temple
    vfin(this, head, 0.5, 0, 0.5, 0.31, M.trim, { rise: 0.5, sweep: 0.16 });
    place(head, P(new THREE.CylinderGeometry(0.018, 0.026, 0.7, 6), M.frame, { all: B.plainB }), 0.24, 0.72, -0.08, -0.2, 0, -0.12);
    place(head, P(chamferBox(0.07, 0.16, 0.12, 0.02), M.second, { all: B.plainB }), 0.27, 0.42, -0.06);
    // Cheek guards and a rear crest
    for (const sd of [-1, 1]) {
      place(head, P(blade([[0.32, 0.12], [0.04, 0.12], [-0.22, 0.2], [-0.24, 0.42], [0.1, 0.38], [0.3, 0.26]], 0.05, [1, 0.7]), M.accent, { all: B.plainA }), sd * 0.27, 0, 0, 0, -sd * 0.08, 0);
      place(head, P(chamferBox(0.02, 0.12, 0.14, 0.004), M.red), sd * 0.3, 0.28, -0.02);
    }
    place(head, P(blade([[-0.1, 0.56], [-0.38, 0.7], [-0.46, 0.6], [-0.3, 0.46]], 0.06, [1, 0.6]), M.accent, { all: B.plainA }));
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.32, 1.02, -0.04);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.3, 14, 10), M.joint));
    // Binder pod: a broad armored block over the shoulder whose tail carries two vernier ports
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.26, 0.2, -0.06);
    sh.add(pauldron);
    place(pauldron, P(blade([[0.5, -0.26], [0.52, 0.08], [0.3, 0.34], [-0.5, 0.42], [-0.84, 0.3], [-0.84, -0.24], [-0.5, -0.38]], 0.86, [1, 0.88], [0.78, 1]), M.armor, { all: B.plainA, z: B.plainB }), s * 0.06, 0, -0.04);
    // Outer face: a white inset under a gold edge, and a raised fin along the top
    place(pauldron, P(blade([[0.36, -0.18], [0.38, 0.06], [0.2, 0.24], [-0.56, 0.3], [-0.7, 0.2], [-0.7, -0.14], [-0.46, -0.24]], 0.04, [1, 1]), M.accent, { all: B.plainA }), s * 0.47, 0, -0.04);
    place(pauldron, P(chamferBox(0.05, 0.05, 1.08, 0.012), M.trim), s * 0.46, 0.33, -0.18, -0.08);
    place(pauldron, P(blade([[0.32, 0.3], [0.1, 0.5], [-0.62, 0.58], [-0.8, 0.36]], 0.12, [1, 0.6], [1, 0.4]), M.armor, { all: B.plainA }), s * 0.22, 0, -0.04);
    for (const y of [0.14, -0.14]) port(this, pauldron, 0.12, s * 0.06, y, -0.87, 0, Math.PI, 0);
    port(this, pauldron, 0.09, s * 0.08, -0.38, -0.36, Math.PI / 2, 0, 0);

    // Upper arm: frame inside a grey sleeve
    place(sh, P(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 10), M.joint), 0, -0.5, 0);
    place(sh, P(loft([{ y: -0.34, w: 0.44, d: 0.5, c: 0.12 }, { y: -0.86, w: 0.46, d: 0.52, c: 0.12 }]), M.frame, { all: B.plainB }), s * 0.02, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.0;
    sh.add(elbow);
    place(elbow, P(cylX(0.2, 0.5), M.joint));
    place(elbow, P(blade([[0.06, 0.26], [-0.34, 0.16], [-0.48, -0.06], [-0.12, -0.24]], 0.38, [0.6, 1]), M.second, { all: B.plainB }), 0, 0, 0);
    // Forearm: an armored gauntlet flaring to the wrist, with a white panel and a swept blade fin
    place(elbow, P(loft([
      { y: -0.04, w: 0.48, d: 0.54, c: 0.12, z: -0.02 },
      { y: -0.62, w: 0.58, d: 0.66, c: 0.15, z: 0.0 },
      { y: -0.96, w: 0.64, d: 0.72, c: 0.17, z: 0.02 },
      { y: -1.16, w: 0.5, d: 0.58, c: 0.13 },
    ]), M.armor, { all: B.plainA }));
    place(elbow, P(frontPrism([[-0.18, -0.2], [0.18, -0.2], [0.22, -0.84], [-0.22, -0.84]], 0.06, 0.015), M.accent, { all: B.plainA }), 0, 0, 0.33);
    place(elbow, P(blade([[0.24, -0.86], [-0.1, -0.7], [-0.52, -0.06], [-0.36, -0.02], [0.06, -0.52], [0.3, -0.62]], 0.06, [0.4, 1]), M.accent, { all: B.plainA }), s * 0.33, 0, 0);
    place(elbow, P(chamferBox(0.68, 0.05, 0.76, 0.03), M.trim), 0, -0.94, 0.02);
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
    place(hand, P(chamferBox(0.37, 0.16, 0.46, 0.05), M.second, { all: B.plainB }), 0, -0.36, 0.06, 0.35);
    place(hand, P(chamferBox(0.11, 0.26, 0.13, 0.03), M.joint), -s * 0.18, -0.23, 0.18, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.26, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, pauldronLag: 0.45, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 0.72, -0.66);
    this.chest.add(bp);
    // Flight pack: an angular core with an armored lid
    place(bp, P(loft([
      { y: 0.6, w: 1.0, d: 0.42, c: 0.12, z: -0.18 },
      { y: 0.0, w: 1.2, d: 0.6, c: 0.16, z: -0.24 },
      { y: -0.5, w: 0.9, d: 0.5, c: 0.14, z: -0.22 },
    ]), M.second, { all: B.plainB, x: B.vent }));
    place(bp, P(frontPrism([[-0.44, 0.5], [0.44, 0.5], [0.36, -0.36], [0, -0.5], [-0.36, -0.36]], 0.08, 0.02), M.armor, { all: B.plainA }), 0, 0.06, -0.54);
    place(bp, P(chamferBox(0.05, 0.6, 0.04, 0.01), M.trim), 0, 0.1, -0.6);
    for (const s of [-1, 1]) {
      // Binder wing: a long blade raked up and back over the shoulder, with a white leading edge
      const wing = new THREE.Group();
      wing.position.set(s * 0.46, 0.42, -0.42);
      wing.rotation.set(-0.36, s * 0.38, -s * 0.56);
      bp.add(wing);
      place(wing, P(blade([[0.2, -0.36], [0.12, 0.4], [-0.26, 1.7], [-0.62, 1.84], [-0.98, 0.9], [-0.86, 0.1], [-0.4, -0.44]], 0.12, [0.5, 1], [0.7, 1]), M.armor, { all: B.plainA }));
      place(wing, P(blade([[0.18, 0.3], [-0.22, 1.64], [-0.3, 1.66], [0.08, 0.3]], 0.15, [0.6, 1]), M.accent, { all: B.plainA }));
      place(wing, P(blade([[-0.62, 0.1], [-0.6, 1.3], [-0.66, 1.3], [-0.68, 0.1]], 0.14, [1, 1]), M.trim));
      for (const y of [1.0, 0.6, 0.2]) port(this, wing, 0.08, s * 0.07, y, -0.36, 0, s * Math.PI / 2, 0);

      // Main thruster under the wing root
      const hx = s * 0.38;
      place(bp, P(loft([
        { y: -0.16, w: 0.5, d: 0.62, c: 0.14, z: -0.34 },
        { y: -0.62, w: 0.54, d: 0.66, c: 0.15, z: -0.4 },
      ]), M.armor, { x: B.hot, all: B.plainA }), hx, 0, 0);
      const dir = new V3(0, -1, -0.45).normalize();
      const mountPos = new V3(hx, -0.66, -0.56);
      const ring = place(bp, P(new THREE.CylinderGeometry(0.32, 0.36, 0.12, 16), M.joint), mountPos.x, mountPos.y, mountPos.z);
      ring.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.4, this.glowTex, {
        actuators: [new V3(hx + 0.28, -0.5, -0.46), new V3(hx - 0.28, -0.5, -0.46), new V3(hx, -0.52, -0.76)],
      }));
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 0.62, 0.1, -0.42), new V3(s * 0.25, 0.05, -1), 0.14, this.glowTex));
      // Shoulder hardpoint on a saddle at the wing root
      place(bp, P(chamferBox(0.46, 0.12, 0.56, 0.04), M.joint), s * 0.84, 0.58, -0.3);
      this.mount(s > 0 ? 'shoulderL' : 'shoulderR', bp, s * 0.84, 0.64, -0.3, -0.12);
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 22, 1.8);
    this.thrustLight.position.set(0, -1.6, -0.9);
    bp.add(this.thrustLight);
  }
}
