/** A paddock horse: a long neck that drops to graze, a flowing tail, pale hooves on the bay. */
import { box, colour, cone } from "../geom.js";
import { blob, defineCreature, legAt, limb } from "./creature.js";

const COATS = [["#7a4a2a", "#1f1a17"], ["#a5602f", "#7a4020"], ["#cfcbc4", "#8a8680"], ["#2b2622", "#1a1716"]];

export const horse = defineCreature({ id: "horse", name: "Horse", description: "Paddock horse: bay, chestnut, grey or black.", speed: 1, size: 2.9 }, ({ detail, dice }) => { // i18n-ok
  const [coat, mane] = dice.pick(COATS).map(colour);
  const body = detail ? [blob(1, coat, 0.45, 0.5, 1.0, 0, 1.55, 0)] : [box(0.8, 0.9, 1.9, coat, 0, 1.55, 0)];
  const head = [box(0.34, 0.5, 1.0, coat, 0, 2.15, 1.2), box(0.28, 0.3, 0.7, coat, 0, 2.3, 1.95), box(0.1, 0.5, 0.8, mane, 0, 2.5, 1.0)];
  if (detail) {
    for (const side of [-1, 1]) head.push(cone(0.06, 0.2, 4, coat, side * 0.1, 2.6, 1.7));
    head.push(box(0.22, 0.26, 0.2, mane, 0, 2.2, 2.35));
  }
  const tail = [cone(0.12, 1, 6, mane).rotateX(Math.PI).translate(0, 1.1, -1.25)];
  const legs = [[0.22, 0.62], [-0.22, 0.62], [0.22, -0.62], [-0.22, -0.62]].map(([x, z]) => {
    const parts = [box(0.15, 1.1, 0.15, coat, x, 0.65, z)];
    if (detail) parts.push(box(0.17, 0.14, 0.17, colour("#2a2522"), x, 0.07, z));
    return legAt(parts, [x, 1.2, z]);
  });
  return { body, limbs: [limb(head, [0, 1.95, 0.85], "head"), limb(tail, [0, 1.6, -1.1], "tail"), ...legs] };
});
