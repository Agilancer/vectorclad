import * as THREE from '../../js/three.js';
import { Mech } from '../../js/mech.js';
import { addOutline } from '../../js/atlas.js';

const V3 = THREE.Vector3;
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/**
 * AM-05 Amethyst: purple and white plate over a dark frame with copper fittings, after the user's
 * Vitruvian front and back sheet (reference-body.webp), the helm in profile (reference-head.webp)
 * and the back pylon (reference-pylon.webp). All of its armor comes from am05.glb, built in Blender
 * by tools/amethyst/build_am05.py: one group per rig joint, in that joint's own frame at rest.
 *
 * Like the Obsidian and the Pontifex it keeps the stock rig's joints, sockets, thrusters and
 * Mech.animate(), with its own proportions measured off the sheet (long legs, a long shin, broad
 * shoulders). The legs follow the user's blocky Bellerophon / BattleTech sheets and the arms their
 * arm sheet, in the Amethyst's colors. On top of the stock motion it stands upright, its pauldrons follow the arms part way,
 * the codpiece, rear plate and side skirts swing clear of the thighs, the fingers grip a held weapon,
 * and the two back pylons hang from sprung pivots that trail the body (the Obsidian's swing).
 * +Y up, +Z forward, game units.
 */
export class AmethystMech extends Mech {
  // Keep in step with LEG, HIP_X and rig() in tools/amethyst/build_am05.py
  static LEG = { hipDrop: 0.45, thigh: 2.2, shin: 3.5, foot: 1.2 };
  // Stands tall (knees bent about 45 degrees walking) with the feet just outside the hips
  static GAIT = { ...Mech.GAIT, bodyH: 6.9, homeX: 1.0, dip: 0.22 };
  // Knees point nearly straight ahead when walking and running, not bowed out like the stock frame's
  static KNEE_OUT = 0.1;
  static HIP_X = 0.78;
  // The whole frame, weapons and all, is drawn at this size (the rig scales footholds to match)
  static SIZE = 0.84;
  // Rest spread of the pylons' lower ends (radians), and their swing springs
  static PYLON = { spread: 0.24 };
  // The loaded am05.glb scene, set by loadAmethystDetail()
  static detail = null;

  constructor(mats, glowTex) {
    super(mats, glowTex);
    this.frameId = 'amethyst';
    this.frameName = 'AM-05 Amethyst';
    const src = AmethystMech.detail;
    if (!src) {
      // Without the GLB there is nothing to wear: keep the stock armor rather than an empty skeleton
      console.warn('AM-05: am05.glb not loaded, showing the stock armor');
      return;
    }
    // Strip the stock armor and hydraulics; keep joints, sockets and thrusters
    const keep = new Set();
    for (const t of this.allThrusters()) t.group.traverse((o) => keep.add(o));
    const old = [];
    this.root.traverse((o) => { if ((o.isMesh || o.isSprite) && !keep.has(o)) old.push(o); });
    for (const o of old) o.removeFromParent();
    for (const p of this.pistons) { p.barrel.removeFromParent(); p.rod.removeFromParent(); if (p.b && p.b.parent && !p.b.children.length) p.b.removeFromParent(); }
    this.pistons = [];
    this.outlines = this.outlines.filter((o) => keep.has(o));

    // Proportions (the leg lengths come from LEG through the stock buildLeg)
    this.waist.position.y = 0.2;
    this.chest.position.y = 0.75;
    this.head.position.set(0, 1.55, 0.16);
    this.backpack.position.set(0, 0.72, -0.89);
    this.head.scale.setScalar(1);
    for (const A of this.arms) {
      A.sh.position.set(A.s * 1.4, 1.0, -0.05);
      A.elbow.position.y = -1.15;
      A.hand.position.set(0, -1.4, 0.02);
    }
    for (const L of this.legs) {
      L.hip.position.x = L.s * AmethystMech.HIP_X;
      L.mount.position.set(L.s * 0.64, -1.7, -0.04); // leg weapon on the outer shin
    }
    // Back weapons ride above the copper back ports, clear of the pylon brackets
    for (const [key, s] of [['shoulderR', -1], ['shoulderL', 1]]) this.mounts[key].position.set(s * 0.62, 1.55, -1.12);

    this.applyDetail(src);
    this.seatThrusters();
    this.size = AmethystMech.SIZE;
    this.root.scale.setScalar(this.size);
  }

