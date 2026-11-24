/** A dolphin: a grey back, pale belly, dorsal fin, beak and tail flukes that beat. */
import { box, colour, cone } from "../geom.js";
import { blob, defineCreature, limb } from "./creature.js";

const BACK = "#6f8fae";
const BELLY = "#dfe8ef";

export const dolphin = defineCreature({ id: "dolphin", name: "Dolphin", description: "Leaps out of the sea off the south and east coasts.", speed: 6, size: 3.6, centred: true }, ({ detail }) => { // i18n-ok
  const back = colour(BACK);
  const body = [blob(1, BACK, 0.5, 0.45, 1.5, 0, 0, 0), cone(0.2, 0.6, 4, back).rotateX(-0.4).translate(0, 0.55, -0.2), cone(0.12, 0.6, 5, back).rotateX(Math.PI / 2).translate(0, -0.03, 1.8)];
  if (detail) {
    body.push(blob(1, BELLY, 0.42, 0.3, 1.35, 0, -0.2, 0.05));
    for (const side of [-1, 1]) body.push(box(0.3, 0.05, 0.2, back).rotateZ(side * 0.5).translate(side * 0.5, -0.3, 0.6));
  }
  return { body, limbs: [limb([box(1.1, 0.07, 0.3, back, 0, 0, -1.9)], [0, 0, -1.4], "tail")] };
});
