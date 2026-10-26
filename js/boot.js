// Boot: the title theme (VECTORS) downloads before anything else, so the title screen opens
// with it playing. Only then do the title screen and the game load (main.js loads behind the
// title). Browsers only start audio after a tap, click or key press, so when this one blocks
// autoplay the boot screen asks for one first. With the Music setting off, it skips straight on.

import { music } from './music.js';
import { startGamepadNavigation } from './input.js';

startGamepadNavigation();

const $ = (s) => document.querySelector(s);
const boot = $('#boot');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Waits for a tap, click or key press and starts the music inside it.
function gate() {
  const btn = $('#boot-start');
  $('#boot-title').textContent = 'Title theme loaded';
  $('#boot-prompt').textContent = isTouch ? 'Tap to power up' : 'Click, press a key or controller A to power up';
  btn.hidden = false;
  if (!isTouch) btn.focus({ preventScroll: true });
  return new Promise((resolve) => {
    const go = (e) => {
      if (e.type === 'keydown' && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key))) return;
      e.preventDefault();
      btn.removeEventListener('click', go);
      window.removeEventListener('keydown', go);
      music.unlock();
      resolve();
    };
    btn.addEventListener('click', go);
    window.addEventListener('keydown', go);
  });
}

if (music.enabled) {
  await music.preload((p) => { $('#boot-bar').style.width = `${Math.round(p * 100)}%`; });
  if (!(await music.autoplay())) await gate();
}
await import('./title/title.js');
boot.classList.add('is-leaving');
setTimeout(() => boot.remove(), 400);
import('./main.js');
