/**
 * The data of the gyms' statue rows (#77): the materials, the plinth sizes and
 * where each plinth stands in its row. The scene's statue layer builds the
 * figures; the view answers `statueTargets` from these.
 */

/** Figure colour, plinth (a darker shade) and, for bronze, the patina band. */
export const STATUE_MATERIALS = Object.freeze({
  marble: Object.freeze({ figure: [0.93, 0.91, 0.86], plinth: [0.66, 0.64, 0.6] }),
  bronze: Object.freeze({ figure: [0.72, 0.54, 0.2], plinth: [0.36, 0.27, 0.12], accent: [0.25, 0.55, 0.45] }),
  sandstone: Object.freeze({ figure: [0.8, 0.62, 0.36], plinth: [0.56, 0.42, 0.24] }),
  granite: Object.freeze({ figure: [0.6, 0.61, 0.63], plinth: [0.34, 0.35, 0.37] }),
});

const ROW_HALF = 7.5;
const MAX_SPACING = 3;
/** Plinth sizes `[x, height, z]`; a lying figure's long axis runs along X, the row's. */
export const PLINTHS = Object.freeze({ upright: [0.9, 1.0, 0.9], lying: [2.0, 0.6, 0.8] });

/** Local x of each plinth in a row of `count`. */
export function statueSlots(count) {
  if (count <= 1) return [{ x: 0 }];
  const spacing = Math.min(MAX_SPACING, (2 * ROW_HALF) / (count - 1));
  return Array.from({ length: count }, (_, i) => ({ x: (i - (count - 1) / 2) * spacing }));
}
