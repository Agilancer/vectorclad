"""Build the atlases for the asset packs in assets/: cars, trees, skyscraper facades,
storefronts and roofs.

  assets/car-sprites/*.png              -> textures/cars.webp   (car nets cut into their pieces)
  assets/bark-and-foliage/*.png         -> textures/trees.jpg   (bark and foliage tiles)
  assets/skyscraper-facades/*.png       -> textures/city-kits.jpg (facade kits: bays, piers, solids, vents)
  assets/street-level-storefronts/*.png -> textures/city-stores.jpg (storefront kits: windows, entries, signs, shutters)
  assets/rooftop-textures/*.png         -> textures/city-roofs.jpg (roof coverings and roof details)

and writes js/kitTiles.js with where everything sits and, for each car, the outline of its
side profile and plan, so js/cars.js can build a body that fits its skin.

Every facade, storefront, roof and foliage sheet is a 4 x 4 grid of square modules. The grid
lines are found near the quarter marks and each module is cut a little inside them, so no
sliver of its neighbor repeats along an edge. Car sheets hold ten unfolded car nets each
(5 x 2): a plan strip down the middle (hood, roof, trunk), a full-length side profile to
either side of it, the front fascia above and the rear fascia below. Some nets have their
pieces touching, the fascias hanging off the plan strip like tabs: those are cut apart
along the narrowest gap between them. Each piece is trimmed to its opaque pixels, which
drops the pale, half-transparent rim the sheets draw around every piece, two pixels in.

Run from the repository root:  python3 tools/build_asset_atlas.py [--review DIR]
--review writes the car cuts drawn over each sheet, for checking.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
OUT = os.path.join(ROOT, 'textures')
PAD = 8

# ---------------------------------------------------------------------------
# Kits
# ---------------------------------------------------------------------------

# Skyscraper facade sheets: rows 0-1 window bays, row 2 solid wall and fins, row 3 louvers.
# key: (file prefix, wall material for destruction, styles it suits)
FACADES = {
  'sky01': ('01-', 'glass'), 'sky02': ('02-', 'stone'), 'sky03': ('03-', 'panel'), 'sky04': ('04-', 'glass'),
  'sky05': ('05-', 'brick'), 'sky06': ('06-', 'panel'), 'sky07': ('07-', 'glass'), 'sky08': ('08-', 'panel'),
  'sky09': ('09-', 'stone'), 'sky10': ('10-', 'glass'), 'sky11': ('11-', 'panel'), 'sky12': ('12-', 'stone'),
  'sky13': ('13-', 'glass'), 'sky14': ('14-', 'stone'), 'sky15': ('15-', 'stone'), 'sky16': ('16-', 'panel'),
  'sky17': ('17-', 'brick'), 'sky18': ('18-', 'glass'), 'sky19': ('19-', 'glass'), 'sky20': ('20-', 'stone'),
}
# Storefront sheets: row 0 upper-floor windows, row 1 entries (doors and shop windows),
# row 2 sign boards and plain wall, row 3 roller shutters and vents.
STORES = {f'store{i:02d}': (f'{i:02d}-', 'brick' if i in (1, 4, 14, 19) else 'stone') for i in range(1, 21)}
# Roof sheets: rows 0-1 coverings, row 3 drains, vents and hatches seen from above
ROOFS = {f'rf{i:02d}': f'{i:02d}-' for i in range(1, 21)}
# Bark and foliage sheets: each module is bark or leaves, told apart by color
TREES = {
  'oak': '01_', 'pine': '02_', 'redwood': '03_', 'maple': '04_', 'beech': '05_',
  'cedar': '06_', 'elm': '07_', 'forest': '08_', 'mossy': '09_', 'mosaic': '10_',
}
# Car sheets and the length of their cars in meters
# Car sheets, the length and width of their cars in meters
CARS = {
  'sedan': ('01-', 4.8, 1.85), 'hatch': ('02-', 4.1, 1.78), 'coupe': ('03-', 4.5, 1.85), 'super': ('04-', 4.5, 1.98),
  'muscle': ('05-', 4.9, 1.9), 'suv': ('06-', 4.9, 1.95), 'pickup': ('07-', 5.6, 2.0), 'van': ('08-', 5.2, 2.0),
  'wagon': ('09-', 4.9, 1.85), 'rally': ('10-', 4.4, 1.85),
}
FACADE_M, STORE_M, ROOF_M = 4.0, 4.2, 4.0   # meters one module spans
TILE_PX = {'facade': 128, 'store': 160, 'roof': 128, 'tree': 128}


def find(folder, prefix):
  for f in sorted(os.listdir(os.path.join(ASSETS, folder))):
    if f.startswith(prefix) and f.endswith('.png'):
      return os.path.join(ASSETS, folder, f)
  raise FileNotFoundError(prefix)


def grid_lines(img, n=4, search=22):
  """Grid lines near the quarter marks: the strongest edge within `search` px, else the mark."""
  g = np.asarray(img.convert('L'), dtype=np.float32)
  out = []
  for axis in (1, 0):
    d = np.abs(np.diff(g, axis=axis)).mean(axis=1 - axis)
    med = np.median(d) + 1e-3
    L = len(d) + 1
    lines = [0]
    for k in range(1, n):
      c = round(k * L / n)
      lo, hi = c - search, c + search
      i = lo + int(np.argmax(d[lo:hi]))
      lines.append(i + 1 if d[i] / med > 4 else c)
    lines.append(L)
    out.append(lines)
  return out  # xs, ys


def modules(path, inset=0.035):
  """The 16 modules of a 4 x 4 sheet as images, [row][col], cut a little inside the grid lines."""
  img = Image.open(path).convert('RGB')
  xs, ys = grid_lines(img)
  rows = []
  for r in range(4):
    row = []
    for c in range(4):
      x0, x1, y0, y1 = xs[c], xs[c + 1], ys[r], ys[r + 1]
      ix, iy = (x1 - x0) * inset + 3, (y1 - y0) * inset + 3
      row.append(img.crop((round(x0 + ix), round(y0 + iy), round(x1 - ix), round(y1 - iy))))
    rows.append(row)
  return rows


class Packer:
  """Shelf packer: tiles of any size go left to right in rows; each tile gets PAD px of gutter."""

  def __init__(self, width, mode='RGB'):
    self.W, self.mode = width, mode
    self.items = []
    self.x = self.y = self.rowh = 0

  def add(self, name, img, gutter='wrap'):
    w, h = img.size
    W = w + 2 * PAD
    if self.x + W > self.W:
      self.x = 0; self.y += self.rowh; self.rowh = 0
    self.items.append((name, img, self.x + PAD, self.y + PAD, gutter))
    self.x += W
    self.rowh = max(self.rowh, h + 2 * PAD)

  def render(self):
    H = self.y + self.rowh
    H = (H + 3) // 4 * 4
    a = np.zeros((H, self.W, 4 if self.mode == 'RGBA' else 3), dtype=np.uint8)
    rects = {}
    for name, img, x, y, gutter in self.items:
      t = np.asarray(img.convert(self.mode))
      t = np.pad(t, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge' if gutter == 'clear' else gutter)
      if gutter == 'clear':
        # Colors run out into the gutter, but it stays see-through
        t[:PAD, :, 3] = 0; t[-PAD:, :, 3] = 0; t[:, :PAD, 3] = 0; t[:, -PAD:, 3] = 0
      h, w = t.shape[:2]
      a[y - PAD:y - PAD + h, x - PAD:x - PAD + w] = t
      rects[name] = (x, y, img.size[0], img.size[1])
    return Image.fromarray(a, self.mode), rects


# ---------------------------------------------------------------------------
# Cars
# ---------------------------------------------------------------------------

def runs(mask):
  out, s = [], None
  for i, v in enumerate(mask):
    if v and s is None: s = i
    if not v and s is not None: out.append((s, i)); s = None
  if s is not None: out.append((s, len(mask)))
  return out


def cut_net(A):
  """
  Split one car net's alpha mask A (h x w, bool) into its five pieces.
  Returns boxes {front, top, rear, left, right} as (x0, y0, x1, y1) and each piece's mask.
  """
  h, w = A.shape
  ys, xs = np.nonzero(A)
  nx0, nx1, ny0, ny1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
  W, H = nx1 - nx0, ny1 - ny0
  # Columns: the narrowest gap between each side strip and the plan strip, looked for in
  # bands of rows so a gap shows wherever the pieces stand apart
  best = None
  for b0 in np.arange(0.12, 0.8, 0.02):
    r0, r1 = int(ny0 + H * b0), int(ny0 + H * (b0 + 0.08))
    cov = A[r0:r1, nx0:nx1].mean(0)
    def low(a, b):
      lo, hi = int(W * a), int(W * b)
      i = lo + int(np.argmin(cov[lo:hi]))
      return cov[i], i
    (ca, ia), (cb, ib) = low(0.18, 0.44), low(0.56, 0.82)
    s = ca + cb
    if best is None or s < best[0] - 1e-6: best = (s, ia, ib)
  cl, cr = nx0 + best[1], nx0 + best[2]
  # Where a gap is wide, take its middle; the strips' edges are found from the alpha below
  def widen(c, d):
    a = b = c
    col = lambda x: A[ny0 + H // 5: ny1 - H // 5, x].mean()
    while a > nx0 and col(a - 1) < 0.05: a -= 1
    while b < nx1 - 1 and col(b + 1) < 0.05: b += 1
    return (a + b) // 2
  cl, cr = widen(cl, -1), widen(cr, 1)
  # Rows down the plan strip: the narrowest gap near the top (front fascia) and bottom (rear)
  cen = A[ny0:ny1, cl:cr].mean(1)
  def gap(a, b):
    lo, hi = int(H * a), int(H * b)
    i = lo + int(np.argmin(cen[lo:hi]))
    j, k = i, i
    while j > lo and cen[j - 1] <= cen[i] + 0.02: j -= 1
    while k < hi - 1 and cen[k + 1] <= cen[i] + 0.02: k += 1
    return ny0 + (j + k) // 2
  gt, gb = gap(0.04, 0.3), gap(0.7, 0.96)

  # The gap columns row by row: where a row's side strips stand apart from the middle run, the
  # middle of each gap; between those rows, interpolated. So where a side strip's windows curve
  # in and touch the plan strip, it is cut along the plan strip's edge as it runs there, not at
  # one column for the whole sheet (that one may sit at the hood, inside the cabin's side strip).
  # The fascias, above and below the plan strip, keep the sheet-wide columns.
  cx = (cl + cr) // 2
  ys_l, gl, ys_r, gr = [], [], [], []
  for y in range(gt, gb):
    if not A[y, cx]: continue
    rs = runs(A[y])
    i = next(i for i, (s0, e0) in enumerate(rs) if s0 <= cx < e0)
    s0, e0 = rs[i]
    # a side strip's run, not a speck of the sheet's halo
    big = [k for k, (u, v) in enumerate(rs) if v - u >= W * 0.05]
    lft, rgt = [k for k in big if k < i], [k for k in big if k > i]
    if lft and nx0 + W * 0.18 <= s0 <= nx0 + W * 0.44 and rs[lft[-1]][1] > nx0 + W * 0.08:
      ys_l.append(y); gl.append((rs[lft[-1]][1] + s0) / 2)
    if rgt and nx0 + W * 0.56 <= e0 <= nx0 + W * 0.82 and rs[rgt[0]][0] < nx1 - W * 0.08:
      ys_r.append(y); gr.append((e0 + rs[rgt[0]][0]) / 2)
  def follow(ys, g, c):
    out = np.full(h, c)
    if len(ys) < 12: return out
    g = ndimage.median_filter(np.array(g), size=9, mode='nearest')
    # Beyond the first and last such rows (the fascias) the sheet-wide columns stand
    out[ys[0]:ys[-1] + 1] = np.round(np.interp(np.arange(ys[0], ys[-1] + 1), ys, g))
    return out
  CL, CR = follow(ys_l, gl, cl), follow(ys_r, gr, cr)

  # Each row is split where it really breaks: the run through the middle column is the plan
  # strip (or a fascia), what lies left and right of it the side strips. Where a side strip ran
  # into the plan strip the row is one run; there it is cut at that row's gap columns.
  part = np.zeros(A.shape, np.int8)  # 1 front, 2 top, 3 rear, 4 left, 5 right
  fused = np.zeros((h, 2), bool)  # rows where a side strip ran into the plan strip and was cut
  for y in range(ny0, ny1):
    row, l, r = A[y], CL[y], CR[y]
    c = (l + r) // 2
    a, b = c, c
    mid = 1 if y < gt else 3 if y >= gb else 2
    if row[c]:
      for s0, e0 in runs(row):
        if s0 <= c < e0: a, b = s0, e0
      # A fascia may be wider than the gap columns: it is cut there only where it runs on into a side strip
      if mid == 2 or a < nx0 + W * 0.12 or b > nx1 - W * 0.12:
        fused[y] = (a < l, b > r)
        a, b = max(a, l), min(b, r)
    else:
      a, b = l, r
    part[y, :a] = 4; part[y, a:b] = mid; part[y, b:] = 5
  part[~A] = 0
  masks, boxes = {}, {}
  for k, name in ((1, 'front'), (2, 'top'), (3, 'rear'), (4, 'left'), (5, 'right')):
    M = part == k
    # The plan strip loses the thin stalks (mirror arms) that reach out of it sideways, so its
    # rectangle is the body's own width
    if name == 'top': M = ndimage.binary_opening(M, structure=np.ones((9, 1), bool))
    # Keep the piece's main body: drop specks cut off from it (mirrors, bits of a neighbor)
    lab, nl = ndimage.label(M)
    if nl > 1:
      sizes = ndimage.sum(M, lab, range(1, nl + 1))
      M = lab == (1 + int(np.argmax(sizes)))
    # and its edge: the sheets draw a pale, half-transparent rim round every piece
    M = ndimage.binary_erosion(M, iterations=2)
    if M.any():
      yy, xx = np.nonzero(M)
      boxes[name] = (xx.min(), yy.min(), xx.max() + 1, yy.max() + 1)
    else:
      boxes[name] = (cx, ny0, cx + 1, ny0 + 1)
    masks[name] = M
  return boxes, masks, fused


def stations(side, sbox, outer_left, fused, top_mask, tbox, length, width, n=28):
  """
  The body's shape at n stations from the front bumper to the rear one, for js/cars.js:
  [bottom, top, half-width, texture top] per station, in meters except the last, which is where
  the strip's own pixels end across it (0..1), so its texture stretches over the body exactly.

  side: the side strip's mask, lying with the wheels on its outer edge (outer_left: on its left),
  so height above the ground runs inward; fused: per row of the sheet, whether it ran into the
  plan strip and was cut from it there. Should such a row still have come out low, the body there
  is raised to the line of the rows that weren't cut. top_mask: the plan strip.
  """
  x0, y0, x1, y1 = sbox
  sub = side[y0:y1, x0:x1]
  L, W = y1 - y0, x1 - x0
  bot, top, clamped, ok = np.zeros(n), np.zeros(n), np.zeros(n, bool), np.zeros(n, bool)
  for k in range(n):
    r0, r1 = int(k * L / n), max(int(k * L / n) + 1, int((k + 1) * L / n))
    xs = np.nonzero(sub[r0:r1].any(0))[0]
    if not len(xs): continue
    if outer_left: b, t = xs.min(), xs.max() + 1
    else: b, t = W - (xs.max() + 1), W - xs.min()
    bot[k], top[k], ok[k] = b, t, True
    clamped[k] = fused[y0 + r0:y0 + r1].mean() > 0.5
  # Fill empty stations from their neighbors
  idx = np.arange(n)
  if ok.sum() >= 2:
    bot = np.interp(idx, idx[ok], bot[ok]); top = np.interp(idx, idx[ok], top[ok])
  tex = top / W  # where the strip's pixels end, across it
  geo_top = top.copy()
  # A station cut from the plan strip is never lower than its uncut neighbors make it
  if clamped.any() and (~clamped).sum() >= 2:
    geo_top = np.where(clamped, np.maximum(top, np.interp(idx, idx[~clamped], top[~clamped])), top)
  geo_top = ndimage.median_filter(geo_top, size=3, mode='nearest')
  # Front and rear faces: as tall as the hood and the trunk lid, from the bumpers' feet
  geo_top[0] = geo_top[1] = max(geo_top[2], geo_top[1]); geo_top[-1] = geo_top[-2] = max(geo_top[-3], geo_top[-2])
  bot[0] = bot[1] = bot[2]; bot[-1] = bot[-2] = bot[-3]
  tex[0] = tex[1] = tex[2]; tex[-1] = tex[-2] = tex[-3]
  scale = length / L
  geo_top = np.maximum(geo_top * scale, bot * scale + 0.3)
  # The plan strip's width, station by station, gives the body's plan
  tx0, ty0, tx1, ty1 = tbox
  tsub = top_mask[ty0:ty1, tx0:tx1]
  TL = ty1 - ty0
  half = np.zeros(n)
  for k in range(n):
    r0, r1 = int(k * TL / n), max(int(k * TL / n) + 1, int((k + 1) * TL / n))
    xs = np.nonzero(tsub[r0:r1].any(0))[0]
    half[k] = (xs.max() + 1 - xs.min()) if len(xs) else 0
  # Mirrors and stalks reach out of the plan strip at a station or two: filter them off before
  # taking the widest station as the body's full width
  half = ndimage.median_filter(half, size=5, mode='nearest')
  frac = np.clip(half / max(1, half.max()), 0.7, 1)
  out = []
  for k in range(n):
    out.append([round(float(bot[k] * scale), 3), round(float(geo_top[k]), 3), round(float(width / 2 * frac[k]), 3), round(float(min(1, tex[k])), 3)])
  return out


def bleed(rgba, steps=6):
  """Spread opaque colors into the transparent pixels around them, so mipmaps don't darken edges"""
  a = rgba.astype(np.float32)
  rgb, al = a[..., :3], a[..., 3:] / 255
  w = (al > 0.5).astype(np.float32)
  col = rgb * w
  for _ in range(steps):
    c2 = np.zeros_like(col); w2 = np.zeros_like(w)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
      c2 += np.roll(col, (dy, dx), (0, 1)); w2 += np.roll(w, (dy, dx), (0, 1))
    fill = (w < 0.5) & (w2 > 0)
    col = np.where(fill, c2 / np.maximum(w2, 1e-6), col)
    w = np.where(fill, 1.0, w)
  out = a.copy()
  out[..., :3] = np.where(w > 0.5, col, rgb)
  return out.clip(0, 255).astype(np.uint8)


