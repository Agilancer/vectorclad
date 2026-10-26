# Builds the AM-05 Amethyst in Blender and writes assets/amethyst-frame/am05.glb.
# Run it from the Blender MCP (runpy.run_path on this file) or `blender -b -P tools/amethyst/build_am05.py`.
# First paint the textures with the system Python: python tools/amethyst/make_textures.py
#
# Reference: assets/amethyst-frame/reference-body.webp (front and back, Vitruvian stance),
# reference-head.webp (the helm in side profile) and reference-pylon.webp (the back pylon).
#
# The GLB is one empty per rig joint, named AM05_<joint>, holding that joint's armor in the joint's
# own frame at rest (arms and legs hanging straight down). Joints the stock rig doesn't have
# (codpiece, skirts, pauldrons, pylons, finger segments) are empties too; AmethystMech
# (assets/amethyst-frame/amethyst-mech.js) creates a pivot for each at the same place.
#   pl_*  armor plates and shells, outlined in game
#   dt_*  merged small details (no outline)
#   dc_*  decals (alpha-tested)
import bpy, math, os, sys, importlib
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, 'assets', 'amethyst-frame', 'am05.glb')
TEX = os.path.join(HERE, 'tex')
sys.path.insert(0, HERE)
import am05_lib as L
importlib.reload(L)
from am05_lib import V, Geo, xf, frame, slab, prism, fprism, box, loft, loftz, cyl, ring, sphere, tube, rod, seg, bolt, quad, shell, taper, Builder

# ---------------------------------------------------------------------------
# Proportions (game units, full size; the game draws the frame at AmethystMech.SIZE).
# Measured off reference-body.webp, scaled so the chest matches the stock frame's.
# Keep in step with LEG and the joint positions in amethyst-mech.js.
# ---------------------------------------------------------------------------
LEG = dict(hipDrop=0.45, thigh=2.2, shin=3.5, foot=1.2)
HIP_X = 0.78
STAND = LEG['hipDrop'] + LEG['thigh'] + LEG['shin'] + LEG['foot']

DECALS = {
  'emblem': (0, 0, 256, 256), 'triBar': (256, 0, 512, 256), 'triDown': (512, 0, 768, 256), 'chevrons': (768, 0, 1024, 256),
  'code': (0, 256, 1024, 384), 'service': (0, 384, 1024, 512), 'label': (0, 512, 512, 768), 'n05': (512, 512, 768, 768),
  'hatch': (768, 512, 1024, 768), 'noStep': (0, 768, 256, 1024), 'barcode': (256, 768, 512, 1024), 'target': (512, 768, 768, 1024),
  'slashes': (768, 768, 1024, 1024),
}

PURPLE = (0.25, 0.075, 0.56)
WHITE = (0.79, 0.76, 0.84)
GRAY = (0.36, 0.345, 0.39)


def setup():
  col = bpy.data.collections.get('AM05')
  if col:
    for o in list(col.objects): bpy.data.objects.remove(o, do_unlink=True)
  else:
    col = bpy.data.collections.new('AM05'); bpy.context.scene.collection.children.link(col)
  for me in [m for m in bpy.data.meshes if not m.users]: bpy.data.meshes.remove(me)
  def img(name):
    i = bpy.data.images.get(name)
    if i: bpy.data.images.remove(i)
    return bpy.data.images.load(os.path.join(TEX, name))
  paint, dec = img('paint.jpg'), img('decals.png')
  b = Builder('AM05', col)
  b.depth = DEPTH
  M = L.material
  b.mats = {
    'purple': M('purple', PURPLE, 0.4, 0.12, tex=paint),
    'white': M('white', WHITE, 0.36, 0.06, tex=paint),
    'gray': M('gray', GRAY, 0.42, 0.3, tex=paint),
    'dark': M('dark', (0.03, 0.029, 0.037), 0.5, 0.55),
    'dark2': M('dark2', (0.072, 0.068, 0.088), 0.42, 0.6),
    'black': M('black', (0.011, 0.011, 0.013), 0.7, 0.2),
    'copper': M('copper', (0.55, 0.16, 0.035), 0.34, 0.65),
    'metal': M('metal', (0.42, 0.42, 0.46), 0.24, 0.9),
    'cyan': M('cyan', (0.12, 0.78, 1.0), 0.2, 0.0, emit=4.0),
    'lens': M('lens', (0.02, 0.32, 0.42), 0.05, 0.6, emit=1.2),
    'decal': M('decal', (1, 1, 1), 0.45, 0.05, alpha_tex=dec),
  }
  return b


# Front-to-back depth per joint: every part on it is deepened by this much about the joint
DEPTH = dict(pelvis=1.3, codpiece=1.3, rearPlate=1.3, skirt=1.2, waist=1.3, chest=1.35, backpack=1.35, pauldron=1.2)


def rig(b):
  J = b.joint
  J('body', None, (0, STAND, 0))
  J('pelvis', 'body', (0, 0, 0))
  J('waist', 'body', (0, 0.2, 0))
  J('chest', 'waist', (0, 0.75, 0))
  J('head', 'chest', (0, 1.55, 0.16))
  J('backpack', 'chest', (0, 0.72, -0.89))
  for s, k in ((1, 'L'), (-1, 'R')):
    J('hip_' + k, 'pelvis', (s * HIP_X, -LEG['hipDrop'], 0))
    J('knee_' + k, 'hip_' + k, (0, -LEG['thigh'], 0))
    J('ankle_' + k, 'knee_' + k, (0, -LEG['shin'], 0))
    J('shoulder_' + k, 'chest', (s * 1.4, 1.0, -0.05))
    J('elbow_' + k, 'shoulder_' + k, (0, -1.15, 0))
    J('hand_' + k, 'elbow_' + k, (0, -1.4, 0.02))


# ---------------------------------------------------------------------------
# Small builders on top of the geometry library
# ---------------------------------------------------------------------------

class Kit:
  def __init__(self, b):
    self.b = b

  def plate(self, j, pts, at, n=(0, 0, 1), up=(0, 1, 0), t=0.14, ch=0.045, mat='purple', groove=None, bulge=0.0, name=None, back_ch=0.0):
    g, face = slab(pts, t=t, ch=ch, groove=groove, bulge=bulge, back_ch=back_ch)
    # Tilt about the plate's own centre: pts are laid out as if the plate faced the nearest axis
    nn = V(n).normalized()
    ax = max(range(3), key=lambda i: abs(nn[i]))
    n0 = V((0, 0, 0)); n0[ax] = 1 if nn[ax] > 0 else -1
    c = V((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), 0))
    B0, F = frame((0, 0, 0), n0, up), frame((0, 0, 0), nn, up)
    M = Matrix.Translation(V(at) + B0.to_3x3() @ c) @ F @ Matrix.Translation(-c)
    self.b.emit(j, g.xf(M), mat, name or mat)
    return M, ch

  def side(self, j, s, x, pts, fz=0.0, y=0.0, turn=0.0, **kw):
    """Plate on a limb's outer (s=+1 left, -1 right) face; pts given as (forward, up)."""
    n = (s * math.cos(turn), 0, math.sin(turn))
    return self.plate(j, [(-s * f, yy) + tuple(rest) for f, yy, *rest in pts], (s * x, y, fz), n=n, **kw)

  def mesh(self, j, g, mat, name=None, detail=False):
    self.b.emit(j, g, mat, name, detail)

  def det(self, j, g, mat, raw=False):
    self.b.emit(j, g, mat, detail=True, raw=raw)

  def decal(self, j, M, ch, u, v, size, cell, r=0.0, aspect=None):
    x0, y0, x1, y1 = DECALS[cell]
    a = (x1 - x0) / (y1 - y0) if aspect is None else aspect
    w, h = (size * a, size) if a >= 1 else (size, size / a)
    g = quad(w, h).xf(M @ xf((u, v, ch + 0.006), (0, 0, r)))
    self.b.decal(j, g, DECALS[cell])

  def bolts(self, j, M, ch, uvs, r=0.022):
    for u, v in uvs:
      self.det(j, bolt(r, 0.03).xf(M @ xf((u, v, ch))), 'dark2')

  def gear(self, j, at, r, axis='x', n=5, depth=0.16):
    """The sheet's wheel hubs: a black tire round a recessed dark disc, copper rim and spokes, dark hub."""
    if axis == 'x': R = Matrix.Rotation(-math.pi / 2, 4, 'Z') if at[0] >= 0 else Matrix.Rotation(math.pi / 2, 4, 'Z')
    elif axis == 'z': R = Matrix.Rotation(math.pi / 2, 4, 'X') if at[2] >= 0 else Matrix.Rotation(-math.pi / 2, 4, 'X')
    else: R = Matrix.Identity(4)
    # placed through the joint's depth scaling, but kept round
    at = (self.b.pre[j] @ V(at)) if j in self.b.pre else V(at)
    M = Matrix.Translation(at) @ R  # local +y faces outward
    det = lambda g, m: self.det(j, g, m, raw=True)
    det(cyl(r, depth, 24, ch=0.025).xf(M), 'black')
    det(cyl(r * 0.78, 0.02, 24).xf(M @ xf((0, depth / 2 + 0.005, 0))), 'dark')
    det(ring(r * 0.8, r * 0.66, 0.05, 24).xf(M @ xf((0, depth / 2 + 0.01, 0))), 'copper')
    for k in range(n):
      a = 2 * math.pi * k / n
      det(box(r * 0.62, 0.035, r * 0.14, 0.01).xf(M @ xf((math.cos(a) * r * 0.36, depth / 2 + 0.02, math.sin(a) * r * 0.36), (0, -a, 0))), 'copper')
    det(cyl(r * 0.24, 0.08, 12, ch=0.012).xf(M @ xf((0, depth / 2 + 0.03, 0))), 'copper')
    det(cyl(r * 0.12, 0.05, 8).xf(M @ xf((0, depth / 2 + 0.07, 0))), 'dark2')

  def segs(self, j, a, b_, w, d, n, mats=('dark', 'dark2')):
    g1, g2 = seg(a, b_, w, d, n)
    self.det(j, g1, mats[0]); self.det(j, g2, mats[1])

  def piston(self, j, a, b_, r=0.05):
    a, b_ = V(a), V(b_)
    mid = a.lerp(b_, 0.55)
    self.det(j, rod(a, mid, r * 1.35, 10), 'dark2')
    self.det(j, rod(mid, b_, r * 0.75, 8), 'metal')
    self.det(j, rod(a.lerp(b_, 0.5), a.lerp(b_, 0.58), r * 1.6, 10), 'copper')

  def hose(self, j, pts, r=0.035, mat='copper'):
    self.det(j, tube(pts, r, 8), mat)

  def vent(self, j, M, ch, u, v, w, h, n=4, lift=0.0):
    """A recessed grille: dark frame block with slats across it, sitting on a plate face."""
    base = M @ xf((u, v, ch + lift))
    self.det(j, box(w, h, 0.05).xf(base @ xf((0, 0, 0.0))), 'black')
    for k in range(n):
      y = -h / 2 + h * (k + 0.5) / n
      self.det(j, box(w * 0.9, h / n * 0.45, 0.03).xf(base @ xf((0, y, 0.025), (0.5, 0, 0))), 'dark2')


