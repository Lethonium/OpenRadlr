/**
 * The headland lighthouse: a stone foot, a tapered tower banded red and
 * white, a gallery with a rail, a glazed lantern under a red dome, and the
 * keeper's cottage at its side. The lamp is a glow. Restyled from the
 * reference's `lighthouse.js` (scenic palette, no beam: the beam is a layer's
 * business).
 */
import { box, colour, cone, cylinder } from "../geom.js";
import { defineBuilding } from "./building.js";
import { gable, onWall } from "./shapes.js";

const HEIGHT = 24;
const BASE = 1.8;
const TOP = BASE + HEIGHT;
const BANDS = 8;
const tower = (y) => 3 - ((y - BASE) / HEIGHT) * 1.12;

export const lighthouse = defineBuilding(
  { id: "lighthouse", name: "Lighthouse", description: "A banded tower with a gallery, a glazed lantern and a keeper's cottage; the lamp glows at night." }, // i18n-ok
  ({ detail, season }) => {
    const white = colour("#f2efe8");
    const red = colour("#c8382e");
    const stone = colour("#a59d90");
    const dark = colour("#2f3338");
    const roof = colour(season === "winter" ? "#e8ecef" : "#5a5f66");
    const near = [cylinder(5.2, 5.8, 3.4, 16, stone, 0, -0.1, 0, true), cylinder(5.2, 5.2, 0.1, 16, stone, 0, 1.6, 0)];
    for (let k = 0; k < BANDS; k += 1) {
      const y0 = BASE + (k * HEIGHT) / BANDS;
      near.push(cylinder(tower(y0 + HEIGHT / BANDS), tower(y0), HEIGHT / BANDS, 20, k % 2 ? red : white, 0, y0 + HEIGHT / BANDS / 2, 0, true));
    }
    const windows = [[6, 0.3], [11, 2.2], [16, 4.1], [20.5, 1.2]];
    const glows = windows.map(([y, a]) => onWall(box(0.5, 0.9, 0.12, white), Math.sin(a) * tower(y), y, Math.cos(a) * tower(y), a));
    for (const [y, a] of windows) near.push(onWall(box(0.75, 1.15, 0.1, dark), Math.sin(a) * (tower(y) - 0.02), y, Math.cos(a) * (tower(y) - 0.02), a));
    near.push(box(1.2, 2.2, 0.3, dark, 0, 2.9, tower(2.9) + 0.05), box(1.6, 0.2, 0.6, white, 0, 4.1, tower(4.1) + 0.2));
    // Gallery, lantern room and dome.
    near.push(cylinder(2.7, 2.2, 0.5, 20, dark, 0, TOP + 0.25, 0), cylinder(2.55, 2.55, 1, 20, dark, 0, TOP + 1, 0, true), cylinder(1.6, 1.6, 0.6, 16, white, 0, TOP + 0.8, 0));
    for (let k = 0; k < (detail ? 10 : 4); k += 1) {
      const a = (k / (detail ? 10 : 4)) * Math.PI * 2;
      near.push(box(0.08, 2, 0.08, dark, Math.cos(a) * 1.5, TOP + 2.1, Math.sin(a) * 1.5));
    }
    near.push(cylinder(1.7, 1.7, 0.2, 16, dark, 0, TOP + 3.15, 0), cone(1.9, 1.6, 16, red, 0, TOP + 4.1, 0), cylinder(0.05, 0.05, 0.9, 4, dark, 0, TOP + 5.3, 0));
    glows.push(cylinder(1.1, 1.1, 1.8, 10, colour("#fff2c0"), 0, TOP + 2.1, 0, true));
    // The keeper's cottage.
    near.push(box(7, 3.2, 4.5, white, 6.2, 1.6, 1), onWall(gable(7.6, 5, 2, roof), 6.2, 3.2, 1), box(0.9, 3, 0.9, white, 8.2, 4.5, 0), box(1, 2, 0.08, red, 6.2, 1, 3.28));
    for (const x of [4.6, 7.8]) {
      glows.push(box(0.9, 1, 0.08, white, x, 1.8, 3.28));
      near.push(box(1.1, 1.2, 0.06, dark, x, 1.8, 3.25));
    }
    const far = [cylinder(2, 2.9, TOP, 8, white, 0, TOP / 2, 0, true), cylinder(4, 5, 2, 8, stone, 0, 0.5, 0, true), cone(2, 3.5, 8, red, 0, TOP + 1.5, 0), box(7, 3.2, 4.5, white, 6.2, 1.6, 1)];
    return { near, far, glows, width: 15.2, depth: 11.6, eaves: TOP, door: { x: 0, y: 1.1, z: 3 } };
  },
);
