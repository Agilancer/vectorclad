# Builds the mech's held guns as GLBs for three.js (assets/scifi-guns/<id>.glb).
# Run inside Blender:  blender -b -P tools/guns/build_guns.py  (or exec() it from the Blender MCP).
# Set GUNS = ['beamRifle'] etc. before exec to build only some; EXPORT = False to skip writing files.
#
# Everything is written in GAME coordinates (three.js: +Z muzzle, +Y up, grip at the origin), the same
# numbers as js/weapons.js, and mapped to Blender (x, -z, y); the glTF exporter's +Y-up maps them back.
# Each part is its own object with one material, so the game's per-part outlines and batching still work.
# Material names are roles the game swaps for its own (skins): body, raw, metal, stripe, bore, glow, lens.
# Empties: muzzle0.., rear (bazooka back-blast), spin (spinning barrels, turns about +Z), lens (charge glow),
# root (beam cannon body, offset when shoulder mounted). Objects named grip* are hidden when mounted.
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) if '__file__' in dir() else None
OUT = os.path.join(ROOT or globals().get('REPO', '.'), 'assets', 'scifi-guns')

def B(x, y, z): return Vector((x, -z, y))

ROLE_COL = {
  'body': (0.075, 0.08, 0.09, 1), 'raw': (0.03, 0.032, 0.037, 1), 'metal': (0.13, 0.135, 0.145, 1),
  'stripe': (0.85, 0.2, 0.17, 1), 'bore': (0.01, 0.01, 0.012, 1), 'glow': (0.2, 0.9, 1.0, 1), 'lens': (0.02, 0.06, 0.09, 1),
}
ROLE_PBR = {'body': (0.5, 0.3), 'raw': (0.6, 0.2), 'metal': (0.32, 0.88), 'stripe': (0.42, 0.25), 'bore': (0.9, 0.2), 'glow': (0.4, 0.0), 'lens': (0.05, 0.9)}

def mat(role):
  m = bpy.data.materials.get(role)
  if m: return m
  m = bpy.data.materials.new(role)
  m.use_nodes = True
  p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
  p.inputs['Base Color'].default_value = ROLE_COL[role]
  p.inputs['Roughness'].default_value, p.inputs['Metallic'].default_value = ROLE_PBR[role]
  if role == 'glow':
    p.inputs['Emission Color'].default_value = ROLE_COL[role]
    p.inputs['Emission Strength'].default_value = 3.0
  m.diffuse_color = ROLE_COL[role]
  return m