# ---------------------------------------------------------------------------
# Legs
# ---------------------------------------------------------------------------

def build_leg(k, s, K):
  """
  Legs in the blocky style of the Bellerophon / BattleTech references (the user's leg sheets), in
  the Amethyst's colors: a deep chamfered white thigh block with slotted panels and a round side
  hub; a big squared purple knee block jutting forward with a Λ vent; a thick purple shin that
  flares toward the ankle, slats and a stenciled number up front, a white side panel with a hub;
  a heavy ankle collar; broad gray feet of two toe blocks and a heel block.
  """
  hipJ, kneeJ, ankJ = 'hip_' + k, 'knee_' + k, 'ankle_' + k
  mx = lambda pts: [(x * s, y) + tuple(r) for x, y, *r in pts]
  TH, SH, F = LEG['thigh'], LEG['shin'], LEG['foot']
  o = s * 0.04  # the leg's armor sits a touch outboard of the joint line

  def hub(j, at, n, r):
    """The references' round side hub: a white rim round a dark recess with a C-ring and a centre stud."""
    M = frame(at, n)
    K.det(j, cyl(r, 0.08, 24, axis='z', ch=0.015).xf(M), 'white')
    K.det(j, cyl(r * 0.78, 0.06, 24, axis='z').xf(M @ xf((0, 0, 0.02))), 'black')
    c = ring(r * 0.62, r * 0.48, 0.05, 20, axis='z')
    K.det(j, c.xf(M @ xf((0, 0, 0.045))), 'copper')
    K.det(j, box(r * 0.3, r * 0.2, 0.06).xf(M @ xf((r * 0.55, 0, 0.05))), 'black')  # the C's gap
    K.det(j, cyl(r * 0.2, 0.08, 12, axis='z').xf(M @ xf((0, 0, 0.06))), 'dark2')

  # ---- thigh ----
  K.mesh(hipJ, sphere(0.42, 16, 10), 'dark', 'hipball')
  K.det(hipJ, ring(0.44, 0.36, 0.12, 24, axis='x').xf(xf((s * 0.12, 0, 0))), 'copper')
  K.mesh(hipJ, loft([dict(y=0.0, w=0.72, d=0.8, c=0.16), dict(y=-TH + 0.2, w=0.62, d=0.72, c=0.14)]), 'dark', 'thighcore')
  K.mesh(hipJ, loft([dict(y=0.16, w=0.9, d=0.84, c=0.2, x=o, z=-0.08), dict(y=-0.25, w=1.04, d=1.14, c=0.25, x=o, z=0.0),
                     dict(y=-1.42, w=1.02, d=1.12, c=0.25, x=o, z=0.02), dict(y=-1.9, w=0.86, d=0.94, c=0.21, x=o, z=0.0)]), 'white', 'thighblock')
  # top front: a slanted panel with two dark slots, over a seam band
  Mtt, chtt = K.plate(hipJ, mx([(-0.38, -0.02), (0.42, -0.02), (0.44, -0.46), (-0.4, -0.46)]), (o, 0, 0.6), n=(0, 0.42, 1), t=0.12, ch=0.04, mat='white')
  for u in (-0.17, 0.17):
    K.det(hipJ, box(0.26, 0.09, 0.05, 0.015).xf(Mtt @ xf((o + u, -0.2, chtt))), 'black')
  K.det(hipJ, box(0.94, 0.06, 0.06, 0.015).xf(xf((o, -0.55, 0.6))), 'dark2')
  # front: a long white panel with a raised centre plate, the purple label and bolts
  Mtf, chtf = K.plate(hipJ, mx([(-0.42, -0.62), (0.44, -0.6), (0.44, -1.42), (0.26, -1.74), (-0.24, -1.74), (-0.42, -1.42)]), (o, 0, 0.6), t=0.14, ch=0.045,
                      mat='white', groove=(0.05, 0.016, 0.016))
  Mt2, cht2 = K.plate(hipJ, mx([(-0.22, -0.9), (0.24, -0.9), (0.26, -1.36), (0.12, -1.52), (-0.12, -1.52), (-0.24, -1.36)]), (o, 0, 0.6 + chtf), t=0.06,
                      ch=0.03, mat='white')
  K.decal(hipJ, Mtf, chtf, o + s * 0.16, -0.75, 0.11, 'label')
  K.decal(hipJ, Mt2, cht2, o, -1.15, 0.09, 'triBar')
  K.bolts(hipJ, Mtf, chtf, [(o + 0.34, -0.7), (o - 0.34, -0.7), (o + 0.34, -1.38), (o - 0.34, -1.38)])
  # outer face: white panel, the round hub low and back
  Mso, chso = K.side(hipJ, s, 0.56, [(0.5, -0.1), (-0.5, -0.1), (-0.54, -1.45), (-0.32, -1.78), (0.34, -1.78), (0.54, -1.45)], t=0.12, ch=0.04,
                     mat='white', groove=(0.05, 0.016, 0.016))
  hub(hipJ, (s * (0.56 + chso), -1.28, -0.18), (s, 0, 0), 0.22)
  K.det(hipJ, box(0.06, 0.6, 0.1, 0.015).xf(xf((s * (0.56 + chso + 0.02), -0.6, 0.25))), 'black')
  # inner face: dark2 guard, segmented bundles and cables
  K.side(hipJ, -s, 0.46, [(0.42, -0.15), (-0.42, -0.15), (-0.44, -1.6), (0.4, -1.7)], t=0.1, ch=0.03, mat='dark2')
  K.segs(hipJ, (-s * 0.36, -0.25, 0.3), (-s * 0.32, -1.85, 0.26), 0.2, 0.22, 6)
  K.hose(hipJ, [(-s * 0.42, 0.0, 0.05), (-s * 0.52, -0.8, -0.04), (-s * 0.46, -1.8, 0.06)], 0.035)
  # back: two white plates round a dark strut column with copper collars
  for sd in (-1, 1):
    K.plate(hipJ, [(sd * 0.08, -0.2), (sd * 0.48, -0.26), (sd * 0.5, -1.3), (sd * 0.36, -1.72), (sd * 0.08, -1.76)], (o, 0, -0.58), n=(0, 0, -1),
            t=0.14, ch=0.045, mat='white', groove=(0.05, 0.016, 0.016))
  K.segs(hipJ, (0, -0.15, -0.66), (0, -1.9, -0.62), 0.18, 0.18, 6)
  for y in (-1.66, -1.84):
    for sd in (-1, 1): K.det(hipJ, box(0.14, 0.12, 0.14, 0.02).xf(xf((sd * 0.22, y, -0.66))), 'copper')
  K.piston(hipJ, (s * 0.3, -0.7, -0.68), (s * 0.3, -2.0, -0.7))
  K.det(hipJ, loft([dict(y=-1.92, w=0.8, d=0.86, c=0.18), dict(y=-2.12, w=0.7, d=0.76, c=0.16)]), 'dark2')

  # ---- knee: a broad axle with copper wheels, a big squared purple block in front ----
  K.mesh(kneeJ, cyl(0.36, 0.9, 20, axis='x', ch=0.04), 'dark', 'kneeaxle')
  for sd in (-1, 1): K.gear(kneeJ, (sd * 0.5, 0.0, -0.06), 0.31, 'x')
  K.gear(kneeJ, (0, -0.3, -0.6), 0.28, 'z')
  kb = prism([(0.22, 0.46), (0.6, 0.64), (0.9, 0.4), (0.94, -0.46), (0.74, -0.8), (0.22, -0.74)], 1.04, 0.06).xf(xf((o, 0, 0)))
  K.mesh(kneeJ, kb, 'purple', 'kneeblock')
  Mkf = frame((o, -0.03, 0.94), (0, 0, 1))
  # the references' knee mark: two angled vents either side of a downward wedge
  for sd in (-1, 1):
    K.det(kneeJ, fprism([(sd * 0.1, 0.22), (sd * 0.32, 0.18), (sd * 0.3, -0.2), (sd * 0.2, -0.2)], 0.05, 0.01).xf(Mkf @ xf((0, 0.04, 0.005))), 'black')
  K.det(kneeJ, fprism([(-0.07, 0.2), (0.07, 0.2), (0.0, 0.0)], 0.05, 0.01).xf(Mkf @ xf((0, 0.04, 0.005))), 'black')
  K.det(kneeJ, box(0.5, 0.03, 0.04).xf(Mkf @ xf((0, 0.33, 0.005))), 'black')
  K.det(kneeJ, box(0.5, 0.05, 0.03).xf(Mkf @ xf((0, -0.28, 0.005))), 'dark2')
  K.decal(kneeJ, Mkf, 0, 0, -0.38, 0.05, 'code')
  for u in (-0.38, 0.38):
    for v in (0.3, -0.38): K.det(kneeJ, bolt(0.024, 0.03).xf(Mkf @ xf((u, v, 0))), 'dark2')
  # slots on the slanted top, a dark inset on each side face
  Mkt = frame((o, 0.53, 0.75), (0, 0.66, 0.46))
  for u in (-0.2, 0.2): K.det(kneeJ, box(0.22, 0.06, 0.04, 0.01).xf(Mkt @ xf((u, 0, 0.0))), 'black')
  for sd in (-1, 1):
    K.det(kneeJ, box(0.04, 0.5, 0.36, 0.01).xf(xf((o + sd * 0.52, -0.08, 0.6))), 'dark2')
    K.decal(kneeJ, frame((o + sd * 0.545, -0.1, 0.6), (sd, 0, 0)), 0, 0, 0, 0.14, 'triBar')

  # ---- shin: a thick purple block flaring toward the ankle ----
  K.mesh(kneeJ, loft([dict(y=-0.5, w=0.84, d=0.94, c=0.2, x=o, z=-0.04), dict(y=-1.6, w=0.9, d=1.0, c=0.22, x=o, z=-0.02),
                      dict(y=-2.9, w=1.04, d=1.1, c=0.24, x=o), dict(y=-SH + 0.22, w=0.96, d=1.02, c=0.22, x=o)]), 'purple', 'shinblock')
  Msf, chsf = K.plate(kneeJ, mx([(-0.36, -0.86), (0.38, -0.86), (0.46, -2.86), (0.36, -3.1), (-0.36, -3.1), (-0.44, -2.86)]), (o, 0, 0.53), n=(0, 0.05, 1),
                      t=0.14, ch=0.045, mat='purple', groove=(0.05, 0.016, 0.016))
  for i in range(3): K.det(kneeJ, box(0.5, 0.045, 0.04, 0.01).xf(Msf @ xf((o, -1.02 - 0.1 * i, chsf))), 'dark2')
  K.decal(kneeJ, Msf, chsf, o, -2.3, 0.3, 'n05')
  K.decal(kneeJ, Msf, chsf, o, -1.6, 0.14, 'triDown')
  K.bolts(kneeJ, Msf, chsf, [(o + 0.3, -0.95), (o - 0.3, -0.95), (o + 0.34, -2.95), (o - 0.34, -2.95)])
  # outer face: the sheet's white panel, carrying a round hub
  Mss, chss = K.side(kneeJ, s, 0.5, [(0.44, -0.78), (-0.44, -0.78), (-0.5, -2.85), (-0.3, -3.08), (0.3, -3.08), (0.5, -2.85)], t=0.12, ch=0.04,
                     mat='white', groove=(0.05, 0.016, 0.016))
  hub(kneeJ, (s * (0.5 + chss + 0.02), -2.0, 0.02), (s, 0, 0), 0.2)
  K.decal(kneeJ, Mss, chss, 0.0, -1.2, 0.05, 'service', aspect=4)
  K.det(kneeJ, box(0.06, 0.16, 0.03).xf(Mss @ xf((0.3, -2.7, chss))), 'copper')
  K.side(kneeJ, -s, 0.46, [(0.4, -0.8), (-0.4, -0.8), (-0.44, -3.0), (0.4, -3.0)], t=0.08, ch=0.03, mat='dark2')
  # calf: purple plate over a deep back, a white panel, the jet bay
  K.mesh(kneeJ, loft([dict(y=-0.4, w=0.6, d=0.3, c=0.1, x=o, z=-0.5), dict(y=-1.3, w=0.76, d=0.5, c=0.14, x=o, z=-0.62), dict(y=-2.6, w=0.66, d=0.4, c=0.12, x=o, z=-0.56)]),
         'dark2', 'calf')
  Mcb, chcb = K.plate(kneeJ, [(-0.4, -0.5), (0.4, -0.5), (0.44, -1.6), (0.3, -2.1), (-0.3, -2.1), (-0.44, -1.6)], (o, 0, -0.8), n=(0, 0, -1), t=0.16, ch=0.045,
                      mat='purple', groove=(0.05, 0.016, 0.016))
  Mcw, chcw = K.plate(kneeJ, [(-0.14, -0.7), (0.14, -0.7), (0.15, -1.6), (0.0, -1.72), (-0.15, -1.6)], (o, 0, -0.8 - chcb), n=(0, 0, -1), t=0.05, ch=0.025,
                      mat='white')
  K.decal(kneeJ, Mcw, chcw, 0, -1.0, 0.12, 'triBar')
  K.det(kneeJ, box(0.42, 0.4, 0.14, 0.03).xf(xf((o, -2.45, -0.62))), 'black')
  for x in (-0.1, 0.1): K.det(kneeJ, cyl(0.08, 0.12, 12, axis='z').xf(xf((o + x, -2.47, -0.68))), 'dark2')
  K.hose(kneeJ, [(s * 0.36, -0.4, -0.5), (s * 0.5, -1.4, -0.56), (s * 0.4, -2.6, -0.5)], 0.034)
  # ankle collar
  K.mesh(kneeJ, loft([dict(y=-SH + 0.3, w=0.9, d=0.96, c=0.2, x=o), dict(y=-SH + 0.02, w=0.82, d=0.88, c=0.18, x=o)]), 'dark2', 'anklecollar')
  K.det(kneeJ, ring(0.47, 0.4, 0.06, 24).xf(xf((o, -SH + 0.18, 0))), 'copper')

  # ---- foot: broad and gray, two toe blocks, a heel block, armored ankle flaps ----
  K.mesh(ankJ, sphere(0.3, 14, 10), 'dark2', 'ankleball')
  for sd in (-1, 1): K.gear(ankJ, (sd * 0.44, 0.0, 0.0), 0.24, 'x', depth=0.12)
  K.mesh(ankJ, loft([dict(y=0.1, w=0.7, d=0.8, c=0.16), dict(y=-0.62, w=1.0, d=1.3, c=0.22, z=0.12)]), 'gray', 'footblock')
  for sd in (-1, 1):
    toe = prism([(0.18, -0.5), (0.9, -0.6), (1.44, -0.9), (1.48, -F + 0.06), (1.42, -F), (0.18, -F)], 0.46, 0.05).xf(xf((sd * 0.25, 0, 0), (0, sd * 0.06, 0)))
    K.mesh(ankJ, toe, 'gray', 'toe')
    K.det(ankJ, box(0.36, 0.04, 0.05).xf(xf((sd * 0.26, -0.82, 1.12), (0.5, sd * 0.06, 0))), 'black')
    K.det(ankJ, box(0.36, 0.04, 0.05).xf(xf((sd * 0.26, -0.72, 0.92), (0.5, sd * 0.06, 0))), 'black')
    Mfl, chfl = K.side(ankJ, sd, 0.5, [(0.55, -0.32), (-0.45, -0.32), (-0.6, -0.95), (0.62, -0.95)], t=0.1, ch=0.035, mat='gray', groove=(0.04, 0.012, 0.012))
    K.det(ankJ, box(0.05, 0.08, 0.6).xf(xf((sd * (0.5 + chfl + 0.01), -0.82, 0.05))), 'purple')
  heel = prism([(-0.05, -0.42), (-0.68, -0.6), (-0.94, -0.92), (-0.96, -F), (-0.05, -F)], 0.9, 0.05)
  K.mesh(ankJ, heel, 'gray', 'heel')
  Mh = frame((0, -0.88, -0.955), (0, 0, -1))
  K.decal(ankJ, Mh, 0, 0, 0, 0.18, 'triDown')
  Mfa, chfa = K.plate(ankJ, [(-0.3, 0.05), (0.3, 0.05), (0.34, -0.5), (0.0, -0.62), (-0.34, -0.5)], (0, -0.12, 0.5), n=(0, 0.35, 1), t=0.1, ch=0.035, mat='gray')
  K.decal(ankJ, Mfa, chfa, 0, -0.22, 0.12, 'triDown')
  K.det(ankJ, box(1.12, 0.08, 2.5).xf(xf((0, -F + 0.04, 0.26))), 'dark')
  K.det(ankJ, ring(0.15, 0.1, 0.06, 18).xf(xf((0, -F + 0.12, -0.4))), 'copper')
  K.hose(ankJ, [(0.26, 0.28, -0.3), (0.34, -0.1, -0.44), (0.26, -0.42, -0.4)], 0.032)
  K.hose(ankJ, [(-0.26, 0.28, -0.3), (-0.34, -0.1, -0.44), (-0.26, -0.42, -0.4)], 0.032)


