// Riftling packs (js/riftlings.js). Serve the repo root first:
//   python -m http.server 8233 --bind 127.0.0.1
//   NODE_PATH=<global node_modules with playwright> node tools/tests/riftlings.js [scenario...]
//
// Scenarios: packs (one pack of each color sent at a mech standing on the plaza: prints what they
// do second by second, checks they latch on, splat and hurt it, and that the Shades ran dark and
// pounced together), chain (a clump of Blasts, one shot: how many the chain takes), climb (the mech
// on a roof: checks riftlings climb the walls to reach it), swarm (wave 8's swarm of a hundred:
// how many come, frame times), all (default). Writes screenshots to tools/tests/out/riftlings-*.png.
//
// Env: BASE_URL (default http://127.0.0.1:8233), CHROMIUM_ARGS (default: the real GPU on Windows),
// THREE_DIR (a three@0.170.0 package directory to serve three.js from instead of jsDelivr, for offline runs).
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
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')));
  if (process.env.THREE_DIR) {
    await page.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\/(.*)$/, (r) => {
      const file = path.join(process.env.THREE_DIR, new URL(r.request().url()).pathname.replace('/npm/three@0.170.0/', ''));
      return fs.existsSync(file) ? r.fulfill({ path: file, contentType: 'text/javascript' }) : r.abort();
    });
  }
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 120000 });
  if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 60000 });
  await page.waitForSelector('#title-start', { timeout: 60000 });
  await page.click('#title-start');
  await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 120000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
  // Into the fight with the waves held off, so only the packs sent in come
  await page.evaluate(() => {
    const m = window.__mech;
    m.fixedDt = 1 / 30;
    // Draw only for the screenshots: the simulation runs far faster without it
    m.skipRender = true;
    m.startPlay();
    m.spiders.phase = 'off';
    // A mech that can't be killed, so they keep coming at it (regeneration tops AP up to the frame's own)
    m.frame.ap = 1e6;
    m.P.ap = 1e6;
    // Tallies of what the riftlings do, and a way to send a pack
    const R = m.spiders.rift, T = (window.__rift = { latches: 0, splats: 0, kills: 0, apLost: 0, acid: 0, shocks: 0, blasts: 0, pounces: 0, mantles: 0 });
    for (const [k, key] of [['grab', 'latches'], ['splat', 'splats'], ['kill', 'kills'], ['explode', 'blasts']]) {
      const f = R[k].bind(R);
      R[k] = (...a) => { T[key]++; return f(...a); };
    }
    // Leaps sprung on a Shade pack's signal, and climbs that ended on the mech's own roof
    const spring = R.spring.bind(R);
    R.spring = (r, tgt, t, sync) => { if (sync) T.pounces++; return spring(r, tgt, t, sync); };
    const mantle = R.mantle.bind(R);
    R.mantle = (r) => { mantle(r); if (r.state === 'run' && Math.abs(r.feet.y - m.P.pos.y) < 1.5) T.mantles++; };
    const hurt = m.spiders.playerCb.onPlayerHit;
    m.spiders.playerCb.onPlayerHit = (amount, from, kind) => { const ap = m.P.ap; hurt(amount, from, kind); T.apLost += ap - m.P.ap; };
    const acid = m.spiders.playerCb.onAcid;
    m.spiders.playerCb.onAcid = (d, p) => { T.acid++; acid(d, p); };
    const shock = m.spiders.playerCb.onShock;
    m.spiders.playerCb.onShock = (a, p) => { T.shocks++; shock(a, p); };
    window.__send = (id, n) => R.spawnPack(id, n, { player: m.P, camera: m.camera });
    window.__states = () => {
      const s = {};
      for (const r of R.list) { const k = `${r.v.id}:${r.state}`; s[k] = (s[k] || 0) + 1; }
      return s;
    };
  });
  return { ctx, page, errors };
}

/** Run game time up to secs seconds past now */
async function advance(page, secs) {
  const t = await page.evaluate((s) => window.__mech.time + s, secs);
  await page.waitForFunction((tt) => window.__mech.time >= tt, t, { timeout: 600000, polling: 50 });
}

