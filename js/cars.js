import * as THREE from './three.js';
import { CAR_SKINS } from './kitTiles.js';

// ---------------------------------------------------------------------------
// Cars: parked along the curbs and driving the streets.
//
// Every car wears one of a hundred skins cut from the car sheets in
// assets/car-sprites (sedans, hatchbacks, coupes, supercars, muscle cars,
// SUVs, pickups, vans, wagons and rally cars), and its body is shaped to fit
// that skin: tools/build_asset_atlas.py measured each net's side profile and
// plan at 28 stations from bumper to bumper, so the sides follow the painted
// silhouette (wheels, arches, hood, windshield, roof, trunk), the plan strip
// lies over the top and the fascias close the ends. All cars share one
// topology and one draw call; the vertex shader reads each instance's skin
// from a data texture and moves the vertices to fit it.
//
// Traffic keeps to the moving lanes (the curb lanes are for parking): one way
// up and down the avenues, one way or two way on the cross streets. Cars
// follow the car ahead, turn at intersections where the streets allow, stop
// for the mech and for wrecks, rubble and fallen trees in their way. The
// traffic is kept round the mech: new cars come in out of its sight a few
// blocks off, and cars that have driven far away are taken off to come back.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const N = 28; // stations along a car, as measured
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), _d = new V3(), _up = new V3(0, 1, 0), _col = new THREE.Color();
const _view = new THREE.Frustum(), _vm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const rand = (a, b) => a + Math.random() * (b - a);
const pickR = (a) => a[Math.floor(Math.random() * a.length)];

