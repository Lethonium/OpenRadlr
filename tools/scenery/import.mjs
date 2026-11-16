#!/usr/bin/env node
/**
 * Imports a model from an open pack into the project's own geometry format
 * (#117).
 *
 * The renderer draws one kind of triangle: a position, a face normal and one
 * RGBA colour (`renderer.js`). It has no textures and no UVs. Packs are either
 * untextured already (Quaternius's low-poly packs) or carry a single "colormap"
 * (Kenney's kits), so the importer does the only thing that can bridge them:
 *
 * - strip UVs and tangents;
 * - give each triangle the colour of the map under its centroid, or of its
 *   material when the pack has no map;
 * - re-origin to the base centre, so a placement puts the model on the ground;
 * - quantise to centimetres, which is far finer than a pixel at any distance
 *   the camera reaches and halves the file.
 *
 * Normals are dropped: `MeshBuilder.triangle` recomputes them from winding,
 * and a flat-shaded face has one normal anyway.
 *
 *   node tools/scenery/import.mjs <kit> <file.glb|file.obj> [--name x] [--scale 1]
 *
 * The kit's manifest records where the model came from; `check.mjs` refuses
 * anything that is not CC0.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, basename, extname } from "node:path";
import { inflateSync } from "node:zlib";

/** Positions in centimetres: 1 = 1 m, so this is 0.01 m. */
const QUANTUM = 100;

// `+ 0` turns -0 into 0, so a part turned about its own edge reads the same.
const q = (value) => Math.round(value * QUANTUM) / QUANTUM + 0;

// ------------------------------------------------------------------- GLB ---

/** The JSON and BIN halves of a GLB container. */
export function splitGlb(file) {
  const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB file");
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error("GLB has no JSON chunk first");
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  const binStart = 20 + jsonLength;
  let bin = Buffer.alloc(0);
  if (binStart + 8 <= buffer.length) {
    const binLength = buffer.readUInt32LE(binStart);
    bin = buffer.subarray(binStart + 8, binStart + 8 + binLength);
  }
  return { json, bin };
}

/** The first mesh's first primitive, with typed access to its attributes. */
export function primitiveOf(json) {
  const mesh = json.meshes?.[0];
  const primitive = mesh?.primitives?.[0];
  if (!primitive) throw new Error("no triangles: the file has no mesh");
  return primitive;
}

/** Reads an accessor into a flat Float32Array of `components` numbers per item. */
function accessor(json, bin, index, components) {
  const view = json.bufferViews[json.accessors[index].bufferView];
  const count = json.accessors[index].count;
  const type = json.accessors[index].componentType;
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[type];
  if (size === undefined) throw new Error(`unsupported accessor component type ${type}`);
  const start = (view.byteOffset ?? 0) + (json.accessors[index].byteOffset ?? 0);
  // Attributes are often interleaved (Kenney puts tangent and UV in one view),
  // so the gap between items is the view's stride, not the item's size.
  const stride = view.byteStride ?? size * components;
  const out = new Float32Array(count * components);
  const read = type === 5126 ? (at) => bin.readFloatLE(at) : type === 5125 ? (at) => bin.readUInt32LE(at) : type === 5123 ? (at) => bin.readUInt16LE(at) : (at) => bin.readUInt8(at);
  for (let item = 0; item < count; item += 1) {
    for (let c = 0; c < components; c += 1) out[item * components + c] = read(start + item * stride + c * size);
  }
  return out;
}

/** The indices of a primitive, or 0..n-1 when it has none. */
function indicesOf(json, bin, primitive, vertexCount) {
  if (primitive.indices === undefined) return Array.from({ length: vertexCount }, (_, i) => i);
  return Array.from(accessor(json, bin, primitive.indices, 1));
}

/**
 * A model as the renderer wants it: `triangles` is a flat list, each entry one
 * corner as `[x, y, z, r, g, b]`, three corners per face.
 */
