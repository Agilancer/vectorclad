import * as THREE from './three.js';

// ---------------------------------------------------------------------------
// Summoning portals: the rifts monsters drop out of (js/summons.js).
//
// Each portal is a disc: a swirling vortex with a dark heart and a bright rim,
// drawn opaque so whatever waits just behind it stays hidden until it falls
// through, and a wider additive halo of crackling light around it. Sky portals
// lie flat, facing the street; the millipede's stands upright near the ground.
// Every portal in the city is one instance of two instanced meshes, so a rain
// of riftling portals costs two draw calls.
//
// A portal opens (springing out from a point), calls onOpen when it is fully
// open (that is when its monster comes through), holds for `hold` seconds and
// while holdUntil() says so, then snaps shut.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const PCAP = 192;            // most portals open at once
const HALO = 1.75;           // the halo quad's reach, in portal radii

const VERT = /* glsl */`
attribute vec4 aPortal;   // x: how open, y: seed, z: spin direction, w: flash
attribute vec3 aColor;
uniform float uReach;
varying vec2 vUv; varying vec4 vP; varying vec3 vC;
void main() {
  vUv = position.xy * uReach;
  vP = aPortal; vC = aColor;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position.xy * uReach, 0.0, 1.0);
}`;

const COMMON = /* glsl */`
uniform float uTime;
varying vec2 vUv; varying vec4 vP; varying vec3 vC;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
`;