  /** Hang the GLB's armor on the rig: AM05_<joint> groups onto the matching joints, new pivots for the rest. */
  applyDetail(src) {
    const J = { body: this.body, pelvis: this.pelvis, waist: this.waist, chest: this.chest, head: this.head, backpack: this.backpack };
    for (const L of this.legs) { const k = L.s > 0 ? 'L' : 'R'; J['hip_' + k] = L.hip; J['knee_' + k] = L.knee; J['ankle_' + k] = L.ankle; }
    for (const A of this.arms) { const k = A.s > 0 ? 'L' : 'R'; J['shoulder_' + k] = A.sh; J['elbow_' + k] = A.elbow; J['hand_' + k] = A.hand; }
    this.pivots = {};
    const visuals = [];
    const graft = (from, to) => {
      for (const c of from.children) {
        const m = /^AM05_(.+)$/.exec(c.name);
        if (m) {
          let g = J[m[1]];
          if (!g) {
            g = new THREE.Group();
            g.name = c.name;
            g.position.copy(c.position); g.quaternion.copy(c.quaternion); g.scale.copy(c.scale);
            to.add(g);
            this.pivots[m[1]] = g;
          }
          graft(c, g);
        } else if (c.isMesh) {
          const k = c.clone();
          to.add(k);
          visuals.push(k);
        }
      }
    };
    graft(src, this.root);
    const quiet = /^(dt_|dc_)/;
    for (const o of visuals) {
      const mat = o.material;
      o.castShadow = o.receiveShadow = !/^(cyan|lens|decal)/.test(mat.name);
      if (quiet.test(o.name) || /^(cyan|lens)/.test(mat.name)) o.userData.noOutline = true;
      else this.outlines.push(...addOutline(o, 0.009));
    }
    // The extra pivots the motion layer drives
    const P = this.pivots;
    this.codpiece = P.codpiece; this.rearPlate = P.rearPlate;
    this.skirts = this.legs.map((L) => ({ L, g: P['skirt_' + (L.s > 0 ? 'L' : 'R')] }));
    this.pauldrons = this.arms.map((A) => ({ s: A.s, A, g: P['pauldron_' + (A.s > 0 ? 'L' : 'R')] }));
    for (const A of this.arms) {
      const k = A.s > 0 ? 'L' : 'R';
      A.fingers = [];
      for (let f = 0; f < 5; f++) {
        const thumb = f === 4, chain = [];
        for (let j = 0; j < (thumb ? 2 : 3); j++) chain.push(P[`finger_${k}_${f}_${j}`]);
        A.fingers.push({ chain, thumb, curl: 0.3, base: chain[0].rotation.z });
      }
    }
    this.pylons = this.arms.map((A) => {
      const pivot = P['pylon_' + (A.s > 0 ? 'L' : 'R')], s = A.s;
      pivot.rotation.set(0, 0, s * AmethystMech.PYLON.spread, 'YXZ');
      return { s, pivot, spread: AmethystMech.PYLON.spread, baseX: pivot.position.x, baseY: pivot.position.y, brake: 0, brakeV: 0, yaw: 0, yawV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0 };
    });
  }

