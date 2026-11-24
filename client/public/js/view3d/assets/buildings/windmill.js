/**
 * A Mallorcan windmill: a round, slightly tapering sandstone tower with a
 * thatched cone cap, a door and a window, and a wheel of four lattice sails
 * with canvas. The sails are a separate `sails` mover (pivot at the cap's
 * axle, axis z) so the layer can turn them; the sails and the door face +z.
 * The tower is #127's (10.5 m, far twin under 60 triangles); the sail lattice
 * is restyled from the reference's `windmill.js`.
 */
import { box, colour, cone, cylinder } from "../geom.js";
import { defineBuilding } from "./building.js";

export const MILL_HEIGHT = 10.5;
const SAIL = Object.freeze({ inner: 1.3, outer: 7, width: 1.7 });
const HUB = Object.freeze({ y: MILL_HEIGHT - 1.1, z: 3.5 });

/** The wheel's geometries round its hub, sails along +y and the stocks across. */
function wheel({ detail, wood, canvas, dark }) {
  const parts = [box(0.38, 2 * SAIL.outer + 0.6, 0.3, dark), box(2 * SAIL.outer + 0.6, 0.38, 0.3, dark, 0, 0, -0.05), cylinder(0.55, 0.55, 0.7, 8, dark).rotateX(Math.PI / 2)];
  const length = SAIL.outer - SAIL.inner;
  const mid = (SAIL.outer + SAIL.inner) / 2;
  for (let k = 0; k < 4; k += 1) {
    const sail = [box(0.1, length, 0.1, wood, SAIL.width, mid, 0.2), box(0.1, length, 0.1, wood, -0.35, mid, 0.2)];
    if (detail) {
      for (let y = SAIL.inner + 0.4; y <= SAIL.outer; y += 1.3) sail.push(box(SAIL.width + 0.5, 0.07, 0.07, wood, SAIL.width / 2 - 0.1, y, 0.22));
      const reef = k % 2 ? 0.72 : 1;
      sail.push(box(SAIL.width - 0.2, length * reef, 0.03, canvas, SAIL.width / 2 + 0.05, SAIL.outer - (length * reef) / 2, 0.3));
    }
    for (const part of sail) parts.push(part.rotateZ((k * Math.PI) / 2));
  }
  return parts;
}

export const windmill = defineBuilding(
  { id: "windmill", name: "Windmill", description: "A sandstone tower mill with a thatched cap and four lattice sails that turn." }, // i18n-ok
  ({ detail, season, dice }) => {
    const stone = colour(dice.pick(["#d4b280", "#c9a876", "#dbbb8a"]));
    const band = colour("#bda274");
    const dark = colour("#3b2f27");
    const wood = colour("#5e4330");
    const thatch = colour(season === "winter" ? "#eceff1" : "#6b4f33");
    const near = [
      cylinder(3.6, 3.7, 1.2, 12, band, 0, -0.1, 0, true),
      cylinder(2.4, 3.5, MILL_HEIGHT, 12, stone, 0, MILL_HEIGHT / 2, 0, true),
      cylinder(3, 3, 0.35, 12, band, 0, MILL_HEIGHT + 0.1, 0),
      cone(3.1, 2.8, 12, thatch, 0, MILL_HEIGHT + 1.7, 0),
      box(1.1, 2.2, 0.4, dark, 0, 1.1, 3.45),
      box(0.5, 0.5, 1.9, dark, 0, HUB.y, 2.5),
    ];
    if (detail) near.push(box(0.8, 0.14, 0.5, colour("#f1ede4"), 0, 2.3, 3.55), box(0.8, 1.2, 0.4, wood, 0, 6.4, 2.65));
    const glows = [box(0.55, 0.8, 0.1, colour("#fff0c8"), 0, 6.4, 2.9)];
    const far = [cylinder(2.4, 3.5, MILL_HEIGHT, 4, stone, 0, MILL_HEIGHT / 2, 0, true), cone(3.1, 2.8, 4, thatch, 0, MILL_HEIGHT + 1.4, 0, true)];
    const sails = { name: "sails", geometries: wheel({ detail, wood, canvas: colour("#efe6d2"), dark }).map((part) => part.translate(0, HUB.y, HUB.z)), x: 0, y: HUB.y, z: HUB.z, axis: [0, 0, 1] };
    return { near, far, glows, movers: [sails], width: 7.4, depth: 7.4, eaves: MILL_HEIGHT, door: { x: 0, y: 1.1, z: 3.45 } };
  },
);
