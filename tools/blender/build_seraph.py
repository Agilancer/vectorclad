"""AV-09 Seraph: a medium-poly VECTORCLAD mech built entirely from this script.

Run with Blender 4.2+ (or the `bpy` module from PyPI):

    blender --background --python tools/blender/build_seraph.py -- [--no-render]
    python tools/blender/build_seraph.py [--no-render]

Writes assets/seraph-frame/seraph.blend, seraph.glb and the preview renders in
assets/seraph-frame/renders/. Blender units are game units (+Z up, front is -Y,
which the glTF exporter turns into the game's +Y up and +Z forward).

The model is rigid: every armour piece is joined into one mesh per bone and
parented to that bone, so posing the armature poses the mech. The two binder
thrusters on the back hang from a mount bone (splay), a binder bone (pitch) and
a nozzle bone (gimbal); their exhaust plumes scale with a plume bone.
"""
import math
import os
import sys

import bpy  # noqa: I001  (bpy must load before bmesh as a module)
import bmesh
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'seraph-frame')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
RENDER = '--no-render' not in ARGS
QUICK = '--quick' in ARGS  # reference render only, for iterating on the shapes

V = Vector
SIDES = (('L', 1), ('R', -1))  # facing -Y, the mech's left is +X

# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


def material(name, hex_, rough=0.5, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes['Principled BSDF'] if m.node_tree else None
    if bsdf is None:
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = srgb(hex_)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = srgb(emit)
        bsdf.inputs['Emission Strength'].default_value = strength
    m.diffuse_color = srgb(hex_)
    return m


def make_materials():
    return {
        'white': material('Seraph_White', '#e9eaec', 0.38),
        'grey': material('Seraph_Grey', '#a3a7ae', 0.45),
        'dark': material('Seraph_Frame', '#3a3d44', 0.42, 0.55),
        'black': material('Seraph_Black', '#1d1e22', 0.4, 0.3),
        'metal': material('Seraph_Joint', '#5d6168', 0.3, 0.85),
        'red': material('Seraph_Red', '#c52b2c', 0.42),
        'glow': material('Seraph_Glow', '#58d8ff', 0.3, 0, '#58d8ff', 8.0),
        'plume': material('Seraph_Plume', '#9fe9ff', 0.3, 0, '#7fd4ff', 14.0),
        'decal': material('Seraph_Decal', '#26282d', 0.5),
        'decal_light': material('Seraph_DecalLight', '#c9ccd2', 0.45),
    }

# ---------------------------------------------------------------------------
# Geometry helpers (bmesh). Every part is a closed shell.
# ---------------------------------------------------------------------------

def secb(z, x0, x1, y0, y1, c=0.25, ridge=0.0):
    """Chamfered rectangle ring at height z (front is y0, the -Y side).
    ridge pushes a vertex out of the front face to make a keel line."""
    c = c * min(x1 - x0, y1 - y0) / 2
    xm = (x0 + x1) / 2
    return [V(p) for p in (
        (xm, y0 - ridge, z), (x1 - c, y0, z), (x1, y0 + c, z), (x1, y1 - c, z), (x1 - c, y1, z),
        (x0 + c, y1, z), (x0, y1 - c, z), (x0, y0 + c, z), (x0 + c, y0, z))]


def loft(sections, axis_map=None):
    """Join rings of equal vertex count into a closed shell."""
    bm = bmesh.new()
    rings = [[bm.verts.new(axis_map(p) if axis_map else p) for p in s] for s in sections]
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    caps = [bm.faces.new(list(reversed(rings[0]))), bm.faces.new(rings[-1])]
    if n > 4:  # beauty-fill the caps so collinear outline points never make slivers
        bmesh.ops.triangulate(bm, faces=caps, quad_method='BEAUTY', ngon_method='BEAUTY')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def yloft(sections):
    """Loft along Y: sections given as secb(...) in an (x, z) plane, with the
    ring's 'z' read as y and its 'y' read as z."""
    return loft(sections, lambda p: V((p.x, p.z, p.y)))


def xloft(sections):
    """Loft along X: secb rings read as (y, z, x) -> rings in the YZ plane."""
    return loft(sections, lambda p: V((p.z, p.x, p.y)))


def prism(profile, a, b, axis='y'):
    """Extrude a 2D outline between a and b along an axis. The outline's
    coordinates map to the other two axes in xyz order."""
    def to3(u, v, w):
        return {'x': V((w, u, v)), 'y': V((u, w, v)), 'z': V((u, v, w))}[axis]
    return loft([[to3(u, v, a) for u, v in profile], [to3(u, v, b) for u, v in profile]])


def box(center, size):
    x, y, z = center
    sx, sy, sz = (s / 2 for s in size)
    ring = lambda zz: [V((x - sx, y - sy, zz)), V((x + sx, y - sy, zz)), V((x + sx, y + sy, zz)), V((x - sx, y + sy, zz))]
    return loft([ring(z - sz), ring(z + sz)])


def cyl(r, a, b, segs=12, axis='z', r2=None):
    """Cylinder (or cone when r2 is given) between a and b along an axis."""
    ring = lambda rr: [(rr * math.cos(2 * math.pi * i / segs), rr * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    def to3(u, v, w):
        return {'x': V((w, u, v)), 'y': V((u, w, v)), 'z': V((u, v, w))}[axis]
    return loft([[to3(u, v, a) for u, v in ring(r)], [to3(u, v, b) for u, v in ring(r if r2 is None else r2)]])


def lathe(profile, segs=12):
    """Revolve (radius, z) pairs about Z. Inner rings make a hollow bell."""
    return loft([[V((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z))
                  for i in range(segs)] for r, z in profile])


def tube(points, r, sides=6):
    """A cable swept along a polyline."""
    pts = [V(p) for p in points]
    secs = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        up = V((0, 0, 1)) if abs(t.z) < 0.9 else V((1, 0, 0))
        u = t.cross(up).normalized()
        w = t.cross(u).normalized()
        secs.append([p + r * (math.cos(2 * math.pi * k / sides) * u + math.sin(2 * math.pi * k / sides) * w)
                     for k in range(sides)])
    return loft(secs)


def blade(length, width, thick, tip=0.6, root=1.0):
    """A pointed leaf in the local XY plane, pointing +X, extruded along Z."""
    L, w = length, width / 2
    prof = [(0, -w * root), (L * tip, -w), (L, 0), (L * tip * 0.92, w), (0, w * root * 0.7)]
    return prism(prof, -thick / 2, thick / 2, 'z')


def basis(origin, x_dir, normal):
    """Matrix taking local +X to x_dir and local +Z to (orthogonalised) normal."""
    x = V(x_dir).normalized()
    y = V(normal).cross(x).normalized()
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = V(origin)
    return m


def limb_frame(head, tail):
    """Origin at a joint, local -Z running down the bone."""
    d = V(tail) - V(head)
    m = V((0, 0, -1)).rotation_difference(d).to_matrix().to_4x4()
    m.translation = V(head)
    return m


def bevel(bm, offset, angle=0.55, segs=1):
    """Chamfer edges sharper than `angle` so they catch a highlight line."""
    edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle(0) > angle]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=segs, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    return bm


def mirror_x(bm):
    bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def text_mesh(body, size, depth=0.012):
    """A text decal lying in XZ (facing -Y) centred on the origin."""
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.resolution_u = 2
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.dissolve_limit(bm, angle_limit=0.02, verts=bm.verts, edges=bm.edges)
    return bm

# ---------------------------------------------------------------------------
# Part registry: parts accumulate per bone and are joined at the end
# ---------------------------------------------------------------------------

PARTS = {}


def add(bone, bm, mat, m=None, bev=None, angle=0.55):
    if bev:
        bevel(bm, bev, angle, 2 if bev >= 0.03 else 1)
    if m is not None:
        bm.transform(m)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for e in bm.edges:
        e.smooth = not (e.is_manifold and e.calc_face_angle(0) > 0.6)
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(bone)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(bone, me)
    bpy.context.scene.collection.objects.link(ob)
    PARTS.setdefault(bone, []).append(ob)
    return ob

# ---------------------------------------------------------------------------
# Skeleton (rest pose, world coordinates)
# ---------------------------------------------------------------------------

def joints(s):
    sh = V((s * 1.42, 0.06, 7.5))
    el = sh + V((s * 0.24, 0.02, -1.14))
    wr = el + V((s * 0.07, -0.3, -1.12))
    hip = V((s * 0.6, 0.02, 5.08))
    knee = V((s * 0.62, -0.02, 3.0))
    ankle = V((s * 0.64, 0.02, 0.62))
    pivot = V((s * 1.18, 1.18, 7.45))
    up = V((-s * 0.24, -0.08, 1)).normalized()
    return dict(sh=sh, el=el, wr=wr, hip=hip, knee=knee, ankle=ankle, pivot=pivot, up=up)


def bone_table():
    t = [
        ('root', (0, 0, 0), (0, 0, 1), None),
        ('pelvis', (0, 0.02, 5.08), (0, 0.02, 5.62), 'root'),
        ('spine', (0, 0.02, 5.62), (0, 0.02, 6.4), 'pelvis'),
        ('chest', (0, 0.02, 6.4), (0, 0.02, 7.75), 'spine'),
        ('neck', (0, 0.0, 7.75), (0, -0.05, 8.18), 'chest'),
        ('head', (0, -0.05, 8.18), (0, -0.05, 8.75), 'neck'),
    ]
    for n, s in SIDES:
        j = joints(s)
        nz = j['pivot'] + j['up'] * 1.75 + V((0, 0.4, 0))
        t += [
            (f'upper_arm.{n}', j['sh'], j['el'], 'chest'),
            (f'forearm.{n}', j['el'], j['wr'], f'upper_arm.{n}'),
            (f'hand.{n}', j['wr'], j['wr'] + V((0, -0.05, -0.42)), f'forearm.{n}'),
            (f'thigh.{n}', j['hip'], j['knee'], 'pelvis'),
            (f'shin.{n}', j['knee'], j['ankle'], f'thigh.{n}'),
            (f'foot.{n}', j['ankle'], j['ankle'] + V((0, -0.85, -0.45)), f'shin.{n}'),
            (f'binder_mount.{n}', j['pivot'], j['pivot'] + V((s * 0.45, 0, 0)), 'chest'),
            (f'binder.{n}', j['pivot'], j['pivot'] + j['up'] * 1.2, f'binder_mount.{n}'),
            (f'nozzle.{n}', nz, nz + V((0, 0.4, 0)), f'binder.{n}'),
            (f'plume.{n}', nz + V((0, 0.42, 0)), nz + V((0, 1.4, 0)), f'nozzle.{n}'),
        ]
    return t

# ---------------------------------------------------------------------------
# Armour
# ---------------------------------------------------------------------------

def build_torso(M):
    # Pelvis block and crotch
    add('pelvis', loft([secb(4.86, -0.34, 0.34, -0.28, 0.3), secb(5.2, -0.62, 0.62, -0.42, 0.42),
                        secb(5.66, -0.55, 0.55, -0.38, 0.4)]), M['dark'], bev=0.03)
    add('pelvis', prism([(-0.34, 5.62), (0.34, 5.62), (0.27, 5.12), (0, 4.72), (-0.27, 5.12)], -0.52, -0.22),
        M['white'], bev=0.035)
    add('pelvis', prism([(-0.06, 5.42), (0.06, 5.42), (0.04, 5.2), (-0.04, 5.2)], -0.54, -0.5), M['red'])
    add('pelvis', prism([(-0.22, 5.4), (0.22, 5.4), (0.0, 4.95)], -0.535, -0.5), M['dark'], bev=0.01)
    # Rear skirt
    add('pelvis', prism([(-0.5, 5.6), (0.5, 5.6), (0.42, 5.0), (0, 4.82), (-0.42, 5.0)], 0.3, 0.5),
        M['dark'], bev=0.03)
    for n, s in SIDES:
        # Front hip plates with vent stripes
        hp = prism([(0.32, 5.74), (0.98, 5.7), (1.08, 5.2), (0.7, 4.88), (0.36, 5.2)], -0.5, -0.3)
        hp.transform(Matrix.Rotation(math.radians(24), 4, 'Z'))
        hp.transform(Matrix.Translation((0.7, -0.4, 5.6)) @ Matrix.Rotation(math.radians(-12), 4, 'X')
                     @ Matrix.Translation((-0.7, 0.4, -5.6)))
        if s < 0:
            mirror_x(hp)
        add('pelvis', hp, M['white'], bev=0.03)
        for k in range(3):
            v = box((0, 0, 0), (0.24, 0.03, 0.035))
            m = Matrix.Translation((s * 0.72, -0.37, 5.52 - k * 0.08)) @ Matrix.Rotation(math.radians(24 * s), 4, 'Z')
            m = Matrix.Translation(V((0, -0.025 - 0.5 + 0.37, 0))) @ m
            add('pelvis', v, M['dark'], m)
        # Side armour over the hip joint
        sa = prism([(-0.4, 5.78), (0.38, 5.78), (0.44, 5.2), (0.02, 4.92), (-0.42, 5.18)], 0.92, 1.08, 'x')
        if s < 0:
            mirror_x(sa)
        add('pelvis', sa, M['grey'], bev=0.03)
        add('pelvis', prism([(-0.2, 5.6), (0.15, 5.6), (0.1, 5.5), (-0.2, 5.5)], 1.08, 1.1, 'x') if s > 0
            else prism([(-0.2, 5.6), (0.15, 5.6), (0.1, 5.5), (-0.2, 5.5)], -1.1, -1.08, 'x'), M['red'])

    # Abdomen: stacked ribbed rings and side pistons
    for i, z in enumerate((5.66, 5.86, 6.06, 6.26)):
        w = 0.32 + i * 0.03
        add('spine', loft([secb(z, -w, w, -0.3, 0.32, 0.4), secb(z + 0.1, -w - 0.06, w + 0.06, -0.36, 0.36, 0.4),
                           secb(z + 0.18, -w, w, -0.3, 0.32, 0.4)]), M['dark'], bev=0.015)
    for n, s in SIDES:
        add('spine', cyl(0.05, 5.62, 6.45, 6), M['metal'], Matrix.Translation((s * 0.36, 0.05, 0)))
    add('spine', cyl(0.13, 5.6, 6.5, 8), M['black'], Matrix.Translation((0, 0.05, 0)))

    # Chest core
    add('chest', loft([secb(6.38, -0.46, 0.46, -0.34, 0.4), secb(6.9, -0.74, 0.74, -0.48, 0.5),
                       secb(7.45, -0.94, 0.94, -0.46, 0.55), secb(7.86, -0.58, 0.58, -0.3, 0.45)]),
        M['dark'], bev=0.03)
    # Under-plates (dark V keel) and cyan core
    add('chest', prism([(-0.36, 7.25), (0.36, 7.25), (0.0, 6.55)], -0.53, -0.4), M['black'], bev=0.02)
    add('chest', prism([(0, 7.02), (0.1, 6.86), (0, 6.68), (-0.1, 6.86)], -0.58, -0.5), M['glow'], bev=0.012)
    for n, s in SIDES:
        def side(prof, a, b, ang, pivot_x, mat, bev=0.03, axis='y'):
            bm = prism(prof, a, b, axis)
            r = Matrix.Translation((pivot_x, (a + b) / 2, 0)) @ Matrix.Rotation(math.radians(ang), 4, 'Z') \
                @ Matrix.Translation((-pivot_x, -(a + b) / 2, 0))
            bm.transform(r)
            if s < 0:
                mirror_x(bm)
            add('chest', bm, mat, bev=bev)
        # Pectoral plates: wide, pointed outward and down to the centre
        side([(0.06, 7.72), (0.66, 7.86), (1.06, 7.46), (0.9, 7.04), (0.42, 6.78), (0.08, 6.98)], -0.62, -0.36, 22,
             0.06, M['white'], 0.045)
        # Lower flank blades sweeping to the waist
        side([(0.46, 6.98), (0.86, 6.92), (0.64, 6.12), (0.44, 6.4)], -0.44, -0.22, 32, 0.46, M['white'])
        side([(0.5, 6.85), (0.6, 6.84), (0.54, 6.55)], -0.475, -0.44, 32, 0.46, M['red'], 0.005)
        # Collar
        side([(0.14, 7.72), (0.56, 7.8), (0.5, 8.06), (0.2, 7.96)], -0.36, 0.22, 0, 0.14, M['white'])
        # Cyan side lights
        side([(0.66, 7.28), (0.74, 7.3), (0.72, 7.2), (0.64, 7.18)], -0.66, -0.6, 22, 0.06, M['glow'], 0.0)
        # Backpack binder mount arm
        j = joints(s)
        add('chest', tube([(s * 0.38, 0.8, 7.42), (s * 0.66, 1.05, 7.48), j['pivot'] + V((-s * 0.18, 0, 0))], 0.11, 6),
            M['dark'])
    # Backpack
    add('chest', loft([secb(6.55, -0.5, 0.5, 0.38, 0.74), secb(7.2, -0.66, 0.66, 0.42, 1.0),
                       secb(7.72, -0.62, 0.62, 0.42, 0.96), secb(7.95, -0.42, 0.42, 0.38, 0.7)]), M['black'], bev=0.03)
    add('chest', loft([secb(7.3, -0.5, 0.5, 0.6, 1.06), secb(7.8, -0.44, 0.44, 0.58, 1.0)]), M['grey'], bev=0.03)
    for k in range(4):
        add('chest', box((0, 1.0, 6.75 + k * 0.1), (0.62, 0.05, 0.04)), M['dark'])
    # Backpack verniers pointing down
    for x in (-0.32, 0.32):
        add('chest', cyl(0.11, 6.62, 6.5, 10, 'z', 0.14), M['metal'], Matrix.Translation((x, 0.62, 0)))
        add('chest', cyl(0.09, 6.5, 6.49, 10), M['glow'], Matrix.Translation((x, 0.62, 0)))

    # Neck and cables
    add('neck', cyl(0.15, 7.72, 8.2, 8), M['dark'], Matrix.Translation((0, -0.02, 0)))
    for k in range(3):
        add('neck', cyl(0.18 - k * 0.01, 7.8 + k * 0.12, 7.86 + k * 0.12, 8), M['metal'],
            Matrix.Translation((0, -0.02, 0)))
    for s in (1, -1):
        add('neck', tube([(s * 0.25, 0.15, 7.78), (s * 0.2, 0.05, 7.98), (s * 0.1, -0.05, 8.16)], 0.035, 5),
            M['black'])


def build_head(M):
    # Dark skull with the face
    add('head', loft([secb(8.14, -0.15, 0.15, -0.22, 0.12, 0.4), secb(8.36, -0.2, 0.2, -0.29, 0.18, 0.4),
                      secb(8.58, -0.16, 0.16, -0.2, 0.15, 0.4)]), M['dark'], bev=0.012)
    # Helmet: open-faced shell with a pointed brow
    add('head', loft([secb(8.34, -0.225, 0.225, -0.04, 0.27), secb(8.48, -0.235, 0.235, -0.27, 0.3, 0.3, 0.06),
                      secb(8.63, -0.18, 0.18, -0.26, 0.24, 0.3, 0.05), secb(8.73, -0.07, 0.07, -0.13, 0.14)]),
        M['white'], bev=0.012)
    # Visor: a V of light
    add('head', prism([(-0.16, 8.47), (0, 8.4), (0.16, 8.47), (0.16, 8.43), (0, 8.36), (-0.16, 8.43)],
                      -0.31, -0.26), M['glow'])
    # Faceplate and chin
    add('head', prism([(-0.13, 8.36), (0.13, 8.36), (0.07, 8.24), (0, 8.13), (-0.07, 8.24)], -0.31, -0.12),
        M['white'], bev=0.01)
    add('head', prism([(-0.05, 8.3), (0.05, 8.3), (0, 8.2)], -0.32, -0.3), M['red'])
    for n, s in SIDES:
        # V antenna blades, swept up and out from the brow
        b = blade(0.78, 0.15, 0.035, 0.5)
        add('head', b, M['white'], basis((s * 0.03, -0.27, 8.56), (s * 0.55, -0.2, 0.85), (0, -1, 0.1)), bev=0.008)
        # Long swept crest fins along the helmet sides
        b = blade(0.85, 0.2, 0.04, 0.45)
        add('head', b, M['white'], basis((s * 0.19, -0.12, 8.6), (s * 0.18, 0.8, 0.42), (s, 0, 0.2)), bev=0.008)
        b = blade(0.55, 0.14, 0.04, 0.5)
        add('head', b, M['grey'], basis((s * 0.22, -0.02, 8.48), (s * 0.15, 0.85, 0.2), (s, 0, 0.1)), bev=0.008)
        # Ear sensors
        add('head', cyl(0.08, 0, 0.07, 8, 'x'), M['metal'], Matrix.Translation((s * 0.21 if s > 0 else -0.28, 0, 8.38)))
        add('head', cyl(0.035, 0, 0.02, 6, 'x'), M['glow'], Matrix.Translation((s * 0.28 if s > 0 else -0.3, 0, 8.38)))
    # Centre crest blade pointing forward
    add('head', blade(0.5, 0.12, 0.05, 0.4), M['white'], basis((0, -0.05, 8.72), (0, -0.85, 0.5), (1, 0, 0)),
        bev=0.008)


def build_arm(M, n, s):
    j = joints(s)
    ua, fa = f'upper_arm.{n}', f'forearm.{n}'
    U = limb_frame(j['sh'], j['el'])
    F = limb_frame(j['el'], j['wr'])
    H = limb_frame(j['wr'], j['wr'] + V((0, -0.05, -0.42)))
    sx = lambda bm: mirror_x(bm) if s < 0 else bm

    # Shoulder ball and cowl
    sph = lathe([(0.001, -0.33), (0.2, -0.27), (0.31, -0.12), (0.33, 0.05), (0.27, 0.2), (0.15, 0.3), (0.001, 0.33)], 10)
    add(ua, sph, M['dark'], U)
    cowl = xloft([secb(-0.3, -0.4, 0.4, -0.18, 0.36, 0.35), secb(0.0, -0.5, 0.5, -0.3, 0.52, 0.35, 0.08),
                  secb(0.34, -0.48, 0.48, -0.42, 0.46, 0.35, 0.08), secb(0.54, -0.34, 0.34, -0.36, 0.24, 0.35)])
    add(ua, sx(cowl), M['white'], Matrix.Translation(j['sh']), bev=0.04)
    add(ua, sx(xloft([secb(0.5, -0.3, 0.3, -0.42, -0.1), secb(0.62, -0.26, 0.26, -0.38, -0.12)])), M['grey'],
        Matrix.Translation(j['sh']), bev=0.015)
    # Front flap angled down over the upper arm
    flap = (s * 0.3, -0.45, -0.85)
    add(ua, blade(0.95, 0.46, 0.08, 0.5), M['white'], basis(j['sh'] + V((s * 0.22, -0.42, 0.25)), flap,
                                                             (s * 0.5, -1, 0.1)), bev=0.025)
    # Layered feather blades swept up and back, like folded wings
    for k, (L, w, up, back, out, mat) in enumerate((
            (1.8, 0.5, 0.92, 0.42, 0.22, M['white']), (1.5, 0.44, 0.8, 0.55, 0.38, M['white']),
            (1.2, 0.38, 0.62, 0.7, 0.52, M['grey']), (0.9, 0.32, 0.4, 0.8, 0.68, M['white']))):
        o = j['sh'] + V((s * (0.12 + k * 0.13), 0.02 + k * 0.12, 0.42 - k * 0.1))
        fr = basis(o, (s * out, back, up), (s * 0.85, -0.3, 0.2))
        add(ua, blade(L, w, 0.08, 0.55), mat, fr, bev=0.025)
        add(ua, box((L * 0.45, 0, 0.042), (0.16, 0.035, 0.012)), M['red'], fr)
    # Hanging straps from the shoulder
    add(ua, tube([j['sh'] + V((s * 0.25, 0.3, 0.2)), j['sh'] + V((s * 0.55, 0.65, -0.3)),
                  j['sh'] + V((s * 0.75, 0.75, -1.1)), j['sh'] + V((s * 0.7, 0.6, -1.7))], 0.03, 4), M['black'])

    # Upper arm
    add(ua, cyl(0.17, -0.25, -1.12, 8), M['dark'], U)
    up = loft([secb(-0.3, -0.22, 0.26, -0.24, 0.22), secb(-0.6, -0.24, 0.29, -0.26, 0.24),
               secb(-0.92, -0.2, 0.24, -0.22, 0.2)])
    add(ua, sx(up), M['white'], U, bev=0.025)
    add(ua, sx(box((0.27, 0, -0.62), (0.06, 0.3, 0.2))), M['grey'], U, bev=0.01)

    # Elbow, spike and forearm
    add(fa, cyl(0.2, -0.24, 0.24, 10, 'x'), M['metal'], F)
    sp = blade(1.15, 0.4, 0.08, 0.5)
    add(fa, sp, M['white'], F @ basis((s * 0.16, 0.14, 0.02), (s * 0.62, 0.55, 0.62), (s, -0.3, -0.3)), bev=0.02)
    add(fa, box((0.55, 0, 0.042), (0.18, 0.035, 0.012)), M['red'],
        F @ basis((s * 0.16, 0.14, 0.02), (s * 0.62, 0.55, 0.62), (s, -0.3, -0.3)))
    fl = loft([secb(0.08, -0.22, 0.24, -0.2, 0.4, 0.3), secb(-0.32, -0.27, 0.31, -0.3, 0.34, 0.3, 0.05),
               secb(-0.86, -0.24, 0.26, -0.26, 0.22, 0.3, 0.04), secb(-1.08, -0.2, 0.21, -0.2, 0.18)])
    add(fa, sx(fl), M['white'], F, bev=0.025)
    add(fa, sx(prism([(-0.15, -0.5), (0.1, -0.45), (0.05, -0.82), (-0.12, -0.85)], 0.24, 0.32, 'x')), M['grey'], F,
        bev=0.01)
    add(fa, sx(box((0.05, -0.33, -0.55), (0.04, 0.03, 0.24))), M['red'], F)
    add(fa, loft([secb(-1.04, -0.19, 0.19, -0.19, 0.17), secb(-1.24, -0.17, 0.17, -0.17, 0.15)]), M['dark'], F,
        bev=0.015)

    # Fist: palm, curled fingers, thumb
    h = f'hand.{n}'
    add(h, box((0, 0, -0.17), (0.2, 0.3, 0.32)), M['dark'], H, bev=0.025)
    for i in range(4):
        y = -0.11 + i * 0.075
        add(h, box((-s * 0.02, y, -0.36), (0.18, 0.065, 0.1)), M['dark'], H, bev=0.012)
        add(h, box((-s * 0.12, y, -0.28), (0.07, 0.065, 0.16)), M['black'], H, bev=0.012)
    add(h, box((-s * 0.06, -0.19, -0.18), (0.12, 0.08, 0.2)), M['black'], H, bev=0.012)
    add(h, box((s * 0.105, 0, -0.14), (0.03, 0.24, 0.2)), M['white'], H, bev=0.01)


def build_leg(M, n, s):
    j = joints(s)
    T = limb_frame(j['hip'], j['knee'])
    S = limb_frame(j['knee'], j['ankle'])
    A = limb_frame(j['ankle'], j['ankle'] + V((0, 0, -1)))
    th, sh, ft = f'thigh.{n}', f'shin.{n}', f'foot.{n}'
    sx = lambda bm: mirror_x(bm) if s < 0 else bm

    # Thigh
    add(th, cyl(0.3, -0.26, 0.26, 10, 'x'), M['metal'], T)
    add(th, loft([secb(0.12, -0.3, 0.3, -0.3, 0.32), secb(-1.0, -0.33, 0.33, -0.32, 0.34),
                  secb(-1.95, -0.26, 0.26, -0.26, 0.28)]), M['dark'], T, bev=0.02)
    tp = loft([secb(0.14, -0.26, 0.46, -0.5, 0.1, 0.45), secb(-0.2, -0.3, 0.56, -0.58, 0.2, 0.45),
               secb(-0.75, -0.32, 0.6, -0.58, 0.24, 0.45), secb(-1.25, -0.3, 0.54, -0.55, 0.2, 0.45),
               secb(-1.62, -0.22, 0.4, -0.47, 0.12, 0.45), secb(-1.86, -0.1, 0.2, -0.36, 0.0, 0.45)])
    add(th, sx(tp), M['white'], T, bev=0.035)
    og = loft([secb(-0.7, 0.3, 0.64, -0.4, 0.36, 0.4), secb(-1.2, 0.3, 0.66, -0.38, 0.4, 0.4),
               secb(-1.8, 0.2, 0.5, -0.3, 0.32, 0.4)])
    add(th, sx(og), M['grey'], T, bev=0.03)
    add(th, sx(box((0.66, -0.15, -1.2), (0.03, 0.05, 0.22))), M['red'], T)
    for x in (-0.13, 0.13):
        add(th, cyl(0.065, -0.25, -1.7, 6), M['metal'], T @ Matrix.Translation((x, 0.38, 0)))
        add(th, cyl(0.1, -0.2, -0.75, 6), M['dark'], T @ Matrix.Translation((x, 0.38, 0)))
    # Thigh marking "B" on the flat front facet
    add(th, text_mesh('B', 0.36), M['decal'], T @ Matrix.Translation((s * 0.17, -0.586, -0.48)))
    # Outer thigh ram and the hip-joint cover disc
    add(th, sx(tube([(0.5, 0.25, -0.15), (0.62, 0.3, -0.6), (0.6, 0.25, -0.75)], 0.06, 6)), M['metal'], T)
    add(th, sx(cyl(0.24, 0.3, 0.36, 10, 'x')), M['grey'], T, bev=0.015)
    add(th, sx(cyl(0.12, 0.36, 0.39, 8, 'x')), M['dark'], T)

    # Knee
    add(sh, cyl(0.26, -0.31, 0.31, 10, 'x'), M['metal'], S)
    kc = prism([(0.04, 0.36), (-0.34, 0.3), (-0.56, -0.04), (-0.38, -0.44), (-0.02, -0.32)], -0.31, 0.31, 'x')
    add(sh, kc, M['grey'], S, bev=0.03)
    add(sh, prism([(-0.4, 0.0), (-0.52, -0.05), (-0.4, -0.2)], -0.1, 0.1, 'x'), M['red'],
        S @ Matrix.Translation((0, -0.025, 0)))

    # Shin core, front plate and the big flared calf
    add(sh, loft([secb(0.0, -0.26, 0.26, -0.26, 0.26), secb(-1.2, -0.28, 0.28, -0.28, 0.28),
                  secb(-2.3, -0.2, 0.2, -0.2, 0.2)]), M['dark'], S, bev=0.02)
    add(sh, loft([secb(-0.3, -0.3, 0.3, -0.42, -0.04, 0.3, 0.07), secb(-1.2, -0.28, 0.28, -0.39, -0.04, 0.3, 0.07),
                  secb(-2.16, -0.24, 0.24, -0.37, -0.04, 0.3, 0.06)]), M['white'], S, bev=0.025)
    calf = loft([secb(-0.06, -0.36, 0.4, -0.2, 0.45, 0.45), secb(-0.5, -0.47, 0.53, -0.27, 0.92, 0.45),
                 secb(-1.1, -0.5, 0.57, -0.29, 1.04, 0.45), secb(-1.7, -0.43, 0.49, -0.27, 0.74, 0.45),
                 secb(-2.24, -0.3, 0.34, -0.2, 0.32, 0.45)])
    add(sh, sx(calf), M['grey'], S, bev=0.04)
    cap = loft([secb(-0.1, -0.4, 0.44, 0.08, 0.52, 0.45), secb(-0.48, -0.5, 0.56, 0.18, 0.98, 0.45),
                secb(-0.8, -0.5, 0.57, 0.24, 1.05, 0.45)])
    add(sh, sx(cap), M['white'], S, bev=0.035)
    # Round knee-side joint covers
    add(sh, sx(cyl(0.29, 0.3, 0.37, 12, 'x')), M['grey'], S, bev=0.015)
    add(sh, sx(cyl(0.17, 0.37, 0.41, 10, 'x')), M['dark'], S, bev=0.01)
    # Layered plates on the calf sides and a rear vent block
    for x0, x1, mat in ((0.55, 0.62, M['white']), (-0.55, -0.48, M['grey'])):
        pl = prism([(-0.2, -0.95), (0.78, -0.86), (1.0, -1.32), (0.6, -2.0), (-0.16, -2.1)], x0, x1, 'x')
        add(sh, sx(pl), mat, bev=0.02, m=S)
    add(sh, sx(prism([(0.1, -1.2), (0.5, -1.15), (0.5, -1.25), (0.1, -1.3)], 0.6, 0.64, 'x')), M['red'], S)
    for k in range(4):
        add(sh, box((0.03, 1.06, -1.0 - k * 0.1), (0.6, 0.04, 0.05)), M['dark'], S)
    add(sh, sx(tube([(0.3, 0.7, -0.4), (0.7, 0.6, -1.0), (0.66, 0.3, -1.9), (0.3, 0.1, -2.35)], 0.04, 5)),
        M['black'], S)

    # Ankle and foot (ground at local z = -0.62)
    add(ft, cyl(0.2, -0.24, 0.24, 8, 'x'), M['metal'], A)
    add(ft, loft([secb(0.18, -0.24, 0.24, -0.24, 0.24), secb(-0.24, -0.3, 0.3, -0.3, 0.3)]), M['dark'], A, bev=0.02)
    foot = yloft([secb(0.55, -0.24, 0.24, -0.62, -0.3), secb(0.2, -0.34, 0.34, -0.62, -0.04),
                  secb(-0.35, -0.34, 0.34, -0.62, -0.18), secb(-0.9, -0.24, 0.24, -0.62, -0.38),
                  secb(-1.35, -0.06, 0.06, -0.62, -0.55)])
    add(ft, foot, M['black'], A, bev=0.03)
    top = yloft([secb(-0.08, -0.28, 0.28, -0.24, -0.1), secb(-0.6, -0.25, 0.25, -0.34, -0.22),
                 secb(-1.02, -0.13, 0.13, -0.46, -0.38)])
    add(ft, top, M['grey'], A, bev=0.02)
    add(ft, prism([(0, -0.08), (0.2, 0), (0, 0.08)], -0.02, 0.02, 'z'), M['red'],
        A @ basis((0, -0.7, -0.255), (0, -1, -0.38), (0, -0.38, 1)))
    add(ft, prism([(0.3, -0.36), (0.78, -0.56), (0.36, -0.62)], -0.1, 0.1, 'x'), M['dark'], A, bev=0.015)
    for x in (-0.18, 0.18):
        add(ft, prism([(-0.6, -0.4), (-1.0, -0.6), (-0.7, -0.62), (-0.5, -0.5)], x - 0.05, x + 0.05, 'x'),
            M['dark'], A, bev=0.012)


def build_binder(M, n, s):
    """One flight binder: a long black blade with a thruster pod on top."""
    j = joints(s)
    up = j['up']
    x_axis = (V((1, 0, 0)) - up * up.x).normalized()
    # Binder frame: local Z along the binder, local X toward +X, local Y backward.
    # Parts are authored for the left binder and mirrored with sx for the right.
    Bm = Matrix.Translation(j['pivot']) @ Matrix((x_axis, up.cross(x_axis), up)).transposed().to_4x4()
    b, mnt = f'binder.{n}', f'binder_mount.{n}'
    sx = lambda bm: mirror_x(bm) if s < 0 else bm

    # Pivot hub and yoke
    add(mnt, cyl(0.26, -0.22, 0.22, 10, 'x'), M['metal'], Matrix.Translation(j['pivot']))
    add(mnt, cyl(0.14, -0.3, 0.3, 8, 'x'), M['dark'], Matrix.Translation(j['pivot']))

    # Main blade: long, pointed at the bottom, a keel on the back
    blade_ = loft([secb(-4.55, -0.03, 0.04, -0.05, 0.05), secb(-3.9, -0.3, 0.16, -0.12, 0.14),
                   secb(-1.2, -0.42, 0.36, -0.15, 0.18), secb(1.25, -0.42, 0.38, -0.15, 0.18),
                   secb(1.5, -0.36, 0.32, -0.13, 0.16)])
    add(b, sx(blade_), M['black'], Bm, bev=0.03)
    # Pale edge strip on the outer edge and the front face panel
    edge = loft([secb(-3.85, 0.13, 0.2, -0.08, 0.08), secb(-1.2, 0.36, 0.43, -0.1, 0.1),
                 secb(1.2, 0.38, 0.45, -0.1, 0.1)])
    add(b, sx(edge), M['grey'], Bm, bev=0.01)
    add(b, sx(box((-0.05, -0.16, 0.55), (0.56, 0.03, 1.0))), M['dark'], Bm, bev=0.012)
    add(b, sx(box((-0.22, -0.18, 0.75), (0.08, 0.02, 0.6))), M['white'], Bm)
    add(b, sx(box((0.12, -0.18, 0.95), (0.16, 0.02, 0.05))), M['red'], Bm)
    # Lettering and stripes down the front face
    add(b, text_mesh('AV', 0.3), M['decal_light'], Bm @ Matrix.Translation((-0.02 * s, -0.162, -0.62)))
    add(b, sx(box((-0.02, -0.165, -1.25), (0.05, 0.012, 0.42))), M['decal_light'], Bm)
    for k in range(3):
        add(b, sx(box((0.14, -0.165, -1.62 - k * 0.09), (0.12, 0.012, 0.04))), M['decal_light'], Bm)
    add(b, sx(box((-0.1, -0.165, -2.5), (0.05, 0.012, 1.0))), M['decal_light'], Bm)

    # Back face: a raised service panel, vent slats and a keel strip
    add(b, sx(box((-0.04, 0.19, -0.2), (0.48, 0.04, 2.4))), M['dark'], Bm, bev=0.012)
    for k in range(6):
        add(b, sx(box((-0.04, 0.215, 0.7 - k * 0.12), (0.36, 0.03, 0.05))), M['black'], Bm)
    add(b, sx(box((-0.04, 0.215, -1.0), (0.3, 0.03, 0.5))), M['grey'], Bm, bev=0.008)
    add(b, sx(box((0.0, 0.19, -2.6), (0.08, 0.04, 1.6))), M['grey'], Bm)

    # Thruster pod
    pod = loft([secb(1.3, -0.44, 0.42, -0.26, 0.34, 0.4), secb(1.8, -0.46, 0.44, -0.3, 0.4, 0.4),
                secb(2.2, -0.36, 0.32, -0.24, 0.32, 0.45), secb(2.36, -0.18, 0.15, -0.13, 0.17, 0.5)])
    add(b, sx(pod), M['dark'], Bm, bev=0.025)
    for k in range(4):
        add(b, sx(box((-0.01, -0.31, 1.48 + k * 0.14), (0.66, 0.05, 0.05))), M['black'], Bm)
    for x in (-0.28, 0.24):
        add(b, sx(box((x, 0.0, 2.15), (0.05, 0.48, 0.32))), M['black'], Bm)
    add(b, sx(box((0.43, 0, 1.75), (0.05, 0.4, 0.46))), M['grey'], Bm, bev=0.01)

    # Strap hanging from the pod
    add(b, sx(tube([(0.4, 0.2, 1.4), (0.75, 0.3, 0.4), (0.8, 0.25, -0.8), (0.6, 0.1, -1.6)], 0.035, 4)),
        M['black'], Bm)

    # Twin bell nozzles out of the pod's back, on the gimbal bone
    nz = f'nozzle.{n}'
    bell = lathe([(0.17, 0.0), (0.2, 0.08), (0.27, 0.3), (0.32, 0.46), (0.27, 0.46), (0.21, 0.3), (0.14, 0.12),
                  (0.1, 0.02)], 12)
    base = j['pivot'] + up * 1.75 + V((0, 0.4, 0))
    for dz in (-0.22, 0.22):
        o = base + up * dz
        add(nz, cyl(0.2, -0.12, 0.02, 10, 'y'), M['dark'], Matrix.Translation(o))
        b2 = bell.copy()
        b2.transform(Matrix.Rotation(-math.pi / 2, 4, 'X'))
        add(nz, b2, M['metal'], Matrix.Translation(o))
        add(nz, cyl(0.15, 0.1, 0.12, 10, 'y'), M['glow'], Matrix.Translation(o))
        # Exhaust plume (scaled to zero when the thruster is off)
        pl = lathe([(0.001, 1.6), (0.12, 1.1), (0.22, 0.55), (0.25, 0.3), (0.18, 0.0)], 8)
        pl.transform(Matrix.Rotation(-math.pi / 2, 4, 'X'))
        add(f'plume.{n}', pl, M['plume'], Matrix.Translation(o + V((0, 0.4, 0))))
    bell.free()

# ---------------------------------------------------------------------------
# Rig, assembly, actions
# ---------------------------------------------------------------------------

def build_armature():
    arm_data = bpy.data.armatures.new('Seraph_Rig')
    arm = bpy.data.objects.new('Seraph_Rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent in bone_table():
        eb = arm_data.edit_bones.new(name)
        eb.head, eb.tail = V(head), V(tail)
        if parent:
            eb.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    arm_data.display_type = 'STICK'
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm


def assemble(arm):
    bpy.context.view_layer.update()
    joined = []
    for bone, obs in PARTS.items():
        main = obs[0]
        if len(obs) > 1:
            with bpy.context.temp_override(active_object=main, selected_editable_objects=obs,
                                           selected_objects=obs):
                bpy.ops.object.join()
        main.name = main.data.name = f'Seraph_{bone}'
        if bone == 'head':
            nk = V((0, -0.05, 8.18))
            main.data.transform(Matrix.Translation(nk + V((0, -0.06, -0.02))) @ Matrix.Scale(1.18, 4)
                                @ Matrix.Translation(-nk))
        mats = {}
        for i, m in enumerate(main.data.materials):
            mats.setdefault(m.name, []).append(i)
        main.parent = arm
        main.parent_type = 'BONE'
        main.parent_bone = bone
        main.matrix_world = Matrix.Identity(4)
        joined.append(main)
    # Merge duplicate material slots left by joining
    for ob in joined:
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.object.material_slot_remove_unused()
        names = []
        remap = {}
        for i, m in enumerate(ob.data.materials):
            if m.name not in names:
                names.append(m.name)
            remap[i] = names.index(m.name)
        idx = [remap[p.material_index] for p in ob.data.polygons]
        mats = [bpy.data.materials[nm] for nm in names]
        ob.data.materials.clear()
        for m in mats:
            ob.data.materials.append(m)
        for p, i in zip(ob.data.polygons, idx):
            p.material_index = i
    return joined


def rot_world(arm, bone, axis, deg):
    """A pose rotation given about an axis in rest armature space."""
    B = arm.data.bones[bone].matrix_local.to_quaternion()
    R = Quaternion(V(axis).normalized(), math.radians(deg))
    return B.inverted() @ R @ B


DEPLOYED = (48, 24, -46, 1.0)


def binder_pose(arm, splay, pitch, gimbal, plume):
    p = {}
    for n, s in SIDES:
        p[f'binder_mount.{n}'] = rot_world(arm, f'binder_mount.{n}', (0, 1, 0), -splay * s)
        p[f'binder.{n}'] = rot_world(arm, f'binder.{n}', (1, 0, 0), pitch)
        p[f'nozzle.{n}'] = rot_world(arm, f'nozzle.{n}', (1, 0, 0), gimbal)
        p[f'plume.{n}'] = (Quaternion(), max(plume, 0.001))
    return p


def make_actions(arm):
    arm.animation_data_create()
    acts = {}

    def action(name, frames, loop=True):
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        for f, pose in frames:
            key_bones(arm, f, pose)
        act.use_frame_range = True
        act.frame_range = (frames[0][0], frames[-1][0])
        act.use_cyclic = loop
        acts[name] = act
        return act

    # binder_pose(splay, pitch, nozzle gimbal, plume): splay swings the blade tips outward,
    # pitch swings them back, and the gimbal tips the nozzles down to keep thrust aft.
    stow = binder_pose(arm, 0, 0, 0, 0)
    deploy = binder_pose(arm, *DEPLOYED)
    action('Binders_Cycle', [
        (1, stow), (24, binder_pose(arm, 22, 10, -20, 0.2)), (40, deploy),
        (56, binder_pose(arm, 42, 18, -30, 1.15)), (72, binder_pose(arm, 52, 30, -58, 0.9)),
        (88, deploy), (110, binder_pose(arm, 10, 4, -8, 0.0)), (120, stow)])
    action('Binders_Deploy', [(1, stow), (18, binder_pose(arm, 30, 14, -26, 0.4)), (30, deploy)], loop=False)
    action('Binders_Stow', [(1, deploy), (12, binder_pose(arm, 30, 14, -26, 0.4)), (30, stow)], loop=False)
    action('Binders_Thrust', [(1, deploy), (10, binder_pose(arm, 48, 24, -56, 1.25)),
                              (20, binder_pose(arm, 48, 24, -38, 0.85)), (30, deploy)])
    return acts


def key_bones(arm, frame, pose):
    for pb in arm.pose.bones:
        v = pose.get(pb.name)
        if v is None:
            q, sc = Quaternion(), 1.0
        elif isinstance(v, tuple):
            q, sc = v
        else:
            q, sc = v, 1.0
        pb.rotation_quaternion = q
        pb.scale = (sc, sc, sc)
        if v is not None:
            pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
            pb.keyframe_insert('scale', frame=frame, group=pb.name)


def reference_pose(arm):
    """The stance of the concept art: right leg turned out to show its profile,
    left leg near frontal, head turned to its right, binders stowed."""
    p = {
        'root': Quaternion(),
        'pelvis': rot_world(arm, 'pelvis', (0, 0, 1), 8),
        'spine': rot_world(arm, 'spine', (1, 0, 0), -3),
        'chest': rot_world(arm, 'chest', (0, 0, 1), -6),
        'head': rot_world(arm, 'head', (0, 0, 1), -24) @ Quaternion(),
        'neck': rot_world(arm, 'neck', (1, 0, 0), 6),
        'thigh.R': rot_world(arm, 'thigh.R', (0, 0, 1), -62) @ rot_world(arm, 'thigh.R', (0, 1, 0), 9),
        'shin.R': rot_world(arm, 'shin.R', (1, 0, 0), 6),
        'foot.R': rot_world(arm, 'foot.R', (0, 1, 0), -9),
        'thigh.L': rot_world(arm, 'thigh.L', (0, 1, 0), -8) @ rot_world(arm, 'thigh.L', (1, 0, 0), 10),
        'shin.L': rot_world(arm, 'shin.L', (1, 0, 0), -14),
        'foot.L': rot_world(arm, 'foot.L', (0, 1, 0), 8) @ rot_world(arm, 'foot.L', (1, 0, 0), 4),
        'upper_arm.R': rot_world(arm, 'upper_arm.R', (0, 1, 0), 6),
        'forearm.R': rot_world(arm, 'forearm.R', (1, 0, 0), 14),
        'upper_arm.L': rot_world(arm, 'upper_arm.L', (0, 1, 0), -4) @ rot_world(arm, 'upper_arm.L', (1, 0, 0), 12),
        'forearm.L': rot_world(arm, 'forearm.L', (1, 0, 0), 38),
    }
    return p


def apply_pose(arm, pose, drop=0.0):
    for pb in arm.pose.bones:
        v = pose.get(pb.name)
        q, sc = (v if isinstance(v, tuple) else (v, 1.0)) if v is not None else (Quaternion(), 1.0)
        if v is None and pb.name.startswith('plume'):
            sc = 0.001  # thrusters off
        pb.rotation_quaternion = q
        pb.scale = (sc, sc, sc)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    # Settle the lower foot onto the ground
    low = min((arm.matrix_world @ arm.pose.bones[f'foot.{n}'].head).z for n, _ in SIDES) - 0.62
    arm.pose.bones['root'].location = (0, -low - drop, 0)  # root bone: local Y is world Z
    bpy.context.view_layer.update()


def count_tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)

# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = 'ABSOLUTE'
    sc.render.line_thickness = 1.6
    fs = sc.view_layers[0].freestyle_settings
    ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new('Ink')
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new('Ink')
    ls.select_by_visibility = True
    ls.select_silhouette = ls.select_border = ls.select_crease = True
    sc.view_layers[0].freestyle_settings.crease_angle = math.radians(128)
    ls.linestyle.color = (0.06, 0.065, 0.075)
    ls.linestyle.thickness = 1.3

    world = bpy.data.worlds.new('Seraph_World')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    bg.inputs['Color'].default_value = (0.92, 0.93, 0.95, 1)
    bg.inputs['Strength'].default_value = 0.55
    white = nt.nodes.new('ShaderNodeBackground')
    white.inputs['Color'].default_value = (1, 1, 1, 1)
    lp = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(white.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes['World Output'].inputs['Surface'])

    def light(name, kind, loc, rot, energy, size=1.0):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        if kind == 'AREA':
            ld.size = size
        else:
            ld.angle = math.radians(size)
        ob = bpy.data.objects.new(name, ld)
        ob.location, ob.rotation_euler = loc, [math.radians(r) for r in rot]
        sc.collection.objects.link(ob)
        return ob
    light('Key', 'SUN', (0, 0, 0), (50, 0, -35), 2.4, 6)
    light('Rim', 'SUN', (0, 0, 0), (60, 0, 160), 1.4, 4)
    light('Fill', 'AREA', (-8, -10, 5), (70, 0, -40), 400, 10)

    # Ground (shadow) and concept-sheet backdrop panel
    gm = material('Seraph_Ground', '#f2f3f5', 0.9)
    bpy.ops.mesh.primitive_plane_add(size=2000, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = 'Ground'
    g.data.materials.append(gm)
    g.visible_camera = True
    pm = material('Seraph_Panel', '#9a9ea4', 1.0)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-0.5, 7.0, 5.2), rotation=(math.radians(90), 0, math.radians(8)))
    panel = bpy.context.active_object
    panel.name = 'Backdrop'
    panel.scale = (6.6, 10.4, 1)
    panel.data.materials.append(pm)
    # Keep the ink lines on the mech: the stage gets no outlines
    stage = bpy.data.collections.new('Stage')
    sc.collection.children.link(stage)
    for ob in (g, panel):
        sc.collection.objects.unlink(ob)
        stage.objects.link(ob)
    ls = sc.view_layers[0].freestyle_settings.linesets[0]
    ls.select_by_collection = True
    ls.collection = stage
    ls.collection_negation = 'EXCLUSIVE'
    return g, panel


def camera(name, loc, target, lens=50, ortho=None):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    ob = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = V(target) - V(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def render(cam, path, res=(1000, 1300), samples=64):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.cycles.samples = samples
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('rendered', path)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.render.fps = 30
    M = make_materials()
    build_torso(M)
    build_head(M)
    for n, s in SIDES:
        build_arm(M, n, s)
        build_leg(M, n, s)
        build_binder(M, n, s)
    arm = build_armature()
    objs = assemble(arm)
    tris = count_tris([o for o in objs if not o.name.startswith('Seraph_plume')])
    plume_tris = count_tris([o for o in objs if o.name.startswith('Seraph_plume')])
    print(f'TRIANGLES mech={tris} plumes={plume_tris} objects={len(objs)}')

    acts = make_actions(arm)
    arm.animation_data.action = acts['Binders_Cycle']
    sc.frame_start, sc.frame_end = 1, 120
    os.makedirs(OUT, exist_ok=True)

    # glTF: one animation per action
    for o in bpy.data.objects:
        o.select_set(o == arm or o in objs)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, 'seraph.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_apply=False,
        export_yup=True, export_force_sampling=True)

    if RENDER:
        renders = os.path.join(OUT, 'renders')
        os.makedirs(renders, exist_ok=True)
        ground, panel = setup_render()
        arm.animation_data.action = None
        # 1. The concept art's stance and camera
        apply_pose(arm, reference_pose(arm))
        cam = camera('Cam_Reference', (3.0, -14.5, 2.4), (0.0, 0.4, 5.0), lens=46)
        render(cam, os.path.join(renders, 'reference-pose.png'), (1000, 1330), 96)
        panel.hide_render = True
        # 2. Turnaround in the rest stance
        apply_pose(arm, {})
        for nm, loc in () if QUICK else (('front', (0, -30, 4.6)), ('side', (30, 0, 4.6)), ('back', (0, 30, 4.6)),
                        ('three-quarter', (16, -24, 7.0))):
            cam = camera(f'Cam_{nm}', loc, (0, 0.3, 4.6), ortho=11.5 if nm != 'three-quarter' else None,
                         lens=70)
            render(cam, os.path.join(renders, f'{nm}.png'), (900, 1100), 48)
        if QUICK:
            return
        # 3. Binders deployed with thrusters lit, from behind
        apply_pose(arm, binder_pose(arm, *DEPLOYED))
        cam = camera('Cam_Deployed', (-13, 17, 9.5), (0, 0.6, 5.6), lens=45)
        render(cam, os.path.join(renders, 'binders-deployed.png'), (1200, 1000), 64)
        apply_pose(arm, {})
        arm.animation_data.action = acts['Binders_Cycle']
        sc.camera = bpy.data.objects['Cam_Reference']
        panel.hide_render = False

    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'seraph.blend'), compress=True)
    print('saved', OUT)


if __name__ == '__main__':
    main()
