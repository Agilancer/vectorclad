import * as THREE from './three.js';
import {
  plateGeo, hullGeo, jointGeo, plateMatrix, paletteMaterial, paletteMesh, paintInstances, beamMesh, drawBeam, capsuleDist,
} from './frameParts.js';

// ---------------------------------------------------------------------------
// Medium spider-frames: twice the size of the small ones, slow, tough, and too
// heavy to leap. They are spiders (js/spiders.js walks and draws them); this
// module gives them their goals, their way across gaps, their gear and their
// abilities.
//
// Instead of leaping between buildings, a medium spider bridges: it walks to
// the edge of its roof facing a neighbour and, if the gap is within its leg
// span and the roofs are close enough in height, stretches across, rear feet
// gripping one roof and front feet the other, until its whole body is over.
// A gap too wide and it climbs down, crosses the street and climbs up again.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// ---------------------------------------------------------------------------
// Variants. Fields as for spiders, plus:
//   range: how far from what it's after it likes to stand (the mech, or its allies for support kinds)
//   support: keeps near other frames rather than the mech
//   front: share of direct fire its frontal shield lets through (Bulwark)
//   dome: shield dome hit points (Warden); mend: repair per second (Mender)
//   pull: tractor beam strength (Magnetar); boulder: throws chunks of its building (Quarrier)
// ---------------------------------------------------------------------------
export const MEDIUMS = {
  bulwark: {
    name: 'BULWARK', size: [2.15, 2.4], hp: 300, speed: 0.42, legs: 1.12, abdomen: [1.2, 1.1, 1.05],
    weapon: 'gatling', range: [25, 90], linger: 2.4, front: 0.25,
    palette: { tint: [1.05, 1.0, 0.72], lift: 0.05, accent: [1, 0.78, 0.05], glow: [1, 0.55, 0.08] },
  },
  warden: {
    name: 'WARDEN', size: [2.0, 2.2], hp: 200, speed: 0.45, legs: 1.15, abdomen: [1.1, 1.15, 1.1],
    weapon: 'dome', range: [10, 45], support: true, linger: 2.6, dome: 240,
    palette: { tint: [0.55, 0.62, 1.15], lift: 0.04, accent: [1, 0.78, 0.25], glow: [1, 0.85, 0.45] },
  },
  mender: {
    name: 'MENDER', size: [2.0, 2.2], hp: 170, speed: 0.48, legs: 1.15, abdomen: [0.95, 0.95, 1.25],
    weapon: 'mend', range: [12, 40], support: true, linger: 2.2, mend: 32,
    palette: { tint: [1.45, 1.5, 1.42], lift: 0.5, accent: [0.15, 0.95, 0.45], glow: [0.3, 1, 0.55] },
  },
  magnetar: {
    name: 'MAGNETAR', size: [2.1, 2.35], hp: 220, speed: 0.44, legs: 1.12, abdomen: [1.05, 1.05, 1.15],
    weapon: 'tractor', range: [40, 120], linger: 2.4, pull: 1,
    palette: { tint: [1.25, 1.28, 1.35], lift: 0.32, accent: [0.95, 0.05, 0.08], glow: [0.35, 0.6, 1.4] },
  },
  quarrier: {
    name: 'QUARRIER', size: [2.2, 2.4], hp: 260, speed: 0.4, legs: 1.1, abdomen: [1.3, 1.2, 1.1],
    weapon: 'boulder', range: [40, 150], linger: 2.6, boulder: true,
    palette: { tint: [1.2, 1.1, 0.95], lift: 0.22, accent: [1, 0.42, 0.05], glow: [1, 0.85, 0.2] },
  },
};
for (const id in MEDIUMS) Object.assign(MEDIUMS[id], { id, medium: true, leap: 0, perch: MEDIUMS[id].range, roof: 0.85 });

// Tractor beam and boulders
const TRACTOR = { range: 140, charge: 0.8, hold: 3.2, cool: [6, 8] };
const BOULDER = { gravity: 30, dmg: 26, splash: 9, size: 1.6 };
const SPAN = 5.0;   // body units from the rear feet's rest spots to the front feet's
const BARREL_L = new V3(-0.36, -0.42, 2.95), BARREL_R = new V3(0.36, -0.42, 2.95);

const UP = new V3(0, 1, 0), DOWN = new V3(0, -1, 0);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _g = new V3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _col = new THREE.Color();

// Gear, per spider, in body units (see spiders.js bodyLocals): how many of each part a slot holds
const GEAR = { plate: 1, barrel: 2, orb: 1, disc: 2, arm: 2, fin: 2 };

