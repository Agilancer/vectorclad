import * as THREE from './three.js';
import { SPIDER_ATLAS, SPIDER_PARTS } from './spiderParts.js';

// ---------------------------------------------------------------------------
// Shared by spider-frames and scorpion-frames: plates and hulls cut from the
// spider atlas, the palette-swap material, leg rigs and two-bone leg IK, and
// the mech's hit capsule.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _a = new V3(), _u = new V3(), _r = new V3(), _n = new V3();
const UP = new V3(0, 1, 0);

const AW = SPIDER_ATLAS.w, AH = SPIDER_ATLAS.h;
const EDGE_UV = new THREE.Vector2(1014 / AW, 1 - 1014 / AH); // an unused black corner: plate edges read as dark seams

function addColor(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = fn ? fn(p.getX(i), p.getY(i), p.getZ(i)) : 1;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/**
 * A plate cut to a traced part outline, with the part's art on both faces.
 * Local space: the part's top end at the origin and its tip at (0, -1, 0),
 * so scaling by a segment's length makes it span joint to joint. Curved
 * parts are rotated so their actual tip lands on the end. Thickness runs
 * along z from -0.5 to 0.5.
 */
export function plateGeo(name) {
  const { poly } = SPIDER_PARTS[name];
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of poly) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const top = poly.filter(([, y]) => y < minY + (maxY - minY) * 0.12);
  const tx = top.reduce((s, p) => s + p[0], 0) / top.length, ty = top.reduce((s, p) => s + p[1], 0) / top.length;
  let tip = poly[0];
  for (const p of poly) if (p[1] > tip[1]) tip = p;
  const L = Math.hypot(tip[0] - tx, tip[1] - ty), ang = Math.atan2(tip[0] - tx, tip[1] - ty);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // image (x right, y down) <-> local (x right, y up, tip at -1)
  const toLocal = (x, y) => {
    const dx = (x - tx) / L, dy = (y - ty) / L;
    return new THREE.Vector2(dx * ca - dy * sa, -(dx * sa + dy * ca));
  };
  const uvOf = (lx, ly) => {
    const rx = lx, ry = -ly;
    return new THREE.Vector2((tx + (rx * ca + ry * sa) * L) / AW, 1 - (ty + (-rx * sa + ry * ca) * L) / AH);
  };
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(poly.map(([x, y]) => toLocal(x, y))), {
    depth: 0.7, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.01, bevelOffset: -0.01, bevelSegments: 1,
    UVGenerator: {
      generateTopUV(_g, v, a, b, c) { return [uvOf(v[a * 3], v[a * 3 + 1]), uvOf(v[b * 3], v[b * 3 + 1]), uvOf(v[c * 3], v[c * 3 + 1])]; },
      generateSideWallUV() { return [EDGE_UV, EDGE_UV, EDGE_UV, EDGE_UV]; },
    },
  });
  g.translate(0, 0, -0.35);
  return addColor(g);
}

/** Ellipsoid with a rectangle of the atlas projected onto it from above (front at the image top) */
export function hullGeo(name, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(1, 24, 14);
  const [rx, ry, rw, rh] = SPIDER_PARTS[name].rect;
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (rx + (p.getX(i) * 0.5 + 0.5) * rw) / AW, 1 - (ry + (0.5 - p.getZ(i) * 0.5) * rh) / AH);
  }
  addColor(g, (x, y) => (y >= 0 ? 1 : 0.3 + 0.7 * (1 + y)));
  g.scale(sx, sy, sz);
  return g;
}

/** Joint disc: the turbine art on both caps, dark rim. Axis along local y. */
export function jointGeo() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 18, 1);
  const [rx, ry, rw, rh] = SPIDER_PARTS.joint.rect;
  const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, (rx + (p.getX(i) * 0.5 + 0.5) * rw) / AW, 1 - (ry + (p.getZ(i) * 0.5 + 0.5) * rh) / AH);
    else uv.setXY(i, EDGE_UV.x, EDGE_UV.y);
  }
  return addColor(g);
}

/** Plate matrix: top end at o, tip along tipDir, art facing rightHint × up, width wk of the length */
export function plateMatrix(out, o, tipDir, rightHint, len, wk, thick) {
  _u.copy(tipDir).normalize().negate();
  _r.copy(rightHint).addScaledVector(_u, -rightHint.dot(_u));
  if (_r.lengthSq() < 1e-8) _r.set(1, 0, 0).addScaledVector(_u, -_u.x);
  _r.normalize();
  _n.crossVectors(_r, _u);
  out.makeBasis(_r.multiplyScalar(len * wk), _u.multiplyScalar(len), _n.multiplyScalar(thick));
  return out.setPosition(o);
}

