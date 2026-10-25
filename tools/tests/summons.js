// The summon menu and the portals (js/summons.js, js/portals.js, js/riftlings.js). Serve the repo root first:
//   python -m http.server 8233 --bind 127.0.0.1
//   NODE_PATH=<global node_modules with playwright> node tools/tests/summons.js [scenario...]
//
// Scenarios: menu (nothing comes on its own, the ` key opens and closes the menu, a summon puts its button on a
// one-minute cooldown), drops (every kind summoned at once: portals 800 ft ahead in open sky, every
// monster out of its portal and on its feet), rain (200 Acid riftlings come down and latch onto the mech;
// prints how long it took), millipede (it crawls out of its upright portal, clipped until it is
// through, and the portal closes behind it), all (default).
// Writes screenshots to tools/tests/out/summons-*.png. Rendering is skipped between shots, so it
// runs on a software GL.
//
// Env: BASE_URL (default http://127.0.0.1:8233), CHROMIUM_ARGS (default: the real GPU on Windows).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8233';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = (process.env.CHROMIUM_ARGS ?? (process.platform === 'win32' ? '--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist' : '')).split(' ').filter(Boolean);
const want = process.argv.slice(2);
const run = (name) => !want.length || want.includes(name) || want.includes('all');

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')));
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 180000 });
  if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 120000 });
  await page.waitForSelector('#title-start', { timeout: 120000 });
  await page.click('#title-start');
  await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 300000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
  await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; f(); });
  // Into the fight on the plaza, rendering only for screenshots, the mech unkillable
  await page.evaluate(() => {
    const m = window.__mech;
    m.skipRender = true;
    m.startPlay();
    Object.defineProperty(m.P, 'ap', { get: () => 1e9, set() {}, configurable: true });
  });
  await page.waitForFunction(() => window.__mech.time > 1, null, { timeout: 300000 });
  return { ctx, page, errors };
}

/** Run game time up to secs past now, in fixed 1/60 s steps */
async function advance(page, secs) {
  await page.evaluate(() => { window.__mech.fixedDt = 1 / 60; });
  const t = await page.evaluate((s) => window.__mech.time + s, secs);
  await page.waitForFunction((tt) => window.__mech.time >= tt, t, { timeout: 900000, polling: 50 });
}

/** Render a few frames with the clock held, and take the shot */
async function shot(page, name) {
  await page.evaluate(() => { window.__mech.fixedDt = 1e-6; window.__mech.skipRender = false; });
  const f0 = await page.evaluate(() => window.__frames);
  await page.waitForFunction((f) => window.__frames >= f + 3, f0, { timeout: 900000, polling: 200 });
  await page.screenshot({ path: path.join(OUT, `summons-${name}.png`) });
  await page.evaluate(() => { window.__mech.skipRender = true; window.__mech.fixedDt = 1 / 60; });
}

