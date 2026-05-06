"""Carve a small doorway + add a contained interior room into each
ThirdLife building GLB.

Design (per user feedback):
  - The building's exterior shell stays mostly intact — only a narrow,
    door-shaped opening is cut through the front wall.
  - A separate small box ("room") is added INSIDE the building. Its
    walls/floor/ceiling are strictly contained within the exterior
    shell so nothing protrudes. The room has its own door cutout
    aligned with the exterior doorway.
  - The room becomes a single joined mesh with the building, so the
    final GLB exports as one piece.

For each .glb under public/assets/models/buildings/:
  1. Pre-decimate from Meshy's ~500K verts down to ~30K.
  2. Cut a narrow door through the building's front (-Y) wall.
  3. Build a small hollow room inside the building.
  4. Cut a matching door through the room's front wall.
  5. Join room into building.
  6. Planar-decimate to clean up boolean tessellation.
  7. Export as <name>_carved.glb.

Run modes:
  TEST_ONE = True   → operate on house.glb only
  TEST_ONE = False  → operate on all 10 GLBs

Invoked headlessly via:
    blender --background --python scripts/carve-buildings.py
"""

import bpy
import os
import math
from mathutils import Vector

BUILDINGS_DIR = '/home/ahio/ThirdLifeGame/game-repo/packages/client/public/assets/models/buildings'

ALL_FILES = [
    'apartment.glb', 'bank.glb', 'factory.glb', 'farm.glb', 'hall.glb',
    'house.glb',     'mine.glb', 'office.glb',  'shop.glb', 'powerplant.glb',
]

TEST_ONE = True
FILES = ['house.glb'] if TEST_ONE else ALL_FILES

# ── Carve parameters ─────────────────────────────────────────────────
# Door is narrow + reasonably tall — sized for an avatar to walk through,
# not a garage door.
DOOR_WIDTH_FRAC = 0.11
DOOR_HEIGHT_FRAC = 0.28
# Floor offset — door + room sit on top of any plinth/sidewalk geometry
# so they don't intersect with the diorama base.
FLOOR_FRAC = 0.06

# Interior room. STRICTLY smaller than the building so it never pokes
# through the exterior shell. ~55% of the building's footprint, 45% of
# its height.
ROOM_WIDTH_FRAC = 0.55
ROOM_DEPTH_FRAC = 0.55
ROOM_HEIGHT_FRAC = 0.45
# Wall thickness in absolute units (Meshy bbox is ~1.9 — 0.05 = ~3%).
ROOM_WALL = 0.05

# "Front" of the building is the -Y face after Blender's GLB import
# (which converts GLTF -Z forward → Blender -Y).
FRONT_AXIS = 'Y_NEG'


def wipe_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def import_glb(path):
    pre = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o not in pre]


def find_main_mesh(objects):
    meshes = [o for o in objects if o.type == 'MESH']
    if not meshes: return None
    return max(meshes, key=lambda o: len(o.data.vertices))


def world_bbox(obj):
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    minc = corners[0].copy()
    maxc = corners[0].copy()
    for c in corners[1:]:
        for axis in range(3):
            if c[axis] < minc[axis]: minc[axis] = c[axis]
            if c[axis] > maxc[axis]: maxc[axis] = c[axis]
    return minc, maxc


def add_box(name, center, size):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    box = bpy.context.active_object
    box.name = name
    box.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return box


