// PX-09 Pontifex (assets/pontifex-frame): the model against its reference sheet, the stock
// animation running on it, and the frame in the game. Serve the repo root first:
//   python -m http.server 8241 --bind 127.0.0.1
//   NODE_PATH=<global node_modules with playwright> node tools/tests/pontifex.js [scenario...]
//
// Scenarios: closeup (idle and walking from six sides, and the head), sheet (the reference stance front and back, framed like reference.webp, written
// beside it as pontifex-sheet.png), motions (idle, walk, run, dash, jump, aim, reload from four
// sides, checking the feet stay on the ground and nothing throws), game (the frame picked on the
// select screen, then dropped into a fight and walked about), all (default).
// Writes screenshots to tools/tests/out/pontifex-*.png.
//
// Env: BASE_URL (default http://127.0.0.1:8241), CHROMIUM_ARGS (default: the real GPU on Windows).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8241';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = (process.env.CHROMIUM_ARGS ?? (process.platform === 'win32' ? '--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist' : '')).split(' ').filter(Boolean);
const want = process.argv.slice(2);
const run = (name) => !want.length || want.includes(name) || want.includes('all');

async function preview(browser, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto(BASE + '/assets/pontifex-frame/preview.html');
  await page.waitForFunction(() => window.viewer, null, { timeout: 60000 });
  await page.addStyleTag({ content: 'header,.bar,#status{display:none!important} main{padding:0!important} #view{height:100vh!important;border-radius:0!important}' });
  await page.evaluate(() => { window.viewer.S.paused = true; window.viewer.S.hold = true; window.viewer.layout(); });
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  let failed = false;
  const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

  if (run('sheet')) {
    console.log('sheet');
    // reference.webp is 1536x1024 with a front and a back figure side by side; render each at 768x1024
    const { page, errors } = await preview(browser, { width: 768, height: 1024 });
    const box = await page.evaluate(() => {
      const v = window.viewer;
      v.set({ motion: 'reference', cam: 'front', show: 'pontifex', compare: false });
      const b = new (v.pontifex.root.position.constructor)();
      let lo = Infinity, hi = -Infinity, xl = Infinity, xr = -Infinity;
      v.pontifex.root.updateMatrixWorld(true);
      v.pontifex.root.traverse((o) => {
        if (!o.isMesh || o.userData.isOutline || !o.geometry.attributes.position) return;
        for (let a = o; a; a = a.parent) if (!a.visible) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { b.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); lo = Math.min(lo, b.y); hi = Math.max(hi, b.y); xl = Math.min(xl, b.x); xr = Math.max(xr, b.x); }
      });
      return { lo, hi, xl, xr };
    });
    for (const cam of ['front', 'back']) {
      await page.evaluate(([c, box]) => {
        const v = window.viewer, cm = v.camera;
        v.set({ motion: 'reference', cam: c, show: 'pontifex', compare: false });
        // A long lens from far off, about as flat as the drawing, sized and placed like the sheet's
        // figures: 960 of 1024 px from the crest (y 25) to the soles (y 985)
        const h = box.hi - box.lo, fov = 6, view = h * 1024 / 960, dist = view / (2 * Math.tan(fov * Math.PI / 360));
        const cy = box.lo + h * (985 - 512) / 960;
        cm.fov = fov; cm.updateProjectionMatrix();
        cm.position.set(Math.sin(v.S.yaw) * dist, cy, Math.cos(v.S.yaw) * dist);
        cm.lookAt(0, cy, 0);
        v.renderer.render(v.scene, cm);
      }, [cam, box]);
      await page.locator('#view').screenshot({ path: path.join(OUT, `pontifex-ref-${cam}.png`) });
    }
    console.log(`  height ${(box.hi - box.lo).toFixed(2)} (sole ${box.lo.toFixed(2)}), span ${(box.xr - box.xl).toFixed(2)}`);
    check(Math.abs(box.lo) < 0.12, 'reference stance stands on the ground');
    // The sheet: 960 px from the crest to the soles, 735 px fingertip to fingertip (front figure)
    const ratio = (box.xr - box.xl) / (box.hi - box.lo);
    check(Math.abs(ratio - 735 / 960) < 0.08, `span / height ${ratio.toFixed(3)} against the sheet's ${(735 / 960).toFixed(3)}`);
    check(!errors.length, 'no errors' + (errors.length ? '\n' + errors.join('\n') : ''));
    await page.close();
  }

  if (run('closeup')) {
    console.log('closeup');
    const { page, errors } = await preview(browser, { width: 1000, height: 1000 });
    const views = { front: [0, 0.08, 27], three: [0.7, 0.12, 27], side: [Math.PI / 2, 0.08, 27], back3q: [Math.PI + 0.6, 0.12, 27], back: [Math.PI, 0.08, 24], head: [0.5, 0.1, 6], headside: [Math.PI / 2, 0.05, 6] };
    for (const motion of ['idle', 'walk']) {
      await page.evaluate((m) => { const v = window.viewer; v.set({ motion: m, cam: 'three', show: 'pontifex', compare: false }); for (let i = 0; i < 100; i++) v.step(1 / 60); }, motion);
      for (const [name, [yaw, pitch, dist]] of Object.entries(views)) {
        if (motion === 'walk' && name !== 'three' && name !== 'side') continue;
        await page.evaluate(([yaw, pitch, dist, head]) => {
          const v = window.viewer; v.S.yaw = yaw; v.S.pitch = pitch; v.S.dist = dist; v.S.cam = head ? 'head' : 'three'; v.draw();
        }, [yaw, pitch, dist, name.startsWith('head')]);
        await page.locator('#view').screenshot({ path: path.join(OUT, `pontifex-close-${motion}-${name}.png`) });
      }
    }
    check(!errors.length, 'no errors' + (errors.length ? '\n' + errors.join('\n') : ''));
    await page.close();
  }

  if (run('motions')) {
    console.log('motions');
    const { page, errors } = await preview(browser, { width: 900, height: 900 });
    for (const motion of ['idle', 'walk', 'run', 'dash', 'jump', 'aim', 'reload']) {
      const r = await page.evaluate((m) => {
        const v = window.viewer;
        v.set({ motion: m, cam: 'three', show: 'both', compare: false });
        let minSole = Infinity, maxSole = -Infinity;
        const p = new (v.pontifex.root.position.constructor)();
        for (let i = 0; i < 150; i++) {
          v.step(1 / 60);
          if (m === 'jump' || m === 'dash') continue;
          for (const L of v.pontifex.legs) {
            // the sole is LEG.foot under the ankle, along the ankle's own down axis
            L.ankle.updateWorldMatrix(true, false);
            p.set(0, -v.pontifex.LEG.foot, 0.4).applyMatrix4(L.ankle.matrixWorld);
            minSole = Math.min(minSole, p.y);
          }
        }
        v.draw();
        return { minSole };
      }, motion);
      for (const cam of motion === 'walk' || motion === 'idle' ? ['front', 'side', 'back', 'three'] : ['three']) {
        await page.evaluate((c) => { const v = window.viewer; v.S.yaw = { front: 0, side: Math.PI / 2, back: Math.PI, three: 0.7 }[c]; v.draw(); }, cam);
        await page.locator('#view').screenshot({ path: path.join(OUT, `pontifex-${motion}-${cam}.png`) });
      }
      if (motion !== 'jump' && motion !== 'dash') check(r.minSole > -0.25, `${motion}: soles stay above the ground (lowest ${r.minSole.toFixed(2)})`);
    }
    check(!errors.length, 'no errors' + (errors.length ? '\n' + errors.join('\n') : ''));
    await page.close();
  }

  if (run('game')) {
    console.log('game');
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
    await page.addInitScript(() => localStorage.setItem('vectorclad.frame', JSON.stringify('pontifex')));
    await page.goto(BASE + '/index.html');
    await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 120000 });
    if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
    await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 60000 });
    await page.waitForSelector('#title-start', { timeout: 60000 });
    await page.click('#title-start');
    await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 120000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
    await page.evaluate(() => window.__mech.openFrames());
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'pontifex-game-select.png') });
    const cards = await page.$$eval('.frame-card .fc-name', (n) => n.map((e) => e.textContent));
    check(cards.includes('Pontifex'), `the select screen offers the Pontifex (${cards.join(', ')})`);
    await page.evaluate(() => window.__mech.setFrame('pontifex'));
    await page.evaluate(() => window.__mech.startPlay && window.__mech.startPlay());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'pontifex-game-stand.png') });
    // Walk forward a few seconds
    await page.mouse.click(640, 360);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'pontifex-game-walk.png') });
    await page.keyboard.up('KeyW');
    await page.keyboard.down('Space');
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'pontifex-game-jump.png') });
    await page.keyboard.up('Space');
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ mode: window.__mech.mode }));
    console.log('  mode', st.mode);
    check(!errors.length, 'no errors' + (errors.length ? '\n' + errors.join('\n') : ''));
    await page.close();
  }

  await browser.close();
  process.exit(failed ? 1 : 0);
})();