const census = (page) => page.evaluate(() => {
  const m = window.__mech, S = m.spiders, count = (list, key) => list.reduce((o, s) => { const k = key(s); o[k] = (o[k] || 0) + 1; return o; }, {});
  return {
    hostiles: S.hostiles, portals: m.portals.busy, pending: m.summoner.pending,
    states: count(S.list, (s) => s.state), rift: count(S.rift.list, (r) => r.state), mill: S.mill.active ? S.mill.head.state : '-',
  };
});

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  let failed = false;
  const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

  if (run('menu')) {
    console.log('menu');
    const { ctx, page, errors } = await boot(browser);
    await advance(page, 5);
    const quiet = await page.evaluate(() => ({ hostiles: window.__mech.spiders.hostiles, hud: document.querySelector('#hostiles').textContent }));
    check(quiet.hostiles === 0 && quiet.hud === '0', `no waves: nothing comes on its own (HUD says ${quiet.hud} hostiles)`);
    await page.keyboard.press('Backquote');
    const rows = await page.evaluate(() => ({ open: window.__mech.summonMenu.open, rows: document.querySelectorAll('.srow').length, maxes: [...document.querySelectorAll('.srow input[type=range]')].map((r) => r.max).join(',') }));
    check(rows.open && rows.rows === 20, `\` opens the menu with ${rows.rows} monsters (slider limits ${rows.maxes})`);
    await shot(page, 'menu');
    await page.click('.btn-summon');
    const cd = await page.evaluate(() => { const b = document.querySelector('.btn-summon'); return { disabled: b.disabled, label: b.textContent, left: window.__mech.summoner.cooldown('stalker') }; });
    check(cd.disabled && /^[01]:\d\d$/.test(cd.label) && cd.left > 58, `Summon goes on cooldown (${cd.label})`);
    const again = await page.evaluate(() => window.__mech.summoner.summon('stalker', 5, window.__mech.P).ok);
    check(!again, 'no second stalker summon during the cooldown');
    await page.keyboard.press('Backquote');
    check(!(await page.evaluate(() => window.__mech.summonMenu.open)), '` closes it again');
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
    await ctx.close();
  }

  if (run('drops')) {
    console.log('drops');
    const { ctx, page, errors } = await boot(browser);
    const plan = await page.evaluate(() => {
      const m = window.__mech, S = m.summoner, ids = ['stalker', 'skitter', 'weaver', 'lancer', 'bombard', 'bulwark', 'warden', 'mender', 'magnetar', 'quarrier', 'burrower', 'prowler', 'berserker', 'shocktail', 'scorcher', 'venomtail', 'emperor', 'brood'];
      const n = ids.reduce((t, id) => t + S.summon(id, 2, m.P).n, 0);
      return { n, queued: S.queue.length };
    });
    check(plan.n === 36, `every spider and scorpion kind summoned, two each (${plan.n})`);
    await advance(page, 1.5);
    const sky = await page.evaluate(() => {
      const m = window.__mech, P = m.P.pos, M = m.world.M;
      return m.portals.list.map((p) => ({ ft: Math.hypot(p.pos.x - P.x, p.pos.z - P.z) / M / 0.3048, up: p.pos.y / M / 0.3048, flat: Math.abs(p.normal.y) > 0.99 }));
    });
    const ok = sky.length && sky.every((p) => p.flat && p.up >= 390 && p.ft > 500 && p.ft < 1150);
    check(ok, `${sky.length} flat portals ${Math.round(Math.min(...sky.map((p) => p.ft)))}-${Math.round(Math.max(...sky.map((p) => p.ft)))} ft ahead, ${Math.round(Math.min(...sky.map((p) => p.up)))} ft up or more`);
    await shot(page, 'drops');
    await advance(page, 30);
    // Some may be dead by now: skitterers run all the way to the mech and blow up, taking others with them
    const c = await census(page), kills = await page.evaluate(() => window.__mech.spiders.kills);
    const out = Object.values(c.states).reduce((t, v) => t + v, 0);
    check(c.pending === 0 && c.portals === 0 && !c.states.fall && out + kills >= 30, `all out and on their feet: ${JSON.stringify(c.states)}, ${kills} killed`);
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
    await ctx.close();
  }

  if (run('rain')) {
    console.log('rain');
    const { ctx, page, errors } = await boot(browser);
    await page.evaluate(() => {
      const m = window.__mech, R = m.spiders.rift;
      // A mech that can't be killed (regeneration tops AP up to the frame's own), and a tally of latches
      m.frame.ap = m.P.ap = 1e6;
      window.__latches = 0;
      const grab = R.grab.bind(R);
      R.grab = (...a) => { window.__latches++; return grab(...a); };
      m.P.pitch = 0.3;
      m.summoner.summon('acid', 200, m.P);
    });
    await advance(page, 3);
    const c = await census(page);
    check(c.portals > 10, `riftling portals raining: ${c.portals} open at once`);
    await shot(page, 'rain');
    let t = 3, reached = 0;
    for (; t < 60 && reached < 100; t += 3) {
      await advance(page, 3);
      reached = await page.evaluate(() => window.__latches);
    }
    check(reached >= 100, `half the swarm on the mech after ${t} s (${reached} latched on)`);
    await shot(page, 'rain-at-mech');
    const kills = await page.evaluate(() => {
      const m = window.__mech, B = m.spiders.rift, before = B.alive;
      B.stomp(m.P.pos, 6);
      return before - B.alive;
    });
    check(kills > 0, `a stomp squashes ${kills}`);
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
    await ctx.close();
  }

  if (run('millipede')) {
    console.log('millipede');
    const { ctx, page, errors } = await boot(browser);
    const r = await page.evaluate(() => { const m = window.__mech; return m.summoner.summon('millipede', 1, m.P); });
    check(r.ok, `summoned: ${r.msg}`);
    await advance(page, 4);
    const mid = await page.evaluate(() => {
      const m = window.__mech, L = m.spiders.mill, p = L.portal;
      return p && { up: Math.abs(p.normal.y) < 0.01, foot: (p.pos.y - p.radius) / m.world.M / 0.3048, hidden: L.segs.filter((s) => s.hidden).length, portals: m.portals.busy };
    });
    check(mid && mid.up && mid.hidden > 0 && mid.portals === 1, `crawling out of an upright portal (foot ${mid && Math.round(mid.foot)} ft up, ${mid && mid.hidden} sections still behind it)`);
    const p = await page.evaluate(() => { const P = window.__mech.spiders.mill.portal; return [P.pos.x, P.pos.y, P.pos.z, P.normal.x, P.normal.z]; });
    await page.evaluate((p) => { window.__mech.cam.free = { pos: [p[0] + p[3] * 70 - p[4] * 50, p[1] + 12, p[2] + p[4] * 70 + p[3] * 50], look: [p[0], p[1] - 4, p[2]], fov: 60 }; }, p);
    await shot(page, 'millipede-emerging');
    await page.evaluate(() => { window.__mech.cam.free = null; });
    await advance(page, 30);
    const end = await page.evaluate(() => ({ state: window.__mech.spiders.mill.head.state, portal: !!window.__mech.spiders.mill.portal, portals: window.__mech.portals.busy }));
    check(end.state === 'perched' && !end.portal && end.portals === 0, `through and settled (${end.state}), portal closed`);
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
    await ctx.close();
  }

  await browser.close();
  process.exit(failed ? 1 : 0);
})();
