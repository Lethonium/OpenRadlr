/**
 * A slim LED street lamp: a tapered pole on a round foot, a curved arm and a
 * flat head that lights up at night. The post stands at the origin and the
 * arm reaches toward -x (toward the road). Restyled from the reference.
 */
import { box, colour, cylinder, rod } from "../geom.js";
import { defineBuilding } from "./building.js";

const GREY = "#7b828a";

export const streetLamp = defineBuilding(
  { id: "streetLamp", name: "Street lamp", description: "A slim LED lamp post with a curved arm; the head glows at night." }, // i18n-ok
  () => {
    const grey = colour(GREY);
    const near = [
      cylinder(0.07, 0.13, 6, 6, grey, 0, 3, 0),
      cylinder(0.2, 0.22, 0.4, 8, grey, 0, 0.2, 0),
      rod([0, 5.9, 0], [-0.5, 6.35, 0], 0.06, grey, 5, true),
      rod([-0.5, 6.35, 0], [-1.4, 6.45, 0], 0.06, grey, 5, true),
      box(0.8, 0.12, 0.32, grey, -1.65, 6.42, 0),
    ];
    const far = [box(0.3, 6.4, 0.3, grey, 0, 3.2, 0)];
    const glows = [box(0.66, 0.04, 0.24, colour("#fff6e0"), -1.65, 6.35, 0)];
    return { near, far, glows, width: 2.3, depth: 0.44, eaves: 6.5, door: { x: -1.65, y: 6.4, z: 0.1 } };
  },
);
