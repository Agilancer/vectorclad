# HV-02 Obsidian — additional VECTORCLAD player frame

This revised Three.js armor model uses the user's `!  HEAVY 2.jpg` as a visual reference. Its broad shoulder pylons, recessed helmet, deep faceted chest, long thigh armor, blade shins, black finish, ivory panels and brass mechanisms are authored as geometry. The supplied image is not redistributed in this package.

The first narrow armor draft was replaced after feedback. This is a stylized procedural interpretation of the reference, not a scanned or production-quality reproduction of the photographed model.

The current revision has a wedge helmet: a flat gold brow with vent slots juts over two round cyan lamps, with a black crown and crest lamp, gold side plates carrying stacked cyan slit lights, a black and gold chin guard and two horns swept back. Backpack pylons are rotated 90 degrees in mirrored directions, pitched forward and hung low on the back, slimmed to a third of their original depth and splayed like folded wings, tops in and lower ends out. `HeavyMech.animate()` adds secondary motion on top of the inherited animation: each pylon hangs on a sprung pivot that trails the chest's movement (leaning away from a sideways dash, sweeping back on a forward dash, overshooting when the mech stops) and, while falling, slides up and out with its lower end flared wider like an air brake. Boots end in single-point tips with long rear calf fins. Sole vernier hardware is recessed above the tips.

The supplied texture ZIP contributes its plain satin-gold and matte-black pages. Reduced 512-pixel JPEG copies are in `textures/` and embedded in the module so copying the model does not require additional texture paths. Custom shell geometry includes planar UVs for these materials. Other pages in the ZIP are not automatically applied.

## Preview

Open `preview.html` in a browser with internet access. It loads VECTORCLAD's actual player rig, atlas helpers and original texture sheets from a pinned repository revision through jsDelivr, and builds the new armor locally.

- **Reference stance:** straight static inspection pose to compare the armor silhouette with the supplied photo.
- **Game idle, walk, run, boost dash, jump jets, aim, shield guard and reload:** the inherited player animation code.
- **Compare both:** the stock FS-07A Vanguard and the heavy frame on the same skeleton scale.

Drag to rotate and scroll to zoom. No original image texture, paid service or external 3D mesh is required.

## Use in the game

Copy `heavy-mech.js` to `assets/heavy-frame/heavy-mech.js`. In `js/main.js`:

```js
import { HeavyMech } from '../assets/heavy-frame/heavy-mech.js';

// Use the same material and glow-texture objects as the standard player.
mech = new HeavyMech(mats, fx.glowTex);
```

This module subclasses the repository's existing `Mech`; it does not duplicate or replace the walking code. `animate` (which only adds the pylon motion after the stock pass), `stepFeet`, `solveLegIK`, `resetFeet`, `footWorld`, `attach`, joint origins, leg lengths, all seven weapon sockets and all ten thrusters come from the stock model. Weapon recoil, arm aiming, shield positioning, reload and airborne poses therefore use the original hierarchy. The player faces +Z, as in `js/mech.js`.

The constructor removes the original armor render surfaces, keeps the actual joint groups and mechanical endpoints, and mounts new armor on those groups. Newly generated armor has its own fixed black, ivory and brass materials; the stock paint palette does not recolor it. Existing outline settings can control `heavy.outlines` just as they do on the standard frame.

`poseReference()` is an inspection pose only. It is deliberately separate from the gameplay animation. The game should continue to call `animate(dt, state)` exactly as it does for the current player.

This asset package is stored in assets/heavy-frame on the main branch. It includes the new player class and an executable preview. It does not automatically make the model selectable in the game's hangar. When adding a live frame selector, preserve world calibration from the existing standard frame and transfer equipped weapons to the same socket names; changing armor should not resize the city or reset ammo.

## Validation

Browser checks against VECTORCLAD revision `0dbd9608c0d6a2a2771e32ebf6cf0ede4587a46e` confirmed:

- The animation, planted-foot step and IK function references are identical between the standard and heavy classes.
- All weapon mount local positions are unchanged.
- Both frames retain ten operational thrusters.
- Walking hip, knee and ankle rotations agree to floating-point precision under the same motion input.
- Idle, walk, run, dash, jump, aim, shield and reload render without page or shader errors.

These checks establish rig compatibility and preview rendering, not full live-game combat integration or target-device performance.
