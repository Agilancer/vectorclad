// Screenshots of the BK-09 Sovereign from several angles (tools/sovereign.html). Serve the repo root first:
//   python -m http.server 8217 --bind 127.0.0.1
//   node tools/tests/sovereign.js [view...]
// Views: ref front three side back rear (default: all), plus "armed" for the sidearm held low,
// "aim" for it raised, and the close-ups head and legs. Writes tools/tests/out/sovereign-<view>.png.
// Env: BASE_URL (default http://127.0.0.1:8217), THREE_DIR (a local copy of the three@0.170.0 npm
// package, served in place of the CDN), VIEWPORT (default 600x900), OUTLINE=1.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8217';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const VIEWS = ['ref', 'front', 'three', 'side', 'back', 'rear'];
const want = process.argv.slice(2);
const shots = want.length ? want : VIEWS;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const [VW, VH] = (process.env.VIEWPORT || '600x900').split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  if (process.env.THREE_DIR) {
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\/(.*)$/, (route) => {
      const m = route.request().url().match(/three@0\.170\.0\/(.*)$/);
      route.fulfill({ path: path.join(process.env.THREE_DIR, m[1]), contentType: 'application/javascript' });
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto(`${BASE}/tools/sovereign.html?shot=1${process.env.OUTLINE ? '&outline=1' : ''}`);
  await page.waitForFunction(() => window.__viewer && window.__viewer.ready, null, { timeout: 120000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
  // [azimuth, elevation, distance, look-at height]; head* are close-ups
  const presets = {
    ref: [-18, -7], front: [0, 6], three: [35, 10], side: [90, 4], back: [180, 8], rear: [-140, 12], armed: [-30, 4], aim: [-50, 6],
    head: [-18, 2, 9, 6.1], legs: [-18, -4, 11, 1.8],
  };
  for (const v of shots) {
    const [az, el, dist, ty] = presets[v] || presets.ref;
    await page.evaluate(([az, el, dist, ty, v]) => {
      window.__viewer.setState({ armed: v === 'armed' || v === 'aim', pose: v === 'aim' ? 'aim' : 'idle' });
      window.__viewer.setView(az, el, dist, ty);
      window.__viewer.render();
    }, [az, el, dist, ty, v]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `sovereign-${v}.png`) });
    console.log('shot', v);
  }
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  await browser.close();
})();
