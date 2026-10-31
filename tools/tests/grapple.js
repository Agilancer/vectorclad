// The pilot's grappling hook in the live game: it reels the pilot to a wall and stops them dead there,
// hanging, never through it; Space lets go without lighting the jetpack; a second right click drops the
// old line and fires a new one in the same press; a hook into the ground stops the pilot standing.
// Right mouse is driven with its keyboard twin, K.
// Usage: node tools/tests/grapple.js   (server: python -m http.server 8251 --directory <repo>)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8251';
const OUT = path.join(__dirname, 'out', 'grapple');
const PITCH = 0.3;   // the look angle the walls are hooked at
const ARGS = (process.env.CHROMIUM_ARGS ?? (process.platform === 'win32' ? '--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist' : '')).split(' ').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let failed = false;
  const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };
  const wait = (s) => page.waitForTimeout(s * 1000);
  const tap = async (key) => { await page.keyboard.down(key); await wait(0.06); await page.keyboard.up(key); };

  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 120000 });
  if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
  await page.waitForSelector('#title-start', { timeout: 60000 });
  await page.click('#title-start');
  await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 120000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
  await page.evaluate(() => { window.__mech.startPlay(); if (window.__mech.dismissBrief) window.__mech.dismissBrief(); });
  await page.waitForFunction(() => window.__mech.mode === 'play', null, { timeout: 60000 }).catch(() => {});
  await wait(2.5);

  // Out on foot, then watch every frame: how far in front of the hooked surface the pilot's body is
  await page.evaluate(() => {
    const m = window.__mech;
    m.pilot.exit(m.P, m.P.bodyYaw);
    window.__gr = { minFront: Infinity };
    const tick = () => {
      const h = m.pilot.hook;
      if (h && h.normal.y < 0.6) {
        const P = m.P, M = 1 / m.METERS;   // game units per meter
        const chest = { x: P.pos.x, y: P.pos.y + 1.11 * M, z: P.pos.z };
        const front = (chest.x - h.anchor.x) * h.normal.x + (chest.y - h.anchor.y) * h.normal.y + (chest.z - h.anchor.z) * h.normal.z;
        window.__gr.minFront = Math.min(window.__gr.minFront, front / M);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await wait(1.5);

  // Face building walls from where the pilot stands, aimed up over the street (clear of people and cars):
  // the yaws whose ray hits a wall 15-120 m off, as the hook would see it
  const walls = await page.evaluate((PITCH) => {
    const m = window.__mech, P = m.P, M = 1 / m.METERS, W = m.world;
    const out = [];
    for (let a = 0; a < 72; a++) {
      const yaw = (a / 72) * Math.PI * 2;
      const o = { x: P.pos.x, y: P.pos.y + 1.66 * M, z: P.pos.z };
      const d = new m.P.pos.constructor(Math.sin(yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(yaw) * Math.cos(PITCH));
      const hit = W.raycast(new m.P.pos.constructor(o.x, o.y, o.z), d, 130 * M, { props: true });
      if (hit && !hit.target && hit.normal && Math.abs(hit.normal.y) < 0.3 && hit.dist > 15 * M) out.push({ yaw, dist: hit.dist / M });
    }
    return out;
  }, PITCH);
  check(walls.length >= 2, `found walls to hook (${walls.length} directions)`);
  const aimAt = (yaw, pitch) => page.evaluate(([y, p]) => { window.__mech.P.yaw = y; window.__mech.P.pitch = p; }, [yaw, pitch]);
  const state = () => page.evaluate(() => {
    const m = window.__mech, P = m.P, h = m.pilot.hook;
    return {
      hook: !!h, hang: !!(h && h.hang), anchor: h ? [h.anchor.x, h.anchor.y, h.anchor.z] : null,
      speed: P.vel.length() * m.METERS, pos: [P.pos.x, P.pos.y, P.pos.z], grounded: P.grounded, jet: m.pilot.jet, ascending: P.ascending,
      minFront: window.__gr.minFront,
    };
  });

  // 1. Hook a wall: reeled in, then stopped dead and hanging, clear of the wall
  const A = walls[0];
  await aimAt(A.yaw, PITCH);
  await wait(0.1);
  await tap('KeyK');
  await wait(0.1);
  let s = await state();
  check(s.hook, `the hook fires at a wall ${A.dist.toFixed(0)} m off`);
  await page.waitForFunction(() => window.__mech.pilot.hook && window.__mech.pilot.hook.hang, null, { timeout: 8000 }).catch(() => {});
  s = await state();
  check(s.hang, 'the pilot arrives and hangs at the hook');
  await wait(0.8);
  const s2 = await state();
  const drift = Math.hypot(s2.pos[0] - s.pos[0], s2.pos[1] - s.pos[1], s2.pos[2] - s.pos[2]);
  check(s2.hang && s2.speed < 0.01 && drift < 0.01, `stopped dead on the wall (speed ${s2.speed.toFixed(3)} m/s, drift ${drift.toFixed(3)})`);
  check(s2.minFront > 0.3, `never passed into the wall (closest the chest came: ${s2.minFront.toFixed(2)} m in front of it)`);
  await page.screenshot({ path: path.join(OUT, 'hanging.png') });

  // 2. Right click again from the wall: the old line goes and a new one fires, in one press
  // Aim away from the wall being hung on, at something else in reach
  const B = await page.evaluate((PITCH) => {
    const m = window.__mech, P = m.P, M = 1 / m.METERS, V = P.pos.constructor;
    for (let a = 0; a < 36; a++) {
      const yaw = P.yaw + Math.PI + (a % 2 ? 1 : -1) * Math.floor((a + 1) / 2) * 0.17;
      const hit = m.world.raycast(new V(P.pos.x, P.pos.y + 1.66 * M, P.pos.z), new V(Math.sin(yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(yaw) * Math.cos(PITCH)), 130 * M, { props: true });
      if (hit && !hit.target && hit.dist > 10 * M) return { yaw };
    }
    return null;
  }, PITCH);
  check(!!B, 'something else in reach to hook from the wall');
  await aimAt(B ? B.yaw : A.yaw + Math.PI, PITCH);
  await page.evaluate(() => { window.__gr.minFront = Infinity; });
  await wait(0.1);
  await tap('KeyK');
  await wait(0.1);
  const s3 = await state();
  const moved = s3.anchor && Math.hypot(s3.anchor[0] - s2.anchor[0], s3.anchor[1] - s2.anchor[1], s3.anchor[2] - s2.anchor[2]);
  check(s3.hook && !s3.hang && moved > 1, `one right click re-fires: a new anchor ${moved ? (moved * (await page.evaluate(() => window.__mech.METERS))).toFixed(1) : '-'} m from the old one`);
  await wait(0.35);

  // 3. Space lets go mid-reel, and doesn't light the jetpack
  await tap('Space');
  await wait(0.05);
  const s4 = await state();
  check(!s4.hook, 'Space breaks the line');
  await wait(0.3);
  const s5 = await state();
  check(!s5.jet && !s5.ascending, 'that press does not light the jetpack');
  await page.waitForFunction(() => window.__mech.P.grounded, null, { timeout: 8000 }).catch(() => {});

  // 4. Hook the ground ahead: the pilot stops on it, standing
  await wait(0.5);
  await aimAt(A.yaw + Math.PI, -0.45);
  await wait(0.1);
  await tap('KeyK');
  await page.waitForFunction(() => !window.__mech.pilot.hook, null, { timeout: 8000 }).catch(() => {});
  await wait(0.1);
  const s6 = await state();
  check(!s6.hook && s6.grounded && s6.speed < 0.5, `a hook into the ground stops the pilot standing (speed ${s6.speed.toFixed(2)} m/s)`);

  check(!errors.length, `no page errors${errors.length ? ':\n' + errors.join('\n') : ''}`);
  await browser.close();
  console.log(failed ? 'FAILED' : 'all ok');
  process.exit(failed ? 1 : 0);
})();
