# Skyscraper facade texture sheets

20 architectural styles generated with built-in ImageGen. Exact prompts and SHA-256 hashes are recorded in manifest.json.

## Files and resolution

Each original PNG is 1254 x 1254 pixels. Generation was requested at 2048 x 2048, but the generator returned 1254 x 1254. These are native originals, without upscaling.

Each image is composed as a 4-column x 4-row facade atlas: window modules toward the top, wall and pier variants in the third row, and vents, louvers, trim, and blank walls toward the bottom. Individual cell details vary by style. The visual boundaries are approximate rather than a pixel-perfect sprite grid. Use custom UV rectangles and inset sampling to avoid adjacent-cell bleeding. Seamless tileability and engine import have not been validated.

## Material setup

Use the PNG as an sRGB base-color texture. Windows contain dark tones without reflected scenery. To keep windows nonreflective in the game, also disable reflections/specular for their material or mask, use high roughness, and disable clearcoat. A base-color texture alone cannot prevent an engine shader from adding reflections.

These are color atlases, with some generated shading. Normal, roughness, metallic, displacement, and emission maps are not included. No engine-specific package or license assertion is supplied.
