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
    this.d = new Float32Array(cap * 16); // pos 3, vel 3, rot 3, spin 3, life, max, rest, size
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
    d[o + 12] = life * (0.7 + Math.random() * 0.6); d[o + 13] = d[o + 12]; d[o + 14] = 0;
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
        if (Math.random() < dt * 2 && !env.solid(d[o], d[o + 1] - this.size[i * 3 + 1] * 0.6, d[o + 2]) && d[o + 1] - this.size[i * 3 + 1] > env.ground(d[o], d[o + 2]) + 0.05) d[o + 14] = 0;
        if (d[o + 12] <= 0) d[o + 13] = 0;
      }
      if (d[o + 13] <= 0) continue;
      const fade = resting ? Math.min(1, d[o + 12] / 2.5) : 1;
      _e.set(d[o + 6], d[o + 7], d[o + 8]);
      _q.setFromEuler(_e);
      _s.set(this.size[i * 3] * fade, this.size[i * 3 + 1] * fade, this.size[i * 3 + 2] * fade);
      _m.compose(_p.set(d[o], d[o + 1], d[o + 2]), _q, _s);
      if (visible !== i) {
        // Pack live chunks to the front so the instance count stays tight
        d.copyWithin(visible * 16, o, o + 16);
        this.size.copyWithin(visible * 3, i * 3, i * 3 + 3);
        this.cols.copyWithin(visible * 3, i * 3, i * 3 + 3);
        d[o + 13] = 0;
        _c.setRGB(this.cols[visible * 3], this.cols[visible * 3 + 1], this.cols[visible * 3 + 2]);
        this.mesh.setColorAt(visible, _c);
        this.mesh.instanceColor.needsUpdate = true;
      }
      this.mesh.setMatrixAt(visible, _m);
      visible++;
    }
    this.n = visible;
    if (this.next >= this.n) this.next = 0;
    this.mesh.count = visible;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
