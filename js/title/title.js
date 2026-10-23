// Title screen: the first thing on screen after boot.js has loaded the title theme. Shows the
// live VECTORCLAD logo while the game loads behind it. A tap, click or key press fades it out,
// drops the music under the effects, and hands over to the game (the loading screen if
// textures are still coming in, otherwise the intro card).
//
// main.js waits on `titleDone` before it starts rendering, and listens for the
// `vectorclad:start` window event to unlock audio inside the same user gesture.

import { music } from '../music.js';

const $ = (s) => document.querySelector(s);
const titleEl = $('#title');
const startBtn = $('#title-start');
const prompt = $('#title-prompt');
const canvas = $('#title-canvas');

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Same query as the #rotate overlay in style.css: phones held upright. main.js pauses on it too.
export const portraitPhone = matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 600px)');
const FADE_MS = reduceMotion ? 150 : 900;

let resolveDone;
/** Resolves once the title screen has faded out and been removed. */
export const titleDone = new Promise((resolve) => { resolveDone = resolve; });

let logo = null;
let started = false;

prompt.textContent = isTouch ? 'Tap to start' : 'Click or press any key';

// The 3D logo loads separately so the screen still works (text logo) if WebGL or the CDN fails.
import('./logo.js')
  .then(({ createVectorcladLogo }) => {
    if (started) return;
    logo = createVectorcladLogo(canvas, {
      offsetY: 0.07,
      margin: 1.9,
      maxPixelRatio: isTouch ? 1.5 : 2,
      fogParticles: isTouch ? 40 : 72,
      onReady: () => titleEl.classList.add('is-live'),
    });
    syncOrientation();
  })
  .catch((err) => console.warn('VECTORCLAD: 3D title logo unavailable, showing the text logo.', err));

// Pause the logo while the rotate overlay covers it.
function syncOrientation() {
  if (!logo || started || reduceMotion) return;
  if (portraitPhone.matches) logo.pause();
  else logo.play();
}
portraitPhone.addEventListener('change', syncOrientation);

// On phones, ask for fullscreen and a landscape lock. Android honors it; iOS ignores it.
async function preferLandscape() {
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (_) { /* not supported or refused: the rotate overlay still covers portrait */ }
}

function start() {
  if (started || portraitPhone.matches) return;
  started = true;
  music.unlock();
  music.duck();
  window.dispatchEvent(new CustomEvent('vectorclad:start'));
  if (isTouch) preferLandscape();
  window.removeEventListener('keydown', onKey);
  prompt.textContent = 'Launching';
  titleEl.classList.add('is-leaving');
  setTimeout(() => {
    titleEl.hidden = true;
    if (logo) { logo.dispose(); logo = null; }
    resolveDone();
  }, FADE_MS);
}

function onKey(e) {
  if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
  e.preventDefault();
  start();
}

startBtn.addEventListener('click', start);
window.addEventListener('keydown', onKey);
