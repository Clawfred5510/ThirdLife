import {
  Scene,
  MeshBuilder,
  Color3,
  Vector3,
  PBRMetallicRoughnessMaterial,
  TransformNode,
  Mesh,
} from '@babylonjs/core';

/**
 * Procedural furniture sets per building type. Every piece is a primitive
 * parented to the returned TransformNode, positioned relative to the
 * building's local origin (building root is at footprint center, floor
 * at y=0.1). All furniture sits inside the inner footprint and MUST NOT
 * block the doorway (front face at z = -inner/2, door centered at x=0).
 *
 * Furniture meshes are not registered as shadow casters — they're small
 * and inside a dark interior, so the shadow cost would outweigh the
 * visual gain. Ground receives shadows from the walls already.
 */

export interface FurnitureBundle {
  root: TransformNode;
}

function pbr(scene: Scene, name: string, color: Color3, roughness = 0.8): PBRMetallicRoughnessMaterial {
  const m = new PBRMetallicRoughnessMaterial(name, scene);
  m.baseColor = color;
  m.metallic = 0;
  m.roughness = roughness;
  return m;
}

function metal(scene: Scene, name: string, color: Color3, roughness = 0.45): PBRMetallicRoughnessMaterial {
  const m = new PBRMetallicRoughnessMaterial(name, scene);
  m.baseColor = color;
  m.metallic = 0.7;
  m.roughness = roughness;
  return m;
}

const WOOD = new Color3(0.38, 0.24, 0.16);
const LIGHT_WOOD = new Color3(0.72, 0.55, 0.36);
const FABRIC = new Color3(0.42, 0.34, 0.58);
const RED_FABRIC = new Color3(0.68, 0.18, 0.18);
const WHITE = new Color3(0.88, 0.86, 0.82);
const HAY = new Color3(0.86, 0.72, 0.36);
const STEEL = new Color3(0.65, 0.66, 0.68);
const DARK_STEEL = new Color3(0.24, 0.25, 0.28);
const CROP_GREEN = new Color3(0.42, 0.62, 0.28);
const ORE_GRAY = new Color3(0.44, 0.44, 0.48);
const GOLD = new Color3(0.78, 0.62, 0.26);
const SCREEN_BLUE = new Color3(0.55, 0.75, 0.92);
const PAPER = new Color3(0.92, 0.9, 0.84);

