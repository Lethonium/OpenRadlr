/**
 * The roadside crowd's figures as vertex-coloured parts, standing on y = 0 and facing -Z: a person (capsule torso, head,
 * hair, legs, arms up or down) and winter's penguin (flippers apart or clapping), and the flag a spectator waves. Each
 * figure comes as two geometries: the `body` in its own colours and the `shirt`, painted white, which the crowd layer
 * tints per person (a penguin's shirt is its scarf). No randomness: every spectator of a pose is the same shape.
 */
import * as THREE from "../../../three.js";
import { createOwner } from "../owner.js";
import { merge, paint } from "../geom.js";

const linear = ([r, g, b]) => new THREE.Color().setRGB(r, g, b);
const WHITE = [1, 1, 1];

const PERSON = Object.freeze({
  skin: [0.88, 0.7, 0.56],
  hair: [0.24, 0.16, 0.1],
  pants: [0.2, 0.25, 0.36],
  shoes: [0.14, 0.12, 0.11],
});

const PENGUIN = Object.freeze({
  coat: [0.1, 0.12, 0.16],
  coatLight: [0.18, 0.21, 0.27],
  belly: [0.96, 0.97, 1.0],
  beak: [0.96, 0.56, 0.12],
  eye: [0.03, 0.03, 0.04],
});

const FLAG = Object.freeze({ pole: [0.9, 0.86, 0.8] });

/** Where a spectator holds its flag, in the figure's own frame (the hand's point). */
export const FLAG_HAND = Object.freeze({ person: [0.36, 1.85, -0.05], penguin: [0.5, 0.8, -0.1] });

/** An ellipsoid of `radii` at `centre`. */
function ellipsoid(centre, radii, rgb, rings = 8, segments = 12) {
  const geometry = paint(new THREE.SphereGeometry(1, segments, rings), linear(rgb));
  geometry.scale(...radii);
  geometry.translate(...centre);
  geometry.computeVertexNormals();
  return geometry;
}

/** A box of `size` at `centre`. */
function block(centre, size, rgb) {
  return paint(new THREE.BoxGeometry(...size), linear(rgb)).translate(...centre);
}

/** A rod from one point to another, `r0` thick at `from` and `r1` at `to`. */
function limb(from, to, r0, r1, rgb, segments = 7) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const geometry = paint(new THREE.CylinderGeometry(r1, r0, 1, segments, 1), linear(rgb));
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return geometry.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), turn, new THREE.Vector3(1, a.distanceTo(b), 1)));
}

/** A capsule standing on `centre`, squashed front to back by `flat`. */
function capsule(centre, radius, length, flat, rgb) {
  const geometry = paint(new THREE.CapsuleGeometry(radius, length, 3, 10), linear(rgb));
  geometry.scale(1, 1, flat);
  return geometry.translate(...centre);
}

function person(pose) {
  const body = [];
  const shirt = [];
  for (const side of [-1, 1]) {
    body.push(limb([side * 0.1, 0.9, 0], [side * 0.1, 0.07, 0], 0.085, 0.065, PERSON.pants));
    body.push(block([side * 0.1, 0.04, -0.04], [0.12, 0.08, 0.26], PERSON.shoes));
    const shoulder = [side * 0.24, 1.46, 0];
    const hand = pose ? [side * 0.4, 1.95, -0.05] : [side * 0.28, 0.92, -0.05];
    shirt.push(limb(shoulder, hand, 0.065, 0.055, WHITE));
    body.push(ellipsoid(hand, [0.055, 0.055, 0.055], PERSON.skin, 5, 7));
  }
  body.push(capsule([0, 0.92, 0], 0.17, 0.1, 0.78, PERSON.pants));
  shirt.push(capsule([0, 1.2, 0], 0.19, 0.42, 0.75, WHITE));
  body.push(limb([0, 1.52, 0], [0, 1.62, 0], 0.06, 0.06, PERSON.skin, 8));
  body.push(ellipsoid([0, 1.72, 0], [0.128, 0.146, 0.128], PERSON.skin));
  // Hair: the back and top of the head, so the face stays bare.
  body.push(ellipsoid([0, 1.75, 0.025], [0.138, 0.14, 0.125], PERSON.hair));
  body.push(ellipsoid([0, 1.7, -0.125], [0.025, 0.025, 0.025], PERSON.skin, 4, 6));
  return { body: merge(body), shirt: merge(shirt) };
}

