import * as THREE from './three.js';

// ---------------------------------------------------------------------------
// Post-processing for the High and Ultra graphics settings (Low draws straight to the canvas):
// bloom on what glows, heat shimmer round it, sun glare, a finishing grade, and on Ultra
// ambient occlusion and god rays.
//
// The scene is drawn into an offscreen target exactly as it would be onto the canvas: three
// tone-maps and sRGB-encodes in the shaders for the canvas and for XR targets only, so the
// target says it is one (isXRRenderTarget), and its storage is plain RGBA8 so blending happens
// in the same space as on the canvas too. Every hand-tuned shader keeps its colors, and High
// looks like Low before the effects go on.
//
// Only what glows feeds the bloom: materials that skip tone mapping (eyes, sensors, tracers,
// bolts) and additive ones (beams, thruster plumes, fire, flashes). Each frame those objects
// are drawn again, alone, into a glow target that shares the scene's depth, so walls still hide
// them; the sky and sunlit concrete never bloom.
//
// Ambient occlusion and god rays read the scene's depth texture, so neither draws the scene
// again: normals are rebuilt from depth.
// ---------------------------------------------------------------------------

export const GLOW_LAYER = 1;

/** Glows: drawn into the bloom (see above) */
const glows = (m) => m.toneMapped === false || m.blending === THREE.AdditiveBlending ||
  (m.blending === THREE.CustomBlending && m.blendDst === THREE.OneFactor);

const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = /* glsl */`
varying vec2 vUv;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`;

/** A full-screen pass: one triangle, its own material */
function pass(frag, uniforms = {}, opts = {}) {
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COMMON + frag, uniforms, depthTest: false, depthWrite: false, ...opts });
  const mesh = new THREE.Mesh(TRI, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// The bloom's mip chain: a 13-tap filter down (Jimenez, "Next Generation Post Processing in Call
// of Duty: Advanced Warfare"), a tent filter back up, each level added onto the one above it
const DOWN = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uKnee;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = s(vec2(0.0)) * 0.125
    + (s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0))) * 0.03125
    + (s(vec2(0.0, -2.0)) + s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, 2.0))) * 0.0625
    + (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.125;
  // The first level drops the faintest glows (dark trim, dim sparks) and keeps fireflies down
  if (uKnee > 0.0) {
    float m = max(c.r, max(c.g, c.b));
    c *= smoothstep(uKnee * 0.5, uKnee * 2.0, m) / (1.0 + m * 0.25);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const UP = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = s(vec2(0.0)) * 4.0
    + (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0
    + s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
  gl_FragColor = vec4(c * (uWeight / 16.0), 1.0);
}`;

const DEPTH = /* glsl */`
uniform sampler2D tDepth;
uniform mat4 uProjInv;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}`;

// Ambient occlusion at half resolution: a hemisphere of samples round each point, its normal
// rebuilt from the depth of its neighbours (from whichever side is nearer, so edges stay clean)
const AO = DEPTH + /* glsl */`
uniform vec2 uTexel;
uniform vec2 uProj;
uniform float uRadius, uIntensity, uFade;
#define NS 12
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0)), pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y)), pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  float z = -P.z;
  vec2 rs = uProj * 0.5 * uRadius / z;
  float a0 = hash(gl_FragCoord.xy) * 6.2831853, occ = 0.0;
  for (int i = 0; i < NS; i++) {
    float f = (float(i) + 0.5) / float(NS), a = a0 + float(i) * 2.3999632;
    vec3 S = viewPos(vUv + vec2(cos(a), sin(a)) * rs * sqrt(f));
    vec3 v = S - P;
    float l = length(v);
    occ += max(0.0, dot(v, N) / max(l, 1e-4) - 0.12) * clamp(1.0 - l * l / (uRadius * uRadius * 1.5), 0.0, 1.0);
  }
  float ao = max(0.0, 1.0 - uIntensity * occ / float(NS));
  // Fades out with distance, where the city sits in the haze anyway
  ao = mix(ao, 1.0, smoothstep(uFade * 0.5, uFade, z));
  gl_FragColor = vec4(ao, z, 0.0, 1.0);
}`;

// A 4 x 4 blur that keeps to surfaces at the same depth, so occlusion doesn't bleed over edges
const AO_BLUR = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uTexel;
void main() {
  vec2 c = texture2D(tAO, vUv).rg;
  float sum = 0.0, w = 0.0;
  for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
    vec2 s = texture2D(tAO, vUv + (vec2(x, y) + 0.5) * uTexel).rg;
    float k = 1.0 / (1e-3 + abs(s.y - c.y) / max(c.y, 1.0) * 40.0);
    sum += s.x * k; w += k;
  }
  gl_FragColor = vec4(sum / w, 0.0, 0.0, 1.0);
}`;

