// The Blender-detailed PX-09 (assets/pontifex-frame/px09.glb, tools/pontifex/detail_px09.py) in the live game:
// the detailed armor is swapped in, the frame is drawn at PontifexMech.SIZE, its soles stay on the ground standing
// and walking, its shoulder height against the Vanguard's (for FRAMES.pontifex.rise), and hangar + walking shots.
// Usage: node tools/tests/pontifex_detail.js   (server: python -m http.server 8251 --directory <repo>)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8251';
const OUT = path.join(__dirname, 'out', 'pontifex_detail');
const ARGS = (process.env.CHROMIUM_ARGS ?? (process.platform === 'win32' ? '--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist' : '')).split(' ').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });

// Lowest point of each boot and the shoulder height, over the ground the mech stands on
const MEASURE = () => {
  const m = window.__mech.mech;
  m.root.updateMatrixWorld(true);
  const ground = (window.__ground ?? m.root.position.y);
  const soles = m.legs.map((L) => {
    let lo = Infinity;
    L.ankle.traverse((o) => {
      if (!o.isMesh || o.userData.isOutline || o.material.transparent || o.material.blending !== 1) return;
      for (let q = o; q; q = q.parent) if (!q.visible) return; // the thrusters' plumes hang under the soles, hidden
      const p = o.geometry.attributes.position, e = o.matrixWorld.elements;
      for (let i = 0; i < p.count; i += 3) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        lo = Math.min(lo, e[1] * x + e[5] * y + e[9] * z + e[13]);
      }
    });
    return lo - ground;
  });
  const sh = m.arms[0].sh.matrixWorld.elements[13] - ground;
  return { soles, sh, scale: m.root.scale.x, id: m.frameId || 'vanguard' };
};

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let failed = false;
  const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };
  const wait = (s) => page.waitForTimeout(s * 1000);

  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 120000 });
  if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
  await page.waitForSelector('#title-start', { timeout: 60000 });
  await page.click('#title-start');
  await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 120000 }).catch((e) => { console.log(errors.join('\n')); throw e; });

  await page.evaluate(() => { window.__mech.openFrames(); window.__mech.openLoadout(); });
  await wait(1.5);
  const van = await page.evaluate(MEASURE);
  // PX_SIZE=1 builds it at the old size, for comparing
  if (process.env.PX_SIZE) await page.evaluate(async (k) => { (await import('/assets/pontifex-frame/pontifex-mech.js')).PontifexMech.SIZE = k; }, +process.env.PX_SIZE);
  await page.evaluate(() => window.__mech.setFrame('pontifex'));
  await wait(2);
  const px = await page.evaluate(MEASURE);
  const info = await page.evaluate(() => {
    const m = window.__mech.mech; let seams = 0, bolts = 0, meshes = 0;
    m.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) { meshes++; if (/seam/.test(o.name)) seams++; if (/bolt/.test(o.name)) bolts++; } });
    return { detail: !!m.constructor.detail, seams, bolts, meshes, size: m.size };
  });
  console.log('vanguard', JSON.stringify(van), '\npontifex', JSON.stringify(px), '\n', JSON.stringify(info));
  check(info.detail, 'px09.glb loaded');
  check(info.seams + info.bolts > 0 || info.meshes > 0, `detailed armor in the frame (${info.meshes} meshes after batching)`);
  check(Math.abs(px.scale - 0.88) < 1e-6, `frame drawn at ${px.scale}`);
  check(px.soles.every((s) => Math.abs(s) < 0.15), `standing soles on the ground (${px.soles.map((s) => s.toFixed(3)).join(', ')})`);
  console.log(`  shoulder: vanguard ${van.sh.toFixed(2)}, pontifex ${px.sh.toFixed(2)} -> rise ${(px.sh - van.sh).toFixed(2)}`);
  await page.screenshot({ path: path.join(OUT, 'hangar.png') });

  // Deploy and walk
  await page.evaluate(() => { window.__mech.startPlay(); if (window.__mech.dismissBrief) window.__mech.dismissBrief(); });
  await page.waitForFunction(() => window.__mech.mode === 'play', null, { timeout: 60000 }).catch(() => {});
  await wait(1.5);
  await page.keyboard.down('KeyW');
  const samples = [];
  for (let i = 0; i < 40; i++) { await wait(0.08); samples.push(await page.evaluate(MEASURE)); }
  await page.screenshot({ path: path.join(OUT, 'walk.png') });
  await page.keyboard.up('KeyW');
  const planted = samples.map((s) => Math.min(...s.soles));
  const worst = Math.min(...planted), high = Math.max(...planted);
  check(worst > -0.3 && high < 0.35, `walking: the lower sole stays near the ground (${worst.toFixed(2)} .. ${high.toFixed(2)})`);
  check(!errors.length, `no page errors${errors.length ? ':\n' + errors.join('\n') : ''}`);
  await browser.close();
  console.log(failed ? 'FAILED' : 'all ok');
  process.exit(failed ? 1 : 0);
})();