  /** The stock thrusters, re-seated in the new armor (position and exhaust direction in parent space). */
  seatThrusters() {
    const seat = (t, pos, dir) => { t.group.position.set(...pos); t.group.quaternion.setFromUnitVectors(new V3(0, -1, 0), new V3(...dir).normalize()); };
    for (const s of [-1, 1]) {
      const i = (s + 1) / 2;
      // mains in the gray housings low on the back, verniers out of the copper back ports
      seat(this.thrusters.main[i], [s * 0.42, -0.98, -0.08], [0, -1, -0.35]);
      seat(this.thrusters.vern[i], [s * 0.66, 0.28, -0.22], [s * 0.1, 0.05, -1]);
    }
    this.legs.forEach((L, i) => {
      for (const k of [0, 1]) seat(this.thrusters.calf[2 * i + k], [L.s * 0.04 + (k ? 1 : -1) * 0.1, -2.5, -0.74], [0, -0.8, -0.6]);
      seat(this.thrusters.sole[i], [0, -1.08, -0.4], [0, -1, -0.25]);
    });
  }

  animate(dt, st) {
    const res = super.animate(dt, st);
    if (!this.pylons) return res;
    const w = this.w;
    // Stand upright: take most of the stock hunch out of the spine, keep the head and aim level
    const lift = 0.2 * (1 - w.crouch) * (1 - 0.6 * w.dash);
    this.waist.rotation.x -= lift;
    this.head.rotation.x += lift * 0.7;
    this.arms.forEach((A, i) => { A.sh.rotation.x += lift * w.aim[i]; });
    this.followParts(dt);
    this.swingPylons(dt);
    this.root.updateMatrixWorld(true);
    for (const t of this.thrusters.main) t.updateRams();
    return res;
  }

  /** Pauldrons follow the arms part way; codpiece, rear plate and skirts swing clear of the thighs; fingers grip a held weapon. */
  followParts(dt) {
    for (const P of this.pauldrons) {
      const r = P.A.sh.rotation;
      P.g.rotation.set(r.x * 0.3, 0, r.z * 0.35, 'YXZ');
    }
    let fwd = 0, back = 0;
    for (const S of this.skirts) {
      _v.set(0, -1, 0).applyQuaternion(S.L.hip.quaternion);
      const a = Math.atan2(_v.z, -_v.y), out = Math.atan2(_v.x * S.L.s, -_v.y);
      fwd = Math.max(fwd, a); back = Math.max(back, -a);
      S.g.rotation.set(-Math.max(0, a) * 0.55 + Math.max(0, -a) * 0.35, 0, S.L.s * Math.max(0, out) * 0.85);
    }
    this.codpiece.rotation.x = -fwd * 0.9;
    this.rearPlate.rotation.x = back * 0.9;
    for (const A of this.arms) {
      const holding = A.mount.children.length > 0;
      for (const F of A.fingers) {
        F.curl = dt > 0 ? damp(F.curl, holding ? (F.thumb ? 0.7 : 1.05) : 0.32, 10, dt) : F.curl;
        F.chain.forEach((g, j) => { g.rotation.z = (j ? 0 : F.base) - A.s * F.curl * (j ? 1 : 0.8); });
      }
    }
  }

