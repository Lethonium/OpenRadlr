/** Four metres of white picket fence: posts, two rails and the pickets. */
import { box, colour } from "../geom.js";
import { defineProp } from "./prop.js";

const LENGTH = 4;

export const picketFence = defineProp({ id: "picketFence", name: "Picket fence", description: "Four metres of painted picket fence for village and farm verges." }, ({ detail, dice }) => { // i18n-ok
  const paint = colour(dice.pick(["#ece7da", "#e3dccb", "#d9e1e3"]));
  const wood = colour("#6f5a44");
  const parts = [];
  for (let i = 0; i <= 4; i += 1) parts.push(box(0.1, 1.05, 0.1, wood, -LENGTH / 2 + i, 0.52, 0));
  parts.push(box(LENGTH, 0.07, 0.05, wood, 0, 0.75, 0.07), box(LENGTH, 0.07, 0.05, wood, 0, 0.3, 0.07));
  const step = detail ? 0.25 : 0.5;
  for (let x = -LENGTH / 2 + step / 2; x < LENGTH / 2; x += step) parts.push(box(0.1, 0.9, 0.025, paint, x, 0.46, 0.11));
  return parts;
});
