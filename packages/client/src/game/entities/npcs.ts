import {
  Scene,
  MeshBuilder,
  Color3,
  StandardMaterial,
  AbstractMesh,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock } from '@babylonjs/gui';

/** Definition for a single NPC in Haven Point. */
export interface NPCDef {
  name: string;
  /** Babylon X coordinate (design coord minus 1000). */
  x: number;
  /** Babylon Z coordinate (design coord minus 1000). */
  z: number;
  role: 'job_board' | 'shopkeeper' | 'pedestrian' | 'guard';
  district: string;
  dialog: string;
}

// ---------------------------------------------------------------------------
// Static NPC data
// ---------------------------------------------------------------------------

export const NPC_DATA: NPCDef[] = [
  // Job board NPCs (yellow)
  {
    name: 'Officer Dawn',
    x: 400,
    z: -200,
    role: 'job_board',
    district: 'Downtown',
    dialog: 'Welcome to City Hall. Check the board for open positions.',
  },
  {
    name: 'Marco',
    x: 350,
    z: -400,
    role: 'job_board',
    district: 'Downtown',
    dialog: 'The Central Market always needs extra hands. Take a look!',
  },
  {
    name: 'Sarah',
    x: -500,
    z: 500,
    role: 'job_board',
    district: 'Residential',
    dialog: 'Our community center has volunteer work and paid gigs.',
  },
  {
    name: 'Big Tony',
    x: 500,
    z: 800,
    role: 'job_board',
    district: 'Industrial',
    dialog: 'Freight Yard is hiring. Heavy lifting, good pay.',
  },
  {
    name: 'Captain Lee',
    x: 700,
    z: -850,
    role: 'job_board',
    district: 'Waterfront',
    dialog: 'Need sea legs? The Marina has openings for deckhands.',
  },
  {
    name: 'DJ Neon',
    x: -500,
    z: -200,
    role: 'job_board',
    district: 'Entertainment',
    dialog: 'The Grand Stage needs performers and crew. Interested?',
  },

  // Guards (gray)
  {
    name: 'Guard #1',
    x: 800,
    z: 700,
    role: 'guard',
    district: 'Industrial',
    dialog: 'Move along, citizen. Nothing to see here.',
  },
  {
    name: 'Guard #2',
    x: 800,
    z: -700,
    role: 'guard',
    district: 'Waterfront',
    dialog: 'Keep it peaceful down by the docks.',
  },

  // Shopkeepers (gray)
  {
    name: 'Shopkeeper Amy',
    x: 200,
    z: -300,
    role: 'shopkeeper',
    district: 'Downtown',
    dialog: 'Browse my wares! Best prices in Haven Point.',
  },
  {
    name: 'Fisher Pete',
    x: 500,
    z: -800,
    role: 'shopkeeper',
    district: 'Waterfront',
    dialog: 'Fresh catch of the day! Also selling bait and tackle.',
  },
];

// ---------------------------------------------------------------------------
// Colours per role
// ---------------------------------------------------------------------------

const COLOR_JOB_BOARD = new Color3(0.9, 0.8, 0.2);
const COLOR_DEFAULT = new Color3(0.6, 0.6, 0.6);

function colorForRole(role: NPCDef['role']): Color3 {
  return role === 'job_board' ? COLOR_JOB_BOARD : COLOR_DEFAULT;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

/**
 * Create cylinder meshes for every static NPC and attach floating name labels.
 *
 * @param scene   The Babylon scene to spawn into.
 * @param labelUI A fullscreen AdvancedDynamicTexture for floating labels.
 * @returns       Array of all NPC meshes created.
 */
export function spawnNPCs(
  scene: Scene,
  labelUI: AdvancedDynamicTexture,
): AbstractMesh[] {
  const meshes: AbstractMesh[] = [];

  for (const npc of NPC_DATA) {
    // Cylinder body
    const mesh = MeshBuilder.CreateCylinder(
      `npc_${npc.name}`,
      { diameter: 1, height: 2, tessellation: 12 },
      scene,
    );
    mesh.position.set(npc.x, 1, npc.z);

    const mat = new StandardMaterial(`npcMat_${npc.name}`, scene);
    mat.diffuseColor = colorForRole(npc.role);
    mesh.material = mat;

    // Floating name label (same pattern as player labels in MainScene)
    const labelRect = new Rectangle(`npcLabel_${npc.name}`);
    labelRect.width = '120px';
    labelRect.height = '30px';
    labelRect.cornerRadius = 4;
    labelRect.color = 'transparent';
    labelRect.background = 'transparent';
    labelRect.thickness = 0;

    const labelText = new TextBlock(`npcLabelText_${npc.name}`, npc.name);
    labelText.color = '#FFD700';
    labelText.fontSize = 13;
    labelText.resizeToFit = true;
    labelRect.addControl(labelText);

    labelUI.addControl(labelRect);
    labelRect.linkWithMesh(mesh);
    labelRect.linkOffsetY = -120;

    meshes.push(mesh);
  }

  return meshes;
}
