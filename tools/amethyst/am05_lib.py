# Geometry helpers for the AM-05 Amethyst build (tools/amethyst/build_am05.py), run inside Blender.
#
# Everything is authored in GAME coordinates (three.js: +X the mech's left, +Y up, +Z forward), in the
# local frame of the rig joint a part rides on, exactly like the code-built frames in assets/*-frame.
# Shapes are plain vertex/face lists (Geo); emit() converts them to Blender's Z-up axes (x, -z, y), so
# the glTF exporter's +Y-up conversion hands three.js back the game coordinates unchanged.
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

V = Vector


# ---------------------------------------------------------------------------
# Transforms (game space)
# ---------------------------------------------------------------------------

def rot(rx=0.0, ry=0.0, rz=0.0):
  """Rotation as three.js Euler 'XYZ' (matrix = Rx * Ry * Rz)."""
  return (Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rz, 4, 'Z'))


def xf(at=(0, 0, 0), r=(0, 0, 0), s=None):
  m = Matrix.Translation(V(at)) @ rot(*r)
  if s is not None:
    if isinstance(s, (int, float)): s = (s, s, s)
    m = m @ Matrix.Diagonal((*s, 1))
  return m


def frame(origin, normal, up=(0, 1, 0)):
  """Plate frame: w along normal, v as close to up as possible, u = v x w."""
  w = V(normal).normalized()
  up = V(up)
  if abs(up.dot(w)) > 0.98: up = V((0, 0, 1)) if abs(w.z) < 0.9 else V((0, 1, 0))
  v = (up - w * up.dot(w)).normalized()
  u = v.cross(w)
  m = Matrix((u, v, w)).transposed().to_4x4()
  m.translation = V(origin)
  return m


def look(a, b):
  """Matrix taking +Y to the direction a->b, origin at a (for rods, tubes, segments)."""
  a, b = V(a), V(b)
  d = (b - a)
  y = d.normalized()
  q = V((0, 1, 0)).rotation_difference(y)
  m = q.to_matrix().to_4x4()
  m.translation = a
  return m, d.length


# ---------------------------------------------------------------------------
# Geo: a bag of vertices and polygons
# ---------------------------------------------------------------------------

class Geo:
  def __init__(self, v=None, f=None):
    self.v = [V(p) for p in (v or [])]
    self.f = [tuple(x) for x in (f or [])]

  def add(self, other):
    n = len(self.v)
    self.v += [p.copy() for p in other.v]
    self.f += [tuple(i + n for i in face) for face in other.f]
    return self

  def xf(self, m):
    self.v = [m @ p for p in self.v]
    return self

  def copy(self):
    return Geo(self.v, self.f)

  def mirror_x(self):
    """Mirror across x = 0 (flip windings so faces still point out)."""
    self.v = [V((-p.x, p.y, p.z)) for p in self.v]
    self.f = [tuple(reversed(face)) for face in self.f]
    return self


def area2(pts):
  a = 0.0
  for i in range(len(pts)):
    x0, y0 = pts[i][0], pts[i][1]
    x1, y1 = pts[(i + 1) % len(pts)][0], pts[(i + 1) % len(pts)][1]
    a += x0 * y1 - x1 * y0
  return a / 2


def ccw(pts):
  pts = [tuple(p) for p in pts]
  return pts if area2(pts) >= 0 else list(reversed(pts))


def inset2(pts, d):
  """Offset a CCW polygon inward by d (z values carried along)."""
  n = len(pts)
  out = []
  for i in range(n):
    p0, p1, p2 = V(pts[i - 1][:2]), V(pts[i][:2]), V(pts[(i + 1) % n][:2])
    e0 = (p1 - p0).normalized(); e1 = (p2 - p1).normalized()
    n0 = V((-e0.y, e0.x)); n1 = V((-e1.y, e1.x))  # left normals point inside a CCW polygon
    k = 1 + n0.dot(n1)
    off = (n0 + n1) / max(k, 0.35) * d
    z = pts[i][2] if len(pts[i]) > 2 else 0.0
    out.append((p1.x + off.x, p1.y + off.y, z))
  return out


def _ring(geo, pts2, z, w_of=None):
  base = len(geo.v)
  for p in pts2:
    zz = z + (p[2] if len(p) > 2 else 0.0)
    geo.v.append(V((p[0], p[1], zz)))
  return list(range(base, base + len(pts2)))


