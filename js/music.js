// The soundtrack, by THEDEMONMECHANIZEDMACHINEDESTROYER. VECTORS is the title theme: boot.js
// downloads it before the title screen loads, and it plays on the title. Getting past the title
// drops the music to GAME_VOL so the effects sit on top of it. After VECTORS the ROTATION
// songs play in a shuffled order, then VECTORS again, then a new shuffle, for as long as the
// page is open. The MP3s come from tools/build_music.py.
//
// One <audio> element plays every song, since iOS lets an element that started inside a tap
// go on to play new sources. Each song downloads whole while the one before it plays.
// The music pauses while the page is hidden or the hangar's Music toggle is off.

import { audioContext } from './audio.js';

const DIR = 'audio/music/';
const TITLE = 'vectors.mp3';
const ROTATION = [
  'oh-no-robot-insects.mp3', 'sentient-plague.mp3', 'they-came-from-the-sky.mp3',
  'vectors-ii.mp3', 'vectors-iii.mp3', 'vectors-iv.mp3', 'vectors-v.mp3',
];
const TITLE_VOL = 1;
const GAME_VOL = 0.55;
const DUCK_SECS = 1.2;
const PREFETCH_AT = 30; // seconds into a song; leaves the network to the game's textures until then

// iOS ignores audio.volume (it always reads back 1), so there the element is routed through a
// Web Audio gain node instead, which has to be set up inside a tap.
const fixedVolume = (() => { const a = new Audio(); a.volume = 0.5; return a.volume === 1; })();

function savedSetting() {
  try { return JSON.parse(localStorage.getItem('vectorclad.settings'))?.music !== false; } catch (_) { return true; }
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function download(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const total = +res.headers.get('content-length') || 0;
  if (!onProgress || !total || !res.body) return URL.createObjectURL(await res.blob());
  const reader = res.body.getReader(), parts = [];
  for (let got = 0; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onProgress(Math.min(1, (got += value.length) / total));
  }
  return URL.createObjectURL(new Blob(parts, { type: res.headers.get('content-type') || 'audio/mpeg' }));
}

class Music {
  constructor() {
    this.el = new Audio();
    this.el.addEventListener('ended', () => this.advance());
    this.el.addEventListener('timeupdate', () => { if (this.el.currentTime > PREFETCH_AT) this.fetchSong(this.upNext()); });
    this.downloads = new Map(); // song -> Promise of its object URL
    this.ready = new Map();     // song -> object URL, once downloaded
    this.queue = [];
    this.song = TITLE;
    this.enabled = savedSetting();
    this.started = false;
    this.gain = null;
    this.setVolume(TITLE_VOL, 0);
    document.addEventListener('visibilitychange', () => this.sync());
  }

  fetchSong(song, onProgress) {
    if (!this.downloads.has(song)) {
      this.downloads.set(song, download(DIR + song, onProgress)
        .then((url) => { this.ready.set(song, url); return url; })
        .catch((err) => console.warn(`VECTORCLAD: could not download ${song}; it will stream instead.`, err)));
    }
    return this.downloads.get(song);
  }

  /** Downloads the title theme. Never rejects: a failed download just streams later. */
  preload(onProgress) { return this.fetchSong(TITLE, onProgress); }

  /** Starts the title theme without a gesture. False if the browser wants a tap first. */
  async autoplay() {
    if (fixedVolume) return false;
    this.started = true;
    this.play(TITLE);
    try { await this.el.play(); return true; } catch (_) { this.started = false; this.el.pause(); return false; }
  }

  /** Call inside a tap, click or key press: starts the music and, on iOS, its gain node. */
  unlock() {
    if (fixedVolume && !this.gain) {
      const ctx = audioContext();
      if (ctx) {
        this.gain = ctx.createGain();
        this.gain.gain.value = this.level;
        ctx.createMediaElementSource(this.el).connect(this.gain).connect(ctx.destination);
      }
    }
    if (!this.started) { this.started = true; this.play(this.song); }
    else this.sync();
  }

  /** The player is past the title: drop the music under the effects. */
  duck() { this.setVolume(GAME_VOL, DUCK_SECS); }

  setEnabled(on) {
    this.enabled = on;
    if (on && !this.started) this.unlock();
    else this.sync();
  }

  play(song) {
    this.song = song;
    this.el.src = this.ready.get(song) || DIR + song;
    this.sync();
  }

  upNext() {
    if (!this.queue.length) this.queue = [...shuffle(ROTATION), TITLE];
    return this.queue[0];
  }

  advance() {
    this.upNext();
    this.play(this.queue.shift());
  }

  // Plays or pauses to match: started, switched on in the hangar, and the page in view.
  sync() {
    const want = this.started && this.enabled && !document.hidden;
    if (want && this.gain && this.gain.context.state !== 'running') this.gain.context.resume();
    if (want && this.el.paused) this.el.play().catch(() => {});
    else if (!want && !this.el.paused) this.el.pause();
  }

  setVolume(v, secs) {
    this.level = v;
    if (this.gain) {
      this.gain.gain.setTargetAtTime(v, this.gain.context.currentTime, secs / 3);
      return;
    }
    cancelAnimationFrame(this.fade);
    const from = this.el.volume, t0 = performance.now();
    const step = (now) => {
      const k = secs > 0 ? Math.min(1, Math.max(0, now - t0) / (secs * 1000)) : 1;
      this.el.volume = from + (v - from) * k;
      if (k < 1) this.fade = requestAnimationFrame(step);
    };
    step(t0);
  }
}

export const music = new Music();
