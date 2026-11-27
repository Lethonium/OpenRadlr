/** Four metres of plank walkway over wet ground: cross planks on two stringers. */
import { box, colour } from "../geom.js";
import { defineProp } from "./prop.js";

export const boardwalk = defineProp({ id: "boardwalk", name: "Boardwalk", description: "A plank walkway across boggy ground." }, ({ detail, random, dice }) => { // i18n-ok
  const planks = ["#8d7655", "#7f6a4c", "#98825f"].map(colour);
  const parts = [box(4, 0.1, 0.12, colour("#5e4a35"), 0, 0.05, -0.45), box(4, 0.1, 0.12, colour("#5e4a35"), 0, 0.05, 0.45)];
  const count = detail ? 14 : 8;
  for (let i = 0; i < count; i += 1) parts.push(box((4 / count) * 0.88, 0.06, 1.3 + random() * 0.1, dice.pick(planks), -2 + (i + 0.5) * (4 / count), 0.13, 0));
  return parts;
});