class Gun:
  def __init__(self, gid):
    self.id = gid
    col = bpy.data.collections.get(gid)
    if col:
      for o in list(col.objects): bpy.data.objects.remove(o, do_unlink=True)
    else:
      col = bpy.data.collections.new(gid); bpy.context.scene.collection.children.link(col)
    self.col = col
    self.root = self.empty(gid, 0, 0, 0, parent=None)
    self.P = self.root
    self.n = 0

  # --- primitives ---------------------------------------------------------
  def _obj(self, name, bm, role, parent, smooth=0.55):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); self.col.objects.link(o)
    o.data.materials.append(mat(role))
    o.parent = parent or self.P
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=smooth)
    self.n += 1
    return o

  def empty(self, name, x, y, z, parent='root'):
    e = bpy.data.objects.new(name, None); self.col.objects.link(e)
    e.empty_display_size = 0.15
    e.location = B(x, y, z)
    if parent == 'root': parent = self.P
    if parent:
      e.parent = parent; e.location = B(x, y, z)
    return e

  def _place(self, o, x, y, z, rx, ry, rz, parent):
    # rotations in game axes (radians); Blender axes x->x, y->z, z->-y
    o.rotation_mode = 'XYZ'
    o.rotation_euler = (rx, -rz, ry)
    o.location = B(x, y, z)
    return o

  def _bevel(self, o, w, seg=2, limit=0.6):
    if w <= 0: return o
    m = o.modifiers.new('bev', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = limit
    m.harden_normals = False
    return o

  def box(self, role, w, h, d, x=0, y=0, z=0, bev=0.03, rx=0, ry=0, rz=0, name='box', parent=None, seg=2):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    o = self._obj(name, bm, role, parent)
    self._bevel(o, min(bev, w * 0.45, h * 0.45, d * 0.45), seg)
    return self._place(o, x, y, z, rx, ry, rz, parent)

  def cyl(self, role, r, length, x=0, y=0, z=0, axis='z', seg=20, r2=None, bev=0.015, name='cyl', parent=None, rx=0, ry=0, rz=0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=length)
    # cone is along Blender Z; turn to the game axis
    if axis == 'z': bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))   # +Z -> -Y (game +Z)
    elif axis == 'x': bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    o = self._obj(name, bm, role, parent, smooth=0.9)
    self._bevel(o, min(bev, r * 0.3, length * 0.3), 1, 0.9)
    return self._place(o, x, y, z, rx, ry, rz, parent)

  def side(self, role, pts, w, x=0, y=0, z=0, bev=0.03, name='side', parent=None, holes=(), rx=0, ry=0, rz=0):
    """Side-profile slab: pts are (z, y) in game units, extruded w across X. holes: lists of (z, y) cut through."""
    bm = bmesh.new()
    def face(ps, x0):
      vs = [bm.verts.new(B(x0, yy, zz)) for zz, yy in ps]
      return vs
    def slab(ps):
      a = face(ps, -w / 2); b = face(ps, w / 2); n = len(ps)
      f1 = bm.faces.new(a); f2 = bm.faces.new(b[::-1])
      for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    slab(pts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = self._obj(name, bm, role, parent)
    for hp in holes:
      hb = bmesh.new()
      vs_a = [hb.verts.new(B(-w, yy, zz)) for zz, yy in hp]; vs_b = [hb.verts.new(B(w, yy, zz)) for zz, yy in hp]
      n = len(hp); hb.faces.new(vs_a); hb.faces.new(vs_b[::-1])
      for i in range(n): hb.faces.new((vs_a[i], vs_a[(i + 1) % n], vs_b[(i + 1) % n], vs_b[i]))
      bmesh.ops.recalc_face_normals(hb, faces=hb.faces)
      hm = bpy.data.meshes.new('cut'); hb.to_mesh(hm); hb.free()
      cutter = bpy.data.objects.new('cut', hm); self.col.objects.link(cutter); cutter.hide_render = True
      self._cut(o, cutter)
    self._bevel(o, bev, 2)
    return self._place(o, x, y, z, rx, ry, rz, parent)

  def _cut(self, o, cutter):
    m = o.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cutter
    solvers = [i.identifier for i in bpy.types.BooleanModifier.bl_rna.properties['solver'].enum_items]
    m.solver = 'EXACT' if 'EXACT' in solvers else solvers[0]
    self._apply(o, m)
    bpy.data.objects.remove(cutter, do_unlink=True)

  def drill(self, o, r, pts, axis='x', depth=1.0, seg=10):
    """Bore round holes through o (world game coords of each hole centre)."""
    for (x, y, z) in pts:
      bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=depth)
      if axis == 'x': bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
      elif axis == 'z': bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))
      me = bpy.data.meshes.new('cut'); bm.to_mesh(me); bm.free()
      c = bpy.data.objects.new('cut', me); self.col.objects.link(c); c.location = B(x, y, z)
      c.parent = o.parent
      bpy.context.view_layer.update()
      c.matrix_world = Matrix.Translation(o.parent.matrix_world @ B(x, y, z)) if False else c.matrix_world
      self._cut_pending(o, c)
    return o

  def slot(self, o, w, h, d, pts, rx=0):
    for (x, y, z) in pts:
      bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
      me = bpy.data.meshes.new('cut'); bm.to_mesh(me); bm.free()
      c = bpy.data.objects.new('cut', me); self.col.objects.link(c); c.location = B(x, y, z); c.rotation_euler = (rx, 0, 0)
      c.parent = o.parent
      self._cut_pending(o, c)
    return o

  def _cut_pending(self, o, c):
    # boolean in world space: o's bevel stays on top of the stack, so move it last
    m = o.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c
    solvers = [i.identifier for i in bpy.types.BooleanModifier.bl_rna.properties['solver'].enum_items]
    m.solver = 'EXACT' if 'EXACT' in solvers else solvers[0]
    c.hide_set(True); c.hide_render = True
    self._cutters = getattr(self, '_cutters', []) + [c]

  def _apply(self, o, m):
    dg = bpy.context.evaluated_depsgraph_get()
    bpy.context.view_layer.update()
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = o.data; o.modifiers.clear(); o.data = me
    bpy.data.meshes.remove(old)

  def finish(self):
    """Apply every modifier (bevel, cuts) so the export and the game see plain meshes."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in list(self.col.objects):
      if o.type != 'MESH' or o.name.startswith('cut') or not o.modifiers: continue
      # put the bevel after the cuts
      names = [m.name for m in o.modifiers]
      ev = o.evaluated_get(dg)
      me = bpy.data.meshes.new_from_object(ev)
      mats = list(o.data.materials)
      old = o.data; o.modifiers.clear(); o.data = me
      if not me.materials: me.materials.append(mats[0])
      bpy.data.meshes.remove(old)
    for c in getattr(self, '_cutters', []):
      if c.name in bpy.data.objects: bpy.data.objects.remove(c, do_unlink=True)
    self._cutters = []

  def tris(self):
    return sum(len(o.data.loop_triangles) if o.data.calc_loop_triangles() is None else 0 for o in self.col.objects if o.type == 'MESH')

  def export(self):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in self.col.objects:
      o.hide_set(False); o.select_set(True)
      # Empties are found by name in the game, so take back the exact name from another gun's copy
      if o.type == 'EMPTY' and o is not self.root: o.rename(o.name.split('.')[0], mode='ALWAYS')
    bpy.context.view_layer.objects.active = self.root
    path = os.path.join(OUT, self.id + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
      export_materials='EXPORT', export_animations=False, export_extras=False, export_cameras=False, export_lights=False)
    return path


def cut_order(o):
  """Booleans first, bevel last."""
  mods = list(o.modifiers)
  bev = [m for m in mods if m.type == 'BEVEL']
  for m in bev:
    o.modifiers.move(list(o.modifiers).index(m), len(o.modifiers) - 1)


# ---------------------------------------------------------------------------
# Shared parts
# ---------------------------------------------------------------------------

def grip(g, x=0, y=-0.17, z=0, tilt=0.28, h=0.46):
  """Pistol grip at the origin (the hand closes round it) with a trigger guard ahead of it."""
  g.side('raw', [(-0.11, 0.06), (0.1, 0.06), (0.11, -0.05), (0.06, -h + 0.06), (-0.02, -h + 0.02), (-0.13, -h + 0.05), (-0.15, -0.1)], 0.17,
         x, y + 0.11, z, bev=0.035, name='grip', rx=-tilt * 0)
  for i in range(3): g.box('metal', 0.18, 0.025, 0.05, x, y - 0.06 - i * 0.09, z - 0.12, bev=0.008, name='gripRib')
  g.side('raw', [(0.1, 0.05), (0.42, 0.05), (0.42, -0.02), (0.36, -0.12), (0.14, -0.12), (0.12, -0.06)], 0.06, x, y + 0.04, z, bev=0.012,
         holes=[[(0.16, 0.0), (0.37, 0.0), (0.33, -0.08), (0.16, -0.08)]], name='gripGuard')
  g.box('metal', 0.03, 0.1, 0.03, x, y + 0.02, z + 0.2, bev=0.008, name='gripTrigger', rx=0.3)


def vents(g, host, x, y, z, nx=3, ny=2, pitch=0.1, r=0.03, axis='x', depth=0.8):
  pts = [(x, y + (j - (ny - 1) / 2) * pitch, z + (i - (nx - 1) / 2) * pitch) for i in range(nx) for j in range(ny)]
  for (px, py, pz) in pts:
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=r, depth=depth)
    if axis == 'x': bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    elif axis == 'y': pass
    me = bpy.data.meshes.new('cut'); bm.to_mesh(me); bm.free()
    c = bpy.data.objects.new('cut', me); g.col.objects.link(c); c.location = B(px, py, pz); c.parent = host.parent
    g._cut_pending(host, c)
  cut_order(host)


def slots(g, host, w, h, d, pts, rx=0):
  for (px, py, pz) in pts:
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    me = bpy.data.meshes.new('cut'); bm.to_mesh(me); bm.free()
    c = bpy.data.objects.new('cut', me); g.col.objects.link(c); c.location = B(px, py, pz); c.rotation_euler = (rx, 0, 0); c.parent = host.parent
    g._cut_pending(host, c)
  cut_order(host)


def leds(g, x, y, z, n=3, pitch=0.09, r=0.022, axis='x', side=1):
  for i in range(n):
    g.cyl('glow', r, 0.03, x, y, z + (i - (n - 1) / 2) * pitch, axis=axis, seg=10, bev=0, name='led')


def hose(g, pts, r=0.025, role='raw', name='hose', parent=None):
  """A cable along game-space points (a smooth curve, meshed)."""
  cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = 2; cu.resolution_u = 6
  sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
  for bp, p in zip(sp.bezier_points, pts):
    bp.co = B(*p); bp.handle_left_type = bp.handle_right_type = 'AUTO'
  o = bpy.data.objects.new(name, cu); g.col.objects.link(o); o.parent = parent or g.P
  bpy.context.view_layer.update()
  me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
  m = bpy.data.objects.new(name, me); g.col.objects.link(m); m.parent = o.parent
  me.materials.append(mat(role))
  for p in me.polygons: p.use_smooth = True
  bpy.data.objects.remove(o, do_unlink=True); bpy.data.curves.remove(cu)
  g.n += 1
  return m


def plates(g, role, z0, z1, y0, y1, w, x=0, n=3, gap=0.025, bev=0.02, slant=0.0, name='plate', parent=None):
  """A row of n armor plates on both sides (x = +-w/2), split by panel-line gaps."""
  L = (z1 - z0 - gap * (n - 1)) / n
  for i in range(n):
    a = z0 + i * (L + gap); b = a + L
    for s in (-1, 1):
      g.side(role, [(a + slant, y1), (b, y1), (b, y0), (a, y0)], 0.04, x + s * w / 2, 0, 0, bev=bev, name=name, parent=parent)


def rail(g, x, y, z, length, w=0.12, teeth=None, parent=None):
  g.box('metal', w, 0.05, length, x, y, z, bev=0.01, name='rail', parent=parent)
  n = teeth or max(3, int(length / 0.1))
  for i in range(n):
    g.box('metal', w + 0.03, 0.035, 0.04, x, y + 0.035, z - length / 2 + (i + 0.5) * length / n, bev=0.008, name='railTooth', parent=parent)


def scope(g, x, y, z, length=0.62, r=0.09, parent=None):
  g.box('raw', 0.16, 0.2, length, x, y, z, bev=0.04, name='scope', parent=parent)
  g.box('body', 0.17, 0.07, length * 0.5, x, y + 0.1, z - length * 0.1, bev=0.02, name='scopeTop', parent=parent)
  g.cyl('metal', r + 0.015, 0.08, x, y, z + length / 2 + 0.02, seg=16, name='scopeBezel', parent=parent)
  g.cyl('lens', r, 0.02, x, y, z + length / 2 + 0.065, seg=16, bev=0, name='scopeLens', parent=parent)
  g.box('metal', 0.08, 0.1, 0.12, x, y - 0.13, z - length * 0.25, bev=0.015, name='scopeMount', parent=parent)
  g.box('metal', 0.08, 0.1, 0.12, x, y - 0.13, z + length * 0.25, bev=0.015, name='scopeMount', parent=parent)


def stock(g, z0, z1, ytop, ybot, w=0.22, y0=0.18):
  """Skeletal stock from the receiver (z0) back to a butt plate (z1 < z0), with a striped pad."""
  L = z0 - z1
  outer = [(z0, y0 + 0.12), (z1 + 0.18, ytop), (z1, ytop), (z1, ybot), (z1 + 0.14, ybot), (z0 - L * 0.35, y0 - 0.22), (z0, y0 - 0.14)]
  hole = [(z0 - L * 0.22, y0 + 0.02), (z1 + 0.28, ytop - 0.09), (z1 + 0.2, ybot + 0.12), (z0 - L * 0.42, y0 - 0.13)]
  g.side('body', outer, w, 0, 0, 0, bev=0.035, holes=[hole], name='stock')
  g.box('raw', w + 0.04, ytop - ybot + 0.04, 0.12, 0, (ytop + ybot) / 2, z1 - 0.04, bev=0.035, name='stockPad')
  for i in range(2):
    s = g.box('stripe', w + 0.012, 0.06, 0.2, 0, ytop - 0.1 - i * 0.16, z1 + 0.22, bev=0.006, rx=0.6, name='stockStripe')


# ---------------------------------------------------------------------------
# The guns
# ---------------------------------------------------------------------------

def beamRifle():
  g = Gun('beamRifle')
  # Long receiver/shroud with a chamfered nose (image 1)
  rec = g.side('body', [(-0.55, 0.47), (2.0, 0.47), (2.3, 0.36), (2.3, 0.1), (2.12, -0.02), (0.75, -0.02), (0.62, 0.08), (-0.55, 0.08)], 0.34, 0, 0, 0, bev=0.035, name='receiver')
  vents(g, rec, 0, 0.32, 1.95, nx=3, ny=2, pitch=0.09, r=0.028)
  slots(g, rec, 1.0, 0.03, 1.2, [(0, 0.2, 1.1)])
  # Dark lower frame under the shroud and raised side armor with panel lines
  g.side('metal', [(-0.6, 0.2), (0.7, 0.2), (0.7, 0.04), (-0.6, 0.04)], 0.38, bev=0.02, name='frame')
  plates(g, 'body', 0.85, 2.05, 0.26, 0.45, 0.36, n=2, slant=0.06)
  plates(g, 'raw', 0.85, 1.9, 0.0, 0.12, 0.33, n=3, bev=0.012)
  g.box('raw', 0.3, 0.12, 1.25, 0, 0.2, 1.1, bev=0.01, name='channel')
  for s in (-1, 1): g.box('glow', 0.02, 0.025, 1.05, s * 0.17, 0.2, 1.1, bev=0, name='energyStrip')
  g.box('stripe', 0.36, 0.05, 0.5, 0, 0.42, 0.25, bev=0.008, name='stripe')
  for s in (-1, 1): leds(g, s * 0.195, 0.33, 0.25, n=3, pitch=0.08)
  g.box('raw', 0.3, 0.08, 1.4, 0, 0.03, 1.4, bev=0.02, name='underShroud')
  g.box('metal', 0.08, 0.1, 0.16, 0.2, 0.33, -0.2, bev=0.02, name='chargingHandle')
  hose(g, [(0.12, -0.05, 0.12), (0.17, 0.0, 0.45), (0.19, 0.08, 0.8)], r=0.022)
  # Barrel and muzzle brake
  g.cyl('metal', 0.12, 1.1, 0, 0.27, 2.75, seg=18, name='barrel')
  for i in range(4): g.cyl('metal', 0.15, 0.05, 0, 0.27, 2.45 + i * 0.13, seg=18, name='fin')
  g.box('metal', 0.3, 0.3, 0.32, 0, 0.27, 3.18, bev=0.06, name='brake')
  slots(g, g.col.objects[-1], 0.5, 0.05, 0.05, [(0, 0.27, 3.1), (0, 0.27, 3.22)])
  g.cyl('bore', 0.08, 0.02, 0, 0.27, 3.345, seg=14, bev=0, name='bore')
  # Rear receiver, magazine, grip, stock
  g.box('metal', 0.34, 0.36, 0.42, 0, 0.2, -0.72, bev=0.05, name='rearBlock')
  g.side('raw', [(0.62, 0.02), (0.98, 0.02), (0.92, -0.48), (0.68, -0.48)], 0.2, 0, 0, 0, bev=0.03, name='magazine')
  g.box('metal', 0.22, 0.05, 0.3, 0, -0.42, 0.8, bev=0.01, name='magBase')
  grip(g)
  stock(g, -0.85, -1.55, 0.42, -0.2, y0=0.2)
  rail(g, 0, 0.52, 0.55, 1.1)
  scope(g, 0, 0.7, 0.45)
  g.empty('muzzle0', 0, 0.27, 3.36)
  return g


def bazooka():
  g = Gun('bazooka')
  Y = 0.42
  # Octagonal armored tube with a flared muzzle and a back-blast venturi (image 5)
  g.cyl('body', 0.31, 3.2, 0, Y, 0.55, seg=8, bev=0.03, name='tube', rz=math.pi / 8)
  g.cyl('metal', 0.27, 0.72, 0, Y, 2.45, seg=16, name='barrelNeck')
  g.cyl('metal', 0.28, 0.42, 0, Y, 2.95, seg=20, r2=0.36, name='muzzleBell')
  g.cyl('stripe', 0.345, 0.08, 0, Y, 3.17, seg=20, bev=0.01, name='muzzleLip')
  g.cyl('bore', 0.26, 0.02, 0, Y, 3.215, seg=18, bev=0, name='bore')
  g.cyl('metal', 0.3, 0.3, 0, Y, -1.2, seg=20, r2=0.25, name='venturi')
  g.cyl('raw', 0.36, 0.24, 0, Y, -1.45, seg=20, r2=0.42, name='venturiBell')
  g.cyl('bore', 0.3, 0.02, 0, Y, -1.575, seg=18, bev=0, name='rearBore')
  for i in range(4):
    a = i * math.pi / 2 + math.pi / 4
    g.box('metal', 0.05, 0.22, 0.34, math.cos(a) * 0.38, Y + math.sin(a) * 0.38, -1.25, bev=0.01, rz=-a + math.pi / 2, name='fin')
  # Front armored shroud with a chamfered nose and slots
  sh = g.side('body', [(1.3, Y + 0.38), (2.0, Y + 0.38), (2.25, Y + 0.2), (2.25, Y - 0.2), (2.05, Y - 0.34), (1.3, Y - 0.34)], 0.74, bev=0.04, name='shroud')
  slots(g, sh, 1.0, 0.045, 0.32, [(0, Y + 0.24, 1.75), (0, Y + 0.14, 1.75), (0, Y + 0.04, 1.75)])
  for s in (-1, 1): leds(g, s * 0.375, Y - 0.18, 1.75, n=3, pitch=0.09)
  g.box('stripe', 0.76, 0.06, 0.12, 0, Y + 0.38, 1.45, bev=0.01, name='shroudStripe')
  # Side armor plates and a hazard band
  plates(g, 'raw', -0.85, 1.15, Y - 0.16, Y + 0.16, 0.64, n=4)
  for i in range(3):
    g.box('stripe', 0.66, 0.07, 0.14, 0, Y + 0.3, -0.75 + i * 0.2, bev=0.005, rx=0.5, name='hazard')
  g.cyl('metal', 0.33, 0.1, 0, Y, 1.2, seg=20, name='band')
  g.cyl('metal', 0.33, 0.1, 0, Y, -0.9, seg=20, name='band')
  # Optic, carry handle, fore grip, grip, cable
  g.box('raw', 0.2, 0.28, 0.7, -0.42, Y + 0.2, 0.55, bev=0.04, name='optic')
  g.box('metal', 0.1, 0.06, 0.25, -0.33, Y + 0.08, 0.55, bev=0.01, name='opticMount')
  g.cyl('lens', 0.08, 0.02, -0.42, Y + 0.22, 0.91, seg=14, bev=0, name='opticLens')
  g.box('glow', 0.21, 0.03, 0.2, -0.42, Y + 0.3, 0.2, bev=0, name='opticGlow')
  g.side('raw', [(-0.4, Y + 0.3), (-0.3, Y + 0.56), (0.5, Y + 0.56), (0.6, Y + 0.3), (0.45, Y + 0.3), (0.38, Y + 0.45), (-0.23, Y + 0.45), (-0.27, Y + 0.3)], 0.12, bev=0.025, name='handle')
  g.side('raw', [(0.9, 0.12), (1.12, 0.12), (1.08, -0.3), (0.94, -0.32)], 0.15, bev=0.03, name='foreGrip')
  grip(g, y=-0.12)
  g.box('metal', 0.26, 0.14, 0.5, 0, 0.1, 0.1, bev=0.03, name='gripMount')
  hose(g, [(0.12, -0.02, 0.1), (0.25, 0.1, 0.4), (0.32, 0.3, 0.75)], r=0.025)
  g.empty('muzzle0', 0, Y, 3.2)
  g.empty('rear', 0, Y, -1.62)
  return g


def machineGun():
  g = Gun('machineGun')
  # Receiver: angular, layered (image 3)
  rec = g.side('body', [(-0.35, 0.45), (0.95, 0.45), (1.12, 0.36), (1.12, 0.0), (0.98, -0.05), (-0.35, -0.05)], 0.4, bev=0.035, name='receiver')
  vents(g, rec, 0, 0.3, 0.75, nx=4, ny=1, pitch=0.1, r=0.03)
  plates(g, 'raw', -0.25, 0.9, 0.05, 0.25, 0.4, n=3)
  for s in (-1, 1): g.box('glow', 0.02, 0.03, 0.8, s * 0.225, 0.3, 0.35, bev=0, name='energyStrip')
  g.box('stripe', 0.41, 0.06, 0.4, 0, 0.42, 0.55, bev=0.008, name='stripe')
  rail(g, 0, 0.5, 0.35, 0.9)
  g.box('raw', 0.14, 0.18, 0.4, 0, 0.66, 0.3, bev=0.03, name='sight')
  g.cyl('lens', 0.05, 0.02, 0, 0.67, 0.505, seg=12, bev=0, name='sightLens')
  # Ammo drum below with a glowing round counter
  g.cyl('raw', 0.34, 0.32, 0, -0.27, 0.6, axis='x', seg=24, name='drum')
  for s in (-1, 1):
    g.cyl('metal', 0.26, 0.04, s * 0.17, -0.27, 0.6, axis='x', seg=24, name='drumCap')
    g.cyl('glow', 0.06, 0.02, s * 0.19, -0.27, 0.6, axis='x', seg=12, bev=0, name='drumLight')
  g.box('metal', 0.2, 0.2, 0.3, 0, -0.02, 0.6, bev=0.02, name='feed')
  hose(g, [(0.2, -0.2, 0.85), (0.24, -0.05, 1.0), (0.18, 0.05, 1.05)], r=0.03, role='metal')
  # Barrel shroud (fixed) over the spinning cluster
  g.side('body', [(1.05, 0.5), (1.75, 0.5), (1.85, 0.42), (1.85, 0.32), (1.05, 0.32)], 0.4, bev=0.03, name='shroudTop')
  g.cyl('metal', 0.27, 0.12, 0, 0.22, 1.1, seg=20, name='collar')
  spin = g.empty('spin', 0, 0.22, 1.08)
  L = 2.2  # long gatling barrels, well past the shroud
  for i in range(6):
    a = i / 6 * math.pi * 2
    g.cyl('metal', 0.05, L, math.cos(a) * 0.13, math.sin(a) * 0.13, L / 2, seg=10, name='barrel', parent=spin)
    g.cyl('bore', 0.03, 0.02, math.cos(a) * 0.13, math.sin(a) * 0.13, L + 0.01, seg=8, bev=0, name='bore', parent=spin)
  for zz in (0.35, 1.0, 1.6, L - 0.08):
    g.cyl('metal', 0.215, 0.08, 0, 0, zz, seg=6, name='clamp', parent=spin)
  g.cyl('stripe', 0.22, 0.05, 0, 0, L - 0.18, seg=6, name='clampBand', parent=spin)
  g.cyl('raw', 0.065, L, 0, 0, L / 2, seg=10, name='hub', parent=spin)
  # Rear, grip, stock
  g.box('metal', 0.34, 0.34, 0.3, 0, 0.18, -0.48, bev=0.04, name='rearBlock')
  grip(g)
  stock(g, -0.6, -1.15, 0.38, -0.12, w=0.2, y0=0.18)
  g.side('raw', [(0.75, 0.0), (1.0, 0.0), (0.98, -0.32), (0.84, -0.34)], 0.15, bev=0.03, name='foreGrip')
  g.empty('muzzle0', 0, 0.22, 1.08 + L + 0.05)
  return g


def shotgun():
  g = Gun('shotgun')
  # Chunky receiver with a big angular front block (image 2, the orange gun)
  rec = g.side('body', [(-0.4, 0.5), (0.95, 0.5), (1.05, 0.58), (2.05, 0.58), (2.15, 0.5), (2.15, 0.12), (1.95, 0.06), (1.05, 0.06), (0.9, -0.06), (-0.4, -0.06)], 0.46, bev=0.04, name='receiver')
  slots(g, rec, 1.0, 0.04, 0.3, [(0, 0.42, 1.75), (0, 0.32, 1.75), (0, 0.22, 1.75)])
  g.side('raw', [(1.1, 0.52), (1.9, 0.52), (1.9, 0.44), (1.1, 0.44)], 0.5, bev=0.01, name='topBand')
  plates(g, 'raw', -0.3, 0.85, 0.06, 0.4, 0.46, n=2)
  plates(g, 'body', 1.1, 1.6, 0.14, 0.46, 0.5, n=1, slant=0.08)
  for s in (-1, 1):
    g.box('glow', 0.02, 0.03, 0.5, s * 0.255, 0.3, 1.35, bev=0, name='energyStrip')
    leds(g, s * 0.235, 0.33, 0.45, n=2, pitch=0.1)
  g.box('stripe', 0.47, 0.06, 0.6, 0, 0.5, 0.4, bev=0.008, name='stripe')
  # Twin barrels with heavy muzzle caps
  for s in (-1, 1):
    g.cyl('metal', 0.12, 0.45, s * 0.12, 0.32, 2.3, seg=16, name='barrel')
    g.cyl('raw', 0.14, 0.12, s * 0.12, 0.32, 2.48, seg=8, bev=0.015, name='muzzleCap', rz=math.pi / 8)
    g.cyl('bore', 0.085, 0.02, s * 0.12, 0.32, 2.545, seg=12, bev=0, name='bore')
  g.box('metal', 0.38, 0.1, 0.4, 0, 0.32, 2.3, bev=0.02, name='barrelBridge')
  # Pump fore-end under the barrels
  g.side('raw', [(1.05, 0.02), (1.75, 0.02), (1.78, -0.12), (1.05, -0.12)], 0.34, bev=0.03, name='pump')
  for i in range(5): g.box('metal', 0.36, 0.03, 0.04, 0, -0.06, 1.15 + i * 0.13, bev=0.005, name='pumpRib')
  g.box('metal', 0.12, 0.08, 0.6, 0, 0.62, 0.3, bev=0.02, name='sightRail')
  g.box('raw', 0.1, 0.12, 0.08, 0, 0.68, 0.05, bev=0.015, name='sightRear')
  g.box('glow', 0.04, 0.04, 0.04, 0, 0.66, 2.0, bev=0, name='sightDot')
  grip(g)
  stock(g, -0.4, -1.1, 0.46, -0.16, w=0.26, y0=0.22)
  hose(g, [(0.15, -0.05, 0.1), (0.22, 0.05, 0.6), (0.2, 0.0, 1.0)], r=0.024)
  g.empty('muzzle0', 0, 0.32, 2.56)
  return g


def grenade():
  g = Gun('grenade')
  Y = 0.3
  # Revolver drum with glowing chamber windows (image 2, bottom left)
  g.cyl('body', 0.44, 0.7, 0, Y, 0.5, seg=12, bev=0.03, name='drum')
  for i in range(6):
    a = i / 6 * math.pi * 2 + math.pi / 6
    g.box('glow', 0.07, 0.05, 0.4, math.cos(a) * 0.445, Y + math.sin(a) * 0.445, 0.5, bev=0, rz=a + math.pi / 2, name='chamberGlow')
  for zz in (0.13, 0.87): g.cyl('stripe', 0.455, 0.07, 0, Y, zz, seg=24, name='drumBand')
  g.cyl('metal', 0.2, 0.1, 0, Y, 0.08, seg=16, name='drumAxle')
  # Frame and body
  g.side('metal', [(-0.4, 0.1), (1.0, 0.1), (1.0, -0.12), (-0.4, -0.12)], 0.3, bev=0.03, name='frame')
  rec = g.side('body', [(-0.85, 0.4), (-0.15, 0.48), (0.0, 0.48), (0.0, 0.0), (-0.85, 0.0)], 0.34, bev=0.04, name='rearBody')
  vents(g, rec, 0, 0.3, -0.45, nx=3, ny=1, pitch=0.12, r=0.035)
  plates(g, 'raw', -0.75, -0.1, 0.06, 0.3, 0.34, n=2)
  leds(g, 0.18, 0.38, -0.55, n=3, pitch=0.08)
  g.box('raw', 0.16, 0.2, 0.5, 0, 0.82, 0.4, bev=0.04, name='sight')
  g.box('metal', 0.08, 0.1, 0.12, 0, 0.7, 0.4, bev=0.015, name='sightMount')
  g.cyl('lens', 0.06, 0.02, 0, 0.83, 0.66, seg=12, bev=0, name='sightLens')
  # Rotary barrel cluster (turns a quarter per shot)
  spin = g.empty('spin', 0, Y, 0.95)
  g.cyl('metal', 0.38, 0.1, 0, 0, 0.05, seg=8, name='spinPlate', parent=spin, rz=math.pi / 8)
  for i in range(4):
    a = i / 4 * math.pi * 2 + math.pi / 4
    x, y = math.cos(a) * 0.22, math.sin(a) * 0.22
    g.cyl('metal', 0.12, 0.8, x, y, 0.45, seg=14, name='barrel', parent=spin)
    g.cyl('raw', 0.14, 0.14, x, y, 0.78, seg=8, bev=0.012, name='muzzleCap', parent=spin)
    g.cyl('bore', 0.09, 0.02, x, y, 0.855, seg=12, bev=0, name='bore', parent=spin)
  g.cyl('raw', 0.08, 0.8, 0, 0, 0.45, seg=10, name='hub', parent=spin)
  g.cyl('metal', 0.38, 0.06, 0, 0, 0.6, seg=8, name='spinPlate', parent=spin, rz=math.pi / 8)
  grip(g, y=-0.27)
  g.box('metal', 0.2, 0.12, 0.4, 0, -0.08, 0.05, bev=0.02, name='gripMount')
  stock(g, -0.85, -1.35, 0.44, -0.06, w=0.24, y0=0.2)
  hose(g, [(-0.12, -0.15, -0.05), (-0.2, 0.05, -0.3), (-0.18, 0.25, -0.5)], r=0.025)
  g.empty('muzzle0', 0, Y, 1.9)
  return g


def beamCannon():
  g = Gun('beamCannon')
  g.P = g.empty('root', 0, 0, 0)
  # Long energy cannon with a big charge disc on the side (image 6)
  rec = g.side('body', [(-0.6, 0.52), (1.3, 0.52), (1.45, 0.44), (1.45, 0.02), (1.3, -0.02), (-0.6, -0.02)], 0.44, bev=0.04, name='receiver')
  vents(g, rec, 0, 0.4, 1.15, nx=3, ny=2, pitch=0.09, r=0.028)
  plates(g, 'raw', -0.5, 0.6, 0.04, 0.22, 0.44, n=2)
  g.side('body', [(1.4, 0.48), (2.9, 0.48), (3.0, 0.4), (3.0, 0.15), (1.4, 0.15)], 0.32, bev=0.03, name='barrelShroud')
  for i in range(5): g.box('metal', 0.44, 0.44, 0.06, 0, 0.3, 1.65 + i * 0.2, bev=0.02, name='coolingFin')
  g.cyl('metal', 0.26, 0.3, 0, 0.3, 3.12, seg=18, r2=0.2, name='emitter')
  g.cyl('glow', 0.2, 0.02, 0, 0.3, 3.28, seg=18, bev=0, name='emitterGlow')
  g.box('stripe', 0.45, 0.07, 0.45, 0, 0.52, 0.0, bev=0.008, name='stripe')
  # Charge disc both sides
  for s in (-1, 1):
    g.cyl('metal', 0.4, 0.1, s * 0.25, 0.22, 0.75, axis='x', seg=28, name='disc')
    g.cyl('glow', 0.33, 0.02, s * 0.3, 0.22, 0.75, axis='x', seg=28, bev=0, name='discRing')
    g.cyl('raw', 0.28, 0.04, s * 0.31, 0.22, 0.75, axis='x', seg=28, name='discCore')
    g.cyl('stripe', 0.12, 0.03, s * 0.335, 0.22, 0.75, axis='x', seg=16, name='discCap')
    g.box('body', 0.04, 0.14, 0.7, s * 0.24, 0.12, 1.3, bev=0.015, name='discArm')
  g.box('raw', 0.2, 0.3, 1.2, 0, 0.66, 0.3, bev=0.04, name='topHousing')
  g.box('glow', 0.21, 0.03, 0.7, 0, 0.76, 0.3, bev=0, name='topGlow')
  g.cyl('metal', 0.07, 1.6, 0.2, 0.0, 0.6, seg=10, name='feedLine')
  g.box('metal', 0.3, 0.3, 0.4, 0, 0.25, -0.75, bev=0.05, name='capacitor')
  g.cyl('stripe', 0.17, 0.32, 0, 0.25, -0.95, seg=16, name='capacitorCap')
  g.cyl('glow', 0.1, 0.02, 0, 0.25, -1.115, seg=12, bev=0, name='capacitorGlow')
  grip(g)
  g.side('raw', [(0.55, -0.02), (0.78, -0.02), (0.75, -0.36), (0.6, -0.38)], 0.15, bev=0.03, name='gripFore')
  g.empty('muzzle0', 0, 0.3, 3.35)
  g.empty('lens', 0, 0.3, 3.3)
  return g


def vulcanPod():
  g = Gun('vulcanPod')
  # Shoulder gatling: armored housing on its base (origin), four long barrels (spin) out the front
  h = g.side('body', [(-0.45, 0.6), (0.4, 0.6), (0.62, 0.48), (0.62, 0.12), (0.45, 0.04), (-0.45, 0.04)], 0.6, bev=0.04, name='housing')
  vents(g, h, 0, 0.45, -0.1, nx=3, ny=2, pitch=0.1, r=0.03)
  plates(g, 'raw', -0.4, 0.4, 0.1, 0.3, 0.6, n=2)
  for s in (-1, 1): g.box('glow', 0.02, 0.03, 0.6, s * 0.315, 0.38, 0.0, bev=0, name='energyStrip')
  g.box('stripe', 0.62, 0.07, 0.3, 0, 0.6, 0.25, bev=0.008, name='stripe')
  g.box('metal', 0.5, 0.08, 0.9, 0, 0.02, 0.05, bev=0.02, name='base')
  g.box('raw', 0.24, 0.3, 0.5, 0.36, 0.3, -0.15, bev=0.03, name='ammoBox')
  hose(g, [(0.36, 0.45, 0.1), (0.3, 0.5, 0.45), (0.12, 0.45, 0.62)], r=0.03, role='metal')
  g.cyl('metal', 0.22, 0.12, 0, 0.32, 0.66, seg=20, name='collar')
  spin = g.empty('spin', 0, 0.32, 0.62)
  L = 1.55
  for i in range(4):
    a = i / 4 * math.pi * 2 + math.pi / 4
    g.cyl('metal', 0.05, L, math.cos(a) * 0.1, math.sin(a) * 0.1, L / 2, seg=10, name='barrel', parent=spin)
    g.cyl('bore', 0.03, 0.02, math.cos(a) * 0.1, math.sin(a) * 0.1, L + 0.01, seg=8, bev=0, name='bore', parent=spin)
  for zz in (0.3, 0.9, L - 0.07): g.cyl('metal', 0.18, 0.07, 0, 0, zz, seg=6, name='clamp', parent=spin)
  g.cyl('stripe', 0.185, 0.04, 0, 0, L - 0.17, seg=6, name='clampBand', parent=spin)
  g.cyl('raw', 0.05, L, 0, 0, L / 2, seg=10, name='hub', parent=spin)
  g.empty('muzzle0', 0, 0.32, 0.62 + L + 0.05)
  return g


BUILDERS = {'beamRifle': beamRifle, 'bazooka': bazooka, 'machineGun': machineGun, 'shotgun': shotgun, 'grenade': grenade, 'beamCannon': beamCannon, 'vulcanPod': vulcanPod}

def build(ids=None, export=True):
  out = {}
  for gid in (ids or list(BUILDERS)):
    g = BUILDERS[gid]()
    g.finish()
    out[gid] = {'objects': g.n, 'path': g.export() if export else None}
  return out

if __name__ == '__main__' or globals().get('RUN'):
  print(build(globals().get('GUNS'), globals().get('EXPORT', True)))
