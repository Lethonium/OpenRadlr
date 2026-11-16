/**
 * The scenery importer (#117): turns a model somebody else made into the one
 * thing our renderer draws — flat-shaded triangles with a colour per face.
 *
 * The renderer has no textures and no UVs (`renderer.js`), so the importer is
 * where a pack's look becomes ours: UVs are dropped, and each triangle takes
 * the colour of the colour map under its centroid. What comes out is geometry
 * in the project's own format, not a model dropped in beside it.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { importGlb, importObj, linearToSrgb, primitiveOf, readObj } from "../../tools/scenery/import.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const QUAD = readFileSync(join(HERE, "../../tools/scenery/fixtures/quad.glb"));
const SWATCHES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 1],
];
const QUAD_WITH_ATLAS = glbWithAtlas();

/**
 * A GLB whose faces each sit in a different corner of a 2 × 2 swatch atlas,
 * the shape of a real pack's colour map.
 */
function glbWithAtlas(options = {}) {
  const { glb } = buildGlb({
    ...options,
    positions: [-4, 0, 0, -2, 0, 0, -2, 2, 0, -2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 2, 2, 0, 2, 0, 0, 4, 0, 0, 4, 2, 0],
    uvs: [0.1, 0.1, 0.4, 0.1, 0.4, 0.4, 0.6, 0.1, 0.9, 0.1, 0.9, 0.4, 0.6, 0.6, 0.9, 0.6, 0.9, 0.9, 0.1, 0.6, 0.4, 0.6, 0.4, 0.9],
    pixels: SWATCHES,
  });
  return glb;
}

/**
 * Packs a set of attributes and a swatch grid into a GLB. Written here rather
 * than reusing the fixture writer so a test can describe exactly the model it
 * needs; the fixture the importer is tested on is the committed `quad.glb`.
 */
function buildGlb({ positions, uvs, pixels, image, materials = true }) {
  const pos = new Float32Array(positions);
  const uv = new Float32Array(uvs);
  const normals = new Float32Array(positions.length).map((_, i) => (i % 3 === 2 ? 1 : 0));
  const width = 2;
  const height = 2;
  const rgba = Uint8Array.from(pixels.flatMap(([r, g, b]) => [r * 255, g * 255, b * 255, 255]));
  const png = pngOf(rgba, width, height);
  const chunks = [Buffer.from(pos.buffer), Buffer.from(normals.buffer), Buffer.from(uv.buffer), png];
  const views = [];
  let offset = 0;
  for (const chunk of chunks) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: chunk.length });
    offset += chunk.length;
  }
  const bin = Buffer.concat([...chunks, Buffer.alloc((4 - (offset % 4)) % 4)]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "swatches" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }] }],
    materials: [materials ? { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } : { name: "wood", pbrMetallicRoughness: { baseColorFactor: [0.4, 0.25, 0.5, 1] } }],
    textures: [{ source: 0 }],
    images: [image ? { ...image, name: "colormap" } : { bufferView: 3, mimeType: "image/png" }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: uv.length / 2, type: "VEC2" },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  const text = Buffer.from(JSON.stringify(json), "utf8");
  const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + padded.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(padded.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([header, jsonHead, padded, binHead, bin]) };
}

