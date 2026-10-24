// The second wave of the arsenal: rail gun, arc caster, flamethrower, laser blade,
// saw launcher, grapple harpoon, bit drones, hydra missiles, singularity projector,
// siege cannon, mine layer and orbital uplink. Their definitions are in WEAPONS
// (weapons.js); here are their models and what they do once fired. WeaponSystem
// hands each of their kinds to an Arsenal.
import * as THREE from './three.js';
import { W, WEAPON_SHEET, chamferBox, topPrism, cylZ, cylX, mesh, place, glowTexture } from './atlas.js';
import { beamMaterial, BEAM_GEO } from './beams.js';

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WP = (geo, mat, faces) => mesh(geo, mat, WEAPON_SHEET, faces);
const UP = new V3(0, 1, 0);
const DOWN = new V3(0, -1, 0);
const FWD = new V3(0, 0, 1);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

let glowTex;
const glow = () => (glowTex = glowTex || glowTexture());
function sprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity }));
  s.scale.setScalar(size);
  s.renderOrder = 6;
  return s;
}
const lit = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
const LENS = new THREE.MeshStandardMaterial({ color: 0x0b1a24, roughness: 0.05, metalness: 0.9, emissive: 0x1aa0ff, emissiveIntensity: 0.6 });
const CERAMIC = new THREE.MeshStandardMaterial({ color: 0xd9d3c4, roughness: 0.35, metalness: 0.05 });

function muzzleAt(g, x, y, z) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
const grip = (g, m, y = -0.15, z = 0) => place(g, WP(chamferBox(0.16, 0.42, 0.22, 0.05), m.metal), 0, y, z);

// ---------------------------------------------------------------------------
// Models. Built along +Z (muzzle forward); hand weapons have the grip at the
// origin, mounted weapons their base.
// ---------------------------------------------------------------------------

function buildRailgun(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.42, 0.56, 1.5, 0.08), m.body, { x: W.bcWhite, all: W.bcWhite2 }), 0, 0.22, 0.3);
  place(g, WP(chamferBox(0.36, 0.48, 0.74, 0.08), m.raw, { all: W.bcDark }), 0, 0.2, -0.78);
  // Two rails with a slot between them, braced top and bottom
  for (const x of [-0.12, 0.12]) place(g, WP(chamferBox(0.1, 0.2, 2.7, 0.03), m.metal), x, 0.3, 2.3);
  place(g, WP(chamferBox(0.34, 0.05, 2.5, 0.02), m.metal), 0, 0.43, 2.2);
  place(g, WP(chamferBox(0.34, 0.05, 2.5, 0.02), m.metal), 0, 0.17, 2.2);
  // Coil rings that light up as it spools
  const coil = new THREE.MeshStandardMaterial({ color: 0x1c2a33, emissive: 0x4fd8ff, emissiveIntensity: 0.25, metalness: 0.6, roughness: 0.3 });
  for (let i = 0; i < 5; i++) place(g, new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.05, 6, 18), coil), 0, 0.3, 1.25 + i * 0.42);
  for (const x of [-0.12, 0.12]) place(g, WP(chamferBox(0.13, 0.26, 0.2, 0.03), m.metal), x, 0.3, 3.62);
  place(g, WP(chamferBox(0.43, 0.07, 0.5, 0.02), m.stripe), 0, 0.48, 0.5);
  place(g, WP(chamferBox(0.16, 0.2, 0.5, 0.04), m.raw, { all: W.rifleDark }), 0, 0.6, 0.15);
  place(g, new THREE.Mesh(cylZ(0.06, 0.06, 0.04, 12), LENS), 0, 0.6, 0.41);
  grip(g, m);
  place(g, WP(chamferBox(0.2, 0.36, 0.3, 0.05), m.raw, { all: W.rifleDark }), 0, -0.15, 0.7);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.3, 3.75)], coil };
}

function buildArcCaster(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.42, 0.5, 1.3, 0.08), m.body, { x: W.sgWhite, all: W.sgWhite }), 0, 0.2, 0.3);
  place(g, WP(chamferBox(0.3, 0.4, 0.6, 0.08), m.raw, { all: W.sgLabel }), 0, 0.14, -0.6);
  // Ceramic insulator stack out to a forked emitter with a charged ball between its prongs
  for (let i = 0; i < 5; i++) place(g, new THREE.Mesh(cylZ(0.21 - (i % 2) * 0.05, 0.21 - (i % 2) * 0.05, 0.1, 14), i % 2 ? m.metal : CERAMIC), 0, 0.26, 1.02 + i * 0.12);
  place(g, WP(cylZ(0.11, 0.11, 0.7, 10), m.metal), 0, 0.26, 1.3);
  for (const sd of [-1, 1]) {
    const prong = place(g, WP(chamferBox(0.08, 0.12, 1.0, 0.02), m.metal), sd * 0.2, 0.26, 2.05, 0, sd * 0.12, 0);
    place(prong, new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), lit(0xbfeaff)), 0, 0, 0.5).userData.noOutline = true;
  }
  place(g, WP(chamferBox(0.5, 0.08, 0.14, 0.02), m.metal), 0, 0.26, 1.6);
  const ball = place(g, new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), lit(0xbfeaff)), 0, 0.26, 2.25);
  ball.userData.noOutline = true;
  const halo = place(g, sprite(0x8fd8ff, 0.9, 0.7), 0, 0.26, 2.25);
  place(g, WP(chamferBox(0.43, 0.06, 0.4, 0.02), m.stripe), 0, 0.46, 0.5);
  grip(g, m);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.26, 2.3)], halo };
}

function buildFlamer(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.4, 0.46, 1.2, 0.08), m.body, { x: W.glWhite, all: W.glWhite }), 0, 0.22, 0.35);
  // Fuel tanks slung under the body, hazard-banded
  for (const sd of [-1, 1]) {
    place(g, WP(cylZ(0.17, 0.17, 1.3, 14), m.body, { x: W.bazWhite, y: W.bazWhite }), sd * 0.2, -0.16, 0.05);
    for (const z of [-0.35, 0.45]) place(g, WP(cylZ(0.175, 0.175, 0.08, 14), m.stripe), sd * 0.2, -0.16, z);
  }
  // Long nozzle under a perforated heat shield, with a pilot light at the tip
  place(g, WP(chamferBox(0.34, 0.34, 1.1, 0.06), m.raw, { all: W.mgDark }), 0, 0.26, 1.5);
  place(g, WP(cylZ(0.12, 0.15, 1.7, 12), m.metal), 0, 0.26, 1.85);
  place(g, WP(cylZ(0.2, 0.12, 0.3, 12), m.metal), 0, 0.26, 2.78);
  place(g, WP(cylZ(0.13, 0.13, 0.02, 12), m.bore), 0, 0.26, 2.94);
  place(g, WP(cylZ(0.04, 0.04, 0.9, 6), m.metal), 0, 0.06, 2.2);
  const pilot = place(g, sprite(0x6fa8ff, 0.36, 0.9), 0, 0.06, 2.68);
  grip(g, m);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.26, 2.95)], pilot };
}

function buildBlade(m) {
  const g = new THREE.Group();
  // Emitter housing like a vambrace: the blade grows out of the head
  place(g, WP(chamferBox(0.38, 0.46, 1.3, 0.08), m.body, { x: W.bcWhite, all: W.bcWhite2 }), 0, 0.2, 0.35);
  place(g, WP(chamferBox(0.3, 0.36, 0.5, 0.06), m.raw, { all: W.bcDark }), 0, 0.18, -0.5);
  place(g, WP(cylZ(0.17, 0.24, 0.42, 14), m.metal), 0, 0.24, 1.2);
  place(g, new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 6, 16), lit(0xc8d6ff)), 0, 0.24, 1.42).userData.noOutline = true;
  for (const sd of [-1, 1]) place(g, WP(chamferBox(0.06, 0.34, 0.6, 0.02), m.metal), sd * 0.24, 0.24, 1.05, 0, sd * 0.2, 0);
  place(g, WP(chamferBox(0.39, 0.06, 0.4, 0.02), m.stripe), 0, 0.44, 0.5);
  grip(g, m);
  // The blade: two ribbons along +Z, a white core inside a blue glow
  const core = new THREE.Mesh(BEAM_GEO, beamMaterial(0x9fb8ff, 1.4, 0.32));
  const halo = new THREE.Mesh(BEAM_GEO, beamMaterial(0x6f8cff, 0.0, 1.3));
  for (const b of [core, halo]) {
    b.rotation.x = Math.PI / 2;
    b.position.set(0, 0.24, 1.44);
    b.frustumCulled = false;
    b.renderOrder = 6;
    g.add(b);
  }
  const len = 6.4;
  return { group: g, muzzles: [muzzleAt(g, 0, 0.24, 1.44)], blade: { core, halo, len, tip: muzzleAt(g, 0, 0.24, 1.44 + len) } };
}

/** A saw disc lying in its XZ plane: toothed rim, slotted body, hub */
let sawGeo;
function sawDiscGeo() {
  if (sawGeo) return sawGeo;
  const pts = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 0.62) / n) * Math.PI * 2;
    pts.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5], [Math.cos(b) * 0.4, Math.sin(b) * 0.4]);
  }
  sawGeo = topPrism(pts, 0.05, 0.01);
  return sawGeo;
}
const SAW_MAT = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.2, metalness: 1.0 });
const SAW_HUB = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.8 });
function sawDisc() {
  const d = new THREE.Group();
  d.add(new THREE.Mesh(sawDiscGeo(), SAW_MAT));
  d.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 12), SAW_HUB));
  return d;
}

function buildSawLauncher(m) {
  const g = new THREE.Group();
  // A flat, wide housing with a slot across the front
  place(g, WP(chamferBox(0.9, 0.36, 1.5, 0.08), m.body, { x: W.sgWhite, all: W.sgWhite }), 0, 0.22, 0.6);
  place(g, WP(chamferBox(0.96, 0.08, 0.3, 0.02), m.stripe), 0, 0.42, 0.95);
  place(g, WP(chamferBox(0.84, 0.1, 0.06, 0.02), m.bore), 0, 0.22, 1.36);
  // Drum magazine of discs on top
  place(g, WP(new THREE.CylinderGeometry(0.44, 0.44, 0.26, 18), m.raw, { all: W.sgLabel }), 0, 0.52, 0.2);
  for (let i = 0; i < 3; i++) place(g, new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 18), SAW_MAT), 0, 0.68 + i * 0.05, 0.2);
  place(g, WP(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 10), m.metal), 0, 0.82, 0.2);
  // The next disc, spinning up in the chamber
  const spin = sawDisc();
  spin.scale.setScalar(0.8);
  spin.position.set(0, 0.22, 1.12);
  g.add(spin);
  place(g, WP(chamferBox(0.3, 0.3, 0.6, 0.06), m.raw, { all: W.mgDark }), 0, 0.18, -0.4);
  grip(g, m);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.22, 1.45)], saw: spin };
}

