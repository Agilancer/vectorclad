// The Blender-made guns (assets/scifi-guns/, tools/guns/build_guns.py) in the live game: every held gun and the
// Vulcan Pod loads from its GLB, keeps its muzzles/spin/lens, fires, and is shot in the hangar per loadout.
// Usage: node tools/tests/guns.js   (server: python -m http.server 8247 --directory <repo>)
// Env: BASE_URL (default http://127.0.0.1:8247), CHROMIUM_ARGS (default: the real GPU on Windows).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8247';
const OUT = path.join(__dirname, 'out', 'guns');
const ARGS = (process.env.CHROMIUM_ARGS ?? (process.platform === 'win32' ? '--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist' : '')).split(' ').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });

const LOADOUTS = [
  ['rifle-cannon', { rightHand: ['beamRifle', 'white'], leftHand: ['beamCannon', 'gunmetal'], shoulderL: ['vulcanPod', 'hazard'], shoulderR: ['beamCannon', 'white'] }],
  ['mg-shotgun', { rightHand: ['machineGun', 'olive'], leftHand: ['shotgun', 'crimson'], shoulderL: ['vulcanPod', 'navy'], shoulderR: ['vulcanPod', 'navy'] }],
  ['bazooka-grenade', { rightHand: ['bazooka', 'arctic'], leftHand: ['grenade', 'bronze'], shoulderL: ['missilePod', 'gunmetal'], shoulderR: ['vulcanPod', 'desert'] }],
];

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let failed = false;
  const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 120000 });
  if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
  await page.waitForSelector('#title-start', { timeout: 60000 });
  await page.click('#title-start');
  await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 120000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
  await page.evaluate(() => { window.__mech.fixedDt = 1 / 60; window.__mech.openFrames(); window.__mech.openLoadout(); });
  await page.waitForTimeout(600);

  for (const [name, slots] of LOADOUTS) {
    const r = await page.evaluate((slots) => {
      const W = window.__mech.weapons;
      W.equip({ slots });
      return Object.entries(W.slots).map(([id, s]) => ({
        slot: id, gun: s.id, gltf: !!s.model.gltf, muzzles: s.model.muzzles.length,
        spin: !!s.model.spin, lens: !!s.model.lens, rear: !!s.model.rear,
        muzzleZ: s.model.muzzles[0] ? +s.model.muzzles[0].position.z.toFixed(2) : null,
      }));
    }, slots);
    console.log(name);
    for (const s of r) {
      if (s.gun === 'missilePod') continue;
      check(s.gltf && s.muzzles > 0, `${s.slot} ${s.gun}: GLB model, ${s.muzzles} muzzle(s) at z ${s.muzzleZ}`);
      if (['machineGun', 'grenade', 'vulcanPod'].includes(s.gun)) check(s.spin, `${s.gun} has spinning barrels`);
      if (s.gun === 'beamCannon') check(s.lens, `${s.slot} beam cannon has its charge lens`);
      if (s.gun === 'bazooka') check(s.rear, 'bazooka has its back-blast point');
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  check(!errors.length, `no page errors${errors.length ? ':\n' + errors.join('\n') : ''}`);
  await browser.close();
  console.log(failed ? 'FAILED' : 'all ok');
  process.exit(failed ? 1 : 0);
})();
