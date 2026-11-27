/**
 * A tree with a crown of leaf cards: a trunk with branches, an inner hull that
 * keeps the crown from looking hollow, and cards scattered over spherical
 * clusters. Near: trunk + hull + cards. Far: trunk + a few hull blobs.
 * Broadleaf, poplar, birch, cypress, olive, umbrella pine and almond are
 * all described as a `CrownSpec` and built here.
 */
import * as THREE from "../../../three.js";
import { seededRandom } from "../../../world/noise.js";
import { defineAsset } from "./asset.js";
import { bodyMaterial, foliageDepth, foliageMaterial, leafCards } from "./foliage.js";
import { leafTexture } from "./foliageTextures.js";
import { colour, cylinder, ico, lumpy, merge, rod, shadeY, spread } from "../geom.js";

const SNOW = colour("#eef2f7");
const FAR_BLOBS = 4;

/**
 * @typedef {object} CrownSpec
 * @property {number} seed
 * @property {{x: number, y: number, z: number, r: number}[]} clusters
 * @property {number} trunkHeight
 * @property {[number, number]} trunkRadius top and bottom
 * @property {string} bark
 * @property {[[number, number, number], [number, number, number], number][]} [branches] rods from, to, radius
 * @property {boolean} [birch] white bark with dark marks
 * @property {[number, number]} card card size range in metres
 * @property {number} density cards per square metre of cluster radius
 * @property {number} up how much card normals lean skyward
 * @property {number} [squash] hull height factor (flat crowns)
 * @property {number} [slender] leaf width relative to its length
 * @property {number} [wind]
 * @property {Record<"spring"|"summer"|"autumn"|"winter", string[]|null>} palette leaf colours per season; null is bare
 * @property {boolean} [evergreen] winter leaves stay, tinted with snow
 * @property {string} description
 */

/** The trunk and its branches, birch bark marked. */
function trunkParts(spec, bark) {
  const { trunkHeight: h, trunkRadius: [top, bottom] } = spec;
  const parts = [cylinder(top, bottom, h, 8, bark, 0, h / 2, 0), ...(spec.branches ?? []).map(([from, to, radius]) => rod(from, to, radius, bark))];
  const trunk = merge(parts);
  if (spec.birch) {
    const c = trunk.attributes.color;
    const q = trunk.attributes.position;
    for (let i = 0; i < q.count; i += 1) {
      const m = Math.sin(q.getY(i) * 7.3 + Math.atan2(q.getZ(i), q.getX(i)) * 2) > 0.72 ? 0.25 : 1;
      c.setXYZ(i, c.getX(i) * m, c.getY(i) * m, c.getZ(i) * m);
    }
  }
  return trunk;
}

/** Bare winter crown: twigs from the top of the trunk to each cluster. */
const twigs = (spec, bark, clusters, open) => clusters.map((c) => rod([0, spec.trunkHeight * 0.8, 0], [c.x * 0.9, c.y * 0.92, c.z * 0.9], 0.05, bark, open ? 3 : 5, open));

/** Hull blobs, one per cluster, in the leaf colour. */
const hull = (spec, clusters, color, detail) =>
  clusters.map((c) => {
    const blob = lumpy(ico(c.r * 0.72, detail, color), 0.05);
    blob.scale(1, spec.squash ?? 1, 1);
    blob.translate(c.x, c.y, c.z);
    return blob;
  });

function build(spec, { season, detail, uniforms, own }) {
  const random = seededRandom(spec.seed);
  const hexes = spec.palette[season];
  const leafy = hexes !== null;
  const snow = season === "winter" && spec.evergreen;
  const palette = (hexes ?? []).map((hex) => (snow ? colour(hex).lerp(SNOW, 0.3) : colour(hex)));
  const bark = colour(spec.bark);
  const ys = spec.clusters.map((c) => c.y);
  const [low, high] = [Math.min(...ys) - 1.5, Math.max(...ys) + 1.5];
  const material = own(bodyMaterial(uniforms, spec.wind ?? 0.02));
  const shaded = (list) => shadeY(merge(list), 0.5, 0.85, low, high);
  const nearBody = leafy
    ? merge([trunkParts(spec, bark), shaded(hull(spec, spec.clusters, palette[0], 0))])
    : merge([trunkParts(spec, bark), ...twigs(spec, bark, spec.clusters, false)]);
  const blobs = spread(spec.clusters, FAR_BLOBS);
  const farTrunk = cylinder(spec.trunkRadius[0], spec.trunkRadius[1], spec.trunkHeight, 5, bark, 0, spec.trunkHeight / 2, 0, true);
  const farBody = leafy ? merge([farTrunk, shaded(hull(spec, blobs, palette[0], 0))]) : merge([farTrunk, ...twigs(spec, bark, spread(spec.clusters, 3), true)]);
  const near = [{ geometry: own(nearBody), material }];
  const far = [{ geometry: own(farBody), material }];
  if (leafy) {
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const cards = leafCards(random, spec.clusters.map((c) => ({ ...c, n: Math.round(c.r * c.r * spec.density * (detail ? 1 : 0.5)) })), { size: spec.card, center: new THREE.Vector3(0, cy, 0), up: spec.up, palette });
    const map = own(leafTexture(128, spec.seed, spec.slender));
    near.push({ geometry: own(cards), material: own(foliageMaterial(map, { wind: spec.wind ?? 0.02, uniforms })), depth: own(foliageDepth(map)) });
  }
  return { near, far };
}

/**
 * The asset for a tree described by `spec`.
 * @param {{id: string, name: string}} info
 * @param {CrownSpec} spec
 */
export const crownTree = ({ id, name }, spec) => defineAsset({ id, name, description: spec.description }, (options) => build(spec, options));

