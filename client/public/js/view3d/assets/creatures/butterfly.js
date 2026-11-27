/** A butterfly: two pairs of coloured wings with dark tips, a thin body. */
import { colour, cylinder } from "../geom.js";
import { defineCreature, limb, sheet } from "./creature.js";

const WINGS = ["#ff7a3d", "#ffd23f", "#7fb8ff", "#f4f1ea", "#ff9f43", "#b28dff", "#e8505b"];
const BORDER = "#2a2420";

export const butterfly = defineCreature({ id: "butterfly", name: "Butterfly", description: "Flutters over spring flowers by day.", speed: 1.5, size: 0.2, centred: true }, ({ detail, dice }) => { // i18n-ok
  const colourOf = dice.pick(WINGS);
  const body = [cylinder(0.012, 0.012, 0.14, 4, colour(BORDER)).rotateX(Math.PI / 2)];
  const wing = (side) => {
    const fore = [[0.01 * side, 0, 0.02, colourOf], [0.1 * side, 0, 0.1, BORDER], [0.11 * side, 0, -0.02, colourOf]];
    const hind = [[0.01 * side, 0, -0.01, colourOf], [0.1 * side, 0, -0.03, colourOf], [0.07 * side, 0, -0.1, BORDER]];
    return limb([sheet(detail ? [fore, hind, [[0.1 * side, 0, 0.1, BORDER], [0.11 * side, 0, -0.02, colourOf], [0.13 * side, 0, 0.04, BORDER]]] : [fore])], [0.01 * side, 0, 0], "wing");
  };
  return { body, limbs: [wing(1), wing(-1)] };
});
