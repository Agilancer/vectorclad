import { Vanguard } from '../mech.js';

// ---------------------------------------------------------------------------
// TK-40 Bastion: a heavy fortress built on the Vanguard. (Starting point: the Vanguard
// itself at this frame's scale; the frame's own parts are built over it.)
// ---------------------------------------------------------------------------

const RIG = {
  scale: 1.38,
  gait: { cadence: 1.2, sway: 0.15, settleTime: 0.55 },
  hunch: 0.14, hunchIdle: 0.06, armOut: 0.28,
};

/** The frame's own paint scheme, added to the hangar's list */
export const PAINT = { id: 'bastion', name: 'Bastion Slate', armor: '#56606e', second: '#25282e', frame: '#6a707a', trim: '#e2b44a', eye: '#5ff0ff' };

export class Bastion extends Vanguard {
  constructor(mats, glowTex) { super(mats, glowTex, RIG); }

  buildPelvis() {
    super.buildPelvis();
    // Hip pod mounts on the pelvis flanks, behind the hip blades
    for (const [key, s] of [['hipR', -1], ['hipL', 1]]) this.mount(key, this.pelvis, s * 1.0, 0.42, -0.86, 0, 0, -s * Math.PI / 2);
  }

  buildBackMounts(chest) {
    super.buildBackMounts(chest);
    // Back deck between the shoulder mounts
    this.mount('backC', chest, 0, 1.5, -1.0, -0.12);
  }
}