export function importGlb(file, { name = null, scale = 1, flip = false, baseDir = null, origin = "base" } = {}) {
  const { json, bin } = splitGlb(file);
  // A pack's own name for the model is the one worth keeping.
  name ??= json.nodes?.find((node) => node.mesh !== undefined)?.name ?? json.meshes?.[0]?.name ?? "model";
  // A model is usually several primitives, one per material: a tree is bark and
  // leaves. Reading only the first would draw every tree in one colour.
  // Each mesh is drawn where its node puts it: a door is a child node moved
  // into its wall, and dropping the move leaves it standing in the room.
  const primitives = meshPlacements(json).flatMap(({ mesh, matrix }) => (json.meshes[mesh]?.primitives ?? []).map((primitive) => ({ primitive, matrix })));
  if (primitives.length === 0) throw new Error(`${name}: no triangles, so there is nothing to draw`);

  const triangles = [];
  let textured = false;
  for (const { primitive, matrix } of primitives) {
    const attributes = primitive.attributes ?? {};
    const positions = transformed(accessor(json, bin, attributes.POSITION, 3), matrix);
    const indices = indicesOf(json, bin, primitive, positions.length / 3);
    const uvs = attributes.TEXCOORD_0 !== undefined ? accessor(json, bin, attributes.TEXCOORD_0, 2) : null;
    const map = uvs ? colourMapOf(json, bin, primitive, { baseDir }) : null;
    textured ||= Boolean(map);
    // No map is normal, not a failure: most low-poly packs colour each material
    // with a plain factor, and those are the colours worth keeping.
    const flat = baseColourOf(json, primitive);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const corners = [indices[i], indices[i + 1], indices[i + 2]];
      if (flip) corners.reverse();
      const colour = map ? map.at(centroidUv(corners, uvs)) : flat;
      for (const corner of corners) {
        triangles.push([positions[corner * 3], positions[corner * 3 + 1], positions[corner * 3 + 2], ...colour]);
      }
    }
  }
  return finish(triangles, { name, scale, textured, origin });
}

/**
 * Every mesh the default scene draws, with the matrix that places it: its
 * node's translation, rotation and scale, after its parents'. A file with no
 * scene draws each mesh once where it was modelled.
 */
function meshPlacements(json) {
  const nodes = json.nodes ?? [];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes;
  if (!roots) return (json.meshes ?? []).map((_, mesh) => ({ mesh, matrix: IDENTITY }));
  const found = [];
  const visit = (index, parent) => {
    const node = nodes[index];
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) found.push({ mesh: node.mesh, matrix });
    for (const child of node.children ?? []) visit(child, matrix);
  };
  for (const root of roots) visit(root, IDENTITY);
  return found;
}

