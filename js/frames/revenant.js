import * as THREE from '../three.js';
import { B, frontPrism, chamferBox, cylX, cylZ, loft, place } from '../atlas.js';
import { Mech, Thruster, Piston, P, blade, mirror } from '../mech.js';
import { shell, dome, port, vfin, strip, slats, pipe } from './kit.js';

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// KR-11 Revenant: a lancer-pattern medium in the orbital-sniper style, its
// rose-maroon armor rounded and slender and traced with white piping. A white
// helmet with a green visor, a small gold V-fin and a sensor mast; a rounded
// chest with a squadron badge and orange-lined ports; a narrow gold
// mechanical waist; rounded shoulders with ports in their faces; layered
// skirts; long legs with orange vent panels and knee ports; and a flight pack
// whose two binder wings sweep up and back over the shoulders.
// ---------------------------------------------------------------------------

const RIG = {
  leg: { hipDrop: 0.2, thigh: 1.85, shin: 2.45, foot: 0.6 },
  gait: { bodyH: 4.38, homeX: 1.12, dip: 0.2, sway: 0.13 },
  idleFeet: [[-1.14, -0.55], [1.2, 0.8]],
  pole: [0.5, 0.05, 1],
  hunch: 0.16, hunchIdle: 0.08, armOut: 0.24,
};

