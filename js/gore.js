import * as THREE from './three.js';

// ---------------------------------------------------------------------------
// Gore: the blood when someone in the city is killed (js/people.js).
//
// A death bursts into a spray of red droplets and a puff of red mist. The
// droplets fly, falling, until they hit something: the street, a sidewalk,
// a floor, a wall or a ceiling, a wreck or a piece of falling building.
// There each one leaves a splatter stuck flat to that surface, streaked the
// way it was going. The splatters stay (the oldest give way to new ones)
// until the surface under them is shot away or falls.
//
// The droplets are one InstancedMesh of little stretched beads and the
// splatters another of flat quads, so all of it draws in two calls.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new V3(), _w = new V3(), _s = new V3(), _t = new V3(), _n = new V3(), _up = new V3(0, 1, 0);
const _c = new THREE.Color();

// Floats per droplet: 0-2 pos, 3-5 vel, 6 life, 7 radius
const DS = 8;
// Floats per splatter: 0-2 pos, 3-5 normal, 6 on bare ground (nothing to fall away from under it)
const SS = 7;

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A splatter: a blob with a ragged rim, droplets thrown off it and a streak out one side */
function splatterTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = seeded(913);
  const blob = (x, y, rad) => { g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill(); };
  g.fillStyle = '#ffffff';
  blob(S / 2, S / 2, S * 0.17);
  for (let i = 0; i < 18; i++) { const a = r() * TAU, d = S * (0.08 + r() * 0.12); blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.03 + r() * 0.06)); }
  // Thrown off along +x, the way the drop was going
  for (let i = 0; i < 14; i++) { const d = S * (0.2 + r() * 0.28), w = (r() - 0.5) * S * 0.18; blob(S / 2 + d, S / 2 + w * (d / S), S * (0.008 + r() * 0.028) * (1 - d / S)); }
  for (let i = 0; i < 40; i++) { const a = r() * TAU, d = S * (0.22 + r() * 0.24); blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.004 + r() * 0.014)); }
  // Darker where it pooled: the tint comes from the instance color, the texture only shades it
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4, rr = Math.hypot(x - S / 2, y - S / 2) / (S / 2), v = 0.55 + 0.45 * Math.min(1, rr * 1.6);
      d[k] = d[k + 1] = d[k + 2] = 255 * v;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Gore {
  /** opts: { scene, world, fx, mobile } */
  constructor({ scene, world, fx, mobile = false }) {
    this.world = world; this.fx = fx;
    this.M = world.city.M;
    this.G = 9.81 * this.M * 1.3;
    this.perKill = mobile ? 45 : 110;
    // Droplets in flight
    this.dcap = mobile ? 1400 : 5000;
    this.drops = new Float32Array(this.dcap * DS);
    this.dn = 0;
    const bead = new THREE.IcosahedronGeometry(1, 0);
    const dmat = new THREE.MeshStandardMaterial({ color: 0x8e0606, roughness: 0.25, metalness: 0.05 });
    this.dmesh = new THREE.InstancedMesh(bead, dmat, this.dcap);
    this.dmesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dmesh.count = 0;
    this.dmesh.frustumCulled = false;
    scene.add(this.dmesh);
    // Splatters stuck where they landed
    this.scap = mobile ? 2500 : 9000;
    this.spl = new Float32Array(this.scap * SS);
    this.snext = 0;
    this.sused = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    const smat = new THREE.MeshStandardMaterial({ map: splatterTexture(), transparent: true, alphaTest: 0.35, depthWrite: false, roughness: 0.3, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    this.smesh = new THREE.InstancedMesh(quad, smat, this.scap);
    this.smesh.setColorAt(0, _c.set(1, 1, 1));
    this.smesh.count = 0;
    this.smesh.renderOrder = 2;
    this.smesh.frustumCulled = false;
    this.smesh.receiveShadow = true;
    scene.add(this.smesh);
    this.slo = Infinity; this.shi = -1;
    this.check = 0;
  }

  m(x) { return x * this.M; }

  solid(x, y, z) { const D = this.world.destruct; return D ? D.solidAt(x, y, z) : false; }

  /**
   * Someone killed at (x, y, z), the middle of the body. k scales the spray; low: crushed
   * flat on the ground, so it squirts out sideways more than up.
   */
  burst(x, y, z, k = 1, low = false) {
    const m = (v) => this.m(v);
    let n = Math.round(this.perKill * k * rand(0.8, 1.2));
    // A blast that kills a crowd shares out what room there is
    n = Math.min(n, Math.max(8, (this.dcap - this.dn) >> 1), this.dcap - this.dn);
    for (let i = 0; i < n; i++) {
      // Every which way, mostly out and up
      _v.set(rand(-1, 1), 0, rand(-1, 1));
      if (_v.lengthSq() < 1e-4) _v.set(1, 0, 0);
      _v.normalize();
      const up = low ? rand(0.05, 0.6) : rand(-0.35, 1.5), sp = m(1.5 + 13 * Math.random() ** 1.6) * (low ? 1.2 : 1);
      _v.y = up;
      _v.normalize().multiplyScalar(sp);
      const o = this.dn++ * DS, D = this.drops;
      D[o] = x + rand(-1, 1) * m(0.2); D[o + 1] = y + rand(-1, 1) * m(0.25); D[o + 2] = z + rand(-1, 1) * m(0.2);
      D[o + 3] = _v.x; D[o + 4] = _v.y; D[o + 5] = _v.z;
      D[o + 6] = 0;
      D[o + 7] = m(rand(0.04, 0.12) * (Math.random() < 0.15 ? 2 : 1));
    }
    // A puff of red mist where they were
    const fx = this.fx;
    if (fx) {
      for (let i = 0; i < 10; i++) {
        fx.smoke.emit(x, y, z, rand(-3, 3) * m(1), rand(0, 3) * m(1), rand(-3, 3) * m(1), rand(0.4, 0.9), m(0.35), m(1.3),
          0.6, 0.02, 0.02, 0.85, 0.32, 0.01, 0.01, 0, 1.2, -4);
      }
    }
  }

  /** A splatter stuck to the surface at p facing n, streaked along the way the drop came in at v */
  stick(p, n, v, r, ground) {
    const m = (x) => this.m(x);
    const i = this.snext;
    this.snext = (this.snext + 1) % this.scap;
    this.sused = Math.max(this.sused, this.snext === 0 ? this.scap : this.snext);
    const S = this.spl, o = i * SS;
    S[o] = p.x; S[o + 1] = p.y; S[o + 2] = p.z; S[o + 3] = n.x; S[o + 4] = n.y; S[o + 5] = n.z; S[o + 6] = ground ? 1 : 0;
    // Streak: along the part of the drop's way that runs across the surface
    _t.copy(v).addScaledVector(n, -v.dot(n));
    const along = _t.length();
    if (along < 1e-3) { _t.set(1, 0, 0).addScaledVector(n, -n.x); if (_t.lengthSq() < 1e-4) _t.set(0, 0, 1).addScaledVector(n, -n.z); }
    // Turned at random a little about the way it was going
    _t.normalize().applyAxisAngle(n, rand(-0.5, 0.5) * (along < m(1) ? 6 : 1));
    _w.crossVectors(_t, n);
    const size = Math.max(m(0.16), r * rand(4, 8)), stretch = 1 + Math.min(1.6, along / m(9));
    _m.makeBasis(_t.multiplyScalar(size * stretch), _n.copy(n), _w.multiplyScalar(size));
    _m.setPosition(p.x + n.x * m(0.02), p.y + n.y * m(0.02), p.z + n.z * m(0.02));
    this.smesh.setMatrixAt(i, _m);
    // From dark, nearly black to fresh red
    const f = rand(0.35, 1);
    this.smesh.setColorAt(i, _c.setRGB(0.5 * f + 0.05, 0.02 * f, 0.02 * f));
    this.smesh.count = this.sused;
    this.slo = Math.min(this.slo, i); this.shi = Math.max(this.shi, i);
  }

  update(dt) {
    const m = (x) => this.m(x), D = this.drops, G = this.G, des = this.world.destruct;
    const water = this.world.city.L.water;
    let w = 0;
    for (let i = 0; i < this.dn; i++) {
      const o = i * DS;
      const ox = D[o], oy = D[o + 1], oz = D[o + 2];
      D[o + 4] -= G * dt;
      const drag = Math.exp(-dt * 0.25);
      D[o + 3] *= drag; D[o + 5] *= drag;
      const nx = ox + D[o + 3] * dt, ny = oy + D[o + 4] * dt, nz = oz + D[o + 5] * dt;
      D[o + 6] += dt;
      let alive = D[o + 6] < 5 && ny > water - m(2);
      if (alive && this.solid(nx, ny, nz)) {
        alive = false;
        if (!this.solid(ox, oy, oz)) {
          // Which face it went in through: the axis whose step alone takes it into something solid
          if (this.solid(nx, oy, oz)) _n.set(-Math.sign(D[o + 3]) || 1, 0, 0);
          else if (this.solid(ox, oy, nz)) _n.set(0, 0, -Math.sign(D[o + 5]) || 1);
          else _n.set(0, -Math.sign(D[o + 4]) || 1, 0);
          // Where it met the surface, between the last clear point and the first solid one
          _v.set(ox, oy, oz); _w.set(nx, ny, nz);
          for (let k = 0; k < 6; k++) {
            _s.addVectors(_v, _w).multiplyScalar(0.5);
            if (this.solid(_s.x, _s.y, _s.z)) _w.copy(_s); else _v.copy(_s);
          }
          this.stick(_v, _n, _s.set(D[o + 3], D[o + 4], D[o + 5]), D[o + 7], false);
        }
      } else if (alive && ny <= 0) {
        alive = false;
        // Into the river it's gone; on the street it stays
        if (!des || des.ground(nx, nz) >= 0) {
          const f = oy / Math.max(1e-6, oy - ny);
          this.stick(_v.set(ox + (nx - ox) * f, 0, oz + (nz - oz) * f), _n.set(0, 1, 0), _s.set(D[o + 3], D[o + 4], D[o + 5]), D[o + 7], true);
        }
      }
      if (!alive) continue;
      D[o] = nx; D[o + 1] = ny; D[o + 2] = nz;
      if (w !== i) D.copyWithin(w * DS, o, o + DS);
      // A bead stretched out along the way it flies
      const vx = D[w * DS + 3], vy = D[w * DS + 4], vz = D[w * DS + 5], sp = Math.hypot(vx, vy, vz), r = D[w * DS + 7];
      _v.set(vx, vy, vz).divideScalar(sp || 1);
      _q.setFromUnitVectors(_up, _v);
      _m.compose(_s.set(nx, ny, nz), _q, _w.set(r, r + sp * 0.03, r));
      this.dmesh.setMatrixAt(w, _m);
      w++;
    }
    this.dn = w;
    this.dmesh.count = w;
    if (w) this.dmesh.instanceMatrix.needsUpdate = true;
    // Splatters whose wall, floor or chunk of building has gone: a few each frame
    if (des && this.sused) {
      const S = this.spl, e = m(0.08);
      for (let k = 0; k < 48; k++) {
        const i = this.check = (this.check + 1) % this.sused, o = i * SS;
        if (S[o + 6] || S[o + 3] === 0 && S[o + 4] === 0 && S[o + 5] === 0) continue;
        if (!this.solid(S[o] - S[o + 3] * e, S[o + 1] - S[o + 4] * e, S[o + 2] - S[o + 5] * e)) {
          S[o + 3] = S[o + 4] = S[o + 5] = 0;
          this.smesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
          this.slo = Math.min(this.slo, i); this.shi = Math.max(this.shi, i);
        }
      }
    }
    // Only what changed goes up to the GPU
    if (this.shi >= 0) {
      const A = this.smesh.instanceMatrix, C = this.smesh.instanceColor;
      A.clearUpdateRanges(); A.addUpdateRange(this.slo * 16, (this.shi - this.slo + 1) * 16); A.needsUpdate = true;
      C.clearUpdateRanges(); C.addUpdateRange(this.slo * 3, (this.shi - this.slo + 1) * 3); C.needsUpdate = true;
      this.slo = Infinity; this.shi = -1;
    }
  }
}