// ---------------------------------------------------------------------------
// Palette swap: every frame shares the atlas, and each instance carries its own
// colors. lift brightens the bare metal toward white and tint colors it, accent
// replaces the red paint (picked out by how much redder a texel is than its
// green and blue), and glow recolors the lit tubes. The accent's fourth channel
// makes the paint itself glow, for the neon kinds.
// ---------------------------------------------------------------------------

export function paletteMaterial(tex, glowTex) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: glowTex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.4,
    metalness: 0.6, roughness: 0.42, vertexColors: true,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aTint; attribute vec4 aAccent; attribute vec3 aGlow;
        varying vec4 vTint; varying vec4 vAccent; varying vec3 vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTint = aTint; vAccent = aAccent; vGlow = aGlow;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vTint; varying vec4 vAccent; varying vec3 vGlow;
        float gPaint = 0.0;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 tc = diffuseColor.rgb;
          gPaint = clamp((tc.r - max(tc.g, tc.b)) * 3.0, 0.0, 1.0);
          float lum = dot(tc, vec3(0.299, 0.587, 0.114));
          vec3 metal = (tc + vTint.a * (1.0 - tc)) * vTint.rgb;
          diffuseColor.rgb = min(mix(metal, lum * vAccent.rgb * 2.4, gPaint), vec3(1.0));
        }`)
      .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
          vec4 emissiveColor = texture2D(emissiveMap, vEmissiveMapUv);
          totalEmissiveRadiance *= max(emissiveColor.r, max(emissiveColor.g, emissiveColor.b)) * vGlow;
        #endif
        totalEmissiveRadiance += gPaint * vAccent.rgb * vAccent.w;`);
  };
  return mat;
}

/** An InstancedMesh of `count` hidden instances carrying the palette attributes */
export function paletteMesh(scene, geo, mat, count) {
  const accent = new Float32Array(count * 4).fill(1);
  for (let i = 3; i < accent.length; i += 4) accent[i] = 0;
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(count * 4).fill(1), 4));
  geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(accent, 4));
  geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3));
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < count; i++) { m.setMatrixAt(i, zero); m.setColorAt(i, white); }
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  scene.add(m);
  return m;
}