function harpoonHead(m) {
  const h = new THREE.Group();
  place(h, WP(cylZ(0.05, 0.05, 1.1, 8), m.metal), 0, 0, -0.1);
  const tip = new THREE.ConeGeometry(0.11, 0.42, 8);
  tip.rotateX(Math.PI / 2);
  place(h, WP(tip, m.metal), 0, 0, 0.6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    place(h, WP(chamferBox(0.03, 0.2, 0.24, 0.01), m.stripe), Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.34, 0.5, 0, a + Math.PI / 2);
  }
  return h;
}

function buildHarpoon(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.42, 0.5, 1.3, 0.08), m.body, { x: W.bazWhite2, all: W.bazWhite }), 0, 0.22, 0.25);
  place(g, WP(cylZ(0.15, 0.15, 1.4, 14), m.metal), 0, 0.3, 1.5);
  place(g, WP(cylZ(0.19, 0.15, 0.2, 14), m.metal), 0, 0.3, 2.2);
  // Cable winch on the side
  const winch = new THREE.Group();
  winch.position.set(0.32, 0.14, 0.25);
  g.add(winch);
  place(winch, WP(cylX(0.22, 0.2, 14), m.raw, { all: W.bazDark }));
  for (let i = 0; i < 4; i++) place(winch, WP(chamferBox(0.22, 0.04, 0.44, 0.01), m.metal), 0, 0, 0, (i / 4) * Math.PI);
  place(g, WP(chamferBox(0.43, 0.07, 0.4, 0.02), m.stripe), 0, 0.48, 0.5);
  // The harpoon sits loaded in the barrel, its head out of the muzzle
  const head = harpoonHead(m);
  head.position.set(0, 0.3, 2.3);
  g.add(head);
  grip(g, m);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.3, 2.35)], head, winch, headOf: () => harpoonHead(m) };
}

const DRONE_GLOW = lit(0x6dffd8);
function droneModel(m) {
  const d = new THREE.Group();
  // A dart: arrowhead body, raised spine, a lit core at the tail
  place(d, WP(topPrism([[0, 0.55], [0.32, -0.32], [0.12, -0.2], [0, -0.36], [-0.12, -0.2], [-0.32, -0.32]], 0.1, 0.02), m.body, { all: W.podWhite }));
  place(d, WP(chamferBox(0.1, 0.1, 0.5, 0.03), m.metal), 0, 0.08, -0.02);
  place(d, new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.05), DRONE_GLOW), 0, 0.0, -0.34).userData.noOutline = true;
  return d;
}

function buildDrones(m, def) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.96, 0.44, 1.2, 0.08), m.body, { pz: W.podFace, py: W.podWhite, all: W.podWhite2 }), 0, 0.22, 0);
  place(g, WP(chamferBox(0.98, 0.07, 0.3, 0.02), m.stripe), 0, 0.36, -0.3);
  // A rack on top with the drones docked nose forward
  place(g, WP(chamferBox(0.86, 0.06, 1.1, 0.02), m.metal), 0, 0.47, 0);
  const docked = [], muzzles = [];
  for (let i = 0; i < def.count; i++) {
    const x = (i % 2 ? 0.22 : -0.22), z = i < 2 ? 0.28 : -0.28;
    const d = droneModel(m);
    d.position.set(x, 0.56, z);
    g.add(d);
    docked.push(d);
    muzzles.push(muzzleAt(g, x, 0.56, z));
  }
  return { group: g, muzzles, docked, droneOf: () => droneModel(m) };
}

function buildHydra(m) {
  const g = new THREE.Group();
  const pitch = 0.46, w = 2 * pitch + 0.26, h = 2 * pitch + 0.22, d = 1.5;
  place(g, WP(chamferBox(w, h, d, 0.1), m.body, { pz: W.podHeavyTubes, x: W.podWhite2, py: W.podWhite, ny: W.podDark, nz: W.podDark }), 0, h / 2, 0);
  place(g, WP(chamferBox(w + 0.02, 0.08, 0.3, 0.02), m.stripe), 0, h * 0.8, -d * 0.2);
  for (const sd of [-1, 1]) place(g, WP(chamferBox(0.06, h * 0.6, d * 0.7, 0.02), m.metal), sd * (w / 2 + 0.03), h / 2, -0.1);
  const hinge = new THREE.Group();
  hinge.position.set(0, h - 0.02, d / 2 + 0.04);
  g.add(hinge);
  place(hinge, WP(chamferBox(w * 0.97, h * 0.94, 0.07, 0.06), m.body, { pz: W.podWhite2, all: W.podWhite }), 0, -h * 0.47, 0);
  const tubes = [];
  const nose = new THREE.ConeGeometry(0.15, 0.34, 10);
  nose.rotateX(Math.PI / 2);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const x = (c - 0.5) * pitch, y = h / 2 + (0.5 - r) * pitch;
      place(g, WP(nose, m.stripe), x, y, d / 2 - 0.12);
      tubes.push(muzzleAt(g, x, y, d / 2 + 0.05));
    }
  }
  return { group: g, muzzles: tubes, tubes, hatch: hinge };
}

function buildSingularity(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.84, 0.3, 1.0, 0.08), m.body, { all: W.bcWhite2 }), 0, 0.15, 0);
  place(g, WP(chamferBox(0.86, 0.06, 0.3, 0.02), m.stripe), 0, 0.3, -0.3);
  // A dark sphere held in a cradle of rings, lit along its seams
  const core = place(g, new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 12), new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.15, metalness: 0.9, emissive: 0x2a0a55, emissiveIntensity: 0.6 })), 0, 0.78, 0.05);
  const ring = new THREE.Group();
  ring.position.copy(core.position);
  g.add(ring);
  place(ring, new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.022, 6, 28), lit(0xc89aff)), 0, 0, 0).userData.noOutline = true;
  place(ring, new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.018, 6, 28), lit(0x9a6cff)), 0, 0, 0, Math.PI / 2, 0, 0).userData.noOutline = true;
  for (const sd of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.06, 6, 16, Math.PI), m.metal);
    arm.position.set(sd * 0.06, 0.78, 0.05);
    arm.rotation.set(0, Math.PI / 2, 0);
    g.add(arm);
    place(g, WP(chamferBox(0.12, 0.4, 0.2, 0.03), m.metal), sd * 0.36, 0.42, 0.05);
  }
  place(g, WP(cylZ(0.17, 0.24, 0.6, 14), m.metal), 0, 0.78, 0.62);
  place(g, new THREE.Mesh(cylZ(0.13, 0.13, 0.03, 14), lit(0xb070ff)), 0, 0.78, 0.93).userData.noOutline = true;
  const halo = place(g, sprite(0xb070ff, 1.1, 0.5), 0, 0.78, 0.05);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.78, 1.0)], core, ring, halo };
}

function buildArtillery(m) {
  const g = new THREE.Group();
  place(g, WP(new THREE.CylinderGeometry(0.52, 0.62, 0.3, 16), m.metal), 0, 0.15, 0);
  for (const sd of [-1, 1]) place(g, WP(chamferBox(0.12, 0.6, 0.6, 0.03), m.body, { all: W.bazWhite2 }), sd * 0.36, 0.5, 0.05);
  // The barrel rides on a trunnion so it can lift to range the target; it slides back in its cradle on firing
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.62, 0.05);
  g.add(pivot);
  place(pivot, WP(cylX(0.12, 0.78, 10), m.metal));
  place(pivot, WP(chamferBox(0.56, 0.5, 1.5, 0.08), m.body, { x: W.bazWhite, all: W.bazWhite2 }), 0, 0, 0.2);
  place(pivot, WP(chamferBox(0.58, 0.07, 0.4, 0.02), m.stripe), 0, 0.26, 0.6);
  const slide = new THREE.Group();
  pivot.add(slide);
  place(slide, WP(cylZ(0.15, 0.2, 4.4, 14), m.metal), 0, 0.02, 2.7);
  place(slide, WP(cylZ(0.21, 0.21, 0.5, 14), m.body, { all: W.bazDark }), 0, 0.02, 1.3);
  // Muzzle brake with ports either side
  place(slide, WP(chamferBox(0.46, 0.34, 0.56, 0.05), m.metal), 0, 0.02, 5.0);
  for (const sd of [-1, 1]) for (const z of [4.86, 5.08]) place(slide, WP(chamferBox(0.04, 0.2, 0.1, 0.01), m.bore), sd * 0.235, 0.02, z);
  place(slide, WP(chamferBox(0.5, 0.52, 0.66, 0.08), m.raw, { all: W.bazDark }), 0, 0.0, -0.6);
  for (const sd of [-1, 1]) place(slide, WP(cylZ(0.08, 0.08, 1.9, 10), m.metal), sd * 0.16, -0.24, 1.1);
  return { group: g, muzzles: [muzzleAt(slide, 0, 0.02, 5.3)], pivot, slide };
}

function mineModel(m) {
  const d = new THREE.Group();
  place(d, WP(new THREE.CylinderGeometry(0.36, 0.42, 0.16, 14), m.body, { all: W.podDark }), 0, 0.08, 0);
  place(d, WP(new THREE.CylinderGeometry(0.2, 0.28, 0.12, 12), m.metal), 0, 0.2, 0);
  place(d, WP(new THREE.CylinderGeometry(0.43, 0.43, 0.04, 14), m.stripe), 0, 0.06, 0);
  const lamp = place(d, new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), lit(0xff3030)), 0, 0.28, 0);
  lamp.userData.noOutline = true;
  return d;
}

function buildMines(m, def) {
  const g = new THREE.Group();
  const w = 1.0, h = 0.72, d = 1.1;
  place(g, WP(chamferBox(w, h, d, 0.08), m.body, { pz: W.podFace, py: W.podWhite, x: W.podWhite2, ny: W.podDark, nz: W.podDark }), 0, h / 2, 0);
  place(g, WP(chamferBox(w + 0.02, 0.08, 0.3, 0.02), m.stripe), 0, h * 0.78, -d * 0.2);
  // Mines stacked in the chute behind the door
  for (let i = 0; i < 3; i++) place(g, WP(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), m.raw, { all: W.podDark }), (i - 1) * 0.3, h / 2, d / 2 - 0.1, Math.PI / 2, 0, 0);
  const hinge = new THREE.Group();
  hinge.position.set(0, h - 0.02, d / 2 + 0.04);
  g.add(hinge);
  place(hinge, WP(chamferBox(w * 0.97, h * 0.94, 0.07, 0.06), m.body, { pz: W.podWhite, all: W.podWhite }), 0, -h * 0.47, 0);
  const tubes = [];
  for (let r = 0; r < def.rows; r++) for (let c = 0; c < def.cols; c++) {
    tubes.push(muzzleAt(g, (c - (def.cols - 1) / 2) * 0.3, h / 2 + ((def.rows - 1) / 2 - r) * 0.24, d / 2 + 0.05));
  }
  return { group: g, muzzles: tubes, tubes, hatch: hinge, mineOf: () => mineModel(m) };
}

