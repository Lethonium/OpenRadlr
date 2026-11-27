/** A dairy cow: a boxy body, patches of black on white, a pink muzzle, a swishing tail. */
import { box, colour, cone, rod } from "../geom.js";
import { defineCreature, legAt, limb } from "./creature.js";

const WHITE = colour("#fbf8f2");
const DARK = colour("#2b2622");
const PINK = colour("#f2a7b0");
const HORN = colour("#e9e1c9");

export const cow = defineCreature({ id: "cow", name: "Cow", description: "Patchy dairy cow for meadows.", speed: 0.8, size: 2.9 }, ({ detail, random, dice }) => { // i18n-ok
  const base = detail || random() < 0.7 ? WHITE : DARK;
  const body = [box(0.95, 1, 2, base, 0, 1.35, 0)];
  if (detail) {
    for (let k = 0; k < dice.range(2, 5); k += 1) {
      const length = dice.range(0.35, 0.7);
      body.push(box(0.97, dice.range(0.4, 1.02), length, DARK, 0, 1.35 + dice.range(-0.08, 0.08), dice.range(-0.9, 0.9) * (1 - length / 2)));
    }
    body.push(box(0.4, 0.14, 0.4, PINK, 0, 0.82, -0.4));
  }
  const head = [box(0.55, 0.55, 0.6, WHITE, 0, 1.6, 1.3), box(0.5, 0.3, 0.2, PINK, 0, 1.5, 1.65)];
  if (detail) {
    for (const side of [-1, 1]) {
      head.push(cone(0.06, 0.3, 4, HORN, side * 0.22, 1.98, 1.2), box(0.22, 0.08, 0.14, DARK, side * 0.38, 1.76, 1.15));
    }
  }
  const legs = [[0.32, 0.75], [-0.32, 0.75], [0.32, -0.75], [-0.32, -0.75]].map(([x, z]) => {
    const parts = [box(0.2, 0.85, 0.2, DARK, x, 0.425, z)];
    if (detail) parts.push(box(0.22, 0.1, 0.22, HORN, x, 0.05, z));
    return legAt(parts, [x, 0.85, z]);
  });
  return { body, limbs: [limb(head, [0, 1.6, 1], "head"), limb([rod([0, 1.8, -1], [0, 1, -1.12], 0.04, DARK, 4)], [0, 1.8, -1], "tail"), ...legs] };
});