// Shield dome: a fresnel rim, a lattice, and a ripple running out from where it was hit
const DOME_VERT = /* glsl */`
varying vec3 vN; varying vec3 vW; varying vec3 vL;
void main() {
  vL = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const DOME_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uAlpha; uniform vec3 uHit; uniform float uHitT; uniform float uTime; uniform float uR;
varying vec3 vN; varying vec3 vW; varying vec3 vL;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.6);
  float a = atan(vL.z, vL.x) * 7.0, b = asin(clamp(vL.y, -1.0, 1.0)) * 9.0;
  float lat = max(smoothstep(0.93, 1.0, abs(sin(a + b * 0.5))), smoothstep(0.93, 1.0, abs(sin(b + uTime * 0.6))));
  float rip = 0.0;
  if (uHitT < 1.0) rip = smoothstep(uR * 0.12, 0.0, abs(distance(vW, uHit) - uHitT * uR * 1.2)) * (1.0 - uHitT);
  float k = (0.02 + rim * 0.38 + lat * 0.1 + rip * 1.2) * uAlpha;
  gl_FragColor = vec4(uColor * k, 1.0);
}`;

export class MediumKin {
  constructor(swarm, { scene, tex, cap }) {
    this.sw = swarm;
    this.scene = scene;
    this.cap = cap;
    this.nb = new Map();        // bridgeable neighbours of each roof
    this.domes = [];
    this.beams = [];
    this.boulders = [];

    // Gear, palette-swapped like the spiders' own parts
    const mat = paletteMaterial(tex.spider, tex.spiderGlow);
    const geos = { plate: plateGeo('thorax'), barrel: plateGeo('claw'), orb: hullGeo('joint'), disc: jointGeo(), arm: plateGeo('tibia'), fin: plateGeo('spine') };
    this.parts = {};
    for (const key in GEAR) {
      const m = paletteMesh(scene, geos[key], mat, cap * GEAR[key]);
      m.per = GEAR[key];
      this.parts[key] = m;
    }

    // Beam pool for mend and tractor beams
    for (let i = 0; i < 10; i++) {
      const core = beamMesh(0xffffff), glow = beamMesh(0xffffff);
      scene.add(core, glow);
      this.beams.push({ core, glow, busy: false });
    }

    // Boulders: rough, lit chunks of building
    const rock = new THREE.DodecahedronGeometry(1, 1);
    const p = rock.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _a.fromBufferAttribute(p, i);
      const k = 0.8 + 0.4 * Math.abs(Math.sin(_a.x * 5.1 + _a.y * 3.7) * Math.cos(_a.z * 4.3 - _a.x * 2.1));
      p.setXYZ(i, _a.x * k, _a.y * k * 0.85, _a.z * k);
    }
    rock.computeVertexNormals();
    this.rockMesh = new THREE.InstancedMesh(rock, new THREE.MeshStandardMaterial({ color: 0x8c867d, roughness: 0.95, metalness: 0.05, flatShading: true }), 24);
    this.rockMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rockMesh.castShadow = true;
    this.rockMesh.frustumCulled = false;
    this.rockMesh.count = 0;
    scene.add(this.rockMesh);
    this.domeGeo = new THREE.IcosahedronGeometry(1, 4);
  }

  clear() {
    for (const d of [...this.domes]) this.dropDome(d);
    for (const b of this.beams) { b.busy = false; b.core.visible = b.glow.visible = false; }
    this.boulders.length = 0;
  }

  // ---- spawning and leaving ----------------------------------------------------------

  /** Called by the swarm when a medium spider spawns */
  spawned(s) {
    s.ability = { t: 0, phase: null, cool: rand(1.5, 3.5) };
    s.lift = 0;
    this.paint(s);
    if (s.v.dome) this.raiseDome(s);
  }

  paint(s) {
    const pal = s.v.palette, tint = pal.tint;
    for (const key in this.parts) {
      const mesh = this.parts[key];
      paintInstances(mesh, s.slot * mesh.per, mesh.per, pal, tint);
    }
  }

  /** Called by the swarm when a medium spider dies: its dome and beams go, a held boulder drops */
  died(s) {
    if (s.dome) this.dropDome(s.dome);
    if (s.beam) this.endBeam(s);
    if (s.ability) s.ability.phase = null;
    s.bridge = null;
    for (const b of this.boulders) if (b.held === s) b.held = null;
  }

  /** Called by the swarm when a medium spider's body is gone */
  release(s) {
    _m.makeScale(0, 0, 0);
    for (const key in this.parts) {
      const mesh = this.parts[key];
      for (let k = 0; k < mesh.per; k++) mesh.setMatrixAt(s.slot * mesh.per + k, _m);
    }
    this.died(s);
  }

  // ---- damage hooks ---------------------------------------------------------------------

  /** Share of a hit that gets through: a Bulwark's shield turns away most of what comes from in front */
  through(s, from) {
    if (!s.v.front) return 1;
    _a.copy(from || this.sw.P.pos).sub(s.c);
    _a.addScaledVector(s.n, -_a.dot(s.n));
    if (_a.lengthSq() < 1e-4) return 1;
    if (_a.normalize().dot(s.f) < 0.35) return 1;
    // Direct fire mostly glances off; blasts still get round the edges
    const k = from ? 0.6 : s.v.front;
    if (!from) this.sw.fx.sparksBurst(this.sw.bodyPoint(s, _b.set(0, 0.9, 2.1), _b), s.f, 6, 0xffd070, 18);
    return k;
  }

  /** Does a shield dome stand between s and a blast at `from`? */
  covered(s, from) {
    for (const d of this.domes) {
      if (!d.alive) continue;
      // (a shot bursting on the dome goes off a little inside its surface)
      if (s.c.distanceTo(d.pos) < d.radius && from.distanceTo(d.pos) > d.radius - 1.5) return true;
    }
    return false;
  }

  // ---- goals and moving -------------------------------------------------------------------

  /** Who it's after: the mech, or, for support kinds, the middle of the frames around it */
  anchor(s, P, out) {
    if (s.v.support) {
      let n = 0;
      out.set(0, 0, 0);
      for (const o of this.sw.list) {
        if (o === s || !o.alive || o.v.support || o.hidden || o.c.distanceTo(s.c) > 140) continue;
        out.add(o.c);
        n++;
      }
      if (n) return out.divideScalar(n);
    }
    return out.copy(P.pos);
  }

  crawl(s, dt, P) {
    s.timer -= dt;
    if (!s.goal || s.timer <= 0) this.chooseGoal(s, P);
    this.sw.steer(s, dt);
    // Arrived at the edge of the roof: start across
    if (s.state === 'perch' && s.goal && s.goal.bridge) this.startBridge(s, s.goal.bridge);
  }

  chooseGoal(s, P) {
    const sw = this.sw, v = s.v;
    s.timer = rand(6, 10);
    s.best = Infinity;
    s.stuckT = 0;
    s.goal = null;
    const anchor = this.anchor(s, P, s.anchor || (s.anchor = new V3()));
    const [r0, r1] = v.range, mid = (r0 + r1) / 2;
    const roofOf = s.n.y > 0.9 && s.support && s.support.building ? s.support : null;
    const score = (p) => {
      const d = Math.hypot(p.x - anchor.x, p.z - anchor.z);
      let k = Math.abs(d - mid) + (d < r0 || d > r1 ? 40 : 0) + rand(0, 8);
      if (!v.support && !sw.clearLine(_e.copy(p).setY(p.y + 2.2 * s.scale), P.chest)) k += 60;
      return k;
    };
    if (roofOf) {
      // Somewhere else on this roof, or on a roof it can bridge to, whichever suits it best
      let best = null, bestK = score(s.p) - 6;   // staying put wins ties
      for (let i = 0; i < 3; i++) {
        const p = this.roofPoint(roofOf, s.scale);
        if (!p) continue;
        const k = score(p);
        if (k < bestK) { bestK = k; best = { point: p, normal: UP.clone(), collider: roofOf }; }
      }
      const nbs = this.neighbors(roofOf);
      for (let i = 0; i < Math.min(5, nbs.length); i++) {
        const nb = nbs[Math.floor(Math.random() * nbs.length)];
        const plan = this.plan(s, roofOf, nb);
        if (!plan) continue;
        const k = score(plan.b) - 4;
        if (k < bestK) { bestK = k; best = { point: plan.a, normal: UP.clone(), collider: roofOf, bridge: plan }; }
      }
      if (best) { s.goal = best; return; }
      if (bestK < 40) { s.state = 'perch'; s.timer = rand(2.5, 5) * v.linger; return; }
      // Nowhere up here will do: down to the street, then up another building
      s.goal = { point: new V3(anchor.x, 0, anchor.z).lerp(s.p, 0.6).setY(0), descend: true, charge: true };
      return;
    }
    const onGround = !s.support || s.support.low || s.p.y < 1;
    if (onGround) {
      // Climb the building nearest the way it wants to go
      _a.subVectors(anchor, s.p).setY(0);
      const toward = _a.lengthSq() > 1 ? _b.copy(s.p).addScaledVector(_a.normalize(), 30) : s.p;
      const perch = sw.findPerch(toward, 0, 45, { roof: 0.9, tries: 10 });
      s.goal = perch || { point: anchor.clone(), charge: true };
      return;
    }
    // On a wall: up onto its roof
    const c = s.support;
    if (c && c.building) {
      const p = this.roofPoint(c, s.scale);
      if (p) { s.goal = { point: p, normal: UP.clone(), collider: c }; return; }
    }
    s.goal = { point: new V3(s.p.x, 0, s.p.z), descend: true, charge: true };
  }

  /** An open spot on a roof, inset so the body fits */
  roofPoint(c, sc) {
    const m = Math.min(2.5 * sc, (c.max.x - c.min.x) * 0.45, (c.max.z - c.min.z) * 0.45);
    for (let i = 0; i < 4; i++) {
      _a.set(rand(c.min.x + m, c.max.x - m), c.max.y + 6, rand(c.min.z + m, c.max.z - m));
      const h = this.sw.ray(_a, DOWN, 8);
      if (h && h.collider === c && h.normal.y > 0.9) return h.point.clone();
    }
    return null;
  }

  /** Roofs facing this one across a gap, with enough overlap for a body to cross */
  neighbors(A) {
    let L = this.nb.get(A);
    if (L) return L;
    L = [];
    const R = 26;
    this.sw.world.query(A.min.x - R, A.min.z - R, A.max.x + R, A.max.z + R, (B) => {
      if (B === A || !B.building || B.max.y < 6 || (B.max.x - B.min.x) < 4 || (B.max.z - B.min.z) < 4) return;
      const gx = Math.max(B.min.x - A.max.x, A.min.x - B.max.x), gz = Math.max(B.min.z - A.max.z, A.min.z - B.max.z);
      const ox = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x), oz = Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z);
      if (gx > 0.8 && gz <= 0 && oz > 4) L.push({ B, axis: 0, sign: B.min.x >= A.max.x ? 1 : -1, gap: gx, lo: Math.max(A.min.z, B.min.z), hi: Math.min(A.max.z, B.max.z) });
      else if (gz > 0.8 && gx <= 0 && ox > 4) L.push({ B, axis: 2, sign: B.min.z >= A.max.z ? 1 : -1, gap: gz, lo: Math.max(A.min.x, B.min.x), hi: Math.min(A.max.x, B.max.x) });
    });
    this.nb.set(A, L);
    return L;
  }

  /**
   * A way across from roof A to the roof facing it: the edge spot to walk to (a) and where it
   * comes down (b), or null if its legs can't span the gap or the climb.
   */
  plan(s, A, nb) {
    const sc = s.scale, span = SPAN * sc * s.legs, B = nb.B;
    const dh = B.max.y - A.max.y;
    // Mid-crossing, its rear feet are still on one roof and its front feet already on the other
    if (nb.gap > span * 0.62 || Math.abs(dh) > span * 0.4) return null;
    const along = nb.axis === 0 ? s.p.z : s.p.x;
    const u = nb.hi - nb.lo > 3 * sc ? clamp(along, nb.lo + 1.5 * sc, nb.hi - 1.5 * sc) : (nb.lo + nb.hi) / 2;
    // It sets off from just short of the edge, and walks on until its whole body is over the far roof
    const depth = nb.axis === 0 ? B.max.x - B.min.x : B.max.z - B.min.z;
    const ia = 1.2 * sc, ib = Math.min(2.4 * sc, depth * 0.45);
    const ea = nb.sign > 0 ? (nb.axis === 0 ? A.max.x : A.max.z) - ia : (nb.axis === 0 ? A.min.x : A.min.z) + ia;
    const eb = nb.sign > 0 ? (nb.axis === 0 ? B.min.x : B.min.z) + ib : (nb.axis === 0 ? B.max.x : B.max.z) - ib;
    const at = (e, c, out) => (nb.axis === 0 ? out.set(e, c.max.y + 6, u) : out.set(u, c.max.y + 6, e));
    // Both ends have to be open roof
    const ha = this.sw.ray(at(ea, A, _a), DOWN, 8), hb = this.sw.ray(at(eb, nb.B, _b), DOWN, 8);
    if (!ha || ha.collider !== A || !hb || hb.collider !== nb.B) return null;
    return { A, B: nb.B, a: ha.point.clone(), b: hb.point.clone() };
  }

  startBridge(s, plan) {
    s.state = 'bridge';
    s.goal = null;
    s.bridge = Object.assign(plan, { u: 0, len: plan.a.distanceTo(plan.b), dir: new V3().subVectors(plan.b, plan.a).setY(0).normalize() });
    this.sw.sound.bridgeCreak(s.c);
  }

  /** Stretched across a gap: the body slides over while the feet hand over from one roof to the other */
  bridge(s, dt) {
    const B = s.bridge;
    const speed = s.speed * s.scale * 0.55;
    B.u = Math.min(1, B.u + (speed * dt) / Math.max(1, B.len));
    s.p.lerpVectors(B.a, B.b, B.u);
    s.n.set(0, 1, 0);
    s.f.lerp(B.dir, damp(4, dt)).setY(0).normalize();
    s.support = B.u < 0.5 ? B.A : B.B;
    s.moveVel.copy(B.dir).multiplyScalar(speed);
    if (Math.random() < dt * 0.6) this.sw.sound.bridgeCreak(s.c);
    if (B.u >= 1) {
      s.state = 'crawl';
      s.bridge = null;
      s.support = B.B;
      s.timer = 0;
    }
  }

  /** Where a foot goes while bridging: on whichever roof is under its rest spot, or the nearer roof's edge */
  bridgeHold(s, rest) {
    const { A, B } = s.bridge;
    const near = (c, out) => out.set(clamp(rest.x, c.min.x + 0.4, c.max.x - 0.4), c.max.y, clamp(rest.z, c.min.z + 0.4, c.max.z - 0.4));
    near(A, _c); near(B, _d);
    const p = _c.distanceToSquared(rest) <= _d.distanceToSquared(rest) ? _c : _d;
    const h = this.sw.ray(_e.copy(p).setY(p.y + 4), DOWN, 9);
    return h ? h.point.clone() : p.clone();
  }

  // ---- abilities ----------------------------------------------------------------------------

  weapons(s, dt, P) {
    const v = s.v, A = s.ability, sw = this.sw;
    A.cool -= dt;
    // Bulwark's gatling streams run on as bursts
    if (s.burst > 0) {
      s.burstT -= dt;
      if (s.burstT <= 0) {
        sw.fireBolt(s, P, 'gatling', 0, s.burst % 2 ? BARREL_L : BARREL_R);
        s.burst--;
        s.burstT = 0.07;
      }
    }
    const sees = s.see && s.seeT > 0.4, d = s.c.distanceTo(P.chest);
    switch (v.weapon) {
      case 'gatling':
        if (sees && A.cool <= 0 && d < 160 && sw.bolts.length < 200) { s.burst = 12; s.burstT = 0.05; A.cool = rand(3, 4.5); }
        break;
      case 'dome':
        if (sees && A.cool <= 0 && d < 140 && sw.bolts.length < 220) { sw.fireBolt(s, P, 'plasma'); A.cool = rand(2, 3.5); }
        break;
      case 'mend': this.mend(s, dt, P, sees, d); break;
      case 'tractor': this.tractor(s, dt, P, sees, d); break;
      case 'boulder': this.quarry(s, dt, P, sees, d); break;
    }
  }

  /** Mender: a repair beam on the most damaged frame nearby; a stray bolt at the mech when nobody needs it */
  mend(s, dt, P, sees, d) {
    const sw = this.sw, A = s.ability;
    A.t -= dt;
    if (A.t <= 0) {
      A.t = 0.8;
      let best = null, worst = 0.97;
      for (const o of sw.list) {
        if (o === s || !o.alive || o.hidden || o.state === 'dead' || !o.maxHp || o.hp / o.maxHp >= worst) continue;
        if (o.c.distanceTo(s.c) > 70 || !sw.clearLine(this.emitter(s, _a), o.c)) continue;
        worst = o.hp / o.maxHp;
        best = o;
      }
      A.heal = best;
    }
    const o = A.heal;
    if (o && o.alive && o.state !== 'dead' && !o.hidden) {
      o.hp = Math.min(o.maxHp, o.hp + s.v.mend * dt);
      if (!s.beam) this.startBeam(s, 0x40ff8a, 0x10c050);
      if (Math.random() < dt * 20) sw.fx.sparksBurst(o.pos, UP, 2, 0x60ff9a, 10);
    } else {
      if (s.beam) this.endBeam(s);
      if (sees && A.cool <= 0 && d < 120 && sw.bolts.length < 220) { sw.fireBolt(s, P, 'plasma'); A.cool = rand(2.5, 4); }
    }
  }

  /** Magnetar: charge, then hold the mech in a tractor beam that drags it in */
  tractor(s, dt, P, sees, d) {
    const sw = this.sw, A = s.ability;
    if (A.phase === 'charge' || A.phase === 'pull') {
      A.t += dt;
      if (!sees || d > TRACTOR.range * 1.2 || !P.alive) { this.endTractor(s); return; }
      if (A.phase === 'charge' && A.t >= TRACTOR.charge) { A.phase = 'pull'; A.t = 0; sw.sound.tractor(s.c); }
      if (A.phase === 'pull') {
        sw.cb.onPull && sw.cb.onPull(this.emitter(s, _a).clone(), s.v.pull);
        if (A.t >= TRACTOR.hold) this.endTractor(s);
      }
      return;
    }
    if (sees && A.cool <= 0 && d < TRACTOR.range && d > 12) {
      A.phase = 'charge';
      A.t = 0;
      this.startBeam(s, 0x6fa8ff, 0xd0182a);
      sw.sound.laserCharge(s.c, TRACTOR.charge);
    }
  }

  endTractor(s) {
    const A = s.ability;
    A.phase = null;
    A.cool = rand(...TRACTOR.cool);
    if (s.beam) this.endBeam(s);
  }

  /** Quarrier: tear a chunk out of the roof it stands on, hold it up, and hurl it */
  quarry(s, dt, P, sees, d) {
    const sw = this.sw, A = s.ability;
    if (A.phase === 'tear') {
      A.t += dt;
      s.lift = Math.min(1, s.lift + dt * 2);
      if (A.t >= 0.95) {
        A.phase = null;
        A.cool = rand(4.5, 6.5);
        this.hurl(s, P);
      }
      return;
    }
    s.lift = Math.max(0, s.lift - dt * 1.5);
    if (sees && A.cool <= 0 && d > 25 && d < 190 && this.boulders.length < 20) {
      A.phase = 'tear';
      A.t = 0;
      // The chunk comes out of whatever it's standing on
      const at = sw.bodyPoint(s, _a.set(0, -1.1, 1.6), _a).clone();
      if (sw.world.destruct && s.support && s.support.building) sw.world.destruct.blast(at, 2.6, 260, { enemy: true, chunks: 14 });
      sw.fx.dust(at, 1.2, 10);
      sw.sound.crumble ? sw.sound.crumble(at, 8) : sw.sound.explosion(at, 0.5);
      this.boulders.push({ held: s, pos: at, vel: new V3(), size: BOULDER.size * s.scale * 0.55, spin: new V3(rand(-3, 3), rand(-3, 3), rand(-3, 3)), rot: new THREE.Euler(), life: 8 });
    }
  }

  hurl(s, P) {
    const b = this.boulders.find((x) => x.held === s);
    if (!b) return;
    b.held = null;
    const T = clamp(b.pos.distanceTo(P.pos) / 45, 0.9, 2.8);
    _a.copy(P.pos).addScaledVector(P.vel, T * 0.6).add(_b.set(rand(-3, 3), 1, rand(-3, 3)));
    b.vel.subVectors(_a, b.pos).divideScalar(T);
    b.vel.y += 0.5 * BOULDER.gravity * T;
    b.from = b.pos.clone();
    this.sw.sound.boulderThrow(b.pos);
  }

  /** Where the dome, mend and tractor beams come from: the gear on its back */
  emitter(s, out) {
    const v = s.v, L = this.sw.locals[v.id];
    if (v.weapon === 'tractor') return this.sw.bodyPoint(s, out.set(0, 1.45, L.abdomenZ + 1.0), out);
    if (v.weapon === 'mend') return this.sw.bodyPoint(s, out.set(0, 2.15, 0.95), out);
    return this.sw.bodyPoint(s, out.set(0, 0.5 + 1.1 * v.abdomen[1], L.abdomenZ), out);
  }

  // ---- beams ----------------------------------------------------------------------------------

  startBeam(s, core, glow) {
    const b = this.beams.find((x) => !x.busy);
    if (!b) return;
    b.busy = true;
    b.core.material.uniforms.uColor.value.set(core);
    b.glow.material.uniforms.uColor.value.set(glow);
    s.beam = b;
  }

  endBeam(s) {
    const b = s.beam;
    if (!b) return;
    b.busy = false;
    b.core.visible = b.glow.visible = false;
    s.beam = null;
  }

  // ---- shield domes ---------------------------------------------------------------------------

  /** A Warden's dome: a target of its own that soaks shots and blasts before they reach anyone inside */
  raiseDome(s) {
    const sw = this.sw;
    const mesh = new THREE.Mesh(this.domeGeo, new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { uColor: { value: new THREE.Color(1, 0.85, 0.4) }, uAlpha: { value: 0 }, uHit: { value: new V3() }, uHitT: { value: 1 }, uTime: { value: 0 }, uR: { value: 1 } },
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    const kin = this;
    const d = {
      kind: 'dome', name: 'WARDEN SHIELD', stealth: true, alive: true, owner: s, mesh,
      pos: new V3().copy(s.c), vel: new V3(), radius: 6.2 * s.scale, hp: s.v.dome, maxHp: s.v.dome, regenT: 0, up: 0,
      ray(o, dir, max) {
        // From outside only: anything already inside shoots straight through
        const ox = o.x - this.pos.x, oy = o.y - this.pos.y, oz = o.z - this.pos.z, R = this.radius;
        const c = ox * ox + oy * oy + oz * oz - R * R;
        if (c <= 0) return null;
        const b = ox * dir.x + oy * dir.y + oz * dir.z, disc = b * b - c;
        if (disc < 0) return null;
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t > max) return null;
        return { t, normal: new V3(ox + dir.x * t, oy + dir.y * t, oz + dir.z * t).divideScalar(R) };
      },
      hit(amount, point) { kin.domeHit(this, amount, point); return false; },
      blast(point, radius, amount) {
        const gap = point.distanceTo(this.pos) - this.radius;
        if (gap > 0 && gap < radius) kin.domeHit(this, amount * (1 - gap / radius), _g.copy(point).sub(this.pos).setLength(this.radius).add(this.pos));
      },
    };
    s.dome = d;
    this.domes.push(d);
    sw.world.targets.push(d);
    sw.sound.domeUp(s.c);
  }

  domeHit(d, amount, point) {
    if (!d.alive) return;
    d.hp -= amount;
    d.regenT = 5;
    const u = d.mesh.material.uniforms;
    u.uHit.value.copy(point);
    u.uHitT.value = 0;
    this.sw.fx.sparksBurst(point, _a.copy(point).sub(d.pos).normalize(), 5, 0xffe08a, 20);
    if (d.hp <= 0) {
      // Shattered: down until it recharges
      d.alive = false;
      d.hp = 0;
      d.regenT = 8;
      const i = this.sw.world.targets.indexOf(d);
      if (i >= 0) this.sw.world.targets.splice(i, 1);
      for (let k = 0; k < 40; k++) {
        _a.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).setLength(d.radius).add(d.pos);
        this.sw.fx.sparks.emit(_a.x, _a.y, _a.z, rand(-6, 6), rand(-2, 6), rand(-6, 6), rand(0.5, 1.2), 0.25, 0.05, 3, 2.6, 1.2, 1, 1, 0.7, 0.2, 0.4, 0.5, -10);
      }
      this.sw.sound.domeBreak(d.pos);
    }
  }

  dropDome(d) {
    const i = this.domes.indexOf(d);
    if (i >= 0) this.domes.splice(i, 1);
    const t = this.sw.world.targets.indexOf(d);
    if (t >= 0) this.sw.world.targets.splice(t, 1);
    d.alive = false;
    this.scene.remove(d.mesh);
    d.mesh.material.dispose();
    if (d.owner) d.owner.dome = null;
  }

  // ---- per-frame ---------------------------------------------------------------------------------

  update(dt, ctx) {
    const sw = this.sw, P = ctx.player, fx = sw.fx;
    // Domes follow their Warden, recharge when broken, fade in and out
    for (const d of this.domes) {
      const s = d.owner;
      d.pos.copy(s.c);
      const u = d.mesh.material.uniforms;
      if (!d.alive) {
        d.regenT -= dt;
        if (d.regenT <= 0 && s.alive) { d.alive = true; d.hp = d.maxHp; sw.world.targets.push(d); sw.sound.domeUp(s.c); }
      } else if ((d.regenT -= dt) <= 0) d.hp = Math.min(d.maxHp, d.hp + 25 * dt);
      d.up += ((d.alive ? 1 : 0) - d.up) * damp(6, dt);
      d.mesh.visible = d.up > 0.02;
      d.mesh.position.copy(d.pos);
      d.mesh.scale.setScalar(d.radius * (0.9 + 0.1 * d.up));
      u.uAlpha.value = d.up * (0.55 + 0.45 * (d.hp / d.maxHp)) * (d.hp / d.maxHp < 0.25 ? 0.6 + 0.4 * Math.abs(Math.sin(sw.time * 30)) : 1);
      u.uHitT.value = Math.min(1, u.uHitT.value + dt * 1.6);
      u.uTime.value = sw.time;
      u.uR.value = d.radius;
    }
    // Beams from each medium's gear to its patient or the mech
    for (const s of sw.list) {
      if (!s.beam || !s.v.medium) continue;
      const from = this.emitter(s, _a);
      const A = s.ability;
      const to = s.v.weapon === 'mend' ? (A.heal ? A.heal.pos : null) : P.chest;
      if (!to) continue;
      const charge = A.phase === 'charge', k = charge ? 0.3 + 0.3 * Math.abs(Math.sin(sw.time * 40)) : 0.85 + 0.15 * Math.sin(sw.time * 20);
      drawBeam(s.beam.core, from, to, charge ? 0.25 : 0.6, k, charge ? 0 : 1, sw.time);
      drawBeam(s.beam.glow, from, to, charge ? 0.9 : 2.2, k * 0.6, 0, sw.time);
      // Tractor beams pull motes along themselves toward the Magnetar
      if (s.v.weapon === 'tractor' && !charge && Math.random() < dt * 40) {
        const t = Math.random();
        _b.lerpVectors(from, to, t);
        _c.subVectors(from, to).normalize().multiplyScalar(30);
        fx.fire.emit(_b.x, _b.y, _b.z, _c.x, _c.y, _c.z, 0.3, 0.6, 0.2, 0.6, 0.9, 3, 1, 1.6, 0.2, 0.3, 0);
      }
    }
    // Boulders: held over a Quarrier's head, then flying
    let n = 0;
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i];
      if (b.held) {
        if (!b.held.alive) b.held = null;
        else sw.bodyPoint(b.held, _a.set(0, 1.4 + 1.4 * b.held.lift, 1.2), b.pos);
      }
      if (!b.held) {
        b.life -= dt;
        b.vel.y -= BOULDER.gravity * dt;
        const sp = b.vel.length(), step = sp * dt;
        _a.copy(b.vel).divideScalar(sp || 1);
        const hit = b.from ? sw.world.raycast(b.pos, _a, step + b.size * 0.5, { targets: false, trees: true }) : null;
        const onMech = P.alive && capsuleDist(b.pos, P.pos) < 1.9 + b.size * 0.6;
        if (hit || onMech || b.life <= 0 || (!b.from && b.pos.y < -5)) {
          this.smash(b, hit ? hit.point : b.pos, onMech, P);
          this.boulders.splice(i, 1);
          continue;
        }
        b.pos.addScaledVector(b.vel, dt);
        if (Math.random() < dt * 25) fx.smoke.emit(b.pos.x, b.pos.y, b.pos.z, 0, 0.5, 0, 0.8, b.size * 0.6, b.size * 1.6, 0.5, 0.48, 0.44, 0.45, 0.5, 0.5, 0.5, 0, 1, 0.2);
      }
      b.rot.x += b.spin.x * dt; b.rot.y += b.spin.y * dt; b.rot.z += b.spin.z * dt;
      _m.makeRotationFromEuler(b.rot).scale(_a.setScalar(b.size)).setPosition(b.pos);
      this.rockMesh.setMatrixAt(n++, _m);
    }
    this.rockMesh.count = n;
    this.rockMesh.instanceMatrix.needsUpdate = true;
    for (const key in this.parts) {
      this.parts[key].instanceMatrix.needsUpdate = true;
      this.parts[key].instanceColor.needsUpdate = true;
    }
  }

  /** A boulder lands: smashes what it hits and showers the mech if it's close */
  smash(b, p, direct, P) {
    const sw = this.sw, fx = sw.fx, D = sw.world.destruct;
    fx.dust(p, 1.6 + b.size * 0.4, 14);
    fx.sparksBurst(p, UP, 14, 0xc8b8a0, 24);
    fx.flash(p, 4, 0xffe0b0, 0.1);
    sw.sound.explosion(p, 0.7);
    if (D) {
      D.blast(p, 2.2 + b.size * 0.8, 240, { enemy: true });
      for (let i = 0; i < 10; i++) D.debris.spawn(p.x, p.y + 0.5, p.z, rand(-8, 8), rand(3, 12), rand(-8, 8), b.size * rand(0.2, 0.45), 3, rand(8, 14));
    }
    sw.world.blastTrees(p, BOULDER.splash, BOULDER.dmg);
    const d = capsuleDist(p, P.pos);
    if (P.alive && (direct || d < BOULDER.splash)) sw.cb.onPlayerHit && sw.cb.onPlayerHit(BOULDER.dmg * (direct ? 1.3 : 1 - d / BOULDER.splash) + 4, b.from || p, 'shell');
  }

  // ---- gear --------------------------------------------------------------------------------------

  /** Draw a medium spider's gear on its rendered body */
  render(s) {
    const P = this.parts, M = s.bodyM, v = s.v, L = this.sw.locals[v.id], t = s.t;
    const put = (mesh, k, m) => mesh.setMatrixAt(s.slot * mesh.per + k, m);
    const at = (local) => _m.multiplyMatrices(M, local);
    const zb = L.abdomenZ, top = 0.4 + 0.92 * v.abdomen[1];
    switch (v.weapon) {
      case 'gatling': {
        // A riot shield of a plate over the face, gatling barrels under it
        put(P.plate, 0, at(plateMatrix(_m2, _a.set(0, 1.5, 2.05), _b.set(0, -1, 0.14), _c.set(1, 0, 0), 2.4, 1.15, 0.16)));
        const kick = s.burst > 0 ? 0.08 * Math.sin(t * 90) : 0;
        for (const sd of [-1, 1]) put(P.barrel, sd > 0 ? 1 : 0, at(plateMatrix(_m2, _a.set(sd * 0.36, -0.42, 1.25 - kick), _b.set(0, 0.03, 1), _c.set(0, 1, 0), 1.7, 0.32, 0.3)));
        break;
      }
      case 'dome': {
        // An emitter orb on its back between two fins
        put(P.orb, 0, at(_m2.makeScale(0.62, 0.62, 0.62).setPosition(0, top + 0.45, zb)));
        for (const sd of [-1, 1]) put(P.fin, sd > 0 ? 1 : 0, at(plateMatrix(_m2, _a.set(sd * 0.3, top + 0.2, zb + 0.5), _b.set(sd * 0.7, 0.55, -0.4), _c.set(0, 0, 1), 1.5, 0.6, 0.12)));
        break;
      }
      case 'mend': {
        // A crane arm arching forward over the head, the emitter at its end
        put(P.arm, 0, at(plateMatrix(_m2, _a.set(0, 0.55, -0.4), _b.set(0, 0.85, 0.6), _c.set(0, 0, -1), 2.0, 0.55, 0.2)));
        put(P.orb, 0, at(_m2.makeScale(0.42, 0.42, 0.42).setPosition(0, 2.15, 0.95)));
        break;
      }
      case 'tractor': {
        // Two spinning coil discs on its back, facing forward
        for (const k of [0, 1]) {
          _m2.makeRotationX(Math.PI / 2).multiply(_m.makeRotationY(t * (k ? -4 : 5)));
          _m2.premultiply(_m.makeScale(1, 1, 1)).scale(_a.set(1.05 - k * 0.25, 0.28, 1.05 - k * 0.25)).setPosition(0, 1.45, zb + 1.0 - k * 0.7);
          put(P.disc, k, at(_m2));
        }
        break;
      }
      case 'boulder': {
        // Digging arms that rest pointing down and come up to hold a boulder overhead
        const k = s.lift;
        for (const sd of [-1, 1]) {
          _b.set(sd * (0.15 + 0.1 * k), -0.8 + 1.7 * k, 0.6 - 0.3 * k).normalize();
          put(P.arm, sd > 0 ? 1 : 0, at(plateMatrix(_m2, _a.set(sd * 0.55, 0.15, 1.3), _b, _c.set(sd, 0, 0), 2.4, 0.6, 0.24)));
        }
        break;
      }
    }
    // Hit flash, as on the body
    const fk = 1 + s.flash * 4;
    if (fk !== s.gearFlash) {
      s.gearFlash = fk;
      _col.setRGB(fk, fk * (1 - s.flash * 0.3), fk * (1 - s.flash * 0.3));
      for (const key in P) for (let k = 0; k < P[key].per; k++) P[key].setColorAt(s.slot * P[key].per + k, _col);
    }
  }
}