// The vortex: spiral arms of the portal's color turning into a dark heart, a lit rim, a wobbling edge
const CORE_FRAG = /* glsl */`
${COMMON}
void main() {
  float r = length(vUv), a = atan(vUv.y, vUv.x);
  float t = uTime * (0.8 + 0.4 * fract(vP.y * 7.0)) + vP.y * 17.0;
  float edge = 0.95 + 0.03 * sin(a * 7.0 + t * 3.0) + 0.02 * sin(a * 13.0 - t * 5.0);
  if (r > edge) discard;
  float u = r / edge;
  float sw = a * 3.0 + vP.z * (5.0 * log(u + 0.04) + t * 2.6);
  float arms = pow(0.5 + 0.5 * sin(sw), 3.0);
  float n = noise(rot(vUv, vP.z * (t * 0.9 + 2.2 / (u + 0.25))) * 3.2 + vP.y * 9.0);
  vec3 col = vec3(0.012, 0.004, 0.03);
  col += vC * arms * (0.2 + 1.3 * n) * smoothstep(0.06, 0.95, u);
  col += vC * exp(-u * u * 30.0) * 1.4;
  col += mix(vC, vec3(1.0), 0.45) * smoothstep(0.72, 1.0, u) * (1.3 + 0.8 * n);
  col *= 0.55 + 0.45 * vP.x + vP.w * 2.5;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The halo: a hot ring at the rim, a soft glow past it and arcs of lightning crawling round it
const HALO_FRAG = /* glsl */`
${COMMON}
uniform float uReach;
void main() {
  float r = length(vUv), a = atan(vUv.y, vUv.x);
  if (r < 0.86 || r > uReach) discard;
  float t = uTime + vP.y * 17.0;
  float n = noise(rot(vUv, -vP.z * t * 0.7) * 4.0 + vP.y * 5.0);
  float ring = exp(-pow((r - 0.96) * 10.0, 2.0)) * (1.1 + 1.2 * n);
  float glow = exp(-max(r - 0.96, 0.0) * 4.5) * 0.4 * smoothstep(0.88, 0.97, r);
  float arcs = pow(max(0.0, sin(a * 9.0 + vP.z * t * 4.0 + n * 7.0)), 24.0) * smoothstep(uReach, 1.0, r) * smoothstep(0.94, 1.02, r);
  float fade = smoothstep(uReach, uReach * 0.8, r);
  vec3 col = (vC * (ring * 1.6 + glow + arcs * 1.8) + vec3(ring * 0.35)) * fade * (0.4 + 0.6 * vP.x + vP.w * 2.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _m = new THREE.Matrix4(), _a = new V3(), _b = new V3(), _c = new V3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Opening spring: overshoots a little and settles */
const springOut = (t) => { const c = 1.9; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

export class Portals {
  constructor({ scene, fx, sound }) {
    this.fx = fx;
    this.sound = sound;
    this.list = [];
    this.time = 0;
    const geo = new THREE.PlaneGeometry(2, 2);
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(PCAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(PCAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPortal', this.state);
    geo.setAttribute('aColor', this.color);
    this.uTime = { value: 0 };
    const mat = (frag, reach, extra) => new THREE.ShaderMaterial(Object.assign({
      vertexShader: VERT, fragmentShader: frag, side: THREE.DoubleSide, transparent: true,
      uniforms: { uTime: this.uTime, uReach: { value: reach } },
    }, extra));
    // The vortex writes depth, so a monster waiting just behind it is hidden until it falls through
    this.core = new THREE.InstancedMesh(geo, mat(CORE_FRAG, 1, { depthWrite: true }), PCAP);
    this.halo = new THREE.InstancedMesh(geo, mat(HALO_FRAG, HALO, {
      depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), PCAP);
    this.core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halo.instanceMatrix = this.core.instanceMatrix;
    for (const m of [this.core, this.halo]) {
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
    this.core.renderOrder = 2;
    this.halo.renderOrder = 3;
  }

  get busy() { return this.list.length; }

  /**
   * Open a portal. o: { pos, normal (the way it faces), radius, color, open, hold, close (seconds),
   * onOpen(portal), holdUntil() (keeps it open while true), big (louder, with a light) }
   */
  open(o) {
    if (this.list.length >= PCAP) return null;
    const p = {
      pos: o.pos.clone(), normal: o.normal.clone().normalize(), radius: o.radius,
      color: new THREE.Color(o.color ?? 0xb44dff),
      openT: o.open ?? 0.6, hold: o.hold ?? 1, closeT: o.close ?? 0.45,
      onOpen: o.onOpen || null, holdUntil: o.holdUntil || null, big: !!o.big,
      phase: 'open', t: 0, k: 0, flash: 0, seed: Math.random(), spin: Math.random() < 0.5 ? 1 : -1,
      t1: new V3(), t2: new V3(),
    };
    // A frame in the disc's plane
    const ref = Math.abs(p.normal.y) > 0.9 ? _a.set(1, 0, 0) : _a.set(0, 1, 0);
    p.t1.crossVectors(ref, p.normal).normalize();
    p.t2.crossVectors(p.normal, p.t1).normalize();
    this.list.push(p);
    this.sound.portalOpen(p.pos, p.big ? 1 : 0.45);
    this.fx.ring(p.pos, p.radius * 1.5, 0.7, p.normal, p.color.getHex());
    return p;
  }

  /** Shut a portal now (it still plays its closing) */
  close(p) {
    if (p.phase === 'close') return;
    p.phase = 'close';
    p.t = 0;
    this.sound.portalClose(p.pos, p.big ? 1 : 0.45);
  }

  clear() {
    this.list.length = 0;
    this.core.count = this.halo.count = 0;
  }

  update(dt) {
    this.time += dt;
    this.uTime.value = this.time;
    const fx = this.fx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.flash = Math.max(0, p.flash - dt * 2.5);
      if (p.phase === 'open') {
        p.k = springOut(Math.min(1, p.t / p.openT));
        if (p.t >= p.openT) {
          p.phase = 'hold';
          p.t = 0;
          p.k = 1;
          p.flash = 1;
          fx.flash(p.pos, p.radius * 2.2, p.color.getHex(), 0.3);
          if (p.big) fx.light(p.pos, p.color.getHex(), 90, 0.7, p.radius * 7);
          if (p.onOpen) p.onOpen(p);
        }
      } else if (p.phase === 'hold') {
        if (p.t >= p.hold && !(p.holdUntil && p.holdUntil())) this.close(p);
      } else {
        const u = Math.min(1, p.t / p.closeT);
        p.k = 1 - u * u * (3 - 2 * u);
        if (u >= 1) {
          // Collapses to a point with a last spit of sparks
          this.sparks(p, 10, -1);
          this.list.splice(i, 1);
          continue;
        }
      }
      // Embers flung off the rim while it is open
      if (Math.random() < dt * (4 + p.radius * 1.5) * p.k) this.sparks(p, 1, 1);
    }
    // Pack the live portals into the instances
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const p = this.list[i], s = Math.max(1e-3, p.radius * p.k);
      _m.makeBasis(_a.copy(p.t1).multiplyScalar(s), _b.copy(p.t2).multiplyScalar(s), _c.copy(p.normal)).setPosition(p.pos);
      this.core.setMatrixAt(i, _m);
      this.state.setXYZW(i, Math.min(1, p.k), p.seed, p.spin, p.flash);
      this.color.setXYZ(i, p.color.r, p.color.g, p.color.b);
    }
    if (n < this.core.count) for (let i = n; i < this.core.count; i++) this.core.setMatrixAt(i, ZERO);
    this.core.count = this.halo.count = n;
    this.core.instanceMatrix.needsUpdate = true;
    this.state.needsUpdate = this.color.needsUpdate = true;
  }

  /** Glowing embers off the rim: out = 1 flings them outward, -1 sucks them in */
  sparks(p, count, out) {
    const c = p.color, fx = this.fx, R = p.radius * Math.max(0.2, p.k);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      _a.copy(p.t1).multiplyScalar(ca).addScaledVector(p.t2, sa);
      const x = p.pos.x + _a.x * R, y = p.pos.y + _a.y * R, z = p.pos.z + _a.z * R;
      const sp = rand(0.6, 1.6) * Math.sqrt(p.radius) * 3;
      _b.copy(_a).multiplyScalar(out * sp).addScaledVector(p.t1, -sa * sp * 0.8 * p.spin).addScaledVector(p.t2, ca * sp * 0.8 * p.spin);
      const s = 0.35 + p.radius * 0.09;
      fx.fire.emit(x, y, z, _b.x, _b.y, _b.z, rand(0.3, 0.7), s, s * 0.2, c.r * 3, c.g * 3, c.b * 3, 1, c.r, c.g, c.b, 0, 1.2, -6);
    }
  }
}
