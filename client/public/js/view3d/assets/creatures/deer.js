/** A deer: long legs, a slender neck, pale rump patch; a stag carries antlers outside winter. */
import { box, colour, cylinder, rod } from "../geom.js";
import { blob, defineCreature, legAt, limb } from "./creature.js";

const FUR = "#a8673a";
const LIGHT = colour("#f1e1c8");
const DARK = colour("#3b2616");

export const deer = defineCreature({ id: "deer", name: "Deer", description: "Wanders the autumn woods.", speed: 1.8, size: 2.2 }, ({ detail, season, dice }) => { // i18n-ok
  const fur = colour(season === "winter" ? "#8a6b4e" : dice.pick([FUR, "#9a5e34", "#b57a46"]));
  const body = [blob(detail ? 1 : 0, fur, 0.42, 0.45, 0.9, 0, 1.35, 0), blob(0, LIGHT, 0.12, 0.12, 0.12, 0, 1.5, -0.88)];
  const head = [cylinder(0.13, 0.2, 0.8, 4, fur).rotateX(0.6).translate(0, 1.7, 0.75), box(0.26, 0.28, 0.45, fur, 0, 2.05, 1.05)];
  if (detail && season !== "winter" && dice.chance(0.6)) {
    for (const side of [-1, 1]) head.push(rod([side * 0.1, 2.15, 0.95], [side * 0.28, 2.75, 0.85], 0.03, LIGHT, 4), rod([side * 0.2, 2.5, 0.9], [side * 0.18, 2.7, 1.2], 0.025, LIGHT, 4));
  }
  const legs = [[0.2, 0.5], [-0.2, 0.5], [0.2, -0.5], [-0.2, -0.5]].map(([x, z]) => legAt([cylinder(0.06, 0.05, 1.05, 4, DARK, x, 0.525, z)], [x, 1.05, z]));
  return { body, limbs: [limb(head, [0, 1.7, 0.7], "head"), ...legs] };
});
