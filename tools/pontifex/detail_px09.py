# Details the PX-09 Pontifex in Blender and writes assets/pontifex-frame/px09.glb, which the game swaps onto the
# code-built armor (assets/pontifex-frame/pontifex-mech.js). Exec it from the Blender MCP or `blender -b -P`.
#  1. tools/pontifex/export_px09.js writes px09_source.glb (the code-built armor, rest pose, joints named).
#  2. This script re-imports it into the PX09 collection, then: welds and chamfers the hard edges, lays inset
#     panel lines and corner bolts on the white plate, adds greebles (vents, rams, antennas, lights, tanks),
#     and exports only the "PX09 <part>" armor groups with their joints.
# Game coordinates (three.js +Y up, +Z forward) map to Blender as (x, -z, y), like tools/guns/build_guns.py.
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(HERE, 'px09_source.glb')
OUT = os.path.join(REPO, 'assets', 'pontifex-frame', 'px09.glb')

def B(x, y, z): return Vector((x, -z, y))

def material(name, rgb, rough=0.45, metal=0.3, emit=0.0):
  m = bpy.data.materials.get(name)
  if not m:
    m = bpy.data.materials.new(name); m.use_nodes = True
  p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
  p.inputs['Base Color'].default_value = (*rgb, 1)
  p.inputs['Roughness'].default_value = rough
  p.inputs['Metallic'].default_value = metal
  if emit:
    p.inputs['Emission Color'].default_value = (*rgb, 1); p.inputs['Emission Strength'].default_value = emit
  m.diffuse_color = (*rgb, 1)
  return m

def role(o):
  return o.data.materials[0].name.split('.')[0] if o.type == 'MESH' and o.data.materials else None


def reimport():
  col = bpy.data.collections.get('PX09')
  if not col:
    col = bpy.data.collections.new('PX09'); bpy.context.scene.collection.children.link(col)
  for o in list(col.objects): bpy.data.objects.remove(o, do_unlink=True)
  for me in [m for m in bpy.data.meshes if not m.users]: bpy.data.meshes.remove(me)
  bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children['PX09']
  bpy.ops.import_scene.gltf(filepath=SRC)
  # One material per role, named exactly (the game maps them by name)
  mats = {}
  for o in col.objects:
    if o.type != 'MESH': continue
    for i, m in enumerate(o.data.materials):
      r = m.name.split('.')[0]
      if r not in mats: mats[r] = m; m.name = r
      o.data.materials[i] = mats[r]
  return col


# ---------------------------------------------------------------------------
# 1. Weld and chamfer
# ---------------------------------------------------------------------------

def chamfer(col):
  for o in col.objects:
    r = role(o)
    if not r: continue
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(o.data); bm.free()
    for p in o.data.polygons: p.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(32))
    if r in ('white', 'grey', 'red') and len(o.data.vertices) > 7:
      m = o.modifiers.new('chamfer', 'BEVEL')
      m.width = 0.014 if r in ('white', 'grey', 'red') else 0.01
      m.segments = 1
      m.limit_method = 'ANGLE'; m.angle_limit = math.radians(38)
      m.use_clamp_overlap = True
      m.harden_normals = False


# ---------------------------------------------------------------------------
# 2. Panel lines and bolts on the white plate
# ---------------------------------------------------------------------------

def face_frame(n):
  n = n.normalized()
  t = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
  u = t.cross(n).normalized(); v = n.cross(u)
  return u, v, n

def strip(bm, a, b, n, w=0.013, h=0.008, lift=0.002):
  """A thin raised line on a face from a to b (its normal n): top plus two sloped sides, 6 tris."""
  d = (b - a); L = d.length
  if L < 1e-4: return
  side = n.cross(d / L).normalized() * (w / 2)
  base = n * lift; top = n * (lift + h)
  v = [bm.verts.new(p) for p in (a + base - side * 1.6, b + base - side * 1.6, b + top - side, a + top - side,
                                   a + top + side, b + top + side, b + base + side * 1.6, a + base + side * 1.6)]
  bm.faces.new((v[0], v[1], v[2], v[3])); bm.faces.new((v[3], v[2], v[5], v[4])); bm.faces.new((v[4], v[5], v[6], v[7]))

