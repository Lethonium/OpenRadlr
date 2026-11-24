/** A farm pig, pink, saddleback or ginger, with a flat snout and a curl of tail. */
import { box, colour, cone, cylinder } from "../geom.js";
import { blob, defineCreature, legAt, limb } from "./creature.js";

const BREEDS = [["#efb4a6", "#e89a90"], ["#2b2624", "#f1e7df"], ["#c0703e", "#b0623a"]];

export const pig = defineCreature({ id: "pig", name: "Pig", description: "Farm pig, pink, saddleback or ginger; roots around its pen.", speed: 0.6, size: 1.7 }, ({ detail, dice }) => { // i18n-ok
  const [main, snout] = dice.pick(BREEDS);
  const body = [blob(1, main, 0.42, 0.42, 0.85, 0, 0.72, 0)];
  const head = [detail ? blob(1, main, 0.34, 0.32, 0.34, 0, 0.8, 0.95) : box(0.5, 0.5, 0.5, colour(main), 0, 0.8, 0.95)];
  if (detail) {
    head.push(cylinder(0.15, 0.17, 0.16, 6, colour(snout)).rotateX(Math.PI / 2).translate(0, 0.74, 1.27));
    for (const side of [-1, 1]) head.push(cone(0.12, 0.26, 4, colour(main), side * 0.18, 1.12, 0.9));
  } else head.push(box(0.26, 0.2, 0.14, colour(snout), 0, 0.74, 1.25));
  const legs = [[0.22, 0.45], [-0.22, 0.45], [0.22, -0.45], [-0.22, -0.45]].map(([x, z]) => legAt([box(0.14, 0.42, 0.14, colour(main).multiplyScalar(0.92), x, 0.21, z)], [x, 0.42, z]));
  return { body, limbs: [limb(head, [0, 0.82, 0.8], "head"), limb([cone(0.05, 0.22, 4, colour(main), 0, 0.9, -0.95)], [0, 0.9, -0.85], "tail"), ...legs] };
});
