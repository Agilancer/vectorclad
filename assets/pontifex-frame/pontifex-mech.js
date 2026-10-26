import * as THREE from '../../js/three.js';
import { Mech } from '../../js/mech.js';
import { frontPrism, sidePrism, loft, chamferBox, cylX, addOutline, canvasTexture } from '../../js/atlas.js';

const V3 = THREE.Vector3;
const Y_UP = new V3(0, 1, 0);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
// Mirror an outline for a side: x is given for the left (+X) side and flipped for the right
const mx = (pts, s) => pts.map(([x, y, z]) => [x * s, y, z]);

/**
 * PX-09 Pontifex: white ceramic plate over a dark, segmented frame, after the user's front and
 * back reference sheet (reference.webp, drawn in a Vitruvian stance). It keeps the stock rig's
 * joints, sockets, thrusters and Mech.animate(), like the HV-02 Obsidian, but brings its own leg
 * proportions, measured off the sheet: against the stock frame its torso and arms match, its legs
 * are much longer (a long thigh, a longer shin and a tall boot). +Y up, +Z forward, game units.
 */
export class PontifexMech extends Mech {
  static LEG = { hipDrop: 0.22, thigh: 2.46, shin: 2.92, foot: 1.0 };
  static GAIT = { ...Mech.GAIT, bodyH: 6.0, homeX: 1.14, dip: 0.24 };
  // The whole frame, weapons and all, is drawn at this size (the rig scales footholds to match)
  static SIZE = 0.88;
  // The Blender-detailed armor (px09.glb, from tools/pontifex/detail_px09.py), set by loadPontifexDetail()
  static detail = null;

  constructor(mats, glowTex) {
    super(mats, glowTex);
    this.frameId = 'pontifex';
    this.frameName = 'PX-09 Pontifex';
    // Strip the stock armor; keep joints, sockets, thrusters and the leg and arm hydraulics
    const keep = new Set();
    for (const t of this.allThrusters()) t.group.traverse((o) => keep.add(o));
    for (const p of this.pistons) { keep.add(p.barrel); keep.add(p.rod); }
    const old = [];
    this.root.traverse((o) => { if ((o.isMesh || o.isSprite) && !keep.has(o)) old.push(o); });
    for (const o of old) o.removeFromParent();
    this.outlines = this.outlines.filter((o) => keep.has(o));
    // The head sits upright on the collar, so the stock neck rams go
    const onHead = (o) => { for (; o; o = o.parent) if (o === this.head) return true; return false; };
    this.pistons = this.pistons.filter((p) => {
      if (!onHead(p.b)) return true;
      p.barrel.removeFromParent(); p.rod.removeFromParent(); p.b.removeFromParent();
      return false;
    });
    // Proportions: an upright head, a torso 0.35 taller than the stock one, longer arms
    this.chest.position.y = 0.85;
    this.head.position.set(0, 1.36, 0.1);
    this.head.scale.setScalar(1);
    for (const A of this.arms) { A.elbow.position.y = -1.3; A.hand.position.y = -1.38; }
    for (const L of this.legs) L.mount.position.set(L.s * 0.48, -1.3, -0.08);
    this.visuals = [];
    this.buildArmor();
    if (PontifexMech.detail) this.applyDetail(PontifexMech.detail);
    for (const g of this.visuals) this.outlines.push(...addOutline(g, 0.009));
    this.size = PontifexMech.SIZE;
    this.root.scale.setScalar(this.size);
  }

  /**
   * Swap the code-built armor meshes for the detailed ones, group by group ("PX09 <part>" in both).
   * Joints, glow sprites, fingers, thrusters and pistons stay the code's, so the animation is unchanged.
   */
  applyDetail(src) {
    const M = this.pontifexMaterials;
    const extra = (this.pontifexDetailMats ||= {
      seam: new THREE.MeshStandardMaterial({ color: 0x5c6068, roughness: 0.5, metalness: 0.35 }),
    });
    const byName = {};
    src.traverse((o) => { if (/^PX09[ _]/.test(o.name)) byName[o.name.replace(/_/g, ' ')] = o; });
    const quiet = /^(seam|bolt|light|ventSlat|ramRod|ramCollar)/;
    for (const g of this.visuals) {
      const from = byName[g.name];
      if (!from) continue;
      const old = [];
      g.traverse((o) => { if (o.isMesh) old.push(o); });
      for (const o of old) o.removeFromParent();
      for (const c of from.children) g.add(c.clone(true));
      g.traverse((o) => {
        if (!o.isMesh) return;
        const role = (o.material.name || '').split('.')[0];
        o.material = M[role] || extra[role] || (role === 'decal' ? this.pontifexResources.decalMat : M.dark);
        o.castShadow = o.receiveShadow = role !== 'cyan' && role !== 'decal';
        if (quiet.test(o.name) || ['cyan', 'metal', 'red', 'seam', 'decal'].includes(role)) o.userData.noOutline = true;
      });
    }
  }

