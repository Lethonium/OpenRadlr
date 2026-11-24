/**
 * The farmstead's outbuildings, each a list of geometry in its own frame
 * (front toward +z, ground y = 0): a gambrel barn with sliding doors and a
 * hayloft, grain silos, an open machine shed, a tractor and round bales.
 * Restyled from the reference farmstead.
 */
import * as THREE from "../../../three.js";
import { box, colour, cylinder, paint, rod } from "../geom.js";
import { gable, quad } from "./shapes.js";

const SNOW = "#f6f9fc";
const dim = (hex, factor) => colour(hex).multiplyScalar(factor);

/** A flat polygon facing +z at height 0 (points are x, y). */
const polygon = (points, color) => paint(new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))), color);

/**
 * The barn: stone footing, board walls, a gambrel roof, sliding doors, a
 * hayloft door, side windows and a cupola.
 * @returns {{near: import("../../../three.js").BufferGeometry[], far: import("../../../three.js").BufferGeometry[], glows: import("../../../three.js").BufferGeometry[]}}
 */
export function barn(palette, { snowy, detail, width = 14, depth = 24, wallHeight = 5.2 }) {
  const hw = width / 2;
  const wall = colour(palette.barn);
  const wallDark = dim(palette.barn, 0.72);
  const trim = colour(palette.trim);
  const roof = colour(palette.roof);
  const y0 = wallHeight + 0.25;
  const near = [box(width + 0.4, 0.9, depth + 0.4, colour("#8f877c"), 0, -0.1, 0), box(width, wallHeight, depth, wall, 0, wallHeight / 2 + 0.25, 0)];
  const glows = [];
  const profile = [[-hw - 0.55, y0 - 0.4], [-hw * 0.62, y0 + 3.4], [0, y0 + 5], [hw * 0.62, y0 + 3.4], [hw + 0.55, y0 - 0.4]];
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = profile[i];
    const [bx, by] = profile[i + 1];
    const slope = Math.atan2(by - ay, bx - ax);
    const length = Math.hypot(bx - ax, by - ay);
    near.push(box(length + 0.3, 0.26, depth + 1.3, roof).rotateZ(slope).translate((ax + bx) / 2, (ay + by) / 2 + 0.12, 0));
    if (snowy) near.push(box(length + 0.2, 0.22, depth + 1.2, colour(SNOW)).rotateZ(slope).translate((ax + bx) / 2 - Math.sin(slope) * 0.2, (ay + by) / 2 + 0.3, 0));
  }
  near.push(box(0.3, 0.3, depth + 1.4, dim(palette.roof, 0.7), 0, y0 + 5.15, 0));
  const end = [[-hw, y0], [-hw * 0.6, y0 + 3.3], [0, y0 + 4.85], [hw * 0.6, y0 + 3.3], [hw, y0]];
  near.push(polygon(end, wall).translate(0, 0, depth / 2), polygon(end, wall).rotateY(Math.PI).translate(0, 0, -depth / 2));
  // Front: two sliding doors with a bar each, the track beam and the hayloft door.
  const front = depth / 2 + 0.07;
  const leaf = width * 0.27;
  const doorHeight = 4;
  near.push(box(width * 0.62, 0.22, 0.2, colour("#3b3530"), 0, doorHeight + 0.55, front + 0.05));
  for (const side of [-1, 1]) {
    const cx = (side * leaf) / 2;
    near.push(box(leaf - 0.05, doorHeight, 0.1, wallDark, cx, doorHeight / 2 + 0.3, front));
    near.push(quad(leaf, 0.2, trim, cx, doorHeight / 2 + 0.3, front + 0.07), quad(leaf, 0.2, trim, cx, 0.45, front + 0.07), quad(leaf, 0.2, trim, cx, doorHeight + 0.2, front + 0.07));
    if (detail) near.push(rod([cx - leaf / 2 + 0.2, 0.5, front + 0.07], [cx + leaf / 2 - 0.2, doorHeight - 0.1, front + 0.07], 0.08, trim, 4), rod([cx - leaf / 2 + 0.2, doorHeight - 0.1, front + 0.07], [cx + leaf / 2 - 0.2, 0.5, front + 0.07], 0.08, trim, 4));
  }
  near.push(box(2.4, 2.1, 0.1, wallDark, 0, y0 + 1.55, front), quad(2.7, 0.2, trim, 0, y0 + 2.65, front + 0.06), quad(2.7, 0.2, trim, 0, y0 + 0.45, front + 0.06));
  if (detail) {
    for (let z = -depth / 2 + 3; z < depth / 2 - 2; z += 4.5) {
      for (const side of [-1, 1]) {
        near.push(quad(1.1, 1.1, trim, side * (hw + 0.04), 3, z, (side * Math.PI) / 2));
        glows.push(quad(0.75, 0.75, colour("#ffffff"), side * (hw + 0.08), 3, z, (side * Math.PI) / 2));
      }
    }
    near.push(box(1.6, 1.3, 1.6, trim, 0, y0 + 5.6, 0), gable(2.3, 2.3, 1, roof).translate(0, y0 + 6.25, 0), cylinder(0.03, 0.03, 1.4, 4, colour("#2a2c2e"), 0, y0 + 7.9, 0));
  }
  const far = [box(width, y0 + 1.5, depth, wall, 0, (y0 + 1.5) / 2, 0), gable(width + 1, depth + 1, 4, snowy ? colour(SNOW) : roof).translate(0, y0 + 1.5, 0)];
  return { near, far, glows };
}