def build_pelvis(b, K):
  J = 'pelvis'
  # Core block on a hip axle, with ribbed black drums at the hip sides
  K.mesh(J, loft([dict(y=0.5, w=1.0, d=0.8, c=0.2), dict(y=0.0, w=1.2, d=0.86, c=0.22), dict(y=-0.62, w=0.66, d=0.62, c=0.14)]), 'dark', 'pelviscore')
  K.mesh(J, cyl(0.24, 1.3, 16, axis='x', ch=0.03).xf(xf((0, -0.45, 0))), 'dark2', 'hipaxle')
  for s in (-1, 1):
    for i in range(4):
      K.det(J, cyl(0.36 - 0.02 * (i % 2), 0.07, 20, axis='x', ch=0.012).xf(xf((s * (0.42 + 0.08 * i), -0.3, -0.02))), 'black')
    K.hose(J, [(s * 0.2, 0.4, 0.3), (s * 0.45, 0.0, 0.36), (s * 0.55, -0.45, 0.3)], 0.035)
    K.hose(J, [(s * 0.28, 0.4, -0.3), (s * 0.5, -0.05, -0.36), (s * 0.58, -0.5, -0.28)], 0.03)
  # Belt: a broad purple band across the front, its wings dropping toward the skirts
  Mb, chb = K.plate(J, [(-1.42, 0.12, -0.46), (-0.72, 0.3, -0.12), (-0.3, 0.42), (0.3, 0.42), (0.72, 0.3, -0.12), (1.42, 0.12, -0.46), (1.46, -0.12, -0.48),
                        (0.68, 0.0, -0.12), (0.26, 0.1), (-0.26, 0.1), (-0.68, 0.0, -0.12), (-1.46, -0.12, -0.48)],
                    (0, 0.14, 0.46), t=0.2, ch=0.05, mat='purple', groove=(0.05, 0.016, 0.016))
  for s in (-1, 1):
    K.decal(J, frame((s * 0.96, 0.31, 0.4), (s * 0.35, 0.1, 1)), 0.01, 0, 0, 0.13, 'triBar')
    K.bolts(J, Mb, chb, [(s * 0.45, 0.32), (s * 1.22, 0.04)])
  K.mesh(J, box(0.5, 0.2, 0.16, 0.04).xf(xf((0, 0.49, 0.52))), 'dark2', 'buckle')
  K.det(J, box(0.3, 0.06, 0.04).xf(xf((0, 0.49, 0.61))), 'copper')

  # Codpiece: a long purple shield on its own pivot, with a raised keel and a crest mark at the foot
  b.joint('codpiece', 'pelvis', (0, 0.22, 0.65))
  C = 'codpiece'
  Mc, chc = K.plate(C, [(-0.3, 0.12), (0.3, 0.12), (0.28, -0.45, -0.04), (0.2, -1.12), (0.0, -1.3), (-0.2, -1.12), (-0.28, -0.45, -0.04)],
                    (0, 0, 0.0), t=0.22, ch=0.06, mat='purple', groove=(0.05, 0.016, 0.016))
  Mk, chk = K.plate(C, [(-0.11, 0.0), (0.11, 0.0), (0.12, -0.78), (0.0, -0.98), (-0.12, -0.78)], (0, 0, chc + 0.01), t=0.04, ch=0.03, mat='purple')
  K.det(C, fprism([(-0.12, 0), (0.12, 0), (0.0, -0.1)], 0.06, 0.01).xf(xf((0, -0.08, chc + 0.05))), 'dark2')
  K.decal(C, Mc, chc, 0, -1.02, 0.1, 'chevrons')
  K.bolts(C, Mc, chc, [(0.24, -0.05), (-0.24, -0.05), (0.2, -0.75), (-0.2, -0.75)])
  for s in (-1, 1): K.det(C, box(0.08, 0.3, 0.04, 0.01).xf(Mc @ xf((s * 0.22, -0.38, chc))), 'dark2')

  # Side skirts on pivots at the hips: tall purple plates flaring out, a dark inset on each
  for s, k in ((1, 'L'), (-1, 'R')):
    b.joint('skirt_' + k, 'pelvis', (s * 1.4, 0.26, 0.02))
    S = 'skirt_' + k
    Ms, chs = K.side(S, s, 0.0, [(0.42, 0.1), (-0.42, 0.16), (-0.56, -0.5), (-0.44, -1.55), (0.28, -1.65), (0.5, -0.7)], turn=0.12, t=0.16, ch=0.05,
                     mat='purple', groove=(0.06, 0.018, 0.018))
    Mi, chi = K.side(S, s, chs + 0.004, [(0.2, -0.3), (-0.26, -0.28), (-0.3, -1.05), (0.16, -1.1)], turn=0.12, t=0.04, ch=0.02, mat='dark2')
    K.decal(S, Mi, chi, 0.0, -0.95, 0.07, 'barcode')
    K.decal(S, Ms, chs, (0.0), -1.35, 0.14, 'triDown')
    K.bolts(S, Ms, chs, [(0.3, -0.05), (-0.3, -0.05), (0.0, -1.5)])
    K.side(S, -s, 0.16, [(0.36, 0.05), (-0.36, 0.1), (-0.4, -1.3), (0.24, -1.4)], turn=0.12, t=0.06, ch=0.02, mat='dark')
    K.det(S, cyl(0.12, 0.2, 14, axis='x').xf(xf((-s * 0.12, 0.0, 0))), 'copper')

  # Rear skirt: a broad purple apron round a gray recess holding a round copper-rimmed nozzle
  b.joint('rearPlate', 'pelvis', (0, 0.3, -0.57))
  R = 'rearPlate'
  K.mesh(R, box(0.5, 0.82, 0.24, 0.05).xf(xf((0, -0.28, -0.06))), 'gray', 'nozzlebox')
  K.det(R, ring(0.2, 0.14, 0.08, 24, axis='z').xf(xf((0, -0.36, -0.2))), 'copper')
  K.det(R, cyl(0.15, 0.1, 20, axis='z').xf(xf((0, -0.36, -0.16))), 'black')
  K.det(R, cyl(0.07, 0.12, 12, axis='z').xf(xf((0, -0.36, -0.2))), 'dark2')
  for sd in (-1, 1):
    Mr, chr_ = K.plate(R, [(sd * 0.24, 0.12), (sd * 0.82, 0.08), (sd * 0.9, -0.34), (sd * 0.6, -1.2), (sd * 0.26, -1.02)], (0, 0, -0.08), n=(-sd * 0.12, 0, -1),
                       t=0.2, ch=0.05, mat='purple', groove=(0.05, 0.016, 0.016))
    K.decal(R, Mr, chr_, sd * 0.56, -0.12, 0.13, 'triDown')
    K.decal(R, Mr, chr_, sd * 0.42, -0.75, 0.12, 'triBar')
    K.bolts(R, Mr, chr_, [(sd * 0.3, 0.0), (sd * 0.75, -0.2)])
  K.plate(R, [(-0.26, 0.24), (0.26, 0.24), (0.3, 0.06), (-0.3, 0.06)], (0, 0.0, -0.2), n=(0, 0, -1), t=0.1, ch=0.035, mat='purple')


