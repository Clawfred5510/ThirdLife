"""Carve a doorway + hollow interior into each ThirdLife building GLB.

For each .glb under public/assets/models/buildings/:
  1. Import into a fresh Blender scene.
  2. Boolean-subtract a doorway box from the front face (centered, ~22%
     of building width × ~32% of height × deep enough to break through
     to the inside).
  3. Boolean-subtract a slightly-smaller inner box to hollow the
     building, leaving ~10% wall thickness on each side and a
     ~6% floor thickness.
  4. Export the carved mesh back to GLB.

Run modes:
  TEST_ONE = True        → operate on house.glb only, write to
                            house_carved.glb (for inspection)
  TEST_ONE = False       → operate on all 10 GLBs, write into
                            <name>_carved.glb companions (originals
                            preserved; loader can opt-in by filename
                            or these can be moved into place after
                            verification)

Invoked headlessly via:
    blender --background --python scripts/carve-buildings.py
"""

import bpy
import os
import sys

BUILDINGS_DIR = '/home/ahio/ThirdLifeGame/game-repo/packages/client/public/assets/models/buildings'

ALL_FILES = [
    'apartment.glb', 'bank.glb', 'factory.glb', 'farm.glb', 'hall.glb',
    'house.glb',     'mine.glb', 'office.glb',  'shop.glb', 'powerplant.glb',
]

TEST_ONE = False
FILES = ['house.glb'] if TEST_ONE else ALL_FILES

# ── Carve parameters ─────────────────────────────────────────────────
WALL_FRACTION = 0.10       # 10% of building width = wall thickness on each side
FLOOR_FRACTION = 0.06      # 6% of height = floor thickness
ROOF_FRACTION = 0.18       # 18% of height kept for roof / eaves
DOOR_WIDTH_FRAC = 0.22     # 22% of building width
DOOR_HEIGHT_FRAC = 0.32    # 32% of building height
# Direction the doorway gets cut into. Blender's GLTF importer maps
# GLTF -Z (forward) to Blender -Y; reference images face the camera
# (so "front" of the diorama exterior is -Y in Blender after import).
FRONT_AXIS = 'Y_NEG'


def wipe_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    # Purge orphan datablocks so material/mesh names don't collide
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def import_glb(path):
    pre = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in pre]
    return new


def find_main_mesh(objects):
    """Pick the largest mesh object in the imported set (Meshy outputs
    typically have one mesh + parent empties)."""
    meshes = [o for o in objects if o.type == 'MESH']
    if not meshes:
        return None
    return max(meshes, key=lambda o: len(o.data.vertices))


def world_bbox(obj):
    """Return (min_corner, max_corner) of the object's world-space AABB."""
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Force matrix update before reading bound_box
    bpy.context.view_layer.update()
    corners_world = [obj.matrix_world @ corner for corner in (
        bpy.types.Vector(c) if False else __import__('mathutils').Vector(c)
        for c in obj.bound_box
    )]
    minc = corners_world[0].copy()
    maxc = corners_world[0].copy()
    for c in corners_world[1:]:
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