def _bridge(geo, a, b):
  """Quads between two rings of equal length (a -> b), wound so a CCW ring a gives outward sides."""
  n = len(a)
  for i in range(n):
    j = (i + 1) % n
    geo.f.append((a[i], b[i], b[j], a[j]))


def slab(pts, t=0.12, ch=0.045, back_ch=0.0, groove=None, bulge=0.0):
  """
  Faceted armor plate in its own frame: outline pts [(u, v[, w])] facing +w. The front face sits at
  w = 0 behind a chamfer of depth/inset ch (so the plate's top is w = ch); the back at w = -t.
  groove = (border, width, depth): a recessed panel line running round the face, border in from
  the chamfer. bulge lifts the face's middle (a shallow pyramid). Returns (Geo, top polygon).
  """
  pts = ccw([(p[0], p[1], p[2] if len(p) > 2 else 0.0) for p in pts])
  g = Geo()
  back_pts = inset2(pts, back_ch) if back_ch else pts
  back = _ring(g, back_pts, -t)
  rim = _ring(g, pts, -t + back_ch) if back_ch else None
  front_rim = _ring(g, pts, 0.0)
  if rim is not None:
    _bridge(g, back, rim)
    _bridge(g, rim, front_rim)
  else:
    _bridge(g, back, front_rim)
  top_pts = inset2(pts, ch)
  top = _ring(g, top_pts, ch)
  _bridge(g, front_rim, top)
  g.f.append(tuple(reversed(back)))
  face_pts = top_pts
  if groove:
    border, width, depth = groove
    p1 = inset2(top_pts, border)
    r1 = _ring(g, p1, ch)
    _bridge(g, top, r1)
    r1d = _ring(g, p1, ch - depth)
    _bridge(g, r1, r1d)
    p2 = inset2(p1, width)
    r2d = _ring(g, p2, ch - depth)
    _bridge(g, r1d, r2d)
    r2 = _ring(g, p2, ch)
    _bridge(g, r2d, r2)
    top, face_pts = r2, p2
  if bulge:
    c = sum((V(p) for p in face_pts), V((0, 0, 0))) / len(face_pts)
    ci = len(g.v)
    g.v.append(V((c.x, c.y, ch + c.z + bulge)))
    for i in range(len(top)):
      g.f.append((top[i], top[(i + 1) % len(top)], ci))
  else:
    g.f.append(tuple(top))
  return g, face_pts


def prism(profile, width, ch=0.03, axis='x'):
  """A side profile [(z, y)] (game: forward, up) extruded across x with chamfered edges."""
  pts = [(p[0], p[1]) for p in profile]
  g, _ = slab(pts, t=width - ch, ch=ch, back_ch=ch)
  # slab spans w in [-(width - ch), ch]: centre it, then turn u -> +z, v -> +y, w -> -x
  g.xf(Matrix.Translation(V((0, 0, width / 2 - ch))))
  g.xf(Matrix(((0, 0, -1, 0), (0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1))))
  return g


def fprism(profile, depth, ch=0.03):
  """A front outline [(x, y)] extruded along z (depth, centred) with chamfered edges."""
  g, _ = slab(profile, t=depth - ch, ch=ch, back_ch=ch)
  zs = [p.z for p in g.v]
  g.xf(Matrix.Translation(V((0, 0, -(max(zs) + min(zs)) / 2))))
  return g


def box(w, h, d, ch=0.03):
  ch = min(ch, w * 0.3, h * 0.3, d * 0.3)
  pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
  return fprism(pts, d, ch)


def octo(w, d, c):
  c = min(c, w * 0.45, d * 0.45)
  x, z = w / 2, d / 2
  return [(x - c, -z), (x, -z + c), (x, z - c), (x - c, z), (-x + c, z), (-x, z - c), (-x, -z + c), (-x + c, -z)]


def loft(sections, cap=True):
  """Chamfered-rectangle sections along y: dicts y, w, d, c and optional x, z offsets."""
  g = Geo()
  rings = []
  for s in sections:
    base = len(g.v)
    for (x, z) in octo(s['w'], s['d'], s.get('c', 0.1)):
      g.v.append(V((x + s.get('x', 0), s['y'], z + s.get('z', 0))))
    rings.append(list(range(base, base + 8)))
  for a, b in zip(rings, rings[1:]):
    for i in range(8):
      j = (i + 1) % 8
      g.f.append((a[i], a[j], b[j], b[i]))
  if cap:
    g.f.append(tuple(reversed(rings[0])) if sections[0]['y'] > sections[-1]['y'] else tuple(rings[0]))
    g.f.append(tuple(rings[-1]) if sections[0]['y'] > sections[-1]['y'] else tuple(reversed(rings[-1])))
  return g


