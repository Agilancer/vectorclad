"""Build the Sovereign's textures from the black-and-gold pack in assets/.

Each page becomes a 1024 px WebP color map in textures/sovereign/, and each
page with gold in it also gets a metal/rough map (three.js reads roughness
from green and metalness from blue), so its gold trim shines and its black
plate stays matte. The plain pages are made seamless, and the satin gold page
gets a second, champagne grade for the pale gold plates.

Run from the repository root:  python3 tools/build_mech_textures.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'black-gold-mech-textures')
OUT = os.path.join(ROOT, 'textures', 'sovereign')
SIZE = 1024

# key: (source page, seamless fix, metal/rough map)
PAGES = {
    'torso':      ('01-heavy-torso-armor.png', False, True),
    'shoulder':   ('02-layered-shoulder-armor.png', False, True),
    'shin':       ('03-leg-and-shin-armor.png', False, True),
    'joints':     ('04-compact-mechanical-joints.png', False, True),
    'vents':      ('05-vented-engine-armor.png', False, True),
    'hex':        ('06-hexagonal-armor.png', False, True),
    'ceremonial': ('07-elite-ceremonial-armor.png', False, True),
    'siege':      ('10-heavy-siege-armor.png', False, True),
    'black':      ('11-plain-matte-black.png', True, False),
    'gold':       ('12-plain-satin-gold.png', True, False),
}
# The pale gold of the reference plates, as an sRGB albedo
CHAMPAGNE = np.array([214, 192, 156], np.float32)


def seamless(a):
    """Shift the page by half and fade the original back in over the middle, hiding the seams."""
    h, w = a.shape[:2]
    shifted = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    wx = 1 - np.abs(np.linspace(-1, 1, w))
    wy = 1 - np.abs(np.linspace(-1, 1, h))
    m = np.clip(np.minimum.outer(wy, wx) * 2.5, 0, 1)[..., None]
    return a * m + shifted * (1 - m)


def metal_rough(a):
    """Gold where the page is warm and bright: metallic and smoother; the rest matte black."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    gold = np.clip(((r - b) - 30) / 40, 0, 1) * np.clip((r - 70) / 50, 0, 1)
    gold = np.asarray(Image.fromarray((gold * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
    out = np.zeros_like(a)
    out[..., 0] = 255
    out[..., 1] = (0.66 - 0.32 * gold) * 255
    out[..., 2] = (0.12 + 0.76 * gold) * 255
    return out


def save(a, name, quality=86):
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name), 'WEBP', quality=quality, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    for key, (src, fix, mr) in PAGES.items():
        size = SIZE if mr else SIZE // 2  # plain grain holds up at half size
        im = Image.open(os.path.join(SRC, src)).convert('RGB').resize((size, size), Image.LANCZOS)
        a = np.asarray(im, np.float32)
        if fix:
            a = seamless(a)
        save(a, f'{key}.webp')
        if mr:
            small = np.asarray(im.resize((512, 512), Image.LANCZOS), np.float32)
            save(metal_rough(small), f'{key}-mr.webp', 80)
        if key == 'gold':
            # Keep the satin grain, trade the yellow for champagne
            lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
            save(CHAMPAGNE * (lum / lum.mean())[..., None], 'champagne.webp')
        print(key)


if __name__ == '__main__':
    main()
