# VECTORCLAD allied expeditionary force

Eight original soldier roles, three small combat frames, five detachable weapons, four manually drawn skins, and fourteen procedural motions. Three.js r170. +Y up, +Z forward, origin at the ground under the feet. Built as reviewable assets; no changes to the live game or its spawn tables are included.

## Inspect

Extract the ZIP and open `standalone-preview.html` directly in a modern browser. It embeds all model, skin and controller code; only Three.js is loaded from its CDN. It includes a true-scale lineup, individual inspection, a weapon rack, an NPC firing-range demonstration and a 48-unit instanced platoon. Motion, weapon and skin can be changed in the controls. Drag to orbit, scroll to zoom.

For module development, serve this directory over HTTP and open `preview.html`.

For example, from the extracted package's parent directory:

```sh
python -m http.server 8766
```

Then open `http://127.0.0.1:8766/allied-force/preview.html`. Three.js loads from jsDelivr; internet access is required unless you replace that one import with the game's local Three.js export.

## Units and equipment

| ID | Role | Body height | Default weapon |
| --- | --- | ---: | --- |
| ranger | Light reconnaissance | 1.82 m | AR-24 assault rifle |
| trooper | Line infantry | 1.88 m | AR-24 assault rifle |
| gunner | Heavy suppression armor | 1.96 m | MG-62 belt-fed machine gun |
| rocketeer | Anti-armor with spare tubes | 1.90 m | RL-9 rocket launcher |
| grenadier | Ammunition harness | 1.86 m | GL-6 revolver grenade launcher |
| lancer | Power pack and capacitors | 1.92 m | HL-4 high-power laser |
| medic | Medical backpack and light armor | 1.80 m | AR-24 assault rifle |
| commander | Radio and helmet antenna | 1.87 m | AR-24 assault rifle |
| kestrel | Scout frame with wing lift ducts | 3.30 m | HL-4 laser |
| bastion | Carrier frame with split windshield and wheel-like joints | 4.40 m | MG-62 machine gun |
| bombard | Artillery frame with six-cell shoulder racks | 4.00 m | RL-9 rocket launcher |

Heights describe the nominal body; equipment and antennas extend beyond them. Every unit accepts every weapon. Guns use local +Z forward and expose muzzle nodes and two grip positions. Rocket-rack geometry is decorative; its cells do not implement extra gameplay weapons. The medic and commander are visual roles; healing and squad commands need game logic.

## Create and drive

```js
import * as THREE from '../../js/three.js';
import {AlliedUnit} from './allied-units.js';

const ally = new AlliedUnit(THREE, {
  type: 'rocketeer', skin: 'vanguard',
  unitsPerMeter: world.city.M
});
scene.add(ally.root);
ally.root.position.set(spawnX, ground, spawnZ);

// Move root X/Z and yaw through your physics/controller, then update the visual rig.
const events = ally.update(dt, {
  action: 'run', speed: 4.8,
  aim: true, aimYaw: 0.15, aimPitch: 0.1,
  fire: false, groundY: ground
});
for (const event of events) {
  if (event.type === 'fire') {
    const {origin, direction} = ally.muzzle();
    // Spawn a game projectile / perform an authoritative raycast here.
  }
}
ally.equip('laser');
```

`unitsPerMeter` is game units per real meter, matching the current People model's `world.city.M`. It is the inverse of the vehicle builders' `metersPerUnit` option. Do not substitute the main mech's raw render height or rescale the city when swapping an actor.

The rig has independent pelvis, waist, head, shoulders, elbows, hips, knees and ankles. Analytic two-bone IK drives the legs and both hands. Gait, run, crouch and aim weights blend; recoil decays independently. The weapon lives on the separate aiming mount while both hands solve toward its grip anchors. Exposed `mounts` include `weapon`, `rightHand`, `leftHand`, `shoulderR`, `shoulderL`, `back`, and `pilot`. `pilot` is a camera anchor for a future controller, not an implemented possession system.

Motion names: `idle`, `walk`, `run`, `strafe`, `aim`, `fire`, `reload`, `crouch`, `jump`, `land`, `hit`, `die`, `boost`, `salute`. Call `ally.play('jump')` to restart a one-shot; `update(dt)` then keeps the chosen action. Jump and boost are visual motions; collision, ground support and jump physics remain the controller's responsibility. The reload pose moves the support hand and weapon; ammo and magazine simulation are not implemented. This is a new rig informed by the player's animation principles, not the main mech's exact animation function or physics solver.

## NPC and instanced rendering adapters

`AlliedSquad` in `squad.js` can follow a leader, face nearby targets and emit `onShot` callbacks. Supply `groundHeight`, optional `resolvePosition` and your own combat callback. Targets expose `{position, alive}` or `{pos, alive}`. Weapon definitions provide example damage, range, interval, speed and splash values in meters/seconds; they are tuning suggestions, not game balance. Convert lengths and projectile speeds using `unitsPerMeter` when writing the game integration.

The adapter does not provide pathfinding, line-of-sight tests, allegiance rules, friendly-fire checks, damage or network authority. The preview range uses inert robot-like training targets and visual tracers. A production controller must use the world's collision and target systems before firing.

`UnitFleet` batches identical type/skin/weapon actors with `InstancedMesh`. Keep the actor roots out of the scene, update their poses, call `fleet.write(i, actor)` and `fleet.commit(count)`. Each fleet must use the same topology. It uses conservative culling, so the game should split large areas into fleets or add bounds. Forty-eight troopers were rendered in roughly 30 calls including the floor and grid. That is a draw-call check, not a frame-rate benchmark. Constructor-per-actor CPU geometry is suitable for a modest ally count; a larger army should share pose-only rig templates or bake animation palettes.

## Manual skins and resources

`skins.js` draws 2048 × 2048 maps with Canvas paths: armor panels, seam edges, brushed metal, fabric weave, scratches, woodland patches, desert stripes and stencils. No image generator or downloaded texture was used for these skins. Four sets are included under `skins/`, each with color (sRGB), roughness and metalness (linear) PNGs. The code creates and caches those same maps at runtime, so no PNG requests are needed for the models.

Vanguard is charcoal/gold; Urban is ivory/cobalt; Woodland is olive/brass with camouflage patches; Desert is sand/copper with broad diagonal markings. Materials and atlases are shared per Three.js namespace and skin for the life of the session. `actor.dispose()` releases actor-owned geometry and decals while preserving shared skin resources. Dispose an instanced fleet before disposing the actors whose geometry it shares.

`validation.json` records model budgets and automated checks. Preview screenshots are included. A full gameplay integration, ragdoll simulation, GLB export, player controller and live combat test are outside this asset package.