def build_torso(b, K):
  W, C, BP = 'waist', 'chest', 'backpack'
  # ---- waist: a dark spine, a white column of stacked plates down the front, a vertebral column behind ----
  K.mesh(W, cyl(0.4, 0.95, 16, r2=0.46, ch=0.04).xf(xf((0, 0.3, -0.04))), 'dark', 'waistcore')
  for i in range(4):
    w = 0.34 - 0.03 * i
    K.mesh(W, box(w, 0.15, 0.18, 0.04).xf(xf((0, 0.6 - 0.17 * i, 0.38))), 'white', 'abs')
    for s in (-1, 1): K.det(W, box(0.2, 0.13, 0.16, 0.03).xf(xf((s * 0.28, 0.6 - 0.17 * i, 0.32), (0, s * 0.25, 0))), 'dark2')
  for s in (-1, 1):
    K.segs(W, (s * 0.42, -0.1, 0.12), (s * 0.5, 0.75, 0.16), 0.18, 0.24, 5)
    K.hose(W, [(s * 0.3, 0.8, 0.3), (s * 0.44, 0.35, 0.38), (s * 0.3, -0.05, 0.36)], 0.032)
    K.hose(W, [(s * 0.36, 0.8, -0.2), (s * 0.5, 0.35, -0.3), (s * 0.38, 0.0, -0.3)], 0.03)
  for i in range(5):
    y = 0.8 - 0.18 * i
    K.mesh(W, box(0.3 - 0.015 * i, 0.12, 0.2, 0.035).xf(xf((0, y, -0.44))), 'white' if i % 2 == 0 else 'gray', 'vert')
    K.det(W, box(0.48 - 0.02 * i, 0.06, 0.14, 0.02).xf(xf((0, y - 0.08, -0.4))), 'dark2')

  # ---- chest core ----
  K.mesh(C, loft([dict(y=-0.05, w=1.0, d=0.82, c=0.2, z=-0.04), dict(y=0.55, w=1.86, d=1.18, c=0.3, z=-0.06),
                  dict(y=1.05, w=2.06, d=1.24, c=0.32, z=-0.1), dict(y=1.38, w=1.36, d=0.96, c=0.26, z=-0.12)]), 'dark', 'chestcore')
  # upper chest: purple collar plate with a copper triangle
  Mu, chu = K.plate(C, [(-0.42, 1.38), (0.42, 1.38), (0.5, 1.18), (0.18, 0.98), (-0.18, 0.98), (-0.5, 1.18)], (0, 0, 0.5), n=(0, 0.45, 1), t=0.2, ch=0.05,
                    mat='purple', groove=(0.045, 0.014, 0.014))
  K.det(C, fprism([(-0.08, 0.04), (0.08, 0.04), (0.0, -0.08)], 0.04, 0.008).xf(Mu @ xf((0, 1.12, chu + 0.01))), 'copper')
  # sternum: a white V plate down the middle with a dark triangle port
  Ms, chs = K.plate(C, [(-0.3, 1.0), (0.3, 1.0), (0.24, 0.5), (0.13, 0.04), (-0.13, 0.04), (-0.24, 0.5)], (0, 0, 0.66), t=0.28, ch=0.06, mat='white',
                    groove=(0.05, 0.016, 0.016))
  K.mesh(C, shell([V((0, 0.98, 0.73)), V((0.2, 0.92, 0.72)), V((0, 0.36, 0.84)), V((-0.2, 0.92, 0.72))], (0, 0, -0.06)), 'white', 'keel')
  K.det(C, fprism([(-0.11, 0.06), (0.11, 0.06), (0.0, -0.12)], 0.05, 0.01).xf(Ms @ xf((0, 0.72, chs + 0.01))), 'black')
  K.det(C, fprism([(-0.06, 0.03), (0.06, 0.03), (0.0, -0.06)], 0.05, 0.008).xf(Ms @ xf((0, 0.7, chs + 0.03))), 'copper')
  for s in (-1, 1):
    mx = lambda pts: [(x * s, y) + tuple(r) for x, y, *r in pts]
    # pecs: broad white plates sweeping out to the shoulders, with red-brown service marks
    Mp, chp = K.plate(C, mx([(0.24, 1.02), (0.98, 0.98), (1.1, 0.74), (0.86, 0.6), (0.28, 0.66)]), (0, 0, 0.7), n=(s * 0.38, 0.1, 1), t=0.32, ch=0.055,
                      mat='white', groove=(0.05, 0.016, 0.016))
    K.decal(C, Mp, chp, s * 0.7, 0.87, 0.06, 'slashes')
    K.bolts(C, Mp, chp, [(s * 0.35, 0.92), (s * 0.95, 0.88)])
    # lamp blocks: purple, each with a round lens set in a dark recess
    Ml, chl = K.plate(C, mx([(0.26, 0.6), (0.92, 0.6), (1.0, 0.38), (0.78, 0.12), (0.3, 0.16)]), (0, 0, 0.6), n=(s * 0.4, -0.12, 1), t=0.22, ch=0.05,
                      mat='purple', groove=(0.045, 0.014, 0.014))
    K.det(C, fprism(mx([(0.4, 0.5), (0.86, 0.5), (0.78, 0.3), (0.44, 0.28)]), 0.06, 0.012).xf(Ml @ xf((0, 0, chl + 0.005))), 'black')
    K.det(C, cyl(0.1, 0.06, 18, axis='z').xf(Ml @ xf((s * 0.58, 0.39, chl + 0.03))), 'dark2')
    K.det(C, ring(0.1, 0.075, 0.04, 18, axis='z').xf(Ml @ xf((s * 0.58, 0.39, chl + 0.06))), 'copper')
    K.det(C, cyl(0.06, 0.03, 14, axis='z').xf(Ml @ xf((s * 0.58, 0.39, chl + 0.07))), 'lens')
    K.det(C, box(0.18, 0.04, 0.03).xf(Ml @ xf((s * 0.76, 0.36, chl + 0.04), (0, 0, s * 0.5))), 'copper')
    # abdomen blocks below
    Ma, cha = K.plate(C, mx([(0.16, 0.14), (0.5, 0.12), (0.52, -0.1), (0.36, -0.28), (0.16, -0.2)]), (0, 0, 0.44), n=(s * 0.25, -0.2, 1), t=0.18, ch=0.045,
                      mat='purple')
    K.decal(C, Ma, cha, s * 0.34, -0.08, 0.07, 'triBar')
    # flank: ribs and a purple side panel under the arm
    for i in range(4): K.det(C, box(0.12, 0.42, 0.2, 0.03).xf(xf((s * (0.92 + 0.02 * i), 0.38, 0.32 - 0.16 * i), (0, 0, s * 0.18))), 'dark2' if i % 2 else 'dark')
    K.side(C, s, 0.98, [(0.3, 0.86), (-0.36, 0.9), (-0.42, 0.3), (-0.2, 0.0), (0.26, 0.1)], fz=-0.08, t=0.14, ch=0.04, mat='purple')
    K.segs(C, (s * 0.5, 0.0, 0.36), (s * 0.84, 0.86, 0.44), 0.16, 0.18, 4)
    # collar blocks either side of the neck: white boxes with a red service mark, front and back faces
    K.mesh(C, box(0.4, 0.38, 0.56, 0.06).xf(xf((s * 0.66, 1.42, -0.08), (0, 0, -s * 0.08))), 'white', 'collar')
    K.det(C, box(0.3, 0.1, 0.5, 0.02).xf(xf((s * 0.66, 1.2, -0.08))), 'dark2')
    K.decal(C, frame((s * 0.66, 1.42, 0.2), (0, 0, 1)), 0.0, 0.0, 0.08, 0.1, 'slashes')
    K.decal(C, frame((s * 0.66, 1.42, -0.36), (0, 0, -1)), 0.0, 0.0, 0.08, 0.1, 'slashes')
    # neck hoses
    K.hose(C, [(s * 0.18, 1.3, 0.28), (s * 0.24, 1.6, 0.22), (s * 0.14, 1.85, 0.14)], 0.04)
    K.hose(C, [(s * 0.3, 1.3, -0.1), (s * 0.3, 1.62, -0.12), (s * 0.18, 1.85, -0.1)], 0.035, 'dark2')

    # ---- back: copper-ringed disc ports at the shoulder blades, white V plates under them ----
    K.mesh(C, cyl(0.34, 0.24, 24, axis='z', ch=0.03).xf(xf((s * 0.66, 1.0, -0.66))), 'black', 'backdisc')
    K.det(C, ring(0.3, 0.22, 0.06, 24, axis='z').xf(xf((s * 0.66, 1.0, -0.79))), 'copper')
    K.det(C, cyl(0.22, 0.04, 20, axis='z').xf(xf((s * 0.66, 1.0, -0.76))), 'dark')
    for i in range(6):
      a = 2 * math.pi * i / 6
      K.det(C, box(0.18, 0.035, 0.04, 0.01).xf(xf((s * 0.66 + math.cos(a) * 0.1, 1.0 + math.sin(a) * 0.1, -0.79), (0, 0, a))), 'copper')
    K.det(C, cyl(0.06, 0.06, 12, axis='z').xf(xf((s * 0.66, 1.0, -0.81))), 'dark2')
    Mv, chv = K.plate(C, mx([(0.18, 0.7), (0.78, 0.76), (0.9, 0.44), (0.5, 0.04), (0.24, 0.24)]), (0, 0, -0.62), n=(s * -0.3, 0, -1), t=0.2, ch=0.05,
                      mat='white', groove=(0.05, 0.016, 0.016))
    K.bolts(C, Mv, chv, [(-s * 0.3, 0.6), (-s * 0.72, 0.6)])
    K.decal(C, Mv, chv, -s * 0.55, 0.42, 0.06, 'service', aspect=1.6)
    K.side(C, s, 0.9, [(-0.4, 0.95), (-0.7, 0.9), (-0.72, 0.4), (-0.48, 0.2)], fz=0, turn=-0.5, t=0.12, ch=0.035, mat='purple')
  # chest top between the collar blocks: a gray deck over the core, a purple plate behind the neck
  K.plate(C, [(-0.5, -0.42), (0.5, -0.42), (0.56, 0.3), (-0.56, 0.3)], (0, 1.4, -0.12), n=(0, 1, 0), up=(0, 0, -1), t=0.08, ch=0.03, mat='gray')
  K.plate(C, [(-0.42, 1.2), (0.42, 1.2), (0.36, 1.5), (-0.36, 1.5)], (0, 0, -0.5), n=(0, 0.4, -1), t=0.14, ch=0.04, mat='purple')
  # back centre: the backpack's purple slot plate
  K.mesh(BP, loft([dict(y=0.6, w=0.7, d=0.36, c=0.1, z=-0.08), dict(y=0.0, w=0.8, d=0.44, c=0.12, z=-0.12), dict(y=-0.36, w=0.5, d=0.34, c=0.1, z=-0.08)]), 'dark2', 'pack')
  Mbp, chbp = K.plate(BP, [(-0.32, 0.62), (0.32, 0.62), (0.36, 0.0), (0.2, -0.34), (-0.2, -0.34), (-0.36, 0.0)], (0, 0, -0.3), n=(0, 0, -1), t=0.3, ch=0.06,
                      mat='purple', groove=(0.05, 0.016, 0.016))
  K.det(BP, box(0.16, 0.36, 0.06, 0.02).xf(Mbp @ xf((0, 0.26, chbp + 0.01))), 'copper')
  K.det(BP, box(0.1, 0.28, 0.06, 0.01).xf(Mbp @ xf((0, 0.26, chbp + 0.03))), 'black')
  K.decal(BP, Mbp, chbp, 0, 0.53, 0.05, 'code')
  K.bolts(BP, Mbp, chbp, [(0.24, 0.5), (-0.24, 0.5), (0.24, -0.1), (-0.24, -0.1)])
  K.plate(BP, [(-0.42, -0.3), (0.42, -0.3), (0.3, -0.62), (0, -0.74), (-0.3, -0.62)], (0, 0, 0.02), n=(0, -0.2, -1), t=0.2, ch=0.05, mat='purple')
  # main thruster housings low on the back (the inherited mains are seated in them)
  for s in (-1, 1):
    K.mesh(BP, loft([dict(y=-0.4, w=0.42, d=0.46, c=0.1, x=s * 0.42, z=0.02), dict(y=-0.9, w=0.48, d=0.5, c=0.12, x=s * 0.42, z=-0.06)]), 'gray', 'mainhousing')
    K.det(BP, ring(0.22, 0.16, 0.06, 20).xf(xf((s * 0.42, -0.92, -0.06))), 'copper')