def bolt(bm, p, n, r=0.024, h=0.018):
  """A hex bolt head standing on a face at p."""
  u, v, n = face_frame(n)
  ring = [p + (u * math.cos(a) + v * math.sin(a)) * r for a in [k * math.pi / 3 + math.pi / 6 for k in range(6)]]
  lo = [bm.verts.new(q - n * 0.004) for q in ring]
  hi = [bm.verts.new(q + n * h) for q in ring]
  c = bm.verts.new(p + n * (h + r * 0.35))
  for i in range(6):
    j = (i + 1) % 6
    bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new((hi[i], hi[j], c))

def line_work(col, seam_mat, bolt_mat):
  made = 0
  for o in list(col.objects):
    if role(o) not in ('white', 'grey'): continue
    src = bmesh.new(); src.from_mesh(o.data)
    bmesh.ops.dissolve_limit(src, angle_limit=0.02, verts=src.verts, edges=src.edges)
    src.faces.ensure_lookup_table()
    sb, bb = bmesh.new(), bmesh.new()
    for f in src.faces:
      A = f.calc_area()
      if A < 0.12: continue
      n = f.normal.copy(); c = f.calc_center_median()
      vs = [v.co.copy() for v in f.verts]
      # Inset outline, about 0.06 in from the edge, as panel lines
      inset = [q + (c - q) * min(0.4, 0.06 / max((c - q).length, 1e-4)) for q in vs]
      for i in range(len(inset)):
        a, b = inset[i], inset[(i + 1) % len(inset)]
        if (b - a).length > 0.07: strip(sb, a, b, n)
      # Bolts in the corners of the big faces
      if A > 0.4:
        for q in vs:
          if (c - q).length < 0.2: continue
          bolt(bb, q + (c - q) * min(0.5, 0.12 / (c - q).length), n)
    for bmx, mat, tag in ((sb, seam_mat, 'seam'), (bb, bolt_mat, 'bolt')):
      if not bmx.faces: bmx.free(); continue
      me = bpy.data.meshes.new(tag); bmx.to_mesh(me); bmx.free()
      me.materials.append(mat)
      for p in me.polygons: p.use_smooth = False
      d = bpy.data.objects.new(f'{tag}_{o.name}', me); col.objects.link(d)
      d.parent = o.parent; d.matrix_parent_inverse = o.matrix_parent_inverse.copy(); d.matrix_basis = o.matrix_basis.copy()
      made += 1
    src.free()
  return made


# ---------------------------------------------------------------------------
# 3. Greebles, placed by hand in each armor group's own (game) space
# ---------------------------------------------------------------------------

class Kit:
  def __init__(self, col, mats): self.col, self.M, self.n = col, mats, 0
  def _o(self, name, bm, mat, parent, loc, rot=(0, 0, 0), smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(self.M[mat])
    for p in me.polygons: p.use_smooth = smooth
    if smooth: me.set_sharp_from_angle(angle=math.radians(40))
    o = bpy.data.objects.new(name, me); self.col.objects.link(o)
    o.parent = bpy.data.objects[parent]
    o.rotation_mode = 'XYZ'; o.rotation_euler = (rot[0], -rot[2], rot[1]); o.location = B(*loc)
    self.n += 1
    return o
  def box(self, parent, mat, w, h, d, x, y, z, rot=(0, 0, 0), bev=0.012, name='gbox'):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    if bev > 0: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bev, w * 0.4, h * 0.4, d * 0.4), segments=1, affect='EDGES')
    return self._o(name, bm, mat, parent, (x, y, z), rot)
  def cyl(self, parent, mat, r, length, x, y, z, axis='y', seg=12, r2=None, rot=(0, 0, 0), name='gcyl'):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=length)
    # cone along Blender Z = game Y; turn for game X / Z
    if axis == 'z': bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    elif axis == 'x': bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    return self._o(name, bm, mat, parent, (x, y, z), rot, smooth=True)
  def rod(self, parent, mat, a, b, r, seg=10, name='grod'):
    a, b = B(*a), B(*b); d = b - a
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    o = self._o(name, bm, mat, parent, (0, 0, 0), smooth=True)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    o.location = (a + b) / 2
    return o
  def ram(self, parent, a, b, r=0.05):
    """Hydraulic ram: a dark barrel over the first 60%, a bright rod the rest, a collar between."""
    A, Bv = Vector(a), Vector(b); m = A.lerp(Bv, 0.6)
    self.rod(parent, 'dark2', tuple(A), tuple(m), r, name='ramBarrel')
    self.rod(parent, 'metal', tuple(m), tuple(Bv), r * 0.55, name='ramRod')
    self.rod(parent, 'red', tuple(A.lerp(Bv, 0.56)), tuple(A.lerp(Bv, 0.62)), r * 1.12, name='ramCollar')
  def vent(self, parent, x, y, z, w, h, n=4, facing='z', s=1, rot=(0, 0, 0)):
    """A slatted vent on a face pointing along +facing (s flips it)."""
    if facing == 'z':
      self.box(parent, 'dark', w, h, 0.05, x, y, z, rot=rot, name='vent')
      for i in range(n):
        self.box(parent, 'dark2', w * 0.86, h / n * 0.45, 0.03, x, y - h / 2 + (i + 0.5) * h / n, z + s * 0.03, rot=(rot[0] + 0.5 * s, rot[1], rot[2]), bev=0.004, name='ventSlat')
    else:
      self.box(parent, 'dark', 0.05, h, w, x, y, z, rot=rot, name='vent')
      for i in range(n):
        self.box(parent, 'dark2', 0.03, h / n * 0.45, w * 0.86, x + s * 0.03, y - h / 2 + (i + 0.5) * h / n, z, rot=(rot[0], rot[1], rot[2] - 0.5 * s), bev=0.004, name='ventSlat')
  def light(self, parent, x, y, z, w, h, d=0.02, rot=(0, 0, 0)):
    return self.box(parent, 'cyan', w, h, d, x, y, z, rot=rot, bev=0, name='light')