// How much of the sun's disc shows past the buildings, into one texel
const SUN = /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uSunUv, uAspect;
void main() {
  float vis = 0.0;
  for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
    vec2 uv = uSunUv + vec2(x, y) * 0.006 * uAspect;
    vis += (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : step(1.0, texture2D(tDepth, uv).r);
  }
  gl_FragColor = vec4(vis / 49.0, 0.0, 0.0, 1.0);
}`;

// God rays: the open sky smeared out from the sun, at quarter resolution
const RAYS = /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uSunUv, uAspect;
#define NR 40
void main() {
  vec2 dl = (uSunUv - vUv) * (0.85 / float(NR));
  vec2 uv = vUv + dl * hash(gl_FragCoord.xy);
  float sum = 0.0, w = 1.0;
  for (int i = 0; i < NR; i++) {
    sum += step(1.0, texture2D(tDepth, uv).r) * w;
    w *= 0.955;
    uv += dl;
  }
  float r = length((vUv - uSunUv) / uAspect);
  gl_FragColor = vec4(vec3(sum / float(NR) * exp(-r * 2.2)), 1.0);
}`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene, tBloom, tWide, tAO, tSun, tRays;
uniform vec2 uRes, uSunUv;
uniform vec3 uSunCol;
uniform float uTime, uBloom, uShimmer, uHurt, uCA, uSunK, uRaysK;
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 uv = vUv, asp = vec2(uRes.x / uRes.y, 1.0);
  // Heat shimmer round whatever burns or glows
  float heat = dot(texture2D(tWide, uv).rgb, vec3(0.333));
  if (heat > 0.004) {
    vec2 q = uv * asp * 38.0;
    vec2 n = vec2(noise(q + vec2(0.0, uTime * 2.3)), noise(q + vec2(17.0, uTime * 2.9))) - 0.5;
    uv += n * min(heat, 0.8) * uShimmer;
  }
  vec3 col;
  if (uCA > 0.0) {
    vec2 dc = (uv - 0.5) * dot(uv - 0.5, uv - 0.5) * uCA;
    col = vec3(texture2D(tScene, uv - dc).r, texture2D(tScene, uv).g, texture2D(tScene, uv + dc).b);
  } else col = texture2D(tScene, uv).rgb;
#ifdef USE_AO
  col *= texture2D(tAO, vUv).r;
#endif
  col += texture2D(tBloom, vUv).rgb * uBloom;
  // Glare round the sun, as much as shows of it
  vec2 sd = (vUv - uSunUv) * asp;
  float sun = texture2D(tSun, vec2(0.5)).r * uSunK, r2 = dot(sd, sd);
  col += uSunCol * sun * (exp(-r2 * 90.0) * 0.38 + exp(-sqrt(r2) * 6.0) * 0.1);
#ifdef USE_RAYS
  col += uSunCol * texture2D(tRays, vUv).r * uRaysK;
#endif
  col = min(col, vec3(1.0));
  // The grade: a touch more saturation and contrast, cool shadows, warm highlights
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.08);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.16);
  col *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.15, 0.85, l));
  // Vignette, and red closing in from the edges as the mech is hit
  vec2 v = (vUv - 0.5) * vec2(1.0, 0.85);
  float e = dot(v, v);
  col *= 1.0 - e * 0.42;
  col = mix(col, vec3(0.55, 0.02, 0.01), uHurt * smoothstep(0.05, 0.42, e) * 0.75);
  // Dither away banding in the sky
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const _v = new THREE.Vector3(), _size = new THREE.Vector2(), _sunUv = new THREE.Vector2(), _aspect = new THREE.Vector2(), _clear = new THREE.Color();

export class Post {
  /** sunDir: toward the sun (world) */
  constructor(renderer, scene, camera, sunDir) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sunDir = sunDir;
    this.quality = 'low';
    this.time = 0;
    this.w = 0; this.h = 0;
    this.targets = null;
    this.state = { hurt: 0, ca: 0 };
    this.bloom = 1.6;