def loftz(sections):
  """Like loft but along z (forward): dicts z, w, h, c and optional x, y."""
  conv = [dict(y=s['z'], w=s['w'], d=s['h'], c=s.get('c', 0.1), x=s.get('x', 0), z=-s.get('y', 0)) for s in sections]
  g = loft(conv)
  # map (x, y, z) -> (x, -z, y): loft's y becomes forward z, its z becomes -y
  g.xf(Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
  return g


def cyl(r, h, n=16, r2=None, ch=0.0, axis='y'):
  """Cylinder (or frustum, r2 at the top) centred on the origin along axis, optional chamfered rims."""
  r2 = r if r2 is None else r2
  g = Geo()
  rings = []
  levels = [(-h / 2, r)]
  if ch:
    levels = [(-h / 2, r - ch), (-h / 2 + ch, r), (h / 2 - ch, r2), (h / 2, r2 - ch)]
  else:
    levels = [(-h / 2, r), (h / 2, r2)]
  for y, rr in levels:
    base = len(g.v)
    for i in range(n):
      a = 2 * math.pi * i / n
      g.v.append(V((math.cos(a) * rr, y, math.sin(a) * rr)))
    rings.append(list(range(base, base + n)))
  for a, b in zip(rings, rings[1:]):
    for i in range(n):
      j = (i + 1) % n
      g.f.append((a[i], b[i], b[j], a[j]))
  g.f.append(tuple(rings[0]))
  g.f.append(tuple(reversed(rings[-1])))
  if axis == 'x': g.xf(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
  elif axis == 'z': g.xf(Matrix.Rotation(math.pi / 2, 4, 'X'))
  return g


def ring(r_out, r_in, h, n=24, axis='y'):
  g = Geo()
  rs = []
  for y in (-h / 2, h / 2):
    for r in (r_out, r_in):
      base = len(g.v)
      for i in range(n):
        a = 2 * math.pi * i / n
        g.v.append(V((math.cos(a) * r, y, math.sin(a) * r)))
      rs.append(list(range(base, base + n)))
  bo, bi, to, ti = rs
  for i in range(n):
    j = (i + 1) % n
    g.f.append((bo[i], to[i], to[j], bo[j]))   # outer wall
    g.f.append((bi[j], ti[j], ti[i], bi[i]))   # inner wall
    g.f.append((to[i], ti[i], ti[j], to[j]))   # top
    g.f.append((bo[j], bi[j], bi[i], bo[i]))   # bottom
  if axis == 'x': g.xf(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
  elif axis == 'z': g.xf(Matrix.Rotation(math.pi / 2, 4, 'X'))
  return g


def sphere(r, n=12, m=8, sy=1.0):
  g = Geo()
  g.v.append(V((0, -r * sy, 0)))
  for j in range(1, m):
    phi = -math.pi / 2 + math.pi * j / m
    for i in range(n):
      a = 2 * math.pi * i / n
      g.v.append(V((math.cos(a) * math.cos(phi) * r, math.sin(phi) * r * sy, math.sin(a) * math.cos(phi) * r)))
  g.v.append(V((0, r * sy, 0)))
  top = len(g.v) - 1
  for i in range(n):
    j = (i + 1) % n
    g.f.append((0, 1 + i, 1 + j))
  for k in range(m - 2):
    a0 = 1 + k * n; a1 = a0 + n
    for i in range(n):
      j = (i + 1) % n
      g.f.append((a0 + i, a1 + i, a1 + j, a0 + j))
  last = 1 + (m - 2) * n
  for i in range(n):
    j = (i + 1) % n
    g.f.append((last + j, last + i, top))
  return g


def tube(points, r, n=8, closed_ends=True):
  """Sweep a circle along a polyline (Catmull-Rom smoothed)."""
  P = [V(p) for p in points]
  if len(P) > 2:
    S = []
    for i in range(len(P) - 1):
      p0 = P[max(i - 1, 0)]; p1 = P[i]; p2 = P[i + 1]; p3 = P[min(i + 2, len(P) - 1)]
      for k in range(4):
        t = k / 4
        t2, t3 = t * t, t * t * t
        S.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    S.append(P[-1])
    P = S
  g = Geo()
  prev_n = None
  rings = []
  for i, p in enumerate(P):
    d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
    if prev_n is None:
      a = V((0, 0, 1)) if abs(d.z) < 0.9 else V((1, 0, 0))
      nrm = d.cross(a).normalized()
    else:
      nrm = (prev_n - d * prev_n.dot(d)).normalized()
    prev_n = nrm
    b = d.cross(nrm)
    base = len(g.v)
    for k in range(n):
      a = 2 * math.pi * k / n
      g.v.append(p + (nrm * math.cos(a) + b * math.sin(a)) * r)
    rings.append(list(range(base, base + n)))
  for a, b in zip(rings, rings[1:]):
    for k in range(n):
      j = (k + 1) % n
      g.f.append((a[k], b[k], b[j], a[j]))
  if closed_ends:
    g.f.append(tuple(reversed(rings[0])))
    g.f.append(tuple(rings[-1]))
  return g


def shell(front, offset):
  """A closed solid from a (possibly bent) polygon of 3D points and a thickness vector: the back face
  is the front moved by offset. Fan-triangulated about the centroid so bent faces stay clean."""
  F = [V(p) for p in front]
  Bk = [p + V(offset) for p in F]
  g = Geo(F + Bk)
  n = len(F)
  cf = sum(F, V((0, 0, 0))) / n
  cb = cf + V(offset)
  g.v += [cf, cb]
  ci, cbi = 2 * n, 2 * n + 1
  for i in range(n):
    j = (i + 1) % n
    g.f.append((i, j, ci))
    g.f.append((n + j, n + i, cbi))
    g.f.append((i, n + i, n + j, j))
  return g


def taper(a, b, w0, w1, n=6):
  """A tapered spike from a to b (width w0 at a, w1 at b), polygonal cross-section."""
  m, L = look(a, b)
  g = cyl(1.0, L, n, r2=1.0)
  for p in g.v:
    t = (p.y + L / 2) / L
    w = w0 + (w1 - w0) * t
    p.x *= w / 2; p.z *= w / 2
  return g.xf(m @ Matrix.Translation(V((0, L / 2, 0))))


def rod(a, b, r, n=8):
  m, L = look(a, b)
  return cyl(r, L, n).xf(m @ Matrix.Translation(V((0, L / 2, 0))))


def seg(a, b, w, d, n, ch=0.025, gap=0.86, alt=0.86):
  """Segmented mechanism between two points: alternating stacked blocks (two Geos: main, alternate)."""
  m, L = look(a, b)
  l = L / n
  g1, g2 = Geo(), Geo()
  for i in range(n):
    k = alt if i % 2 else 1.0
    blk = box(w * k, l * gap, d * k, ch).xf(m @ Matrix.Translation(V((0, l * (i + 0.5), 0))))
    (g2 if i % 2 else g1).add(blk)
  return g1, g2


def bolt(r=0.025, h=0.02, n=6):
  return cyl(r, h, n, axis='z')


def quad(w, h):
  """A decal card facing +z, uv filled in later from the atlas cell."""
  return Geo([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [(0, 1, 2, 3)])


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------

def B(p):
  """Game -> Blender coordinates."""
  return V((p[0], -p[2], p[1]))


class Builder:
  def __init__(self, prefix, collection):
    self.prefix = prefix
    self.col = collection
    self.joints = {}
    self.details = {}   # (joint, material) -> Geo
    self.decals = {}    # joint -> (Geo, uvs)
    self.mats = {}
    self.count = 0
    self.pre = {}       # joint -> Matrix applied to everything emitted on it (resizing a part)
    self.depth = {}     # joint name prefix -> front-to-back scale, applied as each joint is made

  def joint(self, name, parent, at, r=(0, 0, 0)):
    e = bpy.data.objects.new(f'{self.prefix}_{name}', None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.15
    self.col.objects.link(e)
    if parent:
      e.parent = self.joints[parent]
    e.location = B(at)
    # rotation authored in game space; convert the matrix
    if any(r):
      C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
      m = C @ rot(*r).to_3x3() @ C.transposed()
      e.rotation_mode = 'XYZ'
      e.rotation_euler = m.to_euler('XYZ')
    self.joints[name] = e
    k = self.depth.get(name.split('_')[0])
    if k: self.pre[name] = Matrix.Diagonal((1, 1, k, 1))
    e['game_at'] = list(at)
    e['rest_euler'] = list(e.rotation_euler)
    return e

  def emit(self, joint, geo, mat, name=None, detail=False, raw=False):
    """Plates (detail=False) become their own outlined objects; details merge per joint and material.
    raw: already placed through self.pre (round parts that must not be squashed by it)."""
    if joint in self.pre and not raw: geo = geo.copy().xf(self.pre[joint])
    if detail:
      key = (joint, mat)
      self.details.setdefault(key, Geo()).add(geo)
      return
    self.count += 1
    self._make(joint, geo, mat, f'pl_{name or mat}_{self.count}')

  def decal(self, joint, geo, uv_rect):
    """uv_rect: (u0, v0, u1, v1) in atlas pixels (1024 square, y down)."""
    if joint in self.pre: geo = geo.copy().xf(self.pre[joint])
    G, U = self.decals.setdefault(joint, (Geo(), []))
    G.add(geo)
    u0, v0, u1, v1 = [c / 1024 for c in uv_rect]
    U.append([(u0, 1 - v1), (u1, 1 - v1), (u1, 1 - v0), (u0, 1 - v0)])

  def _make(self, joint, geo, mat, name, uvs=None, closed=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([B(p) for p in geo.v], [], geo.f)
    me.validate(clean_customdata=False)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if closed:
      bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv = bm.loops.layers.uv.new('UVMap')
    if uvs is None:
      box_uv(bm, uv)
    bm.to_mesh(me); bm.free()
    if uvs is not None:
      lay = me.uv_layers[0]
      k = 0
      for poly, uvq in zip(me.polygons, uvs):
        for li, c in zip(poly.loop_indices, uvq):
          lay.data[li].uv = c
    for p in me.polygons: p.use_smooth = True
    try:
      me.set_sharp_from_angle(angle=math.radians(34))
    except Exception:
      pass
    me.materials.append(self.mats[mat])
    o = bpy.data.objects.new(name, me)
    self.col.objects.link(o)
    o.parent = self.joints[joint]
    return o

  def finish(self):
    for (joint, mat), geo in self.details.items():
      self._make(joint, geo, mat, f'dt_{joint}_{mat}')
    for joint, (geo, uvs) in self.decals.items():
      self._make(joint, geo, 'decal', f'dc_{joint}', uvs=uvs, closed=False)


def box_uv(bm, uv, scale=0.42):
  for f in bm.faces:
    n = f.normal
    ax = max(range(3), key=lambda i: abs(n[i]))
    for l in f.loops:
      p = l.vert.co
      if ax == 0: u, v = p.y, p.z
      elif ax == 1: u, v = p.x, p.z
      else: u, v = p.x, p.y
      l[uv].uv = (u * scale, v * scale)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def material(name, rgb, rough=0.45, metal=0.2, emit=0.0, tex=None, alpha_tex=None):
  m = bpy.data.materials.get(name)
  if m: bpy.data.materials.remove(m)
  m = bpy.data.materials.new(name)
  m.use_nodes = True
  nt = m.node_tree
  p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
  p.inputs['Base Color'].default_value = (*rgb, 1)
  p.inputs['Roughness'].default_value = rough
  p.inputs['Metallic'].default_value = metal
  if emit:
    p.inputs['Emission Color'].default_value = (*rgb, 1)
    p.inputs['Emission Strength'].default_value = emit
  if tex:
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = tex
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    mix.inputs[7].default_value = (*rgb, 1)  # B (color)
    nt.links.new(t.outputs['Color'], mix.inputs[6])  # A
    nt.links.new(mix.outputs[2], p.inputs['Base Color'])
  if alpha_tex:
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = alpha_tex
    nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    nt.links.new(t.outputs['Alpha'], p.inputs['Alpha'])
    try:
      m.surface_render_method = 'DITHERED'
    except Exception:
      pass
  m.diffuse_color = (*rgb, 1)
  # single-sided, so three.js gets FrontSide and the game's ink outlines apply
  m.use_backface_culling = not alpha_tex
  return m
