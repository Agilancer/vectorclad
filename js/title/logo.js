/**
 * VECTORCLAD live 3D title logo (three.js, shared instance via the import map in index.html).
 *
 * Copied from the vectorclad-brand kit (web/vectorclad-logo.js). Geometry and colors come from
 * ./wordmark-data.js, generated in that kit from logo/source/wordmark.json and tokens/palette.json.
 * To change the logo, change it there and copy both files back here.
 *
 *   const logo = createVectorcladLogo(canvas, { offsetY: 0.08, maxPixelRatio: 1.5, fogParticles: 40 });
 *   logo.pause(); logo.play(); logo.dispose();
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WORDMARK, PALETTE } from './wordmark-data.js';

/** Motion and lighting rig. Values are documented in docs/motion-and-lighting.md. */
export const RIG = {
  exposure: 1.05,
  fov: 30,
  bloom: { strength: 0.95, radius: 0.55, threshold: 0.82 },
  edge: { radius: 0.012, base: 0.18, streakGain: 3.2, headGain: 1.3, speedMin: 0.9, speedMax: 2.0, tailMin: 0.3, tailMax: 0.6 },
  insert: { gain: 1.9, pulse: 0.6 },
  ignition: { start: 0.3, stagger: 0.13, duration: 0.55 },
  flickerPerSecond: 0.35,
  movers: [
    { color: 'purple', intensity: 5.5, f: (t) => [6.6 * Math.sin(t * 0.33), 0.25 + 0.55 * Math.sin(t * 0.83), 1.35 + 0.25 * Math.sin(t * 0.51)] },
    { color: 'green', intensity: 5.5, f: (t) => [6.6 * Math.sin(t * 0.26 + 2.1), -0.05 + 0.5 * Math.cos(t * 0.67), 1.2 + 0.2 * Math.cos(t * 0.4)] },
    { color: 'yellow', intensity: 5.5, f: (t) => [6.6 * Math.sin(t * 0.41 + 4.2), 0.15 + 0.45 * Math.sin(t * 1.07 + 1.0), 1.55] }
  ],
  beams: [
    { color: 'purple', from: [-4.6, 6.2, 2.6], speed: 0.21, phase: 0.0, intensity: 40, angle: 0.2 },
    { color: 'green', from: [4.6, 6.2, 2.2], speed: 0.17, phase: 2.4, intensity: 40, angle: 0.2 }
  ],
  fogParticles: 72
};

const STREAK_CYCLE = ['purple', 'green', 'yellow'];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {boolean} [options.paused]        start paused (defaults to prefers-reduced-motion)
 * @param {number}  [options.offsetY=0]     shift the logo up the frame, as a fraction of the canvas height
 * @param {number}  [options.margin=1.75]   empty space either side of the wordmark, in cap heights
 * @param {boolean} [options.intro=true]    letter-by-letter neon ignition on start
 * @param {boolean} [options.pointer=true]  tilt toward the pointer
 * @param {boolean} [options.hud=true]      draw HUD rails, tags and status lights
 * @param {boolean} [options.floor=true]    draw the grid floor
 * @param {number}  [options.maxPixelRatio=2]  cap on devicePixelRatio (lower it on phones)
 * @param {number}  [options.fogParticles]  number of fog sprites (default RIG.fogParticles)
 * @param {() => void} [options.onReady]    called after the first frame
 */