FINGER_LENS = (0.21, 0.18, 0.15)


def build_arm(b, k, s, K):
  shJ, elJ, haJ = 'shoulder_' + k, 'elbow_' + k, 'hand_' + k
  mx = lambda pts: [(x * s, y) + tuple(r) for x, y, *r in pts]
  # a black wheel on the torso flank under the shoulder, as on the sheet
  K.gear('chest', (s * 1.02, 0.58, 0.42), 0.2, 'z', depth=0.14)

  # ---- pauldron: a tall purple box, its outer top corner drawn up into a horn, the emblem on every face ----
  b.joint('pauldron_' + k, 'chest', (s * 1.4, 1.0, -0.05))
  P = 'pauldron_' + k
  b.pre[P] = b.pre.get(P, Matrix.Identity(4)) @ Matrix.Translation(V((s * 0.06, 0.12, 0))) @ Matrix.Diagonal((1.22, 1.22, 1.18, 1))
  K.mesh(P, loft([dict(y=0.5, w=0.9, d=0.86, c=0.18, x=s * 0.22), dict(y=-0.35, w=0.82, d=0.8, c=0.16, x=s * 0.26)]), 'dark', 'pauldroncore')
  face = [(-0.18, 0.5), (0.22, 0.6), (0.46, 0.66), (0.62, 1.02), (0.72, 0.6), (0.78, 0.2), (0.72, -0.42), (0.3, -0.56), (-0.12, -0.36)]
  for zf, nz in ((0.47, 1), (-0.53, -1)):
    pts = [(x * s * nz, y) for x, y in face]  # u runs to -x on the back face
    Mf, chf = K.plate(P, pts, (0, 0, zf), n=(0, 0, nz), t=0.2, ch=0.055, mat='purple', groove=(0.06, 0.018, 0.018))
    K.decal(P, Mf, chf, 0.36 * s * nz, 0.02, 0.36, 'emblem')
    K.decal(P, Mf, chf, 0.3 * s * nz, 0.44, 0.04, 'service', aspect=4)
    K.bolts(P, Mf, chf, [(0.62 * s * nz, -0.3), (0.02 * s * nz, 0.32), (0.66 * s * nz, 0.48)])
  Mo, cho = K.side(P, s, 0.74, [(0.46, 0.55), (-0.5, 0.55), (-0.54, -0.4), (-0.2, -0.56), (0.3, -0.56), (0.5, -0.4)], t=0.16, ch=0.05, mat='purple',
                   groove=(0.06, 0.018, 0.018))
  K.decal(P, Mo, cho, 0.0, 0.0, 0.42, 'emblem')
  K.decal(P, Mo, cho, 0.0, -0.4, 0.05, 'code')
  # top cap rising into the horn
  K.plate(P, [(-0.12, -0.42), (0.6, -0.42), (0.7, 0.4), (-0.1, 0.4)] if s > 0 else [(-0.6, -0.42), (0.12, -0.42), (0.1, 0.4), (-0.7, 0.4)],
          (0, 0.62, -0.02), n=(0, 1, 0), up=(0, 0, -1), t=0.14, ch=0.04, mat='purple')
  horn = fprism([(0.0, 0.0), (0.28, 0.0), (0.12, 0.5)], 0.86, 0.03).xf(xf((s * 0.5, 0.6, -0.03), (0, 0, -s * 0.3)))
  K.mesh(P, horn, 'purple', 'horn')
  K.det(P, fprism([(0.04, 0.05), (0.22, 0.05), (0.12, 0.36)], 0.9, 0.02).xf(xf((s * 0.5, 0.6, -0.03), (0, 0, -s * 0.3))), 'dark2')
  # under-lip: a dark band with copper bolts where the arm comes out
  K.det(P, box(0.86, 0.12, 0.92, 0.03).xf(xf((s * 0.3, -0.5, -0.03))), 'dark2')
  for zz in (-0.3, 0.0, 0.3): K.det(P, cyl(0.04, 0.05, 8, axis='x').xf(xf((s * 0.74, -0.5, zz))), 'copper')

  # ---- upper arm, after the user's arm sheet: a blocky white arm with a hex side plate, a dark
  # mechanism block inside, a small angled box up front, banded where it meets the elbow ----
  K.mesh(shJ, sphere(0.34, 14, 10), 'dark', 'shoulderball')
  K.mesh(shJ, loft([dict(y=-0.16, w=0.62, d=0.66, c=0.16), dict(y=-0.6, w=0.66, d=0.7, c=0.17), dict(y=-0.98, w=0.58, d=0.62, c=0.15)]), 'white', 'upperblock')
  hexo = [(0.3, -0.2), (-0.3, -0.2), (-0.4, -0.55), (-0.3, -0.92), (0.3, -0.92), (0.4, -0.55)]
  Muo, chuo = K.side(shJ, s, 0.33, hexo, t=0.1, ch=0.04, mat='white', groove=(0.045, 0.014, 0.014))
  Mui, chui = K.side(shJ, s, 0.33 + chuo, [(0.16, -0.36), (-0.16, -0.36), (-0.22, -0.56), (-0.16, -0.76), (0.16, -0.76), (0.22, -0.56)], t=0.04,
                     ch=0.02, mat='purple')
  K.decal(shJ, Mui, chui, 0, -0.56, 0.12, 'target')
  K.mesh(shJ, box(0.36, 0.3, 0.22, 0.05).xf(xf((0, -0.34, 0.36), (-0.35, 0, 0))), 'dark2', 'frontbox')
  K.det(shJ, box(0.24, 0.05, 0.04).xf(xf((0, -0.3, 0.48), (-0.35, 0, 0))), 'copper')
  K.det(shJ, box(0.12, 0.62, 0.44, 0.03).xf(xf((-s * 0.32, -0.58, 0))), 'dark2')
  for i in range(4): K.det(shJ, box(0.04, 0.04, 0.32).xf(xf((-s * 0.39, -0.38 - 0.13 * i, 0))), 'black')
  Mub, chub = K.plate(shJ, [(-0.27, -0.2), (0.27, -0.2), (0.3, -0.92), (-0.3, -0.92)], (0, 0, -0.33), n=(0, 0, -1), t=0.1, ch=0.035, mat='white')
  K.det(shJ, box(0.06, 0.14, 0.02).xf(Mub @ xf((0.12, -0.36, chub))), 'copper')
  for i in range(3):
    K.det(shJ, box(0.58 - 0.04 * i, 0.055, 0.6 - 0.04 * i, 0.015).xf(xf((0, -1.0 - 0.06 * i, 0))), 'copper' if i == 1 else 'black')
  K.piston(shJ, (s * 0.1, -0.5, 0.36), (s * 0.1, -1.06, 0.38), 0.035)

  # ---- elbow: a broad axle, the square cross hub outside, a round one inside ----
  K.mesh(elJ, cyl(0.25, 0.64, 18, axis='x', ch=0.03), 'black', 'elbowaxle')
  He = frame((s * 0.35, 0, 0), (s, 0, 0))
  K.det(elJ, box(0.4, 0.4, 0.07, 0.04).xf(He), 'dark2')
  K.det(elJ, box(0.3, 0.07, 0.05, 0.01).xf(He @ xf((0, 0, 0.04))), 'copper')
  K.det(elJ, box(0.07, 0.3, 0.05, 0.01).xf(He @ xf((0, 0, 0.04))), 'copper')
  for u, v in ((0.15, 0.15), (-0.15, 0.15), (0.15, -0.15), (-0.15, -0.15)): K.det(elJ, bolt(0.022, 0.05).xf(He @ xf((u, v, 0.04))), 'black')
  K.det(elJ, cyl(0.06, 0.08, 10, axis='z').xf(He @ xf((0, 0, 0.06))), 'dark')
  K.det(elJ, ring(0.2, 0.12, 0.06, 18, axis='x').xf(xf((-s * 0.33, 0, 0))), 'copper')

  # ---- forearm: long and layered, a big armored slab outside with a dark vent block, a wrist ring ----
  K.mesh(elJ, loft([dict(y=0.0, w=0.48, d=0.54, c=0.12), dict(y=-1.3, w=0.42, d=0.48, c=0.1)]), 'dark', 'forecore')
  K.mesh(elJ, loft([dict(y=-0.14, w=0.62, d=0.7, c=0.16), dict(y=-0.75, w=0.66, d=0.74, c=0.17), dict(y=-1.18, w=0.56, d=0.62, c=0.14)]), 'purple', 'foreblock')
  Mfo, chfo = K.side(elJ, s, 0.33, [(0.42, -0.08), (-0.32, -0.12), (-0.44, -0.32), (-0.44, -1.06), (-0.28, -1.24), (0.3, -1.24), (0.46, -1.0), (0.46, -0.3)],
                     t=0.16, ch=0.05, mat='purple', groove=(0.05, 0.016, 0.016))
  Mf2, chf2 = K.side(elJ, s, 0.33 + chfo, [(0.32, -0.24), (-0.2, -0.26), (-0.28, -0.42), (-0.28, -0.82), (0.32, -0.82)], t=0.06, ch=0.03,
                     mat='purple', groove=(0.035, 0.012, 0.012))
  K.decal(elJ, Mf2, chf2, -s * 0.03, -0.54, 0.12, 'triBar')
  K.bolts(elJ, Mfo, chfo, [(0.36 * -s, -0.2), (-0.36 * -s, -0.2), (0.38 * -s, -1.12), (-0.24 * -s, -1.14)])
  # dark vent block low on the outer back of the forearm
  K.det(elJ, box(0.16, 0.36, 0.3, 0.03).xf(xf((s * (0.36 + chfo + 0.02), -0.98, -0.2))), 'dark2')
  K.det(elJ, box(0.04, 0.24, 0.05).xf(xf((s * (0.36 + chfo + 0.1), -0.98, -0.2))), 'black')
  # top (front) face: a white strip by the elbow over the purple plate and a vent
  Mff, chff = K.plate(elJ, [(-0.28, -0.14), (0.28, -0.14), (0.32, -0.7), (0.26, -1.2), (-0.26, -1.2), (-0.32, -0.7)], (0, 0, 0.36), t=0.14, ch=0.045,
                      mat='purple', groove=(0.045, 0.014, 0.014))
  K.plate(elJ, [(-0.24, -0.16), (0.24, -0.16), (0.24, -0.38), (-0.24, -0.38)], (0, 0, 0.36 + chff), t=0.05, ch=0.02, mat='white')
  K.vent(elJ, Mff, chff, 0, -0.88, 0.3, 0.18, 3)
  K.plate(elJ, [(-0.26, -0.15), (0.26, -0.15), (0.28, -1.2), (-0.28, -1.2)], (0, 0, -0.36), n=(0, 0, -1), t=0.12, ch=0.04, mat='purple')
  K.side(elJ, -s, 0.32, [(0.3, -0.15), (-0.3, -0.15), (-0.28, -1.2), (0.26, -1.2)], t=0.08, ch=0.03, mat='dark2')
  # elbow guard raking back past the joint
  K.plate(elJ, mx([(-0.24, 0.2), (0.24, 0.2), (0.28, -0.3), (0.0, -0.5), (-0.26, -0.3)]), (0, 0.05, -0.42), n=(0, 0.45, -1), up=(0, 1, 0.45), t=0.2,
          ch=0.045, mat='purple', groove=(0.035, 0.012, 0.012))
  K.mesh(elJ, prism([(-0.3, 0.1), (-0.62, 0.42), (-0.5, 0.06), (-0.34, -0.12)], 0.2, 0.025), 'purple', 'elbowspur')
  # wrist: a dark ring with a copper band and a round stud outside
  K.mesh(elJ, cyl(0.28, 0.16, 18, ch=0.02).xf(xf((0, -1.3, 0.0))), 'dark2', 'wrist')
  K.det(elJ, ring(0.3, 0.26, 0.05, 20).xf(xf((0, -1.26, 0))), 'copper')
  K.det(elJ, cyl(0.08, 0.1, 12, axis='x').xf(xf((s * 0.3, -1.3, 0))), 'dark')

  # ---- hand: a chunky palm and five jointed fingers with armored backs and claw tips ----
  K.mesh(haJ, box(0.4, 0.38, 0.5, 0.06).xf(xf((0, -0.17, 0))), 'dark2', 'palm')
  K.side(haJ, s, 0.2, [(0.24, -0.02), (-0.24, -0.02), (-0.22, -0.32), (0.22, -0.34)], t=0.06, ch=0.025, mat='purple')
  K.det(haJ, box(0.42, 0.07, 0.14, 0.02).xf(xf((0, -0.05, 0.22))), 'black')
  K.det(haJ, box(0.08, 0.3, 0.44, 0.02).xf(xf((s * 0.24, -0.22, 0))), 'gray')
  for f in range(5):
    thumb = f == 4
    parent = haJ
    for j in range(2 if thumb else 3):
      name = f'finger_{k}_{f}_{j}'
      if j:
        at, r = (0, -FINGER_LENS[j - 1], 0), (0, 0, 0)
      elif thumb:
        at, r = (-s * 0.18, -0.12, 0.16), (0.3, 0, -s * 0.5)
      else:
        at, r = (s * 0.04, -0.36, 0.165 - 0.11 * f), (0, 0, 0)
      b.joint(name, parent, at, r)
      l = FINGER_LENS[j]
      if j == (1 if thumb else 2):
        K.mesh(name, fprism([(-0.05, 0.0), (0.05, 0.0), (0.04, -l * 0.6), (0.0, -l * 1.05), (-0.03, -l * 0.6)], 0.09, 0.012), 'dark2', 'claw')
      else:
        K.mesh(name, box(0.1, l * 0.92, 0.1, 0.022).xf(xf((0, -l / 2, 0))), 'dark', 'finger')
        K.det(name, box(0.04, l * 0.62, 0.09, 0.012).xf(xf((s * 0.055, -l * 0.46, 0))), 'gray')
        K.det(name, cyl(0.052, 0.11, 10, axis='z'), 'dark2')
      parent = name


