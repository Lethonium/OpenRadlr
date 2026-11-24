/**
 * Foliage alpha textures built from pure typed-array drawing (no canvas), so
 * node tests can create them. Deterministic from the seed they are given.
 */
import * as THREE from "../../../three.js";
import { seededRandom } from "../../../world/noise.js";

/** A square-ish RGBA texture over `data`, mipmapped, in sRGB. */
function texture(data, width, height) {
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

/** Transparent texels carry a mid colour, so mipmaps do not dim the edges. */
const blank = (width, height, rgb) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([...rgb, 0], i * 4);
  return data;
};

const put = (data, width, height, x, y, rgb) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  data.set([rgb[0], rgb[1], rgb[2], 255], (y * width + x) * 4);
};

/** Fills a leaf (a lens of length `len`, half-width `wid`) turned by `angle` around (cx, cy). */
function leaf(data, width, height, cx, cy, len, wid, angle, grey, vein) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const reach = Math.ceil(len + 1);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const t = u / len;
      if (Math.abs(t) > 1 || Math.abs(v) > wid * (1 - t * t)) continue;
      const side = 0.78 + 0.22 * (1 - Math.abs(v) / (wid * (1 - t * t) + 1e-6));
      const g = Math.abs(v) < 0.6 ? vein : grey * side;
      put(data, width, height, Math.round(cx + dx), Math.round(cy + dy), [g * 0.95, g, g * 0.88]);
    }
  }
}

/**
 * A cluster of leaves, grey-white so a vertex colour tints it.
 * @param {number} [size] texels per side
 * @param {number} [seed]
 * @param {number} [slenderness] leaf width relative to its length (narrow for olive)
 * @returns {import("../../../three.js").DataTexture}
 */
export function leafTexture(size = 128, seed = 11, slenderness = 0.65) {
  const random = seededRandom(seed);
  const data = blank(size, size, [150, 160, 130]);
  const half = size / 2;
  for (let i = 0; i < 70; i += 1) {
    const a = random() * Math.PI * 2;
    const d = Math.sqrt(random()) * half * 0.75;
    const len = size * (0.05 + random() * 0.045);
    leaf(data, size, size, half + Math.cos(a) * d, half + Math.sin(a) * d * 0.95, len, len * slenderness, a + Math.PI / 2 + (random() - 0.5) * 1.6, 195 + random() * 60, 120);
  }
  return texture(data, size, size);
}

/**
 * A needle branch, twig along +x (u = 0 at the trunk, 1 at the tip), with
 * snow patches when `snowy`.
 * @param {boolean} [snowy]
 * @param {number} [size] width in texels; the height is half
 * @returns {import("../../../three.js").DataTexture}
 */
export function needleTexture(snowy = false, size = 128) {
  const width = size;
  const height = size / 2;
  const random = seededRandom(snowy ? 5 : 3);
  const data = blank(width, height, [40, 90, 50]);
  const stamp = (x, y, rgb) => {
    put(data, width, height, Math.round(x), Math.round(y), rgb);
    put(data, width, height, Math.round(x), Math.round(y) + 1, rgb);
  };
  for (let x = 0; x < width; x += 0.5) stamp(x, height / 2 + (x / width) * 4, [74, 54, 36]);
  for (let i = 0; i < width * 3; i += 1) {
    const t = random();
    const side = random() < 0.5 ? -1 : 1;
    const len = (1 - t * 0.6) * height * 0.42 * (0.5 + random() * 0.5);
    const angle = side * (0.5 + random() * 0.7) + 0.35;
    const g = 70 + random() * 60;
    for (let s = 0; s <= 1; s += 0.2) stamp(t * width + Math.cos(angle) * len * 0.5 * s, height / 2 + t * 4 + Math.sin(angle) * len * s, [g * 0.45, g, g * 0.55]);
  }
  if (snowy) {
    for (let i = 0; i < 22; i += 1) leaf(data, width, height, random() * width * 0.95, height * (0.2 + random() * 0.35), 3 + random() * 6, 1.5 + random() * 2.5, 0, 248, 252);
  }
  return texture(data, width, height);
}
