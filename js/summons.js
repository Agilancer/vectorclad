import * as THREE from './three.js';
import { VARIANTS } from './spiders.js';
import { SCORPIONS } from './scorpions.js';
import { RIFT_PACKS } from './riftlings.js';
import { RIFTLING_COLORS } from '../assets/riftlings/riftling.js';

// ---------------------------------------------------------------------------
// Summoning: the tech demo's debug menu (the ` key) calls monsters in instead
// of waves. Every monster comes through a portal of its own, a little wider
// than it is, about 800 ft straight ahead of where the mech is looking:
//   - Sky portals open flat, 400 ft up (higher only if it must clear the roofs
//     under it), in open sky: never over a tower's roof or beside one that
//     reaches up near the portal. The monster drops out and falls to the
//     street or the roof below.
//   - A summon of many opens their portals one after another, scattered over
//     an area that grows with the count, so hundreds of riftlings come down like
//     rain.
//   - The millipede's portal stands upright near the ground and it crawls out
//     of it along the rooftops (js/millipede.js planPortal).
// Each kind can be summoned again a minute after the last time.
// ---------------------------------------------------------------------------

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const FT = 0.3048;
export const SUMMON_FT = 800;     // how far ahead the portals open
const SKY_FT = 400;               // sky portals' height over the street
const SKY_MAX_FT = 650;           // highest one will go to clear the roofs under it
export const COOLDOWN = 60;       // seconds before a kind can be summoned again

const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const spider = (id, max, def) => ({ id, kind: 'spider', name: title(VARIANTS[id].name), max, def, glow: VARIANTS[id].palette.glow });
const scorp = (id, max, def) => ({ id, kind: 'scorpion', name: title(SCORPIONS[id].name), max, def, glow: SCORPIONS[id].palette.glow });
// A pack color of riftlings (js/riftlings.js RIFT_PACKS); one summon is dealt out into packs of it
const rift = (id, color, def) => {
  const c = new THREE.Color(RIFTLING_COLORS[color]);
  return { id, kind: 'riftling', color, name: title(RIFT_PACKS[color].name), max: 500, def, glow: [c.r, c.g, c.b] };
};

/** The menu's list: every monster in the game, how many one summon can call, and the slider's start */
export const SUMMON_GROUPS = [
  { title: 'Spider-frames', items: ['stalker', 'skitter', 'weaver', 'lancer', 'bombard'].map((id) => spider(id, 20, 5)) },
  { title: 'Medium spider-frames', items: ['bulwark', 'warden', 'mender', 'magnetar', 'quarrier'].map((id) => spider(id, 5, 1)) },
  { title: 'Scorpion-frames', items: [...['burrower', 'prowler', 'berserker', 'shocktail', 'scorcher', 'venomtail'].map((id) => scorp(id, 20, 5)), scorp('emperor', 5, 1)] },
  { title: 'Riftlings', items: [rift('acid', 'green', 50), rift('blast', 'orange', 20), rift('shade', 'purple', 16), rift('spire', 'blue', 16)] },
  { title: 'Bosses', items: [spider('brood', 5, 1), { id: 'millipede', kind: 'millipede', name: 'Millipede', max: 1, def: 1, glow: [1.3, 0.1, 0.06] }] },
];
export const SUMMONS = Object.fromEntries(SUMMON_GROUPS.flatMap((g) => g.items).map((it) => [it.id, it]));

// Portal timing (seconds) and the gap between one monster's portal and the next, by size
const TIMING = {
  small: { open: 0.35, hold: 0.55, close: 0.3 },
  normal: { open: 0.7, hold: 1.1, close: 0.5, gap: 0.45 },
  big: { open: 0.9, hold: 1.5, close: 0.6, gap: 1 },
};

const _a = new V3(), _b = new V3(), _eye = new V3();

