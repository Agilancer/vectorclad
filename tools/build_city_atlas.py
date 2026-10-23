"""Build the city texture atlases from the source sheets in textures/city-src.

Detects each sheet's tile grid (dark or light separator lines), crops the tiles
used by the city, and packs them into textures/city-*.jpg with wrap-around
gutters so tiling and mipmaps stay seamless. Also writes js/cityTiles.js.

The facade panel kits are sheets of loose panels (window bays, piers, solid
walls, louvers) on dark gutters. Their panels are cut out once with --segment,
which writes each panel's rectangle to tools/city-panels.json; the role of each
panel is picked by hand there. They pack into textures/city-panels.jpg at their
own aspect ratios.

Run from the repository root:  python3 tools/build_city_atlas.py
Re-cut the panel kits:         python3 tools/build_city_atlas.py --segment [review dir]
"""
import json, os, sys, numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'textures', 'city-src') + '/'
OUT = os.path.join(ROOT, 'textures') + '/'
PANELS_JSON = os.path.join(ROOT, 'tools', 'city-panels.json')

# key: (file, cols, rows, separator kind)
SHEETS = {
  'walls':   ('walls.jpg', 8, 8, 'dark'),
  'asphalt': ('asphalt.jpg', 8, 8, 'dark'),
  'paveA':   ('paveA.jpg', 6, 6, 'dark'),
  'office':  ('office.jpg', 5, 5, 'light'),
  'asphB':   ('asphB.jpg', 5, 5, 'light'),
  'street':  ('street.jpg', 7, 7, 'dark'),
  'facade':  ('facade.jpg', 6, 5, 'light'),
  'roof':    ('roof.jpg', 6, 6, 'dark'),
  'shop':    ('shop.jpg', 6, 6, 'dark'),
  'grass':   ('grass.jpg', 6, 6, 'dark'),
  'paveB':   ('paveB.jpg', 6, 6, 'dark'),
  'planter': ('planter.jpg', 5, 5, 'dark'),
}

# Facade panel kits. key: (file, gutter gray level, sheet px per meter, atlas px per meter)
# Each kit is one family of materials; a building composes its facade from one kit.
KITS = {
  'steel':     ('steel.jpg', 46, 26, 18),      # blue-gray curtain walls and ribbon windows, stone and metal strips
  'precast':   ('precast.jpg', 46, 26, 18),    # beige precast concrete
  'graphite':  ('graphite.jpg', 38, 25, 18),   # charcoal steel and dark glass
  'brick':     ('brick.jpg', 54, 45, 26),      # red brick with limestone surrounds and pilasters
  'concrete':  ('concrete.jpg', 46, 24, 18),   # board-formed concrete
  'limestone': ('limestone.jpg', 46, 28, 18),  # art deco limestone piers and spandrels
  'teal':      ('teal.jpg', 38, 25, 18),       # teal glass and pale stone
  'aluminum':  ('aluminum.jpg', 46, 27, 18),   # concrete and brushed metal
  'navy':      ('navy.jpg', 38, 25, 18),       # navy panels and stone
  'swatches':  ('swatches.jpg', 46, 20, 16),   # whole facades, one per panel
}
# Detected regions that swallowed a neighbour, replaced by their true rectangles
PANEL_FIXES = {
  'brick': [[104, 654, 186, 883], [195, 654, 246, 886], [254, 654, 304, 883], [307, 654, 425, 886],
            [9, 889, 186, 1075], [193, 887, 314, 1078], [323, 887, 426, 1078]],
}
# Panel roles in tools/city-panels.json
ROLES = {'B': 'bays', 'P': 'piers', 'S': 'solids', 'V': 'vents'}  # anything else ('x') is unused
PANEL_INSET, PANEL_PAD, PANEL_ATLAS_W = 3, 8, 4096

def seps(img, n, axis, kind):
    g = np.asarray(img.convert('L'), dtype=np.float32)
    mask = (g < 45) if kind == 'dark' else (g > 215)
    frac = mask.mean(axis=0 if axis == 'x' else 1)  # per column (x) or per row (y)
    L = len(frac); cell = L / n
    cuts = []
    for k in range(1, n):
        lo, hi = int(k * cell - cell * 0.32), int(k * cell + cell * 0.32)
        seg = frac[lo:hi]
        c = lo + int(np.argmax(seg))
        # extend over the separator run
        thr = max(0.5, frac[c] * 0.6)
        a = c
        while a > 0 and frac[a - 1] >= thr: a -= 1
        b = c
        while b < L - 1 and frac[b + 1] >= thr: b += 1
        cuts.append((a, b))
    # outer borders
    a = 0
    while a < L - 1 and frac[a] >= 0.5: a += 1
    b = L - 1
    while b > 0 and frac[b] >= 0.5: b -= 1
    edges = [a] + [x for ab in cuts for x in ab] + [b]
    # cells: (start, end) inclusive-exclusive
    return [(edges[0], cuts[0][0])] + [(cuts[i][1] + 1, cuts[i + 1][0]) for i in range(len(cuts) - 1)] + [(cuts[-1][1] + 1, edges[-1] + 1)]


