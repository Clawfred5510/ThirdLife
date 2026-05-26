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

function pbr(scene: Scene, name: string, color: Color3, roughness = 0.8, emissive?: Color3): PBRMetallicRoughnessMaterial {
  const m = new PBRMetallicRoughnessMaterial(name, scene);
  m.baseColor = color;
  m.metallic = 0;
  m.roughness = roughness;
  if (emissive) m.emissiveColor = emissive;
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
      // Layout per user feedback: elevator bank on the back wall, an
      // executive corner office on the front-left, cubicle grid on the
      // front-right, narrow walkway between.
      const deskMat = pbr(scene, `desk_${id}`, LIGHT_WOOD, 0.7);
      const chairMat = pbr(scene, `chair_${id}`, DARK_STEEL, 0.6);
      const screenMat = pbr(scene, `screen_${id}`, SCREEN_BLUE, 0.2, SCREEN_BLUE);
      const partitionMat = pbr(scene, `officePart_${id}`, new Color3(0.55, 0.45, 0.38), 0.85);
      const wallTrimMat = pbr(scene, `officeTrim_${id}`, new Color3(0.55, 0.4, 0.28), 0.7);
      const elevatorMat = metal(scene, `officeElev_${id}`, STEEL, 0.4);
      const elevatorPanelMat = metal(scene, `officeElevPanel_${id}`, DARK_STEEL, 0.3);
      const callBtnMat = pbr(scene, `officeCallBtn_${id}`, new Color3(1.0, 0.55, 0.15), 0.2, new Color3(0.65, 0.3, 0.05));

      // ── Elevator bank (back wall) ─────────────────────────────────
      const elevW = 2.0;
      const elevDepth = 0.6;
      const elevH = wallHeight - 0.4;
      const elevZ = halfI - elevDepth / 2 - 0.1;
      for (let i = -1; i <= 1; i++) {
        const ex = i * (elevW + 0.6);
        // Elevator door frame (deeper recess giving the door look)
        const frame = MeshBuilder.CreateBox(`elevFrame_${id}_${i}`, {
          width: elevW + 0.4, height: elevH + 0.3, depth: 0.15,
        }, scene);
        frame.position.set(ex, elevH / 2 + 0.1, elevZ + 0.25);
        frame.material = elevatorPanelMat;
        parent(frame);
        // Two-panel sliding door
        for (const dSide of [-1, 1]) {
          const door = MeshBuilder.CreateBox(`elevDoor_${id}_${i}_${dSide}`, {
            width: elevW / 2 - 0.04, height: elevH, depth: 0.08,
          }, scene);
          door.position.set(ex + dSide * (elevW / 4), elevH / 2, elevZ + 0.15);
          door.material = elevatorMat;
          parent(door);
        }
        // Floor indicator panel above the doors
        const indicator = MeshBuilder.CreateBox(`elevInd_${id}_${i}`, {
          width: 0.7, height: 0.25, depth: 0.05,
        }, scene);
        indicator.position.set(ex, elevH + 0.05, elevZ + 0.1);
        indicator.material = pbr(scene, `elevIndMat_${id}_${i}`, new Color3(0.1, 0.1, 0.12), 0.3, new Color3(0.85, 0.55, 0.15));
        parent(indicator);
        // Call button (between the two outermost shafts and the side)
        if (i === -1) {
          const btn = MeshBuilder.CreateCylinder(`elevBtn_${id}_${i}`, {
            diameter: 0.12, height: 0.05, tessellation: 10,
          }, scene);
          btn.rotation.x = Math.PI / 2;
          btn.position.set(ex + elevW / 2 + 0.4, 1.2, elevZ + 0.35);
          btn.material = callBtnMat;
          parent(btn);
        }
      }

      // ── Executive corner office (front-left) ─────────────────────
      const cornerX = -halfI;
      const cornerZ = -halfI;
      const officeW = halfI * 0.55;
      const officeD = halfI * 0.55;
      // Half-height partition walls (so it reads as an "office" but the
      // player can still see in over the top — and we don't risk
      // colliding with the building's actual walls).
      const partH = 1.8;
      // Wall along +X side (right side of the corner office)
      const wallEast = MeshBuilder.CreateBox(`exECorner_E_${id}`, {
        width: 0.12, height: partH, depth: officeD,
      }, scene);
      wallEast.position.set(cornerX + officeW, partH / 2, cornerZ + officeD / 2);
      wallEast.material = wallTrimMat;
      parent(wallEast);
      // Wall along +Z side (back side of the office, parallel to building front)
      const wallNorth = MeshBuilder.CreateBox(`exECorner_N_${id}`, {
        width: officeW, height: partH, depth: 0.12,
      }, scene);
      wallNorth.position.set(cornerX + officeW / 2, partH / 2, cornerZ + officeD);
      wallNorth.material = wallTrimMat;
      parent(wallNorth);
      // Big executive desk
      const exDesk = MeshBuilder.CreateBox(`exDesk_${id}`, {
        width: 2.0, height: 0.1, depth: 1.0,
      }, scene);
      exDesk.position.set(cornerX + officeW * 0.5, 0.85, cornerZ + officeD * 0.6);
      exDesk.material = deskMat;
      parent(exDesk);
      for (const [lx, lz] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]] as const) {
        const leg = MeshBuilder.CreateBox(`exDeskLeg_${id}_${lx}_${lz}`, {
          width: 0.1, height: 0.85, depth: 0.1,
        }, scene);
        leg.position.set(cornerX + officeW * 0.5 + lx, 0.42, cornerZ + officeD * 0.6 + lz);
        leg.material = deskMat;
        parent(leg);
      }
      // Executive chair
      const exChair = MeshBuilder.CreateBox(`exChair_${id}`, {
        width: 0.7, height: 0.5, depth: 0.7,
      }, scene);
      exChair.position.set(cornerX + officeW * 0.5, 0.45, cornerZ + officeD * 0.85);
      exChair.material = chairMat;
      parent(exChair);
      const exChairBack = MeshBuilder.CreateBox(`exChairBack_${id}`, {
        width: 0.7, height: 1.2, depth: 0.1,
      }, scene);
      exChairBack.position.set(cornerX + officeW * 0.5, 1.1, cornerZ + officeD * 0.85 + 0.3);
      exChairBack.material = chairMat;
      parent(exChairBack);
      // Monitor on the desk
      const exMon = MeshBuilder.CreateBox(`exMon_${id}`, {
        width: 1.0, height: 0.6, depth: 0.05,
      }, scene);
      exMon.position.set(cornerX + officeW * 0.5, 1.3, cornerZ + officeD * 0.6 - 0.3);
      exMon.material = screenMat;
      parent(exMon);
      // Couch against the office's east wall
      const couch = MeshBuilder.CreateBox(`exCouch_${id}`, {
        width: 0.8, height: 0.5, depth: 1.6,
      }, scene);
      couch.position.set(cornerX + officeW - 0.5, 0.25, cornerZ + officeD * 0.4);
      couch.material = pbr(scene, `couchMat_${id}`, new Color3(0.4, 0.18, 0.18), 0.7);
      parent(couch);
      const couchBack = MeshBuilder.CreateBox(`exCouchBack_${id}`, {
        width: 0.2, height: 0.8, depth: 1.6,
      }, scene);
      couchBack.position.set(cornerX + officeW - 0.2, 0.65, cornerZ + officeD * 0.4);
      couchBack.material = pbr(scene, `couchBackMat_${id}`, new Color3(0.4, 0.18, 0.18), 0.7);
      parent(couchBack);

      // ── Cubicle grid (front-right) ──────────────────────────────
      // 2×3 arrangement of cubicles. Each is a small desk + chair +
      // partial partitions on 2 sides.
      const cubX0 = halfI * 0.05;
      const cubZ0 = -halfI + 1.5;
      const cubW = (halfI - cubX0 - 0.5) / 3;
      const cubD = 1.6;
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 3; cx++) {
          const x = cubX0 + cx * cubW + cubW / 2;
          const z = cubZ0 + cy * (cubD + 0.6) + cubD / 2;
          // Desk (L-shape simplified to one rectangle)
          const desk = MeshBuilder.CreateBox(`cubDesk_${id}_${cx}_${cy}`, {
            width: cubW * 0.85, height: 0.08, depth: cubD * 0.55,
          }, scene);
          desk.position.set(x, 0.78, z - cubD * 0.15);
          desk.material = deskMat;
          parent(desk);
          // Monitor
          const mon = MeshBuilder.CreateBox(`cubMon_${id}_${cx}_${cy}`, {
            width: 0.7, height: 0.45, depth: 0.05,
          }, scene);
          mon.position.set(x, 1.18, z - cubD * 0.4);
          mon.material = screenMat;
          parent(mon);
          // Chair
          const chair = MeshBuilder.CreateBox(`cubChair_${id}_${cx}_${cy}`, {
            width: 0.5, height: 0.4, depth: 0.5,
          }, scene);
          chair.position.set(x, 0.2, z + 0.25);
          chair.material = chairMat;
          parent(chair);
          // Side partition (right wall of each cubicle, shared with neighbour)
          if (cx < 2) {
            const sidePart = MeshBuilder.CreateBox(`cubPartSide_${id}_${cx}_${cy}`, {
              width: 0.06, height: 1.2, depth: cubD,
            }, scene);
            sidePart.position.set(x + cubW / 2, 0.6, z);
            sidePart.material = partitionMat;
            parent(sidePart);
          }
          // Front (desk-facing) partition
          const frontPart = MeshBuilder.CreateBox(`cubPartFront_${id}_${cx}_${cy}`, {
            width: cubW, height: 1.2, depth: 0.06,
          }, scene);
          frontPart.position.set(x, 0.6, z - cubD * 0.5);
          frontPart.material = partitionMat;
          parent(frontPart);
        }
      }
      break;
    }
    case 'mine': {
      const oreMat = pbr(scene, `ore_${id}`, ORE_GRAY, 0.95);
      const steelMat = metal(scene, `mineSteel_${id}`, STEEL, 0.6);
      const darkSteelMat = metal(scene, `mineDarkSteel_${id}`, DARK_STEEL, 0.4);
      // Rails along the floor running into the mine shaft (back wall)
      for (const rSide of [-0.5, 0.5]) {
        const rail = MeshBuilder.CreateBox(`mineRail_${id}_${rSide}`, {
          width: 0.12, height: 0.08, depth: inner * 0.85,
        }, scene);
        rail.position.set(rSide, 0.04, 0);
        rail.material = darkSteelMat;
        parent(rail);
      }
      // Cross-ties under the rails
      for (let i = 0; i < 7; i++) {
        const tie = MeshBuilder.CreateBox(`mineTie_${id}_${i}`, {
          width: 1.5, height: 0.07, depth: 0.3,
        }, scene);
        tie.position.set(0, 0.035, -inner * 0.4 + i * (inner * 0.85 / 7));
        tie.material = wood;
        parent(tie);
      }
      // Minecart on the rails
      const cart = MeshBuilder.CreateBox(`cart_${id}`, {
        width: 1.5, height: 0.9, depth: 1.0,
      }, scene);
      cart.position.set(0, 0.55, halfI - 2);
      cart.material = steelMat;
      parent(cart);
      for (const wx of [-0.6, 0.6]) {
        for (const wz of [-0.4, 0.4]) {
          const wheel = MeshBuilder.CreateCylinder(`wheel_${id}_${wx}_${wz}`, {
            diameter: 0.5, height: 0.1, tessellation: 12,
          }, scene);
          wheel.position.set(wx, 0.25, halfI - 2 + wz);
          wheel.rotation.z = Math.PI / 2;
          wheel.material = darkSteelMat;
          parent(wheel);
        }
      }
      // Ore piles dotted around
      for (const [ox, oz, os] of [
        [-halfI + 1.8, halfI - 1.8, 1.2],
        [-halfI + 1.8, -halfI + 2.5, 0.9],
        [halfI - 1.8, halfI - 2, 1.5],
        [halfI - 2.5, -halfI + 2, 0.8],
      ] as const) {
        const pile = MeshBuilder.CreateSphere(`pile_${id}_${ox}_${oz}`, {
          diameter: os, segments: 8,
        }, scene);
        pile.position.set(ox, os / 2 - 0.2, oz);
        pile.scaling.y = 0.6;
        pile.material = oreMat;
        parent(pile);
      }
      // Tool rack against the side wall — pickaxe + shovel
      const rackBack = MeshBuilder.CreateBox(`mineToolRack_${id}`, {
        width: 0.1, height: 1.8, depth: 1.6,
      }, scene);
      rackBack.position.set(-halfI + 0.3, 0.9, -halfI + 2.5);
      rackBack.material = wood;
      parent(rackBack);
      // Pickaxe leaning on the rack
      const handle = MeshBuilder.CreateCylinder(`mineHandle_${id}`, {
        diameter: 0.09, height: 1.6, tessellation: 8,
      }, scene);
      handle.position.set(-halfI + 0.5, 0.8, -halfI + 2.0);
      handle.rotation.z = 0.2;
      handle.material = wood;
      parent(handle);
      const head = MeshBuilder.CreateBox(`mineHead_${id}`, {
        width: 0.6, height: 0.12, depth: 0.1,
      }, scene);
      head.position.set(-halfI + 0.5, 1.55, -halfI + 2.0);
      head.material = metal(scene, `mineHeadMat_${id}`, STEEL, 0.3);
      parent(head);
      // Shovel
      const shaft = MeshBuilder.CreateCylinder(`mineShaft_${id}`, {
        diameter: 0.07, height: 1.7, tessellation: 8,
      }, scene);
      shaft.position.set(-halfI + 0.5, 0.85, -halfI + 3.1);
      shaft.rotation.z = 0.15;
      shaft.material = wood;
      parent(shaft);
      const blade = MeshBuilder.CreateBox(`mineBlade_${id}`, {
        width: 0.3, height: 0.4, depth: 0.05,
      }, scene);
      blade.position.set(-halfI + 0.4, 0.2, -halfI + 3.1);
      blade.material = darkSteelMat;
      parent(blade);
      // Worktable with helmets and a lantern
      const tbl = MeshBuilder.CreateBox(`mineTbl_${id}`, {
        width: 1.6, height: 0.1, depth: 0.7,
      }, scene);
      tbl.position.set(halfI - 1.5, 0.85, -halfI + 1.5);
      tbl.material = wood;
      parent(tbl);
      for (const lx of [-0.6, 0]) {
        const tblLeg = MeshBuilder.CreateBox(`mineTblLeg_${id}_${lx}`, {
          width: 0.08, height: 0.85, depth: 0.08,
        }, scene);
        tblLeg.position.set(halfI - 1.5 + lx, 0.42, -halfI + 1.5);
        tblLeg.material = wood;
        parent(tblLeg);
      }
      // Helmet on the table
      const helmet = MeshBuilder.CreateSphere(`mineHelmet_${id}`, {
        diameter: 0.4, segments: 10,
      }, scene);
      helmet.scaling.y = 0.6;
      helmet.position.set(halfI - 1.7, 1.0, -halfI + 1.5);
      helmet.material = pbr(scene, `helmetMat_${id}`, new Color3(0.85, 0.55, 0.15), 0.7);
      parent(helmet);
      // Lantern on table
      const lantBase = MeshBuilder.CreateCylinder(`mineLantB_${id}`, {
        diameter: 0.18, height: 0.08, tessellation: 10,
      }, scene);
      lantBase.position.set(halfI - 1.2, 0.94, -halfI + 1.5);
      lantBase.material = darkSteelMat;
      parent(lantBase);
      const lantGlass = MeshBuilder.CreateSphere(`mineLantG_${id}`, {
        diameter: 0.22, segments: 10,
      }, scene);
      lantGlass.position.set(halfI - 1.2, 1.1, -halfI + 1.5);
      lantGlass.material = pbr(scene, `lantGlassMat_${id}`, new Color3(1.0, 0.85, 0.45), 0.2, new Color3(0.7, 0.55, 0.2));
      parent(lantGlass);
      // Wooden support beams holding up the (mine shaft) ceiling, back wall
      for (const bx of [-2, 0, 2]) {
        const support = MeshBuilder.CreateCylinder(`mineSupport_${id}_${bx}`, {
          diameter: 0.25, height: wallHeight - 0.3, tessellation: 10,
        }, scene);
        support.position.set(bx, (wallHeight - 0.3) / 2, halfI - 0.4);
        support.material = wood;
        parent(support);
      }
      // Crossbeam connecting the back-wall supports
      const beam = MeshBuilder.CreateBox(`mineBeam_${id}`, {
        width: 4.4, height: 0.25, depth: 0.25,
      }, scene);
      beam.position.set(0, wallHeight - 0.4, halfI - 0.4);
      beam.material = wood;
      parent(beam);
      break;
    }
    case 'factory': {
      // Two parallel conveyor belts running front-to-back, plus machine
      // blocks bookending each belt (input feeder + output stamper),
      // a control panel against the side wall, parts bins along the
      // back wall, and a pallet of crates near the loading dock.
      const beltMat = metal(scene, `beltMat_${id}`, DARK_STEEL, 0.65);
      const beltLegMat = metal(scene, `beltLegMat_${id}`, DARK_STEEL, 0.7);
      const machMat = metal(scene, `machMat_${id}`, STEEL, 0.55);
      const yellowMat = pbr(scene, `caution_${id}`, new Color3(0.85, 0.65, 0.15), 0.7);
      const screenMat = pbr(scene, `controlScreen_${id}`, new Color3(0.15, 0.55, 0.7), 0.2, new Color3(0.15, 0.4, 0.5));
      // Two conveyors, side-by-side
      for (let b = 0; b < 2; b++) {
        const bx = -inner * 0.18 + b * (inner * 0.36);
        const belt = MeshBuilder.CreateBox(`belt_${id}_${b}`, {
          width: 1.0, height: 0.2, depth: inner * 0.65,
        }, scene);
        belt.position.set(bx, 0.85, 0);
        belt.material = beltMat;
        parent(belt);
        for (let i = 0; i < 4; i++) {
          const leg = MeshBuilder.CreateBox(`beltLeg_${id}_${b}_${i}`, {
            width: 0.15, height: 0.75, depth: 0.15,
          }, scene);
          leg.position.set(bx, 0.37, -inner * 0.3 + i * inner * 0.2);
          leg.material = beltLegMat;
          parent(leg);
        }
        // Drum/roller at each belt end
        for (const endZ of [-inner * 0.32, inner * 0.32]) {
          const drum = MeshBuilder.CreateCylinder(`beltDrum_${id}_${b}_${endZ}`, {
            diameter: 0.4, height: 1.05, tessellation: 12,
          }, scene);
          drum.rotation.z = Math.PI / 2;
          drum.position.set(bx, 0.85, endZ);
          drum.material = beltLegMat;
          parent(drum);
        }
        // Stamper machine at one end of each belt
        const stamper = MeshBuilder.CreateBox(`stamper_${id}_${b}`, {
          width: 1.6, height: 2.4, depth: 1.4,
        }, scene);
        stamper.position.set(bx, 1.2, -inner * 0.4);
        stamper.material = machMat;
        parent(stamper);
        const stampHead = MeshBuilder.CreateBox(`stampHead_${id}_${b}`, {
          width: 1.0, height: 0.6, depth: 1.0,
        }, scene);
        stampHead.position.set(bx, 2.7, -inner * 0.4);
        stampHead.material = yellowMat;
        parent(stampHead);
        // Yellow caution stripe on belt sides
        const stripe = MeshBuilder.CreateBox(`beltStripe_${id}_${b}`, {
          width: 1.05, height: 0.05, depth: inner * 0.65,
        }, scene);
        stripe.position.set(bx, 0.96, 0);
        stripe.material = yellowMat;
        parent(stripe);
      }
      // Big machinery block on right side of the room
      const mach = MeshBuilder.CreateBox(`mach_${id}`, {
        width: 2.5, height: 2.2, depth: 2,
      }, scene);
      mach.position.set(halfI - 1.8, 1.1, halfI * 0.3);
      mach.material = machMat;
      parent(mach);
      const pipe = MeshBuilder.CreateCylinder(`pipe_${id}`, {
        diameter: 0.5, height: Math.min(2.8, wallHeight - 2.5), tessellation: 10,
      }, scene);
      pipe.position.set(halfI - 1.8, 2.2 + Math.min(2.8, wallHeight - 2.5) / 2, halfI * 0.3);
      pipe.material = metal(scene, `pipeMat_${id}`, STEEL, 0.5);
      parent(pipe);
      // Control panel — wall-mounted on the right wall
      const panel = MeshBuilder.CreateBox(`panel_${id}`, {
        width: 1.6, height: 1.1, depth: 0.2,
      }, scene);
      panel.position.set(halfI - 0.15, 1.5, -halfI + 3);
      panel.material = machMat;
      parent(panel);
      const screen = MeshBuilder.CreateBox(`panelScreen_${id}`, {
        width: 0.9, height: 0.55, depth: 0.05,
      }, scene);
      screen.position.set(halfI - 0.27, 1.7, -halfI + 3);
      screen.material = screenMat;
      parent(screen);
      // Parts bins along the back wall
      for (let i = 0; i < 4; i++) {
        const bin = MeshBuilder.CreateBox(`partBin_${id}_${i}`, {
          width: 0.9, height: 0.7, depth: 0.7,
        }, scene);
        bin.position.set(-halfI + 1.5 + i * 1.1, 0.35, halfI - 0.6);
        bin.material = pbr(scene, `partBinMat_${id}_${i}`, new Color3(0.4, 0.35, 0.32), 0.85);
        parent(bin);
      }
      // Pallet of crates near the front-left
      for (let i = 0; i < 4; i++) {
        const crate = MeshBuilder.CreateBox(`fCrate_${id}_${i}`, {
          width: 0.9, height: 0.7, depth: 0.9,
        }, scene);
        crate.position.set(-halfI + 1.2 + (i % 2) * 1.0, 0.35, -halfI + 1.5 + Math.floor(i / 2) * 1.0);
        crate.material = pbr(scene, `fCrateMat_${id}_${i}`, new Color3(0.55, 0.42, 0.28));
        parent(crate);
      }
      // Pallet under the crates
      const pallet = MeshBuilder.CreateBox(`pallet_${id}`, {
        width: 2.4, height: 0.1, depth: 2.4,
      }, scene);
      pallet.position.set(-halfI + 1.7, 0.05, -halfI + 2.0);
      pallet.material = pbr(scene, `palletMat_${id}`, new Color3(0.6, 0.45, 0.3), 0.9);
      parent(pallet);
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
      // Teller counter — moved deep into the room in FRONT of the vault.
      // Was at -halfI + 2.5 (right by the door, blocking the lobby). Now
      // at halfI - 5 so the player walks the lobby and approaches a row
      // of tellers backed against the vault wall.
      const counterZ = halfI - 5;
      const counter = MeshBuilder.CreateBox(`bCounter_${id}`, { width: inner * 0.75, height: 1.1, depth: 1.1 }, scene);
      counter.position.set(0, 0.55, counterZ);
      counter.material = wood;
      parent(counter);
      const top = MeshBuilder.CreateBox(`bTop_${id}`, { width: inner * 0.78, height: 0.12, depth: 1.15 }, scene);
      top.position.set(0, 1.16, counterZ);
      top.material = pbr(scene, `marble_${id}`, new Color3(0.88, 0.85, 0.82), 0.3);
      parent(top);
      // Cubicle bank behind the counter — 3 tellers separated by short
      // partition walls. Each cubicle has a desk surface, side dividers,
      // and a chair.
      const cubicleZ = counterZ + 1.6;
      const cubicleW = 1.8;
      const cubicleH = 1.4;
      const partitionMat = pbr(scene, `partition_${id}`, new Color3(0.55, 0.45, 0.38), 0.85);
      const chairMat = pbr(scene, `bankChair_${id}`, new Color3(0.18, 0.18, 0.22), 0.6);
      for (let i = -1; i <= 1; i++) {
        const cx = i * (cubicleW + 0.4);
        // Desk surface
        const desk = MeshBuilder.CreateBox(`bDesk_${id}_${i}`, {
          width: cubicleW * 0.85, height: 0.08, depth: 0.7,
        }, scene);
        desk.position.set(cx, 0.85, cubicleZ);
        desk.material = wood;
        parent(desk);
        // Desk legs (just two for visual)
        for (const legX of [-0.6, 0.6]) {
          const leg = MeshBuilder.CreateBox(`bDeskLeg_${id}_${i}_${legX}`, {
            width: 0.06, height: 0.85, depth: 0.06,
          }, scene);
          leg.position.set(cx + legX * cubicleW * 0.4, 0.425, cubicleZ);
          leg.material = wood;
          parent(leg);
        }
        // Side partitions between cubicles (only between, not on outermost edges)
        if (i < 1) {
          const partX = cx + cubicleW / 2 + 0.2;
          const partition = MeshBuilder.CreateBox(`bPart_${id}_${i}`, {
            width: 0.08, height: cubicleH, depth: 1.4,
          }, scene);
          partition.position.set(partX, cubicleH / 2 + 0.4, cubicleZ);
          partition.material = partitionMat;
          parent(partition);
        }
        // Chair behind the desk
        const chair = MeshBuilder.CreateBox(`bChair_${id}_${i}`, {
          width: 0.5, height: 0.5, depth: 0.5,
        }, scene);
        chair.position.set(cx, 0.45, cubicleZ + 0.65);
        chair.material = chairMat;
        parent(chair);
        // Chair backrest
        const back = MeshBuilder.CreateBox(`bChairBack_${id}_${i}`, {
          width: 0.5, height: 0.7, depth: 0.08,
        }, scene);
        back.position.set(cx, 0.85, cubicleZ + 0.85);
        back.material = chairMat;
        parent(back);
      }
      // Safe deposit boxes (grid on side wall) — moved up a row so the
      // bottom row sits at chest height instead of just-above-floor,
      // which had been reading as "gold bars on the floor."
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 6; c++) {
          const box = MeshBuilder.CreateBox(`safe_${id}_${r}_${c}`, { width: 0.2, height: 0.35, depth: 0.45 }, scene);
          box.position.set(halfI - 0.25, 1.4 + r * 0.45, -halfI + 2 + c * 0.8);
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
