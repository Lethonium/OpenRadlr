/** Four metres of dry-stone wall: two courses of uneven stones under a row of capstones (white in winter). */
import { box, colour } from "../geom.js";
import { SNOW, defineProp } from "./prop.js";

export const stoneWall = defineProp({ id: "stoneWall", name: "Stone wall", description: "A dry-stone wall that bounds fields and pastures." }, ({ season, detail, random, dice }) => { // i18n-ok
  const stones = ["#8c877c", "#9b9486", "#7d796f", "#a39b88"].map(colour);
  const cap = colour(season === "winter" ? SNOW : "#6f7a5a");
  const parts = [];
  const course = (y, height, count) => {
    for (let i = 0; i < count; i += 1) {
      const width = 4 / count;
      parts.push(box(width * 0.96, height * (0.85 + random() * 0.3), 0.55 + random() * 0.1, dice.pick(stones), -2 + (i + 0.5) * width, y, 0).rotateY((random() - 0.5) * 0.08));
    }
  };
  course(0.22, 0.44, detail ? 6 : 4);
  course(0.62, 0.38, detail ? 7 : 4);
  for (let i = 0; i < (detail ? 8 : 4); i += 1) parts.push(box(0.46 * (detail ? 1 : 2), 0.18, 0.62, cap, -2 + (i + 0.5) * (detail ? 0.5 : 1), 0.9, 0));
  return parts;
});
