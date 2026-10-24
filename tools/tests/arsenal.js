// Frames and arsenal: every frame goes through the bay and walks, jumps and dashes, and
// every weapon in the arsenal is fired for real at the swarm and the city. Serve the repo
// root first:
//   python -m http.server 8217 --bind 127.0.0.1
//   NODE_PATH=<global node_modules with playwright> node tools/tests/arsenal.js [frames] [weapons] [<weapon id>...]
//
// Checks that each frame's armor, hardpoints and size took, that its feet stay on the
// ground and its body upright while it moves, and that each weapon fires, hits and
// cleans up after itself without errors. Prints what each one did and writes screenshots
// to tools/tests/out/ (frame-*.png, weapon-*.png).
//
// Env: as tools/tests/destruction.js (BASE_URL, CHROMIUM_ARGS, THREE_DIR, SIM=1, VIEWPORT, NOSHOT=1), and
// LITE=1 to turn shadows off and resolution down for software GL.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8217';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = (process.env.CHROMIUM_ARGS ?? (process.platform === 'win32' ? '--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist' : '')).split(' ').filter(Boolean);
const want = process.argv.slice(2);
const ARSENAL = ['railgun', 'arcCaster', 'flamer', 'blade', 'sawLauncher', 'harpoon', 'drones', 'hydra', 'singularity', 'artillery', 'mines', 'orbital'];
const runFrames = !want.length || want.includes('frames');
const weaponList = want.includes('weapons') || !want.length ? ARSENAL : want.filter((w) => ARSENAL.includes(w));

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const [VW, VH] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  if (process.env.THREE_DIR) {
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\/(.*)$/, (route) => {
      const m = route.request().url().match(/three@0\.170\.0\/(.*)$/);
      route.fulfill({ path: path.join(process.env.THREE_DIR, m[1]), contentType: 'application/javascript' });
    });
  }
  // LITE=1: no shadows and low resolution, for software GL
  if (process.env.LITE) await ctx.addInitScript(() => localStorage.setItem('vectorclad.settings', JSON.stringify({ shadows: false, hires: false })));
  const page = await ctx.newPage();
  const SIM = !!process.env.SIM;
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')));
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 120000 });
  if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 60000 });
  await page.waitForSelector('#title-start', { timeout: 60000 });
  await page.click('#title-start');
  await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 180000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
  if (SIM) await page.evaluate(() => { window.__mech.skipRender = true; window.__mech.fixedDt = 1 / 60; });
  const shot = async (name) => {
    if (process.env.NOSHOT) return;
    if (SIM) {
      await page.evaluate(() => { window.__mech.skipRender = false; window.__mech.fixedDt = 1e-6; });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 240000 });
    if (SIM) await page.evaluate(() => { window.__mech.skipRender = true; window.__mech.fixedDt = 1 / 60; });
    console.log('  shot', name);
  };
  // Game time: with SIM, wait for the simulation to get there rather than the clock
  const wait = (ms) => SIM
    ? page.evaluate((s) => new Promise((res) => { const m = window.__mech, t1 = m.time + s; const f = () => (m.time >= t1 ? res() : setTimeout(f, 20)); f(); }), ms / 1000)
    : page.waitForTimeout(ms);
  let failed = 0;
  const check = (ok, what) => { if (!ok) { failed++; console.log('  FAIL', what); } };

  // ---- frames ---------------------------------------------------------------------------
  if (runFrames) {
    for (const id of ['kestrel', 'locust', 'vanguard', 'revenant', 'goliath', 'bastion']) {
      const info = await page.evaluate(async (id) => {
        const m = window.__mech;
        m.pickFrame(id);
        if (m.mode !== 'play') m.startPlay();
        // Keep the swarm still while the frames walk
        m.spiders.clear(); m.spiders._update = m.spiders._update || m.spiders.update; m.spiders.update = () => {};
        m.redeploy();
        m.spiders.clear();
        m.P.pitch = 0.05;
        const f = m.frame, mech = m.mech;
        return { id: f.id, ap: m.P.ap, apMax: m.P.apMax, slots: f.slots.length, mounts: f.slots.filter((s) => mech.mounts[s]).length, scale: mech.rig.scale, hud: document.querySelector('.unit-name').textContent };
      }, id);
      console.log(`frame ${info.id}: ${info.apMax} AP, ${info.slots} hardpoints (${info.mounts} mounted), scale ${info.scale}, HUD ${info.hud}`);
      check(info.ap === info.apMax && info.mounts === info.slots, `${id}: armor or mounts`);
      // Walk, then dash, then jump, sampling the feet and the body
      const moves = await page.evaluate(async () => {
        const m = window.__mech, I = m.input, P = m.P, out = {};
        const sample = () => {
          const f = [m.mech.footWorld(0, new P.pos.constructor()), m.mech.footWorld(1, new P.pos.constructor())];
          return { x: P.pos.x, y: P.pos.y, z: P.pos.z, foot: Math.max(...f.map((v) => Math.abs(v.y - P.pos.y))), nan: f.some((v) => !Number.isFinite(v.x + v.y + v.z)) };
        };
        const run = (s) => new Promise((r) => { const t1 = m.time + s; const f = () => (m.time >= t1 ? r() : setTimeout(f, 20)); f(); });
        const a = sample();
        I.keys.add('KeyW'); await run(2.5);
        out.walk = Math.hypot(P.pos.x - a.x, P.pos.z - a.z) / 2.5;
        out.walkFeet = sample();
        I.keys.add('ShiftLeft'); I.edges.add('ShiftLeft'); await run(1);
        out.dash = Math.hypot(P.vel.x, P.vel.z);
        I.keys.delete('ShiftLeft'); I.keys.delete('KeyW');
        await run(1.5);
        I.edges.add('Space'); I.keys.add('Space'); await run(0.25);
        let top = 0; const y0 = P.pos.y;
        for (let i = 0; i < 20; i++) { await run(0.05); top = Math.max(top, P.pos.y - y0); }
        I.keys.delete('Space');
        out.jump = top;
        await run(3);
        out.landed = P.grounded;
        out.end = sample();
        return out;
      });
      console.log(`  walk ${moves.walk.toFixed(1)} u/s, dash ${moves.dash.toFixed(1)} u/s, jump ${moves.jump.toFixed(1)} u, feet within ${moves.walkFeet.foot.toFixed(2)} u of the ground walking`);
      check(!moves.walkFeet.nan && !moves.end.nan, `${id}: feet NaN`);
      check(moves.walk > 3 && moves.landed, `${id}: walk/land`);
      await page.evaluate(() => { const m = window.__mech; m.P.yaw += 2.4; m.P.bodyYaw = m.P.yaw; });
      await wait(400);
      await page.evaluate(() => { const m = window.__mech; m.cam.free = null; });
      await shot(`frame-${id}`);
    }
  }

  // ---- weapons ----------------------------------------------------------------------------
  // Each weapon goes on a frame that can carry it, aimed down the street at the swarm
  const where = {
    railgun: ['vanguard', 'rightHand'], arcCaster: ['vanguard', 'rightHand'], flamer: ['revenant', 'rightHand'], blade: ['revenant', 'leftHand'],
    sawLauncher: ['kestrel', 'rightHand'], harpoon: ['kestrel', 'leftHand'], drones: ['revenant', 'shoulderL'], hydra: ['vanguard', 'shoulderR'],
    singularity: ['vanguard', 'shoulderL'], artillery: ['goliath', 'shoulderL'], mines: ['locust', 'legL'], orbital: ['bastion', 'backC'],
  };
  for (const wid of weaponList) {
    const [fid, slot] = where[wid];
    const r = await page.evaluate(async ({ wid, fid, slot }) => {
      const m = window.__mech, I = m.input, P = m.P, W = m.weapons;
      const run = (s) => new Promise((res) => { const t1 = m.time + s; const f = () => (m.time >= t1 ? res() : setTimeout(f, 20)); f(); });
      m.pickFrame(fid);
      if (m.mode !== 'play') m.startPlay();
      m.redeploy();
      P.ap = 1e9;
      // Only this weapon on the frame
      const loadout = { paint: 'lynx', slots: {} };
      for (const s of m.frame.slots) loadout.slots[s] = [null, 'gunmetal'];
      loadout.slots[slot] = [wid, 'gunmetal'];
      W.equip(loadout, m.frame);
      // A pack of spiders down the street ahead
      const S = m.spiders;
      if (S._update) S.update = S._update;
      S.start(3);
      S.toSpawn = 0;
      S.clear();
      await run(0.2);
      P.yaw = P.bodyYaw; P.pitch = -0.02;
      const fwd = new P.pos.constructor(Math.sin(P.yaw), 0, Math.cos(P.yaw));
      for (let i = 0; i < 6; i++) {
        const at = P.pos.clone().addScaledVector(fwd, 45 + i * 6).add(new P.pos.constructor((i % 3 - 1) * 5, 0, 0));
        if (S.spawn) S.spawn({ point: at, normal: new P.pos.constructor(0, 1, 0), collider: null }, i % 2 ? 'weaver' : 'stalker');
      }
      const before = S.list.filter((s) => s.alive).length;
      const kills0 = S.kills;
      await run(0.3);
      // Lock on to the nearest, then pull the trigger that fires it
      I.edges.add('KeyT');
      await run(0.2);
      const s = W.slots[slot];
      const trig = slot === 'rightHand' ? 'fireR' : slot === 'leftHand' ? 'fireL' : null;
      if (s.def.kind === 'mine' || s.def.kind === 'missile') I.edges.add('KeyE');
      else if (trig) I.touch[trig] = true;
      else I.keys.add('KeyF');
      window.__release = () => { I.touch.fireR = I.touch.fireL = false; I.keys.delete('KeyF'); };
      return { before, kills0 };
    }, { wid, fid, slot });
    // The moment to look: well into the effect
    const look = { railgun: 650, arcCaster: 700, flamer: 1500, blade: 700, sawLauncher: 900, harpoon: 700, drones: 2500, hydra: 1300, singularity: 1600, artillery: 2600, mines: 1500, orbital: 2800 }[wid];
    await wait(look);
    const live = await page.evaluate(() => {
      const m = window.__mech, A = m.weapons.arsenal;
      return { rails: A.rails.length, arcs: A.arcs.length, puffs: A.puffs.length, saws: A.saws.length, hooks: A.hooks.length, drones: A.drones.length,
        orbs: A.orbs.length, wells: A.wells.length, shells: A.shells.length, mines: A.mines.length, strikes: A.strikes.length, missiles: m.weapons.missiles.length,
        slashed: Object.values(m.weapons.slots).some((s) => s.slashT > -9) };
    });
    r.live = live;
    await shot(`weapon-${wid}`);
    // Let it play out, then count the damage
    const after = await page.evaluate(async () => {
      const m = window.__mech, A = m.weapons.arsenal;
      window.__release();
      const run = (s) => new Promise((res) => { const t1 = m.time + s; const f = () => (m.time >= t1 ? res() : setTimeout(f, 20)); f(); });
      await run(4);
      const left = A.rails.length + A.arcs.length + A.puffs.length + A.saws.length + A.orbs.length + A.wells.length + A.shells.length + A.strikes.length;
      return { kills: m.spiders.kills, left, mines: A.mines.length, drones: A.drones.length, hooks: A.hooks.length };
    });
    const active = Object.entries(r.live).filter(([, v]) => v).map(([k, v]) => `${k} ${v === true ? '' : v}`).join(', ');
    console.log(`weapon ${wid} on ${fid} ${slot}: out at ${look} ms: ${active || 'nothing'}; kills ${after.kills - r.kills0} of ${r.before}; 4 s later: ${after.left} effects, ${after.mines} mines, ${after.drones} drones, ${after.hooks} hooks`);
    check(active.length > 0 || after.kills > r.kills0, `${wid}: nothing came out`);
  }

  if (errors.length) { failed += errors.length; console.log(errors.slice(0, 20).join('\n')); }
  console.log(failed ? `${failed} problem(s)` : 'all good');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
