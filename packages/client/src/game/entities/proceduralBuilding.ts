import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  Color3,
  Color4,
  PBRMetallicRoughnessMaterial,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';

/**
 * Cartoony rounded building generator. Produces a `TransformNode` with
 * a hollow interior, a doorway opening on the front (-Z) face, and
 * window panes on the visible faces.
 *
 * Footprint is parameterized so a building can fill ~85% of its parcel
 * cell. Walls are decomposed into 4 strips around the door opening so
 * we never need CSG to carve the doorway.
 */

export interface BuildingSpec {
  /** Horizontal footprint in world units (square). */
  footprint: number;
  /** Wall height in world units (eaves height). */
  wallHeight: number;
  /** Roof peak height above eaves. */
  roofPeak: number;
  /** Wall thickness — interior wall sits this far in from the outer wall. */
  wallThickness: number;
  /** Door width × height in world units. */
  doorWidth: number;
  doorHeight: number;
  /** Primary wall color. */
  wallColor: string;
  /** Roof color. */
  roofColor: string;
  /** Door + window frame trim color. */
  trimColor: string;
}

export interface BuildingOutput {
  root: TransformNode;
  /** Outer-facing meshes registered as shadow casters by the scene. */
  exteriorCasters: AbstractMesh[];
  /** Wall strips that should block player collision (everything except the doorway). */
  collisionWalls: AbstractMesh[];
}

const hexToColor = (hex: string): Color3 => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
};

function pbr(scene: Scene, name: string, color: Color3, roughness = 0.85): PBRMetallicRoughnessMaterial {
  const m = new PBRMetallicRoughnessMaterial(name, scene);
  m.baseColor = color;
  m.metallic = 0;
  m.roughness = roughness;
  return m;
}

/**
 * Build the exterior + interior of a building at world position. The
 * caller is responsible for parenting the returned root and registering
 * casters/collisions with the scene's shadow generator + collision system.
 */
