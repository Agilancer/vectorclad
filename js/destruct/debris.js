import * as THREE from '../three.js';
import { MATS } from './grid.js';
import { interiorAtlas, cellRect, CELL } from './textures.js';

// ---------------------------------------------------------------------------
// Rubble: thousands of small chunks thrown off by every hit and every crash,
// drawn as one instanced mesh. Each chunk is an irregular rock (or a shard,
// splinter or rod, by material) that tumbles, bounces off the street, roofs
// and standing walls, settles and stays a while before it fades away.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), _e = new THREE.Euler(), _c = new THREE.Color();
const _e2 = new THREE.Euler(0, 0, 0, 'YXZ'), _r = new THREE.Matrix4();
const QUARTER = Math.PI / 2;
/** The x turn nearest x that lays a slab on its broad face, tipped a little (by its yaw y) as if propped on rubble */
const flatX = (x, y) => Math.PI * Math.round((x - QUARTER) / Math.PI) + QUARTER + Math.sin(y * 7.3) * 0.12;
const HEAVY = 1, DOWN = 2, CRUSHED = 4; // slab flags: crushes what it lands on, has come down once, has crushed

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(0.62, 0);
  const p = g.attributes.position;
  // Knock the corners about so no two faces are alike
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.4;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export class Debris {
  /** env: { gravity, ground(x, z), solid(x, y, z) } */
  constructor(scene, env, cap = 2400) {
    this.env = env;
    this.cap = cap;
    this.n = 0;
    this.d = new Float32Array(cap * 16); // pos 3, vel 3, rot 3, spin 3, life, max, rest, drawn (its matrix is up to date)
    this.size = new Float32Array(cap * 3);
    const atlas = interiorAtlas().map.clone();
    const R = cellRect(CELL.rubble);
    atlas.offset.set(R[0], R[1]); atlas.repeat.set(R[2], R[3]);
    atlas.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(rockGeometry(), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.cols = new Float32Array(cap * 3);
    this.next = 0;
  }

  /**
   * A chunk at (x, y, z) moving (vx, vy, vz), about `size` across, of material code mat.
   * life: seconds it stays after it settles.
   */
  spawn(x, y, z, vx, vy, vz, size, mat, life = 14) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = this.next; this.next = (this.next + 1) % this.cap; } // the oldest goes
    const d = this.d, o = i * 16, M = MATS[mat];
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = Math.random() * 6.3; d[o + 7] = Math.random() * 6.3; d[o + 8] = Math.random() * 6.3;
    const sp = 2 + Math.random() * 9;
    d[o + 9] = (Math.random() - 0.5) * sp; d[o + 10] = (Math.random() - 0.5) * sp; d[o + 11] = (Math.random() - 0.5) * sp;
    d[o + 12] = life * (0.7 + Math.random() * 0.6); d[o + 13] = d[o + 12]; d[o + 14] = 0; d[o + 15] = 0;
    // Shape by material: rocks for masonry, shards of glass, splinters of wood, rods of steel
    const name = M ? M.name : 'concrete', r = () => 0.6 + Math.random() * 0.8;
    let sx = size * r(), sy = size * r(), sz = size * r();
    if (name === 'glass' || name === 'light') { sy *= 0.12; sx *= 1.3; }
    else if (name === 'wood') { sx *= 2.2; sy *= 0.35; sz *= 0.5; }
    else if (name === 'steel') { sx *= 2.6; sy *= 0.3; sz *= 0.3; }
    else if (name === 'leaf') { sx *= 1.4; sy *= 1.1; sz *= 1.4; }
    this.size[i * 3] = sx; this.size[i * 3 + 1] = sy; this.size[i * 3 + 2] = sz;
    const c = M ? M.color : [0.55, 0.54, 0.52], k = 0.75 + Math.random() * 0.4;
    this.cols[i * 3] = c[0] * k; this.cols[i * 3 + 1] = c[1] * k; this.cols[i * 3 + 2] = c[2] * k;
    _c.setRGB(this.cols[i * 3], this.cols[i * 3 + 1], this.cols[i * 3 + 2]);
    this.mesh.setColorAt(i, _c);
    this.mesh.instanceColor.needsUpdate = true;
    return i;
  }

  update(dt) {
    const d = this.d, env = this.env, g = env.gravity * 1.6;
    let visible = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 16;
      if (d[o + 13] <= 0) continue;
      const resting = d[o + 14] > 0;
      if (!resting) {
        d[o + 4] -= g * dt;
        const px = d[o], py = d[o + 1], pz = d[o + 2];
        let nx = px + d[o + 3] * dt, ny = py + d[o + 4] * dt, nz = pz + d[o + 5] * dt;
        const half = this.size[i * 3 + 1] * 0.35;
        const gy = env.ground(nx, nz);
        let hit = false;
        if (ny - half < gy) {
          ny = gy + half; hit = true;
          d[o + 4] = -d[o + 4] * 0.28; d[o + 3] *= 0.6; d[o + 5] *= 0.6;
        } else if (env.solid(nx, ny, nz)) {
          // Find which way it came in and bounce off that face
          hit = true;
          if (!env.solid(px, ny, pz)) { nx = px; nz = pz; d[o + 3] *= -0.3; d[o + 5] *= -0.3; } else if (!env.solid(nx, py, nz)) {
            ny = py; if (d[o + 4] < 0) { d[o + 3] *= 0.6; d[o + 5] *= 0.6; } d[o + 4] = -d[o + 4] * 0.25;
          } else { nx = px; ny = py; nz = pz; d[o + 3] *= -0.3; d[o + 4] *= -0.3; d[o + 5] *= -0.3; }
        }
        d[o] = nx; d[o + 1] = ny; d[o + 2] = nz;
        if (hit) { d[o + 9] *= 0.6; d[o + 10] *= 0.6; d[o + 11] *= 0.6; }
        d[o + 6] += d[o + 9] * dt; d[o + 7] += d[o + 10] * dt; d[o + 8] += d[o + 11] * dt;
        const v2 = d[o + 3] * d[o + 3] + d[o + 4] * d[o + 4] + d[o + 5] * d[o + 5];
        if (hit && v2 < 1.2) d[o + 14] = 1;
        // Lost in the water or flung away
        if (ny < -30) d[o + 13] = 0;
      } else {
        d[o + 12] -= dt;
        // Settled chunks fall again when the floor under them goes
        if (Math.random() < dt * 2 && !env.solid(d[o], d[o + 1] - this.size[i * 3 + 1] * 0.6, d[o + 2]) && d[o + 1] - this.size[i * 3 + 1] > env.ground(d[o], d[o + 2]) + 0.05) { d[o + 14] = 0; d[o + 15] = 0; }
        if (d[o + 12] <= 0) d[o + 13] = 0;
      }
      if (d[o + 13] <= 0) continue;
      const fade = resting ? Math.min(1, d[o + 12] / 2.5) : 1;
      // Lying still at full size where it was drawn last frame: nothing to update
      if (visible === i && d[o + 15] && d[o + 14] > 0 && fade === 1) { visible++; continue; }
      _e.set(d[o + 6], d[o + 7], d[o + 8]);
      _q.setFromEuler(_e);
      _s.set(this.size[i * 3] * fade, this.size[i * 3 + 1] * fade, this.size[i * 3 + 2] * fade);
      _m.compose(_p.set(d[o], d[o + 1], d[o + 2]), _q, _s);
      if (visible !== i) {
        // Pack live chunks to the front so the instance count stays tight
        d.copyWithin(visible * 16, o, o + 16);
        d[visible * 16 + 15] = 0;
        this.size.copyWithin(visible * 3, i * 3, i * 3 + 3);
        this.cols.copyWithin(visible * 3, i * 3, i * 3 + 3);
        d[o + 13] = 0;
        _c.setRGB(this.cols[visible * 3], this.cols[visible * 3 + 1], this.cols[visible * 3 + 2]);
        this.mesh.setColorAt(visible, _c);
        this.mesh.instanceColor.needsUpdate = true;
      }
      this.mesh.setMatrixAt(visible, _m);
      d[visible * 16 + 15] = d[visible * 16 + 14] > 0 && fade === 1 ? 1 : 0;
      visible++;
    }
    this.n = visible;
    if (this.next >= this.n) this.next = 0;
    this.mesh.count = visible;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Slabs: the big debris explosions tear off buildings, pieces of wall and