    const u = (v) => ({ value: v });
    this.down = pass(DOWN, { tSrc: u(null), uTexel: u(new THREE.Vector2()), uKnee: u(0) });
    this.up = pass(UP, { tSrc: u(null), uTexel: u(new THREE.Vector2()), uWeight: u(1) }, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.ao = pass(AO, { tDepth: u(null), uProjInv: u(new THREE.Matrix4()), uTexel: u(new THREE.Vector2()), uProj: u(new THREE.Vector2()), uRadius: u(2.5), uIntensity: u(2.6), uFade: u(260) });
    this.aoBlur = pass(AO_BLUR, { tAO: u(null), uTexel: u(new THREE.Vector2()) });
    this.sun = pass(SUN, { tDepth: u(null), uSunUv: u(new THREE.Vector2()), uAspect: u(new THREE.Vector2()) });
    this.rays = pass(RAYS, { tDepth: u(null), uSunUv: u(new THREE.Vector2()), uAspect: u(new THREE.Vector2()) });
    this.comp = pass(COMPOSITE, {
      tScene: u(null), tBloom: u(null), tWide: u(null), tAO: u(null), tSun: u(null), tRays: u(null),
      uRes: u(new THREE.Vector2()), uSunUv: u(new THREE.Vector2()), uSunCol: u(new THREE.Color(1, 0.88, 0.7)),
      uTime: u(0), uBloom: u(1.1), uShimmer: u(0.0035), uHurt: u(0), uCA: u(0), uSunK: u(0), uRaysK: u(0.45),
    });
  }

