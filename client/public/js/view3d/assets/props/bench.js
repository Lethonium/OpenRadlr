/** A village bench: two seat planks, two backrest planks and two trestle ends, facing +z. */
import { box, colour } from "../geom.js";
import { defineProp } from "./prop.js";

export const bench = defineProp({ id: "bench", name: "Bench", description: "A wooden bench to rest on at the edge of a village." }, ({ detail, dice }) => { // i18n-ok
  const wood = colour(dice.pick(["#8a6a48", "#7a5c40", "#a07f55"]));
  const iron = colour("#3f4144");
  const parts = [box(1.6, 0.05, 0.2, wood, 0, 0.45, 0.1), box(1.6, 0.05, 0.2, wood, 0, 0.45, -0.12), box(1.6, 0.16, 0.04, wood, 0, 0.85, -0.25)];
  if (detail) parts.push(box(1.6, 0.16, 0.04, wood, 0, 0.67, -0.25));
  for (const side of [-1, 1]) parts.push(box(0.06, 0.45, 0.5, iron, side * 0.7, 0.22, -0.05), box(0.06, 0.45, 0.05, iron, side * 0.7, 0.68, -0.25));
  return parts;
});
