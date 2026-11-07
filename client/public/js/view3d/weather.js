/**
 * Camera-local weather particles, built as plain data so the scene can cross
 * the worker boundary. Each flake is a camera-facing quad; the renderer's
 * weather shader wraps it around the camera and animates it, so no buffer is
 * rewritten per frame. No textures: the fragment shader cuts a soft disc.
 */
import { seededRandom } from "./noise.js";

/** Six vertices per camera-facing quad. */
const CORNERS = Object.freeze([[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]);

/**
 * Particle seeds for the biome's weather, or null when it has none.
 * Layout per vertex: corner x/y, then the flake's seed x/y/z/w.
 */
export function buildWeather(terrain, { biome } = {}) {
  const style = biome?.weather;
  if (!style) return null;
  const random = seededRandom(((terrain.seed ?? 0) ^ 0x5eaf) >>> 0);
  const data = new Float32Array(style.count * CORNERS.length * 6);
  let at = 0;
  for (let i = 0; i < style.count; i += 1) {
    const seed = [random(), random(), random(), random()];
    for (const [x, y] of CORNERS) {
      data[at++] = x;
      data[at++] = y;
      data[at++] = seed[0];
      data[at++] = seed[1];
      data[at++] = seed[2];
      data[at++] = seed[3];
    }
  }
  return { kind: style.kind, count: style.count, data };
}