def build_head(b, K):
  """
  The helm from reference-head.webp. Head-local, origin at the neck base, chin at y 0.2, crown at
  about y 1.15, the beak's tip 0.88 forward. A dark skull under a purple dome; a white forehead
  carrying the cyan gem below a pointed crest; a purple V-brow jutting forward and down to a
  beak; cyan eye slits under it; a white mask with a copper mouth vent; layered white cheek
  blades sweeping back with copper hex slots; an ear hub; a white rear fin; two long antennas
  leaning back and splaying out in a V.
  """
  H = 'head'
  # ---- neck: dark column, segmented front, copper-collared rams either side ----
  K.mesh(H, cyl(0.17, 0.5, 14).xf(xf((0, 0.22, -0.05))), 'dark', 'neck')
  K.segs(H, (0, 0.0, 0.1), (0, 0.42, 0.14), 0.2, 0.14, 4)
  for sx in (-1, 1):
    K.piston(H, (sx * 0.2, -0.05, -0.02), (sx * 0.17, 0.4, 0.02), 0.04)
    K.hose(H, [(sx * 0.12, -0.05, -0.18), (sx * 0.16, 0.2, -0.24), (sx * 0.1, 0.42, -0.2)], 0.03)

  # ---- skull and dome ----
  K.mesh(H, loftz([dict(z=-0.52, w=0.5, h=0.46, y=0.66, c=0.12), dict(z=0.0, w=0.6, h=0.6, y=0.66, c=0.15), dict(z=0.42, w=0.5, h=0.52, y=0.66, c=0.13),
                   dict(z=0.56, w=0.4, h=0.4, y=0.66, c=0.1)]), 'dark', 'skull')
  K.mesh(H, loftz([dict(z=-0.6, w=0.5, h=0.22, y=0.96, c=0.08), dict(z=-0.2, w=0.7, h=0.36, y=0.98, c=0.12), dict(z=0.28, w=0.68, h=0.34, y=0.96, c=0.12),
                   dict(z=0.52, w=0.5, h=0.26, y=0.93, c=0.09)]), 'purple', 'dome')
  # faceted crown plates over the dome: a centre ridge and two side plates
  Mr, chr_ = K.plate(H, [(-0.08, 0.5), (0.08, 0.5), (0.1, -0.5), (0.0, -0.6), (-0.1, -0.5)], (0, 1.14, 0.0), n=(0, 1, 0.12), up=(0, 0, 1), t=0.06, ch=0.025,
                     mat='purple')
  K.decal(H, Mr, chr_, 0, -0.1, 0.05, 'code', r=math.pi / 2)
  for sx in (-1, 1):
    K.plate(H, [(sx * 0.12, 0.42), (sx * 0.32, 0.36), (sx * 0.36, -0.4), (sx * 0.12, -0.5)], (0, 1.1, 0.0), n=(sx * 0.35, 1, 0.08), up=(0, 0, 1), t=0.06,
            ch=0.025, mat='purple', groove=(0.03, 0.01, 0.01))

  # ---- forehead: white plate, the cyan gem in a dark socket, the crest above ----
  Mf, chf = K.plate(H, [(-0.24, 0.72), (0.24, 0.72), (0.27, 0.92), (0.0, 1.0), (-0.27, 0.92)], (0, 0, 0.53), n=(0, 0.2, 1), t=0.14, ch=0.035, mat='purple')
  K.det(H, cyl(0.115, 0.06, 12, axis='z').xf(xf((0, 0.86, 0.6), s=(0.85, 1.3, 1))), 'dark')
  K.mesh(H, sphere(0.09, 14, 10).xf(xf((0, 0.86, 0.62), s=(0.8, 1.35, 0.7))), 'lens', 'gem')
  K.mesh(H, fprism([(-0.16, 0.93), (0.16, 0.93), (0.065, 1.23), (0.0, 1.38), (-0.065, 1.23)], 0.08, 0.015).xf(xf((0, 0, 0.53))), 'white', 'crestback')
  K.mesh(H, fprism([(-0.115, 0.95), (0.115, 0.95), (0.042, 1.21), (0.0, 1.32), (-0.042, 1.21)], 0.07, 0.015).xf(xf((0, 0, 0.58))), 'purple', 'crest')
  K.mesh(H, prism([(0.42, 0.98), (0.6, 1.0), (0.56, 1.36), (0.46, 1.06)], 0.05, 0.012), 'purple', 'crestfin')

  # ---- V-brow: two bent plates meeting at a crease that runs forward and down to the beak tip ----
  Ct, Tip = V((0, 0.77, 0.68)), V((0, 0.42, 1.16))
  for sx in (-1, 1):
    St, Sb = V((sx * 0.4, 0.97, 0.02)), V((sx * 0.38, 0.56, 0.12))
    inward = V((-sx * 0.08, -0.06, -0.1))
    K.mesh(H, shell([Ct, St, Sb, Tip], inward), 'purple', 'brow')
    # white trim along the brow's lower edge and a dark notch where it meets the side
    a, c = Tip.lerp(Sb, 0.12), Sb
    K.mesh(H, shell([a + V((0, -0.0, 0)), c, c + V((0, -0.05, -0.01)), a + V((0, -0.04, -0.01))], inward * 0.8), 'white', 'browtrim')
    K.det(H, box(0.05, 0.08, 0.1).xf(xf((sx * 0.36, 0.75, 0.24))), 'black')
    # eye: a slanted cyan slit under the brow, set in a dark housing, angled forward and out
    eye = xf((sx * 0.2, 0.47, 0.6), (0.0, sx * 0.55, -sx * 0.22))
    K.det(H, box(0.26, 0.085, 0.07, 0.015).xf(eye), 'black')
    K.mesh(H, box(0.22, 0.04, 0.04, 0.01).xf(eye @ xf((0, 0, 0.025))), 'cyan', 'eye')
    # antennas: long tapered purple spikes leaning back and splaying out, white collars at their roots
    base, tip = V((sx * 0.22, 1.0, 0.36)), V((sx * 0.72, 2.12, -0.5))
    K.mesh(H, taper(base, tip, 0.15, 0.02, 6), 'purple', 'antenna')
    K.det(H, taper(base - V((0, 0.06, 0)), base + (tip - base) * 0.12, 0.19, 0.16, 6), 'white')
    K.det(H, box(0.1, 0.12, 0.16, 0.02).xf(xf((sx * 0.22, 0.98, 0.36))), 'dark2')

  # ---- face: a white mask under the eyes with a copper mouth vent and a pointed chin ----
  Mm, chm = K.plate(H, [(-0.2, 0.55), (0.2, 0.55), (0.17, 0.32), (0.06, 0.2), (-0.06, 0.2), (-0.17, 0.32)], (0, 0, 0.5), n=(0, -0.15, 1), t=0.14, ch=0.035,
                    mat='white')
  K.mesh(H, fprism([(-0.035, 0.0), (0.035, 0.0), (0.02, -0.2), (0.0, -0.24), (-0.02, -0.2)], 0.1, 0.012).xf(xf((0, 0.5, 0.6), (-0.25, 0, 0))), 'copper', 'mouth')
  for sx in (-1, 1):
    K.det(H, box(0.03, 0.12, 0.03).xf(Mm @ xf((sx * 0.1, 0.36, chm))), 'black')
  K.mesh(H, prism([(0.38, 0.32), (0.56, 0.28), (0.5, 0.14), (0.36, 0.2)], 0.2, 0.02), 'white', 'chin')

  # ---- cheeks: layered white blades sweeping up and back, copper hex slots, over purple under-plates ----
  hexa = [(math.cos(a) * 0.05, math.sin(a) * 0.035) for a in [i * math.pi / 3 for i in range(6)]]
  for sx in (-1, 1):
    lower = [(0.5, 0.24), (0.28, 0.44), (-0.18, 0.7), (-0.46, 0.84), (-0.3, 0.58), (0.06, 0.3), (0.34, 0.16)]
    Mc1, chc1 = K.side(H, sx, 0.31, lower, turn=0.2, t=0.1, ch=0.03, mat='white')
    upper = [(0.4, 0.6), (0.08, 0.78), (-0.36, 0.98), (-0.66, 1.04), (-0.44, 0.84), (-0.06, 0.64), (0.22, 0.54)]
    Mc2, chc2 = K.side(H, sx, 0.35, upper, turn=0.12, t=0.1, ch=0.03, mat='white')
    for M_, ch_, (f, y) in ((Mc1, chc1, (0.0, 0.47)), (Mc1, chc1, (-0.24, 0.66)), (Mc2, chc2, (-0.16, 0.83))):
      u = -sx * f
      K.det(H, fprism(hexa, 0.04, 0.008).xf(M_ @ xf((u, y, ch_ - 0.005))), 'black')
      K.det(H, fprism([(x * 0.7, yy * 0.7) for x, yy in hexa], 0.05, 0.006).xf(M_ @ xf((u, y, ch_ + 0.005))), 'copper')
    K.side(H, sx, 0.28, [(0.3, 0.3), (-0.2, 0.42), (-0.62, 0.5), (-0.7, 0.78), (-0.4, 0.86), (0.1, 0.62)], t=0.08, ch=0.025, mat='purple',
           groove=(0.03, 0.01, 0.01))
    # rear fin: a white blade pointing straight back off the top of the head, a purple one below it
    K.side(H, sx, 0.26, [(-0.24, 0.94), (-0.5, 1.0), (-0.92, 1.03), (-0.56, 0.88), (-0.28, 0.85)], t=0.08, ch=0.025, mat='white')
    K.side(H, sx, 0.24, [(-0.36, 0.5), (-0.62, 0.52), (-0.84, 0.42), (-0.6, 0.66), (-0.4, 0.7)], turn=-0.15, t=0.07, ch=0.02, mat='purple')
    # ear hub
    K.gear(H, (sx * 0.38, 0.56, -0.14), 0.15, 'x', n=5, depth=0.1)
  # back of the head: purple plates over the skull, a cyan sensor bar
  Mbk, chbk = K.plate(H, [(-0.27, 0.42), (0.27, 0.42), (0.31, 0.7), (0.24, 0.88), (-0.24, 0.88), (-0.31, 0.7)], (0, 0, -0.54), n=(0, 0.15, -1), t=0.12, ch=0.035,
                      mat='purple', groove=(0.035, 0.012, 0.012))
  K.decal(H, Mbk, chbk, 0, 0.55, 0.08, 'triDown')
  K.det(H, box(0.4, 0.08, 0.3, 0.02).xf(xf((0, 0.38, -0.45))), 'dark2')
  K.det(H, box(0.16, 0.06, 0.05).xf(xf((0, 1.0, -0.6))), 'black')
  K.mesh(H, box(0.12, 0.035, 0.03).xf(xf((0, 1.0, -0.63))), 'cyan', 'rearsensor')


