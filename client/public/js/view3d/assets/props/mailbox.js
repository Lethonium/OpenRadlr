/** A farm mailbox on a post, with its flag up. */
import { box, colour, cylinder } from "../geom.js";
import { defineProp } from "./prop.js";

export const mailbox = defineProp({ id: "mailbox", name: "Mailbox", description: "A rural mailbox on a wooden post." }, ({ detail, dice }) => { // i18n-ok
  const body = colour(dice.pick(["#2f5f9a", "#b8332a", "#4a4d50"]));
  const parts = [box(0.1, 1.1, 0.1, colour("#6f5a44"), 0, 0.55, 0), box(0.42, 0.24, 0.2, body, 0, 1.2, 0), box(0.5, 0.05, 0.3, colour("#6f5a44"), 0, 1.06, 0)];
  if (detail) parts.push(cylinder(0.1, 0.1, 0.42, 8, body, 0, 1.32, 0).rotateZ(Math.PI / 2).translate(0, -0.0, 0), box(0.03, 0.2, 0.03, colour("#d63a2c"), 0.18, 1.34, 0.12));
  return parts;
});