/** Skins as a float texture: per row (skin), N stations (bottom, top, half-width, texture top) then the five piece rectangles, then (length, width) */
function skinTexture(M, atlas) {
  const W = N + 6, H = CAR_SKINS.length, d = new Float32Array(W * H * 4);
  CAR_SKINS.forEach((c, row) => {
    const o = row * W * 4;
    c.prof.forEach(([b, t, h, tx], k) => { d.set([b * M, t * M, h * M, tx], o + k * 4); });
    ['front', 'top', 'rear', 'left', 'right'].forEach((part, k) => {
      const [x, y, w, h] = c.parts[part];
      // Half a pixel in from every edge, so filtering never reaches the gutter
      d.set([(x + 0.5) / atlas.w, 1 - (y + h - 0.5) / atlas.h, (w - 1) / atlas.w, (h - 1) / atlas.h], o + (N + k) * 4);
    });
    d.set([c.length * M, c.width * M, c.side === 'left' ? 0 : 1, 0], o + (N + 5) * 4);
  });
  const tex = new THREE.DataTexture(d, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The shared topology. aRef: (station, a, b, face): faces 0 and 1 the left and right sides
 * (a: height from the sill to the roof edge), 2 the top (a: across, -1 left to 1 right),
 * 3 the underside, 4 and 5 the front and rear (a across, b up). Positions are a stand-in car
 * (the shader places the real ones), used to wind every face outward.
 */
function carGeometry() {
  const pos = [], ref = [], idx = [];
  const stand = (k, a, b, f) => {
    const x = (0.5 - k / (N - 1)) * 4.6, bot = 0.25, top = 1.4, half = 0.9;
    if (f <= 1) return [x, bot + (top - bot) * a, (f ? 1 : -1) * half * (a > 0.6 ? 1 - (a - 0.6) * 0.45 : 1)];
    if (f === 2) return [x, top, a * half * 0.82];
    if (f === 3) return [x, bot, a * half];
    return [f === 4 ? 2.3 : -2.3, bot + (top - bot) * b, a * half];
  };
  const vert = (k, a, b, f) => { pos.push(...stand(k, a, b, f)); ref.push(k, a, b, f); return pos.length / 3 - 1; };
  const out = [[0, 0, -1], [0, 0, 1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]];
  const quad = (i0, i1, i2, i3, f) => {
    const P = (i) => new V3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const n = new V3().subVectors(P(i1), P(i0)).cross(new V3().subVectors(P(i2), P(i0)));
    if (n.dot(new V3(...out[f])) >= 0) idx.push(i0, i1, i2, i0, i2, i3);
    else idx.push(i0, i2, i1, i0, i3, i2);
  };
  // Every other measured station along the body (the shader reads the station's own numbers), and
  // the second and second-to-last, where the hood and trunk turn down to the bumpers
  const ST = [0, 1, ...Array.from({ length: (N - 4) / 2 }, (_, j) => 2 + j * 2), N - 2, N - 1].filter((k, i, a) => a.indexOf(k) === i);
  const strips = (f, across) => {
    const rows = ST.map((k) => across.map((a) => vert(k, a, 0, f)));
    for (let r = 0; r < rows.length - 1; r++) for (let j = 0; j < across.length - 1; j++) quad(rows[r][j], rows[r + 1][j], rows[r + 1][j + 1], rows[r][j + 1], f);
  };
  strips(0, [0, 0.35, 0.6, 0.8, 1]);
  strips(1, [0, 0.35, 0.6, 0.8, 1]);
  strips(2, [-1, -0.5, 0, 0.5, 1]);
  strips(3, [-1, 1]);
  for (const f of [4, 5]) {
    const k = f === 4 ? 0 : N - 1, g = [];
    // Rows at the sides' heights, so the ends meet them edge to edge
    for (const b of [0, 0.35, 0.6, 0.8, 1]) g.push([-1, 0, 1].map((a) => vert(k, a, b, f)));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) quad(g[r][c], g[r][c + 1], g[r + 1][c + 1], g[r + 1][c], f);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRef', new THREE.Float32BufferAttribute(ref, 4));
  geo.setIndex(idx);
  return geo;
}

// Places a vertex for its instance's skin: position, normal, atlas uv, darkening (the underside)
// and whether its texels cut out (the sides, along their silhouettes)
const SHAPE = /* glsl */`
  uniform sampler2D uSkin;
  attribute vec4 aRef;
  attribute float aSkin;
  vec4 carSk(int i) { return texelFetch(uSkin, ivec2(i, int(aSkin + 0.5)), 0); }
  void carShape(out vec3 p, out vec3 n, out vec2 uv, out float dark, out float cut) {
    const int NS = ${N};
    int k = int(aRef.x + 0.5), f = int(aRef.w + 0.5);
    vec4 P = carSk(k), I = carSk(NS + 5);
    float len = I.x, wid = I.y, fs = aRef.x / float(NS - 1), x = (0.5 - fs) * len;
    dark = 1.0; cut = 0.0;
    if (f <= 1) {
      float s = f == 0 ? -1.0 : 1.0, a = aRef.y, y = mix(P.x, P.y, a);
      float inset = a > 0.6 ? 1.0 - (a - 0.6) * 0.45 : 1.0;
      p = vec3(x, y, s * P.z * inset);
      n = normalize(vec3(0.0, a > 0.6 ? 0.55 : 0.0, s));
      // Across the strip from its outer (wheel) edge to where its pixels end, stretched over the body
      float u = (y / max(P.y, 1e-4)) * P.w;
      // The strip that was measured; the other side wears its own strip the same way
      vec4 R = carSk(NS + 3 + f);
      if (f == 1) u = 1.0 - u;
      uv = R.xy + vec2(clamp(u, 0.0, 1.0), 1.0 - fs) * R.zw;
      cut = 1.0;
    } else if (f == 2) {
      vec4 A = carSk(max(k - 1, 0)), B = carSk(min(k + 1, NS - 1));
      float a = aRef.y, dydx = (A.y - B.y) / (2.0 * len / float(NS - 1));
      p = vec3(x, P.y + (1.0 - a * a) * 0.03 * wid, a * P.z * 0.82);
      n = normalize(vec3(-dydx, 1.0, a * 0.35));
      vec4 R = carSk(NS + 1);
      uv = R.xy + vec2(0.5 + 0.5 * a * clamp(P.z / (0.5 * wid), 0.0, 1.0), 1.0 - fs) * R.zw;
    } else if (f == 3) {
      // Flat underneath at the sills, not down to where the tires touch
      p = vec3(x, max(P.x, 0.045 * len), aRef.y * P.z);
      n = vec3(0.0, -1.0, 0.0);
      uv = carSk(NS + 1).xy;
      dark = 0.12;
    } else {
      float a = aRef.y, b = aRef.z, y = mix(P.x, P.y, b) + (b > 0.99 ? (1.0 - a * a) * 0.03 * wid : 0.0);
      p = vec3(x, y, a * P.z * (b > 0.6 ? 1.0 - (b - 0.6) * 0.45 : 1.0));
      n = vec3(f == 4 ? 1.0 : -1.0, 0.0, 0.0);
      vec4 R = carSk(f == 4 ? NS : NS + 2);
      // The front is seen face on: its left is the car's right. The rear: its left is the car's left.
      uv = R.xy + vec2(f == 4 ? 0.5 - 0.5 * a : 0.5 + 0.5 * a, b) * R.zw;
    }
  }
`;

function carMaterials(atlas, skin) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.25 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSkin = { value: skin };
    sh.uniforms.uCars = { value: atlas };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${SHAPE}\nvarying vec2 vCarUv;\nvarying float vCarDark;\nvarying float vCarCut;`)
      .replace('#include <beginnormal_vertex>', `vec3 carP, objectNormal; vec2 carUv; float carDark, carCut;
        carShape(carP, objectNormal, carUv, carDark, carCut);
        vCarUv = carUv; vCarDark = carDark; vCarCut = carCut;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = carP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uCars;\nvarying vec2 vCarUv;\nvarying float vCarDark;\nvarying float vCarCut;')
      .replace('#include <map_fragment>', `
        vec4 carC = texture2D(uCars, vCarUv);
        diffuseColor.rgb *= carC.rgb * vCarDark;
        float carLum = dot(carC.rgb, vec3(0.2126, 0.7152, 0.0722));`)
      // Glass and dark trim glossy, paint a little less
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.08, smoothstep(0.16, 0.05, carLum));');
  };
  mat.customProgramCacheKey = () => 'car';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uSkin = { value: skin };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${SHAPE}`)
      .replace('#include <begin_vertex>', 'vec3 carP, carN; vec2 carUv; float carDark, carCut; carShape(carP, carN, carUv, carDark, carCut);\nvec3 transformed = carP;');
  };
  depth.customProgramCacheKey = () => 'car-depth';
  return { mat, depth };
}

export class Cars {
  constructor(city) {
    this.city = city;
    this.world = null; // set by World once its grid exists
    const m = (x) => city.m(x), L = city.L, r = city.r;
    this.M = city.M;
    this.list = [];      // every car: parked, driving and wrecked
    this.moving = [];    // cars that drive
    this.lanes = [];
    this.free = [];
    this.spawnT = 0;
    this.time = 0;
    const atlas = city.tex.cars, skin = skinTexture(city.M, { w: atlas.image.width, h: atlas.image.height });
    // Parked along both curbs of every street in the city proper
    const spots = [];
    const curbGap = m(1.3);
    for (const s of L.sts) {
      if (s.k < 0) continue;
      for (let i = 0; i < L.aves.length - 1; i++) {
        const x0 = L.aves[i].x1 + m(10), x1 = L.aves[i + 1].x0 - m(10);
        for (const [z, yaw] of [[s.r0 + curbGap, Math.PI], [s.r1 - curbGap, 0]]) {
          for (let x = x0; x < x1; x += m(6.5)) if (r() < 0.085) spots.push([x + r() * m(0.6), z, yaw]);
        }
      }
    }
    for (const a of L.aves) {
      for (const s of L.sts) {
        if (s.k < 0 || s.z1 + m(10) > L.z1) continue;
        const z0 = s.z1 + m(10), z1 = s.z1 + L.blockD - m(10);
        for (const x of [a.r0 + curbGap, a.r1 - curbGap]) {
          for (let z = z0; z < z1; z += m(6.5)) if (r() < 0.07) spots.push([x, z + r() * m(0.6), a.dir > 0 ? -Math.PI / 2 : Math.PI / 2]);
        }
      }
    }
    // Heavy traffic: the streets round the mech full of it
    this.maxMoving = 700;
    const cap = spots.length + this.maxMoving + 40;
    const { mat, depth } = carMaterials(atlas, skin);
    const geo = carGeometry();
    this.skinAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.skinAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSkin', this.skinAttr);
    const mesh = (this.mesh = new THREE.InstancedMesh(geo, mat, cap));
    mesh.customDepthMaterial = depth;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) { mesh.setColorAt(i, _col.setRGB(1, 1, 1)); mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); }
    for (let i = cap - 1; i >= spots.length; i--) this.free.push(i);
    city.scene.add(mesh);
    spots.forEach(([x, z, yaw], i) => {
      const car = this.make(i, Math.floor(r() * CAR_SKINS.length), x, z, yaw);
      car.collider = city.collide(car.min.x, 0, car.min.z, car.max.x, m(1.8), car.max.z, { walk: true, ref: car });
    });
    this.buildLanes();
    this.dirty = true;
  }

  /** A car in instance slot i with a skin, at (x, z) heading yaw (the model faces +x) */
  make(i, skin, x, z, yaw) {
    const c = CAR_SKINS[skin], M = this.M;
    const car = {
      i, skin, kind: 'car', alive: true, hp: 24, state: 0, pos: new V3(x, 0, z), yaw,
      len: c.length * M, wid: c.width * M, min: new V3(), max: new V3(), moving: false,
    };
    this.bounds(car);
    this.skinAttr.setX(i, skin);
    this.skinAttr.needsUpdate = true;
    this.mesh.setColorAt(i, _col.setRGB(1, 1, 1));
    this.mesh.instanceColor.needsUpdate = true;
    this.place(car);
    this.list.push(car);
    return car;
  }

  bounds(car) {
    const c = Math.abs(Math.cos(car.yaw)), s = Math.abs(Math.sin(car.yaw));
    const hx = c * car.len / 2 + s * car.wid / 2, hz = s * car.len / 2 + c * car.wid / 2;
    car.min.set(car.pos.x - hx, 0, car.pos.z - hz);
    car.max.set(car.pos.x + hx, 0, car.pos.z + hz);
  }

  place(car) {
    _q.setFromAxisAngle(_up, car.yaw);
    _m.compose(car.pos, _q, _s.set(1, car.flat ? 0.42 : car.state === 2 ? 0.75 : 1, 1));
    this.mesh.setMatrixAt(car.i, _m);
    this.dirty = true;
  }

  // ---- lanes ------------------------------------------------------------------------

  /**
   * The moving lanes: the two middle lanes of every road. Avenues run one way; cross streets one
   * way, or two way with the eastbound lane on the south half. Each lane lists where it crosses
   * the roads it meets, to turn there.
   */
  buildLanes() {
    const L = this.city.L, nA = L.aves.length - 1, last = L.sts[L.sts.length - 1].k;
    // Traffic keeps to the city proper (not the filler rows north of the barricade). The roads round
    // its edge carry it both ways, so wherever a car comes to the edge it has somewhere to turn.
    L.aves.forEach((a, ai) => {
      const edge = ai === 0 || ai === nA;
      for (const l of [1, 2]) this.lanes.push({ ave: true, idx: ai, c: a.r0 + (l + 0.5) * (a.r1 - a.r0) / 4, dir: edge ? (l === 2 ? -1 : 1) : a.dir, lo: L.z0, hi: L.z1, cars: [] });
    });
    L.sts.forEach((s, si) => {
      if (s.k < 0) return;
      const two = (s.k + 20) % 3 === 0 || s.k === 0 || s.k === last;
      for (const l of [1, 2]) {
        const dir = two ? (l === 2 ? 1 : -1) : s.dir;
        this.lanes.push({ ave: false, idx: si, c: s.r0 + (l + 0.5) * (s.r1 - s.r0) / 4, dir, lo: L.aves[0].x0, hi: L.x1, cars: [] });
      }
    });
    this.aveLanes = this.lanes.filter((l) => l.ave);
    this.stLanes = this.lanes.filter((l) => !l.ave);
  }

  /** Where lane l crosses the other roads: their middles along it, in its direction of travel */
  crossings(l) {
    const L = this.city.L;
    if (!l.cross) l.cross = l.ave ? L.sts.map((s, i) => ({ at: (s.r0 + s.r1) / 2, idx: i })).filter((c) => L.sts[c.idx].k >= 0) : L.aves.map((a, i) => ({ at: (a.r0 + a.r1) / 2, idx: i }));
    return l.cross;
  }

  // ---- traffic --------------------------------------------------------------------------

  /** Put a driving car on lane l at along, if there is room */
  spawnOn(l, along) {
    for (const o of l.cars) if (Math.abs(o.along - along) < this.city.m(14)) return null;
    const i = this.free.pop();
    if (i === undefined) return null;
    const x = l.ave ? l.c : along, z = l.ave ? along : l.c;
    const yaw = l.ave ? (l.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (l.dir > 0 ? 0 : Math.PI);
    const car = this.make(i, Math.floor(Math.random() * CAR_SKINS.length), x, z, yaw);
    car.moving = true;
    car.lane = l; car.along = along; car.speed = 0; car.vmax = this.city.m(rand(10, 15)); car.stuck = 0; car.look = 0; car.odo = 0; car.block = Infinity; car.blockOdo = 0;
    car.collider = { min: car.min.clone(), max: car.max.clone().setY(this.city.m(1.8)), walk: true, ref: car };
    this.world.moveCollider(car.collider);
    l.cars.push(car);
    this.moving.push(car);
    return car;
  }

  /**
   * Keep the streets round the mech busy: new cars come in out of its sight, 60 to 550 m off;
   * cars that have driven farther away, out of view, are taken off to come back near; and wrecks
   * are cleared away once nobody is near to see it
   */
  respawn(dt, P, cam) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 0.5;
    const m = (x) => this.city.m(x), L = this.city.L, D = this.world.destruct;
    if (cam) {
      // (as it is this frame: it may have turned since it was last drawn)
      cam.updateMatrixWorld();
      _view.setFromProjectionMatrix(_vm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    }
    // In view, as far as the haze lets a car be made out
    const seen = (x, z) => cam && Math.hypot(x - cam.position.x, z - cam.position.z) < m(1400) && _view.intersectsSphere(_sph.set(_p.set(x, m(1), z), m(6)));
    let live = 0, recycled = 0;
    for (const car of this.moving) {
      if (car.gone) continue;
      if (car.state !== 0) {
        // Wrecks that burned out a while ago go once nobody is near
        car.dead = (car.dead || 0) + 0.5;
        if (car.dead > 60 && Math.hypot(car.pos.x - P.x, car.pos.z - P.z) > m(200) && !seen(car.pos.x, car.pos.z)) this.remove(car);
        continue;
      }
      car.hidden = !seen(car.pos.x, car.pos.z);
      if (recycled < 4 && Math.hypot(car.pos.x - P.x, car.pos.z - P.z) > m(700) && car.hidden) { this.remove(car); recycled++; continue; }
      live++;
    }
    // At the start the streets are filled at once, in view or not (nothing to see pop in yet)
    const first = !this.filled;
    this.filled = true;
    if (first) cam = null;
    const want = Math.min(this.maxMoving - live, first ? this.maxMoving : live < this.maxMoving * 0.6 ? 20 : 6);
    for (let tries = 0, k = 0; k < want && tries < (first ? 6000 : 150); tries++) {
      const l = pickR(this.lanes);
      // Between two crossings, not in one
      const cross = this.crossings(l), j = Math.floor(Math.random() * (cross.length - 1));
      const a = cross[j].at + m(20), b = cross[j + 1].at - m(20);
      if (b <= a) continue;
      const along = rand(a, b), x = l.ave ? l.c : along, z = l.ave ? along : l.c;
      if (z < L.sts[0].z1) continue;
      const d = Math.hypot(x - P.x, z - P.z);
      // Most of them within a few blocks, a few farther out to fill the streets into the haze
      if (d < m(first ? 25 : 60) || d > m(550) || (d > m(350) && Math.random() < 0.7) || seen(x, z)) continue;
      // Not into rubble or a fallen tree: the car's length clear, down at bumper height
      const fx = l.ave ? 0 : 1, fz = l.ave ? 1 : 0;
      if (D && (D.solidAt(x, m(0.6), z) || D.solidAt(x - fx * m(3), m(0.6), z - fz * m(3)) || D.solidAt(x + fx * m(3), m(0.6), z + fz * m(3)))) continue;
      const h = this.world.raycast(_d.set(x - fx * m(3) * l.dir, m(0.6), z - fz * m(3) * l.dir), _s.set(fx * l.dir, 0, fz * l.dir), m(12), { targets: false, trees: true });
      if (h && h.normal.y < 0.7) continue;
      if (this.spawnOn(l, along)) k++;
    }
    if (this.moving.some((c) => c.gone)) this.moving = this.moving.filter((c) => !c.gone);
  }

  remove(car) {
    car.gone = true;
    car.alive = false;
    if (car.lane) car.lane.cars.splice(car.lane.cars.indexOf(car), 1);
    car.lane = null;
    this.world.removeCollider(car.collider);
    this.mesh.setMatrixAt(car.i, _m.makeScale(0, 0, 0));
    this.dirty = true;
    this.free.push(car.i);
    const k = this.list.indexOf(car);
    if (k >= 0) this.list.splice(k, 1);
  }

  /** Decide at the next crossing: straight on, or a turn into a lane that leads on */
  plan(car) {
    const l = car.lane, cross = this.crossings(l), m = (x) => this.city.m(x);
    // The next crossing ahead, far enough to turn into
    let next = null;
    for (const c of l.dir > 0 ? cross : [...cross].reverse()) {
      if (l.dir > 0 ? c.at > car.along + m(9) : c.at < car.along - m(9)) { next = c; break; }
    }
    car.next = next;
    car.turn = null;
    if (!next) return;
    const last = (l.dir > 0 ? cross[cross.length - 1] : cross[0]) === next;
    const options = [];
    for (const t of l.ave ? this.stLanes : this.aveLanes) {
      if (t.idx !== next.idx) continue;
      // The new lane must lead somewhere past here
      const tc = this.crossings(t), onward = tc.some((c) => (t.dir > 0 ? c.at > l.c + m(20) : c.at < l.c - m(20)));
      if (onward) options.push(t);
    }
    if (options.length && (last || Math.random() < 0.35)) car.turn = pickR(options);
  }

  /** Begin the turn into car.turn: a curve from the current lane through the corner to the new one */
  startTurn(car) {
    const l = car.lane, t = car.turn, m = (x) => this.city.m(x), R = m(8);
    const corner = l.ave ? new V3(l.c, 0, t.c) : new V3(t.c, 0, l.c);
    const dIn = l.ave ? new V3(0, 0, l.dir) : new V3(l.dir, 0, 0), dOut = t.ave ? new V3(0, 0, t.dir) : new V3(t.dir, 0, 0);
    car.curve = { p0: corner.clone().addScaledVector(dIn, -R), p1: corner, p2: corner.clone().addScaledVector(dOut, R), u: 0, len: R * 1.6 };
    l.cars.splice(l.cars.indexOf(car), 1);
    car.lane = null;
  }

  endTurn(car) {
    const t = car.turn;
    car.lane = t;
    car.along = t.ave ? car.pos.z : car.pos.x;
    t.cars.push(car);
    car.turn = null; car.curve = null;
    this.plan(car);
  }

  /** How far the road ahead of a driving car is clear, up to `max` */
  clearAhead(car, max, P) {
    const m = (x) => this.city.m(x), l = car.lane;
    let gap = max;
    if (l) {
      for (const o of l.cars) {
        if (o === car) continue;
        const d = (o.along - car.along) * l.dir;
        if (d > 0 && d < gap + o.len) gap = Math.min(gap, d - (o.len + car.len) / 2);
      }
    }
    // The mech in the road ahead
    if (P) {
      const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw), dx = P.x - car.pos.x, dz = P.z - car.pos.z;
      const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && side < m(6) && P.y < m(8)) gap = Math.min(gap, ahead - m(9));
    }
    // Wrecks, rubble, fallen pieces and trees: a look down the road now and then, low enough to
    // see a flattened car. What it saw comes nearer as the car drives on.
    car.look -= 1;
    if (car.look <= 0) {
      car.look = 12 + Math.random() * 8;
      const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
      _p.set(car.pos.x + fx * car.len * 0.5, m(0.6), car.pos.z + fz * car.len * 0.5);
      const h = this.world.raycast(_p, _d.set(fx, 0, fz), m(26), { targets: false, trees: true });
      car.block = h && !(h.collider && h.collider.ref && h.collider.ref === car) && h.normal.y < 0.7 ? h.dist : Infinity;
      car.blockOdo = car.odo;
    }
    if (car.block < Infinity) gap = Math.min(gap, car.block - (car.odo - car.blockOdo) - m(3));
    return gap;
  }

  update(dt, ctx) {
    if (!this.world) return;
    this.time += dt;
    const P = ctx.player, m = (x) => this.city.m(x);
    if (P) this.respawn(dt, P, ctx.camera);
    for (const car of this.moving) {
      if (car.gone || car.state !== 0) continue;
      if (!car.curve && car.next === undefined) this.plan(car);
      const gap = this.clearAhead(car, m(40), P);
      // Ease toward the speed the gap allows: full speed with room, a stop short of anything
      const want = gap < m(2) ? 0 : Math.min(car.vmax, Math.max(0, (gap - m(2)) * 0.9));
      const acc = want > car.speed ? m(3.5) : m(9);
      car.speed += Math.sign(want - car.speed) * Math.min(Math.abs(want - car.speed), acc * dt);
      car.stuck = car.speed < m(0.3) ? car.stuck + dt : 0;
      const step = car.speed * dt;
      car.odo += step;
      // A turn ends in a new lane: look down it straight away
      if (car.curve && car.curve.u === 0) car.look = 0;
      if (car.curve) {
        const C = car.curve;
        C.u = Math.min(1, C.u + step / C.len);
        const u = C.u, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        car.pos.set(C.p0.x * a + C.p1.x * b + C.p2.x * c, 0, C.p0.z * a + C.p1.z * b + C.p2.z * c);
        const tx = 2 * (1 - u) * (C.p1.x - C.p0.x) + 2 * u * (C.p2.x - C.p1.x), tz = 2 * (1 - u) * (C.p1.z - C.p0.z) + 2 * u * (C.p2.z - C.p1.z);
        car.yaw = Math.atan2(-tz, tx);
        if (C.u >= 1) this.endTurn(car);
      } else {
        const l = car.lane;
        car.along += step * l.dir;
        if (l.ave) car.pos.set(l.c, 0, car.along); else car.pos.set(car.along, 0, l.c);
        if (car.turn && (car.turn.c - car.along) * l.dir <= m(8)) this.startTurn(car);
        else if (car.next && (car.along - car.next.at) * l.dir > m(2)) this.plan(car);
        // Off the end of the grid with nowhere to turn
        if (car.along < l.lo - m(10) || car.along > l.hi + m(10)) { this.remove(car); continue; }
      }
      // Stuck behind something for long, out of sight: give up and go
      if (car.stuck > 25 && car.hidden && P && Math.hypot(car.pos.x - P.x, car.pos.z - P.z) > m(220)) { this.remove(car); continue; }
      this.bounds(car);
      car.collider.min.set(car.min.x, 0, car.min.z);
      car.collider.max.set(car.max.x, m(1.8), car.max.z);
      this.world.moveCollider(car.collider);
      this.place(car);
    }
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }

  // ---- damage --------------------------------------------------------------------

  /** Flattened, by the mech's foot or a piece of building: it stays flat, whatever happens to it after */
  crush(car) {
    if (car.flat) return false;
    car.flat = true;
    if (car.state === 0) car.state = 1;
    car.speed = 0;
    this.place(car);
    car.collider.max.y = this.city.m(0.8);
    return true;
  }

  /** A wrecked car: lower, burnt black */
  wreck(car) {
    car.speed = 0;
    this.place(car);
    this.mesh.setColorAt(car.i, _col.setRGB(0.07, 0.065, 0.06));
    this.mesh.instanceColor.needsUpdate = true;
  }
}
