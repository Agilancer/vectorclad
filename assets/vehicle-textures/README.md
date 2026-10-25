# VECTORCLAD gray / gold vehicle finish

Original generated base-color artwork for the procedural Kestrel dropship and Bastion APC. Dark gray armor, gold trim, sparse fleet stencils, modest edge wear and scratches. The rotor is a separate transparent sprite, not a baked image of a wing.

Files: `dropship-armor.png`, `apc-armor.png`, `wing-rotor.png`, and `threejs-textures.js`. Native image dimensions and alpha checks are recorded in `validation.json`. Artwork was generated with the built-in image tool; exact prompts are preserved in `generation-prompts.json`.

Serve the files over HTTP alongside your game, using its shared THREE namespace:

```js
import {createDropship,createAPC} from './vehicle-textures/models.js';
const dropship=createDropship(THREE,{lifter:true});
const apc=createAPC(THREE);
scene.add(dropship,apc);
// Finish and spinning wing rotors are applied by these builders automatically.
```

The final builder maps the actual part bounds into dedicated atlas regions for hull sides, decks, wings/nose and small mechanical parts. Three generated artwork passes and model renders are preserved in `iterations/`. Gold is metallic and glossy; charcoal paint is rougher, using a derived roughness/metalness map. Keep important hull IDs as separate decals (the original builders already do). This fits surface families rather than being a single-shell baked unwrap. The earlier generic projection helper `threejs-textures.js` remains for reference; use `models.js` for this final finish.

## Applied repo models

`models.js` is based on VECTORCLAD's vehicle builder fetched from main at `762bd89f8cd2b22ab9ee8c422dfd678c85257b12`. It automatically applies the finish to Kestrel, Kestrel H, and Bastion. `vehicle-finish.js` supplies cached shared textures and the rotor shader. In the repository, `js/vehicles/models.js` imports this helper from `../../assets/vehicle-textures/vehicle-finish.js`; this pack keeps the two modules together for standalone use. Open `model-preview.html` over HTTP to inspect the actual vehicles.

Kestrel H's two lift ducts are open rings rather than capped cylinders; the old fixed blade bars were removed. Their textured rotors counter-rotate at 24 radians per second. Animation happens in the vertex shader using a material render hook, so the same material also animates when used by the game's instanced Fleet. No change to flight, clamp, wheel, turret or weapon-control APIs is required. Shared fleet textures remain cached for the session. The ordinary rocket-pod Kestrel keeps its weapons and does not gain lift fans.

Browser validation: two rotor meshes, 36 mapped dropship meshes, no mapped mesh missing UVs, shader clock advancing, the instanced-rotor shader rendered, and no browser or shader errors. The standalone vehicles were rendered; a full gameplay run was not performed.

One crisp rotor texture is supplied. Rotate its geometry around the plane's local Z axis. Place it within a real duct and avoid duplicating an existing solid fan mesh. A flat alpha sprite has no blade thickness when viewed edge-on. Hide it or substitute a mesh at those angles. At high speed use a suitable motion-blur solution if temporal aliasing becomes visible.

For opposite-side lettering use separate decal meshes rather than mirroring UVs. Color images use sRGB; roughness and metalness textures use linear data. Generated stencil details should be reviewed at the intended camera distance.
