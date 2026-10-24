import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, cylZ, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, mirror } from '../mech.js';
import { shell, dome, port, strip, slats } from './kit.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// TK-40 Bastion: a commander-pattern heavy in swollen, rounded armor. A small
// crested helm with a mono-eye sunk in a high collar; a barrel chest with
// rounded breast blocks and intake ports; shoulder pods bigger than the head,
// ringed in white and studded with verniers; rounded skirts; massive bulging
// shins with ports down their flanks; and a funnel rack on its back under
// the weapons deck that carries the biggest guns in the bay.
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
  hunch: 0.1, hunchIdle: 0.04, armOut: 0.34,
};

/** A white band hugging a rounded part at height y: w × d around, h tall. */
const band = (w, d, h, e = 2.8) => shell([{ y: -h / 2, w, d, e }, { y: h / 2, w, d, e }], { n: 24 });
const PA = { all: B.plainA }, PB = { all: B.plainB };

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
    place(p, P(shell([
      { y: -0.44, w: 0.9, d: 0.9 },
      { y: -0.1, w: 1.8, d: 1.36 },
      { y: 0.2, w: 1.9, d: 1.4 },
      { y: 0.4, w: 1.6, d: 1.2 },
    ], { e: 3 }), M.second, { all: B.mechA }));
    place(p, P(cylX(0.32, 2.2), M.joint), 0, -0.18, 0);
    // Rounded crotch block with a white chevron
    place(p, P(dome(0.7, 0.8, 0.5, { back: 0.3, e: 2.6 }), M.second, { all: B.plainB }), 0, -0.2, 0.58);
    place(p, P(frontPrism([[-0.26, 0.1], [0, -0.18], [0.26, 0.1], [0.26, 0.02], [0, -0.26], [-0.26, 0.02]], 0.08, 0.01), M.accent, { all: B.plainA }), 0, -0.1, 0.82);
    // Front skirts: big rounded plates with a white stripe and a port, lifted by the thighs
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.5, 0.3, 0.72);
      g.rotation.set(-0.08, s * 0.2, 0);
      p.add(g);
      place(g, P(shell([
        { y: -0.92, w: 0.4, d: 0.14, x: s * 0.06 },
        { y: -0.78, w: 0.7, d: 0.22, x: s * 0.04 },
        { y: -0.3, w: 0.8, d: 0.26 },
        { y: 0.06, w: 0.76, d: 0.22 },
      ], { e: 3.2 }), M.armor, { all: B.plainA }), 0, 0, 0.06);
      for (const dx of [0.2, 0.28]) place(g, P(chamferBox(0.035, 0.76, 0.05, 0.01), M.accent, PA), s * dx, -0.36, 0.18);
      port(this, g, 0.11, -s * 0.05, -0.5, 0.16, 0, 0, 0, null, 0.08);
      this.skirts.push({ g, leg: s < 0 ? 0 : 1, k: 0.75, x0: -0.08 });
    }
    // Rear skirt, rounded, with twin ports
    place(p, P(shell([
      { y: -0.62, w: 1.0, d: 0.2 },
      { y: -0.2, w: 1.5, d: 0.3 },
      { y: 0.3, w: 1.4, d: 0.26 },
    ], { e: 3 }), M.armor, { all: B.plainA }), 0, 0.0, -0.76, 0.14);
    for (const s of [-1, 1]) port(this, p, 0.13, s * 0.36, -0.2, -0.93, 0.14, Math.PI, 0);
    // Side skirts: swollen slabs with a pair of ports and a white rim
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 1.06, 0.22, 0.0);
      g.rotation.z = s * 0.1;
      p.add(g);
      place(g, P(shell([
        { y: -1.0, w: 0.2, d: 0.9 },
        { y: -0.8, w: 0.34, d: 1.24 },
        { y: -0.1, w: 0.36, d: 1.34 },
        { y: 0.12, w: 0.28, d: 1.1 },
      ], { e: 3.2 }), M.armor, { all: B.plainA }), s * 0.16, 0, 0);
      for (const dy of [-0.08, -0.16]) place(g, P(chamferBox(0.06, 0.035, 1.2, 0.01), M.accent, PA), s * 0.32, dy, 0);
      for (const z of [-0.26, 0.26]) port(this, g, 0.1, s * 0.31, -0.5, z, 0, s * Math.PI / 2, 0, null, 0.08);
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
    place(hip, P(new THREE.SphereGeometry(0.44, 16, 12), M.joint));
    // Thigh: a dark rounded core with a red armor shell over its front and outside
    place(hip, P(shell([
      { y: -0.1, w: 0.84, d: 0.92 },
      { y: -0.8, w: 0.9, d: 0.98 },
      { y: -TH + 0.24, w: 0.74, d: 0.82 },
    ], { e: 2.8 }), M.second, { all: B.plainB }));
    place(hip, P(shell([
      { y: -0.2, w: 0.82, d: 0.5, z: 0.3, x: s * 0.06 },
      { y: -0.86, w: 0.96, d: 0.6, z: 0.3, x: s * 0.06 },
      { y: -TH + 0.4, w: 0.8, d: 0.46, z: 0.32, x: s * 0.04 },
    ], { e: 3 }), M.armor, { all: B.plainA }));
    for (const dx of [0.26, 0.33]) place(hip, P(chamferBox(0.035, 0.7, 0.05, 0.01), M.accent, PA), s * dx, -0.86, 0.6);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, P(cylX(0.38, 1.0), M.joint));
    // Rounded knee cap with a white boss
    place(knee, P(dome(0.86, 0.86, 0.6, { back: 0.25 }), M.armor, { all: B.plainA }), 0, 0.06, 0.46);
    port(this, knee, 0.2, 0, 0.06, 0.62, 0, 0, 0, null, 0.14);
    for (const x of [-0.27, 0.27]) place(knee, P(chamferBox(0.06, 0.5, 0.1, 0.02), M.accent, PA), x, 0.06, 0.74);
    for (const x of [-0.34, 0.34]) place(knee, P(cylX(0.16, 0.2, 14), M.frame, PB), x, -0.1, -0.36);
    for (const x of [-0.32, 0.32]) this.pistons.push(new Piston(hip, new V3(x, -0.4, -0.4), knee, new V3(x, -0.7, -0.5), 0.08, M));

    // Shin: a swollen red bulk, widest over the calf, with a white band, flank ports and calf thrusters
    place(knee, P(shell([
      { y: 0.0, w: 0.92, d: 1.0, z: -0.04 },
      { y: -0.5, w: 1.18, d: 1.3, z: -0.1 },
      { y: -1.1, w: 1.26, d: 1.4, z: -0.12 },
      { y: -1.6, w: 1.08, d: 1.18, z: -0.06 },
      { y: -SH + 0.12, w: 0.86, d: 0.94 },
    ], { e: 2.7, n: 24 }), M.armor, { all: B.plainA }));
    for (const y of [-1.04, -1.16]) place(knee, P(band(1.3, 1.44, 0.04), M.accent, PA), 0, y, -0.12);
    place(knee, P(frontPrism([[-0.3, 0.0], [0.3, 0.0], [0.22, -0.8], [0, -0.98], [-0.22, -0.8]], 0.16, 0.03), M.armor, { all: B.plainA }), 0, -0.3, 0.62, 0.1);
    place(knee, P(chamferBox(0.08, 0.7, 0.05, 0.02), M.accent, { all: B.plainA }), 0, -0.62, 0.72, 0.1);
    for (const [y, z] of [[-0.66, 0.24], [-0.66, -0.24], [-1.4, 0.0]]) port(this, knee, 0.12, s * 0.6, y, z - 0.1, 0, s * Math.PI / 2, 0, null, 0.08);
    const bayY = -0.95;
    for (const x of [-0.24, 0.24]) port(this, knee, 0.16, x, bayY, -0.8, Math.PI - 0.5, 0, 0, this.thrusters.calf);
    this.mount(s > 0 ? 'legL' : 'legR', knee, s * 0.66, -0.9, -0.06, 0, 0, -s * Math.PI / 2);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.36, 14, 10), M.joint));
    // Foot: a dark grey mechanical hood over a broad sole, with white tube loops and a red toe guard
    place(ankle, P(shell([
      { y: 0.2, w: 0.8, d: 0.9, z: 0.05 },
      { y: -0.34, w: 1.1, d: 1.5, z: 0.22 },
      { y: -0.5, w: 1.16, d: 1.7, z: 0.26 },
    ], { e: 3.2 }), M.frame, PB));
    for (const sd of [-1, 1]) {
      place(ankle, P(new THREE.TorusGeometry(0.26, 0.05, 6, 14, Math.PI), M.accent, PA), sd * 0.6, -0.42, 0.3, 0, sd * Math.PI / 2, 0);
      slats(ankle, M.joint, 3, sd * 0.56, -0.2, -0.3, [0, 0, 0.14], 0.04, 0.2, 0.06);
    }
    place(ankle, P(shell([
      { y: -0.5, w: 1.24, d: 1.9, z: 0.24 },
      { y: -0.7, w: 1.3, d: 2.0, z: 0.24 },
    ], { e: 4 }), M.second, { all: B.plainB }));
    place(ankle, P(dome(0.9, 0.4, 0.5, { back: 0.3 }), M.armor, PA), 0, -0.46, 1.1);
    place(ankle, P(chamferBox(1.3, 0.05, 2.0, 0.02), M.joint), 0, -0.7, 0.24);
    this.thrusters.sole.push(new Thruster(ankle, new V3(0, -0.5, 0.0), new V3(0, -1, -0.1), 0.22, this.glowTex));

    return { s, hip, knee, ankle };
  }

  buildTorso() {
    const M = this.mats;
    const waist = (this.waist = new THREE.Group());
    waist.position.y = 0.36;
    waist.rotation.order = 'YXZ';
    this.body.add(waist);
    // Waist: a dark rounded drum with a gold band and a front armor tile
    place(waist, P(shell([{ y: -0.05, w: 1.5, d: 1.2 }, { y: 0.5, w: 1.4, d: 1.1 }], { e: 3 }), M.second, { all: B.plainB }));
    place(waist, P(band(1.52, 1.22, 0.08, 3), M.trim), 0, 0.24, 0);
    place(waist, P(cylZ(0.3, 0.3, 0.14, 22), M.frame, PB), 0, 0.22, 0.6);
    place(waist, P(cylZ(0.22, 0.22, 0.06, 20), M.second, PB), 0, 0.22, 0.68);
    for (let k = 0; k < 6; k++) place(waist, P(chamferBox(0.05, 0.12, 0.04, 0.01), M.joint), Math.cos(k * 1.05) * 0.26, 0.22 + Math.sin(k * 1.05) * 0.26, 0.68, 0, 0, k * 1.05 + Math.PI / 2);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.48;
    waist.add(chest);
    // Barrel chest
    place(chest, P(shell([
      { y: 0.0, w: 1.8, d: 1.4, z: -0.05 },
      { y: 0.6, w: 2.4, d: 1.8, z: -0.05 },
      { y: 1.4, w: 2.7, d: 1.96, z: -0.08 },
      { y: 2.0, w: 2.5, d: 1.84, z: -0.12 },
      { y: 2.32, w: 1.7, d: 1.3, z: -0.16 },
    ], { e: 2.8, n: 24 }), M.armor, { all: B.plainA, x: B.sideVents }));
    // Dark center: the cockpit block between the breast domes, with a white keel stripe
    place(chest, P(frontPrism([[-0.36, 0.2], [0.36, 0.2], [0.42, 1.2], [0.28, 1.7], [-0.28, 1.7], [-0.42, 1.2]], 0.2, 0.05), M.frame, PB), 0, 0, 0.86);
    for (const dx of [-0.05, 0.05]) place(chest, P(chamferBox(0.035, 1.0, 0.05, 0.01), M.accent, PA), dx, 1.0, 0.97);
    for (const sd of [-1, 1]) {
      port(this, chest, 0.15, sd * 0.36, 0.42, 0.86, 0.2, sd * 0.2, 0, null, 0.14);
      place(chest, P(frontPrism([[-0.22, -0.22], [0.22, -0.22], [0.22, -0.14], [-0.14, -0.14], [-0.14, 0.22], [-0.22, 0.22]].map(([x, y]) => [x * sd, y]), 0.06, 0.01), M.accent, PA), sd * 0.36, 0.42, 0.98, 0.2, sd * 0.2, 0);
    }
    // Breast domes with intake grilles and white rims
    for (const sd of [-1, 1]) {
      place(chest, P(dome(1.06, 0.96, 0.66, { back: 0.15, e: 2.5 }), M.armor, { all: B.plainA }), sd * 0.82, 1.42, 0.7, 0, sd * 0.3, 0);
      const grill = new THREE.Group();
      grill.position.set(sd * 0.9, 1.36, 1.0);
      grill.rotation.y = sd * 0.34;
      chest.add(grill);
      place(grill, P(shell([{ y: -0.04, w: 0.58, d: 0.4 }, { y: 0.04, w: 0.58, d: 0.4 }], { e: 2.2 }), M.joint), 0, 0, 0, Math.PI / 2, 0, 0);
      slats(grill, M.port, 4, 0, -0.12, 0.06, [0, 0.08, 0], 0.5, 0.03, 0.04);
      for (const dy of [0, 0.08]) place(chest, P(chamferBox(0.86, 0.035, 0.05, 0.01), M.accent, PA), sd * 0.84, 0.96 + dy, 0.94, 0, sd * 0.3, -sd * 0.12);
      // Upper intake ports by the collar
      port(this, chest, 0.17, sd * 0.42, 2.02, 0.74, -0.5, 0, 0, null, 0.12);
      // Flank ports
      for (const y of [0.7, 1.2]) port(this, chest, 0.13, sd * 1.3, y, -0.3, 0, sd * Math.PI / 2, 0, null, 0.1);
    }
    // High collar wrapping the back and sides of the head
    for (const sd of [-1, 1]) place(chest, P(dome(0.5, 0.62, 1.0, { e: 2.6 }), M.armor, { all: B.plainA }), sd * 0.6, 2.36, -0.06, 0, sd * 0.2, sd * -0.2);
    place(chest, P(dome(1.0, 0.6, 0.4, { e: 2.6 }), M.armor, { all: B.plainA }), 0, 2.44, -0.5);
    this.plate(chest, 'e07', 0.46, 0, 1.0, -1.06, 0, Math.PI);
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 2.24, 0.3);
    head.scale.setScalar(1.15);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.24, 0.3, 0.4, 12), M.joint), 0, 0.1, -0.08);
    // Helm: a rounded red dome with a dark visor groove the mono-eye rides in
    place(head, P(dome(0.82, 0.8, 0.86, { e: 2.4 }), M.armor, { all: B.plainA }), 0, 0.48, 0);
    place(head, P(band(0.84, 0.88, 0.14, 2.4), M.joint), 0, 0.46, 0).userData.noOutline = true;
    const eye = (this.monoEye = new THREE.Group());
    eye.position.set(0, 0.46, 0.44);
    head.add(eye);
    place(eye, new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd8ffe2, toneMapped: false })));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x4dff7a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.9 }));
    glow.scale.setScalar(0.5);
    glow.renderOrder = 6;
    place(eye, glow, 0, 0, 0.03);
    // Faceplate with cheek pipes, and the crest
    place(head, P(dome(0.5, 0.36, 0.3, { back: 0.3 }), M.second, { all: B.plainB }), 0, 0.22, 0.32);
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 4; k++) place(head, P(new THREE.TorusGeometry(0.07, 0.035, 6, 10), M.frame, { all: B.plainB }), sd * 0.3, 0.2 - k * 0.04, 0.2 - k * 0.1, 0.5, sd * 0.5, 0);
      place(head, P(chamferBox(0.06, 0.3, 0.3, 0.02), M.accent, { all: B.plainA }), sd * 0.4, 0.5, -0.06);
    }
    place(head, P(blade([[0.42, 0.7], [0.5, 1.1], [0.36, 1.34], [0.16, 1.16], [-0.2, 0.92], [-0.1, 0.76]], 0.1, [0.6, 1], [0.6, 1]), M.trim));
    place(head, P(blade([[0.0, 0.78], [-0.4, 0.94], [-0.56, 0.8], [-0.3, 0.7]], 0.12, [1, 0.6]), M.armor, { all: B.plainA }));
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.6, 1.74, -0.06);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.46, 16, 12), M.joint));
    // Shoulder pod: a great rounded shell with a white rim, a gold spine and ports on its face and tail
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.42, 0.24, -0.04);
    sh.add(pauldron);
    place(pauldron, P(shell([
      { y: -0.86, w: 0.9, d: 1.2, x: s * 0.06 },
      { y: -0.6, w: 1.4, d: 1.7, x: s * 0.04 },
      { y: 0.0, w: 1.56, d: 1.86 },
      { y: 0.36, w: 1.36, d: 1.6 },
      { y: 0.56, w: 0.9, d: 1.1 },
    ], { e: 2.6, n: 24 }), M.armor, { all: B.plainA }));
    for (const y of [-0.06, -0.16]) place(pauldron, P(band(1.6, 1.9, 0.04, 2.6), M.accent, PA), 0, y, 0);
    place(pauldron, P(shell([{ y: 0.3, w: 0.16, d: 1.5 }, { y: 0.66, w: 0.12, d: 1.1 }], { e: 4 }), M.trim), s * 0.24, 0, 0);
    for (const [y, z] of [[-0.4, 0.38], [-0.4, -0.38], [0.24, 0.0]]) port(this, pauldron, y > 0 ? 0.14 : 0.19, s * 0.72, y, z, 0, s * Math.PI / 2, 0, null, y > 0 ? 0.1 : 0.2);
    port(this, pauldron, 0.2, s * 0.2, -0.36, 0.8, 0.1, s * 0.2, 0, null, 0.2);
    for (const x of [-0.26, 0.26]) port(this, pauldron, 0.15, x, -0.3, -0.9, 0.2, Math.PI, 0, null, 0.12);

    // Upper arm: dark rounded sleeve
    place(sh, P(new THREE.CylinderGeometry(0.26, 0.26, 1.0, 12), M.joint), 0, -0.58, 0);
    place(sh, P(shell([{ y: -0.5, w: 0.7, d: 0.76 }, { y: -1.04, w: 0.66, d: 0.72 }], { e: 2.8 }), M.second, { all: B.plainB }));

    const elbow = new THREE.Group();
    elbow.position.y = -1.18;
    sh.add(elbow);
    place(elbow, P(new THREE.SphereGeometry(0.32, 14, 10), M.joint));
    // Forearm: a red bulb swelling toward the wrist, with a white cuff and a gold seam
    place(elbow, P(shell([
      { y: -0.04, w: 0.7, d: 0.76 },
      { y: -0.6, w: 0.96, d: 1.04 },
      { y: -1.06, w: 0.94, d: 1.0 },
      { y: -1.36, w: 0.66, d: 0.74 },
    ], { e: 2.6, n: 22 }), M.armor, { all: B.plainA }));
    for (const y of [-1.04, -1.12]) place(elbow, P(band(0.98, 1.04, 0.035, 2.6), M.accent, PA), 0, y, 0);
    place(elbow, P(chamferBox(0.05, 0.7, 0.05, 0.01), M.trim), s * 0.48, -0.66, 0);
    port(this, elbow, 0.1, 0, -0.6, -0.52, 0, Math.PI, 0);
    this.pistons.push(new Piston(sh, new V3(0, -0.5, 0.38), elbow, new V3(0, -0.36, 0.46), 0.08, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.56, -0.7, 0.04);
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
    place(hand, P(chamferBox(0.5, 0.22, 0.56, 0.06), M.second, { all: B.plainB }), 0, -0.44, 0.08, 0.35);
    place(hand, P(chamferBox(0.15, 0.32, 0.17, 0.04), M.joint), -s * 0.25, -0.28, 0.22, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.32, 0.03);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, pauldronLag: 0.6, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 1.1, -1.02);
    this.chest.add(bp);
    // Rounded pack with a dark funnel rack down its back: wedge-shaped fins in two rows
    place(bp, P(shell([
      { y: -1.1, w: 1.6, d: 0.6, z: -0.26 },
      { y: -0.4, w: 2.2, d: 0.86, z: -0.3 },
      { y: 0.5, w: 2.3, d: 0.8, z: -0.26 },
      { y: 0.96, w: 1.9, d: 0.6, z: -0.2 },
    ], { e: 3, n: 24 }), M.armor, { all: B.plainA, x: B.vent }));
    place(bp, P(chamferBox(1.2, 1.3, 0.16, 0.1), M.second, { all: B.mechA }), 0, 0.0, -0.72);
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        place(bp, P(frontPrism(mirror([[0.04, 0.0], [0.5, 0.12], [0.36, 0.3], [0.04, 0.24]], sd), 0.12, 0.02), M.armor, { all: B.plainA }), sd * 0.06, 0.38 - k * 0.38, -0.84, 0, 0, sd * 0.1);
        place(bp, P(chamferBox(0.04, 0.04, 0.12, 0.01), M.trim), sd * 0.42, 0.48 - k * 0.38, -0.86);
      }
    }
    // Weapons deck across the top for the back mount, the shoulder mounts at its ends
    place(bp, P(chamferBox(2.5, 0.2, 1.0, 0.06), M.joint), 0, 1.04, -0.1);
    place(bp, P(chamferBox(2.54, 0.06, 0.1, 0.02), M.accent, { all: B.plainA }), 0, 1.04, 0.42);
    place(bp, P(new THREE.CylinderGeometry(0.4, 0.46, 0.16, 16), M.second, { all: B.plainB }), 0, 1.2, -0.06);
    this.mount('backC', bp, 0, 1.28, -0.1, -0.06);
    this.mount('shoulderR', bp, -1.02, 1.16, 0.0, -0.08);
    this.mount('shoulderL', bp, 1.02, 1.16, 0.0, -0.08);
    for (const s of [-1, 1]) {
      // Twin mains under the pack, verniers on its flanks
      const hx = s * 0.52;
      place(bp, P(shell([
        { y: -0.6, w: 0.8, d: 0.9, z: -0.4 },
        { y: -1.2, w: 0.82, d: 0.92, z: -0.46 },
        { y: -1.36, w: 0.66, d: 0.76, z: -0.48 },
      ], { e: 3 }), M.second, { all: B.plainB }), hx, 0, 0);
      const dir = new V3(0, -1, -0.4).normalize();
      const mountPos = new V3(hx, -1.34, -0.66);
      const ring = place(bp, P(new THREE.CylinderGeometry(0.46, 0.5, 0.14, 16), M.joint), mountPos.x, mountPos.y, mountPos.z);
      ring.quaternion.setFromUnitVectors(new V3(0, -1, 0), dir);
      this.thrusters.main.push(new Thruster(bp, mountPos.clone().addScaledVector(dir, 0.02), dir, 0.6, this.glowTex, {
        actuators: [new V3(hx + 0.38, -1.15, -0.54), new V3(hx - 0.38, -1.15, -0.54), new V3(hx, -1.18, -0.92)],
      }));
      for (const y of [0.3, -0.3]) port(this, bp, 0.14, s * 1.15, y, -0.3, 0, s * Math.PI / 2, 0);
      this.thrusters.vern.push(new Thruster(bp, new V3(s * 1.0, -0.86, -0.56), new V3(s * 0.2, -0.6, -1), 0.24, this.glowTex));
      strip(bp, M.eye, 0.04, 0.5, 0.02, s * 0.66, 0.1, -0.81);
    }
    this.thrustLight = new THREE.PointLight(0x8fb8ff, 0, 26, 1.8);
    this.thrustLight.position.set(0, -2.2, -1.0);
    bp.add(this.thrustLight);
  }

  onAnimate(dt, st, idle) {
    // The mono-eye sweeps its groove while it stands; aiming snaps it toward the target side
    const look = Math.max(this.w.aim[0], this.w.aim[1]);
    const a = (Math.sin(st.time * 0.8) * 0.5 + Math.sin(st.time * 2.1) * 0.06) * idle + Math.max(-0.5, Math.min(0.5, (st.aimYaw - this.w.twist) * 0.8)) * look;
    this.eyeA = (this.eyeA || 0) + (a - (this.eyeA || 0)) * Math.min(1, dt * 8);
    this.monoEye.position.set(Math.sin(this.eyeA) * 0.43, 0.46, Math.cos(this.eyeA) * 0.43);
  }
}
