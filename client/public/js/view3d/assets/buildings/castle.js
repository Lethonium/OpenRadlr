/**
 * A castle ruin: a rectangular curtain wall with a gate and breaches, ragged
 * at the top, stub towers at three corners and one tall round keep. The gate
 * faces +z. Rebuilt from #127's castle ruin; the reference's fantasy castle
 * (flags, blue roofs) is not used. Walls are founded 1.5 m below the foot so
 * the layer can set the ruin on a slope.
 */
import { box, colour, cylinder } from "../geom.js";
import { defineBuilding } from "./building.js";
import { onWall } from "./shapes.js";

const HALF = [22, 16];
const THICK = 2.4;
const SLAB = 3.2;
const FOUNDATION = 1.5;
const KEEP_HEIGHT = 20;
/** The keep's footing radius: it stands on a corner, so it reaches past the wall rectangle. */
const KEEP_REACH = 6;
const CORNERS = Object.freeze([[-HALF[0], -HALF[1]], [HALF[0], -HALF[1]], [HALF[0], HALF[1]], [-HALF[0], HALF[1]]]);
/** Runs of each side: [from, to, height]; height 0 is a gap. Side 2 (the +z side) holds the gate. */
const SIDES = Object.freeze([
  { a: 0, b: 1, runs: [[0, 0.35, 7], [0.35, 1, 5]] },
  { a: 1, b: 2, runs: [[0, 0.4, 6.5], [0.4, 0.55, 0], [0.55, 1, 3.5]] },
  { a: 3, b: 2, runs: [[0, 0.3, 6], [0.3, 0.45, 0], [0.45, 1, 7]] },
  { a: 0, b: 3, runs: [[0, 0.6, 5], [0.6, 0.8, 0], [0.8, 1, 4]] },
]);
const GATE = Object.freeze({ x: -HALF[0] + 2 * HALF[0] * 0.375, z: HALF[1] });

export const castle = defineBuilding(
  { id: "castle", name: "Castle ruin", description: "A broken curtain wall with a gate, stub towers and one tall keep." }, // i18n-ok
  ({ detail, season, dice }) => {
    const stones = ["#a29d90", "#ada48c", "#8f8a80"].map(colour);
    const dark = colour("#3b3935");
    const snow = colour("#eef1f3");
    const near = [];
    const far = [];
    const wall = (x, z, length, alongX, top, shade) => {
      const size = alongX ? [length + 0.05, top + FOUNDATION, THICK] : [THICK, top + FOUNDATION, length + 0.05];
      near.push(box(...size, shade, x, (top - FOUNDATION) / 2, z));
      if (detail && top > 2) near.push(box(alongX ? length * 0.5 : THICK * 0.5, 0.5, alongX ? THICK * 0.5 : length * 0.5, season === "winter" ? snow : shade, x, top + 0.25, z));
    };
    const blocks = [];
    for (const { a, b, runs } of SIDES) {
      const [from, to] = [CORNERS[a], CORNERS[b]];
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const alongX = Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1]);
      for (const [start, end, height] of runs) {
        if (height === 0) continue;
        const count = Math.max(1, Math.round(((end - start) * length) / SLAB));
        for (let i = 0; i < count; i += 1) {
          const f = start + ((i + 0.5) / count) * (end - start);
          wall(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, ((end - start) * length) / count, alongX, height * (0.65 + dice.range(0, 0.35)), dice.pick(stones));
        }
        blocks.push({ x: from[0] + (to[0] - from[0]) * ((start + end) / 2), z: from[1] + (to[1] - from[1]) * ((start + end) / 2), size: alongX ? [(end - start) * length, THICK] : [THICK, (end - start) * length], height });
      }
    }
    for (const [x, z] of [CORNERS[0], CORNERS[2], CORNERS[3]]) {
      const top = 7 + dice.range(0, 2);
      near.push(cylinder(3, 3.8, top + FOUNDATION, 9, stones[0], x, (top - FOUNDATION) / 2, z));
    }
    const [kx, kz] = CORNERS[1];
    near.push(cylinder(5, KEEP_REACH, KEEP_HEIGHT + FOUNDATION, 12, stones[1], kx, (KEEP_HEIGHT - FOUNDATION) / 2, kz));
    for (let i = 0; i < 12; i += 1) {
      if (i % 3 === 1) continue; // a broken crenellation
      const angle = (i / 12) * Math.PI * 2;
      near.push(box(1.5, 1.4, 1.5, stones[2], kx + Math.cos(angle) * 4.6, KEEP_HEIGHT + 0.7, kz + Math.sin(angle) * 4.6));
    }
    const slits = [0.6, 2.4, 4.1].map((angle) => onWall(box(0.6, 2.2, 0.1, dark), kx + Math.cos(angle) * 5.2, KEEP_HEIGHT * 0.65, kz + Math.sin(angle) * 5.2, Math.PI / 2 - angle));
    near.push(...slits.map((slit) => slit.clone()));
    // The gate: two dressed posts either side of the gap in the +z wall.
    for (const side of [-1, 1]) near.push(box(1.4, 6.5, THICK + 0.4, stones[2], GATE.x + side * 3.4, 2.25, GATE.z));
    for (const [x, z, shade] of [[kx, kz, stones[1]]]) far.push(cylinder(5, 6, KEEP_HEIGHT + FOUNDATION, 6, shade, x, (KEEP_HEIGHT - FOUNDATION) / 2, z));
    for (const { x, z, size, height } of [blocks[0], blocks[2], blocks[5]]) far.push(box(size[0], height * 0.8 + FOUNDATION, size[1], stones[0], x, (height * 0.8 - FOUNDATION) / 2, z));
    return { near, far, glows: slits, width: 2 * (HALF[0] + KEEP_REACH), depth: 2 * (HALF[1] + KEEP_REACH), eaves: 7, door: { x: GATE.x, y: 1, z: GATE.z } };
  },
);
