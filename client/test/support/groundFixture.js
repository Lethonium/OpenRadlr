import { groundGrid } from "../../public/js/world/groundGrid.js";

/** Open sea for x < 16, land beyond: tiles on the sea side are skipped. */
const coast = { height: (x) => (x < 16 ? -50 : 20 + x * 0.01), distanceToRoad: () => 1000, riverDistance: () => Infinity };

/**
 * A ground like the worker hands over: a near grid of 128 x 128 cells (two
 * tiles each way) inside a coarse far grid that reaches further.
 * @returns {{near: object, far: object}}
 */
export function groundFixture(season = "summer") {
  const options = { water: 0, season, seed: 5 };
  return {
    near: groundGrid(coast, { ...options, bounds: { x0: -1024, z0: -1024, x1: 1024, z1: 1024 }, cell: 16 }),
    far: groundGrid(coast, { ...options, bounds: { x0: -4096, z0: -4096, x1: 4096, z1: 4096 }, cell: 128 }),
  };
}
