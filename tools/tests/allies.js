// Frame select, loadout, the Kestrel H insertion and the allied tank drops (js/frames.js,
// js/allies.js). Serve the repo root first:
//   python -m http.server 8233 --bind 127.0.0.1
//   NODE_PATH=<global node_modules with playwright> node tools/tests/allies.js [scenario...]
//
// Scenarios: frames (both frames on the select and loadout screens, desktop and a landscape
// phone), drop (the insertion: shots along the flight, the release, the landing on the plaza),
// tanks (a pack forced in: Kestrels in, tanks down, then a fight with the swarm: prints how many
// tanks landed, what they killed and what the swarm destroyed), all (default). The tanks' fight
// summons a swarm through the summon menu's code (there are no waves).
// Writes screenshots to tools/tests/out/allies-*.png.
//
// Env: BASE_URL (default http://127.0.0.1:8233), CHROMIUM_ARGS (default: the real GPU on Windows),
// FRAME (vanguard | obsidian, default obsidian), SECS (seconds of the tank fight, default 60).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8233';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = (process.env.CHROMIUM_ARGS ?? (process.platform === 'win32' ? '--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist' : '')).split(' ').filter(Boolean);
const want = process.argv.slice(2);
const run = (name) => !want.length || want.includes(name) || want.includes('all');
const FRAME = process.env.FRAME || 'obsidian';

async function boot(browser, viewport, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')));
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 120000 });
  if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 60000 });
  await page.waitForSelector('#title-start', { timeout: 60000 });
  await page.click('#title-start');
  await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 120000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
  return { ctx, page, errors };
}