def boolean_subtract(target, cutter, mod_name, solver='EXACT'):
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    mod = target.modifiers.new(mod_name, 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = solver
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
        return True
    except RuntimeError:
        target.modifiers.remove(mod)
        if solver == 'EXACT':
            return boolean_subtract(target, cutter, mod_name + '_fast', 'FAST')
        return False


def boolean_union(target, source, mod_name):
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    mod = target.modifiers.new(mod_name, 'BOOLEAN')
    mod.operation = 'UNION'
    mod.object = source
    mod.solver = 'EXACT'
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
        return True
    except RuntimeError:
        target.modifiers.remove(mod)
        return False


def decimate_collapse(target, ratio):
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    mod = target.modifiers.new('Decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)


def decimate_planar(target, angle_degrees):
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    mod = target.modifiers.new('DecimatePlanar', 'DECIMATE')
    mod.decimate_type = 'DISSOLVE'
    mod.angle_limit = math.radians(angle_degrees)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def carve(filename):
    print(f'\n→ {filename}')
    wipe_scene()

    src = os.path.join(BUILDINGS_DIR, filename)
    if not os.path.exists(src):
        print(f'  missing {src}')
        return

    new_objs = import_glb(src)
    target = find_main_mesh(new_objs)
    if target is None:
        print('  no mesh found in import')
        return

    # ── Pre-decimate ────────────────────────────────────────────────
    pre_count = len(target.data.vertices)
    if pre_count > 60000:
        decimate_collapse(target, 30000 / pre_count)
        print(f'  pre-decimate: {pre_count} → {len(target.data.vertices)} verts')

    bb_min, bb_max = world_bbox(target)
    size = (bb_max[0] - bb_min[0], bb_max[1] - bb_min[1], bb_max[2] - bb_min[2])
    print(f'  bbox: ({size[0]:.2f} × {size[1]:.2f} × {size[2]:.2f})')
    cx = (bb_min[0] + bb_max[0]) / 2
    cy = (bb_min[1] + bb_max[1]) / 2
    floor_z = bb_min[2] + size[2] * FLOOR_FRAC

    # ── Cut narrow door through the building's front (-Y) wall ──────
    # Cutter punches in past where the interior room's front wall will
    # sit, so a single boolean op handles both the building's outer
    # door and (later) the room's matching door.
    door_w = size[0] * DOOR_WIDTH_FRAC
    door_h = size[2] * DOOR_HEIGHT_FRAC
    door_punch_depth = size[1] * 0.7
    door_center = (cx, bb_min[1] + door_punch_depth / 2 - 0.001, floor_z + door_h / 2)
    cutter = add_box('Doorway', door_center, (door_w, door_punch_depth, door_h))
    boolean_subtract(target, cutter, 'Doorway')
    bpy.data.objects.remove(cutter, do_unlink=True)

    # ── Build the contained interior room ──────────────────────────
    # Outer shell, strictly smaller than the building bbox.
    room_w = size[0] * ROOM_WIDTH_FRAC
    room_d = size[1] * ROOM_DEPTH_FRAC
    room_h = size[2] * ROOM_HEIGHT_FRAC
    room_center = (cx, cy, floor_z + room_h / 2)
    room = add_box('Room', room_center, (room_w, room_d, room_h))

    # Hollow it: subtract a slightly smaller box, leaving a thin shell.
    inner_w = max(0.05, room_w - ROOM_WALL * 2)
    inner_d = max(0.05, room_d - ROOM_WALL * 2)
    inner_h = max(0.05, room_h - ROOM_WALL)  # leave floor; ceiling extra is also subtracted
    inner_center = (cx, cy, floor_z + ROOM_WALL + inner_h / 2)
    cutter = add_box('InnerRoom', inner_center, (inner_w, inner_d, inner_h))
    boolean_subtract(room, cutter, 'InnerRoom')
    bpy.data.objects.remove(cutter, do_unlink=True)

    # Cut a matching door through the room's front (-Y) wall.
    # Slightly narrower than the exterior cutout so the room interior
    # frames neatly inside the building's doorway.
    room_door_w = door_w * 0.92
    room_door_h = door_h * 0.95
    room_door_d = ROOM_WALL * 6
    room_door_center = (cx, room_center[1] - room_d / 2 + room_door_d / 2 - 0.001, floor_z + room_door_h / 2)
    cutter = add_box('RoomDoor', room_door_center, (room_door_w, room_door_d, room_door_h))
    boolean_subtract(room, cutter, 'RoomDoor')
    bpy.data.objects.remove(cutter, do_unlink=True)

    # ── Join room into building (single mesh, single material) ─────
    bpy.ops.object.select_all(action='DESELECT')
    target.select_set(True)
    room.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()

    # ── Cleanup ─────────────────────────────────────────────────────
    post_carve = len(target.data.vertices)
    decimate_planar(target, 1.5)
    print(f'  post-cleanup: {post_carve} → {len(target.data.vertices)} verts')

    # ── Export ──────────────────────────────────────────────────────
    out_filename = filename.replace('.glb', '_carved.glb')
    out_path = os.path.join(BUILDINGS_DIR, out_filename)

    bpy.ops.object.select_all(action='DESELECT')
    target.select_set(True)
    bpy.context.view_layer.objects.active = target

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
    )
    print(f'  → {out_filename}')


for f in FILES:
    carve(f)

print('\nDone.')
