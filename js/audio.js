// Synthesized sound effects. Nothing is loaded from disk; every sound is
// built from oscillators and filtered noise when it plays.

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
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
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

  noiseHit({ type = 'lowpass', freq = 800, freqEnd, q = 1, peak = 0.5, attack = 0.003, decay = 0.3, pos, rate = 1, buffer }) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
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