const PA = { all: B.plainA }, PB = { all: B.plainB };

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

  /** An orange-lined vent panel: a dark recess with slats over the port lining, facing +Z. */
  vent(parent, w, h, x, y, z, rx = 0, ry = 0) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, 0);
    parent.add(g);
    place(g, P(chamferBox(w + 0.06, h + 0.06, 0.06, 0.03, 0.01), M.second, PB));
    place(g, new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), M.port), 0, 0, 0.025);
    slats(g, M.joint, Math.max(2, Math.round(h / 0.07)), 0, -h / 2 + 0.04, 0.045, [0, 0.07, 0], w * 0.9, 0.025, 0.02);
    return g;
  }

  buildPelvis() {
    const M = this.mats, p = this.pelvis;
    place(p, P(loft([
      { y: 0.24, w: 0.82, d: 0.72, c: 0.18 },
      { y: 0.0, w: 0.94, d: 0.8, c: 0.2 },
      { y: -0.28, w: 0.46, d: 0.56, c: 0.14 },
    ]), M.second, { all: B.mechA }));
    place(p, P(cylX(0.2, 1.6), M.joint), 0, -0.16, 0);
    // Rounded crotch block with white piping and a red keel
    place(p, P(dome(0.5, 0.62, 0.4, { back: 0.3, e: 2.6 }), M.armor, PA), 0, -0.06, 0.38);
    place(p, P(frontPrism([[-0.05, 0.1], [0.05, 0.1], [0.05, -0.12], [0, -0.24], [-0.05, -0.12]], 0.05, 0.01), M.red), 0, -0.04, 0.58);
    // Front skirts hang over each thigh and lift with it
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.32, 0.14, 0.44);
      g.rotation.set(-0.06, s * 0.16, 0);
      p.add(g);
      place(g, P(frontPrism(mirror([[-0.2, 0.06], [0.28, 0.06], [0.32, -0.58], [0.16, -0.76], [-0.18, -0.66]], s), 0.12, 0.03), M.armor, PA), 0, 0, 0.02);
      pipe(g, M.accent, 0.56, s * 0.27, -0.28, 0.09, 0, 0, s * 0.06);
      pipe(g, M.accent, 0.4, s * 0.04, 0.0, 0.09, 0, 0, Math.PI / 2);
      this.skirts.push({ g, leg: s < 0 ? 0 : 1, k: 0.7, x0: -0.06 });
    }
    // Rear skirt with a pair of vernier ports
    const rear = new THREE.Group();
    rear.position.set(0, 0.16, -0.44);
    rear.rotation.x = 0.22;
    p.add(rear);
    place(rear, P(frontPrism([[-0.5, 0.06], [0.5, 0.06], [0.44, -0.5], [0.0, -0.62], [-0.44, -0.5]], 0.14, 0.03), M.armor, PA));
    for (const s of [-1, 1]) port(this, rear, 0.1, s * 0.22, -0.28, -0.08, 0, Math.PI, 0, null, 0.06);
    // Side skirts: tall plates with an orange vent and white piping
    this.hipPads = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.76, 0.16, 0.0);
      g.rotation.z = s * 0.2;
      p.add(g);
      place(g, P(blade([[0.36, 0.08], [-0.4, 0.08], [-0.46, -0.52], [-0.1, -0.74], [0.34, -0.6]], 0.1, [1, 1], [0.85, 1]), M.armor, PA), s * 0.06, 0, 0);
      this.vent(g, 0.3, 0.22, s * 0.12, -0.3, 0, 0, s * Math.PI / 2);
      pipe(g, M.accent, 0.7, s * 0.12, 0.02, -0.02, Math.PI / 2, 0, 0);
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
    // Thigh: a rounded maroon shell over the frame with an orange vent on its outer front
    place(hip, P(new THREE.CylinderGeometry(0.16, 0.18, TH - 0.2, 10), M.joint), 0, -TH / 2, -0.02);
    place(hip, P(shell([
      { y: -0.12, w: 0.52, d: 0.66, z: 0.02 },
      { y: -0.7, w: 0.58, d: 0.72, z: 0.05 },
      { y: -1.3, w: 0.5, d: 0.62, z: 0.05 },
      { y: -TH + 0.28, w: 0.4, d: 0.5, z: 0.04 },
    ], { e: 2.6 }), M.armor, PA));
    this.vent(hip, 0.18, 0.4, s * 0.17, -0.8, 0.35, 0, s * 0.5);
    pipe(hip, M.accent, 1.0, s * 0.29, -0.8, 0.12, 0, 0, 0);
    pipe(hip, M.accent, 0.8, -s * 0.1, -0.86, 0.38, 0, 0, 0);

    const knee = new THREE.Group();
    knee.position.y = -TH;
    hip.add(knee);
    place(knee, P(cylX(0.25, 0.6), M.joint));
    // Knee guard: a rounded cop with a port on each side and a white tip
    place(knee, P(dome(0.56, 0.8, 0.44, { back: 0.25, e: 2.4 }), M.armor, PA), 0, 0.1, 0.33, -0.1);
    place(knee, P(frontPrism([[-0.08, 0.2], [0.08, 0.2], [0.0, 0.4]], 0.06, 0.01), M.accent, PA), 0, 0.12, 0.56, -0.1);
    for (const sd of [-1, 1]) port(this, knee, 0.1, sd * 0.31, 0, 0.02, 0, sd * Math.PI / 2, 0, null, 0.05);
    this.pistons.push(new Piston(hip, new V3(s * 0.22, -0.5, -0.3), knee, new V3(s * 0.22, -0.45, -0.32), 0.06, M));

    // Shin: long and rounded, widest over the calf, with a vent panel, piping and calf ports
    place(knee, P(shell([
      { y: -0.06, w: 0.56, d: 0.7, z: -0.04 },
      { y: -0.7, w: 0.62, d: 0.88, z: -0.12 },
      { y: -1.5, w: 0.52, d: 0.7, z: -0.08 },
      { y: -SH + 0.16, w: 0.4, d: 0.48, z: 0 },
    ], { e: 2.6, n: 22 }), M.armor, PA));
    this.vent(knee, 0.16, 0.5, s * 0.19, -0.8, 0.35, 0.06, s * 0.5);
    pipe(knee, M.accent, 1.6, 0, -1.0, 0.43, 0.06, 0, 0);
    pipe(knee, M.accent, 1.3, s * 0.27, -1.05, -0.12, 0, 0, 0);
    this.plate(knee, s > 0 ? 'redPlate' : 'r07', 0.14, s * 0.34, -1.5, -0.1, 0, s * Math.PI / 2);
    const bayY = -1.15;
    place(knee, P(chamferBox(0.46, 0.5, 0.1, 0.06), M.second, { all: B.ventDark }), 0, bayY, -0.58);
    for (const x of [-0.11, 0.11]) port(this, knee, 0.1, x, bayY - 0.04, -0.6, Math.PI - 0.55, 0, 0, this.thrusters.calf);
    {
      const pivot = new THREE.Group();
      pivot.position.set(0, bayY + 0.28, -0.64);
      knee.add(pivot);
      place(pivot, P(chamferBox(0.48, 0.2, 0.05, 0.03), M.armor, { all: B.plainA, nz: B.hot }), 0, -0.1, 0);
      for (const t of this.thrusters.calf.slice(-2)) t.flaps.push({ pivot, open: 1.0 });
    }
    this.mount(s > 0 ? 'legL' : 'legR', knee, s * 0.38, -1.0, -0.08, 0, 0, -s * Math.PI / 2);

    const ankle = new THREE.Group();
    ankle.position.y = -SH;
    knee.add(ankle);
    place(ankle, P(new THREE.SphereGeometry(0.2, 14, 10), M.joint));
    // Small dark foot under a maroon instep, a white heel tube
    place(ankle, P(shell([{ y: 0.3, w: 0.44, d: 0.5 }, { y: -0.12, w: 0.54, d: 0.66, z: 0.04 }], { e: 2.6 }), M.armor, PA));
    place(ankle, P(loft([
      { y: -0.24, w: 0.5, d: 1.24, c: 0.14, z: 0.22 },
      { y: -0.54, w: 0.56, d: 1.36, c: 0.16, z: 0.24 },
    ]), M.second, PB));
    place(ankle, P(blade([[0.3, -0.2], [0.7, -0.3], [0.96, -0.5], [0.94, -0.56], [0.3, -0.56]], 0.46, [1, 0.4], [1, 0.7]), M.second, PB));
    place(ankle, P(blade([[0.3, -0.18], [0.66, -0.27], [0.62, -0.32], [0.3, -0.24]], 0.36, [1, 0.5]), M.armor, PA));
    place(ankle, P(cylX(0.08, 0.5, 10), M.accent, PA), 0, -0.44, -0.36);
    place(ankle, P(chamferBox(0.56, 0.05, 1.5, 0.02), M.joint), 0, -0.585, 0.22);
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
      place(waist, P(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), M.frame, PB), sd * 0.4, 0.2, 0.12, 0, 0, sd * 0.12);
      place(waist, P(chamferBox(0.12, 0.3, 0.3, 0.04), M.second, PB), sd * 0.4, 0.2, -0.12);
    }

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.5;
    waist.add(chest);
    // Rounded chest, broad over the shoulders
    place(chest, P(shell([
      { y: 0.0, w: 1.0, d: 0.8, z: -0.06 },
      { y: 0.6, w: 1.86, d: 1.26, z: -0.04 },
      { y: 1.12, w: 1.96, d: 1.24, z: -0.1 },
      { y: 1.42, w: 1.3, d: 0.96, z: -0.16 },
    ], { e: 2.6, n: 24 }), M.armor, { all: B.plainA, x: B.sideVents }));
    // Breast domes, piped in white
    for (const sd of [-1, 1]) {
      place(chest, P(dome(0.92, 0.86, 0.46, { back: 0.2, e: 2.4 }), M.armor, PA), sd * 0.46, 0.86, 0.5, 0, sd * 0.22, 0);
      pipe(chest, M.accent, 0.5, sd * 0.86, 0.84, 0.56, 0, sd * 0.7, 0.16 * sd);
      // Orange-lined ports at the top corners of the chest
      port(this, chest, 0.14, sd * 0.68, 1.22, 0.42, -0.3, sd * 0.3, 0, null, 0.06);
    }
    // Squadron badge on the left breast: a dark disc in an orange ring
    place(chest, P(cylZ(0.2, 0.2, 0.06, 20), M.second, PB), 0.5, 0.86, 0.78, 0, 0.22, 0);
    place(chest, new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.03, 6, 22), M.port), 0.5, 0.86, 0.81, 0, 0.22, 0).userData.noOutline = true;
    place(chest, P(frontPrism([[-0.08, -0.06], [0.08, -0.06], [0, 0.1]], 0.02, 0.004), M.accent, PA), 0.505, 0.86, 0.82, 0, 0.22, 0);
    // Cockpit seam and a light down the sternum; a dark neck well
    place(chest, P(chamferBox(0.1, 0.8, 0.06, 0.02), M.second, PB), 0, 0.78, 0.7);
    strip(chest, M.eye, 0.04, 0.2, 0.02, 0, 0.56, 0.74);
    place(chest, P(shell([{ y: 1.3, w: 0.8, d: 0.6, z: 0.08 }, { y: 1.5, w: 0.7, d: 0.5, z: 0.06 }], { e: 2.4 }), M.second, PB));
    // Flank louvres
    for (const sd of [-1, 1]) slats(chest, M.joint, 4, sd * 0.96, 0.78, 0.06, [0, 0, -0.12], 0.08, 0.32, 0.04);
    this.plate(chest, 'e07', 0.34, 0, 0.64, -0.7, 0, Math.PI);
  }

  buildHead() {
    const M = this.mats;
    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.46, 0.3);
    head.scale.setScalar(1.05);
    head.rotation.order = 'YXZ';
    this.chest.add(head);
    place(head, P(new THREE.CylinderGeometry(0.15, 0.2, 0.36, 10), M.joint), 0, 0.04, -0.06);
    // White helmet: a smooth dome swept back, with a green visor wrapping its face
    place(head, P(dome(0.56, 0.5, 0.74, { e: 2.3 }), M.accent, PA), 0, 0.34, -0.02, 0.12);
    place(head, P(dome(0.44, 0.26, 0.4, { back: 0.3, e: 2.2 }), M.second, PB), 0, 0.2, 0.18);
    place(head, P(frontPrism([[-0.25, 0.04], [0.25, 0.04], [0.21, -0.04], [0.0, -0.07], [-0.21, -0.04]], 0.06, 0.01), M.eye), 0, 0.34, 0.33, -0.1).userData.noOutline = true;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x62ff9a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.55 }));
    glow.scale.set(0.6, 0.24, 1);
    glow.renderOrder = 6;
    place(head, glow, 0, 0.33, 0.38);
    place(head, P(frontPrism([[-0.1, 0.0], [0.1, 0.0], [0.06, -0.1], [-0.06, -0.1]], 0.08, 0.015), M.red), 0, 0.16, 0.34);
    // Small gold V-fin on the brow, a sensor mast off the left temple, cheek guards
    vfin(this, head, 0.34, 0, 0.5, 0.28, M.trim, { rise: 0.5, sweep: 0.16 });
    place(head, P(new THREE.CylinderGeometry(0.016, 0.026, 0.8, 6), M.frame, PB), 0.24, 0.8, -0.12, -0.24, 0, -0.1);
    place(head, P(chamferBox(0.08, 0.18, 0.14, 0.02), M.second, PB), 0.27, 0.42, -0.06);
    for (const sd of [-1, 1]) {
      place(head, P(blade([[0.26, 0.1], [0.02, 0.1], [-0.2, 0.2], [-0.2, 0.36], [0.1, 0.32], [0.24, 0.22]], 0.05, [1, 0.7]), M.accent, PA), sd * 0.25, 0, 0, 0, -sd * 0.08, 0);
    }
  }

  buildArm(s) {
    const M = this.mats;
    const sh = new THREE.Group();
    sh.position.set(s * 1.28, 1.02, -0.04);
    sh.rotation.order = 'YXZ';
    this.chest.add(sh);
    place(sh, P(new THREE.SphereGeometry(0.3, 14, 10), M.joint));
    // Rounded shoulder with an orange-lined port in its face and two in its tail
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.2, 0.12, -0.04);
    sh.add(pauldron);
    place(pauldron, P(shell([
      { y: -0.42, w: 0.66, d: 0.8, x: s * 0.02 },
      { y: -0.1, w: 0.86, d: 1.02 },
      { y: 0.22, w: 0.8, d: 0.96 },
      { y: 0.38, w: 0.56, d: 0.7 },
    ], { e: 2.4, n: 22 }), M.armor, PA));
    port(this, pauldron, 0.14, s * 0.06, -0.06, 0.5, 0, 0, 0, null, 0.06);
    for (const y of [0.1, -0.2]) port(this, pauldron, 0.1, s * 0.06, y, -0.5, 0, Math.PI, 0, null, 0.05);
    pipe(pauldron, M.accent, 0.9, s * 0.44, -0.04, 0, Math.PI / 2, 0, 0);
    this.plate(pauldron, s > 0 ? 'p07' : 'slash', 0.22, s * 0.44, -0.24, 0.16, 0, s * Math.PI / 2, 0);

    // Upper arm: a slim rounded sleeve over the frame
    place(sh, P(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 10), M.joint), 0, -0.5, 0);
    place(sh, P(shell([{ y: -0.36, w: 0.4, d: 0.46 }, { y: -0.86, w: 0.42, d: 0.48 }], { e: 2.6 }), M.armor, PA), s * 0.02, 0, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -1.0;
    sh.add(elbow);
    place(elbow, P(cylX(0.19, 0.48), M.joint));
    place(elbow, P(blade([[0.06, 0.26], [-0.34, 0.16], [-0.48, -0.06], [-0.12, -0.24]], 0.36, [0.6, 1]), M.second, PB), 0, 0, 0);
    // Forearm: a rounded gauntlet swelling toward the wrist, piped in white, with a small swept fin
    place(elbow, P(shell([
      { y: -0.04, w: 0.44, d: 0.5 },
      { y: -0.6, w: 0.56, d: 0.64, z: 0.01 },
      { y: -0.98, w: 0.6, d: 0.68, z: 0.02 },
      { y: -1.16, w: 0.46, d: 0.54 },
    ], { e: 2.6, n: 20 }), M.armor, PA));
    pipe(elbow, M.accent, 0.8, 0, -0.6, 0.33, 0, 0, 0);
    pipe(elbow, M.accent, 0.62, 0, -1.0, 0.0, Math.PI / 2, 0, Math.PI / 2, 0.035);
    place(elbow, P(blade([[0.2, -0.8], [-0.06, -0.66], [-0.36, -0.2], [-0.24, -0.18], [0.04, -0.5], [0.24, -0.6]], 0.05, [0.4, 1]), M.armor, PA), s * 0.3, 0, 0);
    this.vent(elbow, 0.12, 0.3, s * 0.27, -0.56, 0.02, 0, s * Math.PI / 2);
    this.pistons.push(new Piston(sh, new V3(0, -0.42, 0.22), elbow, new V3(0, -0.3, 0.3), 0.05, M));

    const shieldMount = new THREE.Group();
    shieldMount.position.set(s * 0.4, -0.55, 0.04);
    {
      const Z = new V3(s, 0, 0), Y = new V3(0, 0, 1), X = new V3().crossVectors(Y, Z);
      shieldMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    shieldMount.scale.setScalar(0.8);
    elbow.add(shieldMount);

    const hand = new THREE.Group();
    hand.position.set(0, -1.22, 0.02);
    elbow.add(hand);
    place(hand, P(chamferBox(0.34, 0.36, 0.42, 0.07), M.joint), 0, -0.16, 0);
    place(hand, P(chamferBox(0.35, 0.16, 0.44, 0.05), M.second, PB), 0, -0.36, 0.06, 0.35);
    place(hand, P(chamferBox(0.11, 0.26, 0.13, 0.03), M.joint), -s * 0.17, -0.23, 0.18, 0.3);
    const mount = new THREE.Group();
    mount.position.set(0, -0.26, 0.02);
    mount.rotation.x = Math.PI / 2;
    hand.add(mount);
    return { s, sh, pauldron, pauldronLag: 0.4, elbow, hand, mount, shieldMount };
  }

  buildBackpack() {
    const M = this.mats;
    const bp = (this.backpack = new THREE.Group());
    bp.position.set(0, 0.72, -0.62);
    this.chest.add(bp);
    // Flight pack: a rounded core with an armored lid
    place(bp, P(shell([
      { y: -0.5, w: 0.9, d: 0.5, z: -0.22 },
      { y: 0.0, w: 1.2, d: 0.6, z: -0.24 },
      { y: 0.6, w: 1.0, d: 0.42, z: -0.18 },
    ], { e: 2.8 }), M.second, PB));
    place(bp, P(frontPrism([[-0.44, 0.5], [0.44, 0.5], [0.36, -0.36], [0, -0.5], [-0.36, -0.36]], 0.08, 0.02), M.armor, PA), 0, 0.06, -0.54);
    pipe(bp, M.accent, 0.7, 0, 0.1, -0.59, 0, 0, 0);
    for (const s of [-1, 1]) {
      // Binder wing: a long blade raked up and back over the shoulder, piped in white, ports along it
      const wing = new THREE.Group();
      wing.position.set(s * 0.46, 0.42, -0.42);
      wing.rotation.set(-0.36, s * 0.38, -s * 0.56);
      bp.add(wing);
      place(wing, P(blade([[0.2, -0.36], [0.12, 0.4], [-0.26, 1.7], [-0.62, 1.84], [-0.98, 0.9], [-0.86, 0.1], [-0.4, -0.44]], 0.14, [0.5, 1], [0.7, 1]), M.armor, PA));
      place(wing, P(blade([[0.16, 0.3], [-0.24, 1.64], [-0.29, 1.65], [0.11, 0.3]], 0.16, [0.6, 1]), M.accent, PA));
      place(wing, P(blade([[-0.62, 0.1], [-0.6, 1.3], [-0.64, 1.3], [-0.66, 0.1]], 0.16, [1, 1]), M.accent, PA));
      for (const y of [1.0, 0.6, 0.2]) port(this, wing, 0.08, s * 0.08, y, -0.36, 0, s * Math.PI / 2, 0, null, 0.04);

      // Main thruster under the wing root
      const hx = s * 0.38;
      place(bp, P(shell([
        { y: -0.16, w: 0.5, d: 0.62, z: -0.34 },
        { y: -0.62, w: 0.54, d: 0.66, z: -0.4 },
      ], { e: 3 }), M.armor, PA), hx, 0, 0);
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
