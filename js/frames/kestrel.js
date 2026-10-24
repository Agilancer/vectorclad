import { Vanguard } from '../mech.js';

// ---------------------------------------------------------------------------
// LT-3 Kestrel: a light scout built on the Vanguard. (Starting point: the Vanguard
// itself at this frame's scale; the frame's own parts are built over it.)
// ---------------------------------------------------------------------------

const RIG = {
  scale: 0.84,
  gait: { cadence: 0.9, lift: 0.4 },
};

/** The frame's own paint scheme, added to the hangar's list */
export const PAINT = { id: 'kestrel', name: 'Kestrel Ash', armor: '#c9ccd1', second: '#3b3f47', frame: '#6b707a', trim: '#e0742c', eye: '#7fe6ff' };

export class Kestrel extends Vanguard {
  constructor(mats, glowTex) { super(mats, glowTex, RIG); }
}
