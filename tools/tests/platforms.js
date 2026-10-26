// Serve the repository root, then run with Playwright available (same setup as summons.js):
//   BASE_URL=http://127.0.0.1:8233 node tools/tests/platforms.js
// Include the XR clock regression with XR_RUNTIME_URL pointing to the IWER 2.7.0
// ES module (test injection only; the game never loads an emulator).
// Exercises the real game with a standard Gamepad API fixture. Physical controller routing
// and headset rendering still require the hardware checks in README.md.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8233';

async function xrClockRegression(browser) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  try {
    await context.addInitScript(() => {
      localStorage.setItem('vectorclad.settings', JSON.stringify({ music: false, sound: true, graphics: 'low', shadows: false, hires: false }));
      window.__xrFrames = 0;
      window.__pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__pad] });
    });
    await context.route('**/js/boot.js', async (route) => {
      const response = await route.fetch();
      const setup = `import { XRDevice, metaQuest3 } from ${JSON.stringify(process.env.XR_RUNTIME_URL)};
        const device = new XRDevice(metaQuest3);
        window.__xrDevice = device;
        device.stereoEnabled = true;
        device.installRuntime({ forceInstall: true });
        const request = navigator.xr.requestSession.bind(navigator.xr);
        navigator.xr.requestSession = async (...args) => {
          const session = await request(...args), raf = session.requestAnimationFrame.bind(session);
          let origin;
          session.requestAnimationFrame = callback => raf((time, frame) => {
            origin ??= time;
            window.__xrFrames++;
            callback(time - origin, frame);
          });
          return session;
        };\n`;
      await route.fulfill({ response, body: setup + await response.text() });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE);
    await page.locator('#title-start').click();
    await page.waitForFunction(() => window.__mech?.mode === 'intro', null, { timeout: 120000 });
    assert.equal(await page.evaluate(async () => { const guns = await import('/js/guns3d.js'); return guns.GUN_IDS.every(guns.hasGun); }), true);
    await page.locator('[data-enter-xr]').first().click();
    await page.waitForFunction(() => window.__xrFrames >= 5, null, { timeout: 30000 });
    const state = () => page.evaluate(() => {
      const m = window.__mech;
      return { time: m.time, active: m.immersive.active, tracked: m.immersive.tracked,
        position: m.P.pos.toArray(), thrust: Object.values(m.P.thrust), calls: m.renderer.info.render.calls };
    });
    const first = await state();
    assert.equal(first.active && first.tracked, true);
    assert.ok(first.time >= 0 && Number.isFinite(first.time));
    assert.ok(first.position.every(Number.isFinite));
    assert.ok(first.thrust.every(value => value >= 0 && value <= 1));
    assert.ok(first.calls > 0);
    assert.deepEqual(await page.locator('[data-enter-xr]').allTextContents(), ['Exit VR', 'Exit VR']);
    const tap = async index => {
      await page.evaluate(i => { window.__pad.buttons[i] = { pressed: true, value: 1 }; }, index);
      await page.waitForTimeout(150);
      await page.evaluate(i => { window.__pad.buttons[i] = { pressed: false, value: 0 }; }, index);
      await page.waitForTimeout(100);
    };
    await tap(9); assert.equal(await page.evaluate(() => window.__mech.immersive.panelOpen), false);
    assert.equal(await page.evaluate(() => window.__mech.mode), 'intro');
    await tap(9); assert.equal(await page.evaluate(() => window.__mech.immersive.panelOpen), true);
    await tap(13);
    assert.equal(await page.evaluate(() => document.activeElement.matches('[data-xr-map]')), true);
    await tap(0);
    await page.waitForFunction(() => window.__mech.immersive.helpOpen);
    if (process.env.XR_MAP_IMAGE) await page.evaluate(() => window.__mech.immersive.draw(window.__mech.mode));
    if (process.env.XR_MAP_IMAGE) {
      const png = await page.evaluate(() => window.__mech.immersive.canvas.toDataURL().split(',')[1]);
      require('node:fs').writeFileSync(process.env.XR_MAP_IMAGE, Buffer.from(png, 'base64'));
    }
    await tap(1); assert.equal(await page.evaluate(() => window.__mech.immersive.helpOpen), false);
    assert.equal(await page.evaluate(() => window.__mech.mode), 'intro');
    await page.evaluate(() => window.__mech.startPlay());
    await page.waitForFunction(() => window.__mech.mode === 'play' && !window.__mech.immersive.panelOpen);
    await tap(12);
    await page.waitForFunction(() => window.__mech.immersive.firstPerson);
    const firstPerson = await page.evaluate(() => {
      const m = window.__mech;
      window.__headDraws = 0;
      m.mech.head.traverse(o => { if (o.isMesh) o.onBeforeRender = () => window.__headDraws++; });
      return { height: m.camera.position.y - m.P.pos.y, eye: m.mech.eye.y, distance: m.camera.position.distanceTo(m.P.pos) };
    });
    assert.ok(Math.abs(firstPerson.height - firstPerson.eye) < 0.01);
    assert.ok(firstPerson.distance < 8);
    await page.waitForTimeout(150); assert.equal(await page.evaluate(() => window.__headDraws), 0);
    if (process.env.XR_FP_IMAGE) await page.screenshot({ path: process.env.XR_FP_IMAGE });
    await tap(12); assert.equal(await page.evaluate(() => window.__mech.immersive.firstPerson), false);
    assert.ok(await page.evaluate(() => window.__headDraws > 0));
    await page.evaluate(() => window.__mech.setFrame('obsidian'));
    await tap(12);
    assert.ok(await page.evaluate(() => Math.abs(__mech.camera.position.y - __mech.P.pos.y - __mech.mech.eye.y) < 0.01));
    await tap(12);
    await page.evaluate(() => window.__mech.setFrame('vanguard'));
    await page.evaluate(() => window.__mech.setFrame('pontifex'));
    assert.equal(await page.evaluate(() => !!__mech.mech.pontifexDetailMats && __mech.mech.root.scale.x === 0.88), true);
    await tap(12);
    assert.ok(await page.evaluate(() => { const m = __mech; const eye = m.mech.head.localToWorld(m.P.pos.clone().set(0, 0.18, 0.48)); return Math.abs(m.camera.position.y - eye.y) < 0.25; }));
    await tap(12);
    await page.evaluate(() => window.__mech.setFrame('vanguard'));
    await page.waitForFunction(() => __mech.immersive.hudSnapshot()?.weapons.some(w => w.slot === 'rightHand'));
    await page.evaluate(() => {
      __mech.weapons.slots.rightHand.ammo = 2;
      const xr = __mech.immersive; xr.draw('play');
      xr.activate(xr.buttons.find(b => b.action === 'reload'), {});
    });
    await page.waitForFunction(() => __mech.weapons.slots.rightHand.reloadT > 0);
    await page.waitForFunction(() => __mech.immersive.hudSnapshot().weapons.find(w => w.slot === 'rightHand').reload != null);
    await page.evaluate(() => {
      const xr = __mech.immersive; window.__shieldSource = {};
      xr.activate(xr.buttons.find(b => b.action === 'fireL'), window.__shieldSource);
    });
    await page.waitForFunction(() => __mech.weapons.shieldUp);
    await page.evaluate(() => __mech.immersive.release(window.__shieldSource));
    await page.waitForFunction(() => !__mech.weapons.shieldUp);
    if (process.env.XR_HUD_IMAGE) {
      const png = await page.evaluate(() => { __mech.immersive.draw('play'); return __mech.immersive.canvas.toDataURL().split(',')[1]; });
      require('node:fs').writeFileSync(process.env.XR_HUD_IMAGE, Buffer.from(png, 'base64'));
    }
    const qualityStats = await page.evaluate(async () => {
      const m = window.__mech, stats = [];
      m.immersive.performance.start = m.immersive.performance.last = 0;
      for (const level of [0, 2]) {
        m.immersive.quality = level; m.applyXRQuality(level);
        m.world.trees.lod(m.camera.position);
        await new Promise(r => setTimeout(r, 150));
        stats.push({ level, calls: m.renderer.info.render.calls, triangles: m.renderer.info.render.triangles, treeDetail: m.world.trees.detail, particles: m.fx.smoke.detail });
      }
      m.immersive.quality = 0; m.applyXRQuality(0);
      return stats;
    });
    assert.ok(qualityStats[1].calls < qualityStats[0].calls);
    assert.ok(qualityStats[1].triangles < qualityStats[0].triangles);
    assert.equal(qualityStats[1].particles, 0.4);
    console.log('XR detail profile:', JSON.stringify(qualityStats));
    const holdBoard = async active => {
      await page.evaluate(() => { window.__pad.buttons[10] = { pressed: true, value: 1 }; });
      await page.waitForFunction(value => window.__mech.pilot.active === value, active, { timeout: 10000 });
      await page.evaluate(() => { window.__pad.buttons[10] = { pressed: false, value: 0 }; });
      await page.waitForTimeout(150);
    };
    await holdBoard(true);
    const pilotView = await page.evaluate(() => ({ first: __mech.immersive.firstPerson, body: __mech.pilot.body.root.visible,
      arm: __mech.pilot.view.group.visible, height: __mech.camera.position.y - __mech.P.pos.y, eye: 1.66 / __mech.METERS }));
    assert.equal(pilotView.first, true); assert.equal(pilotView.body, false); assert.equal(pilotView.arm, true);
    assert.ok(Math.abs(pilotView.height - pilotView.eye) < 0.01);
    await tap(12); assert.equal(await page.evaluate(() => __mech.pilot.body.root.visible), true);
    await tap(12); assert.equal(await page.evaluate(() => __mech.pilot.view.group.visible), true);
    await holdBoard(false);
    await tap(9); assert.equal(await page.evaluate(() => window.__mech.immersive.panelOpen), true);
    await page.evaluate(() => window.__mech.immersive.showControllerMap());
    await page.waitForFunction(() => window.__mech.mode === 'hangar' && window.__mech.immersive.helpOpen);
    await page.waitForFunction(() => window.__mech.immersive.panelKey === 'map');
    const paused = await page.evaluate(() => ({ time: __mech.time, position: __mech.P.pos.toArray(), revision: __mech.immersive.panelRevision, camera: __mech.camera.position.toArray() }));
    await page.evaluate(() => { window.__xrDevice.position.x += 0.1; });
    await page.waitForTimeout(350);
    const stillPaused = await page.evaluate(() => ({ time: __mech.time, position: __mech.P.pos.toArray(), revision: __mech.immersive.panelRevision, camera: __mech.camera.position.toArray() }));
    assert.equal(stillPaused.time, paused.time);
    assert.deepEqual(stillPaused.position, paused.position);
    assert.equal(stillPaused.revision, paused.revision);
    assert.notDeepEqual(stillPaused.camera, paused.camera);
    await tap(1); assert.equal(await page.evaluate(() => window.__mech.immersive.helpOpen), false);
    assert.equal(await page.evaluate(() => window.__mech.mode), 'hangar');
    await page.evaluate(() => document.querySelector('#hangar [data-enter-xr]').click());
    await page.waitForFunction(() => !window.__mech.immersive.active);
    assert.ok((await state()).time >= first.time);
    assert.deepEqual(errors, []);
    console.log('PASS: XR clock reset, first person, adaptive detail, static panel reuse, paused head tracking, menus and exit');
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    if (process.env.XR_RUNTIME_URL) await xrClockRegression(browser);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem('vectorclad.settings', JSON.stringify({ music: false, sound: false, graphics: 'low', shadows: false, hires: false }));
      localStorage.removeItem('vectorclad.loadout');
      localStorage.removeItem('fs07.loadout.ac');
      localStorage.removeItem('vectorclad.startAs');
      window.__pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      window.__padConnected = true;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__padConnected ? [window.__pad] : [] });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const tap = async (index) => {
      await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; }, index);
      await page.waitForTimeout(160);
      await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, value: 0 }; }, index);
      await page.waitForTimeout(100);
    };
    const mode = (value) => page.waitForFunction((v) => window.__mech?.mode === v, value, { timeout: 180000 });
    await page.goto(BASE);
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 120000 });
    await tap(0); await mode('intro');
    await tap(0); await mode('frames');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-frame-next');
    await tap(12); assert.notEqual(await page.evaluate(() => document.activeElement.id), 'btn-frame-next');
    await tap(13); assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-frame-next');
    await tap(0); await mode('loadout');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-close-hangar');
    await page.evaluate(() => document.getElementById('sens').focus());
    const sensitivity = await page.evaluate(() => +document.getElementById('sens').value);
    await tap(15);
    assert.ok(await page.evaluate((s) => +document.getElementById('sens').value > s, sensitivity));
    await page.evaluate(() => {
      document.getElementById('btn-close-hangar').focus();
      window.__mech.fixedDt = 0.05; window.__mech.skipRender = true;
    });
    await tap(0); await mode('drop');
    await page.evaluate(() => window.__mech.openHangar()); await mode('hangar');
    assert.equal(await page.evaluate(() => document.getElementById('drop').hidden), true);
    await tap(0); await mode('drop'); await tap(0); await mode('brief');
    await page.evaluate(() => window.__mech.openHangar()); await mode('hangar');
    assert.equal(await page.evaluate(() => document.getElementById('brief').hidden), true);
    await tap(0); await mode('brief');
    await tap(0); await mode('play');
    await page.evaluate(() => { delete window.__mech.fixedDt; window.__mech.skipRender = false; });
    await tap(12);
    assert.equal(await page.evaluate(() => __mech.cam.firstPerson), true);
    assert.ok(await page.evaluate(() => Math.abs(__mech.camera.position.y - __mech.P.pos.y - __mech.mech.eye.y) < 0.01));
    await tap(12); assert.equal(await page.evaluate(() => __mech.cam.firstPerson), false);
    assert.equal(await page.evaluate(() => window.__mech.input.sample().jump), false);
    const state = () => page.evaluate(() => ({ p: window.__mech.P.pos.toArray(), yaw: window.__mech.P.yaw, ammo: window.__mech.weapons.slots.rightHand.ammo }));
    const before = await state();
    await page.evaluate(() => { window.__pad.axes = [0, -1, 0.7, 0]; window.__pad.buttons[7] = { pressed: true, value: 1 }; });
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; window.__pad.buttons[7] = { pressed: false, value: 0 }; });
    const after = await state();
    assert.ok(Math.hypot(after.p[0] - before.p[0], after.p[2] - before.p[2]) > 0.1);
    assert.notEqual(after.yaw, before.yaw); assert.ok(after.ammo < before.ammo);
    await tap(9); await mode('hangar'); await tap(0); await mode('play');
    await tap(8); assert.equal(await page.evaluate(() => window.__mech.summonMenu.open), true);
    await tap(13); const count = await page.evaluate(() => +document.activeElement.value);
    await tap(15); assert.equal(await page.evaluate(() => +document.activeElement.value), count + 1);
    await tap(13); await tap(0);
    assert.equal(await page.evaluate(() => window.__mech.summoner.total), count + 1);
    await tap(8); assert.equal(await page.evaluate(() => window.__mech.summonMenu.open), false);
    await page.evaluate(() => { window.__padConnected = false; }); await mode('hangar');
    assert.equal(await page.evaluate(() => window.__mech.input.sample().fireR), false);
    await page.evaluate(() => { window.__padConnected = true; }); await tap(0); await mode('play');
    await page.evaluate(() => { const m = window.__mech; m.hurt(1e8, m.P.pos.clone().addScalar(2), 'blast'); });
    await mode('over'); await page.waitForSelector('#gameover:not([hidden])');
    await tap(0); await mode('drop');
    assert.deepEqual(errors, []);
    console.log('PASS: title, frame select, loadout, slider, insertion, combat, summon, pause, reconnect and redeploy');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
