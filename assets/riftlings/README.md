# VECTORCLAD / Riftling

An original small six-limbed swarm predator, inspired by the ribbed anatomy of the *Aliens* warrior and the layered carapace and scythes of Tyranid Hormagaunts. It is not an exact reproduction of either. Features include a split cranial crest, six eyes, exposed teeth, hinged jaw, scythe arms, secondary grasping limbs, digitigrade hind legs and a seven-joint barbed tail.

Four neon variants: green, orange, purple and blue. A single batch can mix all four colors and independent animation phases.

## Preview

Open `preview.html` in a modern browser with internet access for Three.js r170. Choose a specimen, four colors, a moving swarm (128, 512 or 1,024), or a comparison beside the previously built APC. Select any animation. Drag to orbit; scroll to zoom. Pause holds the current pose. One-shot actions repeat in the preview for inspection; the exported module holds their last frame.

## Animations

| Animation key | Duration | Behavior |
|---|---:|---|
| `idle` | 2.4 s | Breathing, head watch and tail motion; loops |
| `walking` | 1.1 s | Alternating hind-leg stride and grasping limbs; loops |
| `running` | 0.62 s | Faster, wider stride with bounding body motion; loops |
| `attacking` | 0.85 s | Scythe windup, lunge and slash |
| `leaping` | 1.25 s | Compression, raised arc, tucked legs and landing |
| `climbing` | 1.05 s | Upward body orientation and alternating reach; loops |
| `screaming` | 1.65 s | Raised head, open jaw, spread forelimbs and tremor |
| `stalking` | 1.9 s | Lowered cautious stride; loops |
| `crawling` | 1.3 s | Deep crouch and splayed limbs; loops |
| `dodging` | 0.65 s | Lateral duck and evasive sway |
| `hit` | 0.5 s | Recoil and recovery |
| `death` | 1.4 s | Side collapse, curled limbs and held corpse pose |
| `tailwhip` | 0.9 s | Bonus coiled tail lash |

These are visual pose animations. Screaming does not include audio. Leaping includes a visual vertical arc, not ballistic physics. Climbing does not find surfaces or move along a wall automatically. Movement, contact tests, damage and AI belong to the game. Locomotion clips are otherwise in place; the preview's swarm movement is a simple looping demonstration.

## Integration into VECTORCLAD

The module accepts the existing Three.js namespace and the game's runtime meters-per-unit value. It has no build step, model loader, external texture dependency or runtime animation-mixer requirement. This package is stored under `assets/riftlings/`. Adding it does not automatically spawn creatures or change game behavior.

```js
import * as THREE from './three.js';
import { createRiftlingSwarm } from '../assets/riftlings/riftling.js';

const riftlings = createRiftlingSwarm(THREE, {
  capacity: 1024,
  metersPerUnit: METERS, // game's measured value, not a fixed 1.7
  lod: 'low',
});
scene.add(riftlings.mesh);
riftlings.setCount(100);

// positions are already in game/world units; anatomy is converted from meters.
riftlings.setTransform(0, {
  position: [10, 0, 20],
  quaternion: [0, 0, 0, 1],
  scale: 1,
});
riftlings.setColor(0, 'purple');
riftlings.play(0, 'running', { speed: 1, phase: 0.35 });

// Call once per rendered frame with a monotonically increasing simulation time.
// Use the same time origin from creation onward; update before spawning later actors.
riftlings.update(simulationSeconds);
// After a one-shot attack, your state machine chooses the next action.
if (riftlings.isFinished(0)) riftlings.play(0, 'idle');

// Remove GPU resources when the whole batch is no longer needed.
riftlings.dispose();
```

The default creature is approximately 1.35 m tall including crests, with the same meter basis as the vehicles; it is about one ninth of the game's 12.2 m mech height. This is a chosen design scale, not a franchise measurement. +Y is up, -Z is forward. `scale` changes an individual creature uniformly. Pass world orientation as a quaternion. `setCount(n)` activates the first n slots; swap actors into removed slots in your entity pool.

`setColor(slot, color)` accepts a named variant or a Three.js color value. `play(slot, key, {speed, phase})` starts immediately without a crossfade; phase is a normalized starting offset. One-shot clips clamp at their final frame. `samplePose(key, seconds)` returns named bone matrices in authored meters for CPU-side inspection or gameplay helpers. Convert these through the actor transform and world scale for hit tests. It allocates matrices and is not intended for every actor every frame. Built-in mesh raycasting sees the unposed local geometry, so use your own simplified gameplay colliders.

## Swarm rendering

- One `InstancedMesh`, one material and one color/animation batch.
- 25 rigid articulation joints; shared 24 fps pose atlas, interpolated on the GPU.
- 13 clips, 392 baked frames; pose texture about 306 KiB.
- Low detail: approximately 2,400 triangles per creature. Omit `lod: 'low'` for the denser anatomy; choose separate batches for distance-based detail levels.
- No per-creature Object3D hierarchy or CPU AnimationMixer during runtime.
- Animation parameters change only when starting an action; `update()` changes one shared time uniform. Moving actors still require instance transform updates.
- Frustum culling is disabled because animated bounds differ from the unposed source geometry. Partition distant swarms into spatial batches for game integration.
- Dynamic shadow casting is disabled: this custom pose shader does not have a matching animated depth material. Receiving shadows is supported. Use inexpensive contact shadows or implement a matching depth shader if needed.
- No per-creature lights or bloom pass. The luminous seams use emissive shading; optional bloom is the game's responsibility.

A browser validation rendered all 13 animations and a 1,024-creature low-detail swarm without shader/page errors. The swarm itself used one draw call (three including preview floor and grid), approximately 2.5 million triangles. This is a functional rendering check, not an FPS guarantee on target devices. Collision, crowd steering, combat, target-device profiling, atlas paint and outlines are not integrated.

## References consulted

- https://www.sideshow.com/collectibles/aliens-alien-warrior-hot-toys-902693/ — licensed Alien Warrior reference.
- https://www.warhammer-community.com/en-gb/articles/tpKEc7hf/control-consume-and-collect-your-miniature-of-the-month-for-april/ — official Hormagaunt photographs.
- https://warhammer40000.com/games/faction/tyranids/ — official faction description and movement context.
- https://threejs.org/docs/pages/InstancedMesh.html and https://threejs.org/docs/pages/DataTexture.html — rendering APIs.

All geometry and animation curves in this module were authored procedurally for this request. No reference mesh, image or third-party character texture is embedded. The preview includes the previously authored APC only as a scale reference.