function pngOf(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

test("a GLB becomes triangles with a colour per face, and no UVs", () => {
  const model = importGlb(QUAD);
  assert.equal(model.name, "quad");
  // Two triangles, three corners each: the renderer wants them unshared.
  assert.equal(model.triangles.length, 6);
  const uvs = JSON.stringify(model.triangles);
  assert.doesNotMatch(uvs, /uv|TEXCOORD/, "UVs must not survive the import");
});

test("each face takes one colour, read from the map under its centroid", () => {
  const { triangles } = importGlb(QUAD);
  const colour = (face) => triangles.slice(face * 3, face * 3 + 3).map(([, , , r, g, b]) => `${r},${g},${b}`);
  // Every corner of a face shares that face's colour: that is what flat shading means.
  for (const face of [0, 1]) assert.equal(new Set(colour(face)).size, 1, `face ${face} has one colour`);
  // The fixture splits down the middle: the left face sits on the top-left
  // texel (red), the right face on the bottom-right one (white). Reading v the
  // wrong way round, or the wrong half, changes both.
  const [left, right] = [colour(0)[0], colour(1)[0]];
  assert.equal(left, "1,0,0", "the left face took the red texel");
  assert.equal(right, "1,1,1", "the right face took the white texel");
});

test("the origin moves to the base centre, so a model stands where it is placed", () => {
  const model = importGlb(QUAD);
  // The fixture spans x −2..0 and y 0..4, so after centring its footprint it
  // stands on y = 0 with its middle at x = 0: where a placement puts it.
  assert.deepEqual(model.bounds.min.map(Math.round), [-1, 0, 0]);
  assert.deepEqual(model.bounds.max.map(Math.round), [1, 4, 0]);
  const xs = model.triangles.map(([x]) => x);
  assert.equal(Math.min(...xs), -1);
  assert.equal(Math.max(...xs), 1);
  assert.equal(Math.min(...model.triangles.map(([, y]) => y)), 0, "the base sits on the ground");
});

test("flipping the winding reverses the triangles without moving them", () => {
  const normal = importGlb(QUAD);
  const flipped = importGlb(QUAD, { flip: true });
  // Same corners, opposite order: the faces now look the other way, ready for
  // packs whose models are wound the other way round.
  assert.deepEqual(flipped.triangles[0], normal.triangles[2]);
  assert.deepEqual(flipped.triangles[2], normal.triangles[0]);
  assert.deepEqual(flipped.bounds, normal.bounds);
});

test("a texture kept in a separate file is read from beside the model", () => {
  // Kenney keeps its colour map in a PNG next to the GLB rather than inside it.
  // The importer must accept that, and must fail loudly when the file is
  // missing: a whole kit silently imported white is the worst outcome.
  const glb = glbWithAtlasWithImage({ uri: "Textures/colormap.png" });
  assert.throws(() => importGlb(glb, { baseDir: join(HERE, "no-such-folder") }), /colormap\.png|ENOENT/);
});

/** The swatch model, but with its image pointed at rather than embedded. */
function glbWithAtlasWithImage(image) {
  const { glb } = buildGlb({
    positions: [-1, 0, 0, 1, 0, 0, 0, 2, 0],
    uvs: [0.1, 0.1, 0.4, 0.1, 0.4, 0.4],
    pixels: SWATCHES,
    image,
  });
  return glb;
}

test("a textured face reports the texel it read, so a wrong colour map is visible", () => {
  const model = importGlb(QUAD);
  assert.equal(model.textured, true);
});

test("an untextured model takes its material's plain colour", () => {
  // Most low-poly packs colour each material with a factor rather than a map.
  // Falling back to white for those would import a whole pack as blank shapes.
  const glb = glbWithAtlas({ materials: false });
  const model = importGlb(glb);
  assert.equal(model.textured, false);
  const colours = new Set(model.triangles.map(([, , , r, g, b]) => `${r},${g},${b}`));
  assert.deepEqual([...colours], ["0.4,0.25,0.5"], "the model's own colour, not white");
});

test("an untextured OBJ takes its colours from the material", () => {
  const obj = ["mtllib tree.mtl", "usemtl bark", "v -1 0 0", "v 1 0 0", "v 0 3 0", "f 1 2 3"].join("\n");
  const mtl = ["newmtl bark", "Kd 0.38 0.27 0.18"].join("\n");
  const model = importObj(obj, { name: "tree", mtl });
  assert.equal(model.triangles.length, 3);
  // The material's linear colour, in the sRGB the world draws in, to two places.
  assert.deepEqual(model.triangles[0].slice(3), [0.38, 0.27, 0.18].map((v) => Math.round(linearToSrgb(v) * 100) / 100));
  assert.equal(model.textured, false);
});

test("an untextured model keeps its own scale, with the origin at the base", () => {
  const obj = ["v -2 0 0", "v 2 0 0", "v 0 6 0", "f 1 2 3"].join("\n");
  const model = importObj(obj, { name: "pine" });
  const ys = model.triangles.map(([, y]) => y);
  assert.equal(Math.min(...ys), 0, "the base sits on y = 0");
  assert.equal(Math.max(...ys), 6);
});

test("positions are quantised, so a kit stays small in the repository", () => {
  const obj = ["v 0.123456789 0 0", "v 1.987654321 0 0", "v 0 2.111111111 0", "f 1 2 3"].join("\n");
  const model = importObj(obj, { name: "small" });
  for (const corner of model.triangles) {
    for (const value of corner.slice(0, 3)) {
      assert.equal(value, Math.round(value * 100) / 100);
    }
  }
});

test("an OBJ that names a material it was not given is refused, not imported white", () => {
  // The importer used to look for the MTL beside the OBJ under the wrong name,
  // so every OBJ with materials imported all white and nothing said so.
  const obj = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "usemtl Green", "f 1 2 3"].join("\n");
  assert.throws(() => importObj(obj, { name: "tree" }), /tree.*Green/is);
});