  buildArmor() {
    const std = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const plateTex = canvasTexture(256, (g, n) => {
      // Ceramic white with faint panel seams, bolt holes and small red service marks
      g.fillStyle = '#eeeff2'; g.fillRect(0, 0, n, n);
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      g.strokeStyle = 'rgba(120,124,134,0.55)'; g.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) {
        const x = rnd() * n, y = rnd() * n, w = 30 + rnd() * 90, h = 30 + rnd() * 90;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w + 12, y + h); g.stroke();
      }
      for (let i = 0; i < 18; i++) {
        g.fillStyle = rnd() < 0.55 ? '#c4262e' : '#5a5c63';
        const x = rnd() * n, y = rnd() * n;
        if (rnd() < 0.5) g.fillRect(x, y, 2 + rnd() * 6, 2); else { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
      }
    });
    plateTex.wrapS = plateTex.wrapT = THREE.RepeatWrapping;
    plateTex.anisotropy = 4;
    const M = (this.pontifexMaterials = {
      white: new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.36, metalness: 0.06 }),
      grey: std(0xd6d8dd, 0.38, 0.12),
      dark: std(0x2a2b30, 0.46, 0.58),
      dark2: std(0x46484f, 0.4, 0.62),
      metal: std(0x8d9097, 0.24, 0.9),
      red: std(0xc4262e, 0.45, 0.15),
      glass: new THREE.MeshStandardMaterial({ color: 0x0b1a20, roughness: 0.06, metalness: 0.9, emissive: 0x0a6a80, emissiveIntensity: 0.8 }),
      cyan: new THREE.MeshBasicMaterial({ color: 0x5ef2ff, toneMapped: false }),
    });
    const glowMat = new THREE.SpriteMaterial({
      map: this.glowTex, color: 0x48e8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.8,
    });
    const bTex = canvasTexture(128, (g, n) => {
      g.clearRect(0, 0, n, n); g.fillStyle = '#5b5c62';
      g.font = `bold ${n * 0.86}px Georgia, "Times New Roman", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('B', n / 2, n * 0.54);
    });
    const decalMat = new THREE.MeshStandardMaterial({ map: bTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.5 });

    const skin = (p, name) => { const g = new THREE.Group(); g.name = 'PX09 ' + name; p.add(g); this.visuals.push(g); return g; };
    const group = (p, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(rx, ry, rz); p.add(g); return g;
    };
    const mesh = (p, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, typeof mat === 'string' ? M[mat] : mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = m.receiveShadow = true;
      p.add(m);
      return m;
    };
    const box = (p, w, h, d, x, y, z, mat = 'dark', rx = 0, ry = 0, rz = 0) =>
      mesh(p, chamferBox(w, h, d, Math.min(w, h) * 0.2, Math.min(0.03, d * 0.2)), mat, x, y, z, rx, ry, rz);
    const rod = (p, a, b, r, mat = 'metal') => {
      a = new V3(...a); b = new V3(...b);
      const d = b.clone().sub(a), m = mesh(p, new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
      m.position.copy(a.add(b).multiplyScalar(0.5));
      m.quaternion.setFromUnitVectors(Y_UP, d.normalize());
      m.userData.noOutline = true;
      return m;
    };
    // Segmented mechanism between two points: the dark "muscle" bundles all over the frame
    const seg = (p, a, b, w, d, n, mat = 'dark') => {
      a = new V3(...a); b = new V3(...b);
      const dir = b.clone().sub(a), len = dir.length() / n;
      dir.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir);
      for (let i = 0; i < n; i++) {
        const k = i % 2 ? 0.86 : 1, m = mesh(p, chamferBox(w * k, len * 0.84, d * k, w * 0.3, 0.02), i % 2 ? 'dark2' : mat);
        m.position.copy(a).addScaledVector(dir, len * (i + 0.5));
        m.quaternion.copy(q);
      }
    };
    // Bearing disc: axis 'x' (facing sideways) or 'z' (facing forward)
    const disc = (p, x, y, z, r, axis = 'x', depth = 0.12) => {
      const g = new THREE.CylinderGeometry(r, r, depth, 18);
      if (axis === 'x') g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2);
      mesh(p, g, 'dark2', x, y, z);
      const ring = new THREE.TorusGeometry(r * 0.72, r * 0.1, 6, 18);
      if (axis === 'x') ring.rotateY(Math.PI / 2);
      const o = depth / 2 + 0.005;
      mesh(p, ring, 'metal', x + (axis === 'x' ? Math.sign(x || 1) * o : 0), y, z + (axis === 'z' ? Math.sign(z || 1) * o : 0)).userData.noOutline = true;
    };
    /**
     * Faceted armor plate. pts: its outline [x, y, z?] (z curves the plate back from its face),
     * seen from the front. The face rises by b to a ridge (default: the middle); the back sits t
     * behind and can bulge out by bk. at/rot place the plate, so rot [0, PI, 0] faces it backward.
     */
    const plate = (p, pts, { t = 0.15, b = 0.1, bk = 0, ridge, at = [0, 0, 0], rot = [0, 0, 0], mat = 'white' } = {}) => {
      pts = pts.map(([x, y, z = 0]) => [x, y, z]);
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; area += a[0] * c[1] - c[0] * a[1]; }
      if (area < 0) pts.reverse();
      const n = pts.length, avg = pts.reduce((s, q) => s.map((v, i) => v + q[i] / n), [0, 0, 0]);
      const R = ridge ? [ridge[0], ridge[1], avg[2] + b] : [avg[0], avg[1], avg[2] + b];
      const Bk = [R[0], R[1], avg[2] - t - bk];
      const v = [], tri = (a, c, d) => v.push(...a, ...c, ...d);
      for (let i = 0; i < n; i++) {
        const a = pts[i], c = pts[(i + 1) % n], a2 = [a[0], a[1], a[2] - t], c2 = [c[0], c[1], c[2] - t];
        tri(a, c, R); tri(a, a2, c); tri(c, a2, c2); tri(c2, a2, Bk);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      const uv = [];
      for (let i = 0; i < v.length; i += 3) uv.push(v[i] * 0.7 + v[i + 2] * 0.35, v[i + 1] * 0.7);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return mesh(p, g, mat, at[0], at[1], at[2], rot[0], rot[1], rot[2]);
    };
    // A plate on the outer face of a limb: outline given as [forward, y], placed d out on side s,
    // turned toward the front by o.turn
    const side = (p, s, d, pts, o = {}) =>
      plate(group(p, s * d, 0, o.fz || 0, 0, s * (Math.PI / 2 - (o.turn || 0)), 0), pts.map(([f, y, z]) => [-s * f, y, z]), o);
    const fin = (pts, w, ys = [1, 1], zs = [1, 1]) => {
      let g = sidePrism(pts, w, 0.02);
      if (g.index) g = g.toNonIndexed();
      g.computeBoundingBox();
      const bb = g.boundingBox, sz = bb.getSize(new V3()), q = g.attributes.position;
      for (let i = 0; i < q.count; i++) {
        const ny = (q.getY(i) - bb.min.y) / (sz.y || 1), nz = (q.getZ(i) - bb.min.z) / (sz.z || 1);
        q.setX(i, q.getX(i) * (ys[0] + (ys[1] - ys[0]) * ny) * (zs[0] + (zs[1] - zs[0]) * nz));
      }
      g.deleteAttribute('normal');
      g.computeVertexNormals();
      return g;
    };
    const glow = (p, x, y, z, size) => {
      const g = new THREE.Sprite(glowMat); g.scale.setScalar(size); g.position.set(x, y, z); g.renderOrder = 6; p.add(g); return g;
    };
    const dash = (p, x, y, z, w = 0.08, h = 0.025, ry = 0) => { mesh(p, new THREE.BoxGeometry(w, h, 0.012), 'red', x, y, z, 0, ry, 0).userData.noOutline = true; };

    // ---- pelvis: a belt chevron, a long pointed codpiece and a broad rear plate ----
    const pel = skin(this.pelvis, 'pelvis');
    mesh(pel, loft([{ y: 0.3, w: 0.78, d: 0.6, c: 0.14, z: -0.02 }, { y: 0.02, w: 1.0, d: 0.72, c: 0.18 }, { y: -0.3, w: 0.6, d: 0.56, c: 0.14 }]), 'dark');
    mesh(pel, cylX(0.17, 1.5), 'dark2', 0, -0.2, 0);
    plate(pel, [[-0.34, 0.26], [0.34, 0.26], [0.28, 0.06], [0, -0.06], [-0.28, 0.06]], { t: 0.14, b: 0.06, at: [0, 0, 0.42] });
    for (const s of [-1, 1]) seg(pel, [s * 0.3, 0.25, 0.3], [s * 0.42, -0.25, 0.3], 0.16, 0.18, 3);
    // The codpiece and rear plate hang from pivots so the thighs can push them aside (animate)
    this.codpiece = group(this.pelvis, 0, -0.04, 0.38);
    const cod = skin(this.codpiece, 'codpiece');
    plate(cod, [[-0.26, 0], [0.26, 0], [0.25, -0.42], [0.11, -0.92], [0, -1.06], [-0.11, -0.92], [-0.25, -0.42]], { t: 0.16, b: 0.13, ridge: [0, -0.36], at: [0, 0, 0.04] });
    for (const s of [-1, 1]) dash(cod, s * 0.12, -0.2, 0.15, 0.06, 0.02, -s * 0.5);
    this.rearPlate = group(this.pelvis, 0, 0.04, -0.34);
    const rear = skin(this.rearPlate, 'rear plate');
    plate(rear, [[-0.6, 0.28], [0.6, 0.28], [0.52, -0.3], [0.14, -0.98], [0, -1.08], [-0.14, -0.98], [-0.52, -0.3]], { t: 0.16, b: 0.12, ridge: [0, -0.22], rot: [0, Math.PI, 0] });
    plate(rear, [[-0.28, 0.12], [0.28, 0.12], [0, -0.62]], { t: 0.06, b: 0.05, at: [0, 0, -0.17], rot: [0, Math.PI, 0] });
    dash(rear, 0, 0.0, -0.24, 0.1, 0.03);

    // ---- waist: a narrow spine, stacked abdominals and side bundles ----
    const wa = skin(this.waist, 'waist');
    mesh(wa, new THREE.CylinderGeometry(0.3, 0.36, 1.15, 12), 'dark', 0, 0.37, -0.02);
    for (let i = 0; i < 6; i++) box(wa, 0.5 - 0.035 * i, 0.12, 0.2, 0, 0.8 - 0.15 * i, 0.27, 'dark2');
    for (let i = 0; i < 6; i++) box(wa, 0.3, 0.12, 0.16, 0, 0.8 - 0.15 * i, -0.3, 'dark2');
    for (const s of [-1, 1]) {
      seg(wa, [s * 0.36, -0.25, 0.08], [s * 0.52, 0.95, 0.14], 0.18, 0.24, 7);
      rod(wa, [s * 0.2, -0.2, -0.22], [s * 0.26, 0.95, -0.26], 0.04);
    }

    // ---- chest: shield plate over a dark core, pecs, collar, ribs; the back carries two disc jets ----
    const ch = skin(this.chest, 'chest');
    mesh(ch, loft([
      { y: -0.05, w: 0.95, d: 0.72, c: 0.18, z: -0.06 }, { y: 0.5, w: 1.72, d: 1.02, c: 0.26, z: -0.08 },
      { y: 1.0, w: 2.0, d: 1.1, c: 0.3, z: -0.1 }, { y: 1.3, w: 1.36, d: 0.84, c: 0.22, z: -0.12 },
    ]), 'dark');
    plate(ch, [[-0.46, 1.12], [0.46, 1.12], [0.53, 0.8], [0.3, 0.46], [0, 0.16], [-0.3, 0.46], [-0.53, 0.8]], { t: 0.24, b: 0.17, ridge: [0, 0.78], at: [0, 0, 0.56] });
    plate(ch, [[-0.3, 1.34], [0.3, 1.34], [0.36, 1.18], [-0.36, 1.18]], { t: 0.16, b: 0.05, at: [0, 0.05, 0.5], rot: [-0.35, 0, 0] });
    plate(ch, [[-0.64, -0.36], [0.64, -0.36], [0.7, 0.18], [0.34, 0.42], [-0.34, 0.42], [-0.7, 0.18]], { t: 0.14, b: 0.07, at: [0, 1.32, -0.1], rot: [-Math.PI / 2, 0, 0] });
    box(ch, 0.1, 0.1, 0.06, 0, 0.06, 0.34, 'cyan').userData.noOutline = true;
    glow(ch, 0, 0.06, 0.4, 0.3);
    for (const s of [-1, 1]) {
      plate(ch, mx([[0.48, 1.1], [0.92, 1.18], [1.04, 0.88], [0.86, 0.56], [0.54, 0.68]], s), { t: 0.2, b: 0.1, at: [0, 0, 0.7], rot: [0, s * 0.38, 0] });
      mesh(ch, new THREE.SphereGeometry(0.045, 10, 8), 'cyan', s * 0.33, 0.38, 0.62).userData.noOutline = true;
      glow(ch, s * 0.33, 0.38, 0.66, 0.16);
      // Collar plates around the neck
      plate(ch, mx([[0.12, 1.16], [0.44, 1.2], [0.56, 1.36], [0.3, 1.46], [0.12, 1.4]], s), { t: 0.3, b: 0.08, at: [0, 0, 0.24], rot: [-0.5, 0, 0] });
      // Ribs under the arm
      for (let i = 0; i < 4; i++) box(ch, 0.12, 0.42, 0.2, s * (0.86 + 0.02 * i), 0.36, 0.28 - 0.14 * i, i % 2 ? 'dark2' : 'dark', 0, 0, s * 0.18);
      seg(ch, [s * 0.5, 0.05, 0.36], [s * 0.86, 0.9, 0.42], 0.16, 0.18, 4);
      // Back: flank plates either side of the spine, and the round vernier housings with cyan rings
      plate(ch, mx([[0.18, 1.34], [0.36, 1.28], [0.34, 0.5], [0.22, 0.34], [0.16, 0.8]], s).map(([x, y]) => [-x, y]), { t: 0.2, b: 0.08, at: [0, 0, -0.66], rot: [0, Math.PI, 0] });
      plate(ch, mx([[0.42, 1.36], [0.96, 1.22], [0.98, 1.08], [0.5, 1.2]], s).map(([x, y]) => [-x, y]), { t: 0.2, b: 0.06, at: [0, 0, -0.58], rot: [0.3, Math.PI, 0] });
      disc(ch, s * 0.64, 0.92, -0.7, 0.28, 'z', 0.26);
      mesh(ch, new THREE.TorusGeometry(0.19, 0.035, 8, 24), 'cyan', s * 0.64, 0.92, -0.84).userData.noOutline = true;
      glow(ch, s * 0.64, 0.92, -0.88, 0.32);
      seg(ch, [s * 0.86, 0.2, -0.5], [s * 0.4, 0.2, -0.62], 0.16, 0.18, 3);
    }
    for (let i = 0; i < 3; i++) {
      plate(ch, [[-0.14, 0], [0.14, 0], [0.12, -0.25], [0, -0.33], [-0.12, -0.25]], { t: 0.2, b: 0.07, at: [0, 1.3 - 0.31 * i, -0.68], rot: [0, Math.PI, 0] });
    }

    // ---- head: the "Assault" helm from the head sheet. A rounded box housing whose tail slopes
    // down behind, a bow-shaped front plate creased down the middle to a low point, an open
    // underside of rams and hoses on a tray with splayed legs. No face: an eye slit in each side of the wedge ----
    const hd = skin(this.head, 'head');
    const tube = (p, pts, r, mat = 'metal') => {
      const m = mesh(p, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new V3(...q))), 12, r, 6), mat);
      m.userData.noOutline = true;
    };
    // A closed solid from a list of polygons (3D points), each turned to face out from the middle,
    // or along dirs[i] where given (a thin slab's faces can't be told apart from the middle)
    const hull = (p, polys, mat, dirs = []) => {
      const all = polys.flat(), c = all.reduce((a, q) => a.map((v, i) => v + q[i] / all.length), [0, 0, 0]);
      const v = [], A = new V3(), B = new V3(), C = new V3(), n = new V3(), m = new V3();
      polys.forEach((poly, k) => { for (let i = 1; i < poly.length - 1; i++) {
        A.set(...poly[0]); B.set(...poly[i]); C.set(...poly[i + 1]);
        n.subVectors(B, A).cross(m.subVectors(C, A));
        if (dirs[k]) m.set(...dirs[k]);
        else m.set(A.x + B.x + C.x, A.y + B.y + C.y, A.z + B.z + C.z).divideScalar(3).sub(new V3(...c));
        v.push(...(n.dot(m) >= 0 ? [...poly[0], ...poly[i], ...poly[i + 1]] : [...poly[0], ...poly[i + 1], ...poly[i]]));
      } });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      const uv = [];
      for (let i = 0; i < v.length; i += 3) uv.push(v[i] * 0.7 + v[i + 2] * 0.35, v[i + 1] * 0.7);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return mesh(p, g, mat);
    };
    // Tray on four splayed legs, with a rim
    box(hd, 0.66, 0.06, 0.78, 0, 0.04, -0.1, 'grey');
    for (const sx of [-1, 1]) box(hd, 0.04, 0.08, 0.78, sx * 0.33, 0.1, -0.1, 'grey');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(hd, 0.05, 0.24, 0.12, sx * 0.4, -0.04, -0.1 + sz * 0.34, 'grey', 0, 0, sx * 0.55);
    // Underside: rams, hoses and a cable run out the back of the tray
    mesh(hd, new THREE.CylinderGeometry(0.12, 0.15, 0.4, 10), 'dark', 0, 0.28, -0.1);
    for (const sx of [-1, 1]) {
      for (const [z0, z1] of [[0.12, 0.02], [-0.3, -0.18]]) {
        rod(hd, [sx * 0.2, 0.1, z0], [sx * 0.24, 0.3, (z0 + z1) / 2], 0.05, 'dark2');
        rod(hd, [sx * 0.24, 0.3, (z0 + z1) / 2], [sx * 0.22, 0.5, z1], 0.03);
      }
      seg(hd, [sx * 0.1, 0.1, 0.12], [sx * 0.12, 0.48, 0.16], 0.1, 0.12, 3);
      for (const k of [0, 1]) tube(hd, [[sx * (0.06 + 0.08 * k), 0.48, -0.2], [sx * (0.12 + 0.08 * k), 0.26, -0.46], [sx * (0.1 + 0.08 * k), 0.12, -0.62], [sx * (0.1 + 0.08 * k), 0.08, -0.82]], 0.03, k ? 'dark2' : 'dark');
    }
    // Housing: a flat top rounded over at the front, the tail sloping down behind (side profile [z, y])
    mesh(hd, sidePrism([[0.32, 0.5], [0.36, 0.9], [0.3, 1.02], [0.18, 1.07], [-0.3, 1.07], [-0.52, 0.98], [-0.66, 0.74], [-0.66, 0.5], [-0.4, 0.44]], 0.74, 0.04), 'white');
    for (const sx of [-1, 1]) {
      // Side panel with three bolt holes and slash vents
      side(hd, sx, 0.37, [[0.04, 0.98], [-0.5, 0.94], [-0.6, 0.72], [-0.6, 0.52], [-0.1, 0.5], [0.04, 0.6]], { t: 0.04, b: 0.03 });
      for (const [z, y] of [[-0.42, 0.66], [-0.5, 0.6], [-0.42, 0.56]]) mesh(hd, cylX(0.026, 0.06, 8), 'dark', sx * 0.4, y, z).userData.noOutline = true;
      for (let i = 0; i < 3; i++) box(hd, 0.02, 0.12, 0.035, sx * 0.405, 0.86, -0.2 - 0.08 * i, 'dark', 0.45, 0, 0);
    }
    // Bow-shaped front plate: two faces meeting at a crease that juts forward, the bottom edges
    // rising back from a low point, 0.44 proud of the housing (3 inches on a 6 ft human)
    const T = 0.08, Ct = [0, 0.94, 0.62], Cb = [0, 0.12, 0.8];
    for (const sx of [-1, 1]) {
      const St = [sx * 0.42, 0.98, 0.26], Sb = [sx * 0.42, 0.52, 0.2], back = (q) => [q[0] * 0.9, q[1], q[2] - T];
      const F = [Ct, St, Sb, Cb], Bk = F.map(back);
      hull(hd, [F, Bk, ...F.map((q, i) => [q, F[(i + 1) % 4], Bk[(i + 1) % 4], Bk[i]])], 'white', [[sx, 0, 1.2], [-sx, 0, -1.2]]);
      // A notch where the plate's edge meets the side, as on the sheet
      plate(hd, mx([[0.34, 0.66], [0.42, 0.62], [0.42, 0.56], [0.36, 0.6]], sx), { t: 0.04, b: 0.02, at: [0, 0, 0.24], rot: [0, sx * 0.9, 0], mat: 'dark' });
      dash(hd, sx * 0.2, 0.6, 0.52, 0.02, 0.1, sx * 0.75);
      // The eye: a slit set into this face of the wedge near its top, running along the top edge
      const P = (u, w) => new V3(...Ct).lerp(new V3(...St), u).lerp(new V3(...Cb).lerp(new V3(...Sb), u), w);
      const ex = new V3(...St).sub(new V3(...Ct)).normalize(), ez = new V3().crossVectors(ex, P(0, 1).sub(new V3(...Ct)));
      if (ez.dot(new V3(sx, 0, 1)) < 0) ez.negate();
      ez.normalize();
      const eye = group(hd);
      eye.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, new V3().crossVectors(ez, ex), ez));
      eye.position.copy(P(0.5, 0.16)).addScaledVector(ez, 0.005);
      mesh(eye, new THREE.BoxGeometry(0.26, 0.07, 0.04), 'dark');
      mesh(eye, new THREE.BoxGeometry(0.22, 0.03, 0.03), 'cyan', 0, 0, 0.012).userData.noOutline = true;
      glow(eye, 0, 0, 0.06, 0.32);
    }

    // ---- legs: long white thighs marked B, knee guards, flared shins, tall wedge boots ----
    for (const L of this.legs) {
      const s = L.s;
      const th = skin(L.hip, 'thigh ' + s);
      mesh(th, new THREE.SphereGeometry(0.3, 14, 10), 'dark');
      mesh(th, loft([{ y: 0.1, w: 0.8, d: 0.84, c: 0.18 }, { y: -0.7, w: 1.08, d: 1.0, c: 0.24, z: 0.02 }, { y: -1.7, w: 0.92, d: 0.86, c: 0.2 }, { y: -2.32, w: 0.6, d: 0.64, c: 0.14 }]), 'dark');
      seg(th, [s * 0.5, -0.3, -0.22], [s * 0.44, -2.1, -0.2], 0.22, 0.3, 6);
      seg(th, [-s * 0.3, -0.25, 0.12], [-s * 0.26, -2.15, 0.1], 0.2, 0.26, 7);
      seg(th, [-s * 0.08, -0.4, -0.4], [-s * 0.06, -2.1, -0.32], 0.26, 0.2, 6);
      plate(th, mx([[-0.42, -0.2, -0.08], [0.18, -0.06], [0.56, -0.42, -0.1], [0.6, -1.3, -0.08], [0.42, -1.98, -0.02], [0.04, -2.24], [-0.34, -1.85, -0.04], [-0.48, -0.9, -0.1]], s),
        { t: 0.24, b: 0.12, ridge: [s * 0.1, -0.95], at: [0, 0, 0.52] });
      plate(th, mx([[-0.3, -1.2], [0.36, -1.3], [0.3, -1.85], [0.04, -2.06], [-0.22, -1.78]], s), { t: 0.06, b: 0.05, at: [0, 0, 0.66], mat: 'grey' });
      { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), decalMat); d.position.set(s * 0.24, -0.6, 0.65); d.userData.noOutline = true; th.add(d); }
      side(th, s, 0.5, [[0.4, 0.6], [-0.12, 0.5], [-0.48, 0.02], [-0.46, -0.95], [-0.1, -1.4], [0.38, -1.06], [0.52, -0.2]], { t: 0.2, b: 0.12, turn: 0.55, fz: 0.12 });
      plate(th, [[-0.32, -0.5], [0.36, -0.45], [0.42, -1.4], [0.25, -2.0], [-0.2, -1.95], [-0.38, -1.3]], { t: 0.16, b: 0.1, at: [0, 0, -0.42], rot: [0, Math.PI, 0] });
      mesh(th, loft([{ y: -2.1, w: 0.62, d: 0.3, c: 0.08, z: 0.32 }, { y: -2.48, w: 0.5, d: 0.26, c: 0.07, z: 0.36 }]), 'dark2');
      dash(th, s * 0.43, -1.45, 0.5, 0.03, 0.12);
      disc(th, -s * 0.36, -2.46, 0.04, 0.2, 'x');

      const sh = skin(L.knee, 'shin ' + s);
      mesh(sh, cylX(0.3, 0.74), 'dark');
      disc(sh, -s * 0.4, 0, 0.02, 0.22, 'x', 0.1);
      mesh(sh, loft([
        { y: 0.02, w: 0.68, d: 0.78, c: 0.16, z: -0.06 }, { y: -0.9, w: 0.82, d: 0.92, c: 0.2, z: -0.12 },
        { y: -1.9, w: 0.6, d: 0.68, c: 0.15, z: -0.06 }, { y: -2.6, w: 0.48, d: 0.54, c: 0.12 }, { y: -2.95, w: 0.44, d: 0.5, c: 0.1 },
      ]), 'dark');
      plate(sh, mx([[-0.38, 0.18], [0.3, 0.24], [0.46, -0.3], [0.4, -1.02], [0.04, -1.24], [-0.32, -0.98], [-0.42, -0.32]], s), { t: 0.24, b: 0.15, ridge: [s * 0.02, -0.4], at: [0, 0, 0.42], rot: [-0.08, 0, 0] });
      // Knee blade jutting forward and up past the joint, like the Vanguard's
      mesh(sh, fin([[0.4, -0.62], [0.74, -0.3], [0.94, 0.4], [0.78, 1.02], [0.58, 0.46], [0.4, 0.12]], 0.5, [1, 0.3]), 'white');
      mesh(sh, fin([[0.86, 0.36], [0.74, 0.86], [0.7, 0.8], [0.8, 0.34]], 0.52, [1, 0.3]), 'red');
      plate(sh, mx([[-0.3, -1.12, -0.02], [0.36, -1.06], [0.5, -1.6], [0.64, -2.35, -0.06], [0.42, -2.66], [-0.02, -2.76], [-0.32, -2.3, -0.04]], s), { t: 0.2, b: 0.12, ridge: [s * 0.12, -1.85], at: [0, 0, 0.36] });
      side(sh, s, 0.42, [[0.34, -0.15], [-0.4, -0.3], [-0.56, -1.4], [-0.38, -2.45], [0.28, -2.62], [0.44, -1.45]], { t: 0.18, b: 0.1, turn: 0.35 });
      plate(sh, mx([[-0.2, -0.1], [0.22, -0.06], [0.28, -0.7], [0.02, -0.92], [-0.22, -0.66]], s), { t: 0.06, b: 0.05, at: [0, 0, 0.6], rot: [-0.08, 0, 0], mat: 'grey' });
      // Calf leaves either side of the jet bay
      for (const sd of [-1, 1]) {
        plate(sh, mx([[0.1, -0.3], [0.36, -0.36], [0.4, -1.3], [0.3, -2.3], [0.12, -2.0]], sd).map(([x, y]) => [-x, y]), { t: 0.14, b: 0.08, at: [0, 0, -0.5], rot: [0, Math.PI, 0] });
      }
      box(sh, 0.42, 0.36, 0.14, 0, -1.72, -0.44, 'dark2');
      seg(sh, [-s * 0.3, -1.3, -0.05], [-s * 0.26, -2.6, 0.0], 0.16, 0.22, 5);
      for (const [x, y, z] of [[0.3, -2.5, 0.14], [-0.3, -2.55, 0.1], [0, -2.66, -0.3], [0.36, -2.78, -0.12], [-0.36, -2.8, -0.14]]) box(sh, 0.26, 0.38, 0.28, x, y, z, 'dark2', 0, 0, x * 0.4);
      dash(sh, s * 0.3, -0.5, 0.6, 0.03, 0.1);
      dash(sh, s * 0.48, -2.0, 0.37, 0.03, 0.14);

      const ft = skin(L.ankle, 'boot ' + s);
      mesh(ft, new THREE.SphereGeometry(0.24, 12, 10), 'dark2');
      mesh(ft, loft([{ y: 0.2, w: 0.52, d: 0.56, c: 0.12 }, { y: -0.45, w: 0.68, d: 0.8, c: 0.16, z: 0.06 }]), 'dark');
      for (const sd of [-1, 1]) { box(ft, 0.16, 0.6, 0.62, sd * 0.42, -0.12, 0.02, 'dark2', 0, 0, -sd * 0.16); box(ft, 0.12, 0.34, 0.44, sd * 0.5, -0.5, 0.2, 'dark', 0.3, 0, -sd * 0.2); }
      plate(ft, [[-0.24, 0.1], [0.24, 0.1], [0.28, -0.3], [0, -0.42], [-0.28, -0.3]], { t: 0.1, b: 0.07, at: [0, 0, 0.36], rot: [0.25, 0, 0] });
      mesh(ft, sidePrism([[-0.52, -0.5], [-0.5, -1.0], [1.55, -1.0], [1.56, -0.94], [0.75, -0.66], [0.32, -0.36], [-0.3, -0.3]], 0.7, 0.03), 'dark');
      for (let i = 0; i < 3; i++) box(ft, 0.56 - 0.1 * i, 0.08, 0.38, 0, -0.44 - 0.16 * i, 0.36 + 0.34 * i, 'dark2', 0.72, 0, 0);
      for (const sd of [-1, 1]) {
        side(ft, sd, 0.37, [[-0.42, -0.52], [0.38, -0.6], [1.05, -0.84], [1.0, -0.97], [-0.48, -0.97]], { t: 0.1, b: 0.06 });
        box(ft, 0.03, 0.06, 1.1, sd * 0.37, -0.96, 0.5, 'red');
        // Side claws splayed off the toe, red tipped
        const claw = group(ft, sd * 0.22, 0, 0.5, 0, sd * 0.32, 0);
        mesh(claw, sidePrism([[0, -0.62], [0.85, -0.95], [0.88, -1.0], [0, -1.0]], 0.18, 0.02), 'dark2');
        mesh(claw, sidePrism([[0.62, -0.88], [0.9, -0.99], [0.62, -1.0]], 0.19, 0.005), 'red');
      }
      mesh(ft, sidePrism([[1.28, -0.94], [1.62, -1.0], [1.28, -1.0]], 0.32, 0.005), 'red');
      plate(ft, [[-0.3, -0.35], [0.3, -0.35], [0.34, -0.9], [-0.34, -0.9]], { t: 0.1, b: 0.06, at: [0, 0, -0.5], rot: [0, Math.PI, 0] });
      mesh(ft, sidePrism([[-0.45, -0.52], [-0.84, -0.86], [-0.76, -0.98], [-0.42, -0.98]], 0.22, 0.02), 'dark2');
    }

    // ---- arms: dark segmented upper arms, white gauntlets with elbow fins, five-fingered hands ----
    for (const A of this.arms) {
      const s = A.s;
      const up = skin(A.sh, 'upper arm ' + s);
      up.scale.y = -A.elbow.position.y / 1.12; // drawn for a 1.12 upper arm
      mesh(up, new THREE.SphereGeometry(0.3, 14, 10), 'dark');
      mesh(up, loft([{ y: -0.12, w: 0.44, d: 0.48, c: 0.11 }, { y: -0.6, w: 0.5, d: 0.52, c: 0.12 }, { y: -1.06, w: 0.4, d: 0.44, c: 0.1 }]), 'dark');
      seg(up, [0, -0.25, 0.24], [0, -0.98, 0.2], 0.22, 0.16, 4);
      seg(up, [0, -0.25, -0.24], [0, -0.98, -0.2], 0.22, 0.16, 4);
      side(up, s, 0.25, [[0.26, -0.12], [-0.26, -0.18], [-0.3, -0.62], [0, -0.82], [0.3, -0.58]], { t: 0.14, b: 0.08 });

      const fa = skin(A.elbow, 'forearm ' + s);
      fa.scale.y = -A.hand.position.y / 1.24; // drawn for a 1.24 forearm
      mesh(fa, cylX(0.22, 0.5), 'dark2');
      mesh(fa, loft([{ y: -0.02, w: 0.44, d: 0.5, c: 0.11 }, { y: -0.6, w: 0.5, d: 0.56, c: 0.12 }, { y: -1.15, w: 0.36, d: 0.42, c: 0.1 }]), 'dark');
      seg(fa, [0, -0.15, -0.28], [0, -1.05, -0.22], 0.24, 0.16, 5);
      side(fa, s, 0.25, [[0.32, 0.12], [-0.3, 0.06], [-0.38, -0.5], [-0.24, -1.1], [0.04, -1.3], [0.3, -1.02], [0.4, -0.42]], { t: 0.2, b: 0.13, turn: 0.25 });
      side(fa, s, 0.33, [[0.2, -0.2], [-0.16, -0.24], [-0.2, -0.7], [0.02, -0.9], [0.22, -0.66]], { t: 0.06, b: 0.05, turn: 0.25, mat: 'grey' });
      plate(fa, mx([[-0.2, -0.05], [0.22, -0.02], [0.24, -0.8], [0.05, -1.12], [-0.18, -0.8]], s), { t: 0.16, b: 0.09, at: [0, 0, 0.27] });
      plate(fa, mx([[0.2, 0.1], [0.3, -0.34], [0.5, 0.2], [0.6, 0.5], [0.36, 0.3]], s), { t: 0.12, b: 0.05, at: [0, 0, 0.06] });
      if (s > 0) side(fa, s, 0.27, [[0.2, -1.0], [-0.14, -1.04], [-0.04, -1.62], [0.04, -1.8], [0.16, -1.44]], { t: 0.1, b: 0.06 });
      dash(fa, s * 0.38, -0.5, 0.12, 0.012, 0.1, s * Math.PI / 2);

      const hn = skin(A.hand, 'hand ' + s);
      box(hn, 0.34, 0.34, 0.42, 0, -0.16, 0, 'dark');
      side(hn, s, 0.17, [[0.18, -0.02], [-0.18, -0.02], [-0.16, -0.28], [0.16, -0.3]], { t: 0.06, b: 0.04 });
      // Fingers stacked along Z (the index on top when aiming), curling in toward the palm
      A.fingers = [];
      const lens = [0.2, 0.17, 0.15];
      for (let k = 0; k < 5; k++) {
        const thumb = k === 4, chain = [];
        let par = A.hand;
        for (let j = 0; j < (thumb ? 2 : 3); j++) {
          const g = new THREE.Group();
          if (j) g.position.set(0, -lens[j - 1], 0);
          else if (thumb) { g.position.set(-s * 0.15, -0.12, 0.15); g.rotation.set(0.3, 0, -s * 0.5); }
          else g.position.set(s * 0.04, -0.33, 0.13 - 0.087 * k);
          par.add(g);
          if (!j) this.visuals.push(g);
          const l = lens[j];
          if (j === (thumb ? 1 : 2)) mesh(g, new THREE.ConeGeometry(0.04, l, 4).rotateX(Math.PI), 'dark2', 0, -l / 2, 0);
          else { mesh(g, chamferBox(0.075, l * 0.9, 0.08, 0.015, 0.012), 'dark', 0, -l / 2, 0); mesh(g, chamferBox(0.03, l * 0.5, 0.06, 0.01, 0.008), 'grey', s * 0.045, -l * 0.45, 0); }
          chain.push(g);
          par = g;
        }
        A.fingers.push({ chain, thumb, curl: 0.3 });
      }
    }

    // ---- pauldrons: big swept white blades on the torso that follow the arms part way (animate) ----
    this.pauldrons = this.arms.map((A) => {
      const s = A.s, g = group(this.chest, A.sh.position.x, A.sh.position.y, A.sh.position.z);
      const pd = skin(g, 'pauldron ' + s);
      mesh(pd, loft([{ y: 0.34, w: 0.74, d: 0.72, c: 0.16, x: s * 0.02 }, { y: -0.14, w: 0.64, d: 0.64, c: 0.14, x: s * 0.1 }]), 'dark');
      box(pd, 0.5, 0.42, 0.64, -s * 0.42, 0.08, -0.02, 'dark2', 0, 0, s * 0.3);
      seg(pd, [-s * 0.62, 0.2, 0.2], [s * 0.1, -0.2, 0.3], 0.16, 0.2, 4);
      const blade = group(pd, 0, 0, 0.06, 0, s * 0.3, 0);
      plate(blade, mx([[-0.56, 0.46], [-0.3, 0.72], [0.6, 1.24], [0.68, 1.08], [0.54, 0.56], [0.62, 0.22], [0.44, -0.16], [-0.08, -0.2], [-0.48, 0.1]], s),
        { t: 0.92, b: 0.26, bk: 0.26, ridge: [s * 0.18, 0.5], at: [0, 0, 0.3] });
      plate(blade, mx([[-0.28, 0.56], [0.34, 0.88], [0.4, 0.52], [0.24, 0.18], [-0.16, 0.24]], s), { t: 0.08, b: 0.05, at: [0, 0.02, 0.48], mat: 'grey' });
      plate(blade, mx([[0.3, 0.3], [0.86, 0.82], [0.7, 0.3], [0.52, 0.04]], s), { t: 0.56, b: 0.12, bk: 0.12, at: [0, 0, 0.0] });
      plate(blade, mx([[-0.4, 0.4], [0.5, 0.9], [0.5, 0.5], [0.36, -0.1], [-0.06, -0.14]], s).map(([x, y]) => [-x, y]), { t: 0.06, b: 0.04, at: [0, 0, -0.7], rot: [0, Math.PI, 0], mat: 'grey' });
      const sfin = group(pd, s * 0.32, 0.86, -0.38, 0, 0, -s * 0.12);
      mesh(sfin, fin([[0.1, 0], [-0.4, 0.3], [-1.0, 0.95], [-0.86, 0.52], [-0.34, -0.1]], 0.1, [1, 1], [0.4, 1]), 'white');
      mesh(sfin, fin([[-0.42, 0.22], [-0.88, 0.7], [-0.84, 0.62], [-0.42, 0.14]], 0.12, [1, 1], [0.5, 1]), 'red');
      dash(blade, s * 0.3, 0.62, 0.52, 0.12, 0.025, 0);
      dash(blade, s * 0.1, 0.3, 0.5, 0.03, 0.03, 0);
      return { s, g, A };
    });

    // ---- thrusters, seated in the new armor (position and exhaust direction in parent space) ----
    const seat = (t, pos, dir) => { t.group.position.set(...pos); t.group.quaternion.setFromUnitVectors(new V3(0, -1, 0), new V3(...dir).normalize()); };
    const bp = skin(this.backpack, 'thruster housings');
    for (const s of [-1, 1]) {
      const wing = skin(group(this.backpack, s * 0.46, 0.5, -0.24, 0.2, s * 0.35, -s * 1.12), 'back wing ' + s);
      mesh(wing, fin([[0.1, 0.0], [-0.42, 0.32], [-1.5, 0.92], [-1.36, 0.58], [-0.4, -0.2]], 0.09, [1, 1], [0.4, 1]), 'white');
      mesh(wing, fin([[-0.5, 0.2], [-1.3, 0.7], [-1.26, 0.62], [-0.5, 0.12]], 0.11, [1, 1], [0.5, 1]), 'red');
      box(wing, 0.2, 0.26, 0.3, 0, 0.02, 0.04, 'dark2');
    }
    for (const s of [-1, 1]) {
      // Mains under the shoulder blades, low on the back
      mesh(bp, loft([{ y: -0.1, w: 0.5, d: 0.56, c: 0.12, z: -0.02, x: s * 0.34 }, { y: -0.62, w: 0.6, d: 0.66, c: 0.14, z: -0.18, x: s * 0.34 }, { y: -0.98, w: 0.58, d: 0.62, c: 0.14, z: -0.34, x: s * 0.34 }]), 'dark');
      plate(bp, mx([[0.1, -0.08], [0.6, -0.12], [0.62, -0.62], [0.36, -0.86], [0.12, -0.64]], s).map(([x, y]) => [-x, y]), { t: 0.1, b: 0.06, at: [0, 0, -0.5], rot: [-0.3, Math.PI, 0] });
      seat(this.thrusters.main[(s + 1) / 2], [s * 0.34, -0.5, -0.12], [0, -1, -0.45]);
      // Verniers fire out of the cyan-ringed discs on the back
      seat(this.thrusters.vern[(s + 1) / 2], [s * 0.64, 0.2, -0.14], [s * 0.12, 0.05, -1]);
    }
    this.legs.forEach((L, i) => {
      for (const k of [0, 1]) seat(this.thrusters.calf[2 * i + k], [(k ? 1 : -1) * 0.1, -1.76, -0.5], [0, -0.8, -0.6]);
      seat(this.thrusters.sole[i], [0, -0.66, -0.36], [0, -1, -0.25]);
      // Knee hydraulics behind the thigh
      for (const p of this.pistons) if (p.parent === L.hip) { p.a.set(0, -1.0, -0.42); p.b.position.set(0, -0.55, -0.42); }
    });
    for (const p of this.pistons) { p.barrel.material = M.dark2; p.rod.material = M.metal; }
    for (const t of this.thrusters.main) for (const R of t.rams) R.barrel.material = M.dark2;
    this.pontifexResources = { plateTex, bTex, decalMat, glowMat };
  }

  animate(dt, st) {
    const res = super.animate(dt, st);
    const w = this.w;
    // Stand upright: take most of the stock hunch out of the spine, keep the head and aim level
    const lift = 0.2 * (1 - w.crouch) * (1 - 0.6 * w.dash);
    this.waist.rotation.x -= lift;
    this.head.rotation.x += lift * 0.7;
    this.arms.forEach((A, i) => { A.sh.rotation.x += lift * w.aim[i]; });
    this.followParts(dt);
    this.root.updateMatrixWorld(true);
    for (const p of this.pistons) p.update();
    for (const t of this.thrusters.main) t.updateRams();
    return res;
  }

  /** Pauldrons follow the arms part way; the codpiece and rear plate swing clear of the thighs; fingers grip a held weapon. */
  followParts(dt) {
    for (const P of this.pauldrons) {
      const r = P.A.sh.rotation;
      P.g.rotation.set(r.x * 0.22, 0, (r.z - P.s * 0.2) * 0.3, 'YXZ');
    }
    let fwd = 0, back = 0;
    for (const L of this.legs) {
      _v.set(0, -1, 0).applyQuaternion(L.hip.quaternion);
      const a = Math.atan2(_v.z, -_v.y);
      fwd = Math.max(fwd, a); back = Math.max(back, -a);
    }
    this.codpiece.rotation.x = -fwd * 0.9;
    this.rearPlate.rotation.x = back * 0.9;
    for (const A of this.arms) {
      const holding = A.mount.children.length > 0;
      for (const F of A.fingers) {
        F.curl = dt > 0 ? damp(F.curl, holding ? (F.thumb ? 0.7 : 1.05) : 0.32, 10, dt) : F.curl;
        F.chain.forEach((g, j) => { g.rotation.z = (F.thumb && !j ? -A.s * 0.5 : 0) - A.s * F.curl * (j ? 1 : 0.8); });
      }
    }
  }

  /**
   * The sheet's Vitruvian stance, for comparing against reference.webp: arms out and down,
   * legs apart, the right hand open, the left closed to a point, the right foot turned out.
   */
  poseReference() {
    this.pelvis.rotation.set(0, 0, 0);
    this.waist.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    for (const L of this.legs) {
      this.legPose(L, -0.2, 0.42, 0.15, -0.36);
      L.ankle.rotation.set(-0.2, L.s < 0 ? -1.2 : 0.3, -L.s * 0.1);
    }
    let h = 0;
    for (const L of this.legs) h = Math.max(h, this.drop(L) + this.LEG.foot);
    this.body.position.set(0, h, 0);
    for (const A of this.arms) {
      A.sh.rotation.set(0.02, 0, A.s * 1.04);
      A.elbow.rotation.set(-0.06, 0, 0);
      A.hand.rotation.set(0, -Math.PI / 2, A.s * 0.2);
      A.pauldron.rotation.set(0, 0, 0);
      for (const F of A.fingers) F.curl = A.s > 0 ? 0.02 : 0.18;
    }
    this.followParts(0);
    for (const A of this.arms) if (A.s < 0) A.fingers.forEach((F, k) => { if (!F.thumb) F.chain[0].rotation.x = (k - 1.5) * 0.12; });
    this.root.updateMatrixWorld(true);
    for (const p of this.pistons) p.update();
    for (const t of this.thrusters.main) t.updateRams();
  }
}

const _v = new V3();

/** Load the detailed armor once, before the first PontifexMech is built; without it the code-built armor is used. */
export async function loadPontifexDetail(url = new URL('./px09.glb', import.meta.url).href) {
  if (PontifexMech.detail) return true;
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    PontifexMech.detail = (await new GLTFLoader().loadAsync(url)).scene;
    return true;
  } catch (e) {
    console.warn('PX-09: using the code-built armor', e);
    return false;
  }
}
