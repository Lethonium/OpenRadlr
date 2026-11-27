/**
 * A farm windpump: a galvanised lattice tower, a many-bladed wheel with a
 * tail vane, and a round stock-water tank at its foot. The wheel is a
 * separate `wheel` mover about the z axis (it faces +z). Restyled from the
 * reference's `windpump.js`.
 */
import * as THREE from "../../../three.js";
import { box, colour, cylinder, paint, rod } from "../geom.js";
import { defineBuilding } from "./building.js";

const HEIGHT = 10;
const BASE = 1.7;
const TOP = 0.32;
const BLADES = 18;
const WHEEL_Z = 0.75;

/** The lattice tower: four legs, ring braces and diagonals on each face. */
function tower(steel, detail) {
  const corner = (sx, sz, y) => {
    const r = BASE + (TOP - BASE) * (y / HEIGHT);
    return [sx * r, y, sz * r];
  };
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const parts = [];
  for (const [sx, sz] of corners) parts.push(rod(corner(sx, sz, 0), corner(sx, sz, HEIGHT), 0.07, steel, 4, true), box(0.5, 0.3, 0.5, colour("#a59d90"), sx * BASE, 0.1, sz * BASE));
  const levels = detail ? [0, 0.3, 0.58, 0.82, 1] : [0, 0.5, 1];
  for (let k = 0; k < 4; k += 1) {
    const [a, b] = [corners[k], corners[(k + 1) % 4]];
    for (let i = 0; i < levels.length - 1; i += 1) {
      const [y0, y1] = [levels[i] * HEIGHT, levels[i + 1] * HEIGHT];
      parts.push(rod(corner(...a, y1), corner(...b, y1), 0.04, steel, 3, true), rod(corner(...a, y0), corner(...b, y1), 0.03, steel, 3, true), rod(corner(...b, y0), corner(...a, y1), 0.03, steel, 3, true));
    }
  }
  return parts;
}

export const windpump = defineBuilding(
  { id: "windpump", name: "Windpump", description: "A multi-blade farm windpump on a lattice tower, with a tail vane and a water tank." }, // i18n-ok
  ({ detail }) => {
    const steel = colour("#9aa1a8");
    const vane = colour("#d9d6cf");
    const grey = colour("#6b7075");
    const y = HEIGHT + 0.35;
    const near = [
      ...tower(steel, detail),
      box(1.2, 0.08, 1.2, colour("#7a5c40"), 0, HEIGHT - 0.6, 0),
      cylinder(1.6, 1.7, 1, 14, colour("#8d949b"), 3.2, 0.5, 1.8, true),
      cylinder(1.5, 1.5, 0.05, 14, colour("#4f7a8c"), 3.2, 0.92, 1.8),
      box(0.12, 0.12, 2.6, steel, 1.6, 0.9, 1),
      box(0.4, 0.45, 1.2, grey, 0, y, 0),
      rod([0, y, -0.4], [0, y + 0.1, -3.6], 0.05, steel, 4, true),
      box(0.04, 1.4, 2, vane, 0, y + 0.4, -3.8),
      box(0.05, 0.3, 1.6, colour("#b8332a"), 0, y + 0.85, -3.8),
    ];
    const far = [cylinder(0.5, 3.4, HEIGHT, 4, steel, 0, HEIGHT / 2, 0, true), box(0.4, 0.45, 1.2, grey, 0, y, 0), box(0.04, 1.4, 2, vane, 0, y + 0.4, -3.8)];
    const wheel = [cylinder(0.22, 0.22, 0.4, 8, grey).rotateX(Math.PI / 2)];
    for (let k = 0; k < BLADES; k += 1) wheel.push(paint(new THREE.BoxGeometry(0.42, 1.55, 0.025), vane).rotateY(0.55).translate(0, 1.95, 0).rotateZ((k / BLADES) * Math.PI * 2));
    for (let k = 0; k < (detail ? 6 : 3); k += 1) {
      const a = (k / (detail ? 6 : 3)) * Math.PI * 2;
      wheel.push(rod([0, 0, 0], [Math.cos(a) * 2.7, Math.sin(a) * 2.7, 0], 0.03, steel, 3, true));
    }
    const mover = { name: "wheel", geometries: wheel.map((part) => part.translate(0, y, WHEEL_Z)), x: 0, y, z: WHEEL_Z, axis: [0, 0, 1] };
    return { near, far, glows: [], movers: [mover], width: 8, depth: 8, eaves: HEIGHT, door: { x: 3.2, y: 0.6, z: 3 } };
  },
);