function buildOrbital(m) {
  const g = new THREE.Group();
  place(g, WP(new THREE.CylinderGeometry(0.46, 0.56, 0.28, 16), m.metal), 0, 0.14, 0);
  place(g, WP(chamferBox(0.76, 0.42, 0.86, 0.08), m.body, { x: W.bcWhite, all: W.bcWhite2 }), 0, 0.42, -0.05);
  place(g, WP(chamferBox(0.78, 0.07, 0.3, 0.02), m.stripe), 0, 0.6, -0.25);
  // Designator: a lens on the front of the base
  place(g, WP(chamferBox(0.22, 0.2, 0.3, 0.04), m.raw, { all: W.bcDark }), 0.24, 0.42, 0.44);
  place(g, new THREE.Mesh(cylZ(0.07, 0.07, 0.04, 12), lit(0xff4040)), 0.24, 0.42, 0.6).userData.noOutline = true;
  // Mast and a folding parabolic dish with a feed horn at its focus
  place(g, WP(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 10), m.metal), 0, 1.0, -0.1);
  const dish = new THREE.Group();
  dish.position.set(0, 1.42, -0.1);
  dish.rotation.x = -1.3;
  g.add(dish);
  const prof = [];
  for (let i = 0; i <= 8; i++) { const r = (i / 8) * 0.95; prof.push(new THREE.Vector2(r, r * r * 0.32)); }
  const bowl = new THREE.LatheGeometry(prof, 20);
  bowl.rotateX(Math.PI / 2);
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xdedfe2, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
  place(dish, new THREE.Mesh(bowl, dishMat)).userData.noOutline = true;
  place(dish, WP(cylX(0.08, 0.3, 10), m.metal), 0, 0, -0.04);
  const focus = new V3(0, 0, 0.74);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const rim = new V3(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.13);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, rim.distanceTo(focus), 6), m.metal);
    strut.position.lerpVectors(rim, focus, 0.5);
    strut.quaternion.setFromUnitVectors(UP, _a.subVectors(focus, rim).normalize());
    dish.add(strut);
  }
  place(dish, WP(cylZ(0.06, 0.09, 0.2, 10), m.metal), 0, 0, 0.72);
  const feed = place(dish, sprite(0xffe2a0, 0.5, 0.0), 0, 0, 0.84);
  return { group: g, muzzles: [muzzleAt(g, 0.24, 0.42, 0.64)], dish, feed };
}

/** The model for one of the arsenal's weapons, or null if id isn't one of them */
export function buildArsenalModel(id, def, m) {
  switch (id) {
    case 'railgun': return buildRailgun(m);
    case 'arcCaster': return buildArcCaster(m);
    case 'flamer': return buildFlamer(m);
    case 'blade': return buildBlade(m);
    case 'sawLauncher': return buildSawLauncher(m);
    case 'harpoon': return buildHarpoon(m);
    case 'drones': return buildDrones(m, def);
    case 'hydra': return buildHydra(m);
    case 'singularity': return buildSingularity(m);
    case 'artillery': return buildArtillery(m);
    case 'mines': return buildMines(m, def);
    case 'orbital': return buildOrbital(m);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

// Kinds the Arsenal runs every frame, trigger included: charge-ups, the blade, drones
const SELF = new Set(['rail', 'orbital', 'blade', 'drone']);
const SLASH_TIME = 0.62;     // a blade swing, wind-up to recovery
const SHELL_G = 30;          // siege cannon shells fall this hard
const MAX_MINES = 24;
const DRONE_BOLT = { color: 0x6dffd8, dmg: 14, speed: 320, hole: 1.1 };
// Street furniture a rail slug smashes on its way through, where a building would stop it
const FURNITURE = new Set(['armillary', 'fountain', 'kiosk', 'lamp', 'planter', 'signal', 'subway']);
const CABLE_GEO = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
const CABLE_MAT = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.5, metalness: 0.8 });
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let ringTex;
function markerMat(color) {
  if (!ringTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = '#fff';
    g.lineWidth = 7;
    g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3;
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; g.beginPath(); g.moveTo(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30); g.lineTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46); g.stroke(); }
    ringTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ map: ringTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
}

/** Distance from p to the segment a-b */
function segDist(p, a, b) {
  _e.subVectors(b, a);
  const t = clamp(_d.subVectors(p, a).dot(_e) / Math.max(1e-6, _e.lengthSq()), 0, 1);
  return _d.copy(a).addScaledVector(_e, t).distanceTo(p);
}

/** Muzzle velocity that drops a shell from p0 onto p1 on a high arc */
function ballistic(p0, p1, out) {
  out.subVectors(p1, p0);
  const T = clamp(Math.hypot(out.x, out.z) / 120 + 0.6, 1.1, 3.4);
  out.divideScalar(T);
  out.y += 0.5 * SHELL_G * T;
  return out;
}

export class Arsenal {
  constructor(ws) {
    this.ws = ws;
    this.rails = []; this.arcs = []; this.puffs = []; this.saws = []; this.hooks = [];
    this.drones = []; this.orbs = []; this.wells = []; this.shells = []; this.mines = []; this.strikes = [];
    this.arcPool = [];
    this.scorchT = 0;
    this.lastFlame = -1;
  }

  get scene() { return this.ws.scene; }
  get fx() { return this.ws.fx; }
  get sound() { return this.ws.sound; }
  get world() { return this.ws.world; }
  get time() { return this.ws.time; }

  /** Every frame for an arsenal weapon that isn't reloading. Returns true when it handled the trigger itself. */
  tick(dt, s, trigger, aim) {
    const M = s.model;
    switch (s.def.kind) {
      case 'rail': this.tickRail(dt, s, trigger, aim); return true;
      case 'orbital': this.tickOrbital(dt, s, trigger, aim); return true;
      case 'blade': this.tickBlade(dt, s, trigger, aim); return true;
      case 'drone': this.tickDrones(dt, s, trigger); return true;
      case 'artillery': this.aimArtillery(dt, s, aim); return false;
      case 'saw': M.saw.rotation.y += dt * (s.cool > 0 ? 40 : 14); return false;
      case 'arc': M.halo.material.opacity = 0.45 + Math.random() * 0.35; return false;
      case 'flame': M.pilot.material.opacity = 0.6 + Math.random() * 0.4; M.pilot.scale.setScalar(0.3 + Math.random() * 0.12); return false;
      case 'grav': M.ring.rotation.y += dt * 2.2; M.ring.rotation.x += dt * 1.3; M.halo.material.opacity = 0.35 + 0.15 * Math.sin(this.time * 4); return false;
      case 'harpoon': {
        // While the cable is out, a second pull of the trigger lets go
        const hook = s.hook;
        if (hook && trigger && !s.trigWas && hook.state === 'anchored' && this.ws.reel) this.ws.reel.active = false;
        s.trigWas = trigger;
        return !!hook;
      }
    }
    return false;
  }

  /** Fire one round of a weapon the WeaponSystem fires on its own rate and ammo */
  shoot(s, aim) {
    switch (s.def.kind) {
      case 'arc': this.fireArc(s, aim); break;
      case 'flame': this.firePuff(s, aim); break;
      case 'saw': this.fireSaw(s, aim); break;
      case 'harpoon': this.fireHarpoon(s, aim); break;
      case 'grav': this.fireOrb(s, aim); break;
      case 'artillery': this.fireShell(s, aim); break;
    }
  }

  /** HUD readout for weapons that don't count rounds, or null */
  status(s) {
    const def = s.def;
    if (def.kind === 'blade') {
      if (s.slashT > -9) return { label: 'SLASH', frac: 1 };
      return s.cool > 0 ? { label: 'COOL', frac: 1 - s.cool / def.rate } : { label: 'READY', frac: 1 };
    }
    if (def.kind === 'drone') {
      if (s.dstate === 'active') return { label: `ACTIVE ${Math.ceil(s.droneT)}s`, frac: s.droneT / def.life };
      if (s.dstate === 'return') return { label: 'DOCKING', frac: 0 };
      if (s.dstate === 'recharge') return { label: 'CHARGE', frac: 1 - s.droneT / def.recharge, reloading: true };
      return { label: 'READY', frac: 1 };
    }
    return null;
  }

  /** The loadout is changing: take back everything still tied to a weapon on the frame */
  release() {
    for (const h of this.hooks) this.scene.remove(h.obj, h.cable);
    this.hooks.length = 0;
    if (this.ws.reel) this.ws.reel.active = false;
    for (const d of this.drones) this.scene.remove(d.obj);
    this.drones.length = 0;
    for (const st of this.strikes) this.endStrike(st);
    this.strikes.length = 0;
    this.sound.setOrbital(0);
    for (const id in this.ws.slots) {
      const s = this.ws.slots[id];
      if (s.trail) this.scene.remove(s.trail.mesh);
      if (s.laser) this.scene.remove(s.laser);
    }
  }

  /** A fresh deployment: everything still out in the world goes, mines and wells included */
  clear() {
    this.release();
    for (const list of [this.rails, this.orbs, this.wells, this.shells, this.mines, this.saws]) {
      for (const o of list) {
        for (const k of ['obj', 'core', 'halo', 'marker']) if (o[k]) this.scene.remove(o[k]);
      }
      list.length = 0;
    }
    this.puffs.length = 0;
    this.arcs.length = 0;
    for (const m of this.arcPool) m.visible = false;
  }

  update(dt, aim) {
    this.updateRails(dt);
    this.updateArcs(dt);
    this.updatePuffs(dt);
    this.updateSaws(dt);
    this.updateHooks(dt);
    this.updateDrones(dt);
    this.updateOrbs(dt);
    this.updateWells(dt);
    this.updateShells(dt);
    this.updateMines(dt);
    this.updateStrikes(dt, aim);
  }

  worldScale(s) { return s.model.group.getWorldScale(_e).x; }

  // ---- rail gun -------------------------------------------------------------------