def greebles(col, mats):
  K = Kit(col, mats)
  # Head: twin swept antennas with red tips, a crown sensor and rear cable plugs
  for s in (-1, 1):
    K.rod('PX09 head', 'metal', (s * 0.26, 1.06, -0.36), (s * 0.4, 1.52, -0.78), 0.018)
    K.rod('PX09 head', 'red', (s * 0.4, 1.52, -0.78), (s * 0.43, 1.62, -0.86), 0.02)
    K.box('PX09 head', 'dark2', 0.08, 0.06, 0.16, s * 0.26, 1.08, -0.34, name='antennaFoot')
    K.cyl('PX09 head', 'metal', 0.04, 0.06, s * 0.2, 0.62, -0.67, axis='z', name='plug')
  K.box('PX09 head', 'dark', 0.22, 0.06, 0.26, 0, 1.1, -0.05, name='crown')
  K.light('PX09 head', 0, 1.135, 0.06, 0.12, 0.02, 0.05)
  # Chest: vents under the pecs, collar lights, armpit rams, back tanks and cable runs
  for s in (-1, 1):
    K.vent('PX09 chest', s * 0.58, 0.32, 0.64, 0.26, 0.2, n=3, rot=(0, s * 0.38, 0))
    K.light('PX09 chest', s * 0.22, 1.2, 0.6, 0.12, 0.025, rot=(-0.35, 0, 0))
    K.ram('PX09 chest', (s * 0.84, 0.06, 0.04), (s * 0.94, 0.86, 0.1), 0.045)
    K.cyl('PX09 chest', 'metal', 0.09, 0.56, s * 0.22, 0.62, -0.78, name='tank')
    K.cyl('PX09 chest', 'red', 0.095, 0.05, s * 0.22, 0.76, -0.78, name='tankBand')
    K.cyl('PX09 chest', 'dark2', 0.1, 0.06, s * 0.22, 0.33, -0.78, name='tankCap')
    K.rod('PX09 chest', 'dark2', (s * 0.22, 0.32, -0.8), (s * 0.4, 0.05, -0.66), 0.025, name='cable')
  # Waist: a bolted belt and side lights
  for s in (-1, 1):
    K.light('PX09 waist', s * 0.42, 0.3, 0.24, 0.02, 0.18, 0.05)
  # Pelvis / codpiece: hip vents, a red stripe
  for s in (-1, 1):
    K.vent('PX09 pelvis', s * 0.52, -0.02, 0.0, 0.3, 0.22, n=3, facing='x', s=s)
  # Thighs: a ram up the inside back, a vent and a light on the outer face
  for s in (-1, 1):
    t = f'PX09 thigh {s}'
    K.ram(t, (-s * 0.14, -0.35, -0.5), (-s * 0.12, -1.9, -0.46), 0.055)
    K.vent(t, s * 0.68, -1.05, 0.12, 0.34, 0.24, n=3, facing='x', s=s)
    K.light(t, s * 0.62, -0.55, 0.4, 0.02, 0.22, 0.05)
    K.box(t, 'dark2', 0.5, 0.1, 0.16, 0, -2.18, 0.48, name='kneeBand')
  # Shins: calf rams, a light strip down the front and an ankle guard
  for s in (-1, 1):
    t = f'PX09 shin {s}'
    for sd in (-1, 1): K.ram(t, (sd * 0.2, -0.45, -0.46), (sd * 0.18, -1.55, -0.5), 0.045)
    K.light(t, s * 0.16, -1.65, 0.56, 0.03, 0.5, 0.03)
    K.vent(t, s * 0.56, -1.0, 0.0, 0.3, 0.3, n=4, facing='x', s=s)
    K.box(t, 'dark2', 0.5, 0.12, 0.6, 0, -2.86, 0.02, name='ankleGuard')
  # Boots: toe vents and heel spurs
  for s in (-1, 1):
    t = f'PX09 boot {s}'
    K.vent(t, 0, -0.62, 0.62, 0.36, 0.14, n=3, rot=(0.72, 0, 0))
    K.light(t, 0, -0.32, 0.43, 0.2, 0.025, rot=(0.25, 0, 0))
  # Forearms: a weapon-port box with lights and a ram over the elbow
  for s in (-1, 1):
    t = f'PX09 forearm {s}'
    K.box(t, 'dark2', 0.14, 0.42, 0.2, -s * 0.28, -0.6, 0.02, name='port')
    for i in range(3): K.light(t, -s * 0.35, -0.47 - i * 0.12, 0.02, 0.012, 0.05, 0.08)
    K.ram(t, (0, 0.02, -0.3), (0, -0.62, -0.34), 0.04)
  # Upper arms: armor bands
  for s in (-1, 1):
    t = f'PX09 upper arm {s}'
    for y in (-0.4, -0.85): K.box(t, 'dark2', 0.54, 0.07, 0.56, 0, y, 0, name='armBand')
  # Pauldrons: vents under the blade and a bolted rim
  for s in (-1, 1):
    t = f'PX09 pauldron {s}'
    K.vent(t, s * 0.36, -0.08, 0.0, 0.34, 0.2, n=3, facing='x', s=s)
    K.light(t, s * 0.05, 0.36, 0.38, 0.2, 0.025)
  # Thruster housings: exhaust shrouds
  for s in (-1, 1):
    K.cyl('PX09 thruster housings', 'dark2', 0.2, 0.12, s * 0.34, -1.0, -0.36, name='shroud')
  return K.n