export class Summoner {
  /** swarm: the SpiderSwarm (spiders, scorpions, riftlings, millipede); portals: js/portals.js */
  constructor({ swarm, portals, world }) {
    this.sw = swarm;
    this.portals = portals;
    this.world = world;
    this.M = world.M;
    this.dist = SUMMON_FT * FT * this.M;
    this.sky = SKY_FT * FT * this.M;
    this.skyMax = SKY_MAX_FT * FT * this.M;
    this.time = 0;
    this.queue = [];
    this.readyAt = {};          // kind id -> performance.now() when it can be summoned again
    this.reserved = { spider: 0, scorpion: 0, riftling: 0 };
    this.pending = 0;           // monsters on the way that aren't out of their portals yet
    this.total = 0;             // monsters summoned since the last deploy
    this.millDue = false;
  }

  /** Seconds before kind id can be summoned again */
  cooldown(id) { return Math.max(0, ((this.readyAt[id] || 0) - performance.now()) / 1000); }

  clear() {
    this.queue.length = 0;
    this.portals.clear();
    this.reserved.spider = this.reserved.scorpion = this.reserved.riftling = 0;
    this.pending = 0;
    this.total = 0;
    this.millDue = false;
    this.sw.incoming = 0;
  }

  /** Room left for more of a kind, counting the ones already on their way */
  room(kind) {
    const sw = this.sw;
    if (kind === 'spider') return sw.free.length - this.reserved.spider;
    if (kind === 'scorpion') return sw.nest.free.length - this.reserved.scorpion;
    return sw.rift.room - this.reserved.riftling;
  }

  /**
   * Summon count of kind id, ahead of the mech (P: pos, yaw). Returns { ok, n, msg }: msg is what to
   * tell the player. On success the kind goes on cooldown.
   */
  summon(id, count, P) {
    const it = SUMMONS[id];
    if (!it || this.cooldown(id) > 0) return { ok: false, msg: '' };
    const fwd = _a.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
    if (it.kind === 'millipede') return this.summonMillipede(P, fwd);
    const n = Math.min(count, this.room(it.kind));
    if (n <= 0) return { ok: false, msg: 'SWARM AT CAPACITY' };
    // Portal size: a little wider than the monster
    const R = it.kind === 'riftling' ? 3.4 : this.sw.reach(id) * 1.2 + 1;
    const T = it.kind === 'riftling' ? TIMING.small : R > 16 ? TIMING.big : TIMING.normal;
    const gap = it.kind === 'riftling' ? Math.max(0.035, Math.min(0.12, 8 / n)) : T.gap;
    const areaR = Math.min(it.kind === 'riftling' ? 42 : 60, R * (0.4 + 0.9 * Math.sqrt(n)));
    const Q0 = this.clampIn(P.pos.clone().addScaledVector(fwd, this.dist), areaR + 15);
    const eye = _eye.set(P.pos.x, P.pos.y + 7, P.pos.z);
    const area = this.findArea(Q0, R, areaR, eye);
    const spots = this.spots(area, R, areaR, n, Math.ceil((T.open + T.hold + T.close) / gap) + 1, eye);
    this.reserved[it.kind] += n;
    this.pending += n;
    // The riftlings of one summon form their packs as they come through (js/riftlings.js summon)
    const group = {};
    let t = this.time + 0.2;
    for (const at of spots) {
      this.queue.push({ t, fn: () => this.openFor(it, at, R, T, group) });
      t += gap * rand(0.6, 1.4);
    }
    this.readyAt[id] = performance.now() + COOLDOWN * 1000;
    this.total += n;
    const name = n === 1 ? it.name.toUpperCase() : `${n} ${it.name.toUpperCase()}${it.name.endsWith('s') ? '' : 'S'}`;
    return { ok: true, n, msg: n < count ? `${name} INBOUND · SWARM FULL` : `${name} INBOUND` };
  }

