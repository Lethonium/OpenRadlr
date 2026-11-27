/** A two-wheeled farm hand cart with a plank bed, side boards and two handles, stood on its wheels. */
import { box, colour, cylinder, rod } from "../geom.js";
import { defineProp } from "./prop.js";

export const cart = defineProp({ id: "cart", name: "Hand cart", description: "A wooden two-wheeled farm cart left by the road." }, ({ detail, dice }) => { // i18n-ok
  const wood = colour(dice.pick(["#8a6a48", "#7a5c40", "#6f5a44"]));
  const iron = colour("#3b3b3d");
  const parts = [box(1.5, 0.08, 1, wood, 0, 0.62, 0), box(1.5, 0.3, 0.06, wood, 0, 0.8, 0.5), box(1.5, 0.3, 0.06, wood, 0, 0.8, -0.5), box(0.06, 0.3, 1, wood, -0.72, 0.8, 0)];
  for (const side of [-1, 1]) {
    parts.push(cylinder(0.5, 0.5, 0.07, detail ? 12 : 8, iron, 0, 0.5, side * 0.62).rotateX(Math.PI / 2), cylinder(0.12, 0.12, 0.12, 6, wood, 0, 0.5, side * 0.62).rotateX(Math.PI / 2));
    parts.push(rod([0.7, 0.62, side * 0.4], [2.1, 0.45, side * 0.38], 0.03, wood, 4, true));
  }
  if (detail) parts.push(box(1.2, 0.04, 0.6, colour("#c9ae6a"), 0, 0.97, 0));
  return parts;
});