def boolean_subtract(target, cutter, mod_name):
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    mod = target.modifiers.new(mod_name, 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = 'EXACT'  # robust, slower; falls back to FAST if it fails
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
        return True
    except RuntimeError as err:
        print(f'    boolean failed ({mod_name}): {err}')
        # Retry with FAST solver
        target.modifiers.remove(mod)
        mod = target.modifiers.new(mod_name + '_fast', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        mod.solver = 'FAST'
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            return True
        except RuntimeError as err2:
            print(f'    boolean fast solver also failed: {err2}')
            return False


def decimate_collapse(target, ratio):
    """Decimate the mesh by collapsing edges. Reduces vertex count by
    `ratio` (0.1 = keep 10%). Does NOT preserve sharp creases."""
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    mod = target.modifiers.new('Decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)


def decimate_planar(target, angle_degrees):
    """Decimate by collapsing nearly-coplanar faces. Good for cleaning
    up boolean tessellation without losing silhouette detail."""
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    mod = target.modifiers.new('DecimatePlanar', 'DECIMATE')
    mod.decimate_type = 'DISSOLVE'
    mod.angle_limit = angle_degrees * 3.14159265 / 180.0
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
    # Meshy outputs are 500K+ vertices each. For a tycoon-style game
    # building viewed at parcel scale, ~30K is plenty. Decimating
    # before booleans also makes the boolean ops orders of magnitude
    # faster.
    pre_count = len(target.data.vertices)
    if pre_count > 60000:
        target_ratio = 30000 / pre_count
        decimate_collapse(target, target_ratio)
        print(f'  pre-decimate: {pre_count} → {len(target.data.vertices)} verts')

    # Snapshot the world AABB after decimation
    bb_min, bb_max = world_bbox(target)
    size = (bb_max[0] - bb_min[0], bb_max[1] - bb_min[1], bb_max[2] - bb_min[2])
    print(f'  bbox: ({size[0]:.2f} × {size[1]:.2f} × {size[2]:.2f})')

    # ── Hollow interior ──────────────────────────────────────────────
    # Walls = WALL_FRACTION on X+Z, floor = FLOOR_FRACTION on -Y,
    # ceiling = ROOF_FRACTION on +Y (in Blender's convention,
    # +Y is up after GLB import. Actually Blender is +Z up; GLB +Y
    # gets mapped to Blender +Z by the importer.)
    # In Blender after GLB import: Z is up, X/Y are ground plane.
    inner_size = (
        size[0] * (1 - 2 * WALL_FRACTION),
        size[1] * (1 - 2 * WALL_FRACTION),
        size[2] * (1 - FLOOR_FRACTION - ROOF_FRACTION),
    )
    inner_center = (
        (bb_min[0] + bb_max[0]) / 2,
        (bb_min[1] + bb_max[1]) / 2,
        bb_min[2] + size[2] * FLOOR_FRACTION + inner_size[2] / 2,
    )
    cutter = add_box('Hollow', inner_center, inner_size)
    boolean_subtract(target, cutter, 'Hollow')
    bpy.data.objects.remove(cutter, do_unlink=True)

    # ── Doorway ──────────────────────────────────────────────────────
    door_w = size[0] * DOOR_WIDTH_FRAC
    door_h = size[2] * DOOR_HEIGHT_FRAC
    # Cutter depth = full Y (or X) of the building so it punches all the
    # way through. Anchored to the front face.
    if FRONT_AXIS == 'Y_NEG':
        door_size = (door_w, size[1] * 1.2, door_h)
        door_center = (
            (bb_min[0] + bb_max[0]) / 2,
            (bb_min[1] + bb_max[1]) / 2,
            bb_min[2] + size[2] * FLOOR_FRACTION + door_h / 2,
        )
    else:
        # Fallback: front along -X
        door_size = (size[0] * 1.2, door_w, door_h)
        door_center = (
            (bb_min[0] + bb_max[0]) / 2,
            (bb_min[1] + bb_max[1]) / 2,
            bb_min[2] + size[2] * FLOOR_FRACTION + door_h / 2,
        )

    cutter = add_box('Doorway', door_center, door_size)
    boolean_subtract(target, cutter, 'Doorway')
    bpy.data.objects.remove(cutter, do_unlink=True)

    # ── Post-carve cleanup ──────────────────────────────────────────
    # Booleans tessellate cut edges into many small triangles.
    # Planar decimate (dissolve) collapses coplanar faces without
    # changing the silhouette — perfect for cleaning up the carve.
    post_carve = len(target.data.vertices)
    decimate_planar(target, 1.5)
    print(f'  post-carve cleanup: {post_carve} → {len(target.data.vertices)} verts')

    # ── Export ───────────────────────────────────────────────────────
    out_filename = filename.replace('.glb', '_carved.glb')
    out_path = os.path.join(BUILDINGS_DIR, out_filename)

    # Select only the target so use_selection captures the right thing
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
