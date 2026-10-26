import * as THREE from './three.js';
import { PAINTS, SKINS } from './atlas.js';
import { WEAPONS, SLOTS, PRESETS, allowedFor } from './weapons.js';
import { gamepad } from './input.js';

const $ = (s) => document.querySelector(s);
const _v = new THREE.Vector3();

export class HUD {
  constructor({ touch = false } = {}) {
    this.shieldHint = touch ? 'HOLD L' : 'RMB';
    this.el = {
      score: $('#score'), boostBar: $('#boost-bar'), boostTxt: $('#boost-txt'), gauge: $('.gauge.boost'),
      armor: $('.gauge.armor'), apBar: $('#ap-bar'), apTxt: $('#ap-txt'), hostiles: $('#hostiles'),
      vignette: $('#dmg-vignette'), dirs: $('#dmg-dirs'), boss: $('#boss-bar'), bossHp: $('#boss-bar b'), bossName: $('#boss-bar .label'),
      spd: $('#spd'), alt: $('#alt'), lockct: $('#lockct'), mslct: $('#mslct'),
      weapons: $('#weapons'), toast: $('#toast'), hit: $('#hitmark'), locks: $('#locks'), zone: $('#lock-zone'),
      hint: $('#help-hint'), hard: $('#hardlock'), hardInfo: $('#hardlock span'), hardHp: $('#hardlock .hp b'), arrow: $('#lock-arrow'),
      menuKey: $('#btn-hangar kbd'), summonKey: $('#btn-summon kbd'),
    };
    this.last = {};
    this.lockEls = new Map();
    this.rows = [];
    this.toastT = 0;
    this.hitT = 0;
    this.score = 0;
    this.pain = 0;
    this.struckT = 0;
    this.dirEls = [];
    setTimeout(() => { if (this.el.hint) this.el.hint.style.opacity = '0'; }, 14000);
  }

  set(key, el, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }

  toast(msg, time = 1.4) {
    if (gamepad.immersive || gamepad.active) {
      const keys = gamepad.immersive && !gamepad.active
        ? { LMB: 'R FIRE', RMB: 'L FIRE', 'Q/E': 'MISSILE / SALVO', Q: 'MISSILE', '1-4': 'WEAPON 1–4', 'W/S': 'FORWARD / BACK', 'A/D': 'LEFT / RIGHT' }
        : { LMB: 'RT', RMB: 'LT', 'Q/E': 'LB / Y', Q: 'LB', '1-4': 'LB + D-PAD', 'W/S': 'LS', 'A/D': 'LS' };
      msg = msg.replace(/LMB|RMB|Q\/E|\bQ\b|1-4|W\/S|A\/D/g, key => keys[key]);
    }
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('on');
    this.toastT = time;
  }

  hit(kill) {
    const h = this.el.hit;
    h.classList.toggle('kill', !!kill);
    h.classList.add('on');
    this.hitT = kill ? 0.35 : 0.12;
  }

  addKill() {
    this.score++;
    this.el.score.textContent = this.score;
  }

  resetKills() {
    this.score = 0;
    this.el.score.textContent = '0';
  }

  /** A hit on the player: amount as a fraction of full armor, angle of the shooter (0 = dead ahead, clockwise) */
  damage(frac, angle, blocked) {
    this.pain = Math.min(1, this.pain + (blocked ? 0.05 : 0.25 + frac * 6));
    if (!blocked) { this.struckT = 0.12; this.el.armor.classList.add('struck'); }
    let d = this.dirEls.find((x) => x.t <= 0);
    if (!d) {
      if (this.dirEls.length >= 8) d = this.dirEls.reduce((a, b) => (a.t < b.t ? a : b));
      else {
        const el = document.createElement('div');
        el.className = 'dmg-dir';
        el.innerHTML = '<i></i>';
        this.el.dirs.appendChild(el);
        d = { el, t: 0 };
        this.dirEls.push(d);
      }
    }
    d.t = 1.1;
    d.el.classList.toggle('blocked', !!blocked);
    d.el.style.transform = `rotate(${angle}rad)`;
    d.el.style.opacity = '1';
  }