export function createVectorcladLogo(canvas, options = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const opts = {
    paused: reduce, offsetY: 0, margin: 1.75, intro: true, pointer: true, hud: true, floor: true,
    maxPixelRatio: 2, fogParticles: RIG.fogParticles, onReady: null, ...options
  };
  const PAL = PALETTE;
  const { shear: SHEAR } = WORDMARK;
  const { depth: DEPTH, bevelThickness: BEVEL_T, bevelSize: BEVEL_S, insertDepth, wireDepth } = WORDMARK.extrude;
  const HZ = DEPTH + BEVEL_T + 0.01;
  const LETTERS = WORDMARK.letters.length;
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  /* renderer / scene */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RIG.exposure;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.void);
  scene.fog = new THREE.FogExp2(PAL.void, 0.02);
  const camera = new THREE.PerspectiveCamera(RIG.fov, 1, 0.1, 160);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  const logo = new THREE.Group();
  scene.add(logo);

  /* materials */
  const capMat = track(new THREE.MeshStandardMaterial({ color: PAL.gunmetal, metalness: 0.88, roughness: 0.3, envMapIntensity: 0.55 }));
  const sideMat = track(new THREE.MeshStandardMaterial({ color: PAL.carbon, metalness: 0.8, roughness: 0.42, envMapIntensity: 0.35 }));
  const wireMat = track(new THREE.MeshStandardMaterial({ color: PAL.steel, metalness: 0.4, roughness: 0.35, emissive: '#6b6e7c', emissiveIntensity: 0.6 }));

  const TUBE_VS = `
    uniform float uLen;
    varying float vS;
    void main() {
      vS = uv.x * uLen;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const TUBE_FS = `
    uniform float uTime;
    uniform float uSpeed;
    uniform float uPhase;
    uniform float uPeriod;
    uniform float uTail;
    uniform float uBase;
    uniform float uStreak;
    uniform float uStreakGain;
    uniform float uHeadGain;
    uniform vec3 uColor;
    varying float vS;
    void main() {
      float dir = uSpeed < 0.0 ? -1.0 : 1.0;
      float u = fract(dir * (uTime * uSpeed + uPhase - vS) / uPeriod) * uPeriod;
      float tail = exp(-u / uTail);
      float head = exp(-u / 0.04);
      vec3 c = uColor * (uBase + tail * uStreakGain * uStreak) + vec3(1.0) * head * uHeadGain * uStreak;
      gl_FragColor = vec4(c, 1.0);
    }`;

  function makeTube(pts, z, color, reverse) {
    const path = new THREE.CurvePath();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      path.add(new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, z), new THREE.Vector3(b.x, b.y, z)));
    }
    const len = path.getLength();
    const geo = track(new THREE.TubeGeometry(path, Math.max(64, Math.ceil(len * 70)), RIG.edge.radius, 5, true));
    const e = RIG.edge;
    const mat = track(new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLen: { value: len },
        uSpeed: { value: (e.speedMin + Math.random() * (e.speedMax - e.speedMin)) * (reverse ? -1 : 1) },
        uPhase: { value: Math.random() * len },
        uPeriod: { value: len > 3.2 ? len / 2 : len },
        uTail: { value: e.tailMin + Math.random() * (e.tailMax - e.tailMin) },
        uBase: { value: 0 },
        uStreak: { value: 0 },
        uStreakGain: { value: e.streakGain },
        uHeadGain: { value: e.headGain },
        uColor: { value: new THREE.Color(color) }
      },
      vertexShader: TUBE_VS,
      fragmentShader: TUBE_FS
    }));
    return { mesh: new THREE.Mesh(geo, mat), mat };
  }

  /* wordmark */
  let minX = Infinity, maxX = -Infinity;
  WORDMARK.pieces.forEach((p) => [p.outer, ...(p.holes || [])].forEach((ring) => ring.forEach(([x, y]) => {
    const sx = x + SHEAR * y;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
  })));
  const CX = (minX + maxX) / 2;
  const HW = (maxX - minX) / 2;
  const tx = (p) => new THREE.Vector2(p[0] + SHEAR * p[1] - CX, p[1] - 0.5);

  const tubes = [];
  const inserts = [];
  WORDMARK.pieces.forEach((piece, pi) => {
    const li = piece.letter;
    const outer = piece.outer.map(tx);
    const holes = (piece.holes || []).map((h) => h.map(tx));
    const shape = new THREE.Shape(outer);
    holes.forEach((h) => shape.holes.push(new THREE.Path(h)));
    if (piece.role === 'wire') {
      const geo = track(new THREE.ExtrudeGeometry(shape, { depth: wireDepth, bevelEnabled: false, curveSegments: 1 }));
      geo.translate(0, 0, DEPTH + BEVEL_T - wireDepth);
      logo.add(new THREE.Mesh(geo, wireMat));
    } else if (piece.role === 'insert') {
      const geo = track(new THREE.ExtrudeGeometry(shape, { depth: insertDepth, bevelEnabled: false, curveSegments: 1 }));
      geo.translate(0, 0, DEPTH + BEVEL_T - insertDepth);
      const base = new THREE.Color(PAL[piece.color]);
      const mat = track(new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(2.2) }));
      logo.add(new THREE.Mesh(geo, mat));
      inserts.push({ mat, base, phase: Math.random() * 6.28, speed: 0.8 + Math.random() * 1.4, letter: li });
    } else {
      const geo = track(new THREE.ExtrudeGeometry(shape, {
        depth: DEPTH, bevelEnabled: true, bevelThickness: BEVEL_T, bevelSize: BEVEL_S,
        bevelOffset: -BEVEL_S, bevelSegments: 1, curveSegments: 1
      }));
      logo.add(new THREE.Mesh(geo, [capMat, sideMat]));
      const color = PAL[STREAK_CYCLE[(li + pi) % STREAK_CYCLE.length]];
      [outer, ...holes].forEach((ring, ri) => {
        const t = makeTube(ring, DEPTH + 0.002, color, ri > 0 || pi % 2 === 1);
        logo.add(t.mesh);
        tubes.push({ mat: t.mat, letter: li });
      });
    }
  });

  /* HUD rails, tags and status lights */
  let statusMat = null;
  const redBase = new THREE.Color(PAL.red);
  if (opts.hud) {
    const lineMat = track(new THREE.LineBasicMaterial({ color: PAL.steel, transparent: true, opacity: 0.5 }));
    const lineMatGreen = track(new THREE.LineBasicMaterial({ color: PAL.green, transparent: true, opacity: 0.7 }));
    const hudLine = (points, mat) => {
      const geo = track(new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p[0], p[1], HZ))));
      logo.add(new THREE.Line(geo, mat || lineMat));
    };
    const L = -HW, R = HW;
    hudLine([[L - 0.2, 0.94], [0.3, 0.94], [0.48, 1.06], [R + 0.45, 1.06]]);
    hudLine([[L - 0.3, -0.92], [-1.0, -0.92], [-1.18, -1.04], [R + 0.2, -1.04]]);
    hudLine([[L - 0.2, 0.94], [L - 0.2, 0.82]]);
    hudLine([[R + 0.2, -1.04], [R + 0.2, -0.92]]);
    hudLine([[R + 0.45, 0.45], [R + 1.55, 0.45]]);
    hudLine([[R + 0.65, 0.33], [R + 1.35, 0.33]], lineMatGreen);
    hudLine([[L - 1.4, -0.3], [L - 0.35, -0.3]]);
    hudLine([[L - 1.1, -0.42], [L - 0.55, -0.42]], lineMatGreen);
    hudLine([[L - 0.32, -1.15], [L - 0.2, -1.15]]); hudLine([[L - 0.26, -1.21], [L - 0.26, -1.09]]);
    hudLine([[L - 0.1, -1.15], [L + 0.02, -1.15]]); hudLine([[L - 0.04, -1.21], [L - 0.04, -1.09]]);

    const flatShape = (pts, color, k) => {
      const geo = track(new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])))));
      geo.translate(0, 0, HZ);
      const mat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      logo.add(new THREE.Mesh(geo, mat));
      return mat;
    };
    flatShape([[R - 1.05, 1.1], [R + 0.45, 1.1], [R + 0.51, 1.2], [R - 0.99, 1.2]], PAL.yellow, 1.5);
    for (let i = 0; i < 8; i++) {
      const x = R - 2.3 + i * 0.21;
      flatShape([[x, -1.19], [x + 0.13, -1.19], [x + 0.16, -1.13], [x + 0.03, -1.13]], PAL.blue, 1.8);
    }
    statusMat = flatShape([[L - 0.56, 0.86], [L - 0.46, 0.86], [L - 0.46, 0.96], [L - 0.56, 0.96]], PAL.red, 2.0);
  }

  /* procedural textures */
  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'));
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const smokeTex = canvasTexture(128, 128, (g) => {
    for (let i = 0; i < 28; i++) {
      const x = 64 + (Math.random() - 0.5) * 54, y = 64 + (Math.random() - 0.5) * 54, r = 16 + Math.random() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.2)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, 128, 128);
  });
  const glowTex = canvasTexture(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
  const flareTex = canvasTexture(256, 64, (g) => {
    const h = g.createLinearGradient(0, 0, 256, 0);
    h.addColorStop(0, 'rgba(255,255,255,0)');
    h.addColorStop(0.5, 'rgba(255,255,255,1)');
    h.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = h; g.fillRect(0, 30, 256, 4);
    const r = g.createRadialGradient(128, 32, 0, 128, 32, 18);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(100, 4, 56, 56);
  });

  /* colored haze behind the letters */
  [['purple', -2.6, 0.15, 10, 3.2, 0.26], ['green', 3.0, -0.1, 8.5, 2.6, 0.16], ['yellow', 0.4, 0.35, 6, 1.6, 0.08]].forEach(([c, x, y, sx, sy, o]) => {
    const s = new THREE.Sprite(track(new THREE.SpriteMaterial({
      map: glowTex, color: PAL[c], transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    })));
    s.position.set(x, y, -1.5);
    s.scale.set(sx, sy, 1);
    logo.add(s);
  });

  /* fog rolling out from behind */
  const fog = [];
  const fogGrey = new THREE.Color('#6b6f80');
  const fogTints = ['purple', 'green', 'yellow', 'purple'].map((c) => new THREE.Color(PAL[c]));
  function spawnFog(p, initial) {
    const side = Math.random() < 0.5 ? -1 : 1;
    p.life = 7 + Math.random() * 7;
    p.age = initial ? Math.random() * p.life : 0;
    p.pos.set(side * Math.random() * 5.6, -0.6 + Math.random() * 1.0, -0.35 - Math.random() * 0.7);
    p.vel.set(side * (0.12 + Math.random() * 0.32), 0.02 + Math.random() * 0.09, 0.03 + Math.random() * 0.1);
    if (initial) p.pos.addScaledVector(p.vel, p.age);
    p.s0 = 1.1 + Math.random() * 0.8;
    p.s1 = 3.2 + Math.random() * 2.2;
    p.maxO = 0.16 + Math.random() * 0.16;
    p.vr = (Math.random() - 0.5) * 0.2;
    p.mat.rotation = (Math.random() - 0.5) * 0.8;
    p.mat.color.copy(fogGrey).lerp(fogTints[(Math.random() * fogTints.length) | 0], 0.18 + Math.random() * 0.24);
  }
  for (let i = 0; i < opts.fogParticles; i++) {
    const mat = track(new THREE.SpriteMaterial({ map: smokeTex, color: '#6b6f80', transparent: true, opacity: 0, depthWrite: false }));
    const sprite = new THREE.Sprite(mat);
    logo.add(sprite);
    const p = { sprite, mat, pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    spawnFog(p, true);
    fog.push(p);
  }
  function updateFog(dt) {
    for (const p of fog) {
      p.age += dt;
      if (p.age >= p.life) spawnFog(p, false);
      p.pos.addScaledVector(p.vel, dt);
      const k = p.age / p.life;
      const sc = p.s0 + (p.s1 - p.s0) * k;
      p.sprite.position.copy(p.pos);
      p.sprite.scale.set(sc, sc * 0.72, 1);
      p.mat.opacity = p.maxO * Math.pow(Math.sin(Math.PI * k), 1.3);
      p.mat.rotation += p.vr * dt;
    }
  }

  /* lights */
  const key = new THREE.DirectionalLight('#c9d2ff', 0.45);
  key.position.set(-4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(PAL.purple, 1.6);
  rim.position.set(3, 2, -6);
  scene.add(rim);

  const movers = RIG.movers.map((m) => {
    const light = new THREE.PointLight(PAL[m.color], m.intensity, 6, 1.6);
    logo.add(light);
    const flare = new THREE.Sprite(track(new THREE.SpriteMaterial({
      map: flareTex, color: new THREE.Color(PAL[m.color]).multiplyScalar(1.4), transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    })));
    flare.scale.set(3.0, 0.75, 1);
    logo.add(flare);
    return { ...m, light, flare };
  });

  const BEAM_VS = `
    varying float vY;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vY = -position.y;
      vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`;
  const BEAM_FS = `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vY;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
      float a = uOpacity * f * pow(clamp(1.0 - vY, 0.0, 1.0), 1.3) * smoothstep(0.0, 0.08, vY);
      gl_FragColor = vec4(uColor, a);
    }`;
  const beamGeo = track(new THREE.ConeGeometry(1, 1, 40, 1, true));
  beamGeo.translate(0, -0.5, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const beams = RIG.beams.map((b) => {
    const from = new THREE.Vector3(...b.from);
    const spot = new THREE.SpotLight(PAL[b.color], b.intensity, 0, b.angle, 0.6, 1.5);
    spot.position.copy(from);
    scene.add(spot);
    scene.add(spot.target);
    const mesh = new THREE.Mesh(beamGeo, track(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(PAL[b.color]) }, uOpacity: { value: 0.11 } },
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
    })));
    mesh.position.copy(from);
    scene.add(mesh);
    return { ...b, from, spot, mesh, target: new THREE.Vector3() };
  });

  /* floor */
  if (opts.floor) {
    const floor = new THREE.Mesh(
      track(new THREE.PlaneGeometry(80, 80)),
      track(new THREE.MeshStandardMaterial({ color: '#08080c', metalness: 0.6, roughness: 0.38, envMapIntensity: 0.2 }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.45;
    scene.add(floor);
    const grid = new THREE.GridHelper(80, 160, 0x3a1460, 0x15151d);
    grid.position.y = -1.448;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    track(grid.geometry); track(grid.material);
    scene.add(grid);
  }

  /* post-processing */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), RIG.bloom.strength, RIG.bloom.radius, RIG.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finalPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform vec2 uRes;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c);
        vec2 off = c * 0.004 * (0.3 + r * 2.0);
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
        col *= 0.95 + 0.05 * sin(vUv.y * uRes.y * 3.14159);
        col *= mix(0.35, 1.0, smoothstep(0.9, 0.25, r));
        col += (hash(vUv * uRes + fract(uTime)) - 0.5) * 0.03;
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  composer.addPass(finalPass);

  /* sizing */
  let baseDist = 16;
  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    finalPass.uniforms.uRes.value.set(w * dpr, h * dpr);
    camera.aspect = w / h;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanH = tanV * camera.aspect;
    baseDist = Math.max((HW + opts.margin) / tanH, 2.8 / tanV);
    scene.fog.density = 0.32 / baseDist;
    if (opts.offsetY) camera.setViewOffset(w, h, 0, h * opts.offsetY, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /* interaction */
  const pointer = new THREE.Vector2(), pointerSmooth = new THREE.Vector2();
  const onPointer = (e) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
  };
  if (opts.pointer) window.addEventListener('pointermove', onPointer);

  /* neon ignition + flicker */
  const flickerUntil = new Array(LETTERS).fill(-1);
  const ig = RIG.ignition;
  function ignite(t, li) {
    if (!opts.intro) return 1;
    const t0 = ig.start + li * ig.stagger;
    if (t < t0) return 0;
    const k = (t - t0) / ig.duration;
    if (k >= 1) return 1;
    return Math.random() < 0.3 + k * 0.6 ? Math.min(1, k * 1.4) : 0.06;
  }
  const flicker = (t, li) => (t < flickerUntil[li] ? (Math.random() < 0.5 ? 0.15 : 1) : 1);

  function update(t, dt) {
    if (dt > 0 && Math.random() < dt * RIG.flickerPerSecond) {
      flickerUntil[(Math.random() * LETTERS) | 0] = t + 0.2 + Math.random() * 0.3;
    }
    const lit = Array.from({ length: LETTERS }, (_, li) => ignite(t, li) * flicker(t, li));
    for (const tb of tubes) {
      tb.mat.uniforms.uTime.value = t;
      tb.mat.uniforms.uBase.value = RIG.edge.base * lit[tb.letter];
      tb.mat.uniforms.uStreak.value = Math.min(1, lit[tb.letter] * 1.2);
    }
    for (const g of inserts) {
      const k = (RIG.insert.gain + RIG.insert.pulse * Math.sin(t * g.speed + g.phase)) * lit[g.letter];
      g.mat.color.copy(g.base).multiplyScalar(Math.max(0.04, k));
    }
    if (statusMat) statusMat.color.copy(redBase).multiplyScalar(Math.floor(t * 1.6) % 2 === 0 ? 2.0 : 0.25);
    for (const m of movers) {
      const [x, y, z] = m.f(t);
      m.light.position.set(x, y, z);
      m.flare.position.set(x, y, z + 0.05);
    }
    for (const b of beams) {
      b.target.set(5.2 * Math.sin(t * b.speed + b.phase), -0.15 + 0.3 * Math.sin(t * 0.7 + b.phase), 0.4);
      b.spot.target.position.copy(b.target);
      const dir = b.target.clone().sub(b.from);
      const dist = dir.length();
      dir.normalize();
      b.mesh.quaternion.setFromUnitVectors(DOWN, dir);
      const h = dist * 1.25;
      const r = h * Math.tan(b.angle) * 0.9;
      b.mesh.scale.set(r, h, r);
    }
    updateFog(dt);
    pointerSmooth.lerp(pointer, Math.min(1, dt * 3 || 1));
    logo.rotation.y = -0.2 + 0.1 * Math.sin(t * 0.17) + pointerSmooth.x * 0.12;
    logo.rotation.x = 0.05 - pointerSmooth.y * 0.05;
    logo.position.y = 0.05 * Math.sin(t * 0.6);
    camera.position.set(0.4 * Math.sin(t * 0.13), 0.55 + 0.12 * Math.sin(t * 0.11), baseDist);
    camera.lookAt(0, 0, 0);
    finalPass.uniforms.uTime.value = t;
  }

  /* loop */
  let t = opts.paused ? 6.0 : 0;
  let running = false;
  let last = performance.now();
  let raf = 0;
  let readyFired = false;
  function render() {
    composer.render();
    if (!readyFired) { readyFired = true; if (opts.onReady) opts.onReady(); }
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    update(t, dt);
    render();
    raf = requestAnimationFrame(frame);
  }
  const onResize = () => { resize(); if (!running) { update(t, 0); render(); } };
  window.addEventListener('resize', onResize);

  resize();
  update(t, 0);
  render();

  const api = {
    play() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    pause() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get playing() { return running; },
    /** Seek to a time in seconds and render one frame (useful for stills). */
    renderAt(seconds) { t = seconds; update(t, 0); render(); },
    resize: onResize,
    dispose() {
      api.pause();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      disposables.forEach((d) => d.dispose && d.dispose());
      envTex.dispose();
      composer.dispose && composer.dispose();
      renderer.dispose();
    }
  };
  if (!opts.paused) api.play();
  return api;
}
