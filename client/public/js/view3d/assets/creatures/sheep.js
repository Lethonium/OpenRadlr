/** A woolly sheep with a dark face and dark legs. */
import { box, colour } from "../geom.js";
import { blob, defineCreature, legAt, limb } from "./creature.js";

const WOOL = "#f6f3ea";
const DARK = colour("#2b2622");

export const sheep = defineCreature({ id: "sheep", name: "Sheep", description: "Grazes in spring meadows.", speed: 0.9, size: 1.9 }, ({ detail, season, dice }) => { // i18n-ok
  const wool = season === "winter" ? "#ffffff" : dice.pick([WOOL, "#efe9db", "#f6f3ea"]);
  const body = [blob(1, wool, 1.0, 0.72, 0.75, 0, 1, 0)];
  const head = [box(0.38, 0.4, 0.42, DARK, 0, 1.15, 1.1)];
  if (detail) {
    head.push(blob(0, wool, 0.22, 0.14, 0.2, 0, 1.4, 1.02));
    for (const side of [-1, 1]) head.push(box(0.25, 0.08, 0.1, DARK, side * 0.27, 1.25, 1));
  }
  const legs = [[0.28, 0.45], [-0.28, 0.45], [0.28, -0.45], [-0.28, -0.45]].map(([x, z]) => legAt([box(0.14, 0.62, 0.14, DARK, x, 0.31, z)], [x, 0.62, z]));
  return { body, limbs: [limb(head, [0, 1.15, 0.95], "head"), ...legs] };
});
