"""Build the city texture atlases from the source sheets in textures/city-src.

Detects each sheet's tile grid (dark or light separator lines), crops the tiles
used by the city, and packs them into textures/city-*.jpg with wrap-around
gutters so tiling and mipmaps stay seamless. Also writes js/cityTiles.js.

The facade panel kits are sheets of loose panels (window bays, piers, solid
walls, louvers) on dark gutters, and the ground kits are sheets of road and
sidewalk tiles between thin separator lines. Their panels are cut out once with
--segment, which writes each panel's rectangle to tools/city-panels.json; the
role of each panel is picked by hand there. Facade panels pack into
textures/city-panels.jpg and ground panels into textures/city-roads.jpg, each at
its own aspect ratio.

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

# Facade panel kits. key: (file, gutter gray level, gutter gap bridge px, sheet px per meter, atlas px per meter)
# Each kit is one family of materials; a building composes its facade from one kit.
# The gap bridge closes short light breaks along a gutter line, where the art's
# gutters fade, so neighbouring panels don't run together.
KITS = {
  'steel':      ('steel.jpg', 46, 0, 26, 18),      # blue-gray curtain walls and ribbon windows, stone and metal strips
  'precast':    ('precast.jpg', 46, 0, 26, 18),    # beige precast concrete
  'graphite':   ('graphite.jpg', 38, 0, 25, 18),   # charcoal steel and dark glass
  'brick':      ('brick.jpg', 54, 0, 45, 26),      # red brick with limestone surrounds and pilasters
  'concrete':   ('concrete.jpg', 46, 0, 24, 18),   # board-formed concrete
  'limestone':  ('limestone.jpg', 46, 0, 28, 18),  # art deco limestone piers and spandrels
  'teal':       ('teal.jpg', 38, 0, 25, 18),       # teal glass and pale stone
  'aluminum':   ('aluminum.jpg', 46, 0, 27, 18),   # concrete and brushed metal
  'navy':       ('navy.jpg', 38, 0, 25, 18),       # navy panels and stone
  'swatches':   ('swatches.jpg', 46, 0, 20, 16),   # whole facades, one per panel
  'slate':      ('slate.jpg', 46, 9, 29, 18),      # pale gray stone, charcoal metal and dark glass
  'sandstone':  ('sandstone.jpg', 46, 9, 30, 18),  # warm sandstone and gunmetal
  'indigo':     ('indigo.jpg', 46, 9, 28, 18),     # indigo panels and fins with gray stone
  'silver':     ('silver.jpg', 46, 9, 28, 18),     # gray stone and brushed steel pipes
  'travertine': ('travertine.jpg', 46, 9, 31, 18), # travertine and bronze-black frames
  'seaglass':   ('seaglass.jpg', 46, 9, 26, 18),   # the precast layout in gray stone and sea-green glass
  'masonry':    ('masonry.jpg', 54, 9, 32, 18),    # red brick banded with stone
  'ivory':      ('ivory.jpg', 46, 9, 32, 18),      # cream stone and bronze
  'basalt':     ('basalt.jpg', 30, 9, 29, 18),     # dark basalt and charcoal steel
  'azure':      ('azure.jpg', 46, 9, 29, 18),      # pale stone and azure glass
}
# Detected regions that swallowed a neighbour, replaced by their true rectangles
PANEL_FIXES = {
  'brick': [[104, 654, 186, 883], [195, 654, 246, 886], [254, 654, 304, 883], [307, 654, 425, 886],
            [9, 889, 186, 1075], [193, 887, 314, 1078], [323, 887, 426, 1078]],
  'basalt': [[7, 124, 309, 239], [7, 245, 149, 464], [158, 245, 180, 464], [187, 245, 242, 464]],
  # Three rows of six slabs, then a row of covers and drains, whose faint separators merge
  'redcurb': [[x0, y0, x1, y1] for y0, y1 in ((575, 689), (692, 828), (832, 1014))
              for x0, x1 in ((2, 206), (209, 420), (423, 626), (629, 845), (848, 1045), (1048, 1252))]
             + [[x0, 1018, x1, 1105] for x0, x1 in ((2, 89), (92, 162), (166, 256), (260, 315), (318, 370), (374, 464),
                                                     (467, 620), (624, 728), (731, 888), (891, 1024), (1028, 1252))],
  # Two crosswalks: one lost to its white bars, one joined to the strip beside it
  'buslane': [[70, 162, 236, 322], [243, 161, 391, 323]],
  # The paving tiles in the top two rows butt together with no separator
  'cobble': [[x0, y0, x1, y1] for y0, y1 in ((2, 108), (111, 217))
             for x0, x1 in ((438, 566), (568, 694), (696, 823), (825, 972), (975, 1107), (1110, 1252))],
}
# Ground kits: road and sidewalk tiles. key: (file, cut, sheet px per meter, atlas px per meter)
# The sheets' separators come in two kinds, so each kit says how to find them:
#   ('grid', [RGB, ...], tolerance, fill): separator lines are one of these colors, and
#       a row or column counts as a separator where that much of it matches
#   ('edge', 'light' | 'dark', k, contrast, fill): thin lines lighter (or darker) than
#       the pixels k away on both sides, for separators close in color to the tiles
#   ('lines', ...same as edge): as edge, but only lines that cross the whole sheet cut,
#       for regular grids whose markings would fool the recursive cut
#   ('given', [y, ...], [x, ...]): a grid whose separator lines are too faint to find
# Sheet scales put a sidewalk tile of two by two slabs at about 2.8 m.
GROUND_KITS = {
  'tactile': ('tactile.jpg', ('grid', [(222, 222, 222), (12, 12, 12)], 34, 0.7), 53, 56),  # pavers, red brick and tactile strips
  'crisp':   ('crisp.jpg', ('grid', [(254, 255, 255)], 14, 0.75), 64, 56),                 # crisp new paint, painted curbs
  'cobble':  ('cobble.jpg', ('grid', [(20, 17, 8)], 30, 0.6), 54, 56),                      # cobbles and setts, old asphalt
  'ruin':    ('ruin.jpg', ('grid', [(11, 10, 8)], 22, 0.75), 50, 56),                      # potholes and broken slabs
  'faded':   ('faded.jpg', ('lines', 'light', 5, 12, 0.6), 40, 56),                        # faded and worn markings
  'redcurb': ('redcurb.jpg', ('edge', 'light', 5, 12, 0.6), 74, 56),                       # red curbs, tree pits, big slabs
  'hazard':  ('hazard.jpg', ('grid', [(4, 4, 3)], 20, 0.75), 59, 56),                       # yellow curbs and hazard stripes
  'buslane': ('buslane.jpg', ('grid', [(242, 241, 240)], 26, 0.75), 49, 56),                # bus lanes, parking bays
  'grime':   ('grime.jpg', ('given', [203, 374, 531, 764, 920, 1076], [157, 313, 470, 627, 783, 940, 1096]), 55, 56),  # grimy weathered streets
  'fresh':   ('fresh.jpg', ('grid', [(254, 253, 251)], 24, 0.75), 55, 56),                  # clean streets and yellow curbs
}

# Structure kits: bridges, viaducts, elevated rail and their parts, loose pieces on a
# charcoal background cut like the facade panels, but keeping sparse shapes (towers,
# T piers, arches, lamp posts) that the facade cut would drop. key: file
STRUCT_KITS = {
  'industrial':  'industrial.jpg',   # bascule machinery, catwalks, stairs, pipes and lamp posts
  'interchange': 'interchange.jpg',  # curved ramps, barriers, piers and girders
  'footing':     'footing.jpg',      # caissons, pile caps, piers, abutments and bearings
  'railway':     'railway.jpg',      # elevated rail: track decks, plate girders, lattice trusses, steel bents
  'stonework':   'stonework.jpg',    # stone bridge: arches, balustrades, pedestals and niches
  'overpass':    'overpass.jpg',     # highway decks, barriers, hammerhead piers and girders
  'cablestay':   'cablestay.jpg',    # A-frame pylons and stay cable fans
  'suspension':  'suspension.jpg',   # towers, main cables, hangers, anchorages and stiffening trusses
  'steeltruss':  'steeltruss.jpg',   # trusses, beams, gussets and steel trestle bents
  'viaduct':     'viaduct.jpg',      # a second highway kit
}

# Panel roles in tools/city-panels.json; anything else ('x') is unused
ROLES = {'B': 'bays', 'P': 'piers', 'S': 'solids', 'V': 'vents'}
# Ground roles: tileable surfaces (asphalt, sidewalk, plaza paving), markings keyed out
# of their asphalt (crosswalk, white lane line, yellow center line, box junction), covers
# and tree pits cropped to their outline, and potholes laid over the asphalt
GROUND_ROLES = {'A': 'asphalt', 'W': 'walk', 'Z': 'plaza', 'C': 'crosswalk', 'L': 'lane', 'Y': 'yellow', 'X': 'box',
                'O': 'round', 'Q': 'square', 'T': 'pit', 'H': 'hole'}
# Panel atlas pages are at most this big: 4096 px textures work on practically every current device
PANEL_INSET, PANEL_PAD, PANEL_ATLAS_W, PANEL_ATLAS_H = 3, 8, 4096, 4096
# Structure roles. Tiles are opaque rectangles laid along a surface: deck and track tops,
# slab faces, barriers, girder faces, columns, blocks and cable bundles. The rest have the
# background keyed out: trusses, railings, balustrades, hangers, bents and lamp posts are
# drawn as see-through cards, and piers, towers and pylons also have their outline
# traced so they can be extruded into slabs.
STRUCT_ROLES = {'D': 'deck', 'K': 'track', 'F': 'slab', 'B': 'barrier', 'G': 'girder', 'C': 'column', 'S': 'block',
                'L': 'cable', 'T': 'truss', 'R': 'rail', 'U': 'balustrade', 'H': 'hanger', 'N': 'bent', 'M': 'lamp',
                'P': 'pier', 'W': 'tower', 'Y': 'pylon'}
KEYED, OUTLINED = 'TRUHNMPWY', 'PWY'

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


def separator_masks(img, how):
    """Pixels on separator lines, for the row cuts and for the column cuts."""
    import cv2
    if how[0] == 'grid':
        _, colors, tol, fill = how
        m = np.zeros(img.shape[:2], bool)
        for c in colors: m |= np.abs(img.astype(int) - np.array(c[::-1])).max(axis=2) < tol
        return m.astype(np.float32), m.astype(np.float32), fill
    _, kind, k, contrast, fill = how
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (3, 3), 0).astype(np.float32)
    if kind == 'light': g = 255 - g
    rows = np.minimum(np.roll(g, k, 0), np.roll(g, -k, 0)) - g > contrast
    cols = np.minimum(np.roll(g, k, 1), np.roll(g, -k, 1)) - g > contrast
    return rows.astype(np.float32), cols.astype(np.float32), fill


def xy_cut(Mr, Mc, r, fill, out, maxw=14, minp=36):
    """Split a region along full-width separator rows, else full-height separator columns,
    and recurse; regions with neither are panels."""
    x0, y0, x1, y1 = r
    if x1 - x0 < minp or y1 - y0 < minp: return
    while y1 - y0 > minp and Mr[y0, x0:x1].mean() >= fill: y0 += 1
    while y1 - y0 > minp and Mr[y1 - 1, x0:x1].mean() >= fill: y1 -= 1
    while x1 - x0 > minp and Mc[y0:y1, x0].mean() >= fill: x0 += 1
    while x1 - x0 > minp and Mc[y0:y1, x1 - 1].mean() >= fill: x1 -= 1
    for axis, M in (('y', Mr), ('x', Mc)):
        f = M[y0:y1, x0:x1].mean(axis=1 if axis == 'y' else 0)
        L, cuts, i = len(f), [], 0
        while i < L:
            if f[i] >= fill:
                j = i
                while j < L and f[j] >= fill: j += 1
                # Thin lines only: a wide band is paint or paving, not a separator
                if j - i <= maxw and i >= minp // 2 and j <= L - minp // 2: cuts.append((i, j))
                i = j
            else:
                i += 1
        if not cuts: continue
        prev = 0
        for a, b in cuts + [(L, L)]:
            xy_cut(Mr, Mc, [x0, y0 + prev, x1, y0 + a] if axis == 'y' else [x0 + prev, y0, x0 + a, y1], fill, out, maxw, minp)
            prev = b
        return
    out.append([int(x0), int(y0), int(x1), int(y1)])


def cut_panels(key):
    """Facade kits: panels are the regions the gutter network encloses. The network is the
    dark area touching the sheet border plus any long, thin dark component.
    Ground kits: split along separator rows and columns (see GROUND_KITS)."""
    import cv2
    if key in GROUND_KITS:
        f, how = GROUND_KITS[key][:2]
        img = cv2.imread(SRC + f)
        rects = []
        if how[0] == 'given':
            ys, xs = [-2] + how[1] + [img.shape[0] + 1], [-2] + how[2] + [img.shape[1] + 1]
            rects = [[xs[i] + 2, ys[j] + 2, xs[i + 1] - 1, ys[j + 1] - 1] for j in range(len(ys) - 1) for i in range(len(xs) - 1)]
        elif how[0] == 'lines':
            Mr, Mc, fill = separator_masks(img, how)
            def lines(f, L):
                ys = [i for i in range(L) if f[i] >= fill]
                runs = []
                for y in ys:
                    if runs and y - runs[-1][1] <= 2: runs[-1][1] = y + 1
                    else: runs.append([y, y + 1])
                return [0] + [v for r in runs for v in r] + [L]
            ys, xs = lines(Mr.mean(axis=1), img.shape[0]), lines(Mc.mean(axis=0), img.shape[1])
            rects = [[xs[i], ys[j], xs[i + 1], ys[j + 1]] for j in range(0, len(ys), 2) for i in range(0, len(xs), 2)
                     if xs[i + 1] - xs[i] > 30 and ys[j + 1] - ys[j] > 30]
        else:
            Mr, Mc, fill = separator_masks(img, how)
            xy_cut(Mr, Mc, [0, 0, img.shape[1], img.shape[0]], fill, rects)
    elif key in STRUCT_KITS:
        img, rects = net_cut(key, STRUCT_KITS[key], 42, 0, 0.1)
    else:
        img, rects = net_cut(key, *KITS[key][:3])
    fixes = PANEL_FIXES.get(key, [])
    rects = [r for r in rects if not any(overlap(r, q) for q in fixes)] + fixes
    # A panel mostly covered by a larger (or identical, earlier) one is a duplicate
    keep = [r for i, r in enumerate(rects) if not any(
        j != i and overlap(r, q) > 0.6 * area(r) and (area(q) > area(r) or (area(q) == area(r) and j < i))
        for j, q in enumerate(rects))]
    keep.sort(key=lambda r: (r[1] // 40, r[0]))
    return img, keep


def net_cut(key, f, thr, bridge, fill=0.5):
    """fill: the least share of its bounding box a panel fills, to drop specks and slivers"""
    import cv2
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
    if bridge:
        u = gut.astype(np.uint8)
        for k in (np.ones((1, bridge), np.uint8), np.ones((bridge, 1), np.uint8)):
            gut |= cv2.morphologyEx(u, cv2.MORPH_CLOSE, k) > 0
    n, lab, st, _ = cv2.connectedComponentsWithStats((~gut).astype(np.uint8), connectivity=4)
    rects = [[int(x), int(y), int(x + w), int(y + h)] for x, y, w, h, a in st[1:] if w >= 18 and h >= 18 and a >= fill * w * h]
    rects = [r for r in rects if not any(o is not r and o[0] <= r[0] and o[1] <= r[1] and o[2] >= r[2] and o[3] >= r[3] for o in rects)]
    core = cv2.erode(gut.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    dk = g < np.percentile(g[core], 90) + 2
    return img, [q for r in rects for q in split_panel(dk, r)]


def segment(review):
    """Re-cut every kit into tools/city-panels.json. Roles carry over to panels that
    match an earlier cut; new ones start unused ('x'). Writes numbered sheets to review."""
    import cv2
    old = json.load(open(PANELS_JSON)) if os.path.exists(PANELS_JSON) else {}
    iou = lambda a, b: overlap(a, b) / (area(a) + area(b) - overlap(a, b))
    out = {}
    for key in list(KITS) + list(GROUND_KITS) + list(STRUCT_KITS):
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


def skyline(items, W, pad):
    """Skyline packing, tallest first: each panel drops to the lowest spot it fits.
    Sets each item's 'at' and returns the height used."""
    sky = np.zeros(W, np.int32)  # height filled so far in each pixel column
    for it in sorted(items, key=lambda it: (-it['px'].shape[0], -it['px'].shape[1])):
        h, w = it['px'].shape[0] + 2 * pad, it['px'].shape[1] + 2 * pad
        tops = np.lib.stride_tricks.sliding_window_view(sky, w).max(axis=1)
        x = int(np.argmin(tops))
        it['at'] = [x + pad, int(tops[x]) + pad]
        sky[x:x + w] = tops[x] + h
    return int(sky.max())