  get active() { return this.quality !== 'low'; }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    const d = this.comp.material.defines;
    if (q === 'ultra') d.USE_AO = d.USE_RAYS = ''; else { delete d.USE_AO; delete d.USE_RAYS; }
    this.comp.material.needsUpdate = true;
    this.dispose();
  }

  dispose() {
    if (!this.targets) return;
    const T = this.targets;
    for (const t of [T.scene, T.glow, T.ao, T.aoBlur, T.sun, T.rays, ...T.mips]) if (t) t.dispose();
    this.targets = null;
  }

  /** Render targets for a w x h drawing buffer, made on first use and remade when it changes size */
  build(w, h) {
    this.dispose();
    this.w = w; this.h = h;
    const ultra = this.quality === 'ultra';
    // MSAA in place of the canvas's own; at high pixel ratios two samples are plenty
    const samples = Math.min(this.renderer.capabilities.maxSamples, w * h > 4.5e6 ? 2 : 4);
    const sceneT = new THREE.WebGLRenderTarget(w, h, { samples, colorSpace: THREE.SRGBColorSpace, depthTexture: new THREE.DepthTexture(w, h) });
    sceneT.texture.internalFormat = 'RGBA8';
    sceneT.isXRRenderTarget = true;
    const glow = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, colorSpace: THREE.SRGBColorSpace, depthTexture: sceneT.depthTexture });
    glow.isXRRenderTarget = true;
    const mips = [];
    for (let i = 0, mw = w, mh = h; i < 6; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false }));
      if (mw < 8 || mh < 8) break;
    }
    const half = { type: THREE.UnsignedByteType, depthBuffer: false };
    this.targets = {
      scene: sceneT, glow, mips,
      ao: ultra ? new THREE.WebGLRenderTarget(w >> 1, h >> 1, { type: THREE.HalfFloatType, depthBuffer: false }) : null,
      aoBlur: ultra ? new THREE.WebGLRenderTarget(w >> 1, h >> 1, half) : null,
      sun: new THREE.WebGLRenderTarget(1, 1, half),
      rays: ultra ? new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), half) : null,
    };
  }

  /** Mark what glows for the glow pass: it can change as effects come and go (and skip what's empty: main.js) */
  tagGlow() {
    this.scene.traverseVisible((o) => {
      const m = o.material;
      if (!m) return;
      const g = o.layers.isEnabled(0) && (Array.isArray(m) ? m.some(glows) : glows(m));
      if (g) o.layers.enable(GLOW_LAYER); else o.layers.disable(GLOW_LAYER);
    });
  }

  run(mesh, target) {
    this.renderer.setRenderTarget(target);
    this.renderer.render(mesh, ORTHO);
  }

  render(dt) {
    const R = this.renderer, cam = this.camera, scene = this.scene;
    R.getDrawingBufferSize(_size);
    if (!this.targets || _size.x !== this.w || _size.y !== this.h) this.build(_size.x, _size.y);
    const T = this.targets, ultra = this.quality === 'ultra';
    this.time += dt;
    const autoClear = R.autoClear, shadowAuto = R.shadowMap.autoUpdate;

    // The scene, as the canvas would show it
    R.setRenderTarget(T.scene);
    R.render(scene, cam);
    R.autoClear = false;

    // What glows, again, over the scene's depth
    this.tagGlow();
    R.shadowMap.autoUpdate = false;
    R.setRenderTarget(T.glow);
    R.getClearColor(_clear);
    const clearA = R.getClearAlpha();
    R.setClearColor(0x000000, 0);
    R.clear(true, false, false);
    R.setClearColor(_clear, clearA);
    cam.layers.set(GLOW_LAYER);
    R.render(scene, cam);
    cam.layers.set(0);
    R.shadowMap.autoUpdate = shadowAuto;

    // Bloom: down the mip chain, then back up it
    const D = this.down.material.uniforms, U = this.up.material.uniforms;
    let src = T.glow;
    T.mips.forEach((m, i) => {
      D.tSrc.value = src.texture;
      D.uTexel.value.set(1 / src.width, 1 / src.height);
      D.uKnee.value = i === 0 ? 0.1 : 0;
      this.run(this.down, m);
      src = m;
    });
    for (let i = T.mips.length - 1; i > 0; i--) {
      const s = T.mips[i];
      U.tSrc.value = s.texture;
      U.uTexel.value.set(1 / s.width, 1 / s.height);
      U.uWeight.value = 1;
      this.run(this.up, T.mips[i - 1]);
    }

    // The sun: where it is on screen, and how much of it shows
    _v.copy(cam.position).addScaledVector(this.sunDir, 5000).project(cam);
    const facing = _v.z < 1 ? 1 : 0;
    const sunUv = _sunUv.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    // Fades as the sun leaves the screen
    const off = Math.max(Math.abs(_v.x), Math.abs(_v.y));
    const onScreen = facing * THREE.MathUtils.clamp((1.35 - off) / 0.35, 0, 1);
    const aspect = _aspect.set(this.h / this.w, 1);
    const depth = T.scene.depthTexture;
    if (onScreen > 0) {
      const S = this.sun.material.uniforms;
      S.tDepth.value = depth; S.uSunUv.value.copy(sunUv); S.uAspect.value.copy(aspect);
      this.run(this.sun, T.sun);
      if (ultra) {
        const Ra = this.rays.material.uniforms;
        Ra.tDepth.value = depth; Ra.uSunUv.value.copy(sunUv); Ra.uAspect.value.copy(aspect);
        this.run(this.rays, T.rays);
      }
    }

    if (ultra) {
      const A = this.ao.material.uniforms, pe = cam.projectionMatrix.elements;
      A.tDepth.value = depth;
      A.uProjInv.value.copy(cam.projectionMatrixInverse);
      A.uTexel.value.set(1 / this.w, 1 / this.h);
      A.uProj.value.set(pe[0], pe[5]);
      this.run(this.ao, T.ao);
      const B = this.aoBlur.material.uniforms;
      B.tAO.value = T.ao.texture;
      B.uTexel.value.set(1 / T.ao.width, 1 / T.ao.height);
      this.run(this.aoBlur, T.aoBlur);
    }

    // Everything together, onto the canvas
    const C = this.comp.material.uniforms;
    C.tScene.value = T.scene.texture;
    C.tBloom.value = T.mips[0].texture;
    C.tWide.value = T.mips[Math.min(2, T.mips.length - 1)].texture;
    C.tAO.value = ultra ? T.aoBlur.texture : null;
    C.tSun.value = T.sun.texture;
    C.tRays.value = ultra ? T.rays.texture : null;
    C.uRes.value.set(this.w, this.h);
    C.uSunUv.value.copy(sunUv);
    C.uSunK.value = onScreen;
    C.uRaysK.value = 0.45 * onScreen;
    C.uBloom.value = this.bloom / T.mips.length;
    C.uTime.value = this.time;
    C.uHurt.value = this.state.hurt;
    C.uCA.value = this.state.ca;
    this.run(this.comp, null);
    R.autoClear = autoClear;
  }
}