def build_cars(review=None):
  pk = Packer(4096, 'RGBA')
  cars = []
  scale = 0.62
  for kind, (prefix, length, width) in CARS.items():
    path = find('car-sprites', prefix)
    sheet = np.asarray(Image.open(path).convert('RGBA'))
    Hs, Ws = sheet.shape[:2]
    over = Image.alpha_composite(Image.new("RGBA", (Ws, Hs), (40, 40, 40, 255)), Image.fromarray(sheet)).convert("RGB") if review else None
    dr = ImageDraw.Draw(over) if review else None
    for r in range(2):
      for c in range(5):
        cx0, cx1, cy0, cy1 = round(c * Ws / 5), round((c + 1) * Ws / 5), round(r * Hs / 2), round((r + 1) * Hs / 2)
        cell = sheet[cy0:cy1, cx0:cx1]
        A = cell[..., 3] > 160
        boxes, masks, cuts = cut_net(A)
        name = f'{kind}{r * 5 + c}'
        sk = 'left' if boxes['left'][3] - boxes['left'][1] >= boxes['right'][3] - boxes['right'][1] else 'right'
        prof = stations(masks[sk], boxes[sk], sk == 'left', cuts[:, 0 if sk == 'left' else 1], masks['top'], boxes['top'], length, width)
        rec = {'name': name, 'kind': kind, 'length': length, 'width': width, 'side': sk, 'prof': prof, 'parts': {}}
        for part, (x0, y0, x1, y1) in boxes.items():
          piece = cell[y0:y1, x0:x1].copy()
          piece[..., 3] = np.where(masks[part][y0:y1, x0:x1], 255, 0)
          piece = bleed(piece)
          # Colors and mask scaled apart (an RGBA resize would blacken the bled colors under alpha 0),
          # then bled again at the new size
          size = (max(4, round(piece.shape[1] * scale)), max(4, round(piece.shape[0] * scale)))
          rgb = np.asarray(Image.fromarray(piece[..., :3], 'RGB').resize(size, Image.LANCZOS))
          al = np.asarray(Image.fromarray(piece[..., 3], 'L').resize(size, Image.LANCZOS))
          im = Image.fromarray(bleed(np.dstack([rgb, al])), 'RGBA')
          pk.add(f'{name}.{part}', im, 'clear')
          if dr: dr.rectangle((cx0 + x0, cy0 + y0, cx0 + x1 - 1, cy0 + y1 - 1), outline=(255, 0, 255) if part in ('left', 'right') else (0, 255, 255), width=2)
        cars.append(rec)
    if review: over.save(os.path.join(review, f'cars-{kind}.jpg'), quality=85)
  img, rects = pk.render()
  for rec in cars:
    for part in ('front', 'top', 'rear', 'left', 'right'):
      rec['parts'][part] = rects[f"{rec['name']}.{part}"]
  # exact: keep the colors under alpha 0, which filtering at the pieces' edges reads
  img.save(os.path.join(OUT, 'cars.webp'), quality=88, method=6, exact=True)
  return {'url': 'textures/cars.webp', 'w': img.size[0], 'h': img.size[1]}, cars


