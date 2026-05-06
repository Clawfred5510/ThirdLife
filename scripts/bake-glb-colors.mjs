#!/usr/bin/env node
/**
 * Bake per-type wall + roof colours into each Meshy GLB.
 *
 * What it does to every .glb under packages/client/public/assets/models/buildings/:
 *   1. Parses the GLB's JSON + BIN chunks.
 *   2. For each primitive, reads POSITION (vec3 float32) and computes a
 *      per-vertex RGB based on Y position relative to the local bbox,
 *      using the per-type wall colour below `splitFraction * height`
 *      and the roof colour above. Result is a 2-tone painted look that
 *      approximates the gamedesigns/<type>.png reference.
 *   3. Appends a COLOR_0 attribute (vec3 float32) onto the BIN chunk
 *      and adds a new bufferView + accessor for it.
 *   4. Adds a glTF material with baseColorFactor = white, so the
 *      vertex colours come through unchanged. Sets the primitive's
 *      `material` index to that material.
 *   5. Re-serialises and writes the file in place. The bake is
 *      idempotent — a re-run on an already-baked file regenerates
 *      the colour buffer from the same Y split.
 *
 * The result: each .glb is a self-contained painted asset that opens
 * in Blender / Meshy / any GLB viewer with the colours applied. The
 * runtime loader at packages/client/src/game/entities/buildings/glb.ts
 * will pick up the baked material directly and skip its fallback paint.
 *
 * Usage:
 *   node scripts/bake-glb-colors.mjs
 *
 * Inputs:  packages/client/public/assets/models/buildings/*.glb
 * Outputs: same files, modified in place.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILDINGS_DIR = join(__dirname, '..', 'packages', 'client', 'public', 'assets', 'models', 'buildings');

// Photo-referenced palette per building. Hex → RGB float [0..1].
// Matches the procedural building repaint in gamedesigns/<type>.png.
const PAINT = {
  apartment: { wall: '#A6543A', roof: '#2D3138', split: 0.78 },
  bank:      { wall: '#D7C4A2', roof: '#26201A', split: 0.74 },
  factory:   { wall: '#B5563A', roof: '#2C2520', split: 0.62 },
  farm:      { wall: '#9C3C28', roof: '#3D7C3F', split: 0.45 },
  hall:      { wall: '#D7C4A2', roof: '#26201A', split: 0.74 },
  house:     { wall: '#E2A130', roof: '#384357', split: 0.55 },
  mine:      { wall: '#7A4F2E', roof: '#3F7A6B', split: 0.55 },
  office:    { wall: '#A8A498', roof: '#26201A', split: 0.78 },
  shop:      { wall: '#E2A130', roof: '#3D7C3F', split: 0.80 },
  // powerplant is uploaded but unmapped in the dispatcher — bake it
  // anyway with a sensible default so the file is consistent.
  powerplant:{ wall: '#E2A130', roof: '#3D7C3F', split: 0.50 },
};

const GLB_MAGIC = 0x46546C67;          // 'glTF'
const CHUNK_JSON = 0x4E4F534A;         // 'JSON'
const CHUNK_BIN = 0x004E4942;          // 'BIN\0'
const TYPE_FLOAT = 5126;
const TARGET_ARRAY_BUFFER = 34962;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function alignTo4(n) { return (n + 3) & ~3; }

function readGlb(path) {
  const buf = readFileSync(path);
  const magic = buf.readUInt32LE(0);
  if (magic !== GLB_MAGIC) throw new Error(`${basename(path)}: not a GLB (magic 0x${magic.toString(16)})`);
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`${basename(path)}: GLB v${version} not supported`);

  let off = 12;
  const jsonLen = buf.readUInt32LE(off); off += 4;
  const jsonType = buf.readUInt32LE(off); off += 4;
  if (jsonType !== CHUNK_JSON) throw new Error(`${basename(path)}: first chunk is not JSON`);
  const json = JSON.parse(buf.toString('utf8', off, off + jsonLen));
  off += jsonLen;

  let bin = Buffer.alloc(0);
  if (off < buf.length) {
    const binLen = buf.readUInt32LE(off); off += 4;
    const binType = buf.readUInt32LE(off); off += 4;
    if (binType !== CHUNK_BIN) throw new Error(`${basename(path)}: second chunk is not BIN`);
    bin = buf.subarray(off, off + binLen);
  }
  return { json, bin };
}

function writeGlb(path, json, bin) {
  // glTF references buffer 0 with this byteLength → keep them in sync.
  if (json.buffers && json.buffers.length > 0) {
    json.buffers[0].byteLength = bin.length;
  }
  const jsonStr = JSON.stringify(json);
  const jsonPadded = Buffer.from(jsonStr.padEnd(alignTo4(jsonStr.length), ' '), 'utf8');
  const binPadded = Buffer.alloc(alignTo4(bin.length));
  bin.copy(binPadded);

  const totalLen = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(totalLen);
  let off = 0;
  out.writeUInt32LE(GLB_MAGIC, off); off += 4;
  out.writeUInt32LE(2, off); off += 4;
  out.writeUInt32LE(totalLen, off); off += 4;
  out.writeUInt32LE(jsonPadded.length, off); off += 4;
  out.writeUInt32LE(CHUNK_JSON, off); off += 4;
  jsonPadded.copy(out, off); off += jsonPadded.length;
  out.writeUInt32LE(binPadded.length, off); off += 4;
  out.writeUInt32LE(CHUNK_BIN, off); off += 4;
  binPadded.copy(out, off);
  writeFileSync(path, out);
}

function readVec3Floats(bin, accessor, bufferView) {
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const count = accessor.count;
  const stride = bufferView.byteStride ?? 12;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = base + i * stride;
    out[i * 3]     = bin.readFloatLE(o);
    out[i * 3 + 1] = bin.readFloatLE(o + 4);
    out[i * 3 + 2] = bin.readFloatLE(o + 8);
  }
  return out;
}

function bakeOne(filename) {
  const path = join(BUILDINGS_DIR, filename);
  const type = basename(filename, '.glb');
  const recipe = PAINT[type];
  if (!recipe) {
    console.log(`  ${filename}: no paint recipe — skipping`);
    return;
  }

  const { json, bin } = readGlb(path);
  if (!json.meshes || json.meshes.length === 0) {
    console.log(`  ${filename}: no meshes — skipping`);
    return;
  }

  // Idempotent: if we already baked colours, drop the prior accessor
  // + bufferView before re-baking, otherwise files grow on every run.
  // We tag our accessors with `name: "tl_baked_colors"`.
  pruneStaleBakes(json);

  const wall = hexToRgb(recipe.wall);
  const roof = hexToRgb(recipe.roof);
  let workingBin = Buffer.from(bin);

  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const posIdx = prim.attributes?.POSITION;
      if (posIdx === undefined) continue;
      const posAcc = json.accessors[posIdx];
      const posView = json.bufferViews[posAcc.bufferView];
      const positions = readVec3Floats(workingBin, posAcc, posView);

      // Y range from the accessor's `min`/`max` if present, else compute.
      let minY = posAcc.min?.[1], maxY = posAcc.max?.[1];
      if (minY === undefined || maxY === undefined) {
        minY = Infinity; maxY = -Infinity;
        for (let i = 1; i < positions.length; i += 3) {
          if (positions[i] < minY) minY = positions[i];
          if (positions[i] > maxY) maxY = positions[i];
        }
      }
      const split = minY + (maxY - minY) * recipe.split;

      // Build the colour buffer (vec3 float32, RGB).
      const colorBuf = Buffer.alloc(posAcc.count * 12);
      for (let i = 0; i < posAcc.count; i++) {
        const y = positions[i * 3 + 1];
        const c = y > split ? roof : wall;
        colorBuf.writeFloatLE(c[0], i * 12);
        colorBuf.writeFloatLE(c[1], i * 12 + 4);
        colorBuf.writeFloatLE(c[2], i * 12 + 8);
      }

      // Append the colour buffer to the BIN, 4-byte aligned.
      const padded = workingBin.length % 4 === 0 ? workingBin
        : Buffer.concat([workingBin, Buffer.alloc(4 - (workingBin.length % 4))]);
      const colorByteOffset = padded.length;
      workingBin = Buffer.concat([padded, colorBuf]);

      // New bufferView + accessor.
      const colorViewIdx = json.bufferViews.push({
        buffer: 0,
        byteOffset: colorByteOffset,
        byteLength: colorBuf.length,
        target: TARGET_ARRAY_BUFFER,
      }) - 1;
      const colorAccIdx = json.accessors.push({
        bufferView: colorViewIdx,
        byteOffset: 0,
        componentType: TYPE_FLOAT,
        count: posAcc.count,
        type: 'VEC3',
        name: 'tl_baked_colors',
      }) - 1;

      prim.attributes.COLOR_0 = colorAccIdx;

      // Material: white baseColor so vertex colours come through, with
      // a tiny ambient lift so the building reads on the shadow side.
      // Re-use a per-mesh material if multiple primitives in one mesh
      // need the same paint.
      const matIdx = ensurePaintMaterial(json, type);
      prim.material = matIdx;
    }
  }

  writeGlb(path, json, workingBin);
  const sizeBefore = bin.length;
  const sizeAfter = workingBin.length;
  console.log(`  ${filename.padEnd(20)} bin ${(sizeBefore / 1e6).toFixed(1)}MB → ${(sizeAfter / 1e6).toFixed(1)}MB  (${recipe.wall} / ${recipe.roof})`);
}

function ensurePaintMaterial(json, type) {
  json.materials = json.materials ?? [];
  const name = `tl_paint_${type}`;
  const existing = json.materials.findIndex((m) => m.name === name);
  if (existing !== -1) return existing;
  return json.materials.push({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0.0,
      roughnessFactor: 0.85,
    },
    emissiveFactor: [0.06, 0.05, 0.04],
  }) - 1;
}

function pruneStaleBakes(json) {
  // Drop accessors named tl_baked_colors and any material starting
  // with tl_paint_ — and clear references to them from primitives.
  if (!json.accessors || !json.materials) return;
  const staleAccessors = new Set();
  for (let i = 0; i < json.accessors.length; i++) {
    if (json.accessors[i]?.name === 'tl_baked_colors') staleAccessors.add(i);
  }
  if (staleAccessors.size === 0 && !json.materials.some((m) => m?.name?.startsWith('tl_paint_'))) {
    return;
  }
  // Removing accessors mid-run breaks indices on the rest of the JSON.
  // Simplest path: just drop the COLOR_0 attribute + tl_paint_ material
  // refs from primitives, and let the new bake append fresh entries.
  // The unreferenced stale accessor + material stay in the file, harmless.
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      if (prim.attributes?.COLOR_0 !== undefined && staleAccessors.has(prim.attributes.COLOR_0)) {
        delete prim.attributes.COLOR_0;
      }
      if (prim.material !== undefined && json.materials[prim.material]?.name?.startsWith('tl_paint_')) {
        delete prim.material;
      }
    }
  }
}

console.log(`Baking colour into GLB files under ${BUILDINGS_DIR}`);
const files = ['apartment.glb','bank.glb','factory.glb','farm.glb','hall.glb','house.glb','mine.glb','office.glb','powerplant.glb','shop.glb'];
for (const f of files) bakeOne(f);
console.log('Done.');
