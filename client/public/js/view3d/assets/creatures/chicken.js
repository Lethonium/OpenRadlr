/** A free-range hen: a round body, a red comb, yellow legs and beak, pecking at the ground. */
import { box, colour, cone } from "../geom.js";
import { blob, defineCreature, legAt, limb } from "./creature.js";

const FEATHERS = ["#f4f1ea", "#a5602f", "#2b2828"];
const RED = colour("#d0302a");
const YELLOW = colour("#e8a830");

export const chicken = defineCreature({ id: "chicken", name: "Chicken", description: "Free-range hen scratching and pecking around the farmyard.", speed: 0.7, size: 0.5 }, ({ detail, dice }) => { // i18n-ok
  const feathers = dice.pick(FEATHERS);
  const body = [blob(detail ? 1 : 0, feathers, 0.2, 0.2, 0.26, 0, 0.36, 0), cone(0.11, 0.24, detail ? 6 : 4, colour(feathers)).rotateX(-0.8).translate(0, 0.48, -0.26)];
  const head = [blob(0, feathers, 0.1, 0.1, 0.1, 0, 0.6, 0.27), cone(0.035, 0.09, 4, YELLOW).rotateX(Math.PI / 2).translate(0, 0.58, 0.38)];
  if (detail) head.push(box(0.03, 0.08, 0.1, RED, 0, 0.7, 0.27), box(0.03, 0.06, 0.04, RED, 0, 0.52, 0.34));
  const legs = [-0.06, 0.06].map((x) => legAt([box(0.03, 0.22, 0.03, YELLOW, x, 0.11, 0)], [x, 0.22, x > 0 ? 0.02 : -0.02]));
  return { body, limbs: [limb(head, [0, 0.52, 0.2], "head"), ...legs] };
});
