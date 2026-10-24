# VECTORCLAD / AX-19 Citadel

An original procedural Three.js mech and three detachable equipment models. The supplied `mkv.stl` was inspected in front, side and rear views as a design reference. The source mesh contains 737,044 triangles, a handheld rifle, a forearm shield and rectangular upper weapon racks. None of its triangles, surfaces, textures or embedded weapons are included in this package.

## New design

Citadel uses a gold anime helmet with layered brow and cheek plates, a defined jaw, swept antennae, circular ear mechanisms, cyan eyes and exposed neck cables. The body has a split horseshoe chest around a circular reactor chamber, layered shoulder armor, raised circular six-cell launcher drums, segmented thigh armor, forked shin plates, forward-facing split toes and a low radiator backpack. Its finish is glacier ceramic over naval structure with copper mechanisms, gold head armor and cyan optics.

## Detailed revision and generated textures

The current equipped model contains approximately 104,422 triangles versus 36,954 in the first version, excluding ink-outline shells. Three-step bevels, denser circular joints, smoother hoses, extra fasteners, working accessory hydraulics and layered shoulder plates add geometry rather than relying only on a material change.

## Launcher, fin and mechanical revision

The round shoulder equipment is now a pair of six-round missile cassettes in trunnion yokes. Each has a load-bearing bracket tied to the torso, structural and hydraulic-looking braces, deep launch sleeves, recessed round noses, a central latch and a rear service cover. These remain visual equipment rather than registered gameplay weapons.

Swept, mirrored stabilizer fins are attached to the shoulder armor and backpack. Navy shells, pale inset panels and gold edging follow the standard VECTORCLAD player's fin language. Head, joint hardware, launcher collars, weapons and trim now use the same satin-gold material; the legacy `copper` material slot is an alias of that alloy.

Online reference research used Armored Core VI: Fires of Rubicon and Front Mission 3: Remake. The original Citadel geometry takes design-language cues from their exposed mechanical systems, compact cores, modular armored assemblies and serviceable joints; no game meshes, textures, named parts or logos are copied. Changes include working thigh and calf hydraulic rams driven by the existing animation update, reinforced knee frames, squared bolt-on shoulder modules, compact chest service blocks and separate vented propulsion housings around the original thrusters.

References:

- https://www.bandainamcoent.com/games/armored-core-vi-fires-of-rubicon
- https://en.bandainamcoent.eu/armored-core/news/armored-core-6-fires-of-rubicon-beginners-guide-basic-strategy-and-combat-theory
- https://store.steampowered.com/app/3795900/FRONT_MISSION_3_Remake/

Both feet use a short rear heel and elongated toes along the rig's +Z forward axis. Named toe and heel markers were checked in the walking pose: their normalized forward components were about 0.99 and 0.96. The original ankle IK still controls the feet.

`textures/citadel-armor-atlas.png` is a new four-surface atlas made with the built-in ImageGen tool: glacier ceramic, naval ceramic, satin gold and graphite mechanism. The actual generated image is 1254 by 1254 pixels; its four material regions are also saved as separate PNGs. `citadel-armor-atlas.jpg` is a 1024-pixel runtime copy, embedded in `citadel-kit.js` so the JavaScript package remains portable. The loader crops each quadrant into its own material surface and uses planar box-projected UVs for plate and hull geometry. Circular parts and hoses keep their native UVs.

The final generation prompt is saved in `textures/generation-prompt.txt`. These are base-color surfaces; no generated normal, roughness or metalness maps are claimed. Material roughness and metalness remain explicit shader settings. The new texture and geometry code applies to the independent gun and shield models too.

The source reference's tall rectangular rack arrangement, long rectangular torso projections, helmet silhouette, large single-piece shield and tubular rifle have been replaced. This is a newly authored design using generic functional mech concepts, not an STL conversion or a claim of copyright clearance. The source's origin and license are unknown here. Changes alone cannot guarantee immunity from a claim: https://www.copyright.gov/help/faq/faq-fairuse.html

## Files

- `citadel-kit.js`: shared original geometry helpers and materials.
- `citadel-mech.js`: `CitadelMech`, derived from VECTORCLAD's actual `Mech` class.
- `citadel-weapons.js`: independently usable rifle, cannon and folding shield.
- `preview.html`: standalone interactive demonstration; internet access is required for pinned Three.js r170, the original VECTORCLAD rig and its base textures through jsDelivr.

The preview offers a bare mech, rifle and shield, or both guns; each weapon can also be inspected separately. Idle, walk, run, boost dash, jump jets, aiming/recoil, shield guard and reload use the original player animation methods. Drag to orbit and scroll to zoom.

## Game integration

Copy the three JavaScript files together to `assets/citadel-frame/` in VECTORCLAD. They import the game's existing `js/three.js`, `js/mech.js` and `js/atlas.js`; no loader or build step is needed. Existing code that animates the standard `Mech` also animates this class:

```js
import { CitadelMech } from '../assets/citadel-frame/citadel-mech.js';
import {
  buildSpearlineRifle, buildBreakerCannon, buildAegisShield,
} from '../assets/citadel-frame/citadel-weapons.js';

const mech = new CitadelMech(mats, fx.glowTex);
scene.add(mech.root);
const rifle = buildSpearlineRifle();
const cannon = buildBreakerCannon();
const shield = buildAegisShield();
mech.attach('rightHand', rifle.group);
mech.attach('leftShield', shield.group);
// For dual guns instead:
// mech.attach('leftShield', null);
// mech.attach('leftHand', cannon.group);

mech.animate(dt, playerAnimationState); // unchanged VECTORCLAD state interface
rifle.animate(time, { recoil: rightHandRecoil });
cannon.animate(time, { recoil: leftHandRecoil });
shield.setFolded(false);
rifle.muzzles[0].getWorldPosition(projectileOrigin);
```

Authored dimensions use the same game-unit skeleton as the standard player, with +Y up and +Z forward. Calibrate the world from the standard player's head height when adding a frame selector so changing appearance does not resize the city.

All seven weapon socket positions and ten operational thrusters are retained. Hand weapons point along local +Z with the grip at the origin. Each builder returns its own `{group, muzzles, ...}` object; guns are never fused with the mech geometry. The rifle has one muzzle, and the cannon has six. Each gun exposes a recoil carriage and an `animate` helper. The shield has two folding leaves.

To use the guns in the game's existing `WeaponSystem`, register their builders and weapon definitions in `js/weapons.js`; the examples above attach the models but do not implement projectile, damage, ammo or reload gameplay. The preview moves recoil carriages and uses the player's reload pose; it is not a full combat integration. The decorative launcher drums are part of the new frame appearance, not functioning missile weapons.

Weapon builders own their materials and expose `dispose()` for cleanup after detachment. The mech retains base-rig shared thruster and piston resources, so avoid recursively disposing shared base materials when swapping player frames. Its new color scheme is fixed and independent of the original hangar paint swatches. Existing outline toggles can control its `outlines` array.

## Validation

The animation delegates to the standard player, then reduces upper-body hunch by up to 0.17 radians while compensating head and aiming angles. Crouch and dash retain their forward lean. Browser checks confirmed the identical IK method reference, unchanged local positions for all seven sockets, and matching hip/knee/ankle rotations during walking to floating-point precision. Separate rifle and shield attachment and all six cannon muzzle markers were verified. Every preview motion, both-gun loadout, bare model and isolated equipment view rendered without browser or shader errors.

No source STL mesh is distributed. This package is stored under assets/citadel-frame on main. It includes the source assets and an executable preview; registering the frame and weapons in the game selector remains a separate integration step.


