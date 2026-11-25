/**
 * What stands between the fields: a dry-stone wall for the south, a hedgerow
 * for the green land. Each is one unit long along x (centred on 0), so the
 * world scales a segment to the side it stands on. New in this renderer (no
 * reference file); low poly, vertex colours.
 */
import * as THREE from "../../../three.js";
import { defineAsset } from "./asset.js";
import { bodyMaterial } from "./foliage.js";
import { box, colour, groundAll, lumpy, merge, paint, shadeY } from "../geom.js";

/** Stones of the wall: three courses of boxes, (x from, x to, height) per stone, slightly uneven. */
const COURSES = Object.freeze([
  { y: 0, h: 0.3, w: 0.52, cuts: [0, 0.34, 0.68, 1] },
  { y: 0.3, h: 0.26, w: 0.46, cuts: [0, 0.2, 0.54, 0.84, 1] },
  { y: 0.56, h: 0.24, w: 0.4, cuts: [0, 0.4, 0.74, 1] },
]);
const STONES = Object.freeze(["#a89f8c", "#b8b09e", "#968e7c", "#aea592"].map((c) => colour(c)));
const WALL_CAP = colour("#c2baa8");

const HEDGE = Object.freeze({ spring: "#5c8f3a", summer: "#3a6a2c", autumn: "#8b5a2b", winter: "#4a3828" });

/** A stone `x0` to `x1` wide (unit-length coordinates) with its own tilt of shade. */
function stone(course, n, x0, x1) {
  const color = STONES[(n * 3 + Math.round(course.y * 10)) % STONES.length];
  const gap = 0.012;
  return box(x1 - x0 - gap, course.h - gap, course.w, color, (x0 + x1) / 2 - 0.5, course.y + course.h / 2, 0);
}

export const fieldWall = defineAsset({ id: "fieldWall", name: "Field wall", description: "Dry-stone wall segment, 1 m long and 0.8 m high." }, ({ uniforms, own }) => { // i18n-ok
  const near = [];
  COURSES.forEach((course, c) => {
    for (let i = 0; i + 1 < course.cuts.length; i += 1) near.push(stone(course, c * 5 + i, course.cuts[i], course.cuts[i + 1]));
  });
  near.push(box(1, 0.05, 0.3, WALL_CAP, 0, 0.8, 0));
  const far = [box(1, 0.8, 0.5, STONES[0], 0, 0.4, 0)];
  const material = own(bodyMaterial(uniforms, 0));
  return { near: [{ geometry: own(shadeY(merge(near), 0.8, 1, 0, 0.85)), material }], far: [{ geometry: own(merge(far)), material }] };
});

export const hedge = defineAsset({ id: "hedge", name: "Hedge", description: "Hedgerow segment, 1 m long and 1.4 m high: leafy, browner in autumn, bare twigs in winter." }, ({ season, uniforms, own }) => { // i18n-ok
  const color = colour(HEDGE[season] ?? HEDGE.summer);
  const body = new THREE.BoxGeometry(1, 1.4, 1, 4, 5, 3);
  const near = lumpy(paint(body, color), 0.1);
  groundAll([near]);
  if (season === "winter") near.scale(1, 0.85, 0.7); // thin twigs: lower and narrower
  groundAll([near]);
  const far = box(1, 1.4, 1, color, 0, 0.7, 0);
  const material = own(bodyMaterial(uniforms, 0.01));
  return { near: [{ geometry: own(shadeY(near, 0.55, 1, 0, 1.4)), material }], far: [{ geometry: own(far), material }] };
});
