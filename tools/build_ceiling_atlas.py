"""Build the ceiling atlas from the sheets in textures/ceiling-src.

Three sheets of recessed light fixtures (square and long troffers, louvered,
prismatic, flat panel...) and two of ceiling tiles, diffusers and grilles, each
piece on a dark gutter. Every piece is cut out along its gutter; a light is
trimmed to the opening inside the ceiling grid's T-bar, since the shader draws
the grid itself. The pieces are packed into textures/ceiling.jpg on a fixed
layout the shader can compute (square pieces in 128 px slots, long ones in
512 x 128 strips), with a glow map of only the lit diffusers in
textures/ceiling-glow.jpg, and js/ceilingTiles.js records which slot holds
what, a long piece's length in ceiling modules, and the theme lists buildings
pick their ceilings from.

Run from the repository root:  python3 tools/build_ceiling_atlas.py
Contact sheet of every piece:  python3 tools/build_ceiling_atlas.py --review out.png
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'textures', 'ceiling-src')
OUT = os.path.join(ROOT, 'textures')

SIZE = 2048
SQ = 128            # square slot
LONG_W = 512        # long strip
GUT = 4             # gutter round every piece, edge pixels repeated
SQ_COLS = SIZE // SQ
LONG_COLS = SIZE // LONG_W


def runs(mask, minlen):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None: s = i
        if not v and s is not None:
            if i - s >= minlen: out.append((s, i))
            s = None
    if s is not None and len(mask) - s >= minlen: out.append((s, len(mask)))
    return out


def xycut(a, x0, y0, x1, y1, out, thr=40):
    """Pieces on a dark gutter: split into bands of rows, then columns, recursively"""
    on = a[y0:y1, x0:x1] > thr
    rows = runs(on.mean(1) > 0.02, 20)
    if len(rows) > 1:
        for r in rows: xycut(a, x0, y0 + r[0], x1, y0 + r[1], out, thr)
        return out
    cols = runs(on.mean(0) > 0.02, 20)
    if len(cols) > 1:
        for c in cols: xycut(a, x0 + c[0], y0, x0 + c[1], y1, out, thr)
        return out
    r = rows[0] if rows else (0, y1 - y0)
    c = cols[0] if cols else (0, x1 - x0)
    out.append((x0 + c[0], y0 + r[0], c[1] - c[0], r[1] - r[0]))
    return out


def opening(gray, box):
    """A light's opening inside the T-bar: from each side, the first dark line past the
    speckled tile border round it"""
    x, y, w, h = box
    a = gray[y:y + h, x:x + w]
    cols = a[h // 3:2 * h // 3, :].mean(0)
    rows = a[:, w // 3:2 * w // 3].mean(1)

    def edge(p, n):
        lim = int(n * 0.3) if n < 300 else int(min(n * 0.3, 60))
        for i in range(4, lim):
            if p[i] < 125: return i
        return int(n * 0.12)
    l, r = edge(cols, w), edge(cols[::-1], w)
    t, b = edge(rows, h), edge(rows[::-1], h)
    return (x + l, y + t, w - l - r, h - t - b)


def glow(img):
    """Lit diffusers and lamps: bright, nearly white, softened a little"""
    a = np.asarray(img).astype(np.float32) / 255
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    sat = a.max(2) - a.min(2)
    m = np.clip((lum - 0.68) / 0.24, 0, 1) * np.clip(1 - (sat - 0.12) / 0.2, 0, 1)
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1))).astype(np.float32) / 255
    out = a * m[..., None]
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))


def place(atlas, img, x, y, w, h):
    """Resize img to w x h at (x, y) and repeat its edge pixels GUT wide round it"""
    p = np.asarray(img.convert('RGB').resize((w, h), Image.LANCZOS))
    p = np.pad(p, ((GUT, GUT), (GUT, GUT), (0, 0)), mode='edge')
    atlas[y - GUT:y + h + GUT, x - GUT:x + w + GUT] = p


SHEETS = ['lights1', 'lights2', 'lights3', 'tiles1', 'tiles2']


def cut_all():
    pieces = []
    for si, name in enumerate(SHEETS):
        img = Image.open(os.path.join(SRC, name + '.webp')).convert('RGB')
        gray = np.asarray(img.convert('L')).astype(float)
        boxes = xycut(gray, 0, 0, img.width, img.height, [])
        for k, b in enumerate(boxes):
            square = b[2] / b[3] < 1.35
            light = name.startswith('lights')
            box = opening(gray, b) if light else (b[0] + 2, b[1] + 2, b[2] - 4, b[3] - 4)
            pieces.append({'sheet': name, 'k': k, 'box': box, 'square': square, 'light': light, 'img': img.crop((box[0], box[1], box[0] + box[2], box[1] + box[3]))})
    return pieces


# Hand-picked roles. Keys are 'sheet:k' (reading order on the sheet).
# Square lights: style tags for themes. m: modern flat/LED, c: classic louvered/prismatic, w: warm
SQUARE_LIGHT_TAGS = {
    'lights1:0': 'c', 'lights1:1': 'c', 'lights1:2': 'cp', 'lights1:3': 'm', 'lights1:4': 'cp',
    'lights1:5': 'm', 'lights1:6': 'c', 'lights1:7': 'm', 'lights1:8': 'c', 'lights1:9': 'cp',
    'lights2:0': 'm', 'lights2:1': 'mw', 'lights2:2': 'mp', 'lights2:3': 'c', 'lights2:4': 'c',
    'lights2:5': 'c', 'lights2:6': 'mw', 'lights2:7': 'cp', 'lights2:8': 'cpw', 'lights2:9': 'cp',
    'lights3:0': 'm', 'lights3:1': 'mp', 'lights3:2': 'c', 'lights3:3': 'c', 'lights3:4': 'cp',
    'lights3:5': 'cp', 'lights3:6': 'c', 'lights3:7': 'c', 'lights3:8': 'c', 'lights3:9': 'cp',
}
LONG_LIGHT_TAGS = {
    'lights1:10': 'mp', 'lights1:11': 'c', 'lights1:12': 'c', 'lights1:13': 'cp', 'lights1:14': 'c', 'lights1:15': 'c', 'lights1:16': 'm', 'lights1:17': 'cp',
    'lights2:10': 'm', 'lights2:11': 'mw', 'lights2:12': 'cp', 'lights2:13': 'c', 'lights2:14': 'cw', 'lights2:15': 'c', 'lights2:16': 'm', 'lights2:17': 'm',
    'lights3:10': 'm', 'lights3:11': 'c', 'lights3:12': 'cp', 'lights3:13': 'c', 'lights3:14': 'c', 'lights3:15': 'cp',
}
# Tiles by family: fine (smooth fine-fissured mineral fiber), speck (speckled and fissured),
# smooth (plaster/metal pan), perf (perforated metal), stain (water-stained, for old buildings)
TILE_FAMILY = {
    'tiles1:0': 'fine', 'tiles1:5': 'speck', 'tiles1:10': 'speck', 'tiles1:15': 'fine',
    'tiles1:1': 'speck', 'tiles1:6': 'speck', 'tiles1:11': 'speck', 'tiles1:16': 'speck',
    'tiles1:2': 'smooth', 'tiles1:7': 'smooth', 'tiles1:12': 'smooth', 'tiles1:17': 'smooth',
    'tiles2:0': 'speck', 'tiles2:1': 'speck', 'tiles2:2': 'fine', 'tiles2:3': 'stain', 'tiles2:4': 'stain', 'tiles2:5': 'fine', 'tiles2:6': 'stain',
    'tiles2:7': 'fine', 'tiles2:8': 'fine', 'tiles2:9': 'stain', 'tiles2:10': 'stain', 'tiles2:11': 'stain', 'tiles2:12': 'stain', 'tiles2:13': 'fine',
    'tiles2:14': 'perf', 'tiles2:15': 'perf', 'tiles2:16': 'perf', 'tiles2:17': 'perf', 'tiles2:18': 'perf', 'tiles2:19': 'perf', 'tiles2:20': 'perf',
}
# Square vents: diffuser (cone), grille (egg-crate / bar), return (perforated)
SQUARE_VENTS = {
    'tiles1:3': 'diffuser', 'tiles1:4': 'grille', 'tiles1:8': 'grille', 'tiles1:9': 'return',
    'tiles1:13': 'grille', 'tiles1:14': 'grille', 'tiles1:18': 'return', 'tiles1:19': 'grille',
    'tiles2:21': 'diffuser', 'tiles2:22': 'diffuser', 'tiles2:23': 'grille', 'tiles2:24': 'grille',
    'tiles2:25': 'grille', 'tiles2:26': 'grille', 'tiles2:27': 'grille', 'tiles2:28': 'grille',
}
# Long vents: slot (thin linear diffuser, half a module wide) or bar (full module)
LONG_VENTS = {
    'tiles1:20': 'slot', 'tiles1:21': 'slot', 'tiles1:22': 'bar', 'tiles1:23': 'bar', 'tiles1:24': 'bar', 'tiles1:25': 'bar',
    'tiles2:29': 'bar', 'tiles2:30': 'bar', 'tiles2:31': 'bar', 'tiles2:32': 'bar',
    'tiles2:33': 'slot', 'tiles2:34': 'slot', 'tiles2:35': 'slot',
    'tiles2:36': 'bar', 'tiles2:37': 'bar', 'tiles2:38': 'bar',
    'tiles2:39': 'bar', 'tiles2:40': 'bar', 'tiles2:41': 'bar',
    'tiles2:42': 'bar', 'tiles2:43': 'bar', 'tiles2:44': 'bar',
}


def review(pieces, path):
    cw, ch = 220, 150
    n = len(pieces)
    cols = 8
    sheet = Image.new('RGB', (cols * cw, ((n + cols - 1) // cols) * ch), (30, 0, 0))
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(pieces):
        im = p['img'].copy()
        im.thumbnail((cw - 10, ch - 26))
        x, y = (i % cols) * cw, (i // cols) * ch
        sheet.paste(im, (x + 5, y + 20))
        d.text((x + 5, y + 4), f"{p['sheet']}:{p['k']} {p['box'][2]}x{p['box'][3]}", fill=(255, 255, 0))
    sheet.save(path)


def main():
    pieces = cut_all()
    if '--review' in sys.argv:
        review(pieces, sys.argv[sys.argv.index('--review') + 1])
        return
    by = {f"{p['sheet']}:{p['k']}": p for p in pieces}
    atlas = np.zeros((SIZE, SIZE, 3), np.uint8)
    glowA = np.zeros((SIZE, SIZE, 3), np.uint8)
    squares, longs = [], []  # (key, kind, extra)
    # Square slots: lights, then tiles by family, then vents
    for k in SQUARE_LIGHT_TAGS: squares.append((k, 'light', SQUARE_LIGHT_TAGS[k]))
    for fam in ['fine', 'speck', 'smooth', 'perf', 'stain']:
        for k, f in TILE_FAMILY.items():
            if f == fam: squares.append((k, 'tile', fam))
    for k, v in SQUARE_VENTS.items(): squares.append((k, 'vent', v))
    for k in LONG_LIGHT_TAGS: longs.append((k, 'light', LONG_LIGHT_TAGS[k]))
    for k, v in LONG_VENTS.items(): longs.append((k, 'vent', v))
    sq_rows = (len(squares) + SQ_COLS - 1) // SQ_COLS
    long_y0 = sq_rows * SQ
    assert long_y0 + ((len(longs) + LONG_COLS - 1) // LONG_COLS) * SQ <= SIZE, 'atlas full'
    meta = {'size': SIZE, 'sq': SQ, 'longW': LONG_W, 'gut': GUT, 'sqCols': SQ_COLS, 'longCols': LONG_COLS, 'longY0': long_y0,
            'squareLights': [], 'longLights': [], 'tiles': {}, 'squareVents': {}, 'longVents': {}, 'longLen': []}
    for i, (k, kind, extra) in enumerate(squares):
        p = by[k]
        x, y = (i % SQ_COLS) * SQ + GUT, (i // SQ_COLS) * SQ + GUT
        place(atlas, p['img'], x, y, SQ - 2 * GUT, SQ - 2 * GUT)
        if kind == 'light':
            place(glowA, glow(p['img']), x, y, SQ - 2 * GUT, SQ - 2 * GUT)
            meta['squareLights'].append({'i': i, 'tags': extra, 'src': k})
        elif kind == 'tile': meta['tiles'].setdefault(extra, []).append(i)
        else: meta['squareVents'].setdefault(extra, []).append(i)
    for i, (k, kind, extra) in enumerate(longs):
        p = by[k]
        w, h = p['box'][2], p['box'][3]
        # Length in modules (a module is the light's width; a slot is half a module wide)
        L = max(2, min(4, round(w / h / (2 if extra == 'slot' else 1))))
        x, y = (i % LONG_COLS) * LONG_W + GUT, long_y0 + (i // LONG_COLS) * SQ + GUT
        place(atlas, p['img'], x, y, L * SQ - 2 * GUT, SQ - 2 * GUT)
        meta['longLen'].append(L)
        if kind == 'light':
            place(glowA, glow(p['img']), x, y, L * SQ - 2 * GUT, SQ - 2 * GUT)
            meta['longLights'].append({'i': i, 'tags': extra, 'src': k})
        else: meta['longVents'].setdefault(extra, []).append(i)
    Image.fromarray(atlas).save(os.path.join(OUT, 'ceiling.jpg'), quality=88)
    Image.fromarray(glowA).save(os.path.join(OUT, 'ceiling-glow.jpg'), quality=88)
    js = ('// Generated by tools/build_ceiling_atlas.py: the slots of textures/ceiling.jpg (and its glow map\n'
          '// textures/ceiling-glow.jpg). Square pieces sit in sq-px slots, sqCols to a row from the top; long\n'
          '// ones in longW x sq strips from longY0, longLen[i] modules long. Each piece fills its slot less gut px.\n'
          'export const CEILING = {\n' + ''.join(f'  {k}: {json.dumps(v, separators=(",", ":"))},\n' for k, v in meta.items()) + '};\n')
    with open(os.path.join(ROOT, 'js', 'ceilingTiles.js'), 'w') as f: f.write(js)
    print('squares', len(squares), 'longs', len(longs), 'long lengths', meta['longLen'])


if __name__ == '__main__':
    main()
