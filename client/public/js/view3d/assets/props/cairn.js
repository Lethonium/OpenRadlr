/** A hikers' cairn: flat stones piled smaller toward the top, the top one white in winter. */
import { colour, ico, lumpy } from "../geom.js";
import { SNOW, defineProp } from "./prop.js";

export const cairn = defineProp({ id: "cairn", name: "Cairn", description: "A pile of flat stones that marks the way over high ground." }, ({ season, detail, random, dice }) => { // i18n-ok
  const greys = ["#8d8f90", "#7c7f80", "#9b9c99"].map(colour);
  const stones = detail ? 6 : 4;
  const parts = [];
  let y = 0;
  for (let i = 0; i < stones; i += 1) {
    const size = 0.5 * (1 - (i / stones) * 0.7);
    const top = i === stones - 1;
    const color = top && season === "winter" ? colour(SNOW) : dice.pick(greys);
    parts.push(lumpy(ico(1, 0, color), 0.1).scale(size, size * 0.45, size * (0.9 + random() * 0.2)).translate((random() - 0.5) * 0.08, y + size * 0.45, (random() - 0.5) * 0.08));
    y += size * 0.75;
  }
  return parts;
});
