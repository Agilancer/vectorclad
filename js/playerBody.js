// The player frame's size, for everything that tests against it: spider and scorpion
// hits (a capsule from its hips to its head), the trees it walks into and its collision
// cylinder. main.js sets the scale when a frame is picked; the Vanguard is 1.
export const BODY = { scale: 1, r: 1.5, h: 7 };

export function setBodyScale(k) {
  BODY.scale = k;
  BODY.r = 1.5 * k;
  BODY.h = 7 * k;
}