/** Run game time up to t seconds past now, in fixed 1/60 s steps */
async function advance(page, secs) {
  await page.evaluate(() => { window.__mech.fixedDt = 1 / 60; });
  const t = await page.evaluate((s) => window.__mech.time + s, secs);
  await page.waitForFunction((tt) => window.__mech.time >= tt, t, { timeout: 600000, polling: 50 });
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `allies-${name}.png`) });

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  let failed = false;
  const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

  if (run('frames')) {
    console.log('frames');
    for (const [label, vp, touch] of [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 844, height: 390 }, true]]) {
      const { ctx, page, errors } = await boot(browser, vp, touch);
      await page.click('#btn-launch');
      await page.waitForFunction(() => window.__mech.mode === 'frames');
      for (const id of ['vanguard', 'obsidian']) {
        await page.evaluate((i) => { window.__mech.setFrame(i); document.querySelectorAll('.frame-card')[i === 'vanguard' ? 0 : 1].click(); }, id);
        await page.waitForTimeout(1200);
        await shot(page, `select-${id}-${label}`);
        const st = await page.evaluate(() => ({ id: window.__mech.frame.id, pressed: [...document.querySelectorAll('.frame-card')].map((c) => c.getAttribute('aria-pressed')), ap: window.__mech.P.ap, mounts: window.__mech.weapons.status().filter((s) => !s.empty).length }));
        check(st.id === id && st.pressed[id === 'vanguard' ? 0 : 1] === 'true', `${label}: ${id} picked and shown (${st.ap} AP, ${st.mounts} weapons mounted)`);
        // Every card fits on screen
        const fit = await page.evaluate(() => [...document.querySelectorAll('.frame-card, #btn-frame-next')].every((c) => { const r = c.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; }));
        check(fit, `${label}: cards and buttons fit the width`);
      }
      await page.click('#btn-frame-next');
      await page.waitForFunction(() => window.__mech.mode === 'loadout');
      await page.waitForTimeout(800);
      await shot(page, `loadout-${label}`);
      const head = await page.evaluate(() => [document.querySelector('#hangar-eyebrow').textContent, document.querySelector('#btn-close-hangar').textContent, !document.querySelector('#btn-hangar-back').hidden]);
      check(head[1] === 'Deploy' && head[2], `${label}: loadout says "${head[0]}", Deploy and Frames buttons`);
      check(!errors.length, `${label}: no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
      await ctx.close();
    }
  }

  let page, errors, ctx;
  if (run('drop') || run('tanks')) {
    ({ ctx, page, errors } = await boot(browser, { width: 1280, height: 720 }));
    await page.evaluate((f) => window.__mech.setFrame(f), FRAME);
  }

  if (run('drop')) {
    console.log(`drop (${FRAME})`);
    await page.evaluate(() => { window.__mech.fixedDt = 1 / 60; window.__mech.openFrames(); window.__mech.openLoadout(); });
    await page.click('#btn-close-hangar');
    await page.waitForFunction(() => window.__mech.mode === 'drop');
    for (const m of [0.5, 1.5, 2.5, 3.5, 4.5, 5.3, 5.9]) {
      // Hold the flight at each mark for the shot
      await page.waitForFunction((mm) => window.__mech.allies.drop.t >= mm, m, { timeout: 120000, polling: 'raf' });
      await page.evaluate(() => { window.__mech.fixedDt = 1e-6; });
      await page.waitForTimeout(150);
      await shot(page, `drop-${m.toFixed(1)}s`);
      await page.evaluate(() => { window.__mech.fixedDt = 1 / 60; });
      const s = await page.evaluate(() => { const D = window.__mech.allies.drop, P = window.__mech.P; return D && { t: D.t.toFixed(2), alt: (D.pos.y * window.__mech.METERS).toFixed(0), feet: (P.pos.y * window.__mech.METERS).toFixed(0), z: D.pos.z.toFixed(0), mode: window.__mech.mode }; });
      console.log('   ', JSON.stringify(s));
    }
    // The drop holds at the release on the tech-demo notice until OKAY
    await page.waitForFunction(() => window.__mech.mode === 'brief', null, { timeout: 120000, polling: 'raf' });
    await shot(page, 'drop-brief');
    check(!(await page.$eval('#brief', (e) => e.hidden)), 'held at the release on the tech-demo notice');
    await page.click('#btn-brief-ok');
    await advance(page, 0.4);
    const rel = await page.evaluate(() => ({ mode: window.__mech.mode, drop: !document.querySelector('#drop').hidden, hud: !document.querySelector('#hud').hidden }));
    check(rel.mode === 'play' && !rel.drop && rel.hud, `released into play: mode ${rel.mode}, HUD up`);
    await advance(page, 2.5);
    await shot(page, 'drop-landed');
    const land = await page.evaluate(() => { const m = window.__mech, sp = m.world.city.spawn; return { grounded: m.P.grounded, y: m.P.pos.y, off: Math.hypot(m.P.pos.x - sp.x, m.P.pos.z - sp.z) }; });
    check(land.grounded && land.off < 6, `landed on the plaza (${land.off.toFixed(1)} units from the spawn, y ${land.y.toFixed(2)})`);
    await advance(page, 4);
    await shot(page, 'drop-lifter-leaving');
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
  }

  if (run('tanks')) {
    console.log('tanks');
    if (!run('drop')) {
      await page.evaluate(() => { window.__mech.startPlay(); });
    }
    const SECS = parseFloat(process.env.SECS || '60');
    await page.evaluate(() => {
      const m = window.__mech;
      // The mech watches, unkillable; the tanks and the swarm fight
      Object.defineProperty(m.P, 'ap', { get: () => 1e9, set() {}, configurable: true });
      m.allies.schedule(0);
    });
    await advance(page, 0.2);
    const pack = await page.evaluate(() => window.__mech.allies.ships.length);
    check(pack >= 3 && pack <= 10, `a pack of ${pack} Kestrels inbound`);
    // Follow the lead Kestrel down with a free camera
    let landed = 0, shotIn = false, shotDown = false, shotTank = false;
    for (let t = 0; t < 40; t += 0.5) {
      await advance(page, 0.5);
      const st = await page.evaluate(() => {
        const A = window.__mech.allies, s = A.ships[0];
        return {
          phases: A.ships.map((x) => x.phase).join(','), tanks: A.tanks.filter((x) => x.state !== 'fall').length,
          busy: A.ships.some((x) => x.tank), s: s && { x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw, phase: s.phase },
        };
      });
      landed = Math.max(landed, st.tanks);
      if (st.s && !shotIn && st.s.phase === 'in' && t > 2) {
        shotIn = true;
        await page.evaluate((s) => { window.__mech.cam.free = { pos: [s.x - Math.sin(s.yaw) * 40 + 18, s.y + 8, s.z - Math.cos(s.yaw) * 40], look: [s.x, s.y - 2, s.z], fov: 55 }; }, st.s);
        await advance(page, 0.05);
        await shot(page, 'pack-inbound');
      }
      if (st.s && !shotDown && (st.s.phase === 'drop' || (st.s.phase === 'down' && st.s.y < 30))) {
        shotDown = true;
        await page.evaluate((s) => { window.__mech.cam.free = { pos: [s.x + 22, 9, s.z + 26], look: [s.x, Math.max(3, s.y - 3), s.z], fov: 55 }; }, st.s);
        await advance(page, 0.05);
        await shot(page, 'kestrel-setting-down');
      }
      if (!shotTank && st.tanks >= 1 && t > 12) {
        shotTank = true;
        await page.evaluate(() => { const t = window.__mech.allies.tanks.find((x) => x.state === 'drive'); window.__mech.cam.free = { pos: [t.pos.x + 12, 7, t.pos.z + 14], look: [t.pos.x, 1.5, t.pos.z], fov: 50 }; });
        await advance(page, 0.05);
        await shot(page, 'tank-on-the-road');
      }
      if (t > 4 && !st.busy && st.tanks >= landed) break;
      process.stdout.write(`\r    t=${t.toFixed(1)} ships ${st.phases || '-'} tanks ${st.tanks}      `);
    }
    console.log();
    await page.evaluate(() => { window.__mech.cam.free = null; });
    check(landed === pack, `${landed} of ${pack} tanks set down`);
    // Shot down: a Kestrel with its tank still slung under it spins in, crashes and burns
    await page.evaluate(() => window.__mech.allies.schedule(0));
    await page.waitForFunction(() => window.__mech.allies.ships.some((s) => s.tank && s.phase === 'down' && s.pos.y > 25), null, { timeout: 120000, polling: 100 });
    const downed = await page.evaluate(() => {
      const A = window.__mech.allies, s = A.ships.find((x) => x.tank && x.phase === 'down' && x.pos.y > 25);
      s.tag = 'downed';
      A.hurt(s, 999, null, 'laser');
      window.__mech.cam.free = { pos: [s.pos.x + 40, s.pos.y + 6, s.pos.z + 40], look: [s.pos.x, s.pos.y - 12, s.pos.z], fov: 60 };
      return { tanks: A.tanks.length };
    });
    await advance(page, 1.2);
    await shot(page, 'kestrel-shot-down');
    await advance(page, 8);
    const after = await page.evaluate(() => { const A = window.__mech.allies; return { gone: !A.ships.some((s) => s.tag === 'downed'), wreck: A.tanks.filter((t) => !t.alive).length }; });
    check(after.gone && after.wreck >= 1, `a downed Kestrel crashed, and the tank it carried is a wreck`);
    await page.evaluate(() => { window.__mech.cam.free = null; });
    // The fight: the swarm and the tanks, for SECS seconds of game time
    const before = await page.evaluate(() => window.__mech.allies.kills);
    // Summon a swarm with the numbers to wreck tanks (there are no waves)
    await page.evaluate(() => { const m = window.__mech; for (const id of ['stalker', 'skitter', 'bombard', 'burrower', 'berserker', 'bulwark', 'riftling']) m.summoner.summon(id, id === 'riftling' ? 60 : id === 'bulwark' ? 2 : 6, m.P); });
    let maxFoes = 0;
    for (let t = 0; t < SECS; t += 5) {
      await advance(page, 5);
      const st = await page.evaluate(() => {
        const m = window.__mech, A = m.allies;
        const live = A.tanks.filter((x) => x.alive);
        return {
          bugs: m.spiders.hostiles, tanks: live.length, wrecks: A.tanks.filter((x) => !x.alive).length, kills: A.kills,
          foes: m.spiders.list.filter((s) => s.foe && s.foe.tank).length, hurt: Math.round(live.reduce((s, x) => s + x.maxHp - x.hp, 0)),
        };
      });
      maxFoes = Math.max(maxFoes, st.foes);
      process.stdout.write(`\r    t=${t + 5}s bugs ${st.bugs} tanks ${st.tanks} (armor lost ${st.hurt}) wrecks ${st.wrecks} tank kills ${st.kills} bugs on tanks ${st.foes}      `);
      if (t === 15 || t === 35) {
        await page.evaluate(() => {
          const A = window.__mech.allies, t = A.tanks.find((x) => x.alive && x.target) || A.tanks.find((x) => x.alive);
          if (t) window.__mech.cam.free = { pos: [t.pos.x - Math.sin(t.yaw) * 16 + 6, 9, t.pos.z - Math.cos(t.yaw) * 16], look: [t.pos.x + Math.sin(t.yaw) * 10, 3, t.pos.z + Math.cos(t.yaw) * 10], fov: 60 };
        });
        await advance(page, 0.05);
        await shot(page, `fight-${t}s`);
        await page.evaluate(() => { window.__mech.cam.free = null; });
      }
    }
    console.log();
    const end = await page.evaluate(() => ({ kills: window.__mech.allies.kills, lost: window.__mech.allies.tanks.filter((x) => !x.alive).length, mechKills: Number(document.querySelector('#score').textContent) }));
    check(end.kills > before, `tanks killed ${end.kills - before} bugs (the mech's tally: ${end.mechKills})`);
    check(maxFoes > 0, `the swarm went after the tanks (up to ${maxFoes} bugs at once), ${end.lost} tanks wrecked`);
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
  }

  if (want.includes('soak')) {
    // Quick deploy and let the packs come on their own; frame rate in real time (no fixed steps)
    console.log('soak');
    const s = await boot(browser, { width: 1280, height: 720 });
    await s.page.click('#btn-quick');
    await s.page.waitForFunction(() => window.__mech.mode === 'play', null, { timeout: 60000 });
    await s.page.evaluate(() => {
      const m = window.__mech;
      Object.defineProperty(m.P, 'ap', { get: () => 1e9, set() {}, configurable: true });
      window.__fps = [];
      let last = performance.now(), n = 0, acc = 0;
      const tick = (now) => { acc += now - last; last = now; if (++n === 60) { window.__fps.push(1000 * n / acc); n = 0; acc = 0; } requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    for (let t = 0; t < 120; t += 10) {
      await s.page.waitForTimeout(10000);
      const st = await s.page.evaluate(() => {
        const m = window.__mech, A = m.allies, f = window.__fps.splice(0);
        return { tanks: A.tanks.filter((x) => x.alive).length, ships: A.ships.length, kills: A.kills, fps: f.length ? Math.min(...f).toFixed(0) + '-' + Math.max(...f).toFixed(0) : '-', next: A.packT.toFixed(0), mode: m.mode };
      });
      console.log(`    ${t + 10}s ${st.mode} tanks ${st.tanks} ships ${st.ships} (next pack in ${st.next}s) tank kills ${st.kills} fps ${st.fps}`);
    }
    const end = await s.page.evaluate(() => window.__mech.allies.tanks.length);
    check(end > 0, `packs came on their own (${end} tanks on the streets after two minutes)`);
    check(!s.errors.length, `no page errors${s.errors.length ? '\n' + s.errors.join('\n') : ''}`);
    await s.ctx.close();
  }

  if (ctx) await ctx.close();
  await browser.close();
  if (failed) process.exitCode = 1;
})();