  buildWeapons(status) {
    const root = this.el.weapons;
    root.innerHTML = '';
    this.rows = status.map((s) => {
      const row = document.createElement('div');
      row.className = 'wrow';
      const short = { rightHand: 'R', leftHand: 'L', shoulderL: 'SH-L', shoulderR: 'SH-R', legL: 'LG-L', legR: 'LG-R' }[s.slot.id];
      row.innerHTML = `<span class="slot">${short}</span><span class="wname"></span><span class="ammo"></span><div class="meter"><i></i></div>`;
      root.appendChild(row);
      return { row, name: row.querySelector('.wname'), ammo: row.querySelector('.ammo'), bar: row.querySelector('.meter i'), key: '' };
    });
  }

  update(dt, d) {
    const e = this.el;
    this.set('menuKey', e.menuKey, d.gamepad ? 'Menu' : 'Tab');
    this.set('summonKey', e.summonKey, d.gamepad ? 'View' : '`');
    // Boost
    const b = Math.round(d.boost);
    this.set('boost', e.boostTxt, String(b));
    e.boostBar.style.width = `${Math.max(0, d.boost)}%`;
    e.gauge.classList.toggle('hot', d.overheat);
    this.set('spd', e.spd, String(Math.round(d.speed)));
    this.set('alt', e.alt, String(Math.round(d.alt)));
    this.set('lock', e.lockct, String(d.locks.length));
    this.set('msl', e.mslct, `/${d.missiles} MSL`);
    e.zone.classList.toggle('active', d.missileCap > 0);
    e.zone.style.display = d.missileCap > 0 ? '' : 'none';

    // Armor, hostiles, damage
    const ap = Math.max(0, d.ap);
    this.set('ap', e.apTxt, String(Math.ceil(ap)));
    e.apBar.style.width = `${Math.min(1, ap / d.apMax) * 100}%`;
    e.armor.classList.toggle('low', ap < d.apMax * 0.25);
    this.set('hostiles', e.hostiles, String(d.hostiles));
    if (this.struckT > 0 && (this.struckT -= dt) <= 0) e.armor.classList.remove('struck');
    e.boss.hidden = !d.boss;
    if (d.boss) {
      e.bossHp.style.width = `${Math.max(0, d.boss.hp / d.boss.maxHp) * 100}%`;
      this.set('bossName', e.bossName, d.boss.bossLabel || d.boss.name);
    }
    const low = ap > 0 && ap < d.apMax * 0.25 ? 0.22 + 0.1 * Math.sin(performance.now() / 160) : 0;
    this.pain = Math.max(0, this.pain - dt * 1.6);
    const v = Math.min(1, Math.max(this.pain, low));
    if (Math.abs(v - (this.lastPain || 0)) > 0.01) { this.lastPain = v; e.vignette.style.opacity = v.toFixed(2); }
    for (const x of this.dirEls) {
      if (x.t <= 0) continue;
      x.t -= dt;
      x.el.style.opacity = Math.max(0, Math.min(1, x.t * 1.4)).toFixed(2);
    }

    // Weapons
    if (this.rows.length !== d.weapons.length) this.buildWeapons(d.weapons);
    d.weapons.forEach((s, i) => {
      const r = this.rows[i];
      if (s.empty) {
        if (r.key !== 'empty') { r.key = 'empty'; r.row.className = 'wrow empty-slot'; r.name.textContent = '—'; r.ammo.textContent = ''; r.bar.style.width = '0'; }
        return;
      }
      let cls = 'wrow';
      if (s.kind === 'missile') cls += ' missile';
      if (s.reload != null) cls += ' reloading';
      let ammo = s.kind === 'shield' ? (d.gamepad ? 'LT' : gamepad.immersive ? 'L SHIELD' : this.shieldHint) : `${s.ammo}/${s.max}`;
      let frac = s.kind === 'shield' ? 1 : s.ammo / s.max;
      if (s.reload != null) { ammo = 'RELOAD'; frac = s.reload; }
      if (s.charge != null) { ammo = s.charge >= 1 ? 'FIRING' : 'CHARGE'; frac = Math.min(1, s.charge); }
      const key = `${cls}|${s.name}|${ammo}|${Math.round(frac * 40)}`;
      if (key === r.key) return;
      r.key = key;
      r.row.className = cls;
      r.name.textContent = s.name;
      r.ammo.textContent = ammo;
      r.bar.style.width = `${Math.round(frac * 100)}%`;
    });

    // Lock markers
    const seen = new Set();
    const W = window.innerWidth, H = window.innerHeight;
    for (const l of d.locks) {
      seen.add(l);
      let el = this.lockEls.get(l);
      if (!el) {
        el = document.createElement('div');
        el.className = 'lock new';
        el.innerHTML = '<b></b>';
        e.locks.appendChild(el);
        this.lockEls.set(l, el);
      }
      _v.copy(l.target.pos).project(d.camera);
      if (_v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = `${(_v.x * 0.5 + 0.5) * W}px`;
      el.style.top = `${(-_v.y * 0.5 + 0.5) * H}px`;
      const dist = Math.round(l.target.pos.distanceTo(d.camera.position) * d.meters);
      el.firstChild.textContent = `${dist}m`;
    }
    for (const [l, el] of this.lockEls) {
      if (!seen.has(l)) { el.remove(); this.lockEls.delete(l); }
    }

    // Lock-on bracket, or an edge arrow when the target is off-screen
    if (d.hard) {
      _v.copy(d.hard.pos).project(d.camera);
      const behind = _v.z > 1;
      let x = _v.x, y = _v.y;
      if (behind) { x = -x; y = -y; }
      const off = behind || Math.abs(x) > 0.95 || Math.abs(y) > 0.95;
      if (!off) {
        e.hard.hidden = false;
        e.arrow.hidden = true;
        e.hard.style.left = `${(x * 0.5 + 0.5) * W}px`;
        e.hard.style.top = `${(-y * 0.5 + 0.5) * H}px`;
        const dist = Math.round(d.hard.pos.distanceTo(d.camera.position) * d.meters);
        this.set('hardInfo', e.hardInfo, `${d.hard.name || 'LOCK'} ${dist}m`);
        e.hardHp.style.width = `${Math.max(0, d.hard.hp / d.hard.maxHp) * 100}%`;
      } else {
        e.hard.hidden = true;
        e.arrow.hidden = false;
        const a = Math.atan2(y, x);
        const k = 0.9 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
        e.arrow.style.left = `${(Math.cos(a) * k * 0.5 + 0.5) * W}px`;
        e.arrow.style.top = `${(-Math.sin(a) * k * 0.5 + 0.5) * H}px`;
        e.arrow.style.transform = `translate(-50%, -50%) rotate(${-a}rad)`;
      }
    } else {
      e.hard.hidden = true;
      e.arrow.hidden = true;
    }

    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.classList.remove('on'); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) e.hit.classList.remove('on'); }
  }
}

