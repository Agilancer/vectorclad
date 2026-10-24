import { Vanguard } from '../mech.js';

// ---------------------------------------------------------------------------
// KR-11 Revenant: a medium duelist built on the Vanguard. (Starting point: the Vanguard
// itself at this frame's scale; the frame's own parts are built over it.)
// ---------------------------------------------------------------------------

const RIG = {};

/** The frame's own paint scheme, added to the hangar's list */
export const PAINT = { id: 'revenant', name: 'Revenant Bone', armor: '#d8d2c4', second: '#2c2a2e', frame: '#5a5660', trim: '#b8282e', eye: '#ff3a46' };

export class Revenant extends Vanguard {
  constructor(mats, glowTex) { super(mats, glowTex, RIG); }
}
