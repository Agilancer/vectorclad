import { Mech } from './mech.js';
import { HeavyMech } from '../assets/heavy-frame/heavy-mech.js';
import { PontifexMech } from '../assets/pontifex-frame/pontifex-mech.js';
import { AmethystMech } from '../assets/amethyst-frame/amethyst-mech.js';

// The frames in the hangar. All share the stock rig, its sockets and its thrusters, so weapons
// move across unchanged; the world is always scaled from the Vanguard (js/main.js).
// ap: armor points. walk, dash: top speeds (units/s). boost: how long a full gauge lasts, as a
// share of the Vanguard's. jump: launch speed. paint: whether the hangar's paint schemes apply.
// rise: how much higher the frame's shoulders sit than the Vanguard's, so the lifter's clamps hang it lower.
export const FRAMES = {
  vanguard: {
    id: 'vanguard', code: 'FS-07A', name: 'Vanguard', role: 'Assault prototype',
    ap: 1000, walk: 7.5, dash: 36, boost: 1, jump: 15, paint: true,
    blurb: 'The field-trial frame: a beast head thrust forward on red neck rams, blade knees and talon feet. Quick off the line, with the longest boost in the bay.',
    build: (mats, glowTex) => new Mech(mats, glowTex).batch(),
  },
  obsidian: {
    id: 'obsidian', code: 'HV-02', name: 'Obsidian', role: 'Heavy assault frame',
    ap: 1450, walk: 6.4, dash: 31, boost: 0.8, jump: 13.5, paint: false,
    blurb: 'Black, ivory and gold heavy armor on the same skeleton: a crested gold helmet, swept wing pylons, long cuirasses and blade shins. Slower and shorter on boost, but it takes nearly half again the punishment.',
    build: (mats, glowTex) => new HeavyMech(mats, glowTex).batch(),
  },
  pontifex: {
    id: 'pontifex', code: 'PX-09', name: 'Pontifex', role: 'Long-limbed skirmisher',
    ap: 880, walk: 8.4, dash: 39, boost: 1.1, jump: 16.5, paint: false, rise: 0.78, // 1.75 at full size; the frame is drawn at PontifexMech.SIZE (0.88)
    blurb: 'White ceramic plate on a dark, sinewy frame: a bow-fronted helm with side eye slits, deep finned pauldrons, swept back wings and the longest legs in the bay. Tall, quick and light on armor.',
    build: (mats, glowTex) => new PontifexMech(mats, glowTex).batch(),
  },
  amethyst: {
    id: 'amethyst', code: 'AM-05', name: 'Amethyst', role: 'Pylon-winged striker',
    ap: 1050, walk: 7.9, dash: 38, boost: 1.05, jump: 16, paint: false, rise: 1.4, // measured by tools/tests/amethyst.js; the frame is drawn at AmethystMech.SIZE (0.84)
    blurb: 'Purple and white plate with copper fittings: a beaked helm with a cyan gem and long swept antennas, emblem pauldrons, and two blade pylons on sprung mounts that trail the frame and flare like air brakes in a fall. Long-legged and quick.',
    build: (mats, glowTex) => new AmethystMech(mats, glowTex).batch(),
  },
};

export const FRAME_IDS = Object.keys(FRAMES);
