import { Vanguard } from '../mech.js';

// ---------------------------------------------------------------------------
// HV-90 Goliath: a heavy brawler built on the Vanguard. (Starting point: the Vanguard
// itself at this frame's scale; the frame's own parts are built over it.)
// ---------------------------------------------------------------------------

const RIG = {
  scale: 1.3,
  gait: { cadence: 1.15, sway: 0.2, settleTime: 0.5 },
  hunch: 0.32, hunchIdle: 0.12, armOut: 0.26,
};

/** The frame's own paint scheme, added to the hangar's list */
export const PAINT = { id: 'goliath', name: 'Goliath Rust', armor: '#9a4a2c', second: '#2e2a28', frame: '#5e5650', trim: '#d8a240', eye: '#ffb03a' };

export class Goliath extends Vanguard {
  constructor(mats, glowTex) { super(mats, glowTex, RIG); }

  buildPelvis() {
    super.buildPelvis();
    // Hip pod mounts on the pelvis flanks, behind the hip blades
    for (const [key, s] of [['hipR', -1], ['hipL', 1]]) this.mount(key, this.pelvis, s * 1.0, 0.42, -0.86, 0, 0, -s * Math.PI / 2);
  }
}