  summonMillipede(P, fwd) {
    const mill = this.sw.mill;
    if (mill.active || this.millDue) return { ok: false, msg: 'THE MILLIPEDE IS ALREADY HERE' };
    const Q0 = this.clampIn(P.pos.clone().addScaledVector(fwd, this.dist), 40);
    const plan = mill.planPortal(P, Q0, 16);
    if (!plan) return { ok: false, msg: 'NO ROOM AHEAD FOR THE MILLIPEDE' };
    this.millDue = true;
    this.pending++;
    const p = plan.portal;
    this.portals.open({
      pos: p.pos, normal: p.normal, radius: p.radius, color: new THREE.Color(1.3, 0.12, 0.08), big: true,
      open: 1.2, hold: 1.5, close: 0.8,
      onOpen: () => {
        this.millDue = false;
        this.pending--;
        mill.spawn(plan);
      },
      holdUntil: () => mill.active && !!mill.portal,
    });
    this.readyAt.millipede = performance.now() + COOLDOWN * 1000;
    this.total++;
    return { ok: true, n: 1, msg: 'MILLIPEDE INBOUND' };
  }

  /** Open one monster's portal; it drops through once the portal is open */
  openFor(it, at, R, T, group) {
    const color = it.kind === 'riftling' ? new THREE.Color(RIFTLING_COLORS[it.color]).multiplyScalar(1.4) : new THREE.Color(it.glow[0], it.glow[1], it.glow[2]);
    const portal = this.portals.open({
      pos: at, normal: new V3(0, -1, 0), radius: R, color, big: it.kind !== 'riftling',
      open: T.open, hold: T.hold, close: T.close,
      onOpen: () => this.deliver(it, at, group),
    });
    if (!portal) this.deliver(it, at, group);
  }

  /** The monster comes through, just above the portal's face, and falls */
  deliver(it, at, group) {
    this.reserved[it.kind]--;
    this.pending--;
    const sw = this.sw, vel = new V3(rand(-2, 2), -3, rand(-2, 2));
    if (it.kind === 'riftling') { sw.rift.summon(_a.set(at.x, at.y + 0.3, at.z), { color: it.color, vel, group }); return; }
    const spot = { point: new V3(at.x, at.y + 1.2, at.z), normal: new V3(0, 1, 0), collider: null };
    const s = it.kind === 'scorpion' ? sw.nest.spawn(spot, it.id, vel) : sw.spawn(spot, it.id, vel);
    if (!s) return;
    if (s.v.boss) sw.sound.broodRoar(at);
    else if (s.v.medium) sw.sound.mediumGrowl(at);
    else if (it.kind === 'scorpion') sw.sound.scorpionHiss(at);
    else sw.sound.spiderScreech(at);
  }

