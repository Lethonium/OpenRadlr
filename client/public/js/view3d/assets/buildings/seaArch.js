/**
 * The sea arch (after Es Pontas): one heavy limestone body swept over a boat
 * sized hole, its legs flaring into the sea, pale above and ochre at the
 * water line, with a few broken boulders beside it. Local zero is the water
 * line; the legs run 8 m below it (the layer sets the foot on the seabed).
 * Taken from #127's `sweepRock` and `archRings`, rebuilt on the kit's
 * vertex-coloured geometry.
 */
import * as THREE from "../../../three.js";
import { colour, ico, lumpy } from "../geom.js";
import { defineBuilding } from "./building.js";
import { place } from "./shapes.js";

const REACH = 18; // middle to a leg's centre line
const RISE = 23; // the centre line's height over the water at the crown
const FOOT = 8; // half a leg's thickness at the water
const CROWN = 7; // half the deck's thickness
const DEPTH = 10;
const SEABED = -8;

/** Rings along the arch: down each leg from the seabed, over the top on a half ellipse. */
function archRings(steps) {
  const leg = (side) => {
    const n = [side, 0];
    return [{ c: [side * REACH, SEABED], n, t: FOOT * 1.35, d: DEPTH * 1.25 }, { c: [side * REACH, SEABED / 2], n, t: FOOT * 1.15, d: DEPTH * 1.1 }];
  };
  const rings = leg(-1);
  for (let i = 0; i <= steps; i += 1) {
    const theta = Math.PI * (1 - i / steps);
    const along = Math.sin(theta);
    const normal = [Math.cos(theta) / REACH, Math.sin(theta) / RISE];
    const length = Math.hypot(...normal);
    rings.push({ c: [REACH * Math.cos(theta), RISE * along], n: [normal[0] / length, normal[1] / length], t: FOOT + (CROWN - FOOT) * along, d: DEPTH * (1 - 0.15 * along) });
  }
  return [...rings, ...leg(1).reverse()];
}

/** Triangles of a rock swept along rings with one rough section of `sides` points; faces point outward. */
function sweep(rings, { sides, random, rough, tone }) {
  const shape = Array.from({ length: sides }, () => 0.82 + random() * 0.36);
  const sections = rings.map(({ c, n, t, d }) => shape.map((r, k) => {
    const a = (k / sides) * Math.PI * 2;
    const s = r * (1 + (random() - 0.5) * 2 * rough);
    return [c[0] + n[0] * Math.cos(a) * t * s, c[1] + n[1] * Math.cos(a) * t * s, Math.sin(a) * d * s];
  }));
  const positions = [];
  const colors = [];
  const face = (a, b, c, out, color) => {
    const cross = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const flip = cross[0] * out[0] + cross[1] * out[1] + cross[2] * out[2] < 0;
    for (const p of flip ? [a, c, b] : [a, b, c]) {
      positions.push(...p);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let i = 0; i + 1 < sections.length; i += 1) {
    const centre = [(rings[i].c[0] + rings[i + 1].c[0]) / 2, (rings[i].c[1] + rings[i + 1].c[1]) / 2, 0];
    for (let k = 0; k < sides; k += 1) {
      const [a, b, c, d] = [sections[i][k], sections[i][(k + 1) % sides], sections[i + 1][(k + 1) % sides], sections[i + 1][k]];
      const mid = [0, 1, 2].map((j) => (a[j] + b[j] + c[j] + d[j]) / 4 - centre[j]);
      const color = tone((a[1] + c[1]) / 2);
      face(a, b, c, mid, color);
      face(a, c, d, mid, color);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export const seaArch = defineBuilding(
  { id: "seaArch", name: "Sea arch", description: "A limestone arch standing in the sea, open enough for a boat to pass." }, // i18n-ok
  ({ detail, random, dice }) => {
    const limestone = ["#f2e6cc", "#e6d9bc", "#f7eed6", "#e0d1b3"].map(colour);
    const ochre = colour("#cc9e61");
    const wet = colour("#80836a");
    const tone = (y) => (y < -3 ? wet : y < 1.5 ? ochre : dice.pick(limestone));
    const near = [sweep(archRings(detail ? 14 : 10), { sides: detail ? 8 : 6, random, rough: 0.08, tone })];
    for (const [x, z, size] of [[-REACH - FOOT - 14, -9, 6], [REACH + FOOT + 17, 11, 8], [REACH + FOOT + 9, -14, 3.5]]) {
      const rock = lumpy(ico(1, detail ? 1 : 0, dice.pick(limestone)), 0.12).scale(size, size * 0.9, size * 0.8);
      near.push(...place([rock, ico(1, 0, ochre).scale(size * 1.15, 1.6, size * 0.95)], x, size * 0.25, z, dice.range(0, Math.PI)));
    }
    const far = [sweep(archRings(4).filter((_, i, all) => i !== 1 && i !== all.length - 2), { sides: 4, random, rough: 0, tone: () => limestone[0] })];
    return { near, far, glows: [], width: 2 * (REACH + FOOT) + 40, depth: 2 * DEPTH, eaves: RISE + CROWN, door: { x: 0, y: 2, z: 6 } };
  },
);
