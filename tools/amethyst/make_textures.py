# Paints the AM-05 Amethyst's textures: run with the system Python (needs Pillow and numpy).
#   python tools/amethyst/make_textures.py
# Writes tools/amethyst/tex/:
#   paint.jpg   a tileable near-white wear map (chips, scuffs, faint mottling). The armor materials
#               multiply it by their purple, white or gray, so one map weathers every plate.
#   decals.png  the stencil atlas (emblem, triangles, chevrons, stencil text, the purple thigh
#               label), white on clear unless noted. DECALS in build_am05.py names each cell.
import os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'tex')
os.makedirs(OUT, exist_ok=True)
rng = random.Random(5)


def font(size, bold=True):
  for name in (['bahnschrift.ttf', 'arialbd.ttf'] if bold else ['bahnschrift.ttf', 'arial.ttf']):
    try:
      return ImageFont.truetype(os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts', name), size)
    except OSError:
      pass
  return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Wear map
# ---------------------------------------------------------------------------

def tile_noise(n, cells, seed):
  """Smooth value noise that wraps at the edges."""
  r = np.random.default_rng(seed)
  g = r.random((cells, cells))
  x = np.linspace(0, cells, n, endpoint=False)
  i0 = np.floor(x).astype(int); f = x - i0; i1 = (i0 + 1) % cells
  f = f * f * (3 - 2 * f)
  a = g[np.ix_(i0, i0)]; b = g[np.ix_(i0, i1)]; c = g[np.ix_(i1, i0)]; d = g[np.ix_(i1, i1)]
  fx = f[None, :]; fy = f[:, None]
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def wear_map(n=1024):
  base = 0.9 + 0.035 * tile_noise(n, 6, 1) + 0.02 * tile_noise(n, 24, 2) + 0.01 * tile_noise(n, 96, 3)
  img = np.stack([base * 1.0, base * 0.995, base * 1.0], -1)
  img = np.clip(img / base.max(), 0, 1)
  im = Image.fromarray((img * 255).astype(np.uint8))
  d = ImageDraw.Draw(im)

  def wrap_poly(pts, fill):
    for ox in (-n, 0, n):
      for oy in (-n, 0, n):
        d.polygon([(x + ox, y + oy) for x, y in pts], fill=fill)

  def wrap_line(a, b, fill, w):
    for ox in (-n, 0, n):
      for oy in (-n, 0, n):
        d.line([(a[0] + ox, a[1] + oy), (b[0] + ox, b[1] + oy)], fill=fill, width=w)

  # Chips: small jagged spots of dark maroon primer showing through, as on the sheet
  for _ in range(95):
    cx, cy = rng.uniform(0, n), rng.uniform(0, n)
    r = rng.uniform(2, 6) if rng.random() < 0.85 else rng.uniform(6, 11)
    k = rng.randint(5, 9)
    pts = []
    for j in range(k):
      a = 2 * math.pi * j / k + rng.uniform(-0.3, 0.3)
      rr = r * rng.uniform(0.45, 1.25)
      pts.append((cx + math.cos(a) * rr * 1.4, cy + math.sin(a) * rr))
    tone = rng.choice([(110, 48, 52), (92, 42, 48), (128, 70, 64), (84, 66, 74)])
    wrap_poly(pts, tone)
  # Scuffs: short thin scratches
  for _ in range(90):
    x, y = rng.uniform(0, n), rng.uniform(0, n)
    a = rng.uniform(0, math.pi)
    l = rng.uniform(8, 40)
    wrap_line((x, y), (x + math.cos(a) * l, y + math.sin(a) * l), (120, 104, 112), 1)
  # Tiny pin dots
  for _ in range(160):
    x, y = rng.uniform(0, n), rng.uniform(0, n)
    s = rng.uniform(0.8, 2.0)
    wrap_poly([(x - s, y - s), (x + s, y - s), (x + s, y + s), (x - s, y + s)], (90, 60, 66))
  im = im.filter(ImageFilter.GaussianBlur(0.6))
  im.save(os.path.join(OUT, 'paint.jpg'), quality=90)


# ---------------------------------------------------------------------------
# Decal atlas (1024 x 1024, cells of 256 unless noted)
# ---------------------------------------------------------------------------

W = (246, 244, 250, 255)
PURPLE = (126, 66, 182, 255)


def decals(n=1024):
  im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
  d = ImageDraw.Draw(im)

  # (0,0) emblem: a rounded shield frame round a squared "gate" glyph, over a split base bar
  ox, oy = 0, 0
  d.rounded_rectangle([ox + 28, oy + 22, ox + 228, oy + 200], radius=34, outline=W, width=18)
  d.rectangle([ox + 78, oy + 64, ox + 178, oy + 156], outline=W, width=16)
  d.rectangle([ox + 120, oy + 56, ox + 136, oy + 164], fill=W)
  d.rectangle([ox + 70, oy + 102, ox + 186, oy + 118], fill=W)
  d.polygon([(ox + 52, oy + 212), (ox + 204, oy + 212), (ox + 184, oy + 240), (ox + 72, oy + 240)], fill=W)
  d.rectangle([ox + 122, oy + 206, ox + 134, oy + 246], fill=(0, 0, 0, 0))

  # (256,0) triangle with an inner bar
  ox = 256
  d.polygon([(ox + 128, 26), (ox + 236, 222), (ox + 20, 222)], outline=W, width=20)
  d.polygon([(ox + 128, 26), (ox + 236, 222), (ox + 20, 222)], fill=None, outline=W)
  for w in range(20):
    pass
  d.line([(ox + 128, 26), (ox + 236, 222)], fill=W, width=20)
  d.line([(ox + 236, 222), (ox + 20, 222)], fill=W, width=20)
  d.line([(ox + 20, 222), (ox + 128, 26)], fill=W, width=20)
  d.rectangle([ox + 86, 160, ox + 170, 180], fill=W)

  # (512,0) down-pointing triangle outline with a solid inner triangle
  ox = 512
  for a, b in (((ox + 22, 34), (ox + 234, 34)), ((ox + 234, 34), (ox + 128, 228)), ((ox + 128, 228), (ox + 22, 34))):
    d.line([a, b], fill=W, width=18)
  d.polygon([(ox + 86, 76), (ox + 170, 76), (ox + 128, 154)], fill=W)

  # (768,0) chevrons
  ox = 768
  for k in range(3):
    y = 40 + k * 64
    d.polygon([(ox + 24, y), (ox + 128, y + 70), (ox + 232, y), (ox + 232, y + 30), (ox + 128, y + 100), (ox + 24, y + 30)], fill=W)

  # (0,256) 1024 x 128: frame code
  f = font(92)
  d.text((24, 268), 'AM-05  AMETHYST', font=f, fill=W)
  # (0,384) 1024 x 128: service text, two lines
  f2 = font(40, False)
  d.text((24, 396), 'VECTORCLAD ARMORY  //  FRAME UNIT 05', font=f2, fill=W)
  d.text((24, 446), 'CAUTION: HIGH VOLTAGE  -  NO STEP  -  3B-77', font=f2, fill=W)

  # (0,512) 512 x 256: purple label plate (opaque) for the thighs, white text and a bar code
  d.rounded_rectangle([8, 520, 504, 760], radius=18, fill=PURPLE)
  d.rounded_rectangle([20, 532, 492, 748], radius=12, outline=W, width=6)
  d.text((44, 552), 'AM-05', font=font(84), fill=W)
  d.text((44, 652), 'THIGH ARMOR  L/R', font=font(40, False), fill=W)
  for i in range(18):
    w = 4 if i % 3 else 8
    d.rectangle([330 + i * 9, 560, 330 + i * 9 + w, 630], fill=W)

  # (512,512) big numerals "05"
  d.text((540, 548), '05', font=font(150), fill=W)

  # (768,512) caution hatch, orange on dark (opaque)
  hatch = Image.new('RGBA', (240, 240), (40, 38, 44, 255))
  hd = ImageDraw.Draw(hatch)
  for k in range(-8, 10):
    x = k * 40
    hd.polygon([(x, 240), (x + 20, 240), (x + 260, 0), (x + 240, 0)], fill=(214, 120, 44, 255))
  im.paste(hatch, (776, 520))

  # (0,768) small "no step" mark: a slashed boot in a ring
  ox, oy = 0, 768
  d.ellipse([ox + 30, oy + 30, ox + 226, oy + 226], outline=W, width=16)
  d.polygon([(ox + 90, oy + 80), (ox + 130, oy + 80), (ox + 132, oy + 140), (ox + 176, oy + 150), (ox + 176, oy + 176), (ox + 90, oy + 176)], fill=W)
  d.line([(ox + 64, oy + 192), (ox + 192, oy + 64)], fill=W, width=16)

  # (256,768) bar code strip
  ox = 256
  x = ox + 20
  r2 = random.Random(9)
  while x < ox + 236:
    w = r2.choice([4, 4, 6, 10])
    d.rectangle([x, oy + 70, x + w, oy + 170], fill=W)
    x += w + r2.choice([4, 6, 8])
  d.text((ox + 24, oy + 180), '0512-AM', font=font(36, False), fill=W)

  # (512,768) ring target with tick marks
  ox = 512
  d.ellipse([ox + 40, oy + 40, ox + 216, oy + 216], outline=W, width=12)
  d.ellipse([ox + 100, oy + 100, ox + 156, oy + 156], fill=W)
  for a in range(4):
    c, s = math.cos(a * math.pi / 2), math.sin(a * math.pi / 2)
    d.line([(ox + 128 + c * 70, oy + 128 + s * 70), (ox + 128 + c * 118, oy + 128 + s * 118)], fill=W, width=12)

  # (768,768) stripes: three short slashes
  ox = 768
  for k in range(3):
    x = ox + 40 + k * 64
    d.polygon([(x, oy + 210), (x + 36, oy + 210), (x + 96, oy + 46), (x + 60, oy + 46)], fill=W)

  im.save(os.path.join(OUT, 'decals.png'))


if __name__ == '__main__':
  wear_map()
  decals()
  print('wrote', os.listdir(OUT))