// ---------------------------------------------------------------------------
// Summon menu (the ` key): the tech demo's way to call monsters in (js/summons.js)
// ---------------------------------------------------------------------------

/**
 * A row per monster: how many (a slider up to the kind's limit), and a Summon button that stays
 * disabled, counting down, for a minute after it's used. groups: SUMMON_GROUPS. cooldown(id): seconds
 * left. queued(id): picked from the loadout, waiting for the fight. onSummon(id, count) does it (or
 * queues it) and returns { ok, msg }.
 */
export class SummonMenu {
  constructor({ groups, cooldown, queued, onSummon, sound }) {
    this.el = $('#summon');
    this.cooldown = cooldown;
    this.queued = queued;
    this.onSummon = onSummon;
    this.sound = sound;
    this.rows = [];
    const list = $('#summon-list');
    for (const g of groups) {
      const sec = div('sgroup');
      sec.innerHTML = `<h3>${g.title}</h3>`;
      for (const it of g.items) sec.appendChild(this.row(it));
      list.appendChild(sec);
    }
  }

  get open() { return !this.el.hidden; }

  row(it) {
    const row = div('srow');
    const name = div('srow-name');
    name.textContent = it.name;
    row.appendChild(name);
    let count = it.def;
    const out = document.createElement('output');
    out.className = 'mono';
    out.textContent = String(count);
    if (it.max > 1) {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '1';
      range.max = String(it.max);
      range.step = '1';
      range.value = String(count);
      range.setAttribute('aria-label', `How many: ${it.name}`);
      range.addEventListener('input', () => { count = parseInt(range.value, 10); out.textContent = String(count); });
      row.appendChild(range);
    } else {
      const fixed = div('srow-fixed mono');
      fixed.textContent = 'one at a time';
      row.appendChild(fixed);
    }
    row.appendChild(out);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-summon';
    btn.textContent = 'Summon';
    btn.setAttribute('aria-label', `Summon ${it.name}`);
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const r = this.onSummon(it.id, count);
      if (r && r.ok) this.sound.click(); else this.sound.empty();
      this.update(true);
    });
    row.appendChild(btn);
    this.rows.push({ it, row, btn, label: '' });
    return row;
  }

  /** queueing: opened over the loadout, so summons wait for the fight */
  show(queueing = false) {
    this.el.classList.toggle('queueing', queueing);
    this.el.hidden = false;
    this.update(true);
  }

  hide() { this.el.hidden = true; }

  /** Count the cooldowns down on the buttons */
  update(force = false) {
    if (!force && !this.open) return;
    for (const r of this.rows) {
      const left = Math.ceil(this.cooldown(r.it.id)), queued = left <= 0 && this.queued(r.it.id);
      const label = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : queued ? 'Queued' : 'Summon';
      if (label === r.label) continue;
      r.label = label;
      r.btn.textContent = label;
      r.btn.disabled = left > 0;
      r.btn.classList.toggle('queued', queued);
      r.row.classList.toggle('cooling', left > 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Frame select
// ---------------------------------------------------------------------------

/**
 * The frame cards on the select screen. frames: js/frames.js. meters: meters per game unit (a
 * function, known once the world is scaled), for the speeds. onPick(id) swaps the frame on show.
 */
export class FrameSelect {
  /** rides: cards for the vehicles that deploy instead of a frame ({ id, code, name, role, stats: [[label, 0..1, text]], blurb }), picked with onRide(id) */
  constructor({ frames, current, onPick, sound, meters, rides = [], onRide = null }) {
    this.frames = frames;
    this.onPick = onPick;
    this.rides = rides;
    this.onRide = onRide;
    this.sound = sound;
    this.meters = meters;
    this.list = $('#frame-list');
    this.render(current);
  }

  render(current) {
    const kmh = (v) => `${Math.round(v * this.meters() * 3.6)} km/h`;
    // Bars are scaled to the best frame in the bay
    const all = Object.values(this.frames);
    const top = (k) => Math.max(...all.map((f) => f[k]));
    this.list.innerHTML = '';
    for (const f of all) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'frame-card';
      b.setAttribute('aria-pressed', f.id === current ? 'true' : 'false');
      b.innerHTML = `<span class="fc-head"><span class="fc-code mono">${f.code}</span><span class="fc-name">${f.name}</span></span>
        <span class="fc-role">${f.role}</span>
        <span class="fc-stats">${[
          ['Armor', f.ap / top('ap'), `${f.ap} AP`],
          ['Walk', f.walk / top('walk'), kmh(f.walk)],
          ['Dash', f.dash / top('dash'), kmh(f.dash)],
          ['Boost', f.boost / top('boost'), `${(9.6 * f.boost).toFixed(1)} s`],
        ].map(([k, frac, v]) => `<span class="fc-stat"><span class="label">${k}</span><i><b style="width:${Math.round(frac * 100)}%"></b></i><span class="mono">${v}</span></span>`).join('')}</span>
        <span class="fc-blurb">${f.blurb}</span>`;
      b.addEventListener('click', () => {
        this.sound && this.sound.click();
        this.onPick(f.id);
        this.render(f.id);
      });
      this.list.appendChild(b);
    }
    for (const r of this.rides) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'frame-card ride-card';
      b.setAttribute('aria-pressed', r.id === current ? 'true' : 'false');
      b.innerHTML = `<span class="fc-head"><span class="fc-code mono">${r.code}</span><span class="fc-name">${r.name}</span></span>
        <span class="fc-role">${r.role}</span>
        <span class="fc-stats">${r.stats.map(([k, frac, v]) => `<span class="fc-stat"><span class="label">${k}</span><i><b style="width:${Math.round(frac * 100)}%"></b></i><span class="mono">${v}</span></span>`).join('')}</span>
        <span class="fc-blurb">${r.blurb}</span>`;
      b.addEventListener('click', () => {
        this.sound && this.sound.click();
        this.onRide(r.id);
        this.render(r.id);
      });
      this.list.appendChild(b);
    }
  }
}

// ---------------------------------------------------------------------------
// Hangar (loadout menu)
// ---------------------------------------------------------------------------

export class Hangar {
  /** frames, frame(), onFrame(id): the frame section (js/frames.js); the paint section follows the frame */
  constructor({ loadout, settings, onChange, onSettings, onView = null, currentView = null, sound, touch = false, frames = null, frame = null, onFrame = null }) {
    this.touch = touch;
    this.loadout = loadout;
    this.settings = settings;
    this.onChange = onChange;
    this.onSettings = onSettings;
    this.onView = onView;
    this.currentView = currentView;
    this.sound = sound;
    this.frames = frames;
    this.frame = frame;
    this.onFrame = onFrame;
    this.body = $('#hangar-body');
    this.render();
  }

  click() { this.sound && this.sound.click(); }

  render() {
    const L = this.loadout, b = this.body;
    b.innerHTML = '';
    const F = this.frames && this.frames[this.frame()];

    // Frame
    if (F) {
      const fr = section('Frame', F.role);
      const fc = div('chips');
      for (const f of Object.values(this.frames)) {
        fc.appendChild(chip(`${f.code} ${f.name}`, f === F, () => {
          if (f === F) return;
          this.click();
          this.onFrame(f.id);
          this.render();
        }));
      }
      fr.appendChild(fc);
      b.appendChild(fr);
    }

    // Presets
    const pre = section('Presets', 'Quick loadouts');
    const pc = div('chips');
    for (const p of PRESETS) {
      pc.appendChild(chip(p.name, false, () => {
        L.paint = p.paint;
        for (const k in p.slots) L.slots[k] = [...p.slots[k]];
        this.click();
        this.onChange();
        this.render();
      }));
    }
    pre.appendChild(pc);
    b.appendChild(pre);

    // Paint (the heavy frame wears its own black, ivory and gold)
    if (F && !F.paint) {
      const paint = section('Frame paint', 'Fixed finish');
      const note = div('slot-desc');
      note.textContent = `The ${F.code} ${F.name} wears its own black, ivory and gold armor; paint schemes apply to the FS-07A.`;
      paint.appendChild(note);
      b.appendChild(paint);
    } else {
      const paint = section('Frame paint', PAINTS.find((p) => p.id === L.paint)?.name || '');
      const sw = div('swatches');
      for (const p of PAINTS) {
        const s = swatch(p.name, p.armor, p.second, L.paint === p.id, () => {
          L.paint = p.id;
          this.click();
          this.onChange();
          this.render();
        });
        sw.appendChild(s);
      }
      paint.appendChild(sw);
      b.appendChild(paint);
    }

    // Slots
    for (const slot of SLOTS) {
      const [wid, skinId] = L.slots[slot.id] || [null, 'white'];
      const card = div(`slot-card${wid ? ' filled' : ''}`);
      const head = div('hsec-title');
      const padHint = { rightHand: 'RT', leftHand: 'LT', shoulderL: 'RB', shoulderR: 'RB', legL: 'LB / Y', legR: 'LB / Y' }[slot.id];
      const spatialHint = { rightHand: 'R fire', leftHand: 'L fire / shield', shoulderL: 'Cannons', shoulderR: 'Cannons', legL: 'Missile / salvo', legR: 'Missile / salvo' }[slot.id];
      head.innerHTML = `<h3>${slot.label}</h3><span class="hint">${gamepad.active ? padHint : gamepad.immersive ? spatialHint : this.touch ? slot.touch : slot.key}</span>`;
      card.appendChild(head);
      const chips = div('chips');
      chips.appendChild(chip('None', !wid, () => this.setSlot(slot.id, null, skinId)));
      for (const id of allowedFor(slot)) {
        chips.appendChild(chip(WEAPONS[id].short.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), wid === id,
          () => this.setSlot(slot.id, id, skinId)));
      }
      card.appendChild(chips);
      if (wid) {
        const desc = div('slot-desc');
        desc.textContent = `${WEAPONS[wid].name}. ${WEAPONS[wid].desc}`;
        card.appendChild(desc);
        const skins = div('swatches');
        for (const s of SKINS) {
          skins.appendChild(swatch(s.name, s.tint, s.stripe, skinId === s.id, () => this.setSlot(slot.id, wid, s.id)));
        }
        card.appendChild(skins);
      }
      b.appendChild(card);
    }

    // Settings
    const set = section('Settings', '');
    const S = this.settings;
    set.appendChild(choiceRow('View', [['third', 'Chase'], ['first', 'First person']], this.currentView?.() || S.view || 'third', (v) => {
      if (this.onView) this.onView(v); else { S.view = v; this.onSettings(); }
    }));
    set.appendChild(toggleRow('Sound', S.sound, (v) => { S.sound = v; this.onSettings(); }));
    set.appendChild(toggleRow('Music', S.music, (v) => { S.music = v; this.onSettings(); }));
    set.appendChild(choiceRow('Graphics', GRAPHICS, S.graphics, (v) => { S.graphics = v; this.onSettings(); }));
    set.appendChild(toggleRow('Shadows', S.shadows, (v) => { S.shadows = v; this.onSettings(); }));
    set.appendChild(toggleRow('Ink outlines', S.outlines, (v) => { S.outlines = v; this.onSettings(); }));
    set.appendChild(toggleRow('Invert look', S.invert, (v) => { S.invert = v; this.onSettings(); }));
    set.appendChild(toggleRow('High resolution', S.hires, (v) => { S.hires = v; this.onSettings(); }));
    const sens = div('settings-row');
    sens.innerHTML = '<label for="sens">Look sensitivity</label>';
    const r = document.createElement('input');
    r.type = 'range'; r.id = 'sens'; r.min = '0.3'; r.max = '2.5'; r.step = '0.05'; r.value = String(S.sens);
    r.addEventListener('input', () => { S.sens = parseFloat(r.value); this.onSettings(); });
    sens.appendChild(r);
    set.appendChild(sens);
    b.appendChild(set);
  }

  setSlot(id, wid, skin) {
    this.loadout.slots[id] = [wid, skin];
    this.click();
    this.onChange();
    const scroll = this.body.scrollTop;
    this.render();
    this.body.scrollTop = scroll;
  }
}

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
function section(title, hint) {
  const s = div('hsec');
  const h = div('hsec-title');
  h.innerHTML = `<h3>${title}</h3><span class="hint">${hint}</span>`;
  s.appendChild(h);
  return s;
}
function chip(text, on, fn) {
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'chip';
  c.textContent = text;
  c.setAttribute('aria-pressed', on ? 'true' : 'false');
  c.addEventListener('click', fn);
  return c;
}
function swatch(name, color, accent, on, fn) {
  const s = document.createElement('button');
  s.type = 'button';
  s.className = 'swatch';
  s.title = name;
  s.setAttribute('aria-label', name);
  s.setAttribute('aria-pressed', on ? 'true' : 'false');
  s.style.background = color;
  s.innerHTML = `<i style="background:${accent}"></i>`;
  s.addEventListener('click', fn);
  return s;
}
// Low draws straight to the screen; High adds bloom, glare and the grade; Ultra adds ambient
// occlusion, god rays and sharper shadows; Auto starts on Ultra and steps down while frames are slow
const GRAPHICS = [['auto', 'Auto'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']];
function choiceRow(label, options, value, fn) {
  const row = div('settings-row');
  row.innerHTML = `<span>${label}</span>`;
  const chips = div('chips');
  const btns = options.map(([id, text]) => {
    const c = chip(text, id === value, () => {
      for (const b of btns) b.setAttribute('aria-pressed', b === c ? 'true' : 'false');
      fn(id);
    });
    chips.appendChild(c);
    return c;
  });
  row.appendChild(chips);
  return row;
}
function toggleRow(label, value, fn) {
  const row = div('settings-row');
  row.innerHTML = `<span>${label}</span>`;
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'toggle';
  const sync = (v) => { t.textContent = v ? 'On' : 'Off'; t.setAttribute('aria-pressed', v ? 'true' : 'false'); };
  sync(value);
  t.addEventListener('click', () => { value = !value; sync(value); fn(value); });
  row.appendChild(t);
  return row;
}