// floor a meter to a few meters across and lengths of steel, each showing the
// broken face of what it was (textures.js). They tumble out over the street,
// flop flat when they come down and crush what they land on.
// ---------------------------------------------------------------------------

/** A rough block a unit across: a box with its corners, edges and faces knocked about (alike on every face meeting there, so it stays closed) */
function slabGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), p = g.attributes.position;
  const h = (x, y, z, k) => ((Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k) * 43758.5453) % 1 + 1) % 1 - 0.5;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // The middles of edges and faces more than the corners
    const k = 0.1 + ((x === 0) + (y === 0) + (z === 0)) * 0.09;
    p.setXYZ(i, x + h(x, y, z, 1) * k, y + h(x, y, z, 2) * k, z + h(x, y, z, 3) * k);
  }
  g.computeVertexNormals();
  return g;
}

export class Slabs {
  /**
   * env: { gravity, ground(x, z), solid(x, y, z), heavy: the size from which a slab crushes what
   * it lands on, hard: how fast it must come down to, land(x, y, z, size): one did }
   */
  constructor(scene, env, cap = 400) {
    this.env = env;
    this.cap = cap;
    this.n = 0;
    this.next = 0;
    this.d = new Float32Array(cap * 16); // as Debris; turned in YXZ order, so it lies on its broad face with x at a quarter turn
    this.size = new Float32Array(cap * 3);
    this.cols = new Float32Array(cap * 3);
    this.half = new Float32Array(cap);   // how far it reaches below its middle, turned as it is
    this.flag = new Uint8Array(cap);
    const geo = slabGeometry();
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.cell.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this.cell);
    const mat = new THREE.MeshStandardMaterial({ map: interiorAtlas().map, roughness: 0.92, metalness: 0.04 });
    // Each slab shows its own material's broken face, from that cell of the atlas
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aCell.xy + uv * aCell.zw;');
    };
    mat.customProgramCacheKey = () => 'debris-slabs';
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  /**
   * A slab at (x, y, z) moving (vx, vy, vz), about `size` across, of material code mat.
   * life: seconds it lies there once down.
   */
  spawn(x, y, z, vx, vy, vz, size, mat, life = 35) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = this.next; this.next = (this.next + 1) % this.cap; } // the oldest goes
    const d = this.d, o = i * 16, M = MATS[mat], name = M ? M.name : 'concrete', r = (a, b) => a + Math.random() * (b - a);
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = Math.random() * 6.3; d[o + 7] = Math.random() * 6.3; d[o + 8] = Math.random() * 6.3;
    // Big pieces turn over slower than grit
    d[o + 9] = r(-3, 3); d[o + 10] = r(-2, 2); d[o + 11] = r(-3, 3);
    d[o + 12] = life * r(0.8, 1.2); d[o + 13] = d[o + 12]; d[o + 14] = 0; d[o + 15] = 0;
    // Wall and floor come away in slabs about a fifth as thick as they are across, steel in
    // lengths, curtain wall in panes
    let sx = size * r(0.8, 1.15), sy = size * r(0.5, 0.85), sz = size * r(0.14, 0.26);
    if (name === 'steel') { sx = size * r(1.3, 1.9); sy = sz = size * r(0.09, 0.14); }
    else if (name === 'glass' || name === 'light') sz = size * 0.05;
    const S = this.size;
    S[i * 3] = sx; S[i * 3 + 1] = sy; S[i * 3 + 2] = sz;
    this.flag[i] = Math.max(sx, sy) >= this.env.heavy ? HEAVY : 0;
    this.half[i] = this.reach(i);
    // The texture has the material's color: only a shade apart
    const k = r(0.78, 1.05);
    this.cols[i * 3] = this.cols[i * 3 + 1] = this.cols[i * 3 + 2] = k;
    this.mesh.setColorAt(i, _c.setRGB(k, k, k));
    this.mesh.instanceColor.needsUpdate = true;
    const R = cellRect(M ? M.broken : CELL.concrete);
    this.cell.setXYZW(i, R[0], R[1], R[2], R[3]);
    this.cell.needsUpdate = true;
    return i;
  }

  /** How far slab i reaches below its middle, turned as it is */
  reach(i) {
    const d = this.d, o = i * 16, S = this.size;
    const e = _r.makeRotationFromEuler(_e2.set(d[o + 6], d[o + 7], d[o + 8])).elements;
    return 0.56 * (Math.abs(e[1]) * S[i * 3] + Math.abs(e[5]) * S[i * 3 + 1] + Math.abs(e[9]) * S[i * 3 + 2]);
  }

  update(dt) {
    const d = this.d, env = this.env, g = env.gravity * 1.6, S = this.size, F = this.flag;
    let visible = 0, crushes = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 16;
      if (d[o + 13] <= 0) continue;
      const resting = d[o + 14] > 0;
      if (!resting) {
        d[o + 4] -= g * dt;
        // (one wedged somewhere it can't come down from goes in time)
        if ((d[o + 12] -= dt) <= 0) { d[o + 13] = 0; continue; }
        // Once it has come down it stops tumbling and falls onto its broad face: its thin (z)
        // axis upright, which is x turned a quarter either way
        let flat = false;
        if (F[i] & DOWN) {
          const ax = flatX(d[o + 6], d[o + 7]) - d[o + 6];
          d[o + 6] += ax * Math.min(1, dt * 9);
          d[o + 9] = 0; d[o + 11] = 0;
          flat = Math.abs(ax) < 0.02;
        }
        d[o + 6] += d[o + 9] * dt; d[o + 7] += d[o + 10] * dt; d[o + 8] += d[o + 11] * dt;
        const half = this.half[i] = this.reach(i);
        const px = d[o], py = d[o + 1], pz = d[o + 2], vy = d[o + 4];
        let nx = px + d[o + 3] * dt, ny = py + vy * dt, nz = pz + d[o + 5] * dt;
        const gy = env.ground(nx, nz);
        let hit = false, down = false;
        if (ny - half < gy) {
          ny = gy + half; hit = down = true;
          d[o + 4] = -vy * 0.2; d[o + 3] *= 0.55; d[o + 5] *= 0.55;
        } else if (d[o + 13] - d[o + 12] > 0.25 && env.solid(nx, ny - half, nz)) {
          // (the first moment it is let through the edges of the hole it came out of)
          // Find which way its underside came in and bounce off that face
          hit = true;
          if (!env.solid(px, ny - half, pz)) { nx = px; nz = pz; d[o + 3] *= -0.3; d[o + 5] *= -0.3; } else if (!env.solid(nx, py - half, nz)) {
            ny = py; down = vy < 0;
            if (down) { d[o + 3] *= 0.55; d[o + 5] *= 0.55; }
            d[o + 4] = -vy * 0.2;
          } else { nx = px; ny = py; nz = pz; d[o + 3] *= -0.3; d[o + 4] *= -0.3; d[o + 5] *= -0.3; }
        }
        d[o] = nx; d[o + 1] = ny; d[o + 2] = nz;
        if (hit) { d[o + 9] *= 0.5; d[o + 10] *= 0.5; d[o + 11] *= 0.5; }
        if (down) {
          // A heavy one coming down hard crushes what it lands on, once (and only a few a frame)
          if (vy < -env.hard && (F[i] & (HEAVY | CRUSHED)) === HEAVY && crushes < 3) {
            crushes++;
            F[i] |= CRUSHED;
            env.land(nx, ny - half, nz, Math.max(S[i * 3], S[i * 3 + 1]));
          }
          F[i] |= DOWN;
          const v2 = d[o + 3] * d[o + 3] + d[o + 4] * d[o + 4] + d[o + 5] * d[o + 5];
          if (flat && v2 < 1.2) {
            // Lying still: squared up exactly
            d[o + 14] = 1;
            d[o + 6] = flatX(d[o + 6], d[o + 7]);
            const h = this.half[i] = this.reach(i);
            d[o + 1] += h - half;
          }
        }
        // Lost in the water or flung away
        if (ny < -30) d[o + 13] = 0;
      } else {
        d[o + 12] -= dt;
        // Down again when what it lies on goes
        const h = this.half[i];
        if (Math.random() < dt * 2 && d[o + 1] - h > env.ground(d[o], d[o + 2]) + 0.05 && !env.solid(d[o], d[o + 1] - h - 0.1, d[o + 2])) { d[o + 14] = 0; d[o + 15] = 0; }
        if (d[o + 12] <= 0) d[o + 13] = 0;
      }
      if (d[o + 13] <= 0) continue;
      const fade = resting ? Math.min(1, d[o + 12] / 2.5) : 1;
      // Lying still at full size where it was drawn last frame: nothing to update
      if (visible === i && d[o + 15] && d[o + 14] > 0 && fade === 1) { visible++; continue; }
      _q.setFromEuler(_e2.set(d[o + 6], d[o + 7], d[o + 8]));
      _s.set(S[i * 3] * fade, S[i * 3 + 1] * fade, S[i * 3 + 2] * fade);
      _m.compose(_p.set(d[o], d[o + 1], d[o + 2]), _q, _s);
      if (visible !== i) {
        // Pack live slabs to the front so the instance count stays tight
        d.copyWithin(visible * 16, o, o + 16);
        d[visible * 16 + 15] = 0;
        S.copyWithin(visible * 3, i * 3, i * 3 + 3);
        this.cols.copyWithin(visible * 3, i * 3, i * 3 + 3);
        this.half[visible] = this.half[i]; F[visible] = F[i];
        this.cell.array.copyWithin(visible * 4, i * 4, i * 4 + 4);
        this.cell.needsUpdate = true;
        d[o + 13] = 0;
        const k = this.cols[visible * 3];
        this.mesh.setColorAt(visible, _c.setRGB(k, k, k));
        this.mesh.instanceColor.needsUpdate = true;
      }
      this.mesh.setMatrixAt(visible, _m);
      d[visible * 16 + 15] = d[visible * 16 + 14] > 0 && fade === 1 ? 1 : 0;
      visible++;
    }
    this.n = visible;
    if (this.next >= this.n) this.next = 0;
    this.mesh.count = visible;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