  update(dt) {
    this.time += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].t > this.time) continue;
      const q = this.queue.splice(i, 1)[0];
      q.fn();
    }
    this.sw.incoming = this.pending;
  }

  // ---- where ---------------------------------------------------------------------------

  clampIn(p, margin) {
    const B = this.world.bounds;
    const mx = Math.min(margin, (B.maxX - B.minX) / 2 - 1), mz = Math.min(margin, (B.maxZ - B.minZ) / 2 - 1);
    p.x = Math.max(B.minX + mx, Math.min(B.maxX - mx, p.x));
    p.z = Math.max(B.minZ + mz, Math.min(B.maxZ - mz, p.z));
    return p;
  }

  /**
   * How high a sky portal of radius R over (x, z) opens: 400 ft, or higher to clear the roofs under it;
   * null if a tower stands beside it reaching up near it, or it would have to go past 650 ft.
   */
  skyAt(x, z, R) {
    const B = this.world.bounds;
    if (x < B.minX + 8 || x > B.maxX - 8 || z < B.minZ + 8 || z > B.maxZ - 8) return null;
    const near = R + 6, far = R + 22;
    let under = 0;
    const beside = [];
    this.world.query(x - far, z - far, x + far, z + far, (c) => {
      if (c.walk) return;
      const dx = Math.max(c.min.x - x, 0, x - c.max.x), dz = Math.max(c.min.z - z, 0, z - c.max.z), d = Math.hypot(dx, dz);
      if (d < near) under = Math.max(under, c.max.y);
      else if (d < far) beside.push(c.max.y);
    });
    const A = Math.max(this.sky, under + R * 0.4 + 12);
    if (A > this.skyMax) return null;
    for (const top of beside) if (top > A - 20) return null;
    return A;
  }

  /**
   * Can the mech (its eye at `eye`) see a portal at p? If not at p's height, the lowest height up to
   * 650 ft that it can see, or null.
   */
  seen(eye, p) {
    for (let y = p.y; y <= this.skyMax + 0.01; y += (this.skyMax - this.sky) / 4) {
      _b.set(p.x - eye.x, y - eye.y, p.z - eye.z);
      const d = _b.length();
      if (!this.world.raycast(eye, _b.divideScalar(d), d - 2, { targets: false })) return y;
    }
    return null;
  }

  /**
   * Where to rain: { center, seen }. Q0, or the nearest spot round it whose sky is most open and most
   * in view of the mech (its eye at `eye`), not hidden behind the towers between; seen: the share of
   * that area's sky the mech can see
   */
  findArea(Q0, R, areaR, eye) {
    const samples = 12;
    const rate = (c, ring) => {
      let open = 0, seen = 0;
      for (let i = 0; i <= samples; i++) {
        const a = (i / samples) * Math.PI * 2, d = i === samples ? 0 : areaR * (i % 2 ? 0.75 : 0.35);
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, A = this.skyAt(x, z, R);
        if (A === null) continue;
        open++;
        if (this.seen(eye, _a.set(x, A, z)) !== null) seen++;
      }
      open /= samples + 1;
      seen /= samples + 1;
      return { score: open < 0.3 ? -Infinity : open * 50 + seen * 120 - ring * 0.35, seen };
    };
    let best = { center: Q0, ...rate(Q0, 0) };
    if (best.score >= 150) return best;
    for (const ring of [15, 30, 45, 60, 80, 105]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const c = this.clampIn(new V3(Q0.x + Math.cos(a) * ring, 0, Q0.z + Math.sin(a) * ring), areaR + 15);
        const r = rate(c, ring);
        if (r.score > best.score) best = { center: c, ...r };
      }
      if (best.score >= 150) break;
    }
    if (best.score === -Infinity) best = { center: Q0, seen: 0 };
    return best;
  }

  /**
   * n portal spots in open sky within areaR of center, each clear of the `recent` spots before it
   * (the portals that will be open at the same time), and where the area allows it, in view of the
   * mech's eye: raised as high as 650 ft to show over the roofs between, or tried somewhere else
   */
  spots(area, R, areaR, n, recent, eye) {
    const look = area.seen > 0.25;
    const out = [], center = area.center;
    for (let i = 0; i < n; i++) {
      let pick = null;
      for (let tries = 0; tries < 24 && !pick; tries++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * areaR;
        const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
        let A = this.skyAt(x, z, R);
        if (A === null) continue;
        if (look) {
          const y = this.seen(eye, _a.set(x, A, z));
          if (y === null && tries < 16) continue;
          if (y !== null) A = y;
        }
        let free = true;
        for (let k = Math.max(0, out.length - recent); k < out.length && free; k++) {
          if (Math.hypot(out[k].x - x, out[k].z - z) < R * 2.1) free = false;
        }
        if (free || tries > 18) pick = new V3(x, A, z);
      }
      // Nowhere open: over the middle of the area, high enough to clear whatever is there
      if (!pick) pick = new V3(center.x + rand(-R, R), this.skyAt(center.x, center.z, R) ?? this.skyMax, center.z + rand(-R, R));
      out.push(pick);
    }
    return out;
  }
}
