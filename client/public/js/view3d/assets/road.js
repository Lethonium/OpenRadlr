/**
 * The road's look as pure data: the asphalt grain tile, and how a quad kind
 * is coloured. Textures are DataTextures built from typed arrays (no canvas),
 * so node tests can build every road layer.
 */
import * as THREE from "../../three.js";
import { ROAD_KIND } from "../../world/plan/roadStrips.js";

const SIZE = 128;

/**
 * A tileable grain for asphalt: fine speckle, a few darker patches and hairline
 * cracks, as a grey multiplier (about 0.85 on average) over the vertex colour.
 * Deterministic.
 * @returns {import("../../three.js").DataTexture}
 */
export function asphaltTexture() {
  let seed = 4242;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const wrap = (v) => ((v % SIZE) + SIZE) % SIZE;
  const level = new Float32Array(SIZE * SIZE).fill(0.86);
  for (let i = 0; i < SIZE * SIZE; i += 1) level[i] += (random() - 0.5) * 0.24;
  for (let patch = 0; patch < 10; patch += 1) {
    const [cx, cy, r, dark] = [random() * SIZE, random() * SIZE, 8 + random() * 16, 0.05 + random() * 0.07];
    for (let y = -r; y <= r; y += 1) {
      for (let x = -r; x <= r; x += 1) if (x * x + y * y < r * r) level[wrap(Math.round(cy + y)) * SIZE + wrap(Math.round(cx + x))] -= dark;
    }
  }
  for (let crack = 0; crack < 8; crack += 1) {
    let [x, y] = [random() * SIZE, random() * SIZE];
    for (let k = 0; k < 30; k += 1) {
      level[wrap(Math.round(y)) * SIZE + wrap(Math.round(x))] -= 0.2;
      x += (random() - 0.5) * 3;
      y += random() * 2;
    }
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const v = Math.round(Math.min(1, Math.max(0, level[i])) * 255);
    data.set([v, v, v, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The colour of each quad kind for a style (`roadStyle`); kinds a style has no
 * colour for (bank, rut without the season's shapes) fall back to the verge.
 * @param {import("../roadStyle.js").RoadStyle} style
 * @returns {number[][]} indexed by `ROAD_KIND`
 */
export function kindColors(style) {
  const colors = [];
  colors[ROAD_KIND.asphalt] = style.surface;
  colors[ROAD_KIND.verge] = style.verge;
  colors[ROAD_KIND.marking] = style.marking;
  colors[ROAD_KIND.bank] = style.bank?.color ?? style.verge;
  colors[ROAD_KIND.rut] = style.rut?.color ?? style.surface;
  colors[ROAD_KIND.edge] = style.edge;
  return colors;
}