# ---------------------------------------------------------------------------
# Trees, facades, storefronts and roofs
# ---------------------------------------------------------------------------

def is_leaf(img):
  a = np.asarray(img.convert('RGB'), dtype=np.float32).reshape(-1, 3).mean(0)
  return a[1] > a[0] * 1.05 and a[1] > a[2] * 1.05


def build_trees():
  pk = Packer(2048)
  sets = {}
  px = TILE_PX['tree']
  for kind, prefix in TREES.items():
    rows = modules(find('bark-and-foliage', prefix), inset=0.03)
    S = sets[kind] = {'bark': [], 'leaf': []}
    for r, row in enumerate(rows):
      for c, im in enumerate(row):
        n = f'{kind}{r}{c}'
        # Mirrored gutters: js/trees.js samples the tiles mirrored, so at an edge it wants the edge again
        pk.add(n, im.resize((px, px), Image.LANCZOS), 'symmetric')
        S['leaf' if is_leaf(im) else 'bark'].append(n)
  img, rects = pk.render()
  img.save(os.path.join(OUT, 'trees.jpg'), quality=86)
  return {'url': 'textures/trees.jpg', 'w': img.size[0], 'h': img.size[1]}, rects, sets


def build_kits():
  pk, sp = Packer(4096), Packer(4096)
  meters, kits, mats = {}, {}, {}
  fpx, spx = TILE_PX['facade'], TILE_PX['store']
  for kit, (prefix, mat) in FACADES.items():
    rows = modules(find('skyscraper-facades', prefix))
    K = kits[kit] = {'bays': [], 'piers': [], 'solids': [], 'vents': []}
    mats[kit] = mat
    for r, row in enumerate(rows):
      for c, im in enumerate(row):
        n = f'{kit}_{r}{c}'
        pk.add(n, im.resize((fpx, fpx), Image.LANCZOS))
        meters[n] = (FACADE_M, FACADE_M)
        K['bays' if r < 2 else 'solids' if r == 2 else 'vents'].append(n)
        if r == 2:
          # A pier: a narrow slice down the middle of each wall module, 1.4 m wide
          w = im.size[0]
          sl = im.crop((round(w * 0.36), 0, round(w * 0.64), im.size[1]))
          pn = f'{kit}_p{c}'
          pk.add(pn, sl.resize((round(fpx * 0.28), fpx), Image.LANCZOS))
          meters[pn] = (FACADE_M * 0.28, FACADE_M)
          K['piers'].append(pn)
  for kit, (prefix, mat) in STORES.items():
    rows = modules(find('street-level-storefronts', prefix))
    K = kits[kit] = {'bays': [], 'piers': [], 'solids': [], 'vents': [], 'entries': [], 'signs': []}
    mats[kit] = mat
    for r, row in enumerate(rows):
      for c, im in enumerate(row):
        n = f'{kit}_{r}{c}'
        sp.add(n, im.resize((spx, spx), Image.LANCZOS))
        meters[n] = (STORE_M, STORE_M)
        K[['bays', 'entries', 'solids', 'vents'][r]].append(n)
        if r == 2:
          # The top third of each sign module: a sign board over the shop fronts
          sn = f'{kit}_s{c}'
          sl = im.crop((0, 0, im.size[0], round(im.size[1] * 0.3)))
          sp.add(sn, sl.resize((spx, round(spx * 0.3)), Image.LANCZOS))
          meters[sn] = (STORE_M, STORE_M * 0.3)
          K['signs'].append(sn)
  img, rects = pk.render()
  img.save(os.path.join(OUT, 'city-kits.jpg'), quality=84)
  atlas = {'url': 'textures/city-kits.jpg', 'w': img.size[0], 'h': img.size[1], 'pad': PAD}
  simg, srects = sp.render()
  simg.save(os.path.join(OUT, 'city-stores.jpg'), quality=84)
  satlas = {'url': 'textures/city-stores.jpg', 'w': simg.size[0], 'h': simg.size[1], 'pad': PAD}

  rp = Packer(4096)
  roofs, rmeters = {}, {}
  for key, prefix in ROOFS.items():
    rows = modules(find('rooftop-textures', prefix))
    R = roofs[key] = {'cover': [], 'detail': [], 'edge': []}
    for r, row in enumerate(rows):
      for c, im in enumerate(row):
        n = f'{key}_{r}{c}'
        rp.add(n, im.resize((TILE_PX['roof'], TILE_PX['roof']), Image.LANCZOS))
        rmeters[n] = (ROOF_M, ROOF_M) if r < 2 else (1.6, 1.6) if r == 3 else (ROOF_M, ROOF_M)
        R['cover' if r < 2 else 'edge' if r == 2 else 'detail'].append(n)
  rimg, rrects = rp.render()
  rimg.save(os.path.join(OUT, 'city-roofs.jpg'), quality=84)
  ratlas = {'url': 'textures/city-roofs.jpg', 'w': rimg.size[0], 'h': rimg.size[1], 'pad': PAD}
  return atlas, rects, satlas, srects, meters, kits, mats, ratlas, rrects, rmeters, roofs


