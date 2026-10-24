# VECTORCLAD / AV-09 Seraph

A medium-poly Blender mech modelled from the user's concept art: white ceramic armour over a dark frame. It has a small swept helmet with a V crest and cyan visor, layered feather pauldrons, elbow fins, B-marked thighs, heavy flared calves and long talon feet. Two articulated **binder thrusters** hang on the back. The concept image is not redistributed here.

The two legs are exact mirrors. The concept art only makes them look different because of its 3/4 camera and the stance: one leg is seen in profile and the other almost head-on. `renders/reference-pose.png` reproduces that stance (right leg turned out, left leg forward, head turned) with the same symmetric model.

## Polygon budget

| Model | Triangles |
| --- | --- |
| FS-07A Vanguard (`js/mech.js`, the first VECTORCLAD mech; solid meshes, no ink-outline shells) | 22,036 |
| **AV-09 Seraph** (all armour, joints, binders and nozzles) | **20,380** |
| AV-09 exhaust plumes (hidden at rest) | 304 |

The Vanguard was counted by building it in a headless browser and summing every non-outline, non-effect mesh. Including its ink-outline shells it is 41,564 triangles.

## Files

- `seraph.blend`: the rigged model. Open it and press Play to run `Binders_Cycle`. The `Cam_Reference` camera and studio lights are kept for rendering.
- `seraph.glb`: glTF 2.0 export (+Y up, +Z forward, like the game) with the armature and four animations.
- `preview.html`: three.js r170 viewer for the GLB, with an animation picker and a wireframe toggle. Serve the repository over HTTP and open it; it needs internet for three.js from jsDelivr.
- `renders/`: Cycles + Freestyle renders: `reference-pose`, `front`, `side`, `back`, `three-quarter` and `binders-deployed`.
- `../../tools/blender/build_seraph.py`: the generator. Every file above comes from it.

## Rig and the binder thrusters

The model is rigid-skinned: armour is joined into one mesh per bone and parented to that bone (25 meshes, 26 bones). Body bones are `root`, `pelvis`, `spine`, `chest`, `neck`, `head`, plus `upper_arm`, `forearm`, `hand`, `thigh`, `shin` and `foot` on each side (`.L`/`.R`). Rest-pose heights use game units, close to the Vanguard: the hip is at 5.08, the shoulders at 7.5 and the helmet top at about 8.9.

Each binder has its own chain:

| Bone | Moves |
| --- | --- |
| `binder_mount.L/R` | Splays the binder outward about the front–back axis at its backpack pivot |
| `binder.L/R` | Pitches the long blade back |
| `nozzle.L/R` | Gimbals the twin bell nozzles in the thruster pod |
| `plume.L/R` | Scales the exhaust plume (0 = off) |

Animations (actions in Blender, clips in the GLB):

- `Binders_Cycle`: 120-frame loop at 30 fps. The binders deploy, sweep and gimbal under thrust, then stow.
- `Binders_Deploy` / `Binders_Stow`: one-shot, 30 frames each.
- `Binders_Thrust`: 30-frame loop holding the deployed pose with the nozzles working and the plumes flickering.

The plume meshes have full-size rest geometry, and every clip keys their scale. If you show the GLB without playing a clip, hide the `Seraph_plume.*` nodes or scale them to zero.

## Rebuilding

```sh
blender --background --python tools/blender/build_seraph.py            # model, GLB, renders
blender --background --python tools/blender/build_seraph.py -- --no-render
python tools/blender/build_seraph.py --quick                            # with `pip install bpy`
```

It was built with Blender 5.2 (`bpy` 5.2.3). A full render pass takes about four minutes on CPU.

## Scope

This is a visual model with its own rig. It is not yet a selectable frame in the hangar (`js/frames.js`), because the in-game frames subclass the procedural `Mech` and share its skeleton and IK. To use the Seraph in the game, either load the GLB and drive its bones from the `Mech` animation state, or port the shapes into a `Mech` subclass the way `assets/heavy-frame` does.
