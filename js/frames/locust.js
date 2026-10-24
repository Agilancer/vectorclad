import { Vanguard } from '../mech.js';

// ---------------------------------------------------------------------------
// RJ-6 Locust: a light jumper built on the Vanguard. (Starting point: the Vanguard
// itself at this frame's scale; the frame's own parts are built over it.)
// ---------------------------------------------------------------------------

const RIG = {
  scale: 0.82,
  gait: { cadence: 0.9, lift: 0.42 },
};

/** The frame's own paint scheme, added to the hangar's list */
export const PAINT = { id: 'locust', name: 'Locust Venom', armor: '#6f8c3a', second: '#2f3328', frame: '#5c6152', trim: '#e3c34a', eye: '#ff5a3a' };

export class Locust extends Vanguard {
  constructor(mats, glowTex) { super(mats, glowTex, RIG); }
}
