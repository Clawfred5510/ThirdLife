import {
  Scene,
  MeshBuilder,
  Vector3,
  Color3,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import { buildFurniture } from '../buildingFurniture';
import { BuildingSpec, BuildingOutput, buildInteriorShell, buildMailbox, mat } from './shared';
import { buildDome } from './roofPrimitives';

/**
 * APARTMENT composition:
 * - Multi-storey residential block (28×24) with flat roof + parapet
 * - Mid-height cornice band (visually breaks into "floors")
 * - Rooftop water tower (cylinder + hemisphere cap + lattice legs)
 * - 2-3 rooftop AC/HVAC units
 * - Grid of floor-height windows on all facades
 * - Cluster of 4 mailboxes at the sidewalk
 * - 2 small trees flanking the entrance
 * - Small shared garden planter by the door
 */
export function buildApartment(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`apt_${id}`, scene);
  root.position.copyFrom(position);

  const lotD = 32;
  const lotHalfD = lotD / 2;

  const buildingW = 26;
  const buildingD = 22;
  const wallH = spec.wallHeight;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  const wallMat = mat(scene, 'apt-wall', '#D8C9A8', 0.88);
  const trimMat = mat(scene, 'apt-trim', '#3A2820', 0.6);
  const corniceMat = mat(scene, 'apt-cornice', '#F0E8D4', 0.55);
  const parapetMat = mat(scene, 'apt-parapet', '#4A4E58', 0.7);
  const glassMat = mat(scene, 'apt-glass', '#A8C4D8', 0.15, { alpha: 0.5, emissive: new Color3(0.25, 0.35, 0.45) });
  const metalMat = mat(scene, 'apt-metal', '#7A8090', 0.45, { metallic: 0.55 });
  const plantMat = mat(scene, 'apt-plant', '#3A7A3A', 0.95);
  const trunkMat = mat(scene, 'apt-trunk', '#5A3A22', 0.9);

  const body = new TransformNode(`aptBody_${id}`, scene);
  body.parent = root;

  const shell = buildInteriorShell(
    scene, id, body, spec,
    buildingW, buildingD,
    exteriorCasters, collisionWalls,
    wallMat, trimMat,
  );

  // ── FLAT ROOF ───────────────────────────────────────────────────────
  const slab = MeshBuilder.CreateBox(`aptRoof_${id}`, {
    width: buildingW + 0.5, height: 0.4, depth: buildingD + 0.5,
  }, scene);
  slab.parent = body;
  slab.position.y = wallH + 0.2;
  slab.material = parapetMat;
  slab.receiveShadows = true;
  exteriorCasters.push(slab);
  // Parapet rim
  const parW = buildingW + 0.5;
  const parD = buildingD + 0.5;
  for (const [w2, d2, x2, z2] of [
    [parW, 0.35, 0, parD / 2 + 0.17],
    [parW, 0.35, 0, -parD / 2 - 0.17],
    [0.35, parD + 0.7, parW / 2 + 0.17, 0],
    [0.35, parD + 0.7, -parW / 2 - 0.17, 0],
  ] as const) {
    const seg = MeshBuilder.CreateBox(`aptPar_${id}_${x2}_${z2}`, { width: w2, height: 0.9, depth: d2 }, scene);
    seg.parent = body;
    seg.position.set(x2, wallH + 0.85, z2);
    seg.material = parapetMat;
    exteriorCasters.push(seg);
  }

  // ── MID-HEIGHT CORNICE BAND ─────────────────────────────────────────
  const cornice = MeshBuilder.CreateBox(`aptCornice_${id}`, {
    width: buildingW + 0.4, height: 0.45, depth: buildingD + 0.4,
  }, scene);
  cornice.parent = body;
  cornice.position.y = wallH * 0.5;
  cornice.material = corniceMat;
  exteriorCasters.push(cornice);

  // ── WATER TOWER on the rooftop ──────────────────────────────────────
  const wtX = -buildingW * 0.25;
  const wtZ = buildingD * 0.25;
  const wtLegY = wallH + 0.4;
  // 4 lattice legs
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = wtX + Math.cos(ang) * 1.0;
    const lz = wtZ + Math.sin(ang) * 1.0;
    const leg = MeshBuilder.CreateBox(`wtLeg_${id}_${i}`, { width: 0.15, height: 2.2, depth: 0.15 }, scene);
    leg.parent = body;
    leg.position.set(lx, wtLegY + 1.1, lz);
    leg.material = metalMat;
  }
  const drum = MeshBuilder.CreateCylinder(`wtDrum_${id}`, {
    diameter: 2.4, height: 3.0, tessellation: 18,
  }, scene);
  drum.parent = body;
  drum.position.set(wtX, wtLegY + 3.7, wtZ);
  drum.material = metalMat;
  drum.receiveShadows = true;
  exteriorCasters.push(drum);
  // Cap
  const cap = buildDome(scene, `wtCap_${id}`, 2.4, 0.6);
  cap.parent = body;
  cap.position.set(wtX, wtLegY + 5.2, wtZ);
  cap.material = metalMat;
  exteriorCasters.push(cap);

  // ── ROOFTOP AC UNITS ────────────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    const ac = MeshBuilder.CreateBox(`aptAC_${id}_${i}`, {
      width: 1.4, height: 0.9, depth: 1.2,
    }, scene);
    ac.parent = body;
    ac.position.set(buildingW * 0.2 + i * 1.8, wallH + 0.85, -buildingD * 0.2);
    ac.material = metalMat;
    ac.receiveShadows = true;
    exteriorCasters.push(ac);
  }

  // ── WINDOW GRID on every facade ─────────────────────────────────────
  // 3 rows × 4 columns of windows on front + back, 3×3 on sides
  const placeWindowGrid = (
    face: 'F' | 'B' | 'L' | 'R',
    cols: number, rows: number,
  ) => {
    const isSide = face === 'L' || face === 'R';
    const faceWidth = isSide ? buildingD : buildingW;
    const faceInset = spec.wallThickness * 0.6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Skip windows that would overlap the doorway (front face, bottom row, center column)
        if (face === 'F' && r === 0 && Math.abs(c - (cols - 1) / 2) < 1) continue;
        const tu = (c + 1) / (cols + 1);
        const tv = (r + 1) / (rows + 1);
        const offT = (tu - 0.5) * (faceWidth - 2);
        const offY = tv * wallH - wallH / 2;
        const winW = 1.2;
        const winH = 1.5;
        const frame = MeshBuilder.CreateBox(`aptWinFr_${id}_${face}_${r}_${c}`, {
          width: isSide ? faceInset : winW + 0.15,
          height: winH + 0.15,
          depth: isSide ? winW + 0.15 : faceInset,
        }, scene);
        frame.parent = body;
        const y = wallH / 2 + offY;
        if (face === 'F') frame.position.set(offT, y, -buildingD / 2 + faceInset / 2);
        else if (face === 'B') frame.position.set(offT, y, buildingD / 2 - faceInset / 2);
        else if (face === 'L') frame.position.set(-buildingW / 2 + faceInset / 2, y, offT);
        else frame.position.set(buildingW / 2 - faceInset / 2, y, offT);
        frame.material = trimMat;

        const glass = MeshBuilder.CreateBox(`aptWin_${id}_${face}_${r}_${c}`, {
          width: isSide ? faceInset * 0.55 : winW,
          height: winH,
          depth: isSide ? winW : faceInset * 0.55,
        }, scene);
        glass.parent = frame;
        glass.material = glassMat;
      }
    }
  };
  placeWindowGrid('F', 5, 3);
  placeWindowGrid('B', 5, 3);
  placeWindowGrid('L', 4, 3);
  placeWindowGrid('R', 4, 3);

  // ── MAILBOX CLUSTER at sidewalk ─────────────────────────────────────
  for (let i = 0; i < 4; i++) {
    buildMailbox(scene, `${id}_${i}`, root, -3 + i * 1.2, -lotHalfD - 0.5, trimMat);
  }

  // ── 2 TREES flanking the entrance ───────────────────────────────────
  for (const tx of [-buildingW / 2 - 2.5, buildingW / 2 + 2.5]) {
    const trunk = MeshBuilder.CreateCylinder(`aptTrunk_${id}_${tx}`, {
      diameter: 0.4, height: 2.0, tessellation: 8,
    }, scene);
    trunk.parent = root;
    trunk.position.set(tx, 1.0, -buildingD / 2 - 2);
    trunk.material = trunkMat;
    const leaves = MeshBuilder.CreateSphere(`aptLeaves_${id}_${tx}`, {
      diameter: 2.6, segments: 12,
    }, scene);
    leaves.parent = root;
    leaves.position.set(tx, 3.5, -buildingD / 2 - 2);
    leaves.material = plantMat;
  }

  // ── PLANTER beside the entrance ─────────────────────────────────────
  const planter = MeshBuilder.CreateBox(`aptPlanter_${id}`, {
    width: 3.0, height: 0.5, depth: 0.8,
  }, scene);
  planter.parent = body;
  planter.position.set(spec.doorWidth / 2 + 2.5, 0.25, -buildingD / 2 - 0.9);
  planter.material = trimMat;
  // Flowers in planter
  for (let i = 0; i < 4; i++) {
    const f = MeshBuilder.CreateSphere(`aptFlower_${id}_${i}`, {
      diameter: 0.35, segments: 8,
    }, scene);
    f.parent = body;
    f.position.set(spec.doorWidth / 2 + 2.5 - 1.2 + i * 0.8, 0.7, -buildingD / 2 - 0.9);
    f.material = mat(scene, `aptPetal-${i}`, i % 2 === 0 ? '#D870A0' : '#F0C850', 0.7);
  }

  // Furniture
  const furn = buildFurniture(scene, id, 'apartment', Math.min(buildingW, buildingD) - spec.wallThickness * 2, wallH);
  furn.root.parent = body;

  const roofMeshes: AbstractMesh[] = [shell.ceiling];
  for (const m of exteriorCasters.slice(shell.wallsAdded)) {
    if (m.getAbsolutePosition().y > 2.5) roofMeshes.push(m);
  }

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [buildingW / 2, buildingD / 2],
  };
}