export function buildProceduralBuilding(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`procBuilding_${id}`, scene);
  root.position.copyFrom(position);

  const half = spec.footprint / 2;
  const innerHalf = half - spec.wallThickness;
  const wallH = spec.wallHeight;
  const doorW = spec.doorWidth;
  const doorH = spec.doorHeight;

  const wallMat = pbr(scene, `wall_${id}`, hexToColor(spec.wallColor), 0.9);
  const roofMat = pbr(scene, `roof_${id}`, hexToColor(spec.roofColor), 0.7);
  const trimMat = pbr(scene, `trim_${id}`, hexToColor(spec.trimColor), 0.5);
  const interiorMat = pbr(scene, `int_${id}`, new Color3(0.94, 0.9, 0.84), 0.95);
  const floorMat = pbr(scene, `floor_${id}`, new Color3(0.55, 0.42, 0.32), 0.8);
  const glassMat = pbr(scene, `glass_${id}`, new Color3(0.85, 0.95, 1.0), 0.12);
  glassMat.metallic = 0.1;
  glassMat.alpha = 0.6;
  glassMat.emissiveColor = new Color3(0.85, 0.92, 1.0);

  const windowFrameMat = pbr(scene, `winFrame_${id}`, hexToColor(spec.trimColor), 0.6);

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  // ──────────────────────────────────────────────────────────────────
  // Floor + ceiling (interior surfaces, sit just inside the walls)
  // ──────────────────────────────────────────────────────────────────
  const floor = MeshBuilder.CreateBox(`floor_${id}`, {
    width: innerHalf * 2, height: 0.1, depth: innerHalf * 2,
  }, scene);
  floor.parent = root;
  floor.position.y = 0.05;
  floor.material = floorMat;
  floor.receiveShadows = true;

  const ceiling = MeshBuilder.CreateBox(`ceiling_${id}`, {
    width: innerHalf * 2, height: 0.1, depth: innerHalf * 2,
  }, scene);
  ceiling.parent = root;
  ceiling.position.y = wallH - 0.05;
  ceiling.material = interiorMat;

  // ──────────────────────────────────────────────────────────────────
  // Walls: 4 sides, each (mostly) one chamfered box. The FRONT (-Z)
  // wall is decomposed into left/right jambs + lintel around the
  // doorway so the door opening exists without any CSG.
  // ──────────────────────────────────────────────────────────────────

  // Left wall (-X)
  const wallL = MeshBuilder.CreateBox(`wallL_${id}`, {
    width: spec.wallThickness, height: wallH, depth: spec.footprint,
  }, scene);
  wallL.parent = root;
  wallL.position.set(-half + spec.wallThickness / 2, wallH / 2, 0);
  wallL.material = wallMat;
  wallL.receiveShadows = true;
  wallL.checkCollisions = true;
  exteriorCasters.push(wallL);
  collisionWalls.push(wallL);

  // Right wall (+X)
  const wallR = MeshBuilder.CreateBox(`wallR_${id}`, {
    width: spec.wallThickness, height: wallH, depth: spec.footprint,
  }, scene);
  wallR.parent = root;
  wallR.position.set(half - spec.wallThickness / 2, wallH / 2, 0);
  wallR.material = wallMat;
  wallR.receiveShadows = true;
  wallR.checkCollisions = true;
  exteriorCasters.push(wallR);
  collisionWalls.push(wallR);

  // Back wall (+Z)
  const wallB = MeshBuilder.CreateBox(`wallB_${id}`, {
    width: spec.footprint - spec.wallThickness * 2, height: wallH, depth: spec.wallThickness,
  }, scene);
  wallB.parent = root;
  wallB.position.set(0, wallH / 2, half - spec.wallThickness / 2);
  wallB.material = wallMat;
  wallB.receiveShadows = true;
  wallB.checkCollisions = true;
  exteriorCasters.push(wallB);
  collisionWalls.push(wallB);

  // Front wall (-Z) decomposed: left jamb + right jamb + lintel above door
  const innerWidth = spec.footprint - spec.wallThickness * 2;
  const sideWidth = (innerWidth - doorW) / 2;
  const lintelH = wallH - doorH;

  const jambL = MeshBuilder.CreateBox(`jambL_${id}`, {
    width: sideWidth, height: wallH, depth: spec.wallThickness,
  }, scene);
  jambL.parent = root;
  jambL.position.set(-doorW / 2 - sideWidth / 2, wallH / 2, -half + spec.wallThickness / 2);
  jambL.material = wallMat;
  jambL.receiveShadows = true;
  jambL.checkCollisions = true;
  exteriorCasters.push(jambL);
  collisionWalls.push(jambL);

  const jambR = MeshBuilder.CreateBox(`jambR_${id}`, {
    width: sideWidth, height: wallH, depth: spec.wallThickness,
  }, scene);
  jambR.parent = root;
  jambR.position.set(doorW / 2 + sideWidth / 2, wallH / 2, -half + spec.wallThickness / 2);
  jambR.material = wallMat;
  jambR.receiveShadows = true;
  jambR.checkCollisions = true;
  exteriorCasters.push(jambR);
  collisionWalls.push(jambR);

  const lintel = MeshBuilder.CreateBox(`lintel_${id}`, {
    width: doorW, height: lintelH, depth: spec.wallThickness,
  }, scene);
  lintel.parent = root;
  lintel.position.set(0, doorH + lintelH / 2, -half + spec.wallThickness / 2);
  lintel.material = wallMat;
  lintel.receiveShadows = true;
  lintel.checkCollisions = true;
  exteriorCasters.push(lintel);
  collisionWalls.push(lintel);

  // Door frame trim — top + 2 side strips for a clear opening cue
  const frameTop = MeshBuilder.CreateBox(`frameTop_${id}`, {
    width: doorW + 0.5, height: 0.25, depth: spec.wallThickness * 1.2,
  }, scene);
  frameTop.parent = root;
  frameTop.position.set(0, doorH + 0.05, -half + spec.wallThickness / 2);
  frameTop.material = trimMat;
  frameTop.receiveShadows = true;

  const frameL = MeshBuilder.CreateBox(`frameL_${id}`, {
    width: 0.2, height: doorH, depth: spec.wallThickness * 1.2,
  }, scene);
  frameL.parent = root;
  frameL.position.set(-doorW / 2 - 0.1, doorH / 2, -half + spec.wallThickness / 2);
  frameL.material = trimMat;
  frameL.receiveShadows = true;

  const frameR = MeshBuilder.CreateBox(`frameR_${id}`, {
    width: 0.2, height: doorH, depth: spec.wallThickness * 1.2,
  }, scene);
  frameR.parent = root;
  frameR.position.set(doorW / 2 + 0.1, doorH / 2, -half + spec.wallThickness / 2);
  frameR.material = trimMat;
  frameR.receiveShadows = true;

  // Awning above the door — overhangs the entrance
  const awningWidth = doorW + 1.6;
  const awningDepth = 1.4;
  const awning = MeshBuilder.CreateBox(`awning_${id}`, {
    width: awningWidth, height: 0.25, depth: awningDepth,
  }, scene);
  awning.parent = root;
  awning.position.set(0, doorH + 0.5, -half - awningDepth / 2 + 0.3);
  awning.material = trimMat;
  awning.receiveShadows = true;
  exteriorCasters.push(awning);

  // ──────────────────────────────────────────────────────────────────
  // Roof — soft dome with overhanging eaves, cartoon-friendly silhouette
  // ──────────────────────────────────────────────────────────────────
  const roofOverhang = 1.0;
  const eavesThickness = 0.4;

  // Eaves: a flat slab that sits on top of the walls and extends past them
  const eaves = MeshBuilder.CreateBox(`eaves_${id}`, {
    width: spec.footprint + roofOverhang * 2,
    height: eavesThickness,
    depth: spec.footprint + roofOverhang * 2,
  }, scene);
  eaves.parent = root;
  eaves.position.y = wallH + eavesThickness / 2;
  eaves.material = trimMat;
  eaves.receiveShadows = true;
  exteriorCasters.push(eaves);

  // Dome on top: stretched sphere for soft cartoon silhouette
  const roof = MeshBuilder.CreateSphere(`roof_${id}`, {
    diameter: spec.footprint * 1.05,
    segments: 16,
  }, scene);
  roof.parent = root;
  roof.position.y = wallH + eavesThickness;
  roof.scaling.y = spec.roofPeak / spec.footprint * 1.6;
  roof.material = roofMat;
  roof.receiveShadows = true;
  exteriorCasters.push(roof);

  // ──────────────────────────────────────────────────────────────────
  // Rounded corner posts — soften the boxy silhouette at the 4 vertical
  // edges. Cylinders sit just outside the wall corners.
  // ──────────────────────────────────────────────────────────────────
  const cornerRadius = spec.wallThickness * 1.6;
  const cornerOffsets: Array<[number, number]> = [
    [-half, -half], [half, -half], [-half, half], [half, half],
  ];
  for (const [cx, cz] of cornerOffsets) {
    const post = MeshBuilder.CreateCylinder(`post_${id}_${cx}_${cz}`, {
      diameter: cornerRadius * 2,
      height: wallH,
      tessellation: 14,
    }, scene);
    post.parent = root;
    post.position.set(cx, wallH / 2, cz);
    post.material = trimMat;
    post.receiveShadows = true;
    exteriorCasters.push(post);
  }

  // ──────────────────────────────────────────────────────────────────
  // Windows — large + framed, on every face except the door face. Each
  // window is a glass pane sitting flush against a darker frame, so it
  // reads as a proper window from a distance.
  // ──────────────────────────────────────────────────────────────────
  const winW = Math.min(2.4, spec.footprint / 5);
  const winH_ = Math.min(2.0, wallH * 0.45);
  const winY = wallH * 0.55;
  const frameThickness = spec.wallThickness * 0.4;
  const glassDepth = spec.wallThickness * 0.6;

  const placeWindow = (face: 'L' | 'R' | 'B', offset: number) => {
    // Size depends on which face: side faces use depth, back face uses width
    const wW = face === 'B' ? winW : glassDepth;
    const wH = winH_;
    const wD = face === 'B' ? glassDepth : winW;

    // Frame (slightly bigger box behind the glass)
    const frame = MeshBuilder.CreateBox(`winFr_${id}_${face}_${offset.toFixed(1)}`, {
      width: wW + (face === 'B' ? frameThickness * 2 : 0),
      height: wH + frameThickness * 2,
      depth: wD + (face === 'B' ? 0 : frameThickness * 2),
    }, scene);
    frame.parent = root;
    if (face === 'L') {
      frame.position.set(-half + glassDepth / 2 - 0.001, winY, offset);
    } else if (face === 'R') {
      frame.position.set(half - glassDepth / 2 + 0.001, winY, offset);
    } else {
      frame.position.set(offset, winY, half - glassDepth / 2 + 0.001);
    }
    frame.material = windowFrameMat;
    frame.receiveShadows = true;

    // Glass pane (sits in front of the frame on the visible side)
    const glass = MeshBuilder.CreateBox(`win_${id}_${face}_${offset.toFixed(1)}`, {
      width: wW, height: wH, depth: wD,
    }, scene);
    glass.parent = frame;
    glass.material = glassMat;
  };

  const winSpacing = spec.footprint * 0.28;
  placeWindow('L', -winSpacing);
  placeWindow('L', winSpacing);
  placeWindow('R', -winSpacing);
  placeWindow('R', winSpacing);
  placeWindow('B', -winSpacing);
  placeWindow('B', winSpacing);

  // ──────────────────────────────────────────────────────────────────
  // Front-face windows on the jambs (one per side of the door)
  // ──────────────────────────────────────────────────────────────────
  const placeFrontWindow = (xOff: number) => {
    const wW = Math.min(1.6, sideWidth * 0.7);
    const wH = winH_;
    const wD = glassDepth;
    const frame = MeshBuilder.CreateBox(`winFrFront_${id}_${xOff.toFixed(1)}`, {
      width: wW + frameThickness * 2,
      height: wH + frameThickness * 2,
      depth: wD,
    }, scene);
    frame.parent = root;
    frame.position.set(xOff, winY, -half + glassDepth / 2 - 0.001);
    frame.material = windowFrameMat;
    frame.receiveShadows = true;

    const glass = MeshBuilder.CreateBox(`winFront_${id}_${xOff.toFixed(1)}`, {
      width: wW, height: wH, depth: wD,
    }, scene);
    glass.parent = frame;
    glass.material = glassMat;
  };
  placeFrontWindow(-doorW / 2 - sideWidth / 2);
  placeFrontWindow(doorW / 2 + sideWidth / 2);

  // ──────────────────────────────────────────────────────────────────
  // Chimney — small accent on the back-right of the roof
  // ──────────────────────────────────────────────────────────────────
  const chimney = MeshBuilder.CreateBox(`chimney_${id}`, {
    width: 0.9, height: 1.8, depth: 0.9,
  }, scene);
  chimney.parent = root;
  chimney.position.set(half * 0.5, wallH + spec.roofPeak * 0.5 + 0.4, half * 0.4);
  chimney.material = trimMat;
  chimney.receiveShadows = true;
  exteriorCasters.push(chimney);

  return { root, exteriorCasters, collisionWalls };
}

