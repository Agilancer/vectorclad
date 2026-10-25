// Synthesized sound effects. Nothing is loaded from disk; every sound is
// built from oscillators and filtered noise when it plays. The soundtrack is in music.js.

let shared = null;
/** The page's one AudioContext, shared with music.js (which needs it on iOS). */
export function audioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!shared && AC) shared = new AC();
  return shared;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0 };
  }

  unlock() {
    if (this.ctx) {
      // iOS reports 'interrupted' (not 'suspended') after a call, Siri or a trip to the background
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = audioContext());
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Brown noise for rumbles
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }

    // Continuous thruster roar, driven by setThrust().
    this.thrust = this.loop(this.noise, 'bandpass', 700, 0.6);
    this.thrustLow = this.loop(this.brown, 'lowpass', 300, 0.8);
    // Sustained mega-beam hum
    this.beamLoop = this.loop(this.noise, 'bandpass', 2400, 2);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 92;
    this.beamOsc = ctx.createGain();
    this.beamOsc.gain.value = 0;
    osc.connect(this.beamOsc).connect(this.master);
    osc.start();
  }

  loop(buffer, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { src, f, g };
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  get ok() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  // Distance attenuation relative to the listener (camera)
  att(pos) {
    if (!pos) return 1;
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return 1 / (1 + Math.max(0, d - 15) / 35);
  }

  env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  noiseHit({ type = 'lowpass', freq = 800, freqEnd, q = 1, peak = 0.5, attack = 0.003, decay = 0.3, pos, rate = 1, buffer, delay = 0 }) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, peak * this.att(pos), decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  tone({ type = 'sine', freq = 440, freqEnd, peak = 0.3, attack = 0.002, decay = 0.2, pos, delay = 0 }) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, peak * this.att(pos), decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  // ---- library -------------------------------------------------------------

  beam(pos) {
    this.tone({ type: 'sawtooth', freq: 1900, freqEnd: 160, peak: 0.16, decay: 0.28, pos });
    this.tone({ type: 'square', freq: 980, freqEnd: 90, peak: 0.08, decay: 0.32, pos });
    this.noiseHit({ type: 'highpass', freq: 3000, peak: 0.18, decay: 0.2, pos });
  }
  gun(pos) {
    this.noiseHit({ type: 'bandpass', freq: 1400, q: 0.8, peak: 0.35, decay: 0.07, pos });
    this.tone({ type: 'sine', freq: 140, freqEnd: 50, peak: 0.3, decay: 0.08, pos });
  }
  shotgun(pos) {
    this.noiseHit({ type: 'lowpass', freq: 2500, freqEnd: 300, peak: 0.7, decay: 0.35, pos });
    this.tone({ type: 'sine', freq: 110, freqEnd: 35, peak: 0.6, decay: 0.3, pos });
  }
  thump(pos) {
    this.noiseHit({ type: 'lowpass', freq: 1200, freqEnd: 200, peak: 0.5, decay: 0.25, pos });
    this.tone({ type: 'sine', freq: 90, freqEnd: 40, peak: 0.5, decay: 0.25, pos });
  }
  rocket(pos) {
    this.noiseHit({ type: 'bandpass', freq: 500, freqEnd: 2600, q: 1.2, peak: 0.55, attack: 0.02, decay: 0.7, pos });
    this.tone({ type: 'sine', freq: 70, freqEnd: 40, peak: 0.5, decay: 0.3, pos });
  }
  /** An allied tank's gun */
  cannon(pos) {
    if (!this.gate('cannon', 0.05, pos, 0.02)) return;
    this.noiseHit({ type: 'lowpass', freq: 1800, freqEnd: 220, peak: 0.6, decay: 0.38, pos });
    this.tone({ type: 'sine', freq: 115, freqEnd: 36, peak: 0.55, decay: 0.32, pos });
    this.noiseHit({ type: 'highpass', freq: 2800, peak: 0.14, decay: 0.05, pos });
  }
  missile(pos) {
    this.noiseHit({ type: 'bandpass', freq: 700, freqEnd: 3200, q: 1.5, peak: 0.3, attack: 0.01, decay: 0.45, pos });
    this.noiseHit({ type: 'highpass', freq: 5000, peak: 0.08, decay: 0.1, pos });
  }
  explosion(pos, size = 1) {
    if (!this.ok) return;
    const p = Math.min(1.2, 0.45 + size * 0.4);
    this.noiseHit({ type: 'lowpass', freq: 2200, freqEnd: 120, peak: p, attack: 0.005, decay: 1.2 + size * 0.5, pos });
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 400, peak: p * 1.2, decay: 1.6 + size * 0.6, pos });
    this.tone({ type: 'sine', freq: 70, freqEnd: 28, peak: p * 0.8, decay: 0.7, pos });
  }
  impact(pos) {
    this.noiseHit({ type: 'highpass', freq: 2400, peak: 0.18, decay: 0.12, pos });
    this.tone({ type: 'triangle', freq: 1300, freqEnd: 600, peak: 0.07, decay: 0.12, pos });
  }
  footstep(pos, heavy = 1) {
    this.tone({ type: 'sine', freq: 75, freqEnd: 32, peak: 0.55 * heavy, decay: 0.32, pos });
    this.noiseHit({ type: 'lowpass', freq: 500, freqEnd: 90, peak: 0.35 * heavy, decay: 0.3, pos });
    this.tone({ type: 'square', freq: 210, freqEnd: 160, peak: 0.035 * heavy, decay: 0.08, pos, delay: 0.03 });
  }
  crunch(pos) {
    this.noiseHit({ type: 'lowpass', freq: 1800, freqEnd: 300, peak: 0.55, decay: 0.35, pos });
    this.noiseHit({ type: 'bandpass', freq: 3200, q: 2, peak: 0.25, decay: 0.18, pos });
    this.tone({ type: 'square', freq: 180, freqEnd: 60, peak: 0.12, decay: 0.2, pos });
  }
  // Trees. A blast can fell a dozen at once, so these are gated like the spider sounds.
  treeSnap(pos) {
    if (!this.gate('treeSnap', 0.06, pos)) return;
    // The trunk splitting at the roots: a dry crack over a woody thump
    this.noiseHit({ type: 'bandpass', freq: 2800, freqEnd: 700, q: 1.4, peak: 0.4, decay: 0.16, pos });
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 700, freqEnd: 120, peak: 0.35, decay: 0.45, pos });
    this.tone({ type: 'triangle', freq: 150, freqEnd: 50, peak: 0.2, decay: 0.3, pos });
  }
  treeThud(pos, k = 1) {
    if (!this.gate('treeThud', 0.08, pos)) return;
    this.tone({ type: 'sine', freq: 110, freqEnd: 45, peak: 0.28 * k, decay: 0.25, pos });
    this.noiseHit({ type: 'lowpass', freq: 600, freqEnd: 150, peak: 0.22 * k, decay: 0.25, pos });
  }
  ignite(pos) {
    if (!this.gate('ignite', 0.1, pos)) return;
    // Leaves going up: a rising whoosh
    this.noiseHit({ type: 'bandpass', freq: 400, freqEnd: 1600, q: 0.7, peak: 0.35, attack: 0.05, decay: 0.8, pos });
  }
  servo(pos) {
    this.tone({ type: 'sawtooth', freq: 260, freqEnd: 420, peak: 0.035, attack: 0.03, decay: 0.25, pos });
  }
  lock() { this.tone({ type: 'square', freq: 1760, peak: 0.06, decay: 0.05 }); }
  lockFull() {
    this.tone({ type: 'square', freq: 2093, peak: 0.07, decay: 0.07 });
    this.tone({ type: 'square', freq: 2637, peak: 0.07, decay: 0.09, delay: 0.08 });
  }
  /** The lifter's clamps unlocking: three quick metallic clicks */
  clamps(pos) {
    for (const [d, f] of [[0, 1500], [0.11, 1150], [0.22, 1700]]) {
      this.tone({ type: 'square', freq: f, freqEnd: f * 0.55, peak: 0.07, decay: 0.03, delay: d, pos });
      this.tone({ type: 'triangle', freq: f * 2.6, freqEnd: f * 1.8, peak: 0.05, decay: 0.02, delay: d, pos });
    }
  }
  hatch(pos) {
    this.tone({ type: 'square', freq: 120, freqEnd: 70, peak: 0.08, decay: 0.12, pos });
    this.noiseHit({ type: 'bandpass', freq: 1800, q: 3, peak: 0.12, decay: 0.1, pos });
  }
  charge(pos, dur) {
    this.tone({ type: 'sawtooth', freq: 120, freqEnd: 1400, peak: 0.12, attack: dur * 0.9, decay: 0.1, pos });
    this.tone({ type: 'sine', freq: 240, freqEnd: 2200, peak: 0.1, attack: dur * 0.9, decay: 0.1, pos });
  }
  reload() {
    this.tone({ type: 'square', freq: 300, freqEnd: 180, peak: 0.06, decay: 0.08 });
    this.tone({ type: 'square', freq: 500, freqEnd: 320, peak: 0.06, decay: 0.08, delay: 0.18 });
  }
  click() { this.tone({ type: 'triangle', freq: 1200, freqEnd: 900, peak: 0.08, decay: 0.05 }); }
  empty() { this.tone({ type: 'square', freq: 220, peak: 0.05, decay: 0.05 }); }
  alarm() {
    this.tone({ type: 'square', freq: 880, peak: 0.07, decay: 0.12 });
    this.tone({ type: 'square', freq: 660, peak: 0.07, decay: 0.12, delay: 0.15 });
  }
  boostIgnite() {
    this.noiseHit({ type: 'bandpass', freq: 400, freqEnd: 1600, q: 0.7, peak: 0.45, attack: 0.01, decay: 0.4 });
    this.tone({ type: 'sine', freq: 60, freqEnd: 120, peak: 0.3, decay: 0.3 });
  }

  // Spiders. A swarm can trigger dozens of these at once, so each kind is
  // limited to one play per short gap, and faint ones are skipped.
  gate(key, gap, pos, min = 0.08) {
    if (!this.ok || this.att(pos) < min) return false;
    const now = this.ctx.currentTime;
    this.last = this.last || {};
    if (now - (this.last[key] || 0) < gap) return false;
    this.last[key] = now;
    return true;
  }
  spiderScreech(pos) {
    if (!this.gate('screech', 0.35, pos, 0.05)) return;
    const f = 1 + Math.random() * 0.3;
    this.tone({ type: 'sawtooth', freq: 2300 * f, freqEnd: 620 * f, peak: 0.12, attack: 0.04, decay: 0.55, pos });
    this.tone({ type: 'sawtooth', freq: 2410 * f, freqEnd: 700 * f, peak: 0.1, attack: 0.05, decay: 0.5, pos });
    this.tone({ type: 'square', freq: 1500 * f, freqEnd: 380 * f, peak: 0.05, attack: 0.02, decay: 0.45, pos });
    this.noiseHit({ type: 'bandpass', freq: 3400, freqEnd: 1300, q: 5, peak: 0.3, attack: 0.03, decay: 0.5, pos });
  }
  spiderLeap(pos) {
    if (!this.gate('leap', 0.12, pos)) return;
    this.noiseHit({ type: 'highpass', freq: 1800, freqEnd: 4200, peak: 0.16, attack: 0.01, decay: 0.2, pos });
    this.tone({ type: 'square', freq: 240, freqEnd: 520, peak: 0.05, attack: 0.02, decay: 0.12, pos });
  }
  spiderLand(pos) {
    if (!this.gate('land', 0.1, pos)) return;
    this.noiseHit({ type: 'lowpass', freq: 1600, freqEnd: 200, peak: 0.3, decay: 0.2, pos });
    this.tone({ type: 'triangle', freq: 900, freqEnd: 420, peak: 0.06, decay: 0.16, pos });
    this.tone({ type: 'sine', freq: 120, freqEnd: 50, peak: 0.25, decay: 0.18, pos });
  }
  spiderStep(pos) {
    if (!this.gate('step' + (Math.random() * 3 | 0), 0.05, pos, 0.25)) return;
    const f = 1 + Math.random() * 0.4;
    this.tone({ type: 'triangle', freq: 2900 * f, freqEnd: 1700 * f, peak: 0.035, decay: 0.035, pos });
    this.noiseHit({ type: 'highpass', freq: 4500, peak: 0.05, decay: 0.03, pos });
  }
  spiderDie(pos) {
    if (!this.gate('die', 0.06, pos)) return;
    this.tone({ type: 'sawtooth', freq: 1900, freqEnd: 160, peak: 0.12, attack: 0.01, decay: 0.45, pos });
    this.tone({ type: 'square', freq: 1300, freqEnd: 90, peak: 0.06, attack: 0.01, decay: 0.4, pos });
    this.noiseHit({ type: 'bandpass', freq: 2600, q: 2, peak: 0.25, decay: 0.25, pos });
  }
  plasmaShot(pos) {
    if (!this.gate('plasma', 0.045, pos)) return;
    this.tone({ type: 'sine', freq: 1100, freqEnd: 180, peak: 0.16, decay: 0.2, pos });
    this.tone({ type: 'square', freq: 540, freqEnd: 120, peak: 0.05, decay: 0.16, pos });
    this.noiseHit({ type: 'bandpass', freq: 1800, q: 2, peak: 0.12, decay: 0.12, pos });
  }
  laserCharge(pos, dur) {
    if (!this.gate('lcharge', 0.15, pos)) return;
    this.tone({ type: 'sawtooth', freq: 300, freqEnd: 3200, peak: 0.07, attack: dur * 0.95, decay: 0.05, pos });
    this.tone({ type: 'sine', freq: 610, freqEnd: 4100, peak: 0.08, attack: dur * 0.95, decay: 0.05, pos });
  }
  laserFire(pos) {
    if (!this.gate('lfire', 0.06, pos)) return;
    this.tone({ type: 'sawtooth', freq: 3000, freqEnd: 140, peak: 0.16, decay: 0.4, pos });
    this.tone({ type: 'square', freq: 1500, freqEnd: 80, peak: 0.08, decay: 0.45, pos });
    this.noiseHit({ type: 'highpass', freq: 2200, peak: 0.25, decay: 0.3, pos });
  }
  skitterChirp(pos) {
    if (!this.gate('chirp', 0.12, pos)) return;
    const f = 1 + Math.random() * 0.5;
    for (let i = 0; i < 3; i++) this.tone({ type: 'square', freq: 3200 * f, freqEnd: 2100 * f, peak: 0.035, decay: 0.03, pos, delay: i * 0.045 });
    this.noiseHit({ type: 'highpass', freq: 5000, peak: 0.06, decay: 0.12, pos });
  }
  webShot(pos) {
    if (!this.gate('web', 0.08, pos)) return;
    this.noiseHit({ type: 'bandpass', freq: 900, freqEnd: 2400, q: 3, peak: 0.22, attack: 0.01, decay: 0.16, pos });
    this.tone({ type: 'sine', freq: 300, freqEnd: 900, peak: 0.08, decay: 0.12, pos });
  }
  mortarLaunch(pos) {
    if (!this.gate('mortar', 0.1, pos)) return;
    this.tone({ type: 'sine', freq: 95, freqEnd: 40, peak: 0.45, decay: 0.3, pos });
    this.noiseHit({ type: 'lowpass', freq: 900, freqEnd: 150, peak: 0.35, decay: 0.28, pos });
    this.noiseHit({ type: 'bandpass', freq: 1800, freqEnd: 600, q: 2, peak: 0.1, attack: 0.05, decay: 0.6, pos });
  }
  broodRoar(pos, k = 1) {
    if (!this.gate('roar', 0.5, pos, 0.03)) return;
    this.tone({ type: 'sawtooth', freq: 620, freqEnd: 110, peak: 0.18 * k, attack: 0.08, decay: 1.1, pos });
    this.tone({ type: 'sawtooth', freq: 655, freqEnd: 120, peak: 0.14 * k, attack: 0.1, decay: 1.0, pos });
    this.tone({ type: 'square', freq: 310, freqEnd: 55, peak: 0.06 * k, attack: 0.05, decay: 1.2, pos });
    this.noiseHit({ type: 'bandpass', freq: 1400, freqEnd: 300, q: 3, peak: 0.35 * k, attack: 0.06, decay: 1.1, pos });
  }
  // Scorpions
  scorpionHiss(pos) {
    if (!this.gate('hiss', 0.4, pos, 0.04)) return;
    this.noiseHit({ type: 'bandpass', freq: 4200, freqEnd: 2600, q: 1.5, peak: 0.28, attack: 0.05, decay: 0.7, pos });
    this.tone({ type: 'sawtooth', freq: 180, freqEnd: 90, peak: 0.1, attack: 0.04, decay: 0.6, pos });
  }
  scorpionRage(pos) {
    if (!this.gate('rage', 0.4, pos, 0.04)) return;
    this.tone({ type: 'sawtooth', freq: 420, freqEnd: 140, peak: 0.2, attack: 0.05, decay: 0.8, pos });
    this.tone({ type: 'square', freq: 210, freqEnd: 70, peak: 0.1, attack: 0.05, decay: 0.9, pos });
    this.noiseHit({ type: 'bandpass', freq: 900, freqEnd: 300, q: 2, peak: 0.35, attack: 0.04, decay: 0.8, pos });
  }
  clawOpen(pos) {
    if (!this.gate('copen', 0.08, pos)) return;
    this.tone({ type: 'square', freq: 700, freqEnd: 1100, peak: 0.04, decay: 0.12, pos });
    this.noiseHit({ type: 'highpass', freq: 3000, peak: 0.06, decay: 0.08, pos });
  }
  clawSnap(pos) {
    if (!this.gate('snap', 0.06, pos)) return;
    this.tone({ type: 'triangle', freq: 2400, freqEnd: 900, peak: 0.12, decay: 0.06, pos });
    this.noiseHit({ type: 'bandpass', freq: 3200, q: 3, peak: 0.3, decay: 0.07, pos });
  }
  clawHit(pos) {
    if (!this.gate('chit', 0.06, pos)) return;
    this.noiseHit({ type: 'bandpass', freq: 1800, q: 2, peak: 0.4, decay: 0.16, pos });
    this.tone({ type: 'triangle', freq: 1300, freqEnd: 600, peak: 0.12, decay: 0.2, pos });
  }
  stingCharge(pos, dur) {
    if (!this.gate('scharge', 0.12, pos)) return;
    this.tone({ type: 'sawtooth', freq: 500, freqEnd: 1900, peak: 0.06, attack: dur * 0.9, decay: 0.05, pos });
    this.noiseHit({ type: 'bandpass', freq: 2500, freqEnd: 5200, q: 4, peak: 0.08, attack: dur * 0.9, decay: 0.05, pos });
  }
  stingWhip(pos) {
    if (!this.gate('whip', 0.08, pos)) return;
    this.noiseHit({ type: 'bandpass', freq: 600, freqEnd: 3800, q: 1.5, peak: 0.3, attack: 0.02, decay: 0.18, pos });
  }
  stingHit(pos) {
    if (!this.gate('shit', 0.06, pos)) return;
    this.noiseHit({ type: 'bandpass', freq: 1200, q: 1.5, peak: 0.45, decay: 0.22, pos });
    this.tone({ type: 'sawtooth', freq: 900, freqEnd: 220, peak: 0.12, decay: 0.3, pos });
    this.tone({ type: 'sine', freq: 140, freqEnd: 55, peak: 0.3, decay: 0.25, pos });
  }
  burrow(pos, k = 1) {
    if (!this.gate('burrow', 0.3, pos, 0.04)) return;
    this.noiseHit({ type: 'lowpass', freq: 380, freqEnd: 160, peak: 0.45 * k, attack: 0.05, decay: 0.45, pos });
    this.tone({ type: 'sine', freq: 55, freqEnd: 38, peak: 0.25 * k, attack: 0.05, decay: 0.4, pos });
  }
  erupt(pos) {
    if (!this.gate('erupt', 0.1, pos, 0.03)) return;
    this.noiseHit({ type: 'lowpass', freq: 1400, freqEnd: 180, peak: 0.6, decay: 0.5, pos });
    this.tone({ type: 'sine', freq: 90, freqEnd: 35, peak: 0.45, decay: 0.4, pos });
    this.scorpionHiss(pos);
  }
  scrape(pos) {
    if (!this.gate('scrape', 0.25, pos)) return;
    this.noiseHit({ type: 'bandpass', freq: 2600, freqEnd: 1500, q: 6, peak: 0.22, attack: 0.02, decay: 0.45, pos });
    this.tone({ type: 'sawtooth', freq: 1900, freqEnd: 1300, peak: 0.04, decay: 0.4, pos });
  }
  flame(pos) {
    if (!this.gate('flame', 0.11, pos)) return;
    this.noiseHit({ type: 'lowpass', freq: 900, freqEnd: 500, peak: 0.3, attack: 0.03, decay: 0.16, pos });
    this.noiseHit({ type: 'bandpass', freq: 2200, q: 1, peak: 0.08, attack: 0.03, decay: 0.14, pos });
  }
  zap(pos) {
    if (!this.gate('zap', 0.06, pos)) return;
    this.noiseHit({ type: 'highpass', freq: 2500, peak: 0.3, decay: 0.22, pos });
    for (let i = 0; i < 4; i++) this.tone({ type: 'square', freq: 2400 + Math.random() * 2400, freqEnd: 700, peak: 0.05, decay: 0.04, pos, delay: i * 0.04 });
    this.tone({ type: 'square', freq: 120, freqEnd: 60, peak: 0.08, decay: 0.25, pos });
  }
  venomSpit(pos) {
    if (!this.gate('spit', 0.08, pos)) return;
    this.noiseHit({ type: 'bandpass', freq: 1500, freqEnd: 600, q: 2, peak: 0.25, attack: 0.01, decay: 0.18, pos });
    this.tone({ type: 'sine', freq: 520, freqEnd: 260, peak: 0.07, decay: 0.15, pos });
  }
  // Riftlings (js/riftlings.js)
  /** A pack leader's shriek: a rising wail that breaks into a rasping scream */
  riftScream(pos, k = 1) {
    if (!this.gate('rscream', 0.45, pos, 0.03)) return;
    const f = 0.9 + Math.random() * 0.25;
    this.tone({ type: 'sawtooth', freq: 1250 * f, freqEnd: 2900 * f, peak: 0.08 * k, attack: 0.14, decay: 0.12, pos });
    this.tone({ type: 'sawtooth', freq: 2900 * f, freqEnd: 900 * f, peak: 0.11 * k, attack: 0.02, decay: 0.9, pos, delay: 0.24 });
    this.tone({ type: 'sawtooth', freq: 3080 * f, freqEnd: 1010 * f, peak: 0.07 * k, attack: 0.03, decay: 0.85, pos, delay: 0.25 });
    this.tone({ type: 'square', freq: 1480 * f, freqEnd: 520 * f, peak: 0.04 * k, attack: 0.03, decay: 0.8, pos, delay: 0.26 });
    this.noiseHit({ type: 'bandpass', freq: 4200, freqEnd: 1600, q: 6, peak: 0.3 * k, attack: 0.1, decay: 1.0, pos });
    this.noiseHit({ type: 'highpass', freq: 5200, peak: 0.1 * k, attack: 0.3, decay: 0.6, pos });
  }
  riftHiss(pos, k = 1) {
    if (!this.gate('rhiss', 0.3, pos, 0.05)) return;
    this.noiseHit({ type: 'highpass', freq: 4600, freqEnd: 3000, peak: 0.2 * k, attack: 0.08, decay: 0.6, pos });
    this.noiseHit({ type: 'bandpass', freq: 2400, q: 4, peak: 0.08 * k, attack: 0.1, decay: 0.5, pos });
  }
  riftLeap(pos) {
    if (!this.gate('rleap', 0.07, pos, 0.1)) return;
    const f = 1 + Math.random() * 0.3;
    this.tone({ type: 'sawtooth', freq: 2400 * f, freqEnd: 3600 * f, peak: 0.05, attack: 0.02, decay: 0.12, pos });
    this.noiseHit({ type: 'highpass', freq: 3500, freqEnd: 6000, peak: 0.1, attack: 0.01, decay: 0.15, pos });
  }
  riftLand(pos) {
    if (!this.gate('rland', 0.08, pos, 0.1)) return;
    this.noiseHit({ type: 'lowpass', freq: 1200, freqEnd: 200, peak: 0.18, decay: 0.15, pos });
    this.tone({ type: 'sine', freq: 140, freqEnd: 60, peak: 0.12, decay: 0.12, pos });
  }
  riftStep(pos) {
    if (!this.gate('rstep' + (Math.random() * 3 | 0), 0.05, pos, 0.25)) return;
    const f = 1 + Math.random() * 0.5;
    this.tone({ type: 'triangle', freq: 1900 * f, freqEnd: 1100 * f, peak: 0.025, decay: 0.03, pos });
    this.noiseHit({ type: 'highpass', freq: 3800, peak: 0.035, decay: 0.025, pos });
  }
  /** Claws biting into armor as one takes hold of the hull */
  riftLatch(pos) {
    if (!this.gate('rlatch', 0.06, pos)) return;
    const f = 1 + Math.random() * 0.2;
    this.tone({ type: 'triangle', freq: 2600 * f, freqEnd: 1700 * f, peak: 0.09, decay: 0.12, pos });
    this.noiseHit({ type: 'bandpass', freq: 3600, q: 3, peak: 0.22, attack: 0.002, decay: 0.1, pos });
    this.tone({ type: 'sine', freq: 210, freqEnd: 80, peak: 0.2, decay: 0.12, pos });
  }
  riftClaw(pos) {
    if (!this.gate('rclaw', 0.07, pos)) return;
    const f = 1 + Math.random() * 0.3;
    this.noiseHit({ type: 'bandpass', freq: 3000 * f, freqEnd: 1800, q: 4, peak: 0.14, attack: 0.005, decay: 0.09, pos });
    this.tone({ type: 'triangle', freq: 2100 * f, freqEnd: 1500 * f, peak: 0.04, decay: 0.07, pos });
  }
  /** One bursting on the hull: a wet slap, a squelch, a thump and a patter of drips */
  splat(pos) {
    if (!this.gate('splat' + (Math.random() * 3 | 0), 0.04, pos, 0.02)) return;
    const f = 0.85 + Math.random() * 0.3;
    this.noiseHit({ type: 'lowpass', freq: 2600 * f, freqEnd: 180, q: 4, peak: 0.5, attack: 0.002, decay: 0.22, pos });
    this.noiseHit({ type: 'bandpass', freq: 900 * f, freqEnd: 260, q: 6, peak: 0.3, attack: 0.01, decay: 0.3, pos });
    this.tone({ type: 'sine', freq: 180 * f, freqEnd: 45, peak: 0.32, decay: 0.16, pos });
    for (let i = 0; i < 4; i++) {
      this.tone({ type: 'sine', freq: (500 + Math.random() * 700) * f, freqEnd: 140, peak: 0.05, decay: 0.05, pos, delay: 0.05 + i * 0.04 + Math.random() * 0.03 });
    }
  }
  riftDie(pos) {
    if (!this.gate('rdie', 0.06, pos)) return;
    const f = 1 + Math.random() * 0.3;
    this.tone({ type: 'sawtooth', freq: 2300 * f, freqEnd: 500 * f, peak: 0.08, attack: 0.01, decay: 0.32, pos });
    this.noiseHit({ type: 'lowpass', freq: 1800, freqEnd: 250, q: 3, peak: 0.22, decay: 0.2, pos });
  }
  // Medium spiders
  mediumGrowl(pos) {
    if (!this.gate('mgrowl', 0.5, pos, 0.03)) return;
    this.tone({ type: 'sawtooth', freq: 1100, freqEnd: 260, peak: 0.12, attack: 0.06, decay: 0.8, pos });
    this.tone({ type: 'square', freq: 160, freqEnd: 70, peak: 0.1, attack: 0.05, decay: 0.9, pos });
    this.noiseHit({ type: 'bandpass', freq: 2000, freqEnd: 600, q: 3, peak: 0.25, attack: 0.05, decay: 0.8, pos });
  }
  bridgeCreak(pos) {
    if (!this.gate('creak', 0.6, pos)) return;
    const f = 1 + Math.random() * 0.3;
    this.tone({ type: 'sawtooth', freq: 140 * f, freqEnd: 95 * f, peak: 0.08, attack: 0.15, decay: 0.7, pos });
    this.noiseHit({ type: 'bandpass', freq: 1100 * f, freqEnd: 700, q: 9, peak: 0.16, attack: 0.1, decay: 0.7, pos });
  }
  tractor(pos) {
    if (!this.gate('tractor', 0.5, pos, 0.03)) return;
    this.tone({ type: 'sawtooth', freq: 70, freqEnd: 52, peak: 0.16, attack: 0.08, decay: 3, pos });
    this.tone({ type: 'sine', freq: 940, freqEnd: 610, peak: 0.06, attack: 0.1, decay: 3, pos });
    this.noiseHit({ type: 'bandpass', freq: 500, q: 4, peak: 0.12, attack: 0.2, decay: 2.8, pos });
  }
  boulderThrow(pos) {
    if (!this.gate('hurl', 0.15, pos)) return;
    this.noiseHit({ type: 'bandpass', freq: 400, freqEnd: 1400, q: 1.2, peak: 0.35, attack: 0.04, decay: 0.35, pos });
    this.tone({ type: 'sine', freq: 80, freqEnd: 140, peak: 0.25, decay: 0.3, pos });
  }
  domeUp(pos) {
    if (!this.gate('domeup', 0.3, pos)) return;
    this.tone({ type: 'sine', freq: 180, freqEnd: 720, peak: 0.12, attack: 0.25, decay: 0.5, pos });
    this.tone({ type: 'triangle', freq: 362, freqEnd: 1440, peak: 0.05, attack: 0.25, decay: 0.5, pos });
  }
  domeBreak(pos) {
    if (!this.gate('domebreak', 0.2, pos)) return;
    this.noiseHit({ type: 'highpass', freq: 3000, peak: 0.3, decay: 0.6, pos });
    for (let i = 0; i < 8; i++) this.tone({ type: 'sine', freq: 1800 + Math.random() * 3000, freqEnd: 600, peak: 0.04, decay: 0.12, pos, delay: Math.random() * 0.3 });
    this.tone({ type: 'sine', freq: 600, freqEnd: 90, peak: 0.15, decay: 0.6, pos });
  }
  // The millipede
  millipedeRoar(pos, k = 1) {
    if (!this.gate('mroar', 0.8, pos, 0.01)) return;
    this.tone({ type: 'sawtooth', freq: 160, freqEnd: 48, peak: 0.28 * k, attack: 0.15, decay: 1.8, pos });
    this.tone({ type: 'sawtooth', freq: 171, freqEnd: 52, peak: 0.22 * k, attack: 0.18, decay: 1.7, pos });
    this.tone({ type: 'square', freq: 82, freqEnd: 30, peak: 0.12 * k, attack: 0.1, decay: 2, pos });
    this.noiseHit({ type: 'bandpass', freq: 700, freqEnd: 180, q: 2, peak: 0.45 * k, attack: 0.12, decay: 1.8, pos });
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 200, peak: 0.6 * k, attack: 0.2, decay: 2, pos });
  }
  coreBreak(pos) {
    if (!this.gate('core', 0.2, pos, 0.01)) return;
    for (let i = 0; i < 10; i++) this.tone({ type: 'sine', freq: 600 * Math.pow(2, i / 5), freqEnd: 300, peak: 0.06, decay: 0.8, pos, delay: i * 0.03 });
    this.noiseHit({ type: 'highpass', freq: 2500, peak: 0.3, decay: 0.7, pos });
    this.explosion(pos, 2);
  }
  thrusters(pos) {
    if (!this.gate('thrust', 0.5, pos, 0.01)) return;
    this.noiseHit({ type: 'lowpass', freq: 600, freqEnd: 1600, peak: 0.6, attack: 0.9, decay: 2.5, pos });
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 300, peak: 0.7, attack: 1, decay: 3, pos });
    this.tone({ type: 'sawtooth', freq: 60, freqEnd: 140, peak: 0.15, attack: 1.2, decay: 1.5, pos });
  }
  eyeBeam(pos, dur) {
    if (!this.gate('eyebeam', 0.5, pos, 0.01)) return;
    this.tone({ type: 'sawtooth', freq: 220, freqEnd: 180, peak: 0.12, attack: 0.05, decay: dur, pos });
    this.tone({ type: 'square', freq: 110, freqEnd: 95, peak: 0.08, attack: 0.05, decay: dur, pos });
    this.noiseHit({ type: 'bandpass', freq: 3000, q: 2, peak: 0.12, attack: 0.05, decay: dur, pos });
  }
  spinWhine(pos, k) {
    if (!this.gate('whine', 0.3, pos, 0.01)) return;
    const f = 300 + 1400 * k;
    this.tone({ type: 'sawtooth', freq: f, freqEnd: f * 1.25, peak: 0.08 + 0.08 * k, attack: 0.05, decay: 0.4, pos });
    this.noiseHit({ type: 'bandpass', freq: f * 2, q: 4, peak: 0.1 + 0.1 * k, decay: 0.35, pos });
  }
  fireworkPop(pos) {
    if (!this.gate('pop' + ((Math.random() * 3) | 0), 0.05, pos, 0.005)) return;
    this.noiseHit({ type: 'lowpass', freq: 2400, freqEnd: 300, peak: 0.5, decay: 0.4, pos });
    this.tone({ type: 'sine', freq: 140, freqEnd: 50, peak: 0.3, decay: 0.3, pos });
    for (let i = 0; i < 10; i++) this.tone({ type: 'square', freq: 2500 + Math.random() * 3000, peak: 0.025, decay: 0.02, pos, delay: 0.35 + i * 0.06 + Math.random() * 0.05 });
  }
  // Summoning portals (js/portals.js); the riftlings that rain out of them are with the Riftlings above
  portalOpen(pos, k = 1) {
    if (!this.gate(k > 0.6 ? 'portal' : 'portalS', k > 0.6 ? 0.12 : 0.07, pos, 0.02)) return;
    this.tone({ type: 'sawtooth', freq: 70 * (1.4 - 0.4 * k), freqEnd: 320, peak: 0.16 * k, attack: 0.25, decay: 0.7, pos });
    this.tone({ type: 'sine', freq: 900, freqEnd: 140, peak: 0.12 * k, attack: 0.05, decay: 0.8, pos });
    this.noiseHit({ type: 'bandpass', freq: 300, freqEnd: 2600, q: 3, peak: 0.4 * k, attack: 0.3, decay: 0.5, pos });
    if (k > 0.6) this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 240, peak: 0.7 * k, attack: 0.1, decay: 1.4, pos });
  }
  portalClose(pos, k = 1) {
    if (!this.gate(k > 0.6 ? 'pclose' : 'pcloseS', 0.1, pos, 0.02)) return;
    this.noiseHit({ type: 'bandpass', freq: 2600, freqEnd: 200, q: 3, peak: 0.3 * k, attack: 0.02, decay: 0.45, pos });
    this.tone({ type: 'sine', freq: 520, freqEnd: 60, peak: 0.14 * k, decay: 0.5, pos });
  }
  playerHit(heavy = 1) {
    if (!this.gate('phit', 0.05)) return;
    this.noiseHit({ type: 'bandpass', freq: 1300, q: 1.5, peak: 0.35 * heavy, decay: 0.2 });
    this.tone({ type: 'triangle', freq: 520, freqEnd: 300, peak: 0.12 * heavy, decay: 0.3 });
    this.tone({ type: 'sine', freq: 110, freqEnd: 45, peak: 0.35 * heavy, decay: 0.25 });
  }
  shieldBlock() {
    if (!this.gate('block', 0.05)) return;
    this.tone({ type: 'triangle', freq: 1650, freqEnd: 1500, peak: 0.12, decay: 0.45 });
    this.tone({ type: 'sine', freq: 2470, freqEnd: 2300, peak: 0.06, decay: 0.35 });
    this.noiseHit({ type: 'highpass', freq: 3000, peak: 0.15, decay: 0.08 });
  }
  warning() {
    this.tone({ type: 'square', freq: 440, peak: 0.07, decay: 0.18 });
    this.tone({ type: 'square', freq: 440, peak: 0.07, decay: 0.18, delay: 0.25 });
  }

  // ---- destruction (js/destruct) ----------------------------------------------
  /** Masonry chipping and crumbling; size ~ cells broken */
  crumble(pos, size = 1) {
    if (!this.gate('crumble', 0.05, pos)) return;
    const k = Math.min(1, 0.25 + size * 0.05);
    this.noiseHit({ type: 'bandpass', freq: 900 + Math.random() * 600, q: 0.7, peak: 0.28 * k, decay: 0.18 + k * 0.4, pos });
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 380, peak: 0.35 * k, decay: 0.3 + k * 0.6, pos });
    for (let i = 0; i < Math.min(6, 1 + size / 6); i++) this.tone({ type: 'triangle', freq: 300 + Math.random() * 500, freqEnd: 120, peak: 0.03, decay: 0.06, pos, delay: Math.random() * 0.25 });
  }
  /** Curtain wall shattering */
  glassBreak(pos, size = 1) {
    if (!this.gate('glass', 0.06, pos)) return;
    const k = Math.min(1, 0.3 + size * 0.06);
    this.noiseHit({ type: 'highpass', freq: 4200, peak: 0.24 * k, decay: 0.25 + k * 0.3, pos });
    for (let i = 0; i < 4 + Math.min(10, size); i++) this.tone({ type: 'sine', freq: 2400 + Math.random() * 4200, peak: 0.025 * k, decay: 0.05 + Math.random() * 0.12, pos, delay: Math.random() * (0.2 + k * 0.5) });
  }
  /** Steel taking a hit or tearing */
  metalHit(pos, k = 1) {
    if (!this.gate('metal', 0.05, pos)) return;
    this.tone({ type: 'triangle', freq: 520 + Math.random() * 380, freqEnd: 260, peak: 0.09 * k, decay: 0.35, pos });
    this.tone({ type: 'sine', freq: 1310 + Math.random() * 600, peak: 0.04 * k, decay: 0.5, pos });
    this.noiseHit({ type: 'bandpass', freq: 2200, q: 2, peak: 0.12 * k, decay: 0.12, pos });
  }
  /** A structure straining under its load before it goes */
  groan(pos, k = 1) {
    if (!this.gate('groan', 0.6, pos, 0.04)) return;
    const ctx = this.ctx, t = ctx.currentTime, a = this.att(pos) * Math.min(1.2, k);
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    const base = 38 + Math.random() * 22;
    o.frequency.setValueAtTime(base, t);
    for (let i = 1; i <= 6; i++) o.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.6), t + i * 0.28);
    f.type = 'bandpass'; f.frequency.value = 180 + Math.random() * 120; f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32 * a, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + 2.1);
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 160, peak: 0.4 * a, attack: 0.3, decay: 1.6, pos });
  }
  /** A heavy piece hitting the street or another building; size grows with its mass */
  crash(pos, size = 1) {
    if (!this.gate('crash', 0.08, pos, 0.03)) return;
    const p = Math.min(1.3, 0.4 + size * 0.25);
    this.noiseHit({ type: 'lowpass', freq: 1600, freqEnd: 90, peak: p, attack: 0.004, decay: 0.9 + size * 0.4, pos });
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 260, peak: p * 1.3, decay: 1.8 + size * 0.8, pos });
    this.tone({ type: 'sine', freq: 52, freqEnd: 22, peak: p * 0.9, decay: 1.1 + size * 0.3, pos });
    this.crumble(pos, 20);
  }
  /** The long roar of a building coming down */
  collapse(pos, size = 1) {
    if (!this.gate('collapse', 0.5, pos, 0.02)) return;
    const p = Math.min(1.4, 0.6 + size * 0.2), d = 3 + size * 1.5;
    this.noiseHit({ buffer: this.brown, type: 'lowpass', freq: 220, peak: p * 1.4, attack: 0.6, decay: d, pos });
    this.noiseHit({ type: 'bandpass', freq: 600, q: 0.5, peak: p * 0.45, attack: 0.8, decay: d * 0.8, pos });
    this.last.groan = 0;
    this.groan(pos, 1.2);
  }

  // People (js/people.js). A death is one of the 24 sounds in GORE below, picked at random.
  /**
   * A human cry: a buzzing sawtooth, wavering, through the formants of a vowel. pitch: [start, peak, end]
   * in Hz; vowel: [[F, Q, gain], ...]; vib: vibrato depth (a fraction of the pitch) at vibRate; rasp: how
   * much it breaks up (a rough flutter); breath: hiss mixed in.
   */
  voice({ pitch, vowel, dur, attack = 0.05, vib = 0.02, vibRate = 6, rasp = 0, breath = 0.15, peak = 0.2, pos, delay = 0 }) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime + delay, end = t + dur, a = peak * this.att(pos);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch[0], t);
    o.frequency.linearRampToValueAtTime(pitch[1], t + attack + dur * 0.15);
    o.frequency.exponentialRampToValueAtTime(pitch[2], end);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = vibRate;
    lg.gain.value = pitch[1] * vib;
    lfo.connect(lg).connect(o.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(a, t + attack);
    env.gain.linearRampToValueAtTime(a * 0.75, t + attack + (dur - attack) * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    const osc = [o, lfo];
    let src = o;
    if (rasp) {
      const fl = ctx.createOscillator(), fg = ctx.createGain(), am = ctx.createGain();
      fl.type = 'square';
      fl.frequency.value = 35 + Math.random() * 35;
      fg.gain.value = rasp * 0.5;
      am.gain.value = 1 - rasp * 0.5;
      fl.connect(fg).connect(am.gain);
      o.connect(am);
      src = am;
      osc.push(fl);
    }
    for (const [F, Q, g] of vowel) {
      const f = ctx.createBiquadFilter(), fg = ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = F; f.Q.value = Q;
      fg.gain.value = g;
      src.connect(f).connect(fg).connect(env);
    }
    env.connect(this.master);
    for (const n of osc) { n.start(t); n.stop(end + 0.05); }
    if (breath) this.noiseHit({ type: 'bandpass', freq: vowel[1][0] * 1.3, q: 1.5, peak: peak * breath, attack, decay: dur, pos, delay });
  }
  /** Someone killed: one of the 24, at random (never the same one twice running) */
  death(pos) {
    if (!this.ok || this.att(pos) < 0.03) return;
    const now = this.ctx.currentTime;
    this.deaths = (this.deaths || []).filter((t) => now - t < 1.5);
    // A blast that kills a crowd: a chorus of them, but not so many the sound chokes
    if (this.deaths.length >= 16) return;
    this.deaths.push(now);
    let j = Math.floor(Math.random() * (GORE.length - 1));
    if (j >= (this.lastDeath ?? -1)) j++;
    this.lastDeath = j;
    // Spread a little, so a crowd killed at once doesn't all start on the same instant
    GORE[j](this, pos, this.deaths.length > 1 ? Math.random() * 0.25 : 0);
  }

  // Continuous layers -------------------------------------------------------
  setThrust(level, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.thrust.g.gain.setTargetAtTime(level * 0.22, t, 0.06);
    this.thrust.f.frequency.setTargetAtTime(500 + level * 900, t, 0.08);
    this.thrustLow.g.gain.setTargetAtTime(level * 0.5, t, 0.08);
  }
  setBeam(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.beamLoop.g.gain.setTargetAtTime(level * 0.35, t, 0.04);
    this.beamOsc.gain.setTargetAtTime(level * 0.09, t, 0.04);
  }
}