# ---------------------------------------------------------------------------
# Panel kits
# ---------------------------------------------------------------------------

def area(r):
    return (r[2] - r[0]) * (r[3] - r[1])


def overlap(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def gutter_bands(f, hi=0.95, lo=0.7, need=2, width=4):
    """Runs of rows (or columns) that are gutter almost all the way across."""
    out, i, n = [], 0, len(f)
    while i < n:
        if f[i] >= lo:
            j = i
            while j < n and f[j] >= lo: j += 1
            if j - i >= width and (f[i:j] >= hi).sum() >= need: out.append((i, j))
            i = j
        else:
            i += 1
    return out


def split_panel(dark, r, minside=18):
    """Split a region along any gutter band that crosses it from side to side."""
    x0, y0, x1, y1 = r
    sub = dark[y0:y1, x0:x1]
    for axis in (0, 1):
        f = sub.mean(axis=axis)
        for (i, j) in gutter_bands(f):
            if i >= minside and len(f) - j >= minside:
                if axis == 0: return split_panel(dark, [x0, y0, x0 + i, y1]) + split_panel(dark, [x0 + j, y0, x1, y1])
                return split_panel(dark, [x0, y0, x1, y0 + i]) + split_panel(dark, [x0, y0 + j, x1, y1])
    return [r]


def cut_panels(key):
    """Panels are the regions the gutter network encloses. The network is the dark area
    touching the sheet border plus any long, thin dark component."""
    import cv2
    f, thr = KITS[key][:2]
    img = cv2.imread(SRC + f)
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    # Only thick dark runs carry the network, so it can't slip through a thin seam in a frame
    dark = cv2.morphologyEx((g < thr).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    H, W = dark.shape
    n, lab, st, _ = cv2.connectedComponentsWithStats(dark, connectivity=4)
    net = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if max(w, h) > 0.2 * max(H, W) and a < 0.3 * w * h: net.add(i)
    gut = np.isin(lab, list(net))
    n, lab, st, _ = cv2.connectedComponentsWithStats((~gut).astype(np.uint8), connectivity=4)
    rects = [[int(x), int(y), int(x + w), int(y + h)] for x, y, w, h, a in st[1:] if w >= 18 and h >= 18 and a >= 0.5 * w * h]
    rects = [r for r in rects if not any(o is not r and o[0] <= r[0] and o[1] <= r[1] and o[2] >= r[2] and o[3] >= r[3] for o in rects)]
    core = cv2.erode(gut.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    dk = g < np.percentile(g[core], 90) + 2
    rects = [q for r in rects for q in split_panel(dk, r)]
    fixes = PANEL_FIXES.get(key, [])
    rects = [r for r in rects if not any(overlap(r, q) for q in fixes)] + fixes
    # A panel mostly covered by a larger (or identical, earlier) one is a duplicate
    keep = [r for i, r in enumerate(rects) if not any(
        j != i and overlap(r, q) > 0.6 * area(r) and (area(q) > area(r) or (area(q) == area(r) and j < i))
        for j, q in enumerate(rects))]
    keep.sort(key=lambda r: (r[1] // 40, r[0]))
    return img, keep


def segment(review):
    """Re-cut every kit into tools/city-panels.json. Roles carry over to panels that
    match an earlier cut; new ones start unused ('x'). Writes numbered sheets to review."""
    import cv2
    old = json.load(open(PANELS_JSON)) if os.path.exists(PANELS_JSON) else {}
    iou = lambda a, b: overlap(a, b) / (area(a) + area(b) - overlap(a, b))
    out = {}
    for key in KITS:
        img, rects = cut_panels(key)
        prev = old.get(key, [])
        out[key] = []
        for r in rects:
            best = max(prev, key=lambda p: iou(r, p[:4]), default=None)
            out[key].append(r + [best[4] if best and iou(r, best[:4]) > 0.8 else 'x'])
        if review:
            os.makedirs(review, exist_ok=True)
            o = (img * 0.75).astype(np.uint8)
            col = {'B': (40, 200, 255), 'P': (80, 230, 80), 'S': (220, 220, 220), 'V': (255, 110, 40)}
            for i, (x0, y0, x1, y1, role) in enumerate(out[key]):
                cv2.rectangle(o, (x0, y0), (x1 - 1, y1 - 1), col.get(role, (60, 60, 255)), 2)
                t = f'{i}{role}'
                cv2.putText(o, t, ((x0 + x1) // 2 - 12, (y0 + y1) // 2 + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
                cv2.putText(o, t, ((x0 + x1) // 2 - 12, (y0 + y1) // 2 + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
            cv2.imwrite(os.path.join(review, f'{key}.jpg'), o, [cv2.IMWRITE_JPEG_QUALITY, 85])
        print(key, len(rects), 'panels')
    with open(PANELS_JSON, 'w') as fh:
        fh.write('{\n' + ',\n'.join(
            f'  "{k}": [\n' + ',\n'.join(f'    {json.dumps(p)}' for p in v) + '\n  ]' for k, v in out.items()) + '\n}\n')


def build_panels():
    """Pack the panels in use into the panel atlas, each scaled to its kit's texel density."""
    kits = json.load(open(PANELS_JSON))
    items = []
    for key, (f, _thr, sheet_ppm, atlas_ppm) in KITS.items():
        im = Image.open(SRC + f).convert('RGB')
        s = atlas_ppm / sheet_ppm
        for i, (x0, y0, x1, y1, role) in enumerate(kits[key]):
            if role not in ROLES: continue
            k = PANEL_INSET
            crop = im.crop((x0 + k, y0 + k, x1 - k, y1 - k))
            w, h = max(8, round(crop.width * s)), max(8, round(crop.height * s))
            t = np.asarray(crop.resize((w, h), Image.LANCZOS))
            items.append(dict(name=f'{key}{i}', kit=key, role=role, px=t,
                              m=[round(crop.width / sheet_ppm, 2), round(crop.height / sheet_ppm, 2)]))
    # Skyline packing, tallest first: each panel drops to the lowest spot it fits
    pad, W = PANEL_PAD, PANEL_ATLAS_W
    sky = np.zeros(W, np.int32)  # height filled so far in each pixel column
    for it in sorted(items, key=lambda it: (-it['px'].shape[0], -it['px'].shape[1])):
        h, w = it['px'].shape[0] + 2 * pad, it['px'].shape[1] + 2 * pad
        tops = np.lib.stride_tricks.sliding_window_view(sky, w).max(axis=1)
        x = int(np.argmin(tops))
        it['at'] = [x + pad, int(tops[x]) + pad]
        sky[x:x + w] = tops[x] + h
    H = int(sky.max())
    atlas = np.zeros((H, W, 3), np.uint8)
    for it in items:
        h, w = it['px'].shape[:2]
        x, y = it['at']
        atlas[y - pad:y + h + pad, x - pad:x + w + pad] = np.pad(it['px'], ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
    Image.fromarray(atlas).save(OUT + 'city-panels.jpg', quality=84, optimize=True, progressive=True)
    print('panels', len(items), 'panels', W, 'x', H)
    meta = dict(url='textures/city-panels.jpg', w=W, h=H, pad=pad)
    kit_roles = {k: {r: [it['name'] for it in items if it['kit'] == k and it['role'] == c] for c, r in ROLES.items()} for k in KITS}
    return meta, items, kit_roles


if '--segment' in sys.argv:
    i = sys.argv.index('--segment')
    segment(sys.argv[i + 1] if len(sys.argv) > i + 1 else None)
    sys.exit(0)

src, cells = {}, {}
for key, (f, nc, nr, kind) in SHEETS.items():
    im = Image.open(SRC + f).convert('RGB')
    src[key] = im
    cells[key] = {'cols': seps(im, nc, 'x', kind), 'rows': seps(im, nr, 'y', kind)}

def rc(rows, cols):
    return [(r, c) for r in rows for c in cols]

# (sheet, [(row, col)], inset px)
ATLASES = {
  'facade': dict(content=240, pad=8, cols=8, quality=86, picks=[
    ('office', rc(range(5), range(5)), 4),
    ('facade', rc(range(5), range(6)), 4),
    ('shop', rc(range(5), range(6)), 4),
  ]),
  'surface': dict(content=208, pad=8, cols=9, quality=84, picks=[
    ('walls', rc(range(8), range(8)), 5),
    ('roof', rc(range(6), range(6)), 4),
  ]),
  'ground': dict(content=208, pad=8, cols=9, quality=84, picks=[
    ('asphB', rc(range(5), range(5)), 4),
    ('asphalt', [(0, 0), (0, 2), (0, 4), (0, 7), (1, 0), (1, 1), (1, 4), (1, 7)]
               + rc([2, 3], range(8)) + [(4, c) for c in range(6)] + [(5, 0), (5, 2), (6, 0), (6, 4), (6, 6)], 5),
    ('street', rc([2, 3], range(7)), 5),
    ('paveA', [(0, 0), (0, 2), (0, 3), (0, 5), (1, 0), (1, 3), (1, 4), (1, 5), (2, 2), (2, 3), (3, 2), (4, 2), (4, 5), (5, 4)], 5),
    ('paveB', rc([0, 1], range(6)) + [(2, 0), (2, 3), (2, 5), (3, 0), (3, 2), (3, 3), (3, 4), (3, 5), (5, 0), (5, 1), (5, 2)], 5),
    ('grass', [(0, 0), (0, 1), (0, 2), (0, 3), (1, 1), (1, 4), (1, 5), (2, 3), (3, 4), (3, 5), (4, 0), (5, 3)], 4),
    ('planter', [(0, 0), (0, 2), (1, 1), (2, 2), (2, 0), (4, 0)], 18),
  ]),
}

manifest = {'atlases': {}, 'tiles': {}}
for name, A in ATLASES.items():
    C, pad, ncols = A['content'], A['pad'], A['cols']
    cell = C + 2 * pad
    tiles = []
    for sheet, picks, inset in A['picks']:
        cols, rows = cells[sheet]['cols'], cells[sheet]['rows']
        for (r, c) in picks:
            x0, x1 = cols[c]; y0, y1 = rows[r]
            crop = src[sheet].crop((x0 + inset, y0 + inset, x1 - inset, y1 - inset))
            aspect = crop.width / crop.height
            t = np.asarray(crop.resize((C, C), Image.LANCZOS))
            t = np.pad(t, ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
            tiles.append((f'{sheet}{r}{c}', t, round(aspect, 3)))
    nrows = (len(tiles) + ncols - 1) // ncols
    W, H = ncols * cell, nrows * cell
    atlas = np.zeros((H, W, 3), np.uint8)
    for i, (tname, t, aspect) in enumerate(tiles):
        col, row = i % ncols, i // ncols
        atlas[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = t
        manifest['tiles'][tname] = [name, i, aspect]
    Image.fromarray(atlas).save(OUT + f'city-{name}.jpg', quality=A['quality'], optimize=True, progressive=True)
    manifest['atlases'][name] = dict(url=f'textures/city-{name}.jpg', w=W, h=H, cell=cell, pad=pad, content=C, cols=ncols)
    print(name, len(tiles), 'tiles', W, 'x', H)

manifest['atlases']['panels'], panels, kit_roles = build_panels()

js = '// Generated from the city texture sheets: atlas layouts and where each tile sits.\n'
js += '// Tile names are <sheet><row><col> in the original sheet; the value is [atlas, cell index, source aspect].\n'
js += 'export const ATLASES = ' + json.dumps(manifest['atlases'], indent=2) + ';\n\n'
js += 'export const TILES = {\n'
for k, v in manifest['tiles'].items():
    js += f"  {k}: ['{v[0]}', {v[1]}, {v[2]}],\n"
js += '};\n\n'
js += '// Facade panels, named <kit><panel number in tools/city-panels.json>:\n'
js += '// [x, y, w, h] in the panel atlas in pixels, then the panel\'s width and height in meters.\n'
js += 'export const PANELS = {\n'
for it in panels:
    js += f"  {it['name']}: [{it['at'][0]}, {it['at'][1]}, {it['px'].shape[1]}, {it['px'].shape[0]}, {it['m'][0]}, {it['m'][1]}],\n"
js += '};\n\n'
js += '// Panels of each kit by role: window bays, piers (narrow strips), solid walls and vents (louvers).\n'
js += 'export const KITS = {\n'
for k, roles in kit_roles.items():
    js += f'  {k}: {{\n' + ''.join(f"    {r}: {json.dumps(names)},\n".replace('"', "'") for r, names in roles.items()) + '  },\n'
js += '};\n'
open(os.path.join(ROOT, 'js', 'cityTiles.js'), 'w').write(js)