/** Column-major 4 × 4, as glTF writes them. */
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function nodeMatrix(node) {
  if (Array.isArray(node.matrix)) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

function transformed(positions, m) {
  if (m === IDENTITY) return positions;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/** A material's plain colour, for packs that are not textured at all. */
function baseColourOf(json, primitive) {
  const factor = json.materials?.[primitive.material ?? 0]?.pbrMetallicRoughness?.baseColorFactor;
  return Array.isArray(factor) && factor.length >= 3 ? factor.slice(0, 3) : [1, 1, 1];
}

function centroidUv(corners, uvs) {
  let u = 0;
  let v = 0;
  for (const corner of corners) {
    u += uvs[corner * 2];
    v += uvs[corner * 2 + 1];
  }
  return [u / 3, v / 3];
}

/**
 * The material's colour map, ready to read a texel by UV. A pack may embed the
 * image in the GLB (bufferView) or point at a file beside it (uri); Kenney does
 * the latter, and a pack whose map cannot be found must fail loudly rather than
 * import a whole kit white.
 */
function colourMapOf(json, bin, primitive, { baseDir = null } = {}) {
  const material = json.materials?.[primitive.material ?? 0];
  const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (textureIndex === undefined) return null;
  const imageIndex = json.textures?.[textureIndex]?.source;
  const image = json.images?.[imageIndex];
  if (!image) return null;
  let png;
  if (image.bufferView !== undefined) {
    const view = json.bufferViews[image.bufferView];
    png = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  } else if (image.uri) {
    if (!baseDir) throw new Error(`${image.uri}: the colour map is a separate file; pass baseDir (the folder holding the model)`);
    png = readFileSync(join(baseDir, decodeURIComponent(image.uri)));
  } else {
    throw new Error("the material names a texture with no image");
  }
  const { width, height, rgba } = decodePng(png);
  // Rows come back in image order and glTF's v runs the same way for these
  // packs, so v indexes the row directly. Flipping it as well — which an
  // earlier version did — sent every Kenney face into the black band above
  // the colour swatches, and a whole kit imported black.
  return {
    width,
    height,
    at([u, v]) {
      const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
      const p = (y * width + x) * 4;
      return [rgba[p] / 255, rgba[p + 1] / 255, rgba[p + 2] / 255];
    },
  };
}

/** Enough PNG to read a colour map: 8-bit RGBA/RGB, no interlacing. */
export function decodePng(png) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 6;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colourType = body[9];
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported PNG colour type ${colourType}, only RGB and RGBA`);
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    unfilter(filter, row, line, y > 0 ? line : null, channels);
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      rgba[p] = line[x * channels];
      rgba[p + 1] = line[x * channels + 1];
      rgba[p + 2] = line[x * channels + 2];
      rgba[p + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
  }
  return { width, height, rgba };
}

/** Undoes one PNG scanline filter, writing into `out` (the previous line is `prev`). */
function unfilter(filter, row, out, prev, bpp) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bpp ? out[i - bpp] : 0;
    const up = prev ? prev[i] : 0;
    const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
    const value = row[i];
    let restored;
    if (filter === 0) restored = value;
    else if (filter === 1) restored = value + left;
    else if (filter === 2) restored = value + up;
    else if (filter === 3) restored = value + ((left + up) >> 1);
    else if (filter === 4) restored = value + paeth(left, up, upLeft);
    else throw new Error(`unsupported PNG filter ${filter}`);
    out[i] = restored & 0xff;
  }
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// ------------------------------------------------------------------- OBJ ---

/**
 * The same colour in the space the world draws in: the standard sRGB transfer
 * function, so `Kd 0.07 0.12 0.05` becomes a leaf green rather than near-black.
 */
export function linearToSrgb(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/**
 * A model from an OBJ file and, when the pack has one, its MTL: colours come
 * from each `usemtl` block's `Kd`.
 *
 * `Kd` is a linear colour, the way a renderer multiplies it against light. The
 * world draws in sRGB — its own palette is given as hex — so a pack's linear
 * colours are converted on the way in, or a tree authored for a lit engine
 * arrives nearly black.
 */
export function importObj(text, { name = "model", mtl = "", scale = 1 } = {}) {
  const materials = new Map();
  let current = null;
  for (const raw of mtl.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) {
      current = line.slice(7).trim();
      materials.set(current, [1, 1, 1]);
    } else if (current && line.startsWith("Kd ")) {
      materials.set(current, line.slice(3).trim().split(/\s+/).map(Number).slice(0, 3).map(linearToSrgb));
    }
  }
  const vertices = [];
  let colour = [1, 1, 1];
  const triangles = [];
  const missing = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      vertices.push(line.slice(2).trim().split(/\s+/).map(Number).slice(0, 3));
    } else if (line.startsWith("usemtl ")) {
      const asked = line.slice(7).trim();
      if (!materials.has(asked)) missing.add(asked);
      colour = materials.get(asked) ?? [1, 1, 1];
    } else if (line.startsWith("f ")) {
      // "f 1 2 3", "f 1/1/1 2/2/2 3/3/3" and negative indices all appear in packs.
      const corners = line.slice(2).trim().split(/\s+/).map((part) => {
        const index = Number(part.split("/")[0]);
        return index < 0 ? vertices.length + index : index - 1;
      });
      for (let i = 1; i + 1 < corners.length; i += 1) {
        for (const corner of [corners[0], corners[i], corners[i + 1]]) triangles.push([...vertices[corner], ...colour]);
      }
    }
  }
  // A model that names materials it was not given would import all white, and
  // a whole kit of white shapes is the kind of mistake that ships. Say so.
  if (missing.size > 0) {
    throw new Error(`${name}: the OBJ names ${[...missing].join(", ")}, which ${mtl ? "the MTL does not define" : "no MTL was given"}`);
  }
  return finish(triangles, { name, scale, textured: false });
}

// ---------------------------------------------------------------- shared ---

/** Re-origins to the base centre, scales, and quantises. */
function finish(triangles, { name, scale = 1, textured = false, origin = "base" }) {
  if (triangles.length === 0) throw new Error(`${name}: no triangles`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of triangles) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  }
  // Stand on the ground, centred on the footprint: an instance is placed by a
  // point on the terrain, not by a bounding box.
  // A part of a modular kit keeps the pack's own origin instead: its place on
  // the tile is what lets it be assembled with the others.
  const centre = origin === "keep" ? [0, 0, 0] : [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const placed = triangles.map(([x, y, z, r, g, b]) => [
    q((x - centre[0]) * scale),
    q((y - centre[1]) * scale),
    q((z - centre[2]) * scale),
    q3(r),
    q3(g),
    q3(b),
  ]);
  const bounds = {
    min: [(min[0] - centre[0]) * scale, (min[1] - centre[1]) * scale, (min[2] - centre[2]) * scale].map(q),
    max: [(max[0] - centre[0]) * scale, (max[1] - centre[1]) * scale, (max[2] - centre[2]) * scale].map(q),
  };
  return { name, triangles: placed, bounds, textured, vertices: placed.length };
}

const q3 = (value) => Math.round(value * 100) / 100;

/** Writes one model as a `.geo.json` file. */
/**
 * A model from an OBJ file beside its MTL, named by the file's stem. Packs name
 * the MTL after the model (`tree.obj` → `tree.mtl`) or as one `model.mtl` for
 * every model.
 */
export function readObj(source, { name = basename(source, extname(source)), scale = 1 } = {}) {
  const stem = source.slice(0, source.length - extname(source).length);
  const beside = `${stem}.mtl`;
  const shared = join(dirname(source), "model.mtl");
  const mtl = existsSync(beside) ? beside : existsSync(shared) ? shared : null;
  return importObj(readFileSync(source, "utf8"), { name, scale, mtl: mtl ? readFileSync(mtl, "utf8") : "" });
}

export function writeModel(model, file) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(model)}\n`);
  return file;
}

// ------------------------------------------------------------- command line ---

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kit, source, ...flags] = process.argv.slice(2);
  if (!kit || !source) {
    console.error("usage: node tools/scenery/import.mjs <kit> <file.glb|file.obj> [--name x] [--scale 1] [--out dir]");
    process.exit(2);
  }
  const flag = (key, fallback) => {
    const at = flags.indexOf(`--${key}`);
    return at >= 0 ? flags[at + 1] : fallback;
  };
  const name = flag("name", basename(source, extname(source)));
  const scale = Number(flag("scale", 1));
  const out = join(flag("out", "client/public/assets/scenery"), kit);
  const isGlb = extname(source).toLowerCase() === ".glb";
  const model = isGlb
    ? importGlb(readFileSync(source), { name, scale, baseDir: dirname(source) })
    : readObj(source, { name, scale });
  writeModel(model, join(out, `${name}.geo.json`));
  console.log(`${kit}/${name}: ${model.vertices / 3} triangles, ${model.textured ? "textured (colours baked)" : "untextured"}`);
}