PYLON_AT = (1.12, 0.92, -1.3)   # pivot on the chest (x mirrored)
PYLON_SWEEP = 0.34                # the blade rakes back this far (radians) below the housing


def build_pylon(b, k, s, K):
  """
  A back pylon after reference-pylon.webp, slimmer and longer: a housing round the hub with a
  forward spike, an intake at its top rear and the emblem on its outer face; under it a long
  blade raking back to a white tip, a white zig-zag band on its outer face, a dark trailing edge
  with a white centre strip. Pivot-local: +y up, +z forward, outer face toward s*x. The game
  hangs it from a sprung pivot (the HV-02 Obsidian's swing) and splays it tips-out.
  """
  P = 'pylon_' + k
  b.joint(P, 'chest', (s * PYLON_AT[0], PYLON_AT[1], PYLON_AT[2]))
  # the bracket stays on the chest: an arm from the back plate out to the hub
  K.mesh('chest', box(0.5, 0.26, 0.3, 0.05).xf(xf((s * 0.86, 0.92, -0.86), (0, -s * 0.5, 0))), 'dark2', 'pylonbracket')
  K.det('chest', cyl(0.08, 0.5, 10, axis='x').xf(xf((s * 0.88, 1.1, -0.84), (0, -s * 0.5, 0))), 'metal')
  K.det('chest', cyl(0.08, 0.5, 10, axis='x').xf(xf((s * 0.88, 0.74, -0.84), (0, -s * 0.5, 0))), 'metal')

  # ---- housing ----
  K.mesh(P, loft([dict(y=0.62, w=0.4, d=0.66, c=0.12, z=-0.08), dict(y=0.0, w=0.48, d=0.9, c=0.16), dict(y=-0.55, w=0.4, d=0.6, c=0.12, z=-0.1)]), 'dark', 'pyloncore')
  K.gear(P, (-s * 0.27, 0.0, 0.0), 0.27, 'x', depth=0.12)          # hub against the bracket
  out = [(0.78, -0.02), (0.38, 0.42), (0.1, 0.76), (-0.3, 0.74), (-0.52, 0.42), (-0.5, -0.1), (-0.3, -0.6), (0.18, -0.52), (0.46, -0.3)]
  Mo, cho = K.side(P, s, 0.22, out, t=0.16, ch=0.05, mat='purple', groove=(0.06, 0.018, 0.018))
  K.decal(P, Mo, cho, 0.06, 0.1, 0.34, 'emblem')
  K.decal(P, Mo, cho, 0.02, -0.38, 0.045, 'service', aspect=4)
  K.bolts(P, Mo, cho, [(0.4, 0.25), (-0.1, 0.62), (0.15, -0.45), (-0.35, -0.3)])
  K.gear(P, (s * 0.33, 0.12, 0.22), 0.14, 'x', n=5, depth=0.06)
  K.side(P, -s, 0.22, [(0.6, 0.0), (0.3, 0.4), (-0.3, 0.7), (-0.5, 0.36), (-0.46, -0.3), (0.2, -0.5)], t=0.12, ch=0.04, mat='purple')
  # top plate and the forward spike (gray-white tip underneath)
  K.plate(P, [(-0.2, -0.5), (0.2, -0.5), (0.22, 0.4), (-0.22, 0.4)] , (0, 0.74, -0.05), n=(0, 1, 0.2), up=(0, 0, -1), t=0.1, ch=0.035, mat='purple')
  spike = prism([(0.5, 0.0), (1.12, -0.26), (0.5, -0.3)], 0.3, 0.03)
  K.mesh(P, spike, 'purple', 'spike')
  K.mesh(P, prism([(0.86, -0.2), (1.14, -0.27), (0.86, -0.3)], 0.22, 0.02), 'gray', 'spiketip')
  # intake at the top rear: copper frame round a black grille, facing up and back
  Mi = xf((0, 0.62, -0.42), (0.85, 0, 0))
  K.det(P, box(0.34, 0.44, 0.1, 0.03).xf(Mi), 'copper')
  K.det(P, box(0.26, 0.36, 0.12, 0.02).xf(Mi), 'black')
  for i in range(6): K.det(P, box(0.24, 0.025, 0.04).xf(Mi @ xf((0, -0.15 + 0.06 * i, 0.06))), 'dark2')

  # ---- blade ----
  Mb = xf((0, -0.38, -0.08), (PYLON_SWEEP, 0, 0))
  L_ = 3.5
  core = loft([dict(y=0.1, w=0.34, d=0.6, c=0.1), dict(y=-1.6, w=0.3, d=0.5, c=0.09, z=-0.02), dict(y=-L_ + 0.7, w=0.24, d=0.32, c=0.07, z=-0.04)])
  K.mesh(P, core.xf(Mb), 'dark', 'bladecore')
  blade = [(0.32, 0.12), (-0.32, 0.12), (-0.34, -1.0), (-0.26, -2.4), (-0.16, -L_ + 0.66), (0.1, -L_ + 0.7), (0.2, -2.2), (0.3, -0.9)]
  def bside(sd, x, pts, **kw):
    n = V((sd, 0, 0)); M = Mb @ frame((sd * x, 0, 0), n)
    pts = [(-sd * f, y) for f, y in pts]
    g, _ = slab(pts, t=kw.get('t', 0.12), ch=kw.get('ch', 0.04), groove=kw.get('groove'))
    K.mesh(P, g.xf(M), kw.get('mat', 'purple'), 'blade')
    return M, kw.get('ch', 0.04)
  Mbo, chbo = bside(s, 0.15, blade, t=0.14, ch=0.045, groove=(0.05, 0.016, 0.016))
  # inner face (the sheet's underside): purple edge strips round a dark channel with a white centre strip
  bside(-s, 0.15, [(0.32, 0.12), (0.12, 0.12), (0.1, -2.2), (0.04, -L_ + 0.72), (0.1, -L_ + 0.7), (0.2, -2.2), (0.3, -0.9)], t=0.1, ch=0.035)
  bside(-s, 0.15, [(-0.12, 0.12), (-0.32, 0.12), (-0.34, -1.0), (-0.26, -2.4), (-0.16, -L_ + 0.66), (-0.08, -2.2)], t=0.1, ch=0.035)
  K.det(P, box(0.06, L_ - 0.9, 0.24, 0.02).xf(Mb @ xf((-s * 0.14, -(L_ - 0.9) / 2 + 0.05, -0.02))), 'dark2')
  Mw = Mb @ frame((-s * 0.18, -0.15, -0.02), (-s, 0, 0))
  g, _ = slab([(-0.07, 0.0), (0.07, 0.0), (0.06, -2.3), (0.0, -2.45), (-0.06, -2.3)], t=0.05, ch=0.02)
  K.mesh(P, g.xf(Mw), 'white', 'strip')
  for i in range(6): K.det(P, box(0.03, 0.06, 0.1).xf(Mw @ xf((0, -0.5 - 0.3 * i, 0.03))), 'black')
  for f in (-0.27, 0.27):
    K.gear(P, (-s * 0.26, -0.36, f), 0.13, 'x', n=5, depth=0.08)
  # white zig-zag band of solid triangles down the outer face, the code stencil above it
  for i in range(5):
    y = -1.2 - 0.34 * i
    w = 0.42 - 0.05 * i
    tri = [(-w / 2, 0.15), (w / 2, 0.15), (0, -0.15)] if i % 2 == 0 else [(0, 0.15), (w / 2, -0.15), (-w / 2, -0.15)]
    K.det(P, fprism(tri, 0.012, 0.003).xf(Mbo @ xf((-s * 0.02 * i, y, chbo + 0.006))), 'white')
  K.decal(P, Mbo, chbo, 0.0, -0.5, 0.13, 'triDown')
  K.decal(P, Mbo, chbo, 0.12 * -s, -2.95, 0.04, 'code', r=s * math.pi / 2)
  K.bolts(P, Mbo, chbo, [(0.2, -0.05), (-0.2, -0.05), (0.15, -2.4)])
  # leading edge: a gray rail with dark blocks; trailing edge: dark frame, white strip, two black discs
  K.det(P, taper((0, 0.0, 0.3), (0, -L_ + 0.9, 0.12), 0.1, 0.06, 4).xf(Mb), 'gray')
  for i in range(5): K.det(P, box(0.2, 0.18, 0.08, 0.02).xf(Mb @ xf((0, -0.5 - 0.42 * i, 0.3 - 0.04 * i))), 'dark2')
  K.det(P, box(0.22, L_ - 1.0, 0.08, 0.02).xf(Mb @ xf((0, -(L_ - 1.0) / 2 - 0.1, -0.3))), 'dark2')
  for i in range(7): K.det(P, box(0.12, 0.1, 0.05).xf(Mb @ xf((0, -0.5 - 0.3 * i, -0.34))), 'copper' if i % 3 == 0 else 'black')
  # white tip
  tip = fprism([(-0.11, 0.0), (0.12, 0.05), (0.06, -0.5), (-0.02, -0.82), (-0.08, -0.45)], 0.26, 0.03)
  K.mesh(P, tip.xf(Mb @ xf((0, -L_ + 0.74, -0.02), (0, math.pi / 2, 0))), 'white', 'bladetip')
  for i in range(2):
    K.det(P, box(0.03, 0.12, 0.27, 0.008).xf(Mb @ xf((0, -L_ + 0.55 - 0.18 * i, -0.0))), 'black')


