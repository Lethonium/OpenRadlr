/**
 * Minimal reader for Copernicus GLO-30 Cloud-Optimized GeoTIFFs: tiled,
 * deflate-compressed float32 with the floating-point predictor (3). Node
 * built-ins only.
 *
 *   const dem = openCog(readFileSync("tile.tif"));
 *   dem.elevation(lat, lon)   // metres, bilinear; NaN outside the tile
 */
import { inflateSync } from "node:zlib";

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 };

function readTags(buffer) {
  const little = buffer.toString("latin1", 0, 2) === "II";
  const u16 = (o) => (little ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const u32 = (o) => (little ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const f64 = (o) => (little ? buffer.readDoubleLE(o) : buffer.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error("not a classic TIFF");
  const base = u32(4);
  const tags = {};
  for (let i = 0; i < u16(base); i++) {
    const entry = base + 2 + i * 12;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const size = TYPE_SIZE[type] * count;
    const at = size <= 4 ? entry + 8 : u32(entry + 8);
    const values = [];
    for (let k = 0; k < count; k++) {
      if (type === 3) values.push(u16(at + k * 2));
      else if (type === 4) values.push(u32(at + k * 4));
      else if (type === 12) values.push(f64(at + k * 8));
    }
    tags[tag] = values;
  }
  return tags;
}

/** Undoes predictor 3: byte-wise running sum along the row, then un-shuffles the four byte planes. */
function unpredict(raw, width, rows) {
  const out = Buffer.alloc(raw.length);
  const rowBytes = width * 4;
  for (let r = 0; r < rows; r++) {
    const row = raw.subarray(r * rowBytes, (r + 1) * rowBytes);
    for (let i = 1; i < rowBytes; i++) row[i] = (row[i] + row[i - 1]) & 0xff;
    for (let i = 0; i < width; i++) {
      for (let b = 0; b < 4; b++) out[r * rowBytes + i * 4 + (3 - b)] = row[b * width + i];
    }
  }
  return out;
}

export function openCog(buffer) {
  const tags = readTags(buffer);
  const width = tags[256][0];
  const height = tags[257][0];
  const tileW = tags[322][0];
  const tileH = tags[323][0];
  const offsets = tags[324];
  const counts = tags[325];
  const predictor = tags[317]?.[0] ?? 1;
  const [scaleX, scaleY] = tags[33550];
  const [, , , originLon, originLat] = tags[33922];
  const across = Math.ceil(width / tileW);
  const cache = new Map();

  function tile(index) {
    if (!cache.has(index)) {
      let raw = inflateSync(buffer.subarray(offsets[index], offsets[index] + counts[index]));
      if (predictor === 3) raw = unpredict(raw, tileW, tileH);
      cache.set(index, new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4));
    }
    return cache.get(index);
  }

  function pixel(col, row) {
    const c = Math.min(width - 1, Math.max(0, col));
    const r = Math.min(height - 1, Math.max(0, row));
    const t = tile(Math.floor(r / tileH) * across + Math.floor(c / tileW));
    return t[(r % tileH) * tileW + (c % tileW)];
  }

  return {
    /** Bounds as [west, south, east, north]. */
    bounds: [originLon, originLat - height * scaleY, originLon + width * scaleX, originLat],
    elevation(lat, lon) {
      const x = (lon - originLon) / scaleX - 0.5;
      const y = (originLat - lat) / scaleY - 0.5;
      if (x < -0.5 || y < -0.5 || x > width - 0.5 || y > height - 0.5) return NaN;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const top = pixel(x0, y0) * (1 - fx) + pixel(x0 + 1, y0) * fx;
      const bottom = pixel(x0, y0 + 1) * (1 - fx) + pixel(x0 + 1, y0 + 1) * fx;
      return top * (1 - fy) + bottom * fy;
    },
  };
}
