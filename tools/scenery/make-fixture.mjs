#!/usr/bin/env node
/**
 * Writes the importer's test fixture: a two-triangle quad in a GLB with a
 * 2 × 2 colour map — the simplest file that has every part the importer has
 * to handle: positions, normals, UVs, a texture and its image.
 *
 * The fixture is committed, so this only runs when the fixture changes:
 *
 *   node tools/scenery/make-fixture.mjs
 *
 * It is our own file, so it is CC0 like the imported models are.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// A quad 4 m wide (x −2..2), 4 m tall (y 0..4), facing +z, split down the
// middle into two separate faces so each face can sit on a different half of
// the colour map. Wound counter-clockwise seen from the front.
const positions = new Float32Array([-2, 0, 0, 0, 0, 0, 0, 4, 0, -2, 0, 0, 0, 4, 0, -2, 4, 0]);
const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
// The first face reads the left half of the map, the second the right half.
const uvs = new Float32Array([0, 0, 0.5, 0, 0.5, 1, 0.5, 0, 1, 1, 0.5, 1]);

// 2 × 2 RGBA8, bottom row first: red | green  over  blue | white.
// So the left edge of the quad must come out red/blue and the right green/white.
const pixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
const png = pngOf(pixels, 2, 2);

const parts = [Buffer.from(positions.buffer), Buffer.from(normals.buffer), Buffer.from(uvs.buffer), png];
const views = [];
let offset = 0;
for (const part of parts) {
  views.push({ buffer: 0, byteOffset: offset, byteLength: part.length });
  offset += part.length;
}
// Chunks and their contents align on 4 bytes.
const bin = Buffer.concat([...parts, Buffer.alloc((4 - (offset % 4)) % 4)]);

const gltf = {
  asset: { version: "2.0", generator: "openradlr scenery fixture" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "quad" }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }] }],
  materials: [{ name: "colormap", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
  textures: [{ source: 0 }],
  images: [{ bufferView: 3, mimeType: "image/png", name: "colormap" }],
  samplers: [{ magFilter: 9728, minFilter: 9728 }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 6, type: "VEC3", min: [-2, 0, 0], max: [0, 4, 0] },
    { bufferView: 1, componentType: 5126, count: 6, type: "VEC3" },
    { bufferView: 2, componentType: 5126, count: 6, type: "VEC2" },
  ],
  bufferViews: views,
  buffers: [{ byteLength: bin.length }],
};

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(0, 8); // total length, filled in below

const pack = (json) => {
  const text = Buffer.from(JSON.stringify(json), "utf8");
  const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(8);
  head.writeUInt32LE(padded.length, 0);
  head.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  return Buffer.concat([head, padded]);
};

const jsonChunk = pack(gltf);
const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(bin.length, 0);
binHead.writeUInt32LE(0x004e4942, 4); // "BIN\0"
header.writeUInt32LE(12 + jsonChunk.length + 8 + bin.length, 8);

mkdirSync(OUT, { recursive: true });
const file = join(OUT, "quad.glb");
writeFileSync(file, Buffer.concat([header, jsonChunk, binHead, bin]));
console.log(`wrote ${file}`);

/** A minimal 8-bit RGBA PNG: no filtering, one zlib stream. */
function pngOf(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
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