def pose(b, name, r):
  """Rotate a joint by a game-space Euler (three.js XYZ), for previews only."""
  from mathutils import Matrix as Mx
  e = b.joints[name] if hasattr(b, 'joints') else bpy.data.objects['AM05_' + name]
  C = Mx(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
  m = C @ L.rot(*r).to_3x3() @ C.transposed()
  e.rotation_mode = 'XYZ'
  e.rotation_euler = m.to_euler('XYZ')


def pose_reference(b):
  """The sheet's stance: arms straight out to the sides, legs apart, feet turned out."""
  for s, k in ((1, 'L'), (-1, 'R')):
    pose(b, 'shoulder_' + k, (0, 0, s * 1.45))
    pose(b, 'pauldron_' + k, (0, 0, s * 0.35))
    pose(b, 'elbow_' + k, (0, 0, 0))
    pose(b, 'hip_' + k, (0, 0, s * 0.2))
    pose(b, 'ankle_' + k, (0, s * 0.5, -s * 0.2))
  legh = LEG['thigh'] + LEG['shin']
  b.joints['body'].location = L.B((0, LEG['hipDrop'] + legh * math.cos(0.2) + LEG['foot'], 0))


def pose_rest(b):
  for e in b.joints.values():
    e.rotation_euler = e.get('rest_euler', (0, 0, 0))
  b.joints['body'].location = L.B((0, STAND, 0))



def export(b, path=OUT):
  """Write the GLB at rest: every joint unrotated, the body at standing height, only the AM05 collection."""
  pose_rest(b)
  bpy.ops.object.select_all(action='DESELECT')
  for o in b.col.objects: o.select_set(True)
  bpy.context.view_layer.objects.active = b.joints['body']
  bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                            export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
                            export_cameras=False, export_lights=False, export_animations=False, export_extras=False)
  tris = 0
  for o in b.col.objects:
    if o.type == 'MESH':
      o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
  print('wrote', path, os.path.getsize(path), 'bytes,', tris, 'triangles,', sum(o.type == 'MESH' for o in b.col.objects), 'meshes')


def main(parts=('legs', 'torso', 'arms', 'head', 'pylons'), export_glb=False):
  b = setup()
  rig(b)
  K = Kit(b)
  if 'legs' in parts:
    for s, k in ((1, 'L'), (-1, 'R')): build_leg(k, s, K)
  if 'torso' in parts:
    build_pelvis(b, K)
    build_torso(b, K)
  if 'arms' in parts:
    for s, k in ((1, 'L'), (-1, 'R')): build_arm(b, k, s, K)
  if 'head' in parts:
    build_head(b, K)
  if 'pylons' in parts:
    for s, k in ((1, 'L'), (-1, 'R')): build_pylon(b, k, s, K)
  b.finish()
  if os.environ.get('AM05_POSE') == 'reference': pose_reference(b)
  if export_glb: export(b)
  print('objects', len(b.col.objects))
  return b


if __name__ == '__main__':
  main(tuple(os.environ.get('AM05_PARTS', 'legs,torso,arms,head,pylons').split(',')), export_glb=os.environ.get('AM05_EXPORT') == '1')
