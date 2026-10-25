# Provenance

Original procedural Three.js geometry, rigging, motion code, weapons and manually authored Canvas texture artwork created for this VECTORCLAD request. No STL triangles, external soldier model, image-generator output or downloaded skin texture is included.

Inspected game references through the user's GitHub connection:

- `Agilancer/vectorclad/js/people.js`, blob `f090be41f7c5ab22050b13ccbef07011bc027368`: human height, 0.43 m leg segments, simple joint hierarchy, +Z forward, and the crowd's instanced-part rendering approach.
- `Agilancer/vectorclad/js/mech.js`, blob `b5fdf92498b900575d1bbb57ddeb04520b645a2c`: independent upper-body aim, recoil and crouch layers, two-bone legs, weapon hardpoints and grounded motion principles. This package uses a new implementation rather than inheriting the live game's animation or physics class.
- `Agilancer/vectorclad/js/vehicles/models.js`, blob `0175906639ce65115994dafcd4db9ab24cd2f042`: faceted Kestrel cockpit, wing ducts, swept fins, Bastion wedge armor, split windshield, circular mechanical hubs and shared gray/gold visual language.

The original game source files are not redistributed in this package. The game repository was read for reference; copying this package into assets does not change gameplay source or spawn tables.

Runtime dependency: Three.js 0.170.0 (MIT), loaded via jsDelivr by the standalone preview. Module consumers supply their game's shared Three.js namespace. No font files or external art are bundled.

`skins/*.png` are deterministic exports of the artwork in `skins.js`. Their source vectors, palette and seeded scratch strokes remain editable in that file. `manifest.json` records SHA-256 digests of the package files. `validation.json` and `controller-validation.json` record the checks actually run; they do not certify gameplay integration, navigation or frame rate.
