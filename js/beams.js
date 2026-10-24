import * as THREE from './three.js';

// Beam ribbons, shared by every weapon that draws one (bolts, the mega beam, rails,
// arcs, blades, the orbital column). Beams are ribbons that run along local +Y (0..1) and turn about that axis
// to face the camera, so they read as solid light from any angle.
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
uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uCore;
varying vec2 vUv;
void main() {
  float d = abs(vUv.x - 0.5) * 2.0;
  float glow = pow(1.0 - d, 2.2);
  float core = smoothstep(0.32, 0.0, d) * uCore;
  float ripple = 0.85 + 0.15 * sin(vUv.y * 160.0 - uTime * 90.0);
  vec3 col = uColor * glow * 1.4 + vec3(1.0) * core;
  gl_FragColor = vec4(col * ripple * uAlpha, 1.0);
}`;

export function beamMaterial(color, core = 1, width = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 1 }, uCore: { value: core }, uWidth: { value: width } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}

// Ribbon from y=0 to y=1, oriented later with a quaternion
export const BEAM_GEO = new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