def js(v):
  return json.dumps(v, separators=(',', ':'))


def main():
  review = None
  if '--review' in sys.argv:
    review = sys.argv[sys.argv.index('--review') + 1]
    os.makedirs(review, exist_ok=True)
  car_atlas, cars = build_cars(review)
  tree_atlas, tree_rects, tree_sets = build_trees()
  atlas, rects, satlas, srects, meters, kits, mats, ratlas, rrects, rmeters, roofs = build_kits()

  L = []
  L.append('// Generated by tools/build_asset_atlas.py from the packs in assets/. Do not edit by hand.')
  L.append('// Merges the facade, storefront and roof kits into the city tiles (js/cityTiles.js), and')
  L.append('// lists the tree tiles and the car skins with their outlines.')
  L.append("import { ATLASES, PANELS, KITS } from './cityTiles.js';")
  L.append('')
  L.append('// Pages: the kits and roofs join the city atlases; trees and cars are their own')
  L.append(f'export const ASSET_ATLASES = {{ panelsKit: {js(atlas)}, panelsStore: {js(satlas)}, roofsKit: {js(ratlas)}, trees: {js(tree_atlas)}, cars: {js(car_atlas)} }};')
  L.append('Object.assign(ATLASES, ASSET_ATLASES);')
  L.append('')
  L.append('// Panels as in cityTiles.js: [atlas, x, y, w, h, width m, height m]')
  L.append('const P = {')
  for n, (x, y, w, h) in rects.items():
    mw, mh = meters[n]
    L.append(f"  {n}: ['panelsKit', {x}, {y}, {w}, {h}, {mw:.3g}, {mh:.3g}],")
  for n, (x, y, w, h) in srects.items():
    mw, mh = meters[n]
    L.append(f"  {n}: ['panelsStore', {x}, {y}, {w}, {h}, {mw:.3g}, {mh:.3g}],")
  for n, (x, y, w, h) in rrects.items():
    mw, mh = rmeters[n]
    L.append(f"  {n}: ['roofsKit', {x}, {y}, {w}, {h}, {mw:.3g}, {mh:.3g}],")
  for n, (x, y, w, h) in tree_rects.items():
    L.append(f"  tree_{n}: ['trees', {x}, {y}, {w}, {h}, 2, 2],")
  L.append('};')
  L.append('Object.assign(PANELS, P);')
  L.append('')
  L.append('// Facade kits (skyN) and storefront kits (storeN: also entries and sign boards)')
  L.append(f'export const NEW_KITS = {js(kits)};')
  L.append('Object.assign(KITS, NEW_KITS);')
  L.append('// What each kit is built of, for destruction')
  L.append(f'export const KIT_MATS = {js(mats)};')
  L.append('// Roof sheets: coverings, edge flashing and details (drains, vents, hatches)')
  L.append(f'export const ROOF_KITS = {js(roofs)};')
  L.append("// Bark and foliage tiles by sheet (panel names are tree_<sheet><row><col>)")
  L.append(f'export const TREE_TILES = {js({k: {"bark": ["tree_" + n for n in v["bark"]], "leaf": ["tree_" + n for n in v["leaf"]]} for k, v in tree_sets.items()})};')
  L.append('')
  L.append('// Car skins: the pieces of each net in the cars atlas ([x, y, w, h] px), the side profile')
  L.append('// (bottom and top of the body, front to back) and the plan half-width, as fractions of the length')
  L.append('export const CAR_SKINS = [')
  for c in cars:
    L.append('  ' + js(c) + ',')
  L.append('];')
  with open(os.path.join(ROOT, 'js', 'kitTiles.js'), 'w') as f:
    f.write('\n'.join(L) + '\n')
  print('cars', car_atlas, 'trees', tree_atlas, 'kits', atlas, 'stores', satlas, 'roofs', ratlas)


if __name__ == '__main__':
  main()
