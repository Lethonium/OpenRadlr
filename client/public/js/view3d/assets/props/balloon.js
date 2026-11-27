/**
 * A hot-air balloon: a pear of ten gores in two bright colours over a wicker
 * basket on four ropes, the burner a glow under the mouth. Local zero is the
 * basket's floor; the layer flies it round its loop. Restyled from the
 * reference's `balloon.js` and #127's balloon (two bright colours, <= 200
 * triangles), with the envelope lathed into a pear instead of a sphere.
 */
import * as THREE from "../../../three.js";
import { box, colour, ico, paint, rod } from "../geom.js";
import { defineBuilding } from "../buildings/building.js";

const GORES = 10;
const PAIRS = Object.freeze([["#e8423b", "#ffd23f"], ["#2d8fe0", "#fff6e6"], ["#f08a24", "#fff6e6"], ["#3aa56a", "#ffd23f"], ["#c93a8a", "#fff6e6"]]);
/** [radius, height] from the mouth up to the crown. */
const PROFILE = Object.freeze([[1.9, 6], [5.4, 8.5], [8.6, 13.5], [9, 18], [7, 23.5], [3.4, 28], [0.01, 30]]);

/** The envelope lathed from the profile, its gores alternating `a` and `b`. */
function envelope(rows, a, b) {
  const profile = rows.map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = paint(new THREE.LatheGeometry(profile, GORES), a);
  const { position, color } = geometry.attributes;
  for (let i = 0; i < position.count; i += 3) {
    const angle = Math.atan2((position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3, (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3);
    const gore = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * GORES) % 2;
    for (let k = 0; k < 3; k += 1) color.setXYZ(i + k, ...(gore ? b : a).toArray());
  }
  return geometry;
}

export const balloon = defineBuilding(
  { id: "balloon", name: "Hot-air balloon", description: "A pear-shaped balloon of ten gores in two bright colours, with a basket and a burner." }, // i18n-ok
  ({ dice }) => {
    const [a, b] = dice.pick(PAIRS).map(colour);
    const wicker = colour("#8a5a36");
    const rope = colour("#3a3028");
    const basket = box(2, 1.6, 2, wicker, 0, 0.8, 0);
    const near = [envelope(PROFILE, a, b), basket];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) near.push(rod([sx * 0.9, 1.6, sz * 0.9], [sx * 1.9, 6.4, sz * 1.9], 0.05, rope, 3, true));
    const far = [envelope([PROFILE[0], PROFILE[2], PROFILE[4], PROFILE[6]], a, b), box(2, 1.6, 2, wicker, 0, 0.8, 0)];
    const glows = [ico(0.55, 0, colour("#ffb347"), 0, 4.6, 0)];
    return { near, far, glows, width: 18, depth: 18, eaves: 6, door: { x: 0, y: 1, z: 1 } };
  },
);