/** Build furniture for the given building type inside an `inner` x `inner` footprint. */
export function buildFurniture(
  scene: Scene,
  id: string | number,
  type: string,
  inner: number,
  wallHeight: number,
): FurnitureBundle {
  const root = new TransformNode(`furn_${id}`, scene);
  const halfI = inner / 2;

  // Shared materials per furniture set — one instance per building so
  // disposing the building root disposes all of these too.
  const wood = pbr(scene, `fWood_${id}`, WOOD, 0.75);
  const lightWood = pbr(scene, `fLightWood_${id}`, LIGHT_WOOD, 0.8);
  const fabric = pbr(scene, `fFabric_${id}`, FABRIC, 0.95);
  const white = pbr(scene, `fWhite_${id}`, WHITE, 0.7);

  const parent = (mesh: Mesh) => { mesh.parent = root; mesh.receiveShadows = true; };

  switch (type) {
    case 'apartment': {
      // Bed (frame + mattress)
      const bed = MeshBuilder.CreateBox(`bedFrame_${id}`, { width: 2.2, height: 0.4, depth: 1.3 }, scene);
      bed.position.set(-halfI + 1.5, 0.3, halfI - 0.9);
      bed.material = wood;
      parent(bed);
      const mat = MeshBuilder.CreateBox(`bedMat_${id}`, { width: 2.0, height: 0.25, depth: 1.1 }, scene);
      mat.position.set(-halfI + 1.5, 0.62, halfI - 0.9);
      mat.material = white;
      parent(mat);
      const pillow = MeshBuilder.CreateBox(`pillow_${id}`, { width: 0.6, height: 0.15, depth: 0.8 }, scene);
      pillow.position.set(-halfI + 0.9, 0.82, halfI - 0.9);
      pillow.material = pbr(scene, `pillow_${id}`, FABRIC, 0.95);
      parent(pillow);

      // Couch (front-left)
      const couch = MeshBuilder.CreateBox(`couch_${id}`, { width: 2.6, height: 0.9, depth: 0.9 }, scene);
      couch.position.set(halfI - 1.7, 0.45, -halfI + 2.5);
      couch.material = fabric;
      parent(couch);
      const couchBack = MeshBuilder.CreateBox(`couchBack_${id}`, { width: 2.6, height: 0.4, depth: 0.25 }, scene);
      couchBack.position.set(halfI - 1.7, 1.1, -halfI + 2.9);
      couchBack.material = fabric;
      parent(couchBack);

      // Coffee table
      const ct = MeshBuilder.CreateBox(`coffeeTbl_${id}`, { width: 1.4, height: 0.5, depth: 0.7 }, scene);
      ct.position.set(halfI - 1.7, 0.25, -halfI + 4);
      ct.material = lightWood;
      parent(ct);
      break;
    }
    case 'house': {
      // Dining table + 4 chairs
      const tbl = MeshBuilder.CreateBox(`tbl_${id}`, { width: 2.2, height: 0.12, depth: 1.2 }, scene);
      tbl.position.set(0, 0.9, 0);
      tbl.material = lightWood;
      parent(tbl);
      for (const [lx, lz] of [[-0.8, 0], [0.8, 0], [-0.8, 0.1], [0.8, -0.1]] as const) {
        const leg = MeshBuilder.CreateBox(`leg_${id}_${lx}_${lz}`, { width: 0.1, height: 0.9, depth: 0.1 }, scene);
        leg.position.set(lx, 0.45, lz);
        leg.material = lightWood;
        parent(leg);
      }
      for (const [cx, cz] of [[-1.4, 0], [1.4, 0], [0, 0.9], [0, -0.9]] as const) {
        const chair = MeshBuilder.CreateBox(`chair_${id}_${cx}_${cz}`, { width: 0.5, height: 0.55, depth: 0.5 }, scene);
        chair.position.set(cx, 0.28, cz);
        chair.material = wood;
        parent(chair);
      }
      // Fireplace (back wall center)
      const hearth = MeshBuilder.CreateBox(`hearth_${id}`, { width: 1.8, height: 1.4, depth: 0.6 }, scene);
      hearth.position.set(0, 0.8, halfI - 0.4);
      hearth.material = pbr(scene, `stone_${id}`, new Color3(0.55, 0.52, 0.5), 0.95);
      parent(hearth);
      break;
    }
    case 'shop': {
      // Checkout counter
      const counter = MeshBuilder.CreateBox(`counter_${id}`, { width: inner * 0.55, height: 1.1, depth: 0.8 }, scene);
      counter.position.set(0, 0.55, halfI * 0.6);
      counter.material = lightWood;
      parent(counter);
      // Register on counter
      const reg = MeshBuilder.CreateBox(`register_${id}`, { width: 0.5, height: 0.4, depth: 0.4 }, scene);
      reg.position.set(-inner * 0.15, 1.3, halfI * 0.6);
      reg.material = pbr(scene, `regMat_${id}`, new Color3(0.12, 0.12, 0.12));
      parent(reg);
      // Shelving units (left + right walls)
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const shelf = MeshBuilder.CreateBox(`shelf_${id}_${side}_${i}`, { width: 0.5, height: 0.08, depth: inner * 0.8 }, scene);
          shelf.position.set(side * (halfI - 0.3), 0.7 + i * 0.9, 0);
          shelf.material = wood;
          parent(shelf);
        }
      }
      // Product crates on shelves
      for (let i = 0; i < 6; i++) {
        const crate = MeshBuilder.CreateBox(`crate_${id}_${i}`, { width: 0.4, height: 0.3, depth: 0.4 }, scene);
        crate.position.set((i % 2 ? 1 : -1) * (halfI - 0.3), 0.9 + Math.floor(i / 2) * 0.9, -halfI + 1 + i * 1.2);
        crate.material = pbr(scene, `crate_${id}_${i}`, new Color3(0.72, 0.52, 0.28));
        parent(crate);
      }
      break;
    }
    case 'farm': {
      // Hay bales stacked
      const hayMat = pbr(scene, `hay_${id}`, HAY, 0.98);
      for (const [hx, hz, hy] of [[-halfI + 1.5, halfI - 1.5, 0.5], [-halfI + 1.5, halfI - 2.8, 0.5],
                                    [-halfI + 1.5, halfI - 1.5, 1.5], [-halfI + 2.8, halfI - 1.5, 0.5]] as const) {
        const bale = MeshBuilder.CreateCylinder(`bale_${id}_${hx}_${hz}_${hy}`, {
          diameter: 1.0, height: 1.1, tessellation: 12,
        }, scene);
        bale.position.set(hx, hy, hz);
        bale.rotation.z = Math.PI / 2;
        bale.material = hayMat;
        parent(bale);
      }
      // Feed troughs along the right wall
      for (let i = 0; i < 3; i++) {
        const trough = MeshBuilder.CreateBox(`trough_${id}_${i}`, { width: 2.0, height: 0.4, depth: 0.7 }, scene);
        trough.position.set(halfI - 0.8, 0.25, -halfI + 2 + i * 2.5);
        trough.material = wood;
        parent(trough);
      }
      // Crop rows (placeholder: small green boxes in a line)
      for (let i = 0; i < 5; i++) {
        const crop = MeshBuilder.CreateBox(`crop_${id}_${i}`, { width: 0.35, height: 0.6, depth: 0.35 }, scene);
        crop.position.set(-inner * 0.1 + i * 0.6, 0.4, -halfI + 3);
        crop.material = pbr(scene, `crop_${id}_${i}`, CROP_GREEN, 0.9);
        parent(crop);
      }
      break;
    }
    case 'market': {
      // Display stalls in a U-shape
      for (let i = 0; i < 5; i++) {
        const stall = MeshBuilder.CreateBox(`stall_${id}_${i}`, { width: 1.6, height: 1.0, depth: 0.9 }, scene);
        const ang = (i / 4) * Math.PI;
        stall.position.set(Math.cos(ang) * (halfI - 2), 0.5, Math.sin(ang) * (halfI - 2));
        stall.rotation.y = -ang - Math.PI / 2;
        stall.material = lightWood;
        parent(stall);
        // Produce on top (colored box)
        const produce = MeshBuilder.CreateBox(`produce_${id}_${i}`, { width: 1.2, height: 0.3, depth: 0.6 }, scene);
        produce.position.copyFrom(stall.position);
        produce.position.y = 1.1;
        produce.rotation.copyFrom(stall.rotation);
        const hue = [new Color3(0.92, 0.45, 0.28), new Color3(0.95, 0.78, 0.26), new Color3(0.42, 0.68, 0.34),
                     new Color3(0.88, 0.34, 0.42), new Color3(0.58, 0.36, 0.78)][i];
        produce.material = pbr(scene, `produceMat_${id}_${i}`, hue);
        parent(produce);
      }
      break;
    }
    case 'office': {
      // 4 desks in a 2x2 grid, each with a monitor
      const deskMat = pbr(scene, `desk_${id}`, LIGHT_WOOD, 0.7);
      const chairMat = pbr(scene, `chair_${id}`, DARK_STEEL, 0.6);
      const screenMat = pbr(scene, `screen_${id}`, SCREEN_BLUE, 0.2);
      screenMat.emissiveColor = SCREEN_BLUE;
      const placements = [[-halfI + 2.5, -halfI + 3], [halfI - 2.5, -halfI + 3], [-halfI + 2.5, halfI - 3], [halfI - 2.5, halfI - 3]] as const;
      for (const [dx, dz] of placements) {
        const desk = MeshBuilder.CreateBox(`desk_${id}_${dx}_${dz}`, { width: 1.6, height: 0.1, depth: 0.9 }, scene);
        desk.position.set(dx, 0.8, dz);
        desk.material = deskMat;
        parent(desk);
        // Desk legs
        for (const [lx, lz] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]] as const) {
          const leg = MeshBuilder.CreateBox(`deskLeg_${id}_${dx}_${dz}_${lx}_${lz}`, { width: 0.08, height: 0.8, depth: 0.08 }, scene);
          leg.position.set(dx + lx, 0.4, dz + lz);
          leg.material = deskMat;
          parent(leg);
        }
        // Monitor
        const monitor = MeshBuilder.CreateBox(`mon_${id}_${dx}_${dz}`, { width: 0.9, height: 0.55, depth: 0.05 }, scene);
        monitor.position.set(dx, 1.25, dz - 0.25);
        monitor.material = screenMat;
        parent(monitor);
        // Chair
        const ch = MeshBuilder.CreateBox(`ch_${id}_${dx}_${dz}`, { width: 0.5, height: 0.8, depth: 0.5 }, scene);
        ch.position.set(dx, 0.4, dz + 0.8);
        ch.material = chairMat;
        parent(ch);
      }
      break;
    }
    case 'mine': {
      // Ore piles
      const oreMat = pbr(scene, `ore_${id}`, ORE_GRAY, 0.95);
      for (const [ox, oz, os] of [[-halfI + 1.8, halfI - 1.8, 1.2], [-halfI + 1.8, -halfI + 2.5, 0.9], [halfI - 1.8, halfI - 2, 1.5]] as const) {
        const pile = MeshBuilder.CreateSphere(`pile_${id}_${ox}_${oz}`, { diameter: os, segments: 8 }, scene);
        pile.position.set(ox, os / 2 - 0.2, oz);
        pile.scaling.y = 0.6;
        pile.material = oreMat;
        parent(pile);
      }
      // Minecart + rails
      const cart = MeshBuilder.CreateBox(`cart_${id}`, { width: 1.5, height: 0.9, depth: 1.0 }, scene);
      cart.position.set(0, 0.55, halfI - 2);
      cart.material = metal(scene, `cartMat_${id}`, STEEL, 0.6);
      parent(cart);
      // Wheels
      for (const wx of [-0.6, 0.6]) {
        for (const wz of [-0.4, 0.4]) {
          const wheel = MeshBuilder.CreateCylinder(`wheel_${id}_${wx}_${wz}`, { diameter: 0.5, height: 0.1, tessellation: 12 }, scene);
          wheel.position.set(wx, 0.25, halfI - 2 + wz);
          wheel.rotation.z = Math.PI / 2;
          wheel.material = metal(scene, `wheelMat_${id}_${wx}_${wz}`, DARK_STEEL, 0.4);
          parent(wheel);
        }
      }
      // Pickaxe (just two crossed cylinders leaning on wall)
      const handle = MeshBuilder.CreateCylinder(`pickH_${id}`, { diameter: 0.08, height: 1.6, tessellation: 8 }, scene);
      handle.position.set(halfI - 0.5, 0.8, -halfI + 1.5);
      handle.rotation.z = 0.2;
      handle.material = wood;
      parent(handle);
      const head = MeshBuilder.CreateBox(`pickHead_${id}`, { width: 0.6, height: 0.12, depth: 0.1 }, scene);
      head.position.set(halfI - 0.5, 1.55, -halfI + 1.5);
      head.material = metal(scene, `pickHeadMat_${id}`, STEEL, 0.3);
      parent(head);
      break;
    }
    case 'hall': {
      // Long banquet table
      const tbl = MeshBuilder.CreateBox(`hallTbl_${id}`, { width: inner * 0.75, height: 0.1, depth: 1.5 }, scene);
      tbl.position.set(0, 0.9, 0);
      tbl.material = lightWood;
      parent(tbl);
      // 6 benches (3 per side)
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const bench = MeshBuilder.CreateBox(`bench_${id}_${side}_${i}`, { width: inner * 0.2, height: 0.5, depth: 0.4 }, scene);
          bench.position.set(-inner * 0.22 + i * inner * 0.22, 0.25, side * 1.2);
          bench.material = wood;
          parent(bench);
        }
      }
      // Podium
      const pod = MeshBuilder.CreateBox(`podium_${id}`, { width: 1.4, height: 1.3, depth: 0.8 }, scene);
      pod.position.set(0, 0.65, halfI - 1.0);
      pod.material = wood;
      parent(pod);
      break;
    }
    case 'factory': {
      // Conveyor belt spanning the room
      const belt = MeshBuilder.CreateBox(`belt_${id}`, { width: 1.0, height: 0.2, depth: inner * 0.7 }, scene);
      belt.position.set(-1, 0.85, 0);
      belt.material = metal(scene, `beltMat_${id}`, DARK_STEEL, 0.65);
      parent(belt);
      // Conveyor legs
      for (let i = 0; i < 3; i++) {
        const leg = MeshBuilder.CreateBox(`beltLeg_${id}_${i}`, { width: 0.15, height: 0.75, depth: 0.15 }, scene);
        leg.position.set(-1, 0.37, -inner * 0.3 + i * inner * 0.3);
        leg.material = metal(scene, `beltLegMat_${id}_${i}`, DARK_STEEL, 0.7);
        parent(leg);
      }
      // Machinery block
      const mach = MeshBuilder.CreateBox(`mach_${id}`, { width: 2.5, height: 2.2, depth: 2 }, scene);
      mach.position.set(halfI - 1.8, 1.1, halfI * 0.3);
      mach.material = metal(scene, `machMat_${id}`, STEEL, 0.55);
      parent(mach);
      // Pipe sticking up
      const pipe = MeshBuilder.CreateCylinder(`pipe_${id}`, { diameter: 0.5, height: Math.min(2.8, wallHeight - 2.5), tessellation: 10 }, scene);
      pipe.position.set(halfI - 1.8, 2.2 + Math.min(2.8, wallHeight - 2.5) / 2, halfI * 0.3);
      pipe.material = metal(scene, `pipeMat_${id}`, STEEL, 0.5);
      parent(pipe);
      // Crates
      for (let i = 0; i < 4; i++) {
        const crate = MeshBuilder.CreateBox(`fCrate_${id}_${i}`, { width: 0.9, height: 0.7, depth: 0.9 }, scene);
        crate.position.set(-halfI + 1.2 + (i % 2) * 1.0, 0.35, -halfI + 1.5 + Math.floor(i / 2) * 1.0);
        crate.material = pbr(scene, `fCrateMat_${id}_${i}`, new Color3(0.55, 0.42, 0.28));
        parent(crate);
      }
      break;
    }
    case 'bank': {
      // Vault door (back wall center)
      const vault = MeshBuilder.CreateCylinder(`vault_${id}`, { diameter: 3.5, height: 0.4, tessellation: 32 }, scene);
      vault.position.set(0, 2.0, halfI - 0.5);
      vault.rotation.x = Math.PI / 2;
      vault.material = metal(scene, `vaultMat_${id}`, STEEL, 0.35);
      parent(vault);
      const handle2 = MeshBuilder.CreateCylinder(`vaultH_${id}`, { diameter: 0.6, height: 0.18, tessellation: 16 }, scene);
      handle2.position.set(0, 2.0, halfI - 0.7);
      handle2.rotation.x = Math.PI / 2;
      handle2.material = metal(scene, `vaultHMat_${id}`, GOLD, 0.3);
      parent(handle2);
      // Teller counter (long, along front)
      const counter = MeshBuilder.CreateBox(`bCounter_${id}`, { width: inner * 0.75, height: 1.1, depth: 1.1 }, scene);
      counter.position.set(0, 0.55, -halfI + 2.5);
      counter.material = wood;
      parent(counter);
      // Marble top
      const top = MeshBuilder.CreateBox(`bTop_${id}`, { width: inner * 0.78, height: 0.12, depth: 1.15 }, scene);
      top.position.set(0, 1.16, -halfI + 2.5);
      top.material = pbr(scene, `marble_${id}`, new Color3(0.88, 0.85, 0.82), 0.3);
      parent(top);
      // Safe deposit boxes (grid on side wall)
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 6; c++) {
          const box = MeshBuilder.CreateBox(`safe_${id}_${r}_${c}`, { width: 0.2, height: 0.35, depth: 0.45 }, scene);
          box.position.set(halfI - 0.25, 0.8 + r * 0.45, -halfI + 2 + c * 0.8);
          box.material = metal(scene, `safeMat_${id}_${r}_${c}`, GOLD, 0.4);
          parent(box);
        }
      }
      break;
    }
    default:
      // Default: simple center-placed crate so empty buildings aren't completely bare
      const crate = MeshBuilder.CreateBox(`defaultCrate_${id}`, { width: 1, height: 0.8, depth: 1 }, scene);
      crate.position.set(0, 0.4, 0);
      crate.material = wood;
      parent(crate);
      break;
  }

  // Silence unused-var linter — these are declared as materials for
  // selective use per type; any branch may or may not reference each.
  void PAPER;
  void RED_FABRIC;

  return { root };
}
