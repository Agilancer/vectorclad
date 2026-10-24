import { Mech } from './mech.js';
import { HeavyMech } from '../assets/heavy-frame/heavy-mech.js';

// The frames in the hangar. Both share the stock rig, its sockets and its thrusters, so weapons
// move across unchanged; the world is always scaled from the Vanguard (js/main.js).
// ap: armor points. walk, dash: top speeds (units/s). boost: how long a full gauge lasts, as a
// share of the Vanguard's. jump: launch speed. paint: whether the hangar's paint schemes apply.
export const FRAMES = {
  vanguard: {
    id: 'vanguard', code: 'FS-07A', name: 'Vanguard', role: 'Assault prototype',
    ap: 1000, walk: 7.5, dash: 36, boost: 1, jump: 15, paint: true,
    blurb: 'The field-trial frame: a beast head thrust forward on red neck rams, blade knees and talon feet. Quick off the line, with the longest boost in the bay.',
    build: (mats, glowTex) => new Mech(mats, glowTex),
  },
  obsidian: {
    id: 'obsidian', code: 'HV-02', name: 'Obsidian', role: 'Heavy assault frame',
    ap: 1450, walk: 6.4, dash: 31, boost: 0.8, jump: 13.5, paint: false,
    blurb: 'Black, ivory and gold heavy armor on the same skeleton: a crested gold helmet, swept wing pylons, long cuirasses and blade shins. Slower and shorter on boost, but it takes nearly half again the punishment.',
    build: (mats, glowTex) => new HeavyMech(mats, glowTex),
  },
};

export const FRAME_IDS = Object.keys(FRAMES);
