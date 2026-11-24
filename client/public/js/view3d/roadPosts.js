/**
 * Roadside posts every 50 m, alternating sides, a pair with red tops every
 * kilometre: white reflector posts with a dark band and an orange reflector
 * facing the road (or the biome's own marker, winter's snowmen). One mesh for
 * a route; the road layer draws it.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { add, placement, scale } from "./math.js";
import { temperate } from "./biomes/index.js";
import { VERGE, roadFrame, roadHalfWidth } from "../world/roads.js";

const REFLECTOR = Object.freeze([1, 0.55, 0.1]);
const postModels = new Map();

/** The biome's own marker, if it has one; built once per variant, every post reuses the mesh. */
function biomeMarker(biome, km) {
  const build = biome.models?.post;
  if (!build) return null;
  const key = `${biome.id}:${km ? 1 : 0}`;
  if (!postModels.has(key)) postModels.set(key, build(km));
  return postModels.get(key);
}

/**
 * @param {import("../route/geometry.js").RouteGeometry} route
 * @param {{biome?: object, detail?: boolean, skip?: (d: number) => boolean, clear?: (x: number, z: number) => boolean, into?: MeshBuilder}} [options]
 *   `skip` leaves out stretches another road drew, `clear` posts that would stand on another road
 */
export function buildRoadPosts(route, { biome = temperate, detail = true, skip = () => false, clear = () => false, into = new MeshBuilder() } = {}) {
  const half = roadHalfWidth(route.lanes);
  const { postWhite, postRed, postDark, postCap } = biome.road;
  const cap = detail ? postCap : null;
  for (let d = 25; d < route.length; d += 50) {
    if (skip(d)) continue;
    const frame = roadFrame(route, d);
    const km = Math.abs(d % 1000) < 26 || Math.abs((d % 1000) - 1000) < 26;
    const sides = km ? [-1, 1] : [Math.floor(d / 50) % 2 === 0 ? -1 : 1];
    for (const side of sides) {
      const foot = add(frame.center, scale(frame.right, side * (half + VERGE + 0.3)));
      if (clear(foot[0], foot[2])) continue;
      const marker = detail ? biomeMarker(biome, km) : null;
      if (marker) {
        into.append(marker, placement(foot, 0));
        continue;
      }
      into.box(add(foot, [0, 0.5, 0]), [0.12, 1.0, 0.12], postWhite);
      into.box(add(foot, [0, 1.05, 0]), [0.13, 0.12, 0.13], km ? postRed : postDark);
      // The reflector faces the road.
      into.orientedBox(add(foot, add(scale(frame.right, -side * 0.065), [0, 0.86, 0])), scale(frame.right, 0.04), [0, 0.14, 0], scale(frame.forward, 0.07), REFLECTOR);
      if (cap) into.box(add(foot, [0, 1.14, 0]), [0.16, 0.06, 0.16], cap.color);
    }
  }
  return into;
}