/** Write a palette into instances [from, from + n) of a palette mesh. glowK scales the glow. */
export function paintInstances(mesh, from, n, pal, tint, glowK = 1) {
  const g = mesh.geometry, neon = pal.neon || 0;
  for (let i = from; i < from + n; i++) {
    g.attributes.aTint.setXYZW(i, tint[0], tint[1], tint[2], pal.lift);
    g.attributes.aAccent.setXYZW(i, pal.accent[0], pal.accent[1], pal.accent[2], neon * glowK);
    g.attributes.aGlow.setXYZ(i, pal.glow[0] * glowK, pal.glow[1] * glowK, pal.glow[2] * glowK);
  }
  g.attributes.aTint.needsUpdate = g.attributes.aAccent.needsUpdate = g.attributes.aGlow.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Leg rigs. A rig lists every leg with its hip on the body and its rest spot on
// the surface plane (both in body units), which side it is on, and which of the
// two alternating step groups it belongs to. Legs are given for the right side,
// front to back; the left side mirrors them and comes first.
// ---------------------------------------------------------------------------

export function mirrorLegs(pairs) {
  return [
    ...pairs.map((L, k) => ({ hip: L.hip, rest: L.rest, side: -1, group: k % 2 })),
    ...pairs.map((L, k) => ({ hip: L.hip, rest: L.rest, side: 1, group: (k + 1) % 2 })),
  ];
}

const LEG = { knee: new V3(), tip: new V3(), pole: new V3(), axis: new V3() };

/**
 * Two-bone IK from hip toward foot with bone lengths a1 and b1. The knee is
 * thrown along `up`, pushed outward from `center` by outK. Returns shared
 * vectors: knee, tip (the reached foot), pole (the leg plane's bend direction)
 * and axis (the knee's hinge axis).
 */
export function solveLeg(hip, foot, a1, b1, center, up, outK) {
  const D = _a.subVectors(foot, hip);
  let d = D.length();
  const dir = D.divideScalar(d || 1);
  d = clamp(d, Math.abs(a1 - b1) + 0.05, a1 + b1 - 0.02);
  const cosA = clamp((a1 * a1 + d * d - b1 * b1) / (2 * a1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const out = _n.subVectors(hip, center).addScaledVector(up, -_n.dot(up)).normalize();
  const pole = LEG.pole.copy(up).addScaledVector(out, outK);
  pole.addScaledVector(dir, -pole.dot(dir));
  if (pole.lengthSq() < 1e-6) pole.copy(out);
  pole.normalize();
  LEG.knee.copy(hip).addScaledVector(dir, a1 * cosA).addScaledVector(pole, a1 * sinA);
  LEG.tip.copy(hip).addScaledVector(dir, d);
  LEG.axis.crossVectors(dir, pole).normalize();
  return LEG;
}

/** Warning reticle for where something will land or burst out: a heavy ring, a dashed inner ring, ticks and a faint fill */
export function markerTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  g.strokeStyle = g.fillStyle = '#fff';
  g.globalAlpha = 0.12;
  g.beginPath(); g.arc(m, m, m - 8, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  g.lineWidth = 12;
  g.beginPath(); g.arc(m, m, m - 10, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5;
  g.setLineDash([14, 12]);
  g.beginPath(); g.arc(m, m, m * 0.5, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  for (let i = 0; i < 4; i++) {
    g.save(); g.translate(m, m); g.rotate(i * Math.PI / 2);
    g.fillRect(-4, -m + 14, 8, 40);
    g.restore();
  }
  g.fillRect(m - 10, m - 2, 20, 4); g.fillRect(m - 2, m - 10, 4, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Beam shader (camera-facing ribbon along local +y, 0..1)
// ---------------------------------------------------------------------------

const BEAM_VERT = /* glsl */`
uniform float uWidth;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 base = (modelMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz;
  vec3 axis = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 side = cross(axis, cameraPosition - base);
  float L = length(side);
  side = L > 1e-5 ? side / L : vec3(1.0, 0.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(base + side * position.x * uWidth, 1.0);
}`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uAlpha; uniform float uCore; uniform float uTime;
varying vec2 vUv;
void main() {
  float d = abs(vUv.x - 0.5) * 2.0;
  float glow = pow(1.0 - d, 2.2);
  float core = smoothstep(0.35, 0.0, d) * uCore;
  float ripple = 0.8 + 0.2 * sin(vUv.y * 220.0 - uTime * 80.0);
  gl_FragColor = vec4((uColor * glow * 1.5 + vec3(1.0, 0.85, 0.85) * core) * ripple * uAlpha, 1.0);
}`;
const BEAM_GEO = new THREE.PlaneGeometry(1, 1, 1, 6).translate(0, 0.5, 0);

export function beamMesh(color) {
  const m = new THREE.Mesh(BEAM_GEO, new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 }, uCore: { value: 1 }, uWidth: { value: 1 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  }));
  m.frustumCulled = false;
  m.renderOrder = 6;
  m.visible = false;
  return m;
}

/** Lay a beam mesh from a to b: width, alpha and the white-hot core's strength, at time t (for the ripple) */
export function drawBeam(mesh, a, b, width, alpha, core, t) {
  const len = a.distanceTo(b);
  mesh.visible = alpha > 0.01 && len > 0.1;
  if (!mesh.visible) return;
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, _a.subVectors(b, a).divideScalar(len));
  mesh.scale.set(1, len, 1);
  const u = mesh.material.uniforms;
  u.uWidth.value = width; u.uAlpha.value = alpha; u.uCore.value = core; u.uTime.value = t;
}

// ---------------------------------------------------------------------------
// The player mech as a capsule from its hips to its head
// ---------------------------------------------------------------------------

export function capsuleDist(p, base) {
  const y = clamp(p.y, base.y + 1.5, base.y + 6.8);
  return Math.hypot(p.x - base.x, p.y - y, p.z - base.z);
}

/** First point along a-b inside the capsule, or null */
export function segCapsuleHit(a, b, base, r) {
  // Sample the segment; the beam is long and the capsule is fat, so this is plenty
  const n = Math.ceil(a.distanceTo(b) / 0.8);
  for (let i = 0; i <= n; i++) {
    _a.lerpVectors(a, b, i / n);
    if (capsuleDist(_a, base) < r) return _a.clone();
  }
  return null;
}