// ---- deaths ---------------------------------------------------------------------

// Vowel formants: [frequency, Q, gain]. Scaled up for women and children.
const VOWELS = {
  a: [[800, 6, 3.2], [1200, 7, 2.2], [2500, 8, 1.2]],
  e: [[420, 6, 3.2], [2000, 8, 2], [2650, 9, 1.2]],
  i: [[300, 6, 3], [2300, 9, 2.2], [3000, 9, 1.3]],
  o: [[520, 6, 3.4], [900, 7, 2.2], [2400, 8, 1]],
  u: [[360, 6, 3.4], [800, 7, 2], [2300, 8, 0.9]],
};
const vow = (v, k = 1) => VOWELS[v].map(([F, Q, g]) => [F * k, Q, g]);
const vary = () => 0.9 + Math.random() * 0.22;

// The sounds of someone killed: twelve squishes, then twelve screams. Each is (sound, pos, delay).
const GORE = [
  // A wet slap
  (S, pos, d) => {
    const f = vary();
    S.noiseHit({ type: 'lowpass', freq: 2600 * f, freqEnd: 180, q: 4, peak: 0.45, decay: 0.22, pos, delay: d });
    S.tone({ type: 'sine', freq: 170 * f, freqEnd: 45, peak: 0.3, decay: 0.16, pos, delay: d });
  },
  // A squelch, rising
  (S, pos, d) => {
    const f = vary();
    S.noiseHit({ type: 'bandpass', freq: 380 * f, freqEnd: 1700 * f, q: 9, peak: 0.55, attack: 0.03, decay: 0.28, pos, delay: d });
    S.noiseHit({ type: 'lowpass', freq: 700, freqEnd: 200, q: 3, peak: 0.2, decay: 0.2, pos, delay: d });
  },
  // Crunching through and squishing
  (S, pos, d) => {
    S.noiseHit({ type: 'highpass', freq: 2600, peak: 0.35, decay: 0.05, pos, delay: d });
    S.noiseHit({ type: 'highpass', freq: 3200, peak: 0.25, decay: 0.04, pos, delay: d + 0.045 });
    S.noiseHit({ type: 'lowpass', freq: 1500, freqEnd: 160, q: 5, peak: 0.4, decay: 0.3, pos, delay: d + 0.03 });
  },
  // A deep splat
  (S, pos, d) => {
    S.noiseHit({ buffer: S.brown, type: 'lowpass', freq: 900, freqEnd: 80, q: 3, peak: 0.7, decay: 0.4, pos, delay: d });
    S.tone({ type: 'sine', freq: 95, freqEnd: 32, peak: 0.42, decay: 0.3, pos, delay: d });
  },
  // A gurgle: bubbles rising through it
  (S, pos, d) => {
    const f = vary();
    for (let i = 0; i < 9; i++) {
      const b = (240 + Math.random() * 260) * f;
      S.tone({ type: 'sine', freq: b, freqEnd: b * 2.4, peak: 0.12, attack: 0.004, decay: 0.045, pos, delay: d + i * 0.055 + Math.random() * 0.03 });
    }
    S.noiseHit({ type: 'bandpass', freq: 500 * f, q: 3, peak: 0.12, attack: 0.05, decay: 0.5, pos, delay: d });
  },
  // Drips pattering down
  (S, pos, d) => {
    for (let i = 0; i < 8; i++) {
      const b = 700 + Math.random() * 900;
      S.tone({ type: 'sine', freq: b, freqEnd: b * 0.45, peak: 0.07, decay: 0.05, pos, delay: d + 0.08 + i * 0.07 + Math.random() * 0.05 });
    }
  },
  // A suction pop
  (S, pos, d) => {
    const f = vary();
    S.tone({ type: 'sine', freq: 190 * f, freqEnd: 950 * f, peak: 0.3, attack: 0.005, decay: 0.07, pos, delay: d });
    S.noiseHit({ type: 'bandpass', freq: 1200 * f, q: 4, peak: 0.2, decay: 0.06, pos, delay: d });
  },
  // A long resonant squash
  (S, pos, d) => {
    const f = vary();
    S.noiseHit({ type: 'lowpass', freq: 1300 * f, freqEnd: 140, q: 12, peak: 0.45, attack: 0.01, decay: 0.55, pos, delay: d });
    S.noiseHit({ type: 'bandpass', freq: 650 * f, freqEnd: 300, q: 5, peak: 0.25, attack: 0.02, decay: 0.45, pos, delay: d });
  },
  // Bones snapping
  (S, pos, d) => {
    for (let i = 0; i < 3; i++) S.noiseHit({ type: 'bandpass', freq: 2600 + Math.random() * 1400, q: 3, peak: 0.4, attack: 0.001, decay: 0.035, pos, delay: d + i * 0.06 + Math.random() * 0.02 });
    S.tone({ type: 'triangle', freq: 220, freqEnd: 70, peak: 0.2, decay: 0.12, pos, delay: d });
  },
  // A slosh
  (S, pos, d) => {
    const f = vary();
    S.noiseHit({ type: 'bandpass', freq: 600 * f, freqEnd: 260, q: 2, peak: 0.4, attack: 0.08, decay: 0.42, pos, delay: d });
    S.noiseHit({ type: 'lowpass', freq: 400, peak: 0.2, attack: 0.1, decay: 0.3, pos, delay: d + 0.05 });
  },
  // A meaty thud
  (S, pos, d) => {
    S.tone({ type: 'triangle', freq: 150, freqEnd: 48, peak: 0.4, decay: 0.22, pos, delay: d });
    S.noiseHit({ type: 'lowpass', freq: 520, freqEnd: 120, peak: 0.4, decay: 0.2, pos, delay: d });
  },
  // A spray hissing out, and spattering
  (S, pos, d) => {
    S.noiseHit({ type: 'highpass', freq: 2200, freqEnd: 4200, peak: 0.22, attack: 0.01, decay: 0.55, pos, delay: d });
    for (let i = 0; i < 5; i++) S.noiseHit({ type: 'bandpass', freq: 1800 + Math.random() * 1500, q: 5, peak: 0.12, decay: 0.03, pos, delay: d + 0.2 + i * 0.06 });
  },

  // A man's yell
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [170 * f, 290 * f, 150 * f], vowel: vow('a'), dur: 1.1, vib: 0.03, rasp: 0.3, peak: 0.2, pos, delay: d }); },
  // A woman's shriek
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [520 * f, 980 * f, 640 * f], vowel: vow('i', 1.15), dur: 1.3, vib: 0.025, vibRate: 7, peak: 0.17, pos, delay: d }); },
  // A child screaming
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [750 * f, 1250 * f, 900 * f], vowel: vow('e', 1.35), dur: 1.0, vib: 0.03, vibRate: 8, peak: 0.15, pos, delay: d }); },
  // A yelp, cut off
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [400 * f, 650 * f, 380 * f], vowel: vow('a', 1.1), dur: 0.22, attack: 0.02, peak: 0.2, pos, delay: d }); },
  // Screaming through blood: a wet warble, breaking up
  (S, pos, d) => {
    const f = vary();
    S.voice({ pitch: [260 * f, 380 * f, 180 * f], vowel: vow('o'), dur: 1.0, vib: 0.12, vibRate: 14, rasp: 0.5, breath: 0.3, peak: 0.18, pos, delay: d });
    for (let i = 0; i < 5; i++) S.tone({ type: 'sine', freq: 300, freqEnd: 650, peak: 0.06, decay: 0.04, pos, delay: d + 0.2 + i * 0.13 });
  },
  // A long wail, falling away
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [650 * f, 700 * f, 190 * f], vowel: vow('a', 1.1), dur: 1.6, vib: 0.04, peak: 0.16, pos, delay: d }); },
  // A hoarse shout
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [200 * f, 330 * f, 220 * f], vowel: vow('a'), dur: 0.6, rasp: 0.8, breath: 0.35, peak: 0.2, pos, delay: d }); },
  // "Oh, no--"
  (S, pos, d) => {
    const f = vary();
    S.voice({ pitch: [300 * f, 340 * f, 280 * f], vowel: vow('o', 1.05), dur: 0.3, attack: 0.03, peak: 0.16, pos, delay: d });
    S.voice({ pitch: [320 * f, 400 * f, 230 * f], vowel: vow('u', 1.05), dur: 0.55, attack: 0.03, peak: 0.17, pos, delay: d + 0.38 });
  },
  // A whimper
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [380 * f, 420 * f, 300 * f], vowel: vow('u', 1.1), dur: 0.7, vib: 0.08, vibRate: 4.5, breath: 0.45, peak: 0.1, pos, delay: d }); },
  // A choked gasp
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [220 * f, 260 * f, 160 * f], vowel: vow('e'), dur: 0.35, attack: 0.02, rasp: 0.6, breath: 0.9, peak: 0.15, pos, delay: d }); },
  // A squeal
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [1100 * f, 1700 * f, 1300 * f], vowel: vow('i', 1.4), dur: 0.7, vib: 0.03, vibRate: 9, peak: 0.12, pos, delay: d }); },
  // A groan of agony
  (S, pos, d) => { const f = vary(); S.voice({ pitch: [130 * f, 150 * f, 95 * f], vowel: vow('o'), dur: 1.5, attack: 0.15, vib: 0.03, vibRate: 5, rasp: 0.35, peak: 0.2, pos, delay: d }); },
];
