/**
 * Where the roadside posts stand: every 50 m, alternating sides, a pair every kilometre. Placement data for the road
 * layer: `{position, yaw, kind, capped}`, the kinds and shapes are assets/props/roadPost.js (white reflector posts
 * with a dark band, or the biome's own marker, winter's snowmen). A post's reflector faces the road: `yaw` turns the
 * post's +x towards it.
 */
import { add, scale } from "./math.js";
import { temperate } from "./biomes/index.js";
import { VERGE, roadFrame, roadHalfWidth } from "../world/roads.js";

/**
 * @typedef {{position: number[], yaw: number, kind: "post" | "kmPost" | "marker" | "kmMarker", capped: boolean}} PostPlacement
 * @param {import("../route/geometry.js").RouteGeometry} route
 * @param {{biome?: object, detail?: boolean, skip?: (d: number) => boolean, clear?: (x: number, z: number) => boolean, into?: PostPlacement[]}} [options]
 *   `skip` leaves out stretches another road drew, `clear` posts that would stand on another road; a route without
 *   `detail` gets plain posts without a cap
 * @returns {PostPlacement[]}
 */
export function buildRoadPosts(route, { biome = temperate, detail = true, skip = () => false, clear = () => false, into = [] } = {}) {
  const half = roadHalfWidth(route.lanes);
  const marker = detail && Boolean(biome.road.marker);
  const capped = detail && Boolean(biome.road.postCap);
  for (let d = 25; d < route.length; d += 50) {
    if (skip(d)) continue;
    const frame = roadFrame(route, d);
    const km = Math.abs(d % 1000) < 26 || Math.abs((d % 1000) - 1000) < 26;
    const sides = km ? [-1, 1] : [Math.floor(d / 50) % 2 === 0 ? -1 : 1];
    for (const side of sides) {
      const foot = add(frame.center, scale(frame.right, side * (half + VERGE + 0.3)));
      if (clear(foot[0], foot[2])) continue;
      const kind = marker ? (km ? "kmMarker" : "marker") : km ? "kmPost" : "post";
      // The reflector faces the road; a marker stands as it is.
      const toRoad = [-side * frame.right[0], -side * frame.right[2]];
      into.push({ position: foot, yaw: marker ? 0 : Math.atan2(-toRoad[1], toRoad[0]), kind, capped: capped && !marker });
    }
  }
  return into;
}
