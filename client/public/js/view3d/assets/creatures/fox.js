/** A red fox with a white-tipped brush; in winter the arctic coat. */
import { box, colour, cone } from "../geom.js";
import { blob, defineCreature, legAt, limb } from "./creature.js";

const DARK = colour("#2b2622");

export const fox = defineCreature({ id: "fox", name: "Fox", description: "Red fox in autumn; white in winter.", speed: 1.7, size: 1.6 }, ({ detail, season }) => { // i18n-ok
  const winter = season === "winter";
  const fur = winter ? "#f4f6fa" : "#e0702a";
  const body = [blob(detail ? 1 : 0, fur, 0.24, 0.26, 0.55, 0, 0.6, 0)];
  const head = [blob(0, fur, 0.2, 0.2, 0.2, 0, 0.78, 0.62), cone(0.1, 0.3, 5, colour(fur)).rotateX(Math.PI / 2).translate(0, 0.74, 0.88)];
  if (detail) for (const side of [-1, 1]) head.push(cone(0.07, 0.2, 4, colour(fur), side * 0.1, 1, 0.58));
  const tail = [cone(0.15, 0.7, 6, colour(fur)).rotateX(-Math.PI / 2 - 0.3).translate(0, 0.78, -0.95)];
  if (detail) tail.push(blob(0, "#ffffff", 0.08, 0.08, 0.08, 0, 0.68, -1.27));
  const legs = [[0.13, 0.35], [-0.13, 0.35], [0.13, -0.35], [-0.13, -0.35]].map(([x, z]) => legAt([box(0.09, 0.48, 0.09, DARK, x, 0.24, z)], [x, 0.48, z]));
  return { body, limbs: [limb(head, [0, 0.7, 0.5], "head"), limb(tail, [0, 0.7, -0.6], "tail"), ...legs] };
});
