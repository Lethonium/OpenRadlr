/** A rabbit: a round body, long ears, a white scut; the winter coat is pale. */
import { box, colour } from "../geom.js";
import { blob, defineCreature, legAt, limb } from "./creature.js";

const FURS = ["#b08a68", "#d8d2c8", "#8f7a66", "#f4f1ea"];

export const rabbit = defineCreature({ id: "rabbit", name: "Rabbit", description: "Hops around spring and autumn meadows.", speed: 2.4, size: 0.6 }, ({ detail, season, dice }) => { // i18n-ok
  const fur = season === "winter" ? "#e6e0d6" : dice.pick(FURS);
  const body = [blob(detail ? 1 : 0, fur, 0.24, 0.24, 0.32, 0, 0.24, 0)];
  if (detail) body.push(blob(0, "#ffffff", 0.08, 0.08, 0.08, 0, 0.3, -0.34));
  const head = [blob(0, fur, 0.15, 0.15, 0.15, 0, 0.42, 0.3)];
  for (const side of [-1, 1]) head.push(box(0.06, 0.3, 0.09, colour(fur), side * 0.06, 0.66, 0.26));
  const legs = [[0.12, 0.2], [-0.12, 0.2], [0.12, -0.2], [-0.12, -0.2]].map(([x, z]) => legAt([box(0.07, 0.14, 0.1, colour(fur), x, 0.07, z)], [x, 0.14, z]));
  return { body, limbs: [limb(head, [0, 0.4, 0.2], "head"), ...legs] };
});
