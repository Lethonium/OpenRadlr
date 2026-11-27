/**
 * Stone arch bridges where a road crosses a river: the boxes of each (world/bridgePlan.js) for all rivers, as typed
 * arrays for the hand-over (twelve numbers and a colour per box: centre and three edge vectors). The river layer
 * draws them (assets/props/bridge.js).
 */
import { temperate } from "./biomes/index.js";
import { VERGE, roadFrame, roadHalfWidth } from "../world/roads.js";
import { BRIDGE_HALF_LENGTH } from "../world/rivers.js";
import { bridgeBoxes } from "../world/bridgePlan.js";

/**
 * The bridges of `rivers` (each carries its `route` and the distance `at` where the road crosses).
 * @returns {{boxes: Float32Array, colors: Float32Array}}
 */
export function buildBridges(rivers, terrain, biome = temperate) {
  const { stone, stoneDark } = biome.palette;
  const boxes = rivers.flatMap((river) =>
    bridgeBoxes({
      frameAt: (s) => roadFrame(river.route, river.at + s),
      groundAt: (x, z) => terrain.height(x, z),
      half: roadHalfWidth(river.route.lanes) + VERGE,
      halfLength: BRIDGE_HALF_LENGTH,
      stone,
      stoneDark,
    }),
  );
  const numbers = new Float32Array(boxes.length * 12);
  const colors = new Float32Array(boxes.length * 3);
  boxes.forEach(({ center, u, v, w, color }, i) => {
    numbers.set([...center, ...u, ...v, ...w], i * 12);
    colors.set(color, i * 3);
  });
  return { boxes: numbers, colors };
}