def export(col):
  # Only the armor groups and the joints above them; nothing the game builds itself
  keep = set()
  for o in col.objects:
    if o.name.startswith('PX09 '):
      for d in [o] + list(o.children_recursive): keep.add(d)
      p = o.parent
      while p: keep.add(p); p = p.parent
  bpy.ops.object.select_all(action='DESELECT')
  for o in keep: o.hide_set(False); o.select_set(True)
  bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
    export_materials='EXPORT', export_image_format='NONE', export_animations=False, export_cameras=False, export_lights=False)
  return len(keep)


def run(do_export=True):
  col = reimport()
  mats = {m.name: m for m in bpy.data.materials if m.name in ('white', 'grey', 'dark', 'dark2', 'metal', 'red', 'cyan', 'decal')}
  mats['seam'] = material('seam', (0.36, 0.38, 0.42), 0.5, 0.35)
  for k, rgb in (('metal', (0.55, 0.57, 0.6)), ('red', (0.75, 0.08, 0.1)), ('cyan', (0.25, 0.9, 1.0))):
    if k not in mats: mats[k] = material(k, rgb)
  chamfer(col)
  lines = line_work(col, mats['seam'], mats['metal'])
  g = greebles(col, mats)
  tris = 0
  bpy.context.view_layer.update()
  dg = bpy.context.evaluated_depsgraph_get()
  for o in col.objects:
    if o.type == 'MESH':
      me = o.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); tris += len(me.loop_triangles); o.evaluated_get(dg).to_mesh_clear()
  n = export(col) if do_export else 0
  return {'line_objects': lines, 'greebles': g, 'tris': tris, 'exported_nodes': n, 'out': OUT if do_export else None}

if __name__ == '__main__' or globals().get('RUN'):
  print(run(globals().get('EXPORT', True)))