function penguin(clapping) {
  const body = [];
  const shirt = [];
  // Webbed feet and a short tail behind the body.
  for (const side of [-1, 1]) body.push(block([side * 0.16, 0.045, -0.08], [0.22, 0.09, 0.34], PENGUIN.beak));
  body.push(block([0, 0.18, 0.33], [0.28, 0.12, 0.24], PENGUIN.coatLight));
  // Black back and the white belly standing proud of it.
  body.push(ellipsoid([0, 0.66, 0.02], [0.38, 0.62, 0.31], PENGUIN.coat));
  body.push(ellipsoid([0, 0.62, -0.18], [0.28, 0.45, 0.16], PENGUIN.belly));
  // Head with a white face patch, eyes and an orange beak.
  body.push(ellipsoid([0, 1.26, -0.02], [0.27, 0.26, 0.26], PENGUIN.coat));
  body.push(ellipsoid([0, 1.24, -0.2], [0.19, 0.18, 0.09], PENGUIN.belly));
  for (const side of [-1, 1]) body.push(block([side * 0.085, 1.28, -0.285], [0.06, 0.07, 0.04], PENGUIN.eye));
  body.push(limb([0, 1.19, -0.24], [0, 1.14, -0.45], 0.07, 0.05, PENGUIN.beak));
  // A knitted scarf around the neck and its loose end on the white chest.
  shirt.push(block([0, 1.05, 0], [0.52, 0.11, 0.42], WHITE));
  shirt.push(block([0.18, 0.92, -0.31], [0.1, 0.26, 0.06], WHITE));
  // Flippers: spread out for the open beat, meeting in front for the clap.
  for (const side of [-1, 1]) {
    const tip = clapping ? [side * 0.06, 0.72, -0.32] : [side * 0.46, 0.78, -0.12];
    body.push(limb([side * 0.3, 0.96, -0.02], tip, 0.06, 0.08, PENGUIN.coatLight));
  }
  return { body: merge(body), shirt: merge(shirt) };
}

/**
 * One figure in one pose.
 * @param {{figure: "person"|"penguin", pose: boolean}} options `pose`: a person's arms up, a penguin's flippers clapping
 * @returns {{body: import("../../../three.js").BufferGeometry, shirt: import("../../../three.js").BufferGeometry}}
 */
export function spectatorGeometry({ figure = "person", pose = false } = {}) {
  return figure === "penguin" ? penguin(pose) : person(pose);
}

/** The flag a spectator waves: a pole leaning back from the origin (the hand) and a white cloth off its top. */
export function flagGeometry() {
  return merge([limb([0, -0.25, 0], [0, 1.55, 0.12], 0.035, 0.035, FLAG.pole, 5), block([0.36, 1.27, 0.1], [0.68, 0.46, 0.03], WHITE)]);
}

export const meta = Object.freeze({
  id: "spectator",
  name: "Spectator", // i18n-ok
  category: "people", // i18n-ok
  description: "A roadside spectator with arms up and a flag; in winter a clapping penguin.", // i18n-ok
  options: Object.freeze({ figure: Object.freeze({ type: "select", values: Object.freeze(["person", "penguin"]), default: "person" }) }),
});

/** @param {{figure?: "person"|"penguin", track?: (resource: any) => any}} [options] */
export function create({ figure = "person", track } = {}) {
  const owner = createOwner(track);
  const object = new THREE.Group();
  const solid = owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  const tinted = owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, color: linear([0.85, 0.2, 0.2]) }));
  const flagMaterial = owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, color: linear([0.16, 0.38, 0.86]) }));
  const { body, shirt } = spectatorGeometry({ figure, pose: true });
  const hand = FLAG_HAND[figure];
  const flag = new THREE.Mesh(owner.own(flagGeometry()), flagMaterial);
  flag.position.set(...hand);
  object.add(new THREE.Mesh(owner.own(body), solid), new THREE.Mesh(owner.own(shirt), tinted), flag);
  for (const mesh of object.children) mesh.castShadow = true;
  return { object, update() {}, dispose: () => owner.disposeAll() };
}

export const spectator = Object.freeze({ meta, create });
