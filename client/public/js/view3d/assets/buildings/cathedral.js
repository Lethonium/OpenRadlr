/**
 * The market city's cathedral, about twice a village church's height: a long
 * nave under a steep slate roof, a transept with a small spire over the
 * crossing, an eight-sided apse at the back and two west towers with spires
 * around a portal and a rose window. Rebuilt on the geometry kit from #127's
 * triangle version. The west front, with the portal, faces +z; the apse is
 * at -z. Winter whitens the roofs.
 */
import * as THREE from "../../../three.js";
import { box, colour, paint } from "../geom.js";
import { defineBuilding } from "./building.js";
import { gable } from "./shapes.js";

const STONE = "#c7c2b8";
const SLATE = "#5c6373";
const GLASS = "#526588";
const OAK = "#5a331f";
const SNOW = "#f1f5f9";

const NAVE = 5;
const WALL_TOP = 11;
const RIDGE = 17;
const TOWERS = [1.5, 6.5];
const APSE_Z = 12;
const APSE_R = 5;

/** A pointed window as a flat pentagon on a wall: sill `y0`, tip `y1`, half-width `half`. */
function pointed(centre, yaw, y0, y1, half, color) {
  const shoulder = y1 - half * 1.3;
  const points = [[-half, y0], [half, y0], [half, shoulder], [0, y1], [-half, shoulder]];
  const geometry = paint(new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))), color);
  return geometry.rotateY(yaw).translate(centre[0] + Math.sin(yaw) * 0.06, 0, centre[1] + Math.cos(yaw) * 0.06);
}

/** A gabled roof over x0..x1, z0..z1 from `base` to ridge height `top`; ridge along z, or along x for "x". */
function roofOver(x0, x1, z0, z1, base, top, ridge, color) {
  const [width, length] = [x1 - x0, z1 - z0];
  const roof = ridge === "z" ? gable(length + 0.7, width + 0.7, top - base, color).rotateY(Math.PI / 2) : gable(width + 0.7, length + 0.7, top - base, color);
  return roof.translate((x0 + x1) / 2, base - 0.3, (z0 + z1) / 2);
}

/** A four-sided spire over a square, tip at `apex`. */
function spire(x0, x1, z0, z1, y0, apex, color) {
  const radius = Math.hypot(x1 - x0, z1 - z0) / 2;
  return paint(new THREE.ConeGeometry(radius, apex - y0, 4, 1, true), color)
    .rotateY(Math.PI / 4)
    .translate((x0 + x1) / 2, (y0 + apex) / 2, (z0 + z1) / 2);
}

