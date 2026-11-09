/**
 * Paints the Living island's ground into one texture: the terrain shader reads
 * it before lighting, so sun, shadows and fog work as on plain terrain.
 *
 * Premultiplied by alpha, so mipmaps stay right along the coast: alpha zero
 * (under the sea, river beds) leaves the terrain's own vertex colours.
 */
import { valueNoise } from "../noise.js";
import { RIVER } from "../features.js";

/** Rows and stripes: long enough on a ~6.5 m pixel not to shimmer into moiré. */
const STRIPES = Object.freeze({ ploughed: 20, wheat: 24, hay: 32, rapeseed: 28, lavender: 20, sunflower: 26 });
const STRIPE_DEPTH = 0.09;
const PLOT = 22;

/** Pixel-sized grain in [0, 1). */
function grain(px, py) {
  let h = Math.imul(px, 374761393) ^ Math.imul(py, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function scramble(a, b) {
  let h = Math.imul(a, 2654435761) ^ Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A hash of a parcel into a brightness of ±5 %. */
const parcelShade = (id) => 0.95 + 0.1 * scramble(id, 91);

const blend = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * @param {{fields: object, grid: object, box: {x0: number, z0: number, x1: number, z1: number}, overlays?: {x0: number, z0: number, x1: number, z1: number, paint: (x: number, z: number) => number[] | null}[], crops: object, resolution?: number, seed?: number}} options
 * @returns {{width: number, height: number, data: Uint8Array, x0: number, z0: number, size: number}}
 */
export function paintGroundMap({ fields, grid, box, overlays = [], crops, resolution = 2048, seed = 0 }) {
  const size = Math.max(box.x1 - box.x0, box.z1 - box.z0);
  const data = new Uint8Array(resolution * resolution * 4);
  const metres = size / resolution;
  const riverBed = RIVER.halfWidth + 3;
  const x0 = box.x0;
  const z0 = box.z0;

  const colourAt = (land, x, z) => {
    switch (land) {
      case "wetSand":
        return crops.wetSand;
      case "sand":
        return crops.sand;
      case "dunes":
        return crops.dunes;
      case "river":
        return crops.river;
      case "rock":
        return crops.rock;
      case "scree":
        // Bands that follow the slope, broken up, so they don't read as contour lines.
        return blend(blend(crops.moorHeath, crops.scree, 0.45 + 0.55 * valueNoise(x / 90, z / 90, seed + 47)), crops.rock, 0.5 + 0.5 * Math.sin((grid.heightAt(x, z) + 22 * valueNoise(x / 60, z / 60, seed + 43)) / 11));
      case "moor":
        if (fields.woodAt(x, z) > 0.25) return woodColour(x, z);
        return blend(crops.moor, crops.moorHeath, valueNoise(x / 28, z / 28, seed + 53));
      case "rough": {
        const parcel = fields.parcelRecord(land, x, z);
        if (parcel) return cropColour(parcel);
        if (fields.woodAt(x, z) > 0.25) return woodColour(x, z);
        return blend(crops.rough, crops.moorHeath, valueNoise(x / 34, z / 34, seed + 59) * 0.5);
      }
      case "village": {
        fields.parcelRecord(land, x, z);
        const plot = scramble(Math.floor(fields.localU / PLOT) * 7919, Math.floor(fields.localV / PLOT));
        return crops.garden[Math.floor(plot * crops.garden.length)];
      }
      default:
        return cropColour(fields.parcelRecord(land, x, z));
    }
  };

  const woodColour = (x, z) => blend(crops.woods, crops.woodsDeep, valueNoise(x / 26, z / 26, seed + 61));

  /** A parcel's colour, with its rows; reads the place in the parcel from `fields.localU` / `localV`. */
  function cropColour(parcel) {
    if (parcel.crop === "woods") return woodColour(parcel.center[0] + fields.localU, parcel.center[1] + fields.localV);
    const colour = crops[parcel.crop];
    const shade = parcelShade(parcel.id);
    const period = STRIPES[parcel.crop];
    if (!period) return [colour[0] * shade, colour[1] * shade, colour[2] * shade];
    const stripe = 1 + STRIPE_DEPTH * Math.sin((2 * Math.PI * fields.localV) / period);
    return [colour[0] * shade * stripe, colour[1] * shade * stripe, colour[2] * shade * stripe];
  }

  for (let py = 0, i = 0; py < resolution; py += 1) {
    const z = z0 + (py + 0.5) * metres;
    for (let px = 0; px < resolution; px += 1, i += 4) {
      const x = x0 + (px + 0.5) * metres;
      const land = fields.landAt(x, z);
      // The coarse grid cannot see a river bed of a few metres; river pixels are few, so ask the terrain.
      if (land === "sea" || (land === "river" && fields.terrain.riverDistance(x, z) < riverBed)) continue;
      const colour = colourAt(land, x, z);
      const speck = 0.97 + 0.06 * grain(px, py);
      data[i] = Math.min(255, colour[0] * speck * 255);
      data[i + 1] = Math.min(255, colour[1] * speck * 255);
      data[i + 2] = Math.min(255, colour[2] * speck * 255);
      data[i + 3] = 255;
    }
  }

  // Hedge lines and farm tracks along the parcel edges, so the quilt reads from the air.
  for (const [n, edge] of fields.edges().entries()) {
    const track = scramble(n, 37) < 0.1;
    drawLine(data, resolution, metres, x0, z0, edge, track ? crops.track : crops.edge, track ? 1 : 0.55);
  }

  for (const overlay of overlays) {
    const c0 = Math.max(0, Math.floor((overlay.x0 - x0) / metres));
    const c1 = Math.min(resolution - 1, Math.ceil((overlay.x1 - x0) / metres));
    const r0 = Math.max(0, Math.floor((overlay.z0 - z0) / metres));
    const r1 = Math.min(resolution - 1, Math.ceil((overlay.z1 - z0) / metres));
    for (let py = r0; py <= r1; py += 1) {
      const z = z0 + (py + 0.5) * metres;
      if (z < overlay.z0 || z > overlay.z1) continue;
      for (let px = c0; px <= c1; px += 1) {
        const x = x0 + (px + 0.5) * metres;
        if (x < overlay.x0 || x > overlay.x1) continue;
        const colour = overlay.paint(x, z);
        if (!colour) continue;
        const i = (py * resolution + px) * 4;
        data[i] = colour[0];
        data[i + 1] = colour[1];
        data[i + 2] = colour[2];
        data[i + 3] = 255;
      }
    }
  }

  return { width: resolution, height: resolution, data, x0, z0, size };
}

/** Blends `colour` by `amount` along an edge, one pixel wide, on land only. */
function drawLine(data, resolution, metres, x0, z0, { a, b }, colour, amount) {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / metres);
  for (let s = 0; s <= steps; s += 1) {
    const x = a[0] + ((b[0] - a[0]) * s) / steps;
    const z = a[1] + ((b[1] - a[1]) * s) / steps;
    const px = Math.floor((x - x0) / metres);
    const py = Math.floor((z - z0) / metres);
    if (px < 0 || py < 0 || px >= resolution || py >= resolution) continue;
    const i = (py * resolution + px) * 4;
    if (data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c += 1) data[i + c] += (colour[c] * 255 - data[i + c]) * amount;
  }
}