/**
 * Default specs per building type. Warm earth-tone palette inspired by
 * Stardew Valley / Animal Crossing — saturated but cozy, never garish.
 * Each type gets a distinct color identity so the city reads as varied
 * without unique authored geometry per type.
 */
export const BUILDING_SPECS: Record<string, BuildingSpec> = {
  apartment: { footprint: 32, wallHeight: 8,  roofPeak: 4,   wallThickness: 0.5, doorWidth: 2.6, doorHeight: 3.2, wallColor: '#e8c89a', roofColor: '#8a3a2a', trimColor: '#3a2418' },
  house:     { footprint: 28, wallHeight: 6,  roofPeak: 3.5, wallThickness: 0.5, doorWidth: 2.4, doorHeight: 3.0, wallColor: '#f4dcb8', roofColor: '#4a7a4a', trimColor: '#3a2418' },
  shop:      { footprint: 30, wallHeight: 6,  roofPeak: 2.5, wallThickness: 0.5, doorWidth: 3.2, doorHeight: 3.0, wallColor: '#f4d878', roofColor: '#b04a2a', trimColor: '#5a1810' },
  farm:      { footprint: 30, wallHeight: 6,  roofPeak: 4,   wallThickness: 0.5, doorWidth: 3.0, doorHeight: 3.0, wallColor: '#b03a2a', roofColor: '#3a2418', trimColor: '#f5e4c8' },
  market:    { footprint: 34, wallHeight: 7,  roofPeak: 3,   wallThickness: 0.5, doorWidth: 4.0, doorHeight: 3.2, wallColor: '#f0c878', roofColor: '#3a6a3a', trimColor: '#3a2418' },
  office:    { footprint: 32, wallHeight: 9,  roofPeak: 2,   wallThickness: 0.5, doorWidth: 2.8, doorHeight: 3.2, wallColor: '#d4b890', roofColor: '#4a5a7a', trimColor: '#2a1f1a' },
  mine:      { footprint: 30, wallHeight: 5,  roofPeak: 2,   wallThickness: 0.6, doorWidth: 4.5, doorHeight: 3.5, wallColor: '#9a7858', roofColor: '#3a2418', trimColor: '#1f1410' },
  hall:      { footprint: 36, wallHeight: 9,  roofPeak: 4.5, wallThickness: 0.5, doorWidth: 3.6, doorHeight: 3.6, wallColor: '#e8c898', roofColor: '#7a2a3a', trimColor: '#3a1424' },
  factory:   { footprint: 34, wallHeight: 8,  roofPeak: 2,   wallThickness: 0.6, doorWidth: 5.0, doorHeight: 3.8, wallColor: '#a89880', roofColor: '#2a3028', trimColor: '#1a1c14' },
  bank:      { footprint: 34, wallHeight: 9,  roofPeak: 3,   wallThickness: 0.6, doorWidth: 3.0, doorHeight: 3.4, wallColor: '#f4ead4', roofColor: '#3a5a3a', trimColor: '#2a3a2a' },
};

/** Default spec for a building of unknown type. */
export const DEFAULT_BUILDING_SPEC: BuildingSpec = BUILDING_SPECS.apartment;
