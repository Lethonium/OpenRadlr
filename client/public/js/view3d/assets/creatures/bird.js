/** A bird in flight: a plump body, a hooked beak, two wings that beat about the shoulders. */
import { colour, cone } from "../geom.js";
import { blob, defineCreature, limb, sheet } from "./creature.js";

const PLUMAGE = ["#ffffff", "#e9edf0", "#5c4a3a"];
const TIP = "#2a2a2e";

export const bird = defineCreature({ id: "bird", name: "Bird", description: "Gulls on the coast; flocks circle the towns.", speed: 8, size: 0.7, centred: true }, ({ detail, dice }) => { // i18n-ok
  const feathers = dice.pick(PLUMAGE);
  const body = [blob(0, feathers, 0.12, 0.1, 0.32, 0, 0, 0)];
  if (detail) {
    body.push(cone(0.04, 0.1, 4, colour("#e8a830")).rotateX(Math.PI / 2).translate(0, 0, 0.38), sheet([[[-0.07, 0, -0.28, feathers], [0.07, 0, -0.28, feathers], [0, 0, -0.55, feathers]]]));
  }
  const wing = (side) => limb([sheet([[[0.05 * side, 0, 0.15, feathers], [0.05 * side, 0, -0.1, feathers], [0.75 * side, 0, -0.05, detail ? TIP : feathers]]])], [0.08 * side, 0, 0], "wing");
  return { body, limbs: [wing(1), wing(-1)] };
});
