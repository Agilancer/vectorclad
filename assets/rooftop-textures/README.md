# Rooftop texture sprite sheets

20 rooftop material styles generated with built-in ImageGen. Exact prompts, native dimensions, and SHA-256 hashes are recorded in manifest.json.

Each sheet uses a roughly 4 x 4 top-down modular atlas layout. Upper rows contain roof covering variants; lower rows contain seams, edge flashing, service strips, drains, vents, hatches, or related details. The styles include membranes, gravel, standing seam metal, copper, clay tiles, slate, concrete, bitumen, sedum, solar panels, corrugated steel, pavers, decking, zinc, shingles, and utility roof surfaces.

Use PNGs as sRGB base-color textures. Skylight and solar panes contain no reflected scenery. To preserve that appearance, disable reflections/specular and clearcoat in the relevant engine material. No normal, roughness, metallic, displacement, or emission maps are included.

Files are unscaled native originals. Generation was requested at 2048 x 2048; actual returned dimensions are recorded in the manifest. Some generated shading is present. Cell boundaries are approximate: use custom UV rectangles with inset sampling. Seamless tiling and engine import have not been validated.
