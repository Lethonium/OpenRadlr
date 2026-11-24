/** Two painted beehives on a stand: three stacked boxes and a gabled roof each. */
import { box, colour } from "../geom.js";
import { gable } from "../buildings/shapes.js";
import { defineProp } from "./prop.js";

export const beehive = defineProp({ id: "beehive", name: "Beehives", description: "Two painted beehives on a stand, where the clover grows." }, ({ detail, dice }) => { // i18n-ok
  const colours = ["#f1ebd8", "#e8c545", "#7fb0d4", "#d98a8a"].map(colour);
  const parts = [];
  for (const x of [-0.45, 0.45]) {
    const body = dice.pick(colours);
    parts.push(box(0.5, 0.06, 0.6, colour("#5e4a35"), x, 0.35, 0));
    for (const side of [-1, 1]) parts.push(box(0.06, 0.32, 0.06, colour("#5e4a35"), x + side * 0.2, 0.16, 0));
    for (let k = 0; k < (detail ? 3 : 2); k += 1) parts.push(box(0.46, 0.22, 0.56, k === 1 ? dice.pick(colours) : body, x, 0.49 + k * 0.23, 0));
    const top = 0.38 + (detail ? 3 : 2) * 0.23;
    parts.push(gable(0.56, 0.66, 0.14, colour("#9aa0a4")).translate(x, top, 0));
  }
  return parts;
});
