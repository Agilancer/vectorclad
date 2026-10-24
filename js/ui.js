import * as THREE from './three.js';
import { PAINTS, SKINS } from './atlas.js';
import { WEAPONS, slotsFor, allowedFor } from './weapons.js';
import { FRAMES, CLASSES } from './frames/index.js';

const $ = (s) => document.querySelector(s);
const _v = new THREE.Vector3();

export class HUD {
  constructor({ touch = false } = {}) {
    this.shieldHint = touch ? 'HOLD L' : 'RMB';
    this.el = {
      score: $('#score'), boostBar: $('#boost-bar'), boostTxt: $('#boost-txt'), gauge: $('.gauge.boost'),
      armor: $('.gauge.armor'), apBar: $('#ap-bar'), apTxt: $('#ap-txt'), wave: $('#wave'), hostiles: $('#hostiles'),
      vignette: $('#dmg-vignette'), dirs: $('#dmg-dirs'), boss: $('#boss-bar'), bossHp: $('#boss-bar b'),
      spd: $('#spd'), alt: $('#alt'), lockct: $('#lockct'), mslct: $('#mslct'),
      weapons: $('#weapons'), toast: $('#toast'), hit: $('#hitmark'), locks: $('#locks'), zone: $('#lock-zone'),
      hint: $('#help-hint'), hard: $('#hardlock'), hardInfo: $('#hardlock span'), hardHp: $('#hardlock .hp b'), arrow: $('#lock-arrow'),
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
      const short = { rightHand: 'R', leftHand: 'L', shoulderL: 'SH-L', shoulderR: 'SH-R', backC: 'BACK', legL: 'LG-L', legR: 'LG-R', hipL: 'HP-L', hipR: 'HP-R' }[s.slot.id];
      row.innerHTML = `<span class="slot">${short}</span><span class="wname"></span><span class="ammo"></span><div class="meter"><i></i></div>`;
      root.appendChild(row);
      return { row, name: row.querySelector('.wname'), ammo: row.querySelector('.ammo'), bar: row.querySelector('.meter i'), key: '' };
    });
  }

  update(dt, d) {
    const e = this.el;
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

    // Armor, wave, damage
    const ap = Math.max(0, d.ap);
    this.set('ap', e.apTxt, String(Math.ceil(ap)));
    e.apBar.style.width = `${Math.min(1, ap / d.apMax) * 100}%`;
    e.armor.classList.toggle('low', ap < d.apMax * 0.25);
    this.set('wave', e.wave, d.wave ? String(d.wave) : '–');
    this.set('hostiles', e.hostiles, d.wave ? `${d.hostiles} HOSTILE${d.hostiles === 1 ? '' : 'S'}` : '');
    if (this.struckT > 0 && (this.struckT -= dt) <= 0) e.armor.classList.remove('struck');
    e.boss.hidden = !d.boss;
    if (d.boss) e.bossHp.style.width = `${Math.max(0, d.boss.hp / d.boss.maxHp) * 100}%`;
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
      if (s.reload != null || s.reloading) cls += ' reloading';
      let ammo = s.kind === 'shield' ? this.shieldHint : `${s.ammo}/${s.max}`;
      let frac = s.kind === 'shield' ? 1 : s.ammo / s.max;
      // Weapons that don't count rounds (blade, drones) say what they're doing
      if (s.label) { ammo = s.label; frac = s.frac; }
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
// Frame select: a card per frame with its class and how it stacks up, on the
// intro card and at the top of the hangar
// ---------------------------------------------------------------------------

// Stat bars run from nothing to the best in the bay
const STAT_BARS = [
  ['ARMOR', (f) => f.ap / 2000],
  ['SPEED', (f) => f.walk / 9.6],
  ['BOOST', (f) => f.boost / 2.3],
  ['ARMS', (f) => f.slots.length / 9],
];

export class FramePicker {
  constructor(root, { frame, sound, onPick }) {
    this.root = root;
    this.frame = frame;
    this.sound = sound;
    this.onPick = onPick;
    this.render();
  }

  set(frame) {
    this.frame = frame;
    this.render();
  }

  render() {
    const root = this.root;
    if (!root) return;
    root.innerHTML = '';
    const grid = div('frame-grid');
    for (const f of FRAMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `frame-card ${f.class}`;
      b.setAttribute('aria-pressed', f === this.frame ? 'true' : 'false');
      b.innerHTML = `<span class="fc-head"><span class="fc-class">${CLASSES[f.class]}</span><span class="fc-code">${f.code}</span></span><b class="fc-name">${f.name}</b>`
        + `<span class="fc-stats">${STAT_BARS.map(([label, v]) => `<span class="fc-stat"><span>${label}</span><i><b style="width:${Math.round(Math.min(1, v(f)) * 100)}%"></b></i></span>`).join('')}</span>`;
      b.addEventListener('click', () => {
        this.sound && this.sound.click();
        if (f !== this.frame) this.onPick(f.id);
      });
      grid.appendChild(b);
    }
    root.appendChild(grid);
    const f = this.frame;
    const desc = div('frame-desc');
    desc.innerHTML = `<b>${f.code} ${f.name}</b> · ${CLASSES[f.class]} · ${f.ap} AP · ${f.slots.length} hardpoints. ${f.blurb}`;
    root.appendChild(desc);
  }
}

// ---------------------------------------------------------------------------
// Hangar (loadout menu)
// ---------------------------------------------------------------------------

export class Hangar {
  constructor({ frame, loadout, settings, onFrame, onChange, onSettings, sound, touch = false }) {
    this.touch = touch;
    this.frame = frame;
    this.loadout = loadout;
    this.settings = settings;
    this.onFrame = onFrame;
    this.onChange = onChange;
    this.onSettings = onSettings;
    this.sound = sound;
    this.body = $('#hangar-body');
    this.render();
  }

  click() { this.sound && this.sound.click(); }

  /** A different frame went into the bay, with its own loadout */
  setFrame(frame, loadout) {
    this.frame = frame;
    this.loadout = loadout;
    const scroll = this.body.scrollTop;
    this.render();
    this.body.scrollTop = scroll;
  }

  render() {
    const L = this.loadout, b = this.body, F = this.frame;
    b.innerHTML = '';

    // Frame
    const fr = section('Frame', `${CLASSES[F.class]} · ${F.code}`);
    const fp = div('frame-pick');
    new FramePicker(fp, { frame: F, sound: null, onPick: (id) => { this.click(); this.onFrame(id); } });
    fr.appendChild(fp);
    b.appendChild(fr);

    // Presets
    const pre = section('Presets', `Quick loadouts for the ${F.name}`);
    const pc = div('chips');
    for (const p of F.presets) {
      pc.appendChild(chip(p.name, false, () => {
        L.paint = p.paint || F.paint;
        for (const id of F.slots) L.slots[id] = [...(p.slots[id] || [null, (L.slots[id] || [])[1] || 'gunmetal'])];
        this.click();
        this.onChange();
        this.render();
      }));
    }
    pre.appendChild(pc);
    b.appendChild(pre);

    // Paint
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

    // Slots
    for (const slot of slotsFor(F)) {
      const [wid, skinId] = L.slots[slot.id] || [null, 'white'];
      const card = div(`slot-card${wid ? ' filled' : ''}`);
      const head = div('hsec-title');
      head.innerHTML = `<h3>${slot.label}</h3><span class="hint">${this.touch ? slot.touch : slot.key}</span>`;
      card.appendChild(head);
      const chips = div('chips');
      chips.appendChild(chip('None', !wid, () => this.setSlot(slot.id, null, skinId)));
      for (const id of allowedFor(slot, F)) {
        const c = chip(WEAPONS[id].short.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), wid === id,
          () => this.setSlot(slot.id, id, skinId));
        if (WEAPONS[id].heavy) c.classList.add('heavy');
        chips.appendChild(c);
      }
      card.appendChild(chips);
      if (wid && WEAPONS[wid]) {
        const desc = div('slot-desc');
        desc.textContent = `${WEAPONS[wid].name}${WEAPONS[wid].heavy ? ' (heavy class)' : ''}. ${WEAPONS[wid].desc}`;
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
    set.appendChild(toggleRow('Sound', S.sound, (v) => { S.sound = v; this.onSettings(); }));
    set.appendChild(toggleRow('Music', S.music, (v) => { S.music = v; this.onSettings(); }));
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
