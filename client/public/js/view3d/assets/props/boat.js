/**
 * A small sailboat for the quay: a coloured hull with a pointed bow, a deck,
 * a cabin, a mast and a triangular sail. Local zero is the waterline (the
 * keel is 0.35 m below it); the long side runs along x and the layer bobs
 * it. Restyled from the reference's `boat.js`.
 */
import * as THREE from "../../../three.js";
import { box, colour, cone, cylinder, paint } from "../geom.js";
import { defineBuilding } from "../buildings/building.js";

const HULLS = Object.freeze(["#d9473f", "#2f7fd6", "#f0c43a", "#f4f1ea", "#36a58f"]);

/** A flat triangle visible from both sides. */
function sail(points, color) {
  const geometry = new THREE.BufferGeometry();
  const [a, b, c] = points;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
  geometry.computeVertexNormals();
  return paint(geometry, color);
}

export const boat = defineBuilding(
  { id: "boat", name: "Sailboat", description: "A small sailboat with a coloured hull, a cabin and a white sail." }, // i18n-ok
  ({ detail, dice }) => {
    const hull = colour(dice.pick(HULLS));
    const deck = colour("#a8794d");
    const white = colour("#fffaf0");
    const near = [box(6, 1.1, 2.2, hull, 0, 0.2, 0), cone(1.1, 2, 4, hull).rotateZ(-Math.PI / 2).scale(1, 0.5, 1).translate(4, 0.2, 0), box(5.6, 0.1, 1.9, deck, 0, 0.8, 0), cylinder(0.08, 0.1, 6.5, 5, colour("#6b4a2f"), -0.3, 4, 0), sail([[-0.2, 1.4, 0], [-0.2, 7, 0], [-3.4, 1.4, 0]], white)];
    if (detail) near.push(box(1.6, 0.7, 1.3, white, 1.7, 1.2, 0), box(0.6, 0.2, 0.06, colour("#2a3a48"), 1.7, 1.3, 0.68));
    const far = [box(6, 1.1, 2.2, hull, 0, 0.2, 0), sail([[-0.2, 1.4, 0], [-0.2, 7, 0], [-3.4, 1.4, 0]], white)];
    return { near, far, glows: [], width: 8, depth: 2.2, eaves: 1, door: { x: 0, y: 1, z: 1 } };
  },
);
