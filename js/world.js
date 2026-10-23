import * as THREE from './three.js';
import { canvasTexture } from './atlas.js';
import { City } from './city.js';

const V3 = THREE.Vector3;
const _n = new V3();

export const SUN_DIR = new V3(-0.5, 0.66, 0.42).normalize();

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#3a6aa8') },
      uHorizon: { value: new THREE.Color('#d9dde0') },
      uGround: { value: new THREE.Color('#8f9aa2') },
      uSunDir: { value: SUN_DIR.clone() },
      uSun: { value: new THREE.Color('#fff1d6') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.9999, p.w);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uGround, uSunDir, uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.5));
        col = mix(col, uGround, smoothstep(0.0, -0.08, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(s, 900.0) * 14.0 + pow(s, 40.0) * 0.5 + pow(s, 6.0) * 0.16);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  sky.scale.setScalar(6000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

/** The old test-site pad marking, now painted on the plaza where the mech starts */
function padTexture() {
  return canvasTexture(1024, (g, s) => {
    const c = s / 2;
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(242,182,50,0.9)';
    g.lineWidth = 26;
    g.beginPath(); g.arc(c, c, s * 0.44, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 8;
    g.beginPath(); g.arc(c, c, s * 0.38, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(30,30,30,0.85)';
    for (let i = 0; i < 24; i++) {
      g.save(); g.translate(c, c); g.rotate((i / 24) * Math.PI * 2);
      g.fillRect(s * 0.428, -10, 30, 20);
      g.restore();
    }
    g.fillStyle = 'rgba(240,236,228,0.85)';
    g.font = 'bold 300px "Chakra Petch", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('07', c, c - 20);
    g.font = 'bold 54px "Chakra Petch", sans-serif';
    g.fillText('MS TEST SITE', c, c + 170);
    g.fillStyle = 'rgba(216,50,43,0.85)';
    g.beginPath(); g.moveTo(c - 40, c - 230); g.lineTo(c + 40, c - 230); g.lineTo(c, c - 180); g.fill();
  });
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
  /** M: game units per meter, chosen so the mech is 40 ft tall */
  constructor(scene, mats, fx, sound, { M, cityTex }, callbacks = {}) {
    this.scene = scene;
    this.mats = mats;
    this.fx = fx;
    this.sound = sound;
    this.cb = callbacks;
    this.M = M;
    this.targets = [];   // anything weapons can lock and hit: spiders, filled in by SpiderSwarm
    this.spiders = null;

    scene.add(makeSky());
    scene.fog = new THREE.Fog(0xc4ccd2, 260, 2600);

    // Lights
    const hemi = new THREE.HemisphereLight(0xd6e2f0, 0x7d8088, 1.0);
    scene.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0dc, 3.1));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 1100;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);

    // The city
    this.city = new City({ scene, tex: cityTex, M, fx, sound });
    this.colliders = this.city.colliders;
    this.bounds = this.city.bounds;
    this.spawn = this.city.spawn;
    this.buildGrid();
    this.city.query = (x0, z0, x1, z1, fn) => this.query(x0, z0, x1, z1, fn);

    // Test-site pad marking on the starting plaza
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({
      map: padTexture(), transparent: true, roughness: 0.8, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(this.spawn.x, this.spawn.y + 0.05, this.spawn.z);
    pad.receiveShadow = true;
    pad.renderOrder = 2;
    scene.add(pad);

  }

  // ---- spatial grid ------------------------------------------------------------

  buildGrid() {
    const C = (this.cell = 24);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const c of this.colliders) { x0 = Math.min(x0, c.min.x); z0 = Math.min(z0, c.min.z); x1 = Math.max(x1, c.max.x); z1 = Math.max(z1, c.max.z); }
    this.gx0 = x0 - C; this.gz0 = z0 - C;
    this.gw = Math.ceil((x1 - x0) / C) + 3; this.gh = Math.ceil((z1 - z0) / C) + 3;
    this.grid = Array.from({ length: this.gw * this.gh }, () => []);
    this.stamp = 0;
    for (const c of this.colliders) {
      c.stamp = 0;
      const [a, b, e, f] = this.cellRange(c.min.x, c.min.z, c.max.x, c.max.z);
      for (let j = b; j <= f; j++) for (let i = a; i <= e; i++) this.grid[j * this.gw + i].push(c);
    }
  }

  cellRange(x0, z0, x1, z1) {
    const C = this.cell, cl = (v, n) => Math.max(0, Math.min(n - 1, v));
    return [cl(Math.floor((x0 - this.gx0) / C), this.gw), cl(Math.floor((z0 - this.gz0) / C), this.gh),
      cl(Math.floor((x1 - this.gx0) / C), this.gw), cl(Math.floor((z1 - this.gz0) / C), this.gh)];
  }

  /** Visit each collider overlapping an XZ rectangle once */
  query(x0, z0, x1, z1, fn) {
    const st = ++this.stamp;
    const [a, b, e, f] = this.cellRange(x0, z0, x1, z1);
    for (let j = b; j <= f; j++) {
      for (let i = a; i <= e; i++) {
        for (const c of this.grid[j * this.gw + i]) {
          if (c.stamp === st) continue;
          c.stamp = st;
          if (c.max.x < x0 || c.min.x > x1 || c.max.z < z0 || c.min.z > z1) continue;
          fn(c);
        }
      }
    }
  }

  // ---- queries -------------------------------------------------------------------

  /** Height of the surface the mech can stand on at (x, z), given its current feet height y. */
  groundHeight(x, z, y, r = 1.0) {
    let h = 0;
    this.query(x - r, z - r, x + r, z + r, (c) => {
      if (c.walk) return;
      if (y >= c.max.y - 0.7) h = Math.max(h, c.max.y);
    });
    return h;
  }

  /** Push a vertical cylinder (feet at pos.y, given height) out of colliders in XZ. */
  resolve(pos, r, height) {
    let hit = false;
    this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, (c) => {
      if (c.walk || pos.y >= c.max.y - 0.7 || pos.y + height <= c.min.y) return;
      const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          const ox = Math.min(pos.x - c.min.x, c.max.x - pos.x), oz = Math.min(pos.z - c.min.z, c.max.z - pos.z);
          if (ox < oz) pos.x = pos.x - c.min.x < c.max.x - pos.x ? c.min.x - r : c.max.x + r;
          else pos.z = pos.z - c.min.z < c.max.z - pos.z ? c.min.z - r : c.max.z + r;
        }
      }
    });
    const B = this.bounds;
    if (pos.x < B.minX) { pos.x = B.minX; hit = true; }
    if (pos.x > B.maxX) { pos.x = B.maxX; hit = true; }
    if (pos.z < B.minZ) { pos.z = B.minZ; hit = true; }
    if (pos.z > B.maxZ) { pos.z = B.maxZ; hit = true; }
    return hit;
  }

  /**
   * Ray against targets (spheres), colliders (AABBs, walked through a grid with a
   * 2D DDA) and the ground or water. Returns { dist, point, normal, target, collider }
   * or null; collider is the box that was hit, if any.
   */
  raycast(o, d, maxDist, { targets = true, pad = 0 } = {}) {
    let best = maxDist, normal = null, target = null, collider = null;
    if (targets) {
      for (const t of this.targets) {
        if (!t.alive) continue;
        const r = t.radius + pad;
        const ox = o.x - t.pos.x, oy = o.y - t.pos.y, oz = o.z - t.pos.z;
        const b = ox * d.x + oy * d.y + oz * d.z;
        const c = ox * ox + oy * oy + oz * oz - r * r;
        const disc = b * b - c;
        if (disc < 0) continue;
        let tt = -b - Math.sqrt(disc);
        if (tt < 0) tt = c < 0 ? 0 : -1;
        if (tt >= 0 && tt < best) {
          best = tt; target = t; collider = null;
          normal = _n.set(o.x + d.x * tt - t.pos.x, o.y + d.y * tt - t.pos.y, o.z + d.z * tt - t.pos.z).normalize().clone();
        }
      }
    }
    // Grid traversal
    const C = this.cell, st = ++this.stamp;
    let i = Math.floor((o.x - this.gx0) / C), j = Math.floor((o.z - this.gz0) / C);
    const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(d.x) > 1e-9 ? C / Math.abs(d.x) : Infinity, tdz = Math.abs(d.z) > 1e-9 ? C / Math.abs(d.z) : Infinity;
    let tmx = Math.abs(d.x) > 1e-9 ? ((this.gx0 + (i + (sx > 0 ? 1 : 0)) * C) - o.x) / d.x : Infinity;
    let tmz = Math.abs(d.z) > 1e-9 ? ((this.gz0 + (j + (sz > 0 ? 1 : 0)) * C) - o.z) / d.z : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 4000; guard++) {
      if (i >= 0 && j >= 0 && i < this.gw && j < this.gh) {
        for (const c of this.grid[j * this.gw + i]) {
          if (c.stamp === st) continue;
          c.stamp = st;
          const hit = this.rayBox(o, d, c, best);
          if (hit) {
            best = hit.t;
            target = c.ref && c.ref.alive ? c.ref : null;
            normal = hit.n;
            collider = c;
          }
        }
      } else if ((sx > 0 && i >= this.gw) || (sx < 0 && i < 0) || (sz > 0 && j >= this.gh) || (sz < 0 && j < 0)) break;
      tCell = Math.min(tmx, tmz);
      if (tCell > best) break;
      if (tmx < tmz) { tmx += tdx; i += sx; } else { tmz += tdz; j += sz; }
    }
    // Ground inside the city, water outside it
    if (d.y < -1e-6) {
      const B = this.bounds;
      let tg = -o.y / d.y;
      const px = o.x + d.x * tg, pz = o.z + d.z * tg;
      if (px < B.minX - 30 || px > B.maxX + 30 || pz > B.maxZ + 30) tg = (this.city.L.water - o.y) / d.y;
      if (tg >= 0 && tg < best) { best = tg; target = null; collider = null; normal = new V3(0, 1, 0); }
    }
    if (!normal) return null;
    return { dist: best, point: new V3().copy(o).addScaledVector(d, best), normal, target, collider };
  }

  rayBox(o, d, c, best) {
    let tmin = 0, tmax = best, axis = -1, sign = 0;
    for (let a = 0; a < 3; a++) {
      const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const mn = a === 0 ? c.min.x : a === 1 ? c.min.y : c.min.z;
      const mx = a === 0 ? c.max.x : a === 1 ? c.max.y : c.max.z;
      if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) return null; continue; }
      let t1 = (mn - oa) / da, t2 = (mx - oa) / da, s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (axis < 0 || tmin >= best) return null;
    const n = new V3(); n.setComponent(axis, sign);
    return { t: tmin, n };
  }

  damage(t, amount, point) {
    if (!t || !t.alive) return false;
    if (t.kind === 'car') return this.city.damageCar(t, amount, point);
    this.cb.onHit && this.cb.onHit(t, point);
    return this.spiders.damage(t, amount, point);
  }

  damageRadius(point, radius, amount) {
    // A copy: kills drop targets from the list
    for (const t of [...this.targets]) {
      if (!t.alive) continue;
      const d = t.pos.distanceTo(point) - t.radius;
      if (d < radius) this.damage(t, amount * (1 - Math.max(0, d) / radius) * 0.85 + amount * 0.15, t.pos);
    }
    if (point.y > 6) return;
    this.query(point.x - radius, point.z - radius, point.x + radius, point.z + radius, (c) => {
      if (!c.ref || !c.ref.alive) return;
      const d = Math.max(0, c.ref.pos.distanceTo(point) - 2);
      if (d < radius) this.city.damageCar(c.ref, amount * (1 - d / radius) + 8, point);
    });
  }

  update(dt, player, ctx) {
    this.city.update(dt, Object.assign({ player }, ctx));
    // Keep the shadow frustum centered on the player, far enough back to catch the tall towers
    this.sun.position.copy(player).addScaledVector(SUN_DIR, 700);
    this.sun.target.position.copy(player);
  }
}