/** One grain silo at (x, z): body, rings, a shallow dome and a ladder. */
export function silo(x, z, radius, height, palette, detail) {
  const body = colour(palette.silo);
  const ring = dim(palette.silo, 0.78);
  const sides = 10;
  const near = [cylinder(radius + 0.45, radius + 0.5, 0.5, sides, colour("#a8a39a"), x, 0.05, z)];
  near.push(cylinder(radius, radius, height, sides, body, x, height / 2 + 0.3, z));
  for (const y of detail ? [height * 0.3, height * 0.6] : []) near.push(cylinder(radius + 0.035, radius + 0.035, 0.09, sides, ring, x, y, z, true));
  near.push(paint(new THREE.SphereGeometry(radius * 1.03, sides, 3, 0, Math.PI * 2, 0, Math.PI / 2), body).scale(1, 0.5, 1).translate(x, height + 0.3, z));
  if (detail) near.push(quad(0.5, height, colour("#8d949b"), x, height / 2 + 0.3, z + radius + 0.12));
  return { near, far: [cylinder(radius, radius, height + 0.5, 5, body, x, (height + 0.5) / 2, z, true)] };
}

/** The open machine shed at (cx, cz): posts, back wall, sloping roof and an optional solar slab. */
export function shed(cx, cz, palette, { solar, snowy }) {
  const [width, depth, low, high] = [16, 9, 4.3, 5.7];
  const steel = colour("#7d858c");
  const clad = colour(snowy ? "#8e96a3" : "#7f8a7d");
  const slope = Math.atan2(high - low, depth);
  const run = Math.hypot(depth + 1, high - low);
  const near = [box(width, 0.12, depth, colour("#9a958c"), cx, 0.05, cz), box(width, high, 0.15, clad, cx, high / 2, cz - depth / 2)];
  for (let x = -width / 2; x <= width / 2 + 0.01; x += 4) near.push(box(0.22, low, 0.22, steel, cx + x, low / 2, cz + depth / 2 - 0.2));
  for (const side of [-1, 1]) near.push(polygon([[-depth / 2, 0], [depth / 2, 0], [depth / 2, side > 0 ? high : low], [-depth / 2, side > 0 ? low : high]], clad).rotateY(side * (Math.PI / 2)).translate(cx + (side * width) / 2, 0, cz));
  near.push(box(width + 0.6, 0.16, run, colour(snowy ? "#eef3f7" : "#6f767c")).rotateX(slope).translate(cx, (low + high) / 2 + 0.08, cz));
  if (solar && !snowy) near.push(box(width - 1, 0.06, run - 1, colour("#1d2a44")).rotateX(slope).translate(cx, (low + high) / 2 + 0.22, cz));
  return near;
}

/** A small tractor at (x, z), nose toward +x before `yaw`. */
export function tractor(x, z, yaw, paint0) {
  const body = colour(paint0);
  const tyre = colour("#26282b");
  const near = [box(2.6, 0.9, 1.3, body, 0.6, 1.1, 0), box(1.4, 1.5, 1.4, body, -0.7, 2.1, 0), box(1.6, 0.1, 1.5, dim(paint0, 0.7), -0.7, 2.9, 0)];
  const wheel = (r, width, px, py, pz) => paint(new THREE.CylinderGeometry(r, r, width, 8), tyre).rotateX(Math.PI / 2).translate(px, py, pz);
  for (const side of [-1, 1]) near.push(wheel(0.9, 0.5, -0.8, 0.9, side * 0.95), wheel(0.5, 0.35, 1.5, 0.5, side * 0.8));
  return near.map((g) => g.rotateY(yaw).translate(x, 0, z));
}

/** A stack of round bales at (x, z): `rows` high, wrapped in `wrap` ("hay" for loose hay). */
export function bales(x, z, wrap, rows = 3) {
  const out = [];
  const [radius, length] = [0.68, 1.2];
  const color = colour(wrap === "hay" ? "#d9b65a" : wrap);
  for (let row = 0; row < rows; row += 1) {
    for (let i = 0; i < rows - row + 1; i += 1) {
      out.push(cylinder(radius, radius, length, 8, color).rotateZ(Math.PI / 2).translate(x + (i - (rows - row) / 2) * (2 * radius + 0.02), radius + row * radius * 1.72, z));
    }
  }
  return out;
}
