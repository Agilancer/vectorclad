# Model-specific finish iterations

Source model: VECTORCLAD `js/vehicles/models.js`, blob `6957ee9373a7674b53cfb3246dddc4069ab0720b`.

Analysis: Kestrel hull has a 24 m longitudinal extent, long upper surfaces, narrow angled side faces, swept triangular aft wings and twin lift ducts on the H variant. Bastion has a 9.1 m wedge hull, 3.66 m broad roof, rectangular side door, independently rotating wheels, and a separately moving turret. The original surface collage stretched and repeated details across small parts, and treating all edge materials as gold made the long engine housings too gold.

The new UV layout reserves one quarter of each atlas for each surface family: upper-left hull sides; upper-right decks; lower-left wing / nose panels; lower-right small mechanical pieces. Coordinates are normalized to the actual part bounds rather than repeated across the whole vehicle at a fixed distance. The left and right sides orient stencils consistently. Gold material is restricted to deliberate trim and warm regions of the artwork.

Each artwork pass and its model renders are retained here. Final selected artwork is copied to the runtime filenames at the package root. The UV treatment fits surface families; it is not a baked single-shell Blender unwrap.

Pass 1: generated four-region atlases and rendered them on the vehicles. Large surfaces gained coherent panel scale, but wear was too heavy and the APC mechanical region mistakenly contained a pictured gun assembly.

Pass 2: redrew the mechanical area as flat material, reduced wear, thinned gold lines, reserved mechanical surfaces for engine housing trim, and changed preview illumination to neutral so gray paint no longer appeared blue. Rendered both vehicles again.

Pass 3: refined coated-metal microtexture, light edge scuffs, seam grime and polished gold base color while preserving the atlas layout and serial positions. Final preview exposure was reduced to retain the charcoal finish. All three generated texture passes are retained for comparison.
