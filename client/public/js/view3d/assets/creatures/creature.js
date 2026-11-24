/**
 * What every animal shares: the `parts` / `create` contract. A builder lists the
 * body's geometries and the limbs that move; `parts` grounds (or centres) them,
 * merges each into one vertex-coloured geometry and owns it. All geometry is in
 * creature space: x to the side, y up, z forward (the animal faces +z), the
 * feet on y = 0 for walkers, the box centre on the origin for flyers and swimmers.
 *
 * A limb keeps its geometry in creature space too; `pivot` is the joint it turns
 * about (turn it as `translate(-pivot) -> rotate -> translate(pivot)`):
 *  - "leg", "head", "tail": about x (a positive angle puts the far end down, so the head grazes, a leg
 *    swings its foot back), a leg's `phase` (0 or 1) says which half of the stride it moves in.
 *  - "wing": about z, positive raises the tip; multiply by the sign of `pivot[0]` so both wings rise together.
 */
import * as THREE from "../../../three.js";
import { colour, merge, paint } from "../geom.js";
import { createOwner } from "../owner.js";
import { seededRandom } from "../../../world/noise.js";
import { dice } from "../buildings/shapes.js";

export const SEASONS = Object.freeze(["spring", "summer", "autumn", "winter"]);

/** Radians of the walk cycle per metre per second of `speed`. */
const STRIDE = 4;
/** How fast wings beat (radians per second), and how far they swing. */
const FLAP = 14;

/**
 * @typedef {object} CreatureOptions
 * @property {"spring"|"summer"|"autumn"|"winter"} [season] winter turns the fox and rabbit pale
 * @property {boolean} [detail] false drops ears, horns, patches and hooves
 * @property {number} [seed] picks coats and markings
 * @property {<T>(resource: T) => T} [own] registers every resource made
 */

/**
 * @typedef {object} CreatureLimb
 * @property {import("../../../three.js").BufferGeometry} geometry
 * @property {[number, number, number]} pivot the joint, in creature space
 * @property {"leg"|"wing"|"head"|"tail"} swing
 * @property {number} phase 0 or 1: the half of the stride a leg moves in
 */

/**
 * @typedef {object} CreatureParts
 * @property {import("../../../three.js").BufferGeometry} body
 * @property {CreatureLimb[]} limbs
 * @property {number} speed metres per second at a walk (flight or swim speed for the others)
 * @property {number} size nose to tail in metres
 */

/** A limb as a builder lists it: geometries that move together about `pivot`. */
export const limb = (geometries, pivot, swing, phase = 0) => ({ geometries, pivot, swing, phase });

/** The diagonal gait: legs at the same corner-pair move together. */
export const legAt = (geometries, pivot) => limb(geometries, pivot, "leg", pivot[0] > 0 === pivot[2] > 0 ? 0 : 1);

/** An ellipsoid: a low icosphere stretched to `sx`, `sy`, `sz` half-sizes. */
export function blob(detail, color, sx, sy, sz, x = 0, y = 0, z = 0) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.scale(sx, sy, sz);
  return paint(geometry, colour(color)).translate(x, y, z);
}

/**
 * Flat triangles seen from both sides, each corner `[x, y, z, color]`: wings and tail fans.
 * @param {[number, number, number, string][][]} triangles
 */
export function sheet(triangles) {
  const positions = [];
  const colors = [];
  for (const corners of triangles) {
    for (const order of [[0, 1, 2], [0, 2, 1]]) {
      for (const index of order) {
        const [x, y, z, color] = corners[index];
        const c = colour(color);
        positions.push(x, y, z);
        colors.push(c.r, c.g, c.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Moves the geometries and pivots together: feet to y = 0, or the whole box to the origin. */
function settle(body, limbs, centred) {
  const all = [...body, ...limbs.flatMap((one) => one.geometries)];
  const box = new THREE.Box3();
  for (const geometry of all) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  const shift = centred ? box.getCenter(new THREE.Vector3()).negate() : new THREE.Vector3(0, -box.min.y, 0);
  for (const geometry of all) geometry.translate(shift.x, shift.y, shift.z);
  for (const one of limbs) one.pivot = [one.pivot[0] + shift.x, one.pivot[1] + shift.y, one.pivot[2] + shift.z];
}

/**
 * Builds an animal from its description and builder.
 * @param {{id: string, name: string, description: string, speed: number, size: number, centred?: boolean}} info
 * @param {(options: Required<Pick<CreatureOptions, "season" | "detail" | "seed">> & {random: () => number, dice: ReturnType<typeof dice>}) => {body: import("../../../three.js").BufferGeometry[], limbs: ReturnType<typeof limb>[]}} build
 */
export function defineCreature({ id, name, description, speed, size, centred = false }, build) {
  const meta = Object.freeze({
    id,
    name,
    category: "Creatures", // i18n-ok
    description,
    options: Object.freeze({ season: Object.freeze({ type: "select", values: SEASONS, default: "summer" }) }),
  });
  /** @type {(options?: CreatureOptions) => CreatureParts} */
  const parts = ({ season = "summer", detail = true, seed = 1, own = (resource) => resource } = {}) => {
    const random = seededRandom(seed);
    const made = build({ season, detail, seed, random, dice: dice(random) });
    settle(made.body, made.limbs, centred);
    return {
      body: own(merge(made.body)),
      limbs: made.limbs.map((one) => ({ geometry: own(merge(one.geometries)), pivot: one.pivot, swing: one.swing, phase: one.phase })),
      speed,
      size,
    };
  };
  const create = ({ track, ...options } = {}) => {
    const owner = createOwner(track);
    const built = parts({ ...options, own: owner.own });
    const material = owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    const object = new THREE.Group();
    const mesh = (geometry) => Object.assign(new THREE.Mesh(geometry, material), { castShadow: true });
    object.add(mesh(built.body));
    const joints = built.limbs.map((one) => {
      const joint = new THREE.Group();
      joint.position.set(...one.pivot);
      const part = mesh(one.geometry);
      part.position.set(-one.pivot[0], -one.pivot[1], -one.pivot[2]);
      joint.add(part);
      object.add(joint);
      return { joint, ...one };
    });
    /** Walks (or flaps, or swims) in place. */
    const update = (dt, t) => {
      const phase = t * built.speed * STRIDE;
      for (const { joint, swing, pivot, phase: half } of joints) {
        if (swing === "leg") joint.rotation.x = Math.sin(phase + Math.PI * half) * 0.5;
        else if (swing === "head") joint.rotation.x = Math.max(0, Math.sin(t * 0.5)) * 0.9;
        else if (swing === "tail") joint.rotation.x = Math.sin(t * 3 + phase) * 0.25;
        else joint.rotation.z = Math.sin(t * FLAP) * 0.7 * Math.sign(pivot[0] || 1);
      }
    };
    return { object, update, dispose: () => owner.disposeAll() };
  };
  return Object.freeze({ meta, parts, create });
}