  tickRail(dt, s, trigger, aim) {
    const def = s.def, coil = s.model.coil;
    if (s.charge > 0) {
      s.charge += dt;
      const k = s.charge / def.charge;
      coil.emissiveIntensity = 0.25 + k * 4;
      s.model.muzzles[0].getWorldPosition(_a);
      for (let i = 0; i < 2; i++) {
        _b.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, 2.2));
        this.fx.sparks.emit(_a.x + _b.x, _a.y + _b.y, _a.z + _b.z, -_b.x * 6, -_b.y * 6, -_b.z * 6, 0.18, 0.12, 0.04, 1.2, 2.6, 3, 1, 0.4, 0.8, 1, 0.5, 0, 0);
      }
      if (s.charge >= def.charge) {
        s.charge = 0;
        this.fireRail(s, aim);
        s.ammo--;
        s.cool = def.rate;
        if (s.ammo <= 0) { s.reloadT = def.reload; this.sound.reload(); }
      }
      return;
    }
    coil.emissiveIntensity += (0.25 - coil.emissiveIntensity) * (1 - Math.exp(-dt * 3));
    if (!trigger || s.cool > 0) return;
    if (s.ammo <= 0) { s.reloadT = def.reload; this.sound.reload(); return; }
    s.charge = 1e-4;
    this.sound.railCharge(s.model.muzzles[0].getWorldPosition(_a), def.charge);
  }

  fireRail(s, aim) {
    const def = s.def, W_ = this.world, D = W_.destruct, fx = this.fx;
    const { pos, dir } = this.ws.muzzleRay(s, aim);
    // The slug goes through every target in line, and stops in the first thing that isn't one
    const o = pos.clone();
    let left = 800, end = null;
    for (let n = 0; n < 16 && left > 0; n++) {
      const hit = W_.raycast(o, dir, left, { props: true, pad: 0.4 });
      if (!hit) break;
      if (hit.target) {
        W_.damage(hit.target, def.dmg, hit.point);
        fx.beamHit(hit.point, hit.normal, def.color);
        const skip = (hit.target.radius || 1) * 2 + 0.6;
        o.copy(hit.point).addScaledVector(dir, skip);
        left -= hit.dist + skip;
        continue;
      }
      const owner = hit.struct ? hit.struct.owner : hit.collider && hit.collider.owner;
      if (owner && FURNITURE.has(owner.kind)) {
        if (D) D.bullet(hit, { radius: 2.2, power: 500, dir, speed: 16, chunks: 10 });
        fx.sparksBurst(hit.point, hit.normal, 16, 0xbfefff, 40);
        o.copy(hit.point).addScaledVector(dir, 1.5);
        left -= hit.dist + 1.5;
        continue;
      }
      end = hit.point.clone();
      fx.beamHit(hit.point, hit.normal, def.color);
      fx.sparksBurst(hit.point, hit.normal, 30, 0xbfefff, 50);
      fx.dust(hit.point, 0.8, 6);
      if (D) {
        // A deep, narrow tunnel: the entry hole and a line of bites behind it
        D.bullet(hit, { radius: 2.8, power: 700, dir, speed: 18, chunks: 18 });
        for (const k of [2.5, 5, 7.5]) D.blast(_b.copy(hit.point).addScaledVector(dir, k * D.M), 1.5, 650, { chunks: 6 });
      }
      if (hit.normal.y > 0.9 && !hit.struct) fx.scorch(hit.point.x, hit.point.z, 3, hit.point.y + 0.03);
      break;
    }
    if (!end) end = o.addScaledVector(dir, Math.max(0, left));
    // A straight ion trail that hangs and fades, wound with a helix of sparks
    const core = new THREE.Mesh(BEAM_GEO, beamMaterial(def.color, 1.6, 0.5));
    const halo = new THREE.Mesh(BEAM_GEO, beamMaterial(def.color, 0.0, 2.4));
    const len = pos.distanceTo(end);
    _q.setFromUnitVectors(UP, dir);
    for (const m of [core, halo]) {
      m.position.copy(pos);
      m.quaternion.copy(_q);
      m.scale.set(1, len, 1);
      m.frustumCulled = false;
      m.renderOrder = 6;
      this.scene.add(m);
    }
    this.rails.push({ core, halo, age: 0, life: 0.7 });
    const right = _b.crossVectors(dir, UP);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();
    const up = _c.crossVectors(right, dir).normalize();
    const n = Math.min(220, Math.floor(len / 1.2));
    for (let i = 0; i < n; i++) {
      const t = (i / n) * len, a = i * 0.55;
      const r = 0.55;
      _d.copy(pos).addScaledVector(dir, t).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
      fx.sparks.emit(_d.x, _d.y, _d.z, Math.cos(a) * 1.5, Math.sin(a) * 1.5 + 0.5, 0, rand(0.4, 0.8), 0.18, 0.05, 0.9, 2.2, 3, 1, 0.3, 0.6, 1, 0.3, 0.5, 0);
    }
    fx.flash(pos, 6, def.color, 0.12);
    fx.light(pos, def.color, 90, 0.2, 50);
    fx.light(end, def.color, 60, 0.3, 40);
    this.ws.onShake(pos, 0.55);
    this.sound.rail(pos);
    s.recoil = 1.6;
  }

  updateRails(dt) {
    for (let i = this.rails.length - 1; i >= 0; i--) {
      const r = this.rails[i];
      r.age += dt;
      const k = 1 - r.age / r.life;
      if (k <= 0) {
        this.scene.remove(r.core, r.halo);
        r.core.material.dispose(); r.halo.material.dispose();
        this.rails.splice(i, 1);
        continue;
      }
      r.core.material.uniforms.uAlpha.value = k * k;
      r.halo.material.uniforms.uAlpha.value = k * 0.7;
      r.core.material.uniforms.uWidth.value = 0.5 * (0.3 + 0.7 * k);
      r.halo.material.uniforms.uWidth.value = 2.4 * (1.6 - 0.6 * k);
      r.core.material.uniforms.uTime.value = r.halo.material.uniforms.uTime.value = this.time;
    }
  }

  // ---- arc caster -------------------------------------------------------------------

  fireArc(s, aim) {
    const def = s.def, W_ = this.world, fx = this.fx;
    const { pos, dir } = this.ws.muzzleRay(s, aim);
    // First link: the held lock if it's ahead, else whatever is nearest the line of fire in clear view
    let first = null;
    const hard = this.ws.hardTarget;
    if (hard && hard.alive && !hard.stealth && hard.pos.distanceTo(pos) < 150 && _a.subVectors(hard.pos, pos).normalize().dot(dir) > 0.7) first = hard;
    else {
      let best = Infinity;
      for (const t of W_.targets) {
        if (!t.alive || t.stealth) continue;
        _a.subVectors(t.pos, pos);
        const along = _a.dot(dir);
        if (along < 0 || along > 140) continue;
        const perp = _a.addScaledVector(dir, -along).length();
        if (perp > t.radius + 2.5 + along * 0.08) continue;
        const score = perp / Math.max(1, along);
        if (score < best && this.inSight(pos, t)) { best = score; first = t; }
      }
    }
    const pts = [pos.clone()];
    if (first) {
      const hit = new Set();
      let cur = first;
      for (let k = 0; cur && k < def.chain; k++) {
        hit.add(cur);
        pts.push(cur.pos.clone());
        W_.damage(cur, def.dmg * Math.pow(0.85, k), cur.pos);
        if (cur.alive && W_.spiders) W_.spiders.stun(cur, def.stun);
        fx.sparksBurst(cur.pos, UP, 12, def.color, 24);
        fx.flash(cur.pos, 4, def.color, 0.12);
        // Leap to the nearest target not struck yet
        let next = null, bd = def.jump;
        for (const t of W_.targets) {
          if (!t.alive || hit.has(t)) continue;
          const d = t.pos.distanceTo(cur.pos);
          if (d < bd) { bd = d; next = t; }
        }
        cur = next;
      }
    } else {
      // Nothing to jump to: it earths into whatever is in front
      const h = W_.raycast(pos, dir, 80, { props: true });
      const end = h ? h.point : pos.clone().addScaledVector(dir, 80);
      pts.push(end);
      if (h) {
        fx.sparksBurst(h.point, h.normal, 16, def.color, 26);
        if (h.target) W_.damage(h.target, def.dmg, h.point);
        else if (W_.destruct) W_.destruct.bullet(h, { radius: 1.4, power: 120, dir, speed: 8, chunks: 6 });
      }
    }
    this.arcs.push({ pts, age: 0, life: 0.24, color: def.color });
    fx.light(pos, def.color, 50, 0.15, 40);
    this.sound.zap(pos);
    s.recoil = 0.6;
  }

  /** Nothing solid between a and target t */
  inSight(a, t) {
    _b.subVectors(t.pos, a);
    const d = _b.length();
    const h = this.world.raycast(a, _b.divideScalar(d), d, { targets: false });
    return !h || h.dist > d - t.radius - 1;
  }

  updateArcs(dt) {
    let used = 0;
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const A = this.arcs[i];
      A.age += dt;
      if (A.age > A.life) { this.arcs.splice(i, 1); continue; }
      const k = 1 - A.age / A.life;
      // Re-jag every frame so the bolt crawls
      for (let j = 0; j < A.pts.length - 1; j++) {
        const a = A.pts[j], b = A.pts[j + 1], len = a.distanceTo(b);
        const n = clamp(Math.round(len / 2.5), 4, 14);
        _c.subVectors(b, a).normalize();
        _d.crossVectors(_c, UP); if (_d.lengthSq() < 1e-4) _d.set(1, 0, 0); _d.normalize();
        _e.crossVectors(_d, _c).normalize();
        let px = a.x, py = a.y, pz = a.z;
        for (let q = 1; q <= n; q++) {
          const t = q / n, amp = q === n ? 0 : len * 0.07 * Math.sin(Math.PI * t);
          const ox = rand(-1, 1) * amp, oy = rand(-1, 1) * amp;
          const nx = a.x + (b.x - a.x) * t + _d.x * ox + _e.x * oy;
          const ny = a.y + (b.y - a.y) * t + _d.y * ox + _e.y * oy;
          const nz = a.z + (b.z - a.z) * t + _d.z * ox + _e.z * oy;
          const m = this.arcMesh(used++, A.color);
          _a.set(nx - px, ny - py, nz - pz);
          const sl = _a.length();
          m.position.set(px, py, pz);
          m.quaternion.setFromUnitVectors(UP, _a.divideScalar(sl || 1));
          m.scale.set(1, sl, 1);
          m.material.uniforms.uWidth.value = 0.55 * (0.5 + 0.5 * k) * rand(0.7, 1.3);
          m.material.uniforms.uAlpha.value = k;
          px = nx; py = ny; pz = nz;
        }
      }
    }
    for (let i = used; i < this.arcPool.length; i++) this.arcPool[i].visible = false;
  }

  arcMesh(i, color) {
    let m = this.arcPool[i];
    if (!m) {
      m = new THREE.Mesh(BEAM_GEO, beamMaterial(color, 1.4, 0.5));
      m.frustumCulled = false;
      m.renderOrder = 6;
      this.scene.add(m);
      this.arcPool.push(m);
    }
    m.visible = true;
    m.material.uniforms.uColor.value.set(color);
    return m;
  }

  // ---- flamethrower -------------------------------------------------------------------

  firePuff(s, aim) {
    const def = s.def;
    const { pos, dir } = this.ws.muzzleRay(s, aim, 0.03);
    const v = dir.multiplyScalar(def.speed * rand(0.9, 1.1));
    if (this.ws.player) v.addScaledVector(this.ws.player.vel, 0.8);
    this.puffs.push({ pos, vel: v, age: 0, life: rand(0.6, 0.8), tick: rand(0, 0.2), def, stuck: false });
    this.fx.fire.emit(pos.x, pos.y, pos.z, v.x * 0.2, v.y * 0.2, v.z * 0.2, 0.08, 0.5, 1.2, 3, 2.6, 1.6, 1, 2, 0.8, 0.2, 0, 2);
    if (this.time - this.lastFlame > 0.08) { this.fx.light(pos, 0xff8a30, 30, 0.1, 30); this.lastFlame = this.time; }
    this.sound.flame(pos);
    s.recoil = 0.12;
  }

  /** Fire licking over everything inside radius r of p: targets, trees and cars */
  burn(p, r, amount) {
    const W_ = this.world;
    for (const t of [...W_.targets]) if (t.alive && t.pos.distanceTo(p) < r + t.radius) W_.damage(t, amount, t.pos);
    if (W_.trees) W_.queryTrees(p.x - r, p.z - r, p.x + r, p.z + r, (t) => { if (W_.trees.distTo(t, p) < r) W_.trees.ignite(t); });
    if (p.y < 6) W_.query(p.x - r, p.z - r, p.x + r, p.z + r, (c) => {
      if (c.ref && c.ref.alive && c.ref.kind === 'car' && c.ref.pos.distanceTo(p) < r + 2) W_.city.damageCar(c.ref, amount * 3, p);
    });
  }

  updatePuffs(dt) {
    const W_ = this.world, fx = this.fx;
    this.scorchT -= dt;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age > p.life) { this.puffs.splice(i, 1); continue; }
      const r = 0.7 + p.age * 7;
      if (!p.stuck) {
        p.vel.multiplyScalar(Math.exp(-dt * 1.6));
        p.vel.y += 5 * dt;
        const sp = p.vel.length(), step = sp * dt;
        const hit = W_.raycast(p.pos, _a.copy(p.vel).divideScalar(sp || 1), step + 0.3, { targets: false, props: true });
        if (hit) {
          // Splash along the surface
          p.pos.copy(hit.point).addScaledVector(hit.normal, 0.6);
          p.vel.addScaledVector(hit.normal, -p.vel.dot(hit.normal)).multiplyScalar(0.35);
          p.stuck = true;
          if (hit.normal.y > 0.8 && !hit.struct && this.scorchT <= 0) { fx.scorch(hit.point.x, hit.point.z, rand(2, 3.5), hit.point.y + 0.03); this.scorchT = 0.25; }
        } else p.pos.addScaledVector(p.vel, dt);
      } else {
        p.pos.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.exp(-dt * 3));
      }
      p.tick -= dt;
      if (p.tick <= 0) { p.tick = 0.2; this.burn(p.pos, r, p.def.dmg); }
      const f = p.age / p.life;
      for (let k = 0; k < 2; k++) {
        fx.fire.emit(p.pos.x + rand(-0.4, 0.4) * r, p.pos.y + rand(-0.3, 0.3) * r, p.pos.z + rand(-0.4, 0.4) * r,
          p.vel.x * 0.3 + rand(-1, 1), p.vel.y * 0.3 + rand(0, 2), p.vel.z * 0.3 + rand(-1, 1),
          rand(0.18, 0.32), r * 0.5, r * 1.15, 2.8 - f, 1.7 - f * 1.2, 0.6 - f * 0.5, 0.9, 1.6, 0.35, 0.06, 0, 1, 2.5);
      }
      if (f > 0.45 && Math.random() < 0.25) {
        const g = rand(0.1, 0.18);
        fx.smoke.emit(p.pos.x, p.pos.y + r * 0.4, p.pos.z, rand(-1, 1), rand(2, 4), rand(-1, 1), rand(1.2, 2), r * 0.6, r * 1.8, g, g, g, 0.5, g + 0.15, g + 0.15, g + 0.15, 0, 0.6, 0.8);
      }
    }
  }

  // ---- laser blade -------------------------------------------------------------------

  tickBlade(dt, s, trigger, aim) {
    const def = s.def, B = s.model.blade;
    if (s.slashT == null) s.slashT = -9;
    if (s.slashT <= -9 && trigger && s.cool <= 0) this.startSlash(s, aim);
    let ext = 0.1 + 0.03 * Math.sin(this.time * 9); // a short, idling stub
    if (s.slashT === -1) this.closeIn(dt, s);
    if (s.slashT === -1) {
      // Lunging in with the blade held back, lit
      s.slashP = 0.2;
      ext = 0.5;
    } else if (s.slashT > -9) {
      s.slashT += dt;
      const p = s.slashT / SLASH_TIME;
      s.slashP = Math.min(1, p);
      ext = Math.max(ext, smoothstep(0.1, 0.28, p) * (1 - smoothstep(0.72, 0.95, p)));
      if (p > 0.3 && p < 0.66) this.bladeCut(dt, s);
      if (ext > 0.4) this.trailSample(s);
      if (p >= 1) { s.slashT = -9; s.slashP = 0; s.cool = def.rate; }
    }
    B.core.scale.y = B.halo.scale.y = Math.max(0.05, B.len * ext);
    B.core.material.uniforms.uWidth.value = 0.32 * (0.6 + 0.4 * ext) * this.worldScale(s);
    B.halo.material.uniforms.uWidth.value = 1.3 * (0.5 + 0.5 * ext) * rand(0.9, 1.1) * this.worldScale(s);
    B.core.material.uniforms.uTime.value = B.halo.material.uniforms.uTime.value = this.time;
    this.updateTrail(dt, s);
  }

  startSlash(s, aim) {
    const def = s.def, W_ = this.world, root = this.ws.mech.root.position;
    s.slashT = 0;
    s.hits = new Set();
    // Lunge at the held lock, else the target nearest the crosshair in reach
    const eye = _a.set(root.x, root.y + 4 * this.ws.mech.rig.scale, root.z);
    let target = null;
    const hard = this.ws.hardTarget;
    if (hard && hard.alive && hard.pos.distanceTo(eye) < def.range) target = hard;
    else {
      let best = 0.75;
      for (const t of W_.targets) {
        if (!t.alive || t.stealth) continue;
        _b.subVectors(t.pos, eye);
        const d = _b.length();
        if (d > def.range) continue;
        const dot = _b.divideScalar(d).dot(aim.dir) - d / def.range * 0.15;
        if (dot > best) { best = dot; target = t; }
      }
    }
    s.victim = target;
    s.lungeLeft = 0.9;
    if (target) {
      // Close in on it first, steering all the way; closeIn() starts the swing on arrival
      s.slashT = -1;
      this.closeIn(0, s);
    } else {
      _b.set(aim.dir.x, 0, aim.dir.z).normalize();
      this.ws.onLunge(_b, def.lunge * 0.4, 0.14);
    }
    this.sound.bladeIgnite(eye);
  }

  /** Steer the lunge at the victim; within sword's reach, or out of time, stop and swing */
  closeIn(dt, s) {
    const root = this.ws.mech.root.position, K = this.ws.mech.rig.scale, v = s.victim;
    s.lungeLeft -= dt;
    if (v && v.alive && s.lungeLeft > 0) {
      _b.set(v.pos.x - root.x, v.pos.y - (root.y + 3 * K), v.pos.z - root.z);
      const d = _b.length();
      if (d > 7 + 3 * K + v.radius) { this.ws.onLunge(_b.divideScalar(d), s.def.lunge, 0.1); return; }
    }
    this.ws.onLunge(null, 0, 0);
    s.slashT = 0;
  }

  bladeCut(dt, s) {
    const def = s.def, W_ = this.world, fx = this.fx, B = s.model.blade;
    const hilt = s.model.muzzles[0].getWorldPosition(new V3());
    const tip = B.tip.getWorldPosition(new V3());
    for (const t of [...W_.targets]) {
      if (!t.alive || s.hits.has(t)) continue;
      if (segDist(t.pos, hilt, tip) > t.radius + 1.4) continue;
      s.hits.add(t);
      W_.damage(t, def.dmg, t.pos);
      fx.beamHit(t.pos, UP, def.color);
      fx.sparksBurst(t.pos, UP, 24, 0xd0dcff, 40);
      this.sound.bladeHit(t.pos);
      this.ws.onShake(t.pos, 0.35);
    }
    // Walls, trees and cars along the blade
    const dir = _a.subVectors(tip, hilt);
    const len = dir.length();
    dir.divideScalar(len);
    const hit = W_.raycast(hilt, dir, len, { props: true });
    if (hit) {
      if (hit.target && (hit.target.kind === 'tree' || hit.target.kind === 'car')) W_.damage(hit.target, def.dmg, hit.point);
      else if (!hit.target && W_.destruct) W_.destruct.beam(hit, dir, dt * 3.5, { radius: 1.6 });
      if (Math.random() < 0.6) fx.sparksBurst(hit.point, hit.normal, 6, 0xc8d4ff, 30);
    }
  }

  trailSample(s) {
    let T = s.trail;
    if (!T) {
      const n = 22;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      T = s.trail = { mesh, n, samples: [] };
    }
    if (!T.mesh.parent) this.scene.add(T.mesh);
    T.samples.unshift({ a: s.model.muzzles[0].getWorldPosition(new V3()), b: s.model.blade.tip.getWorldPosition(new V3()), t: this.time });
    if (T.samples.length > T.n) T.samples.length = T.n;
  }

  updateTrail(dt, s) {
    const T = s.trail;
    if (!T || !T.mesh.parent) return;
    const pos = T.mesh.geometry.attributes.position, col = T.mesh.geometry.attributes.color;
    const c = new THREE.Color(s.def.color);
    let live = 0;
    for (let i = 0; i < T.n; i++) {
      const smp = T.samples[Math.min(i, T.samples.length - 1)];
      const age = smp ? this.time - smp.t : 1;
      const k = smp ? Math.max(0, 1 - age / 0.16) * (1 - i / T.n) : 0;
      if (k > 0) live++;
      if (smp) { pos.setXYZ(i * 2, smp.a.x, smp.a.y, smp.a.z); pos.setXYZ(i * 2 + 1, smp.b.x, smp.b.y, smp.b.z); }
      col.setXYZ(i * 2, c.r * k * 0.25, c.g * k * 0.25, c.b * k * 0.25);
      col.setXYZ(i * 2 + 1, c.r * k * 1.1, c.g * k * 1.1, c.b * k * 1.1);
    }
    pos.needsUpdate = col.needsUpdate = true;
    if (!live) { this.scene.remove(T.mesh); T.samples.length = 0; }
  }

  // ---- saw launcher ---------------------------------------------------------------------

  fireSaw(s, aim) {
    const def = s.def;
    const { pos, dir } = this.ws.muzzleRay(s, aim);
    const obj = sawDisc();
    obj.scale.setScalar(1.25);
    obj.position.copy(pos);
    obj.traverse((o) => { o.castShadow = true; });
    this.scene.add(obj);
    this.saws.push({ obj, pos, vel: dir.multiplyScalar(def.speed), bounces: def.bounces, age: 0, life: 3.2, hits: new Map(), def, spin: 0 });
    this.fx.sparksBurst(pos, dir, 8, 0xffd080, 20);
    this.sound.saw(pos);
    s.recoil = 0.7;
  }

  updateSaws(dt) {
    const W_ = this.world, fx = this.fx;
    for (let i = this.saws.length - 1; i >= 0; i--) {
      const S = this.saws[i];
      S.age += dt;
      S.vel.y -= 5 * dt;
      let left = S.vel.length() * dt, dead = false;
      for (let g = 0; g < 4 && left > 0; g++) {
        const dir = _a.copy(S.vel).normalize();
        const hit = W_.raycast(S.pos, dir, left + 0.3, { props: true, pad: 0.9 });
        if (!hit) { S.pos.addScaledVector(dir, left); break; }
        if (hit.target) {
          // Through whatever it cuts
          const t = hit.target;
          if (!(S.hits.get(t) > S.age - 0.3)) {
            S.hits.set(t, S.age);
            W_.damage(t, S.def.dmg, hit.point);
            fx.sparksBurst(hit.point, hit.normal, 14, 0xffc060, 30);
            this.sound.metalHit(hit.point, 0.6);
          }
          const adv = Math.min(left, hit.dist + (t.radius || 1) * 0.5 + 0.4);
          S.pos.addScaledVector(dir, adv);
          left -= adv;
          continue;
        }
        // Ricochet off the wall, biting into it
        S.pos.copy(hit.point).addScaledVector(hit.normal, 0.3);
        S.vel.reflect(hit.normal).multiplyScalar(0.86);
        left = Math.max(0, left - hit.dist) * 0.86;
        fx.sparksBurst(hit.point, hit.normal, 22, 0xffd080, 36);
        this.sound.metalHit(hit.point, 0.9);
        if (W_.destruct) W_.destruct.bullet(hit, { radius: 1.3, power: 160, dir, speed: 9, chunks: 6 });
        if (--S.bounces < 0) { dead = true; break; }
      }
      if (dead || S.age > S.life) {
        fx.sparksBurst(S.pos, UP, 18, 0xffe0a0, 25);
        fx.flash(S.pos, 2, 0xffd080, 0.08);
        this.scene.remove(S.obj);
        this.saws.splice(i, 1);
        continue;
      }
      // Spin flat along the line of flight
      S.spin += dt * 46;
      _b.copy(UP).addScaledVector(_a.copy(S.vel).normalize(), -_a.y);
      if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0);
      _q.setFromUnitVectors(UP, _b.normalize());
      _q2.setFromAxisAngle(UP, S.spin);
      S.obj.quaternion.multiplyQuaternions(_q, _q2);
      S.obj.position.copy(S.pos);
      if (Math.random() < 0.7) fx.sparks.emit(S.pos.x, S.pos.y, S.pos.z, rand(-3, 3), rand(-1, 3), rand(-3, 3), 0.25, 0.14, 0.04, 2.6, 1.6, 0.5, 1, 1, 0.4, 0.1, 0.4, 1, -10);
    }
  }

  // ---- grapple harpoon -------------------------------------------------------------------

  fireHarpoon(s, aim) {
    const def = s.def;
    const { pos, dir } = this.ws.muzzleRay(s, aim);
    s.model.head.visible = false;
    const obj = s.model.headOf();
    obj.scale.setScalar(this.worldScale(s));
    this.scene.add(obj);
    const cable = new THREE.Mesh(CABLE_GEO, CABLE_MAT);
    cable.frustumCulled = false;
    this.scene.add(cable);
    const hook = { s, obj, cable, pos, vel: dir.clone().multiplyScalar(def.speed), state: 'fly', dist: 0, def, anchor: null };
    s.hook = hook;
    this.hooks.push(hook);
    this.fx.muzzle(pos, dir, 0xffd0a0, 0.7);
    this.sound.harpoon(pos);
    s.recoil = 1;
  }

  updateHooks(dt) {
    const W_ = this.world, fx = this.fx;
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const h = this.hooks[i], s = h.s;
      const muz = s.model.muzzles[0].getWorldPosition(new V3());
      if (h.state === 'fly') {
        const sp = h.vel.length(), step = sp * dt, dir = _a.copy(h.vel).divideScalar(sp);
        const hit = W_.raycast(h.pos, dir, step, { props: true, pad: 0.4 });
        if (hit && hit.target) {
          W_.damage(hit.target, h.def.dmg, hit.point);
          if (hit.target.alive && W_.spiders && hit.target.kind !== 'tree' && hit.target.kind !== 'car') W_.spiders.stun(hit.target, h.def.stun);
          fx.sparksBurst(hit.point, hit.normal, 16, 0xffc070, 30);
          this.sound.metalHit(hit.point, 1);
          h.pos.copy(hit.point);
          h.state = 'retract';
        } else if (hit) {
          // Bitten into the wall: reel the frame in
          h.pos.copy(hit.point);
          h.state = 'anchored';
          this.ws.reel = { point: hit.point.clone(), normal: hit.normal.clone(), t: 0, active: true, hook: h };
          fx.sparksBurst(hit.point, hit.normal, 20, 0xffd090, 30);
          fx.dust(hit.point, 0.5, 5);
          this.sound.metalHit(hit.point, 1.2);
        } else {
          h.pos.addScaledVector(h.vel, dt);
          h.dist += step;
          if (h.dist > h.def.range) h.state = 'retract';
        }
        h.obj.quaternion.setFromUnitVectors(FWD, dir);
      } else if (h.state === 'anchored') {
        const R = this.ws.reel;
        if (!R || !R.active || R.hook !== h) h.state = 'retract';
        s.model.winch.rotation.x += dt * 20;
      } else {
        _a.subVectors(muz, h.pos);
        const d = _a.length();
        if (d < 3) {
          this.scene.remove(h.obj, h.cable);
          this.hooks.splice(i, 1);
          s.hook = null;
          s.model.head.visible = true;
          continue;
        }
        h.pos.addScaledVector(_a.divideScalar(d), Math.min(d, 280 * dt));
        h.obj.quaternion.setFromUnitVectors(FWD, _a.negate());
        s.model.winch.rotation.x -= dt * 30;
      }
      h.obj.position.copy(h.pos);
      // The cable from the muzzle to the head
      _b.subVectors(h.pos, muz);
      const len = _b.length();
      h.cable.position.copy(muz);
      h.cable.quaternion.setFromUnitVectors(UP, _b.divideScalar(len || 1));
      h.cable.scale.set(0.05, len, 0.05);
    }
  }

  // ---- bit drones ---------------------------------------------------------------------

  tickDrones(dt, s, trigger) {
    const def = s.def, M = s.model;
    if (!s.dstate) s.dstate = 'ready';
    if (s.dstate === 'recharge') {
      s.droneT -= dt;
      if (s.droneT <= 0) s.dstate = 'ready';
    } else if (s.dstate === 'active') {
      s.droneT -= dt;
      if (s.droneT <= 0) {
        s.dstate = 'return';
        for (const d of this.drones) if (d.s === s) d.state = 'return';
      }
    } else if (s.dstate === 'return') {
      if (!this.drones.some((d) => d.s === s)) { s.dstate = 'recharge'; s.droneT = def.recharge; }
    }
    if (s.dstate === 'ready' && trigger) this.launchDrones(s);
    for (let i = 0; i < M.docked.length; i++) {
      // A docked drone shows on the rack; it glows dim while recharging
      M.docked[i].visible = s.dstate === 'ready' || s.dstate === 'recharge' || (s.dstate === 'return' && !this.drones.some((d) => d.s === s && d.i === i));
    }
  }

  launchDrones(s) {
    const def = s.def, M = s.model;
    s.dstate = 'active';
    s.droneT = def.life;
    const k = this.worldScale(s);
    for (let i = 0; i < def.count; i++) {
      const obj = M.droneOf();
      obj.scale.setScalar(k * 1.3);
      const pos = M.muzzles[i].getWorldPosition(new V3());
      obj.position.copy(pos);
      this.scene.add(obj);
      const g = sprite(0x6dffd8, 1.2, 0.7);
      g.position.set(0, 0, -0.4);
      obj.add(g);
      this.drones.push({ s, i, obj, pos, vel: new V3(rand(-6, 6), 16 + i * 2, rand(-6, 6)), phase: (i / def.count) * Math.PI * 2, target: null, retarget: 0, cool: rand(0.4, 0.9), state: 'out', look: new V3(0, 0, 1) });
    }
    this.fx.flash(M.muzzles[0].getWorldPosition(_a), 3, 0x6dffd8, 0.1);
    this.sound.droneLaunch(_a);
  }

  updateDrones(dt) {
    const W_ = this.world, fx = this.fx, mech = this.ws.mech;
    if (!this.drones.length) return;
    const K = mech.rig.scale, home = mech.root.position, t = this.time;
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i], s = d.s;
      if (this.ws.slots[s.slot.id] !== s) { this.scene.remove(d.obj); this.drones.splice(i, 1); continue; }
      const want = _a;
      if (d.state === 'out') {
        d.retarget -= dt;
        if (d.retarget <= 0) {
          d.retarget = 0.5;
          // The held lock, else the nearest target to this drone within reach of the frame
          const hard = this.ws.hardTarget;
          d.target = null;
          if (hard && hard.alive && !hard.stealth && hard.pos.distanceTo(home) < 170) d.target = hard;
          else {
            let best = Infinity;
            for (const tg of W_.targets) {
              if (!tg.alive || tg.stealth || tg.pos.distanceTo(home) > 150) continue;
              const dd = tg.pos.distanceTo(d.pos) + (this.drones.some((o) => o !== d && o.target === tg) ? 25 : 0);
              if (dd < best) { best = dd; d.target = tg; }
            }
          }
        }
        const tg = d.target && d.target.alive ? d.target : null;
        if (tg) {
          // Circle the target, each drone at its own angle, and shoot down at it
          const a = d.phase + t * 0.7, r = 15 + 3 * Math.sin(t * 1.3 + d.phase);
          want.set(tg.pos.x + Math.cos(a) * r, tg.pos.y + 7 + Math.sin(t * 2 + d.phase) * 2, tg.pos.z + Math.sin(a) * r);
          d.look.subVectors(tg.pos, d.pos).normalize();
          d.cool -= dt;
          if (d.cool <= 0) {
            d.cool = rand(0.55, 0.85);
            if (this.inSight(d.pos, tg)) {
              const dir = _b.copy(tg.pos).addScaledVector(tg.vel || _c.set(0, 0, 0), d.pos.distanceTo(tg.pos) / DRONE_BOLT.speed * 0.8).sub(d.pos).normalize();
              s.bolt = s.bolt || { ...DRONE_BOLT, dmg: s.def.dmg };
              this.ws.spawnBolt(d.pos.clone(), dir.clone(), s.bolt);
              fx.flash(d.pos, 1.4, DRONE_BOLT.color, 0.06);
              this.sound.droneShot(d.pos);
            }
          }
        } else {
          // Nothing to hunt: hold station around the frame
          const a = d.phase + t * 0.8;
          want.set(home.x + Math.cos(a) * 7 * K, home.y + (7.5 + Math.sin(t * 2 + d.phase) * 0.5) * K, home.z + Math.sin(a) * 7 * K);
          d.look.lerp(_b.copy(d.vel).normalize(), 0.1).normalize();
        }
      } else {
        s.model.muzzles[d.i].getWorldPosition(want);
        if (d.pos.distanceTo(want) < 0.8) { this.scene.remove(d.obj); this.drones.splice(i, 1); continue; }
        d.look.lerp(_b.subVectors(want, d.pos).normalize(), 0.1).normalize();
      }
      // A stiff spring toward where it wants to be, harder when docking
      const kS = d.state === 'out' ? 5 : 14, kD = d.state === 'out' ? 3 : 7;
      d.vel.addScaledVector(_c.subVectors(want, d.pos), kS * dt).multiplyScalar(Math.exp(-kD * dt));
      const sp = d.vel.length();
      if (sp > 70) d.vel.multiplyScalar(70 / sp);
      if (d.state !== 'out' && d.pos.distanceTo(want) < 3) d.pos.lerp(want, 1 - Math.exp(-dt * 10));
      d.pos.addScaledVector(d.vel, dt);
      d.obj.position.copy(d.pos);
      if (d.look.lengthSq() > 0.5) d.obj.quaternion.setFromUnitVectors(FWD, d.look);
      if (Math.random() < 0.5) {
        _b.set(0, 0, -0.5).applyQuaternion(d.obj.quaternion).add(d.pos);
        fx.fire.emit(_b.x, _b.y, _b.z, -d.vel.x * 0.1, -d.vel.y * 0.1, -d.vel.z * 0.1, 0.12, 0.35, 0.05, 0.6, 2.4, 2, 1, 0.2, 0.8, 0.7, 0, 1, 0);
      }
    }
  }

  // ---- singularity projector -----------------------------------------------------------

  fireOrb(s, aim) {
    const def = s.def;
    const { pos, dir } = this.ws.muzzleRay(s, aim);
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), lit(0x050308)));
    obj.add(sprite(def.color, 4, 0.9));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 6, 24), lit(0xd0a8ff));
    obj.add(ring);
    obj.position.copy(pos);
    this.scene.add(obj);
    this.orbs.push({ obj, ring, pos, vel: dir.multiplyScalar(def.speed), age: 0, def });
    this.fx.flash(pos, 5, def.color, 0.15);
    this.fx.light(pos, def.color, 60, 0.25, 40);
    this.sound.gravLaunch(pos);
    s.recoil = 1;
  }

  updateOrbs(dt) {
    const W_ = this.world, fx = this.fx;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += dt;
      const sp = o.vel.length(), step = sp * dt, dir = _a.copy(o.vel).divideScalar(sp);
      const hit = W_.raycast(o.pos, dir, step + 0.6, { props: true, pad: 0.6 });
      if (hit || o.age > 1.8) {
        const p = hit ? hit.point.clone().addScaledVector(hit.normal, 3) : o.pos.clone();
        if (hit && hit.target) p.copy(hit.target.pos);
        this.scene.remove(o.obj);
        this.orbs.splice(i, 1);
        this.openWell(p, o.def);
        continue;
      }
      o.pos.addScaledVector(o.vel, dt);
      o.obj.position.copy(o.pos);
      o.ring.rotation.x += dt * 9; o.ring.rotation.y += dt * 6;
      fx.fire.emit(o.pos.x, o.pos.y, o.pos.z, rand(-2, 2), rand(-2, 2), rand(-2, 2), 0.3, 1.2, 0.2, 1.2, 0.5, 2.4, 1, 0.5, 0.2, 1, 0, 1, 0);
    }
  }

  openWell(p, def) {
    const obj = new THREE.Group();
    obj.position.copy(p);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), lit(0x000000));
    const disk = new THREE.Mesh(new THREE.RingGeometry(1.4, 3.2, 40, 1), new THREE.MeshBasicMaterial({ color: 0xb070ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    disk.rotation.x = -Math.PI / 2 + 0.35;
    const lens = sprite(0x8a50ff, 10, 0.4);
    obj.add(core, disk, lens);
    this.scene.add(obj);
    this.wells.push({ obj, core, disk, lens, pos: p.clone(), t: 0, life: def.life, def, tick: 0 });
    this.fx.flash(p, 9, 0xc89aff, 0.2);
    this.sound.gravWell(p, def.life);
  }

  updateWells(dt) {
    const W_ = this.world, fx = this.fx;
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i], def = w.def, R = def.radius, p = w.pos;
      w.t += dt;
      if (w.t >= w.life) { this.implode(w); this.wells.splice(i, 1); continue; }
      const k = smoothstep(0, 0.35, w.t) * (1 - smoothstep(w.life - 0.25, w.life, w.t) * 0.5);
      w.core.scale.setScalar(0.4 + 1.6 * k + 0.1 * Math.sin(w.t * 30));
      w.disk.scale.setScalar(1 + 2.4 * k);
      w.disk.rotation.z += dt * 5;
      w.lens.scale.setScalar(6 + 14 * k);
      // Everything in reach falls toward the center: spiders torn off their perches, scorpions pinned
      if (W_.spiders) W_.spiders.pull(p, R, dt);
      w.tick -= dt;
      if (w.tick <= 0) {
        w.tick = 0.25;
        for (const t of [...W_.targets]) {
          const d = t.pos.distanceTo(p);
          if (t.alive && d < R) W_.damage(t, def.dps * 0.25 * (1 - 0.6 * d / R), t.pos);
        }
        fx.light(p, def.color, 50, 0.3, R * 2);
        this.ws.onShake(p, 0.1);
      }
      // Matter spiraling in
      for (let q = 0; q < 6; q++) {
        _a.set(rand(-1, 1), rand(-0.6, 0.8), rand(-1, 1)).normalize();
        const r = rand(6, R);
        _b.copy(p).addScaledVector(_a, r);
        _c.crossVectors(_a, UP).normalize().multiplyScalar(rand(8, 14));
        const life = r / 26;
        fx.fire.emit(_b.x, _b.y, _b.z, -_a.x * 24 + _c.x, -_a.y * 24 + _c.y, -_a.z * 24 + _c.z, life, 0.9, 0.2,
          1.6, 0.9, 2.8, 1, 0.8, 0.4, 2.2, 0.6, 0, 0);
      }
      if (Math.random() < dt * 20) {
        _a.set(rand(-1, 1), rand(-0.2, 0.6), rand(-1, 1)).normalize();
        _b.copy(p).addScaledVector(_a, R * 0.8);
        fx.smoke.emit(_b.x, _b.y, _b.z, -_a.x * 16, -_a.y * 16, -_a.z * 16, 1.2, 2, 0.6, 0.12, 0.1, 0.16, 0.6, 0.1, 0.08, 0.14, 0, 0.2, 0);
      }
    }
  }

  implode(w) {
    const p = w.pos, def = w.def, W_ = this.world, fx = this.fx;
    this.scene.remove(w.obj);
    fx.flash(p, 26, 0xe8d0ff, 0.3);
    fx.explosion(p, 2.2, { normal: UP });
    fx.ring(p, 34, 0.7, UP, 0xc89aff);
    fx.ring(_a.copy(p), 22, 0.5, FWD, 0xb070ff);
    fx.light(p, 0xc89aff, 200, 0.5, 90);
    W_.damageRadius(p, def.splash, def.dmg);
    if (W_.destruct) W_.destruct.blast(p, 6.5, 1100);
    this.sound.implode(p);
    this.ws.onShake(p, 1.1);
  }

  // ---- siege cannon ---------------------------------------------------------------------

  aimArtillery(dt, s, aim) {
    const M = s.model;
    // Lift the barrel to the arc that lands on the reticle
    const muz = M.muzzles[0].getWorldPosition(_a);
    const v = ballistic(muz, aim.point, _b).normalize();
    M.pivot.parent.getWorldQuaternion(_q).invert();
    v.applyQuaternion(_q);
    v.y = clamp(v.y, -0.1, 0.94);
    v.x = clamp(v.x, -0.35, 0.35);
    _q2.setFromUnitVectors(FWD, v.normalize());
    M.pivot.quaternion.slerp(_q2, 1 - Math.exp(-dt * 5));
    M.slide.position.z = -s.recoil * 0.9;
  }

  fireShell(s, aim) {
    const def = s.def, fx = this.fx;
    const muz = s.model.muzzles[0].getWorldPosition(new V3());
    const vel = ballistic(muz, aim.point, new V3());
    const dir = _a.copy(vel).normalize();
    const obj = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.4, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a5e44, roughness: 0.5, metalness: 0.5 }));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8902e, roughness: 0.4, metalness: 0.7 }));
    nose.position.z = 1.0;
    obj.add(body, nose, sprite(0xffb060, 1.6, 0.8));
    obj.position.copy(muz);
    this.scene.add(obj);
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markerMat(0xff4030));
    marker.position.copy(aim.point).add(_b.set(0, 0.2, 0));
    marker.rotation.x = -Math.PI / 2;
    marker.scale.setScalar(def.splash * 1.4);
    marker.renderOrder = 3;
    this.scene.add(marker);
    this.shells.push({ obj, marker, pos: muz.clone(), prev: muz.clone(), vel, def, age: 0 });
    // Muzzle blast out of the brake, either side
    fx.flash(muz, 12, 0xffd8a0, 0.14);
    fx.light(muz, 0xffa040, 140, 0.3, 60);
    _c.crossVectors(dir, UP).normalize();
    for (let i = 0; i < 18; i++) {
      const sd = i % 2 ? 1 : -1, sp = rand(8, 22);
      fx.smoke.emit(muz.x, muz.y, muz.z, _c.x * sd * sp + dir.x * 4, rand(0, 3), _c.z * sd * sp + dir.z * 4, rand(1.5, 2.6), 1.6, 5, 0.75, 0.72, 0.68, 0.6, 0.8, 0.78, 0.75, 0, 1.6, 0.5);
    }
    fx.muzzle(muz, dir, 0xffa040, 2.2);
    this.sound.artillery(muz);
    this.ws.onShake(muz, 0.8);
    s.recoil = 1;
  }

  updateShells(dt) {
    const W_ = this.world, fx = this.fx;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const S = this.shells[i];
      S.age += dt;
      S.prev.copy(S.pos);
      S.vel.y -= SHELL_G * dt;
      const sp = S.vel.length(), dir = _a.copy(S.vel).divideScalar(sp);
      const hit = W_.raycast(S.pos, dir, sp * dt + 0.5, { props: true, pad: 0.8 });
      S.marker.material.opacity = 0.5 + 0.5 * Math.sin(S.age * 14);
      if (hit || S.age > 8) {
        const p = hit ? hit.point : S.pos, def = S.def;
        fx.explosion(p, 3.2, { normal: hit && hit.normal });
        fx.ring(_b.copy(p).add(_c.set(0, 0.3, 0)), 40, 0.7, UP, 0xffd0a0);
        this.sound.explosion(p, 3.2);
        W_.damageRadius(p, def.splash, def.dmg);
        if (hit && hit.target) W_.damage(hit.target, def.dmg * 0.5, p);
        if (W_.destruct) {
          _b.copy(p);
          if (hit) _b.addScaledVector(hit.normal, -1.2);
          W_.destruct.blast(_b, 7, 1500);
        }
        this.ws.onShake(p, 1.6);
        this.scene.remove(S.obj, S.marker);
        S.marker.material.dispose();
        this.shells.splice(i, 1);
        continue;
      }
      S.pos.addScaledVector(S.vel, dt);
      S.obj.position.copy(S.pos);
      S.obj.quaternion.setFromUnitVectors(FWD, dir);
      fx.trail(S.prev, S.pos, 1.4, 1.1, 2.2, 0.8, 0.3);
    }
  }

  // ---- mine layer -----------------------------------------------------------------------

  /** One mine out of a pod. ring: { i, n } to scatter a salvo around the frame, else tossed toward point */
  dropMine(s, tubeIndex, point, ring) {
    const def = s.def, M = s.model;
    const tube = M.tubes[tubeIndex % M.tubes.length];
    const pos = tube.getWorldPosition(new V3());
    const obj = M.mineOf();
    obj.scale.setScalar(this.worldScale(s) * 1.6);
    obj.position.copy(pos);
    this.scene.add(obj);
    let vel;
    if (ring) {
      const a = (this.ws.mech.root.rotation.y || 0) + (ring.i / ring.n) * Math.PI * 2 + rand(-0.15, 0.15);
      vel = new V3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(rand(10, 15));
      vel.y = rand(10, 13);
    } else {
      vel = _a.subVectors(point, pos).setY(0);
      if (vel.lengthSq() < 1) vel.set(Math.sin(this.ws.mech.root.rotation.y), 0, Math.cos(this.ws.mech.root.rotation.y));
      vel = vel.normalize().multiplyScalar(rand(13, 17)).clone();
      vel.y = 11;
    }
    const lamp = obj.children[obj.children.length - 1];
    this.mines.push({ obj, lamp, pos, vel, state: 'fly', t: 0, def, check: 0 });
    while (this.mines.length > MAX_MINES) this.detonate(this.mines.shift());
    this.sound.mineDrop(pos);
  }

  updateMines(dt) {
    const W_ = this.world;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.t += dt;
      if (m.state === 'fly') {
        m.vel.y -= 32 * dt;
        const sp = m.vel.length(), dir = _a.copy(m.vel).divideScalar(sp);
        const hit = W_.raycast(m.pos, dir, sp * dt + 0.2, { targets: false, props: true });
        if (hit) {
          m.pos.copy(hit.point).addScaledVector(hit.normal, 0.05);
          m.obj.quaternion.setFromUnitVectors(UP, hit.normal);
          m.state = 'arming';
          m.t = 0;
          this.fx.dust(m.pos, 0.3, 4);
          this.sound.metalHit(m.pos, 0.4);
        } else {
          m.pos.addScaledVector(m.vel, dt);
          m.obj.rotation.x += dt * 6;
        }
      } else if (m.state === 'arming') {
        m.lamp.visible = Math.sin(m.t * 30) > 0;
        if (m.t > 0.9) { m.state = 'armed'; m.t = 0; }
      } else if (m.state === 'armed') {
        m.lamp.visible = (m.t % 1.2) < 0.15;
        m.check -= dt;
        if (m.check <= 0) {
          m.check = 0.1;
          for (const t of W_.targets) {
            if (t.alive && t.pos.distanceTo(m.pos) < 7 + t.radius) { m.state = 'trip'; m.t = 0; this.sound.mineBeep(m.pos); break; }
          }
        }
        if (m.t > 90) { this.mines.splice(i, 1); this.scene.remove(m.obj); this.fx.sparksBurst(m.pos, UP, 6, 0xff8060, 8); continue; }
      } else if (m.state === 'trip') {
        m.lamp.visible = Math.sin(m.t * 60) > 0;
        if (m.t > 0.22) { this.mines.splice(i, 1); this.detonate(m); continue; }
      }
      m.obj.position.copy(m.pos);
    }
  }

  detonate(m) {
    const W_ = this.world, def = m.def;
    this.scene.remove(m.obj);
    this.fx.explosion(m.pos, 1.3, { normal: UP });
    this.sound.explosion(m.pos, 1.2);
    W_.damageRadius(m.pos, def.splash, def.dmg);
    if (W_.destruct) W_.destruct.blast(m.pos, 2.6, 380);
  }

  // ---- orbital uplink --------------------------------------------------------------------

  tickOrbital(dt, s, trigger, aim) {
    const def = s.def, M = s.model;
    const open = s.charge > 0 || s.strike ? 1 : 0;
    s.dish = (s.dish || 0) + (open - (s.dish || 0)) * (1 - Math.exp(-dt * 4));
    M.dish.rotation.x = -0.5 - 1.05 * s.dish;
    M.feed.material.opacity = s.dish * (0.6 + 0.4 * Math.random());
    if (s.strike) return;
    if (s.charge > 0) {
      s.charge += dt;
      // The designator paints the reticle while the satellite lines up
      const muz = M.muzzles[0].getWorldPosition(_a);
      if (!s.laser) {
        s.laser = new THREE.Mesh(BEAM_GEO, beamMaterial(0xff3030, 1.2, 0.18));
        s.laser.frustumCulled = false;
        s.laser.renderOrder = 6;
      }
      if (!s.laser.parent) this.scene.add(s.laser);
      _b.subVectors(aim.point, muz);
      const len = _b.length();
      s.laser.position.copy(muz);
      s.laser.quaternion.setFromUnitVectors(UP, _b.divideScalar(len || 1));
      s.laser.scale.set(1, len, 1);
      s.laser.material.uniforms.uAlpha.value = 0.6 + 0.4 * Math.random();
      s.markT = (s.markT || 0) - dt;
      if (s.markT <= 0) { s.markT = 0.3; this.fx.ring(_c.copy(aim.point).add(_d.set(0, 0.3, 0)), def.radius * 1.6, 0.35, UP, 0xff5040); }
      if (s.charge >= def.charge) {
        s.charge = 0;
        this.scene.remove(s.laser);
        this.startStrike(s, aim.point);
      }
      return;
    }
    if (!trigger || s.cool > 0) return;
    if (s.ammo <= 0) { s.reloadT = def.reload; this.sound.reload(); return; }
    s.charge = 1e-4;
    this.sound.uplink(M.muzzles[0].getWorldPosition(_a), def.charge);
  }

  startStrike(s, point) {
    const def = s.def;
    const core = new THREE.Mesh(BEAM_GEO, beamMaterial(def.color, 1.5, 0.1));
    const halo = new THREE.Mesh(BEAM_GEO, beamMaterial(0xffb040, 0.0, 0.1));
    for (const m of [core, halo]) { m.frustumCulled = false; m.renderOrder = 6; this.scene.add(m); }
    const st = { s, core, halo, pos: point.clone(), t: 0, tick: 0, carve: 0, ground: point.clone() };
    s.strike = st;
    s.beamT = def.duration;
    this.strikes.push(st);
    this.fx.flash(point, 30, 0xfff0c0, 0.3);
    this.sound.orbitalStrike(point);
    s.ammo--;
  }

  updateStrikes(dt, aim) {
    const W_ = this.world, fx = this.fx;
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const st = this.strikes[i], s = st.s, def = s.def;
      st.t += dt;
      s.beamT = Math.max(0, def.duration - st.t);
      if (st.t >= def.duration || this.ws.slots[s.slot.id] !== s) {
        this.endStrike(st);
        this.strikes.splice(i, 1);
        s.strike = null;
        s.cool = def.rate;
        if (s.ammo <= 0) { s.reloadT = def.reload; this.sound.reload(); }
        continue;
      }
      const k = smoothstep(0, 0.2, st.t) * (1 - smoothstep(def.duration - 0.4, def.duration, st.t));
      // It follows the reticle, slowly
      _a.subVectors(aim.point, st.pos).setY(0);
      const d = _a.length(), mv = Math.min(d, 15 * dt);
      if (d > 0.01) st.pos.addScaledVector(_a.divideScalar(d), mv);
      // Find what it is burning: the first surface straight down the column
      const top = _b.set(st.pos.x, Math.max(st.pos.y, 0) + 420, st.pos.z);
      const hit = W_.raycast(top, DOWN, 900, { props: true, targets: false });
      if (hit) st.ground.copy(hit.point);
      const g = st.ground;
      for (const [m, w] of [[st.core, 2.6], [st.halo, 10]]) {
        m.position.copy(g);
        m.quaternion.identity();
        m.scale.set(1, 420, 1);
        m.material.uniforms.uWidth.value = w * k * rand(0.92, 1.08);
        m.material.uniforms.uAlpha.value = k;
        m.material.uniforms.uTime.value = this.time;
      }
      this.sound.setOrbital(k);
      // Everything in the column burns
      for (const t of [...W_.targets]) {
        if (!t.alive) continue;
        if (Math.hypot(t.pos.x - g.x, t.pos.z - g.z) < def.radius + t.radius && t.pos.y > g.y - 3) W_.damage(t, def.dps * dt, t.pos);
      }
      st.tick -= dt;
      if (st.tick <= 0) {
        st.tick = 0.25;
        W_.damageRadius(g, def.radius, 25);
        fx.ring(_c.copy(g).add(_d.set(0, 0.3, 0)), def.radius * 2.4, 0.4, UP, 0xffd890);
        if (hit && hit.normal.y > 0.8 && !hit.struct) fx.scorch(g.x, g.z, def.radius * 1.6, g.y + 0.03);
        this.ws.onShake(g, 0.35);
      }
      // ...and it bores down through whatever it stands on
      if (hit && W_.destruct) {
        W_.destruct.beam(hit, DOWN, dt * 3, { radius: 2.6 });
        st.carve -= dt;
        if (st.carve <= 0) { st.carve = 0.18; W_.destruct.blast(_c.copy(g).add(_d.set(0, -0.5, 0)), 3.2, 700, { chunks: 8 }); }
      }
      for (let q = 0; q < 4; q++) {
        const a = rand(0, Math.PI * 2), r = rand(0, def.radius);
        fx.fire.emit(g.x + Math.cos(a) * r, g.y + 0.5, g.z + Math.sin(a) * r, Math.cos(a) * rand(4, 12), rand(6, 22), Math.sin(a) * rand(4, 12),
          rand(0.3, 0.6), 2, 4, 3.4, 2.8, 1.6, 1, 2, 0.8, 0.2, 0, 1.5, 2);
      }
      if (Math.random() < 0.6) {
        const gg = rand(0.2, 0.3);
        fx.smoke.emit(g.x + rand(-4, 4), g.y + 1, g.z + rand(-4, 4), rand(-3, 3), rand(4, 9), rand(-3, 3), rand(2, 3.5), 3, 9, gg, gg, gg, 0.6, gg + 0.2, gg + 0.2, gg + 0.2, 0, 0.8, 0.5);
      }
      if (Math.random() < 0.5) fx.light(_c.copy(g).add(_d.set(0, 4, 0)), 0xffd890, 160 * k, 0.12, 80);
    }
  }

  endStrike(st) {
    this.scene.remove(st.core, st.halo);
    st.core.material.dispose();
    st.halo.material.dispose();
    if (!this.strikes.some((o) => o !== st)) this.sound.setOrbital(0);
  }
}