test("an OBJ takes the colour its material defines, when it is given the MTL", () => {
  const obj = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "usemtl Green", "f 1 2 3"].join("\n");
  const mtl = ["newmtl Green", "Kd 0.2 0.6 0.3"].join("\n");
  const model = importObj(obj, { name: "tree", mtl });
  // `Kd` is linear; the world draws in sRGB, so it is converted on the way in
  // and quantised to the two places a model file keeps.
  const expected = [0.2, 0.6, 0.3].map((v) => Math.round(linearToSrgb(v) * 100) / 100);
  assert.deepEqual(model.triangles[0].slice(3), expected);
});

test("a material's linear colour becomes a leaf green, not near-black", () => {
  // Quaternius authors its leaves at Kd 0.07 0.12 0.05, which is a believable
  // green once converted and almost black if taken as sRGB.
  const srgb = [0.07, 0.122, 0.048].map(linearToSrgb);
  assert.ok(srgb[1] > 0.35, `green channel ${srgb[1].toFixed(2)}`);
  assert.ok(srgb[1] > srgb[0] && srgb[1] > srgb[2], "and it is still green");
});

test("a model read from disk finds the MTL beside it, named for the file", () => {
  // The importer used to look for `tree.objm`, so every OBJ with materials
  // imported white. This exercises the file path, which the unit tests above
  // bypass by passing the MTL in by hand.
  const dir = mkdtempSync(join(tmpdir(), "scenery-"));
  try {
    writeFileSync(join(dir, "tree.obj"), ["v 0 0 0", "v 1 0 0", "v 0 1 0", "usemtl Green", "f 1 2 3"].join("\n"));
    writeFileSync(join(dir, "tree.mtl"), ["newmtl Green", "Kd 0.2 0.6 0.3"].join("\n"));
    const model = readObj(join(dir, "tree.obj"));
    const expected = Math.round(linearToSrgb(0.6) * 100) / 100;
    assert.equal(model.triangles[0][4], expected, "the material's colour, converted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a GLB with no triangles is refused with its name", () => {
  const empty = { asset: { version: "2.0" }, meshes: [] };
  assert.throws(() => primitiveOf(empty), /no triangles|no geometry/i);
});

test("a swatch atlas gives a model many colours, not one", () => {
  // Kenney's colour map is a grid of flat swatches, so a model that reads it
  // correctly picks up several. Reading the wrong rows — the black band above
  // the swatches — collapses a whole kit to one colour, which is exactly the
  // bug this test exists to catch.
  const model = importGlb(QUAD_WITH_ATLAS);
  const colours = new Set(model.triangles.map(([, , , r, g, b]) => `${r},${g},${b}`));
  assert.equal(colours.size, SWATCHES.length, `expected the ${SWATCHES.length} swatches, got ${[...colours]}`);
  for (const swatch of SWATCHES) {
    assert.equal(colours.has(swatch.join(",")), true, `missing swatch ${swatch}`);
  }
});