/** Draw one frame and save the canvas (quicker and steadier than a page screenshot on a software GPU) */
async function shot(page, name) {
  const url = await page.evaluate(() => {
    const m = window.__mech;
    m.renderer.render(m.scene, m.camera);
    return m.renderer.domElement.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, `riftlings-${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
}

/** A fixed camera for a screenshot: from, at (both [x, y, z] relative to the mech's feet) */
async function frameShot(page, name, from, at, fov = 50) {
  await page.evaluate(([f, a, fv]) => {
    const m = window.__mech, p = m.P.pos;
    m.cam.free = { pos: [p.x + f[0], p.y + f[1], p.z + f[2]], look: [p.x + a[0], p.y + a[1], p.z + a[2]], fov: fv };
    m.fixedDt = 1e-6;
  }, [from, at, fov]);
  // A frame or two to move the camera there
  await page.waitForTimeout(150);
  await shot(page, name);
  await page.evaluate(() => { window.__mech.cam.free = null; window.__mech.fixedDt = 1 / 30; });
}

/** A shot of the riftling nearest the mech in one of `states`, from `back` behind it and `side` to its side */
async function riftShot(page, name, states, back, side, up) {
  const rel = await page.evaluate(([st, bk, sd, u]) => {
    const m = window.__mech, P = m.P.pos;
    const list = m.spiders.rift.list.filter((r) => r.alive && st.includes(r.state)).sort((a, b) => a.pos.distanceTo(P) - b.pos.distanceTo(P));
    const r = list[0];
    if (!r) return null;
    const f = r.fwd, at = r.pos;
    return { from: [at.x - f.x * bk - f.z * sd - P.x, at.y + u - P.y, at.z - f.z * bk + f.x * sd - P.z], at: [at.x - P.x, at.y - P.y, at.z - P.z] };
  }, [states, back, side, up]);
  if (rel) await frameShot(page, name, rel.from, rel.at, 55);
  return !!rel;
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  let failed = false;
  const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

  if (run('packs')) {
    console.log('packs');
    const { ctx, page, errors } = await boot(browser);
    await page.evaluate(() => { window.__mech.spiders.rift.wave = 3; });
    const sent = await page.evaluate(() => ['green', 'orange', 'purple', 'blue'].map((id) => [id, window.__send(id, 8)]));
    console.log('   sent', JSON.stringify(sent));
    check(sent.every(([, n]) => n > 0), 'every color found somewhere to come from');
    let darkSeen = false, latched = 0, shotLatched = false;
    for (let s = 1; s <= 30; s++) {
      await advance(page, 1);
      const st = await page.evaluate(() => {
        const R = window.__mech.spiders.rift, lockable = window.__mech.world.targets.filter((t) => t.kind === 'riftling' && !t.stealth).length;
        const shades = R.list.filter((r) => r.v.shade && r.alive);
        return { states: window.__states(), dark: shades.filter((r) => r.stealth).length, shades: shades.length, lockable, T: window.__rift, ap: Math.round(window.__mech.P.ap) };
      });
      if (st.dark && st.dark === st.shades) darkSeen = true;
      const nowLatched = Object.entries(st.states).filter(([k]) => k.endsWith(':latch')).reduce((n, [, v]) => n + v, 0);
      if (nowLatched > latched && !shotLatched && nowLatched >= 2) {
        shotLatched = true;
        await frameShot(page, 'latched', [9, 5, 9], [0, 4.4, 0], 50);
        const a = await page.evaluate(() => { const r = window.__mech.spiders.rift.list.find((x) => x.state === 'latch'); return r && [r.climbN.x, r.climbN.z, r.cling.y - window.__mech.P.pos.y]; });
        if (a) await frameShot(page, 'latched-close', [a[0] * 9 - a[1] * 3, a[2] + 1, a[1] * 9 + a[0] * 3], [a[0] * 1.5, a[2] - 1, a[1] * 1.5], 45);
      }
      latched = Math.max(latched, nowLatched);
      if (s % 3 === 0 || s < 4) console.log(`   t+${s}s`, JSON.stringify(st.states), `dark ${st.dark}/${st.shades}`, JSON.stringify(st.T));
      if (s === 3) await riftShot(page, 'running', ['run'], 6, 9, 3);
      if (s === 4) await riftShot(page, 'shades', ['stalk'], 8, 12, 6);
    }
    const T = await page.evaluate(() => window.__rift);
    check(T.latches > 0 && T.splats > 0, `riftlings latched on (${T.latches}) and splatted (${T.splats})`);
    check(T.apLost > 0, `they hurt the mech (${Math.round(T.apLost)} AP)`);
    check(T.acid > 0, `acid splats corroded it (${T.acid})`);
    check(T.shocks > 0, `spire latches drained its boost (${T.shocks})`);
    check(T.blasts > 0, `blasts went off (${T.blasts})`);
    check(darkSeen, 'the shades ran dark (no lock-on) while they closed in');
    check(T.pounces >= 3, `the shades pounced together (${T.pounces} sprang on their leader's signal)`);
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
    await ctx.close();
  }

  if (run('chain')) {
    console.log('chain');
    const { ctx, page, errors } = await boot(browser);
    await page.evaluate(() => { });
    const n = await page.evaluate(() => window.__send('orange', 9));
    // Let them muster and set off, then shoot the one nearest the middle of the clump
    await advance(page, 2.5);
    const res = await page.evaluate(() => {
      const m = window.__mech, R = m.spiders.rift, pk = R.packs[R.packs.length - 1];
      const live = pk.members.filter((r) => r.alive);
      const mid = live.reduce((b, r) => (r.feet.distanceTo(pk.center) < b.feet.distanceTo(pk.center) ? r : b), live[0]);
      const spread = Math.max(...live.map((r) => r.feet.distanceTo(pk.center)));
      m.world.damage(mid, 50, mid.pos.clone());
      return { live: live.length, spread: spread.toFixed(1), at: mid.pos.toArray() };
    });
    await advance(page, 1.5);
    const after = await page.evaluate(() => window.__rift);
    console.log(`   ${n} sent, ${res.live} in the clump (within ${res.spread} units of its middle); one shot set off ${after.blasts} blasts, ${after.kills} killed`);
    check(after.kills >= Math.min(4, res.live), `one shot took out most of the clump (${after.kills} of ${res.live})`);
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
    await ctx.close();
  }

  if (run('climb')) {
    console.log('climb');
    const { ctx, page, errors } = await boot(browser);
    // Stand the mech on a roof of middling height near the plaza
    const roof = await page.evaluate(() => {
      const m = window.__mech, S = m.spiders, P = m.P;
      const c = S.buildings.filter((b) => b.max.y > 12 && b.max.y < 30 && b.max.x - b.min.x > 14 && b.max.z - b.min.z > 14)
        .sort((a, b) => Math.hypot((a.min.x + a.max.x) / 2 - P.pos.x, (a.min.z + a.max.z) / 2 - P.pos.z) - Math.hypot((b.min.x + b.max.x) / 2 - P.pos.x, (b.min.z + b.max.z) / 2 - P.pos.z))[0];
      P.pos.set((c.min.x + c.max.x) / 2, c.max.y, (c.min.z + c.max.z) / 2);
      P.vel.set(0, 0, 0);
      m.mech.root.position.copy(P.pos);
      m.mech.resetFeet();
      return { y: c.max.y.toFixed(1) };
    });
    await advance(page, 1);
    await page.evaluate(() => { window.__mech.spiders.rift.wave = 3; window.__send('green', 10); window.__send('blue', 6); });
    let climbed = 0;
    for (let s = 1; s <= 30; s++) {
      await advance(page, 1);
      const st = await page.evaluate(() => ({ states: window.__states(), T: window.__rift }));
      climbed = Math.max(climbed, Object.entries(st.states).filter(([k]) => k.endsWith(':climb')).reduce((n, [, v]) => n + v, 0));
      if (climbed && s > 3 && !(await page.evaluate(() => window.__climbShot))) {
        const at = await page.evaluate(() => { const r = window.__mech.spiders.rift.list.find((x) => x.state === 'climb'); if (!r) return null; window.__climbShot = 1; const p = window.__mech.P.pos; return [r.cling.x - p.x, r.cling.y - p.y, r.cling.z - p.z, r.climbN.x, r.climbN.z]; });
        if (at) await frameShot(page, 'climbing', [at[0] + at[3] * 14 + at[4] * 6, at[1] + 2, at[2] + at[4] * 14 - at[3] * 6], [at[0], at[1] - 2, at[2]], 55);
      }
      if (s % 5 === 0) console.log(`   t+${s}s`, JSON.stringify(st.states), JSON.stringify(st.T));
    }
    const T = await page.evaluate(() => window.__rift);
    console.log(`   roof at ${roof.y} units`);
    check(climbed > 0, `riftlings climbed the walls (${climbed} at once)`);
    check(T.mantles > 0, `and pulled themselves up onto the mech's roof (${T.mantles})`);
    check(T.latches > 0, `and got onto the mech up there (${T.latches} latched)`);
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
    await ctx.close();
  }

  if (run('swarm')) {
    console.log('swarm');
    const { ctx, page, errors } = await boot(browser);
    await page.evaluate(() => {
      const m = window.__mech;
      // Wave 8's swarm, without its spiders
      m.spiders.rift.startWave(8, false);
      m.spiders.phase = 'active';
      m.spiders.toSpawn = 0;
      m.spiders.wave = 8;
      m.spiders.maxAlive = 0;
    });
    let most = 0;
    const times = [];
    for (let s = 1; s <= 40; s++) {
      await advance(page, 1);
      const st = await page.evaluate(() => {
        const R = window.__mech.spiders.rift, t0 = performance.now();
        R.update(1 / 60, { player: window.__mech.P, camera: window.__mech.camera });
        return { alive: R.alive, budget: R.budget, packs: R.packs.length, ms: performance.now() - t0 };
      });
      most = Math.max(most, st.alive);
      times.push(st.ms);
      if (s % 5 === 0) console.log(`   t+${s}s alive ${st.alive}, still to come ${st.budget}, packs ${st.packs}, update ${st.ms.toFixed(2)} ms`);
      if (s === 14) await frameShot(page, 'swarm', [0, 24, -18], [0, 0, 30], 65);
    }
    const T = await page.evaluate(() => window.__rift);
    times.sort((a, b) => a - b);
    console.log(`   median update ${times[times.length >> 1].toFixed(2)} ms; ${JSON.stringify(T)}`);
    check(most >= 60, `a big swarm came (${most} alive at once, of 100)`);
    check(!errors.length, `no page errors${errors.length ? '\n' + errors.join('\n') : ''}`);
    await ctx.close();
  }

  await browser.close();
  if (failed) process.exitCode = 1;
})();