def panel_item(key, i, crop, role, sheet_ppm, atlas_ppm):
    """A packed panel: its pixels at the atlas density and its size in meters."""
    s = atlas_ppm / sheet_ppm
    w, h = max(8, round(crop.width * s)), max(8, round(crop.height * s))
    return dict(name=f'{key}{i}', kit=key, role=role, px=np.asarray(crop.resize((w, h), Image.LANCZOS)),
                m=[round(crop.width / sheet_ppm, 2), round(crop.height / sheet_ppm, 2)])


def run_around(f, c, thr):
    """The run of f >= thr that contains (or is nearest to) index c, as [a, b)."""
    on = np.flatnonzero(f >= thr)
    if not len(on): return None
    c = on[np.argmin(np.abs(on - c))]
    a = b = c
    while a > 0 and f[a - 1] >= thr: a -= 1
    while b < len(f) - 1 and f[b + 1] >= thr: b += 1
    return a, b + 1


def shape_ground(crop, role):
    """Turn crosswalks and lines so their stripes run up the tile, crop lines to their
    paint, and crop covers and pits to their outline."""
    from PIL import ImageFilter
    a = np.asarray(crop).astype(np.float32)
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    if role in 'CLY':
        # Stripes running up the tile make the column profile swing back and forth, while
        # the row profile changes only where the stripes start and end
        tv = lambda f: np.abs(np.diff(np.convolve(f, np.ones(3) / 3, 'valid'))).sum() / len(f)
        if tv(lum.mean(axis=1)) > tv(lum.mean(axis=0)):
            crop = crop.transpose(Image.Transpose.ROTATE_90)
            a = np.asarray(crop).astype(np.float32)
            lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    if role in 'LY':
        # Paint: well above the asphalt, or yellow
        paint = (lum > np.median(lum) + 32) | ((a[..., 0] - a[..., 2] > 30) & (a[..., 0] > 90))
        # Leave out the tile's edges, where bits of the sheet's separators linger
        f = paint.mean(axis=0)
        e = max(2, int(len(f) * 0.08))
        f[:e] = f[-e:] = 0
        cols = np.flatnonzero(f > max(0.12, 0.5 * f.max()))
        if len(cols):
            x0, x1 = cols[0], cols[-1] + 1
            pad = max(6, int((x1 - x0) * 0.6))
            crop = crop.crop((max(0, x0 - pad), 0, min(crop.width, x1 + pad), crop.height))
    if role in 'AWZ':
        # Even out stains and shading broader than an eighth of the tile, which show as a
        # checkerboard when the tile is laid down again and again; cracks and joints stay
        n = max(crop.size)
        wrap = Image.fromarray(np.pad(a, ((n // 2, n // 2), (n // 2, n // 2), (0, 0)), mode='wrap').astype(np.uint8))
        low = np.asarray(wrap.filter(ImageFilter.GaussianBlur(n / 8))).astype(np.float32)[n // 2:n // 2 + crop.height, n // 2:n // 2 + crop.width]
        a = np.clip(a - 0.9 * (low - low.mean(axis=(0, 1))), 0, 255)
        crop = Image.fromarray(a.astype(np.uint8))
    if role in 'OQT':
        # The object is what differs from the tile's edge: find the rows and columns it fills
        e = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
        diff = np.abs(np.asarray(crop.filter(ImageFilter.BoxBlur(2))).astype(np.float32) - np.median(e, axis=0)).max(axis=2) > 38
        H, W = diff.shape
        ry, rx = run_around(diff.mean(axis=1), H // 2, 0.25), run_around(diff.mean(axis=0), W // 2, 0.25)
        # Too small to be the object (texture fooled it): keep the whole tile
        if ry and rx and ry[1] - ry[0] > 0.4 * H and rx[1] - rx[0] > 0.4 * W:
            (y0, y1), (x0, x1) = ry, rx
            if role == 'O':
                # Square, with the rim where the round cut-out fades (0.45 of the tile)
                r = max(x1 - x0, y1 - y0) / 0.9 / 2
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                x0, x1, y0, y1 = cx - r, cx + r, cy - r, cy + r
            crop = crop.crop((int(max(0, x0 - 2)), int(max(0, y0 - 2)), int(min(W, x1 + 2)), int(min(H, y1 + 2))))
    return crop


def facade_items(kits):
    items = []
    for key, (f, _thr, _bridge, sheet_ppm, atlas_ppm) in KITS.items():
        im = Image.open(SRC + f).convert('RGB')
        for i, (x0, y0, x1, y1, role) in enumerate(kits[key]):
            if role not in ROLES: continue
            k = PANEL_INSET
            items.append(panel_item(key, i, im.crop((x0 + k, y0 + k, x1 - k, y1 - k)), role, sheet_ppm, atlas_ppm))
    return items


def ground_items(kits):
    items = []
    for key, (f, _how, sheet_ppm, atlas_ppm) in GROUND_KITS.items():
        im = Image.open(SRC + f).convert('RGB')
        for i, (x0, y0, x1, y1, role) in enumerate(kits[key]):
            if role not in GROUND_ROLES: continue
            k = PANEL_INSET
            crop = shape_ground(im.crop((x0 + k, y0 + k, x1 - k, y1 - k)), role)
            items.append(panel_item(key, i, crop, role, sheet_ppm, atlas_ppm))
    return items


def key_piece(a, bg):
    """Alpha for a piece on the sheet's charcoal background: what is clearly lighter than
    the background, with small dark specks inside the piece kept and stray specks dropped."""
    import cv2
    lum = a[..., :3].astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    fg = (lum > bg + 9).astype(np.uint8)
    # Background-colored areas too small to be gaps (shadows in joints, rivet heads) are piece
    n, lab, st, _ = cv2.connectedComponentsWithStats(1 - fg, connectivity=4)
    small = np.isin(lab, [i for i in range(1, n) if st[i][4] < 400])
    fg[small] = 1
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    fg = np.isin(lab, [i for i in range(1, n) if st[i][4] >= 60]).astype(np.float32)
    return cv2.GaussianBlur(fg, (3, 3), 0)


def trace_outline(alpha):
    """The largest piece's outline and its big holes, as polygons in 0..1 with y up."""
    import cv2
    m = (alpha > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    m = (lab == 1 + int(np.argmax(st[1:, 4]))).astype(np.uint8)
    cnts, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    H, W = m.shape
    norm = lambda c: [[round(float(x) / W, 4), round(1 - float(y) / H, 4)] for x, y in cv2.approxPolyDP(c, 1.5, True)[:, 0, :]]
    outer = max(range(len(cnts)), key=lambda i: cv2.contourArea(cnts[i]) if hier[0][i][3] < 0 else -1)
    holes = [norm(cnts[i]) for i in range(len(cnts)) if hier[0][i][3] == outer and cv2.contourArea(cnts[i]) > 0.02 * W * H]
    return [norm(cnts[outer])] + holes


def struct_items(kits):
    """Structure pieces at the sheet's own resolution: tiles cropped inside their edges,
    the rest cut out with alpha, and the solid ones with their outline."""
    items = []
    for key, f in STRUCT_KITS.items():
        im = Image.open(SRC + f).convert('RGB')
        a = np.asarray(im)
        g = a.astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        bg = float(np.median(np.concatenate([g[:4].ravel(), g[-4:].ravel(), g[:, :4].ravel(), g[:, -4:].ravel()])))
        for i, (x0, y0, x1, y1, role) in enumerate(kits[key]):
            if role not in STRUCT_ROLES: continue
            it = dict(name=f'{key}{i}', kit=key, role=role)
            if role in KEYED:
                # A little of the background around the piece, so its edges key cleanly
                c = a[max(0, y0 - 3):y1 + 3, max(0, x0 - 3):x1 + 3]
                alpha = key_piece(c, bg)
                it['px'] = np.dstack([c, (alpha * 255).astype(np.uint8)])
                if role in OUTLINED: it['outline'] = trace_outline(alpha)
            else:
                k = PANEL_INSET
                c = a[y0 + k:y1 - k, x0 + k:x1 - k]
                if role == 'L':
                    # Cable bundles: the run between the eye ends
                    w = c.shape[1]
                    c = c[:, int(w * 0.12):int(w * 0.76)]
                if role == 'C':
                    # Columns: the solid shaft, without the background beside it or above a round top
                    alpha = key_piece(c, bg) > 0.5
                    H, W = alpha.shape
                    cols = np.flatnonzero(alpha[H // 4:3 * H // 4].mean(axis=0) > 0.98)
                    if len(cols) > 4:
                        c, alpha = c[:, cols[0]:cols[-1] + 1], alpha[:, cols[0]:cols[-1] + 1]
                        rows = np.flatnonzero(alpha.mean(axis=1) > 0.98)
                        if len(rows) > 4: c = c[rows[0]:rows[-1] + 1]
                it['px'] = np.dstack([c, np.full(c.shape[:2], 255, np.uint8)])
            items.append(it)
    return items


def build_panels():
    """Pack the facade panels in use into panel atlas pages, the ground panels into road
    atlas pages, each scaled to its kit's texel density, and the structure pieces into
    structure pages with alpha."""
    kits = json.load(open(PANELS_JSON))
    facade, ground, struct = facade_items(kits), ground_items(kits), struct_items(kits)
    metas = {**pack(facade, list(KITS), 'panels'), **pack(ground, list(GROUND_KITS), 'roads'),
             **pack(struct, list(STRUCT_KITS), 'structs', 'webp')}
    kit_roles = {k: {r: [it['name'] for it in facade if it['kit'] == k and it['role'] == c] for c, r in ROLES.items()} for k in KITS}
    ground_roles = {k: {r: [it['name'] for it in ground if it['kit'] == k and it['role'] == c] for c, r in GROUND_ROLES.items()} for k in GROUND_KITS}
    struct_roles = {k: {r: [it['name'] for it in struct if it['kit'] == k and it['role'] == c] for c, r in STRUCT_ROLES.items()} for k in STRUCT_KITS}
    return metas, facade + ground, struct, kit_roles, ground_roles, struct_roles


def pack(items, order, prefix, fmt='jpg'):
    """Pack the panels into as few pages as fit. A kit's panels share one page, so a
    building or street samples one texture."""
    pad, W = PANEL_PAD, PANEL_ATLAS_W
    # Split the kits, in order, into as few pages of similar size as fit
    size = {k: sum((it['px'].shape[0] + 2 * pad) * (it['px'].shape[1] + 2 * pad) for it in items if it['kit'] == k) for k in order}
    n = 1
    while True:
        target, pages, cur, acc = sum(size.values()) / n, [], [], 0
        for k in order:
            if cur and acc + size[k] / 2 > target * (len(pages) + 1) and len(pages) < n - 1:
                pages.append(cur); cur = []
            cur.append(k); acc += size[k]
        pages.append(cur)
        heights = [skyline([it for it in items if it['kit'] in p], W, pad) for p in pages]
        if max(heights) <= PANEL_ATLAS_H: break
        if n >= len(order): raise ValueError('a single kit is taller than an atlas page')
        n += 1
    metas = {}
    for i, (page, H) in enumerate(zip(pages, heights)):
        name = prefix if i == 0 else f'{prefix}{i + 1}'
        on = [it for it in items if it['kit'] in page]
        skyline(on, W, pad)
        atlas = np.zeros((H, W, on[0]['px'].shape[2]), np.uint8)
        for it in on:
            it['atlas'] = name
            h, w = it['px'].shape[:2]
            x, y = it['at']
            atlas[y - pad:y + h + pad, x - pad:x + w + pad] = np.pad(it['px'], ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
        if fmt == 'webp':
            # WebP keeps the cut-out pieces' alpha at about the size of a JPEG
            Image.fromarray(atlas).save(OUT + f'city-{name}.webp', quality=84, alpha_quality=90, method=6)
        else:
            Image.fromarray(atlas).save(OUT + f'city-{name}.jpg', quality=84, optimize=True, progressive=True)
        metas[name] = dict(url=f'textures/city-{name}.{fmt}', w=W, h=H, pad=pad)
        print(name, len(on), 'panels', W, 'x', H, '(' + ', '.join(page) + ')')
    # Drop pages left over from a build that needed more of them
    import glob
    for f in glob.glob(OUT + f'city-{prefix}*.{fmt}'):
        if os.path.basename(f)[5:-len(fmt) - 1] not in metas: os.remove(f)
    return metas


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

metas, panels, parts, kit_roles, ground_roles, struct_roles = build_panels()
manifest['atlases'].update(metas)

js = '// Generated from the city texture sheets: atlas layouts and where each tile sits.\n'
js += '// Tile names are <sheet><row><col> in the original sheet; the value is [atlas, cell index, source aspect].\n'
js += 'export const ATLASES = ' + json.dumps(manifest['atlases'], indent=2) + ';\n\n'
js += 'export const TILES = {\n'
for k, v in manifest['tiles'].items():
    js += f"  {k}: ['{v[0]}', {v[1]}, {v[2]}],\n"
js += '};\n\n'
js += '// Facade and ground panels, named <kit><panel number in tools/city-panels.json>: [atlas page,\n'
js += '// x, y, w, h in the page in pixels, then the panel\'s width and height in meters].\n'
js += 'export const PANELS = {\n'
for it in panels:
    js += f"  {it['name']}: ['{it['atlas']}', {it['at'][0]}, {it['at'][1]}, {it['px'].shape[1]}, {it['px'].shape[0]}, {it['m'][0]}, {it['m'][1]}],\n"
js += '};\n\n'
js += '// Panels of each kit by role: window bays, piers (narrow strips), solid walls and vents (louvers).\n'
js += 'export const KITS = {\n'
for k, roles in kit_roles.items():
    js += f'  {k}: {{\n' + ''.join(f"    {r}: {json.dumps(names)},\n".replace('"', "'") for r, names in roles.items()) + '  },\n'
js += '};\n\n'
js += '// Ground panels of each kit by role. Crosswalks and lines are turned so their stripes run up\n'
js += '// the tile, lines are cropped to their paint, and covers and pits to their outline.\n'
js += 'export const GROUND = {\n'
for k, roles in ground_roles.items():
    js += f'  {k}: {{\n' + ''.join(f"    {r}: {json.dumps(names)},\n".replace('"', "'") for r, names in roles.items()) + '  },\n'
js += '};\n\n'
js += '// Structure pieces, named <kit><panel number in tools/city-panels.json>: [atlas page,\n'
js += '// x, y, w, h in the page in pixels]. Cards and solids have the background keyed out.\n'
js += 'export const PARTS = {\n'
for it in parts:
    js += f"  {it['name']}: ['{it['atlas']}', {it['at'][0]}, {it['at'][1]}, {it['px'].shape[1]}, {it['px'].shape[0]}],\n"
js += '};\n\n'
js += '// Structure pieces of each kit by role.\n'
js += 'export const STRUCTS = {\n'
for k, roles in struct_roles.items():
    js += f'  {k}: {{\n' + ''.join(f"    {r}: {json.dumps(names)},\n".replace('"', "'") for r, names in roles.items()) + '  },\n'
js += '};\n\n'
js += '// Outlines of the solid pieces (piers, towers, pylons): the outline, then its holes,\n'
js += '// each as [x, y] points across the piece from 0 to 1, y up.\n'
js += 'export const OUTLINES = {\n'
for it in parts:
    if 'outline' in it: js += f"  {it['name']}: {json.dumps(it['outline'], separators=(',', ':'))},\n"
js += '};\n'
open(os.path.join(ROOT, 'js', 'cityTiles.js'), 'w').write(js)