export const cathedral = defineBuilding(
  { id: "cathedral", name: "Cathedral", description: "A twin-towered cathedral with a nave, transept, apse, rose window and slate roofs." }, // i18n-ok
  ({ season, detail }) => {
    const snowy = season === "winter";
    const wall = colour(STONE);
    const dark = wall.clone().multiplyScalar(0.88);
    const light = wall.clone().multiplyScalar(1.06);
    const roof = colour(snowy ? SNOW : SLATE);
    const edge = roof.clone().multiplyScalar(0.82);
    const glass = colour(GLASS);
    const white = colour("#ffffff");
    const near = [];
    const glows = [];
    const windowAt = (x, z, yaw, y0, y1, half) => {
      near.push(pointed([x, z], yaw, y0, y1, half, glass));
      glows.push(pointed([x, z], yaw, y0, y1, half, white).translate(Math.sin(yaw) * 0.04, 0, Math.cos(yaw) * 0.04));
    };
    // Nave z -11..12 and transept z 2..10 under the same ridge height.
    near.push(box(NAVE * 2, WALL_TOP, 23, wall, 0, WALL_TOP / 2, 0.5), roofOver(-NAVE, NAVE, -11, 12, WALL_TOP, RIDGE, "z", roof));
    near.push(box(18, WALL_TOP, 8, wall, 0, WALL_TOP / 2, 6), roofOver(-9, 9, 2, 10, WALL_TOP, RIDGE, "x", edge));
    if (detail) {
      for (const z of [-9.5, -5.5, -1.5]) for (const side of [-1, 1]) near.push(box(0.7, 9, 0.6, dark, side * (NAVE + 0.35), 4.5, z));
    }
    for (const z of [-7.5, -3.5, 0.5]) for (const side of [-1, 1]) windowAt(side * NAVE, z, (side * Math.PI) / 2, 3.2, 9.4, 0.8);
    for (const side of [-1, 1]) windowAt(side * 9, 6, (side * Math.PI) / 2, 3.5, 12.5, 1.1);
    // The apse: half an octagon of wall under a half cone.
    const apseWall = paint(new THREE.CylinderGeometry(APSE_R, APSE_R, WALL_TOP, 4, 1, true, -Math.PI / 2, Math.PI), wall);
    near.push(apseWall.translate(0, WALL_TOP / 2, APSE_Z));
    near.push(paint(new THREE.ConeGeometry(APSE_R * 1.08, RIDGE + 0.5 - WALL_TOP + 0.3, 4, 1, true, -Math.PI / 2, Math.PI), roof).translate(0, (WALL_TOP - 0.3 + RIDGE + 0.5) / 2, APSE_Z));
    for (let i = 0; i < 4; i += 1) {
      const middle = ((i + 0.5) * Math.PI) / 4;
      windowAt(Math.cos(middle) * APSE_R, Math.sin(middle) * APSE_R + APSE_Z, Math.PI / 2 - middle, 3.5, 8.8, 0.7);
    }
    // A lantern and a small spire over the crossing.
    near.push(box(3.2, 4.5, 3.2, light, 0, RIDGE + 1.75, 6), spire(-1.9, 1.9, 4.1, 7.9, RIDGE + 4, RIDGE + 11, edge));
    // The west front: a narthex between the towers, the portal and a rose window.
    near.push(box(TOWERS[0] * 2, 9, 5, wall, 0, 4.5, -13.5), roofOver(-TOWERS[0], TOWERS[0], -16, -11, 9, 13.5, "z", roof));
    const portal = paint(new THREE.ShapeGeometry(new THREE.Shape([[-1, 0], [1, 0], [1, 4.2], [0, 5.6], [-1, 4.2]].map(([x, y]) => new THREE.Vector2(x, y)))), colour(OAK));
    near.push(portal.rotateY(Math.PI).translate(0, 0, -16.05));
    const rose = paint(new THREE.CircleGeometry(1.6, 8), glass);
    near.push(rose.rotateY(Math.PI).translate(0, 10.6, -16.06));
    glows.push(paint(new THREE.CircleGeometry(1.5, 8), white).rotateY(Math.PI).translate(0, 10.6, -16.1));
    // The towers: stone to 24 m, string courses, slits and belfry openings, a slate spire to 34 m.
    for (const side of [-1, 1]) {
      const [x0, x1] = [Math.min(side * TOWERS[0], side * TOWERS[1]), Math.max(side * TOWERS[0], side * TOWERS[1])];
      const middle = (x0 + x1) / 2;
      near.push(box(x1 - x0, 24, 5, wall, middle, 12, -13.5), spire(x0 - 0.35, x1 + 0.35, -16.35, -10.65, 24, 34, roof));
      if (detail) for (const y of [11.6, 22.6]) near.push(box(x1 - x0 + 0.3, 0.4, 5.3, light, middle, y + 0.2, -13.5));
      for (const [y0, y1, half] of [[5, 9.5, 0.45], [16.5, 21.5, 0.9]]) {
        windowAt(middle, -16, Math.PI, y0, y1, half);
        windowAt(side > 0 ? x1 : x0, -13.5, (side * Math.PI) / 2, y0, y1, half);
      }
    }
    const far = [box(NAVE * 2, WALL_TOP, 23, wall, 0, WALL_TOP / 2, 0.5), roofOver(-NAVE, NAVE, -11, 12, WALL_TOP, RIDGE, "z", roof), box(18, WALL_TOP, 8, wall, 0, WALL_TOP / 2, 6), roofOver(-9, 9, 2, 10, WALL_TOP, RIDGE, "x", edge)];
    for (const side of [-1, 1]) {
      const [x0, x1] = [Math.min(side * TOWERS[0], side * TOWERS[1]), Math.max(side * TOWERS[0], side * TOWERS[1])];
      far.push(box(x1 - x0, 24, 5, wall, (x0 + x1) / 2, 12, -13.5), spire(x0 - 0.35, x1 + 0.35, -16.35, -10.65, 24, 34, roof));
    }
    // The portal faces +z: turn the whole building about y.
    for (const geometry of [...near, ...far, ...glows]) geometry.rotateY(Math.PI);
    return { near, far, glows, width: 18, depth: 34, eaves: WALL_TOP, door: { x: 0, y: 2.8, z: 16.05 } };
  },
);
