/** A tall roadside marker pole, banded red and white with a reflector, so the ploughs find the verge under snow. */
import { box, colour, cylinder } from "../geom.js";
import { defineProp } from "./prop.js";

export const snowPole = defineProp({ id: "snowPole", name: "Snow pole", description: "A tall marker pole that shows the road's edge under snow." }, ({ detail }) => { // i18n-ok
  const white = colour("#efece4");
  const red = colour("#c8382e");
  const parts = [];
  const bands = detail ? 5 : 3;
  for (let k = 0; k < bands; k += 1) parts.push(cylinder(0.04, 0.04, 2.4 / bands, 6, k % 2 ? red : white, 0, ((k + 0.5) * 2.4) / bands, 0, true));
  parts.push(cylinder(0.04, 0.04, 0.01, 6, white, 0, 2.4, 0), box(0.1, 0.18, 0.03, colour("#ffb21f"), 0, 2.1, 0.05));
  return parts;
});