  /**
   * The HV-02 Obsidian's pylon swing: each pylon hangs on an underdamped spring (about 1.4 Hz,
   * damping ratio 0.4) toward a drag pose set by the chest's velocity in its own frame. The lower
   * ends trail behind a dash and to the side away from a strafe, overshoot when the mech stops,
   * and while falling the pylons slide up and out with their lower ends flared like air brakes.
   */
  swingPylons(dt) {
    if (!(dt > 0)) return;
    const P = this._pylonMotion || (this._pylonMotion = { last: null, vel: new V3(), q: new THREE.Quaternion(), p: new V3() });
    this.chest.updateWorldMatrix(true, false);
    this.chest.matrixWorld.decompose(P.p, P.q, _scratch);
    if (P.last) {
      // Chest velocity in its own frame (x: the mech's left, y: up, z: forward), smoothed and
      // clamped so a teleport or respawn can't fling the pylons
      _scratch.subVectors(P.p, P.last).divideScalar(dt).applyQuaternion(P.q.invert()).clampLength(0, 40);
      P.vel.lerp(_scratch, 1 - Math.exp(-10 * dt));
    } else P.last = new V3();
    P.last.copy(P.p);
    const { x: vx, y: vy, z: vz } = P.vel, lim = (v, m) => Math.max(-m, Math.min(m, v));
    const n = Math.ceil(dt / (1 / 120)), h = dt / n;
    for (const W of this.pylons) {
      const s = W.s, k = s < 0 ? 80 : 72, c = 0.8 * Math.sqrt(k);
      const yaw = lim(-0.003 * vx - s * 0.005 * vz, 0.3);
      const brake = Math.max(0, Math.min(1, (-vy - 2) / 12));
      // + pitch swings the lower end back: it trails a forward dash and swings forward on a backstep
      const pitch = lim(0.006 * vz + 0.004 * Math.abs(vx), 0.3) + 0.22 * brake;
      const roll = lim(0.0055 * vx - s * 0.006 * Math.max(0, vy), 0.3) + s * 0.25 * brake;
      for (let i = 0; i < n; i++) {
        W.yawV += (k * (yaw - W.yaw) - c * W.yawV) * h; W.yaw += W.yawV * h;
        W.pitchV += (k * (pitch - W.pitch) - c * W.pitchV) * h; W.pitch += W.pitchV * h;
        W.rollV += (k * (roll - W.roll) - c * W.rollV) * h; W.roll += W.rollV * h;
        W.brakeV += (k * (brake - W.brake) - c * W.brakeV) * h; W.brake += W.brakeV * h;
      }
      W.pivot.rotation.set(W.pitch, W.yaw, W.roll + s * W.spread, 'YXZ');
      W.pivot.position.set(W.baseX + s * 0.3 * W.brake, W.baseY + 0.45 * W.brake, W.pivot.position.z);
    }
  }

  /** The sheet's Vitruvian stance, for comparing against reference-body.webp. The game never calls it. */
  poseReference() {
    if (!this.pylons) return;
    this.pelvis.rotation.set(0, 0, 0);
    this.waist.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    for (const L of this.legs) {
      this.legPose(L, 0, 0, 0.2, 0);
      L.ankle.rotation.set(0, L.s * 0.5, -L.s * 0.2);
    }
    let h = 0;
    for (const L of this.legs) h = Math.max(h, this.drop(L) + this.LEG.foot);
    this.body.position.set(0, h, 0);
    for (const A of this.arms) {
      A.sh.rotation.set(0, 0, A.s * 1.45);
      A.elbow.rotation.set(0, 0, 0);
      A.hand.rotation.set(0, 0, 0);
      A.pauldron.rotation.set(0, 0, 0);
      for (const F of A.fingers) F.curl = 0.15;
    }
    this.followParts(0);
    for (const W of this.pylons) {
      W.pivot.rotation.set(0, 0, W.s * W.spread, 'YXZ');
      W.pivot.position.set(W.baseX, W.baseY, W.pivot.position.z);
      W.yaw = W.yawV = W.pitch = W.pitchV = W.roll = W.rollV = W.brake = W.brakeV = 0;
    }
    this._pylonMotion = null;
    this.root.updateMatrixWorld(true);
    for (const t of this.thrusters.main) t.updateRams();
  }
}

const _v = new V3();
const _scratch = new V3();

/** Load am05.glb once, before the first AmethystMech is built. Decals are alpha-tested, glow parts unlit by tone mapping. */
export async function loadAmethystDetail(url = new URL('./am05.glb', import.meta.url).href) {
  if (AmethystMech.detail) return true;
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const scene = (await new GLTFLoader().loadAsync(url)).scene;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.name === 'decal') {
        m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true;
        m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
        m.side = THREE.FrontSide;
      } else if (m.name === 'cyan') {
        m.toneMapped = false; m.emissiveIntensity = 2.2;
      }
    });
    AmethystMech.detail = scene;
    return true;
  } catch (e) {
    console.warn('AM-05: could not load am05.glb', e);
    return false;
  }
}
