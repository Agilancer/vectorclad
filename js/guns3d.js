// The held guns (and the shoulder Vulcan) as Blender-made GLBs: assets/scifi-guns/<id>.glb, built by
// tools/guns/build_guns.py. Same axes and sizes as the code-built models in weapons.js (+Z muzzle,
// grip at the origin), which stay as the fallback when a file fails to load.
// Each part's material name is a role, swapped here for the game's: the guns are dark, a paint skin
// only tints the plates a little, and its stripe colour and the glows are the accents.
import * as THREE from './three.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const GUN_IDS = ['beamRifle', 'bazooka', 'machineGun', 'shotgun', 'grenade', 'beamCannon', 'vulcanPod'];
const GLOW = { beamRifle: 0xff4fc8, bazooka: 0xff6a2a, machineGun: 0x3ad8ff, shotgun: 0xff8a1e, grenade: 0x9dff5a, beamCannon: 0xffb84a, vulcanPod: 0x3ad8ff };
const DARK = new THREE.Color(0x1c1e22);
const cache = {};

export async function loadGuns(base = 'assets/scifi-guns/') {
  const loader = new GLTFLoader();
  await Promise.all(GUN_IDS.map((id) => loader.loadAsync(`${base}${id}.glb`)
    .then((g) => { cache[id] = g.scene; })
    .catch((e) => console.warn(`gun ${id}: using the built-in model`, e))));
  return Object.keys(cache);
}

export const hasGun = (id) => !!cache[id];

const mats = new Map();
function materialsFor(id, skin) {
  const key = `${id}|${skin.id}`;
  let M = mats.get(key);
  if (M) return M;
  const std = (p) => new THREE.MeshStandardMaterial(p);
  M = {
    body: std({ color: DARK.clone().lerp(new THREE.Color(skin.tint), 0.07), roughness: 0.48, metalness: 0.45 }),
    raw: std({ color: 0x0d0e11, roughness: 0.62, metalness: 0.25 }),
    metal: std({ color: 0x2a2c31, roughness: 0.3, metalness: 0.9 }),
    stripe: std({ color: new THREE.Color(skin.stripe), roughness: 0.4, metalness: 0.3 }),
    bore: std({ color: 0x050506, roughness: 0.9, metalness: 0.2 }),
    glow: new THREE.MeshBasicMaterial({ color: GLOW[id] || 0x3ad8ff, toneMapped: false }),
    lens: std({ color: 0x0b1a24, roughness: 0.05, metalness: 0.9, emissive: GLOW[id] || 0x1aa0ff, emissiveIntensity: 0.5 }),
  };
  mats.set(key, M);
  return M;
}

/** A model in the shape buildWeaponModel returns ({ group, muzzles, spin, rear, lens, root }), or null. */
export function gunModel(id, skin, { mounted = false } = {}) {
  const src = cache[id];
  if (!src) return null;
  const group = src.clone(true); // shares the geometry
  const M = materialsFor(id, skin);
  const node = {}, muzzles = [], grips = [];
  group.traverse((o) => {
    if (o.isMesh) {
      const role = (o.material && o.material.name) || 'body';
      o.material = M[role] || M.body;
      o.castShadow = o.receiveShadow = role !== 'glow';
      if (role === 'glow') o.userData.noOutline = true;
      if (/^grip/.test(o.name)) grips.push(o);
    } else if (o !== group) {
      if (/^muzzle\d/.test(o.name)) muzzles[+o.name.slice(6)] = o;
      else node[o.name] = o;
    }
  });
  const model = { group, muzzles: muzzles.filter(Boolean), gltf: true };
  if (node.spin) model.spin = node.spin;
  if (node.rear) model.rear = node.rear;
  if (id === 'grenade') model.spinStep = Math.PI / 2;
  if (node.lens) {
    // Beam cannon charge glow, scaled and faded by the weapon system
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshBasicMaterial({ color: GLOW.beamCannon, toneMapped: false, transparent: true, opacity: 0.25 }));
    node.lens.add(lens);
    model.lens = lens;
  }
  if (mounted && node.root) {
    // Shoulder mount: lift the cannon onto a base and drop its hand grip
    node.root.position.set(0, 0.45, 0.2);
    for (const g of grips) g.visible = false;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), M.metal);
    base.position.set(0, 0.2, -0.1);
    base.castShadow = base.receiveShadow = true;
    group.add(base);
  }
  return model;
}
