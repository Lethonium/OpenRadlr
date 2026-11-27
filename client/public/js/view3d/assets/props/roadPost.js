/**
 * The roadside posts: a white reflector post with a dark band (red at every kilometre) and an orange reflector on its
 * road side, with a cap of snow in winter, or the biome's own marker, winter's snowmen (a yellow scarf at every
 * kilometre). Vertex-coloured, standing on y = 0; the post's reflector and the snowman's face lie towards +x and -z.
 * The road layer instances them where the world placed them.
 */
import * as THREE from "../../../three.js";
import { createOwner } from "../owner.js";
import { paint, box, cone, merge, orientedBox } from "../geom.js";

/** The kinds the world places: a plain post and a snowman, each ordinary or at a kilometre. */
export const POST_KINDS = Object.freeze(["post", "kmPost", "marker", "kmMarker"]);

const REFLECTOR = Object.freeze([1, 0.55, 0.1]);
const SNOWMAN = Object.freeze({ body: [0.97, 0.98, 1.0], coal: [0.14, 0.15, 0.17], carrot: [0.95, 0.5, 0.12], red: [0.78, 0.2, 0.18], yellow: [0.95, 0.78, 0.24] });

const linear = ([r, g, b]) => new THREE.Color().setRGB(r, g, b);

/** A low-poly ball of `radius` centred at `y`. */
const ball = (radius, y, color) => paint(new THREE.SphereGeometry(radius, 6, 3), color).translate(0, y, 0);

/** A box from `start` to `end` that is `width` wide along x and `thickness` the other way across (a twig, a nose). */
function limb(start, end, width, thickness, color) {
  const axis = new THREE.Vector3(...end).sub(new THREE.Vector3(...start));
  const across = new THREE.Vector3(1, 0, 0).cross(axis).normalize().multiplyScalar(thickness);
  const middle = [0, 1, 2].map((k) => (start[k] + end[k]) / 2);
  return orientedBox(middle, [width, 0, 0], axis.toArray(), across.toArray(), color);
}

/** A snowman: three snowballs, coal eyes, a carrot nose, twig arms, a scarf and a red hat. */
function snowman(km) {
  const c = Object.fromEntries(Object.entries(SNOWMAN).map(([name, value]) => [name, linear(value)]));
  const scarf = km ? c.yellow : c.red;
  return [
    ball(0.34, 0.34, c.body),
    ball(0.26, 0.82, c.body),
    ball(0.18, 1.18, c.body),
    ...[-0.06, 0.06].map((x) => box(0.035, 0.035, 0.035, c.coal, x, 1.22, -0.15)),
    limb([0, 1.15, -0.14], [0, 1.15, -0.36], 0.06, 0.06, c.carrot),
    ...[-1, 1].map((side) => limb([side * 0.2, 0.9, 0], [side * 0.48, 1.07, 0], 0.04, 0.04, c.coal)),
    box(0.36, 0.1, 0.36, scarf, 0, 1.02, 0),
    box(0.09, 0.22, 0.06, scarf, 0.14, 0.93, -0.15),
    cone(0.22, 0.34, 6, c.red, 0, 1.33 + 0.17, 0),
  ];
}

/** A plain post: the white post, its band, the reflector towards +x and, with `capped`, the biome's cap. */
function plainPost(km, road, capped) {
  const parts = [
    box(0.12, 1.0, 0.12, linear(road.postWhite), 0, 0.5, 0),
    box(0.13, 0.12, 0.13, linear(km ? road.postRed : road.postDark), 0, 1.05, 0),
    box(0.04, 0.14, 0.07, linear(REFLECTOR), 0.065, 0.86, 0),
  ];
  if (capped && road.postCap) parts.push(box(0.16, 0.06, 0.16, linear(road.postCap.color), 0, 1.14, 0));
  return parts;
}

/**
 * @param {"post" | "kmPost" | "marker" | "kmMarker"} kind
 * @param {{postWhite: number[], postRed: number[], postDark: number[], postCap?: {color: number[]} | null}} road the biome's post colours
 * @param {{capped?: boolean}} [options] `capped`: a plain post wears the biome's cap
 */
export function roadPostGeometry(kind, road, { capped = false } = {}) {
  const km = kind.startsWith("km");
  return merge(kind.endsWith("arker") ? snowman(km) : plainPost(km, road, capped));
}

export const meta = Object.freeze({
  id: "road-post",
  name: "Road post", // i18n-ok
  category: "props", // i18n-ok
  description: "The roadside posts, every 50 m: a reflector post (red band at each kilometre, a snow cap in winter) and winter's snowmen.", // i18n-ok
  options: Object.freeze({}),
});

/** @param {{season?: string, track?: (resource: any) => any}} [options] */
export function create({ season = "summer", track } = {}) {
  const owner = createOwner(track);
  const road = season === "winter" ? { postWhite: [0.95, 0.96, 0.98], postRed: [0.8, 0.18, 0.16], postDark: [0.2, 0.22, 0.26], postCap: { color: [0.94, 0.96, 0.99] } } : { postWhite: [0.94, 0.94, 0.92], postRed: [0.82, 0.18, 0.16], postDark: [0.2, 0.2, 0.2], postCap: null };
  const material = owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
  const object = new THREE.Group();
  const kinds = season === "winter" ? POST_KINDS : POST_KINDS.slice(0, 2);
  kinds.forEach((kind, i) => {
    const mesh = new THREE.Mesh(owner.own(roadPostGeometry(kind, road, { capped: true })), material);
    mesh.position.x = (i - (kinds.length - 1) / 2) * 1.2;
    mesh.castShadow = true;
    object.add(mesh);
  });
  return { object, update() {}, dispose: () => owner.disposeAll() };
}
