/** A stack of felled logs between two stakes, ends toward the road. */
import { box, colour, cylinder } from "../geom.js";
import { defineProp } from "./prop.js";

export const logPile = defineProp({ id: "logPile", name: "Log pile", description: "Stacked logs at the edge of a wood." }, ({ detail, random, dice }) => { // i18n-ok
  const woods = ["#7a5a3c", "#6a4c32", "#8a6a48", "#5f4630"].map(colour);
  const parts = [];
  const rows = detail ? [5, 4, 3] : [4, 3];
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i += 1) {
      const x = (i - (count - 1) / 2) * 0.32;
      parts.push(cylinder(0.15, 0.15, 1.6 + random() * 0.3, 6, dice.pick(woods), x, 0.15 + row * 0.27, 0).rotateX(Math.PI / 2));
    }
  });
  for (const side of [-1, 1]) parts.push(box(0.08, 0.8, 0.08, colour("#4e3b2a"), side * 1.0, 0.4, 0.5));
  return parts;
});
