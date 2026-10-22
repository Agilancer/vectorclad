"""Build the spider texture atlas from the sheets in textures/spider-src.

Each part is either a cut-out piece, traced on its sheet along the dark gap
around it (picked by a point inside it), or a plain rectangle that gets
wrapped onto a 3D shape. The parts are packed into textures/spider.jpg, with a
matching glow map (textures/spider-glow.jpg) holding only the lit red tubes and
slits, and js/spiderParts.js records where each part landed and its outline.

Run from the repository root:  python3 tools/build_spider_atlas.py
"""
import json, os
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'textures', 'spider-src')
OUT = os.path.join(ROOT, 'textures')

# name: (sheet, kind, data)
#   piece: a point inside the piece; its outline is traced
#   rect:  [x, y, w, h] taken as-is
PARTS = {
    'femur':   (2, 'piece', (913, 367)),   # curved blade with a mesh grille
    'tibia':   (3, 'piece', (167, 904)),  # long red-striped claw
    'face':    (4, 'piece', (528, 172)),   # skull with four slit eyes
    'thorax':  (1, 'piece', (765, 603)),   # plate with red slits, wrapped on the carapace
    'brow':    (1, 'piece', (790, 261)),   # spiked chevron over the face
    'fangL':   (1, 'piece', (583, 1096)),
    'fangR':   (1, 'piece', (804, 1111)),
    'spine':   (4, 'piece', (896, 663)),   # segmented spine, a crest on the abdomen
    'claw':    (1, 'piece', (517, 1093)),
    'abdomen': (3, 'rect', [862, 438, 316, 455]),  # ribbed dome
    'joint':   (1, 'rect', [967, 625, 120, 120]),  # turbine disc for hips and knees
}

ATLAS = 1024
PAD = 6


def trace(img, pt, thr=16, erode=2):
    """Outline of the piece containing pt: threshold out the dark gaps, split touching
    pieces with a small erosion, take the component under pt, and grow it back."""
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    mask = (g > thr).astype(np.uint8) * 255
    k = np.ones((3, 3), np.uint8)
    m = cv2.morphologyEx(cv2.erode(mask, k, iterations=erode), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    # Outer outlines only, so dark grilles inside a piece don't count as gaps
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    # The outline nearest the point; it may sit in a notch of a concave piece
    dist = lambda c: cv2.pointPolygonTest(c, (float(pt[0]), float(pt[1])), True)
    near = max((c for c in cnts if cv2.contourArea(c) < 0.5 * m.size), key=dist)
    if dist(near) < -30:
        raise ValueError(f'point {pt} is not near a piece')
    comp = np.zeros(m.shape, np.uint8)
    cv2.drawContours(comp, [near], -1, 255, -1)
    comp = cv2.dilate(comp, k, iterations=erode + 1)
    cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)
    return cv2.approxPolyDP(c, 1.6, True)[:, 0, :]


def glow_mask(img):
    """Lit tubes and slits: saturated bright red, plus the near-white cores inside them.
    Red paint (the stripes on the claws) is as saturated but never reaches white,
    so red only counts when a hot core is close by."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s, v = hsv[..., 0], hsv[..., 1] / 255, hsv[..., 2] / 255
    red = ((h < 8) | (h > 172)) & (s > 0.55) & (v > 0.72)
    near = cv2.dilate(red.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    core = near & (v > 0.88) & (s < 0.55)
    hot = cv2.dilate(((v > 0.93) & near).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    red &= hot
    m = (red | core).astype(np.float32)
    m = cv2.GaussianBlur(m, (5, 5), 0)
    out = img.astype(np.float32) * m[..., None]
    return np.clip(out * 1.2, 0, 255).astype(np.uint8)


def main():
    sheets = {}
    items = []
    for name, (sheet, kind, data) in PARTS.items():
        img = sheets.setdefault(sheet, cv2.imread(os.path.join(SRC, f'sheet{sheet:02d}.jpg')))
        if kind == 'piece':
            poly = trace(img, data)
            x, y, w, h = cv2.boundingRect(poly.reshape(-1, 1, 2))
        else:
            x, y, w, h = data
            poly = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
        items.append(dict(name=name, sheet=sheet, kind=kind, src=[x, y, w, h], poly=poly))

    # Shelf-pack the crops, tallest first
    order = sorted(items, key=lambda it: -it['src'][3])
    cx = cy = shelf = 0
    for it in order:
        w, h = it['src'][2] + 2 * PAD, it['src'][3] + 2 * PAD
        if cx + w > ATLAS:
            cx, cy, shelf = 0, cy + shelf, 0
        it['at'] = [cx, cy]
        cx += w
        shelf = max(shelf, h)
    height = cy + shelf
    if height > ATLAS:
        raise ValueError(f'atlas overflow: {height}px tall')

    atlas = np.zeros((ATLAS, ATLAS, 3), np.uint8)
    glow = np.zeros((ATLAS, ATLAS, 3), np.uint8)
    parts = {}
    for it in items:
        img = sheets[it['sheet']]
        x, y, w, h = it['src']
        ax, ay = it['at']
        x0, y0 = max(0, x - PAD), max(0, y - PAD)
        x1, y1 = min(img.shape[1], x + w + PAD), min(img.shape[0], y + h + PAD)
        crop = img[y0:y1, x0:x1]
        ox, oy = ax + (x0 - (x - PAD)), ay + (y0 - (y - PAD))
        atlas[oy:oy + crop.shape[0], ox:ox + crop.shape[1]] = crop
        glow[oy:oy + crop.shape[0], ox:ox + crop.shape[1]] = glow_mask(crop)
        # Part rectangle and outline in atlas pixels
        dx, dy = ax + PAD - x, ay + PAD - y
        parts[it['name']] = {
            'kind': it['kind'],
            'rect': [ax + PAD, ay + PAD, w, h],
            'poly': [[int(px + dx), int(py + dy)] for px, py in it['poly']],
        }
        print(f"{it['name']:8s} sheet{it['sheet']:02d} {w}x{h} -> {ax + PAD},{ay + PAD}  ({len(it['poly'])} pts)")

    cv2.imwrite(os.path.join(OUT, 'spider.jpg'), atlas, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cv2.imwrite(os.path.join(OUT, 'spider-glow.jpg'), glow, [cv2.IMWRITE_JPEG_QUALITY, 90])
    js = '// Generated by tools/build_spider_atlas.py: where each spider part sits in\n'
    js += '// textures/spider.jpg, with its traced outline, both in atlas pixels.\n'
    js += f'export const SPIDER_ATLAS = {{ w: {ATLAS}, h: {ATLAS} }};\n\n'
    js += 'export const SPIDER_PARTS = {\n'
    for k, v in parts.items():
        js += f"  {k}: {{ kind: '{v['kind']}', rect: {json.dumps(v['rect'])}, poly: {json.dumps(v['poly'], separators=(',', ':'))} }},\n"
    js += '};\n'
    open(os.path.join(ROOT, 'js', 'spiderParts.js'), 'w').write(js)
    print('atlas height used', height)


if __name__ == '__main__':
    main()
