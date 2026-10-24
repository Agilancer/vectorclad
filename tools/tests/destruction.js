// Destruction soak and screenshots (js/destruct). Serve the repo root first:
//   python -m http.server 8217 --bind 127.0.0.1
//   NODE_PATH=<global node_modules with playwright> node tools/tests/destruction.js [scenario...]
//
// Scenarios: holes (bullets and blasts in a mid-rise), cut (a beam slot cut a little past
// halfway through a tower: it must tip toward the cut), crush (a storey shot out), props
// (water tower legs, lamps, trees), needle (missiles into one side of the observation
// needle's base: it must lean and fall that way like a tree), row (the ground storey of a
// building flush between two others shot out: it must drop straight down between them),
// corner (bazookas into a building's street corner: the corner above breaks away), all
// (default). Prints timings and structure counts and writes screenshots to tools/tests/out/.
//
// Env: BASE_URL (default http://127.0.0.1:8217), CHROMIUM_ARGS (default: the real GPU on Windows),
// THREE_DIR (a local copy of the three@0.170.0 npm package, served in place of the CDN: for
// machines that can't reach it), SIM=1 (no rendering between screenshots, fixed 1/60 s steps:
// game time runs as fast as the simulation, for software GL), VIEWPORT (default 1280x720),
// NOSHOT=1 (no screenshots: the numbers only, where a frame takes minutes to draw).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8217';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = (process.env.CHROMIUM_ARGS ?? (process.platform === 'win32' ? '--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist' : '')).split(' ').filter(Boolean);
const want = process.argv.slice(2);
const run = (name) => !want.length || want.includes(name) || want.includes('all');

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
  const page = await ctx.newPage();
  const SIM = !!process.env.SIM;
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); else if (/destruct/i.test(m.text())) console.log('  page:', m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')));
  await page.goto(BASE + '/index.html');
  // The boot screen loads the title theme first and may ask for a click to start audio
  await page.waitForFunction(() => !document.querySelector('#boot') || !document.querySelector('#boot-start').hidden, null, { timeout: 120000 });
  if (await page.$('#boot-start:not([hidden])')) await page.click('#boot-start');
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 60000 });
  await page.waitForSelector('#title-start', { timeout: 60000 });
  await page.click('#title-start');
  await page.waitForFunction(() => window.__mech && window.__mech.mode === 'intro', null, { timeout: 120000 }).catch((e) => { console.log(errors.join('\n')); throw e; });
  await page.evaluate((soak) => {
    const m = window.__mech;
    m.startPlay();
    m.P.ap = 1e9;
    // Keep the swarm away so the scenes stay readable (the soak keeps it)
    if (!soak) { m.spiders.clear(); m.spiders.update = () => {}; }
    document.querySelector('#hud').style.visibility = 'hidden';
  }, want.includes('soak'));
  if (SIM) await page.evaluate(() => { window.__mech.skipRender = true; window.__mech.fixedDt = 1 / 60; });
  const shot = async (name) => {
    if (process.env.NOSHOT) return;
    if (SIM) {
      await page.evaluate(() => { window.__mech.skipRender = false; window.__mech.fixedDt = 1e-6; });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
    if (SIM) await page.evaluate(() => { window.__mech.skipRender = true; window.__mech.fixedDt = 1 / 60; });
    console.log('  shot', name);
  };
  // Game time: with SIM, wait for the simulation to get there rather than the clock
  const wait = (ms) => SIM
    ? page.evaluate((s) => new Promise((res) => { const D = window.__mech.destruct, t1 = D.time + s; const f = () => (D.time >= t1 ? res() : setTimeout(f, 20)); f(); }), ms / 1000)
    : page.waitForTimeout(ms);
  const info = () => page.evaluate(() => window.__mech.destruct.info());

  // Helpers in the page: pick buildings near the plaza, point the camera, cut with a beam
  await page.evaluate(async () => { window.WEAPONS = (await import(new URL('js/weapons.js', document.baseURI).href)).WEAPONS; });
  await page.evaluate(() => {
    const m = window.__mech, D = m.destruct, W = m.world, M = D.M, V = m.P.pos.constructor;
    window.T = {
      near(kind, minH, maxH, r = 400) {
        const p = m.P.pos;
        return D.city.owners.filter((o) => o.kind === kind && o.box && o.box[4] - o.box[1] > minH * M && o.box[4] - o.box[1] < maxH * M
          && Math.hypot((o.box[0] + o.box[3]) / 2 - p.x, (o.box[2] + o.box[5]) / 2 - p.z) < r)
          .sort((a, b) => Math.hypot((a.box[0] + a.box[3]) / 2 - p.x, (a.box[2] + a.box[5]) / 2 - p.z) - Math.hypot((b.box[0] + b.box[3]) / 2 - p.x, (b.box[2] + b.box[5]) / 2 - p.z));
      },
      /** The side of o open to the street: [dx, dz] pointing out of it */
      side(o) {
        const B = o.box, cx = (B[0] + B[3]) / 2, cz = (B[2] + B[5]) / 2, y = B[1] + (B[4] - B[1]) * 0.3;
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const from = new V(dx ? (dx > 0 ? B[3] : B[0]) + dx * 30 : cx, y, dz ? (dz > 0 ? B[5] : B[2]) + dz * 30 : cz);
          const h = W.raycast(from, new V(-dx, 0, -dz), 60, { props: true });
          if (h && ((h.collider && h.collider.owner === o) || (h.struct && h.struct.owner === o))) return [dx, dz];
        }
        return [0, 1];
      },
      /** Camera out from o's open face: dist and side in building heights, up as a fraction of it */
      look(o, dist = 1, up = 0.5, side = 0.5) {
        const B = o.box, c = [(B[0] + B[3]) / 2, (B[1] + B[4]) / 2, (B[2] + B[5]) / 2], H = Math.max(B[4] - B[1], B[3] - B[0], B[5] - B[2]);
        const [dx, dz] = o.face || (o.face = T.side(o));
        const ax = dz, az = -dx; // across the face
        m.cam.free = { pos: [c[0] + dx * H * dist + ax * H * side, B[1] + H * up, c[2] + dz * H * dist + az * H * side], look: [c[0], B[1] + (B[4] - B[1]) * 0.4, c[2]], fov: 55 };
      },
      activate(o) { const t = performance.now(); const s = D.activate(o); return { ms: performance.now() - t, dims: s && [s.g.nx, s.g.ny, s.g.nz], cells: s && s.count, cell: s && s.cellSize / M }; },
      /** Fire n rounds at the face of o from in front (+z side) spread over a box of the face */
      shoot(o, n, opts) {
        const B = o.box, [dx, dz] = o.face || (o.face = T.side(o)), dir = new V(-dx, 0, -dz);
        let hits = 0;
        for (let i = 0; i < n; i++) {
          const f = 0.2 + Math.random() * 0.6, y = B[1] + (B[4] - B[1]) * (0.1 + Math.random() * 0.5);
          const from = new V(dx ? (dx > 0 ? B[3] : B[0]) + dx * 20 : B[0] + (B[3] - B[0]) * f, y, dz ? (dz > 0 ? B[5] : B[2]) + dz * 20 : B[2] + (B[5] - B[2]) * f);
          const h = W.raycast(from, dir, 60, { props: true });
          if (h && !h.target) { D.bullet(h, Object.assign({ dir }, opts)); hits++; }
        }
        return hits;
      },
      /** A beam slot through o at height frac, from the +z face, depth fraction of its depth */
      cut(o, frac, depth, beamR = 1.4) {
        const B = o.box, y = B[1] + (B[4] - B[1]) * frac, [dx, dz] = o.face || (o.face = T.side(o));
        const s = D.activate(o);
        const R = beamR * M;
        // u: into the building from the open face, w: across it
        const alongX = dx !== 0, d0 = alongX ? (dx > 0 ? B[3] : B[0]) : (dz > 0 ? B[5] : B[2]), span = alongX ? B[3] - B[0] : B[5] - B[2];
        const w0 = alongX ? B[2] : B[0], w1 = alongX ? B[5] : B[3], sgn = -(dx || dz);
        for (let u = 0; u <= span * depth; u += R * 0.5) for (let w = w0 - R; w <= w1 + R; w += R * 0.5) {
          const p = d0 + sgn * u;
          D.damageSphere(s, alongX ? p : w, y, alongX ? w : p, R, 9999, { chunks: 1 });
        }
        return s.count;
      },
      blast(x, y, z, r, p) { return D.blast(new V(x, y, z), r, p); },
      /** A real weapon's explosion (weapons.js: its crater size, splash and fx) */
      explode(x, y, z, kind, nx = 0, ny = 0, nz = 0) { return m.weapons.explode(new V(x, y, z), window.WEAPONS[kind], 1.2, nx || ny || nz ? new V(nx, ny, nz) : null); },
      bodies() {
        return D.physics.bodies.filter((b) => b.cells > 50).map((b) => ({
          cells: b.cells, y: +b.x.y.toFixed(1), v: +b.v.length().toFixed(2), w: +b.w.length().toFixed(2), sleep: b.sleeping,
          tilt: +(Math.acos(Math.min(1, Math.abs(b.R[4]))) * 57.3).toFixed(1), lean: [+b.R[1].toFixed(2), +b.R[7].toFixed(2)],
          hinge: b.hinge ? +(b.hinge.ang * 57.3).toFixed(1) : undefined,
          dark: b.s.power.U.uPow.value.x >= 0 ? 'cut' : 'lit',
        }));
      },
      /** The structure of owner o: cells left and the top of what still stands (m) */
      left(o) {
        const s = o.struct;
        if (!s || s.dead) return { dead: true };
        const g = s.g;
        for (let y = g.ny - 1; y >= 0; y--) for (let c = 0; c < g.nxz; c++) if (g.mat[c + g.nxz * y] >= 3) return { count: s.count, top: +(g.ys[y + 1] / M).toFixed(1) };
        return { count: 0 };
      },
    };
  });

  if (run('holes')) {
    console.log('holes: bullets, bolts and a bazooka blast in a mid-rise');
    const r = await page.evaluate(() => {
      const o = T.near('building', 20, 60)[0];
      const a = T.activate(o);
      T.look(o, 0.9, 0.5, 0.35);
      const t = performance.now();
      const mg = T.shoot(o, 60, { radius: 0.86, power: 81, speed: 7, chunks: 3 });
      const bolts = T.shoot(o, 8, { radius: 1.45, power: 150, speed: 9, chunks: 8 });
      const B = o.box;
      T.blast((B[0] + B[3]) / 2, B[1] + (B[4] - B[1]) * 0.3, B[5], 4.6, 324);
      return { a, mg, bolts, ms: performance.now() - t, owner: o.id };
    });
    console.log('  ', JSON.stringify(r));
    await wait(1500);
    await shot('destruct_holes');
    console.log('  ', JSON.stringify(await info()));
  }

  if (run('cut')) {
    console.log('cut: a slot a little past halfway through a tower');
    const r = await page.evaluate(() => {
      const o = T.near('building', 70, 200, 900)[0] || T.near('tower', 70, 400, 900)[0];
      const a = T.activate(o);
      T.look(o, 1.15, 0.85, 0.55);
      const left = T.cut(o, 0.35, 0.6);
      return { a, left, kind: o.kind, h: (o.box[4] - o.box[1]) / window.__mech.destruct.M, face: o.face };
    });
    console.log('  ', JSON.stringify(r));
    for (let k = 0; k < 10; k++) {
      await wait(1300);
      await shot(`destruct_cut_${k}`);
      console.log('   bodies', JSON.stringify(await page.evaluate(() => T.bodies().slice(0, 6))));
    }
    console.log('  ', JSON.stringify(await info()));
    console.log('   fractures', JSON.stringify(await page.evaluate(() => window.__mech.destruct.log.slice(0, 12))));
  }

  if (run('crush')) {
    console.log('crush: a storey shot out of a prewar block');
    const r = await page.evaluate(() => {
      const list = T.near('building', 55, 140, 900);
      const o = list[Math.min(2, list.length - 1)];
      const a = T.activate(o);
      T.look(o, 1.1, 0.6, -0.5);
      // Clear a storey halfway up, through and through
      const left = T.cut(o, 0.45, 1.0, 1.6);
      return { a, left };
    });
    console.log('  ', JSON.stringify(r));
    for (let k = 0; k < 6; k++) { await wait(1200); await shot(`destruct_crush_${k}`); console.log('   bodies', JSON.stringify(await page.evaluate(() => T.bodies().slice(0, 4)))); }
    console.log('  ', JSON.stringify(await info()));
  }

  if (run('props')) {
    console.log('props: blasts at lamps and signals');
    const r = await page.evaluate(() => {
      const lamps = T.near('lamp', 0, 20, 300).slice(0, 3), signals = T.near('signal', 0, 20, 300).slice(0, 2);
      for (const o of lamps.concat(signals)) { const B = o.box; T.blast((B[0] + B[3]) / 2, B[1] + 1, (B[2] + B[5]) / 2, 1.6, 200); }
      if (lamps[0]) T.look(lamps[0], 3, 1.2, 1);
      const D = window.__mech.destruct;
      return { lamps: lamps.length, signals: signals.length, pieces: D.physics.bodies.length };
    });
    console.log('  ', JSON.stringify(r));
    await wait(2500);
    await shot('destruct_props');
  }

  if (run('needle')) {
    console.log('needle: heavy missiles into the south side of the needle just above its lobby; it must fall south');
    const r = await page.evaluate(() => {
      const m = window.__mech, D = m.destruct, M = D.M;
      const o = D.city.owners.find((q) => q.kind === 'needle'), B = o.box, cx = (B[0] + B[3]) / 2, cz = (B[2] + B[5]) / 2;
      window.Ndl = { o, cx, cz };
      m.cam.free = { pos: [cx + 420 * M, 140 * M, cz + 120 * M], look: [cx, 110 * M, cz + 110 * M], fov: 60 };
      const s = D.activate(o), y = 13 * M, rr = 11.4 * M;
      for (const [dx, dy] of [[0, 0], [-4, 0], [4, 0], [-8, 2], [8, 2], [0, 4], [-4, 6], [4, 6]]) {
        const a = Math.PI / 2 + (dx * M) / rr;
        T.explode(cx + Math.cos(a) * rr, y + dy * M, cz + Math.sin(a) * rr, 'heavyPod', Math.cos(a), 0, Math.sin(a));
      }
      return { cells: s.count };
    });
    console.log('  ', JSON.stringify(r));
    for (let k = 0; k < 8; k++) {
      await wait(2000);
      await shot(`destruct_needle_${k}`);
      console.log('   ', JSON.stringify(await page.evaluate(() => {
        const D = window.__mech.destruct, M = D.M, b = D.physics.bodies.filter((q) => q.cells > 2000).sort((p, q) => q.cells - p.cells)[0];
        // Where the biggest piece's center has gone, from the needle's axis (m): south is +z
        return { left: T.left(Ndl.o), big: b && { cells: b.cells, dx: +((b.x.x - Ndl.cx) / M).toFixed(1), y: +(b.x.y / M).toFixed(1), dz: +((b.x.z - Ndl.cz) / M).toFixed(1), hinge: b.hinge ? +(b.hinge.ang * 57.3).toFixed(1) : null }, hinges: D.stats.hinges, breaks: D.stats.hingeBreaks };
      })));
    }
    console.log('  ', JSON.stringify(await info()));
  }

  if (run('row')) {
    console.log('row: the ground storey of a building flush between two others shot out; it must drop between them');
    const r = await page.evaluate(() => {
      const m = window.__mech, D = m.destruct, M = D.M, p = m.P.pos;
      const bl = D.city.owners.filter((o) => o.kind === 'building' && o.box && o.box[4] - o.box[1] > 25 * M && o.box[4] - o.box[1] < 60 * M)
        .sort((a, b) => Math.hypot(a.box[0] - p.x, a.box[2] - p.z) - Math.hypot(b.box[0] - p.x, b.box[2] - p.z));
      const along = (a, b) => Math.min(a.box[5], b.box[5]) - Math.max(a.box[2], b.box[2]) > 5 * M && b.box[4] > a.box[4] * 0.6;
      const o = bl.slice(0, 300).find((a) => bl.some((b) => b !== a && Math.abs(b.box[3] - a.box[0]) < 1e-3 * M && along(a, b)) && bl.some((b) => b !== a && Math.abs(b.box[0] - a.box[3]) < 1e-3 * M && along(a, b)));
      window.Row = { o };
      const s = D.activate(o), B = o.box;
      m.cam.free = { pos: [(B[0] + B[3]) / 2 + 10 * M, B[4] * 0.6, B[5] + (B[4] - B[1]) * 1.4], look: [(B[0] + B[3]) / 2, (B[4] - B[1]) * 0.4, (B[2] + B[5]) / 2], fov: 55 };
      for (let x = B[0]; x <= B[3]; x += 0.5 * M) for (let z = B[2]; z <= B[5]; z += 0.5 * M) for (let y = 2.2 * M; y < 6 * M; y += 0.6 * M) D.damageSphere(s, x, y, z, 0.6 * M, 9999, { chunks: 0 });
      return { h: +((B[4] - B[1]) / M).toFixed(1), w: +((B[3] - B[0]) / M).toFixed(1) };
    });
    console.log('  ', JSON.stringify(r));
    for (let k = 0; k < 6; k++) { await wait(1000); await shot(`destruct_row_${k}`); console.log('   ', JSON.stringify(await page.evaluate(() => ({ left: T.left(Row.o), bodies: T.bodies().slice(0, 3) })))); }
  }

  if (run('corner')) {
    console.log('corner: bazookas into the base of a building\'s street corner; the corner above breaks away');
    const r = await page.evaluate(() => {
      const m = window.__mech, D = m.destruct, M = D.M;
      const o = T.near('building', 30, 80, 600).find((q) => (q.box[3] - q.box[0]) > 20 * M && (q.box[5] - q.box[2]) > 20 * M);
      window.Cor = { o };
      const s = D.activate(o), B = o.box, x = B[3], z = B[5];
      m.cam.free = { pos: [x + 45 * M, (B[4] - B[1]) * 0.55, z + 55 * M], look: [x - 5 * M, (B[4] - B[1]) * 0.35, z - 5 * M], fov: 55 };
      for (const [dx, dz, h] of [[-3, 0, 3], [0, -3, 3], [-9, 0, 4], [0, -9, 4], [-4, 0, 9], [0, -4, 9]]) T.explode(x + dx * M, h * M, z + dz * M, 'bazooka', dz ? 1 : 0, 0, dx ? 1 : 0);
      return { h: +((B[4] - B[1]) / M).toFixed(1), cells: s.count };
    });
    console.log('  ', JSON.stringify(r));
    for (let k = 0; k < 5; k++) { await wait(1000); await shot(`destruct_corner_${k}`); console.log('   ', JSON.stringify(await page.evaluate(() => ({ left: T.left(Cor.o), bodies: T.bodies().slice(0, 3), chunks: window.__mech.destruct.stats.chunks })))); }
  }

  if (run('play')) {
    console.log('play: the mech sweeps a mega beam, rifle and vulcans across a tower (real weapons, input held)');
    const r = await page.evaluate(() => {
      const m = window.__mech;
      document.querySelector('#hud').style.visibility = 'visible';
      m.cam.free = null;
      m.weapons.equip({ paint: 'glint', slots: { rightHand: ['beamRifle', 'white'], leftHand: ['beamCannon', 'white'], shoulderL: ['vulcanPod', 'white'], shoulderR: ['vulcanPod', 'white'], legL: [null, 'white'], legR: [null, 'white'] } });
      const o = T.near('building', 60, 200, 500)[0] || T.near('tower', 60, 400, 500)[0];
      const B = o.box, cx = (B[0] + B[3]) / 2, cz = (B[2] + B[5]) / 2, P = m.P;
      window.Tgt = { cx, cz, yaw: Math.atan2(cx - P.pos.x, cz - P.pos.z) };
      P.yaw = P.bodyYaw = Tgt.yaw;
      P.pitch = 0.12;
      m.input.lockFailed = true; // let held keys count without pointer lock
      return { owner: o.id, kind: o.kind, dist: +Math.hypot(cx - P.pos.x, cz - P.pos.z).toFixed(1) };
    });
    console.log('  ', JSON.stringify(r));
    const hold = (code, on) => page.evaluate(([c, v]) => { const k = window.__mech.input.keys; if (v) k.add(c); else k.delete(c); }, [code, on]);
    const sweep = (t) => page.evaluate((t) => { const P = window.__mech.P; P.yaw = Tgt.yaw + Math.sin(t * 1.3) * 0.22; P.pitch = 0.1 + Math.sin(t * 0.7) * 0.05; }, t);
    await hold('KeyK', true); await hold('KeyJ', true); await hold('KeyF', true);
    for (let k = 0; k < 40; k++) { await sweep(k * 0.25); await wait(250); if (k % 10 === 5) await shot(`destruct_play_${k}`); }
    await hold('KeyK', false); await hold('KeyJ', false); await hold('KeyF', false);
    await wait(2500);
    await shot('destruct_play_end');
    // Close up on the cut
    await page.evaluate(() => {
      const m = window.__mech, P = m.P, d = Math.hypot(Tgt.cx - P.pos.x, Tgt.cz - P.pos.z), y = P.pos.y + 6.5 + d * 0.6 * Math.tan(0.1);
      const fx = Math.sin(Tgt.yaw), fz = Math.cos(Tgt.yaw);
      m.cam.free = { pos: [P.pos.x + fx * d * 0.45 - fz * 6, y + 3, P.pos.z + fz * d * 0.45 + fx * 6], look: [P.pos.x + fx * d, y, P.pos.z + fz * d], fov: 50 };
      document.querySelector('#hud').style.visibility = 'hidden';
    });
    await wait(400);
    await shot('destruct_play_close');
    console.log('  ', JSON.stringify(await info()));
  }

  if (run('walk')) {
    console.log('walk: blast a doorway into a building and walk the mech in');
    const r = await page.evaluate(() => {
      const m = window.__mech, D = m.destruct, P = m.P, M = D.M, V = P.pos.constructor;
      const o = T.near('building', 25, 90, 400).find((q) => (q.box[3] - q.box[0]) > 18 * M && (q.box[5] - q.box[2]) > 18 * M);
      const B = o.box, [dx, dz] = o.face || (o.face = T.side(o));
      const cx = (B[0] + B[3]) / 2, cz = (B[2] + B[5]) / 2;
      const fx = dx ? (dx > 0 ? B[3] : B[0]) : cx, fz = dz ? (dz > 0 ? B[5] : B[2]) : cz;
      // A doorway the mech fits through: 8 m wide, 15 m tall, 10 m deep
      const s = D.activate(o);
      for (let u = 0; u < 10 * M; u += 0.5 * M) for (let w = -4 * M; w <= 4 * M; w += 0.5 * M) for (let h = 0.5 * M; h < 15 * M; h += 0.5 * M) {
        D.damageSphere(s, fx - dx * u + (dz ? w : 0), h, fz - dz * u + (dx ? w : 0), 0.6 * M, 9999, { chunks: 0 });
      }
      P.pos.set(fx + dx * 12, 0, fz + dz * 12);
      P.vel.set(0, 0, 0);
      P.yaw = P.bodyYaw = Math.atan2(-dx, -dz);
      P.pitch = 0.05;
      m.cam.free = null;
      document.querySelector('#hud').style.visibility = 'hidden';
      m.input.lockFailed = true;
      window.Walk = { fx, fz, dx, dz };
      return { start: [+P.pos.x.toFixed(1), +P.pos.z.toFixed(1)], face: [dx, dz] };
    });
    console.log('  ', JSON.stringify(r));
    await page.evaluate(() => window.__mech.input.keys.add('KeyW'));
    await wait(3500);
    await page.evaluate(() => window.__mech.input.keys.delete('KeyW'));
    await wait(500);
    const e = await page.evaluate(() => { const P = window.__mech.P; return { pos: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(2), +P.pos.z.toFixed(1)], inside: +(((P.pos.x - Walk.fx) * -Walk.dx + (P.pos.z - Walk.fz) * -Walk.dz) / window.__mech.destruct.M).toFixed(1) }; });
    console.log('   end', JSON.stringify(e), '(inside: meters past the facade)');
    await shot('destruct_walk');
  }

  if (run('ceilings')) {
    console.log('ceilings: facades peeled off a few floors of buildings of different themes; then a blast inside, then a piece cut loose');
    const r = await page.evaluate(async () => {
      const m = window.__mech, D = m.destruct, M = D.M;
      const C = await import(new URL('js/destruct/ceilings.js', document.baseURI).href);
      // One building of each theme near the plaza, tall enough for a few floors
      const seen = new Set(), picks = [];
      for (const o of T.near('building', 22, 120, 700)) {
        if ((o.box[3] - o.box[0]) < 16 * M || (o.box[5] - o.box[2]) < 16 * M) continue;
        const name = C.houseStyle(o).name;
        if (seen.has(name)) continue;
        seen.add(name); picks.push({ o, name });
      }
      window.Ceil = { picks };
      return picks.map((p) => p.name);
    });
    console.log('  ', JSON.stringify(r));
    const peel = (k) => page.evaluate((k) => {
      const m = window.__mech, D = m.destruct, M = D.M, { o } = Ceil.picks[k];
      const s = D.activate(o), B = o.box, [dx, dz] = o.face || (o.face = T.side(o));
      const cx = (B[0] + B[3]) / 2, cz = (B[2] + B[5]) / 2;
      const fx = dx ? (dx > 0 ? B[3] : B[0]) : cx, fz = dz ? (dz > 0 ? B[5] : B[2]) : cz;
      const W = Math.min(22 * M, (dx ? B[5] - B[2] : B[3] - B[0]) * 0.8);
      // The facade only, 1.3 m deep, from 5 m to 21 m up: the rooms behind it stay whole
      for (let u = 0; u < 1.3 * M; u += 0.4 * M) for (let w = -W / 2; w <= W / 2; w += 0.4 * M) for (let h = 5 * M; h < 21 * M; h += 0.4 * M) {
        D.damageSphere(s, fx - dx * u + (dz ? w : 0), h, fz - dz * u + (dx ? w : 0), 0.45 * M, 9999, { chunks: 0 });
      }
      // (the peeling isn't a hit: its jolt doesn't count against the lights)
      D.jolts();
      s.power.U.uOut.value.forEach((v) => v.set(0, 0, 0, 0));
      s.power.U.uPow.value.set(-1, -99, 0, 1);
      // From across the street, low, looking up into it
      m.cam.free = { pos: [fx + dx * 16 * M + dz * 3 * M, 3 * M, fz + dz * 16 * M + dx * 3 * M], look: [fx - dx * 6 * M, 15 * M, fz - dz * 6 * M], fov: 60 };
      window.Ceil.cur = { s, fx, fz, dx, dz };
      return { name: Ceil.picks[k].name, cells: s.count };
    }, k);
    for (let k = 0; k < Math.min(r.length, +(process.env.CEIL_N || 9)); k++) {
      console.log('   peel', JSON.stringify(await peel(k)));
      await wait(600);
      await shot(`ceilings_${k}_${r[k]}`);
      // Close, a storey up, looking in under a ceiling
      if (k === 0) {
        await page.evaluate(() => { const m = window.__mech, M = m.destruct.M, { fx, fz, dx, dz } = Ceil.cur; m.cam.free = { pos: [fx + dx * 4 * M, 12 * M, fz + dz * 4 * M], look: [fx - dx * 12 * M + dz * 4 * M, 14.5 * M, fz - dz * 12 * M + dx * 4 * M], fov: 70 }; });
        await wait(100);
        await shot(`ceilings_${k}_${r[k]}_close`);
      }
    }
    // A blast in the last one's rooms: flicker and an outage round it
    await page.evaluate(() => {
      const { s, fx, fz, dx, dz } = Ceil.cur, M = window.__mech.destruct.M;
      T.explode(fx - dx * 5 * M, 11 * M, fz - dz * 5 * M, 'bazooka');
    });
    await wait(250); await shot('ceilings_blast_0.25s');
    await wait(1500); await shot('ceilings_blast_1.75s');
    console.log('   power', JSON.stringify(await page.evaluate(() => { const P = Ceil.cur.s.power.U; return { pow: P.uPow.value.toArray().map((v) => +v.toFixed(2)), out: P.uOut.value.filter((v) => v.w > 0).length }; })));
    // Sliced through just over the opened floors: what breaks away loses its supply and goes dark
    await page.evaluate(() => {
      const M = window.__mech.destruct.M, k = Ceil.picks.findIndex((p) => p.o.struct === Ceil.cur.s);
      const B = Ceil.picks[k].o.box;
      T.cut(Ceil.picks[k].o, (23 * M - B[1]) / (B[4] - B[1]), 1.0, 1.2);
    });
    for (let k = 0; k < 3; k++) {
      await wait(500 + k * 400);
      await shot(`ceilings_cut_${k}`);
      console.log('   pieces', JSON.stringify(await page.evaluate(() => window.__mech.destruct.physics.bodies.filter((b) => b.cells > 200).map((b) => ({ cells: b.cells, cutAt: +b.s.power.U.uPow.value.x.toFixed(2) })).slice(0, 4))), 'time', await page.evaluate(() => +window.__mech.destruct.time.toFixed(2)));
    }
  }

  if (run('el')) {
    console.log('el: knock out two bents of the elevated railway');
    const r = await page.evaluate(() => {
      const m = window.__mech, D = m.destruct, M = D.M;
      const el = D.city.owners.find((o) => o.kind === 'el');
      const t = performance.now(), s = D.activate(el), ms = performance.now() - t;
      // Bents: the steel columns standing on the street; take the two nearest the plaza
      const cols = el.vols.filter((v) => v.t === 'solid' && v.y0 === 0).sort((a, b) => Math.abs((a.z0 + a.z1) / 2 - m.P.pos.z) - Math.abs((b.z0 + b.z1) / 2 - m.P.pos.z));
      const zs = [...new Set(cols.map((v) => Math.round((v.z0 + v.z1) / 2)))].slice(0, 2);
      let n = 0;
      for (const v of cols) if (zs.includes(Math.round((v.z0 + v.z1) / 2))) { n++; for (let y = 1; y < 8 * M; y += 0.5 * M) D.damageSphere(s, (v.x0 + v.x1) / 2, y, (v.z0 + v.z1) / 2, 1.2 * M, 9999, { chunks: 2 }); }
      const v0 = cols[0];
      m.cam.free = { pos: [(v0.x0 + v0.x1) / 2 + 40, 22, (v0.z0 + v0.z1) / 2 + 25], look: [(v0.x0 + v0.x1) / 2, 6, (v0.z0 + v0.z1) / 2], fov: 55 };
      return { ms: +ms.toFixed(1), dims: [s.g.nx, s.g.ny, s.g.nz], cell: +(s.cellSize / M).toFixed(2), columns: n };
    });
    console.log('  ', JSON.stringify(r));
    for (let k = 0; k < 3; k++) { await wait(1300); await shot(`destruct_el_${k}`); }
    console.log('   bodies', JSON.stringify(await page.evaluate(() => T.bodies().slice(0, 5))));
  }

  if (run('giants')) {
    console.log('giants: activation cost of the biggest owners');
    const r = await page.evaluate(() => {
      const D = window.__mech.destruct, out = [];
      const big = D.city.owners.filter((o) => o.box).map((o) => ({ o, v: (o.box[3] - o.box[0]) * (o.box[4] - o.box[1]) * (o.box[5] - o.box[2]) })).sort((a, b) => b.v - a.v).slice(0, 6);
      for (const { o } of big) {
        const t = performance.now(), s = D.activate(o);
        out.push({ kind: o.kind, ms: +(performance.now() - t).toFixed(1), cells: s && s.g.N, solid: s && s.count, cell: s && +(s.cellSize / D.M).toFixed(2) });
      }
      return out;
    });
    for (const x of r) console.log('  ', JSON.stringify(x));
    // First frame after: shader compiles for the new skins
    const t = Date.now();
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    console.log('   two frames after activation', Date.now() - t, 'ms');
  }

  if (want.includes('soak')) {
    console.log('soak: artillery loadout firing everything, spiders live, mech walking in, 50 s');
    await page.evaluate(() => {
      const m = window.__mech;
      document.querySelector('#hud').style.visibility = 'visible';
      m.cam.free = null;
      m.weapons.equip({ paint: 'steel', slots: { rightHand: ['bazooka', 'gunmetal'], leftHand: ['grenade', 'gunmetal'], shoulderL: ['beamCannon', 'gunmetal'], shoulderR: ['heavyPod', 'gunmetal'], legL: ['microPod', 'gunmetal'], legR: ['missilePod', 'gunmetal'] } });
      m.input.lockFailed = true;
      // Frame time log
      window.FT = [];
      let last = performance.now();
      const f = () => { const t = performance.now(); window.FT.push(t - last); last = t; requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    const hold = (code, on) => page.evaluate(([c, v]) => { const k = window.__mech.input.keys; if (v) k.add(c); else k.delete(c); }, [code, on]);
    const press = (code) => page.evaluate((c) => window.__mech.input.edges.add(c), code);
    await hold('KeyJ', true); await hold('KeyK', true); await hold('KeyF', true); await hold('KeyW', true);
    for (let k = 0; k < 100; k++) {
      await page.evaluate((k) => { const P = window.__mech.P; P.yaw += Math.sin(k * 0.37) * 0.35; P.pitch = 0.05 + 0.15 * Math.abs(Math.sin(k * 0.21)); P.ap = 1e9; }, k);
      if (k % 8 === 3) await press('KeyE');
      if (k % 25 === 10) await shot(`destruct_soak_${k}`);
      await wait(500);
    }
    await hold('KeyJ', false); await hold('KeyK', false); await hold('KeyF', false); await hold('KeyW', false);
    const ft = await page.evaluate(() => { const a = window.FT.slice(30).sort((x, y) => x - y); return { n: a.length, p50: +a[a.length >> 1].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1), p99: +a[Math.floor(a.length * 0.99)].toFixed(1), max: +a[a.length - 1].toFixed(1), over50: a.filter((x) => x > 50).length }; });
    console.log('   frame ms', JSON.stringify(ft));
    console.log('   slow', JSON.stringify(await page.evaluate(() => (window.__mech.destruct.slow || []).sort((a, b) => b.ms - a.ms).slice(0, 10))));
    console.log('  ', JSON.stringify(await info()), 'spiders', await page.evaluate(() => window.__mech.spiders.kills));
  }

  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { if (++n < 90) requestAnimationFrame(f); else res(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); }; requestAnimationFrame(f); }));
  console.log('fps', fps, JSON.stringify(await info()));
  if (errors.length) console.log(errors.slice(0, 30).join('\n')); else console.log('NO ERRORS');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
