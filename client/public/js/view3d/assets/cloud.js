/**
 * The geometry of the puffy clouds: every puff of every cloud as one low-poly ellipsoid, merged into a single
 * flat-shaded geometry. The colour is baked per vertex, white on top and a shade darker underneath, so the layer
 * needs no light, only a tint by the time of day.
 */
import * as THREE from "../../three.js";
import { merge, paint, shadeY } from "./geom.js";

/** How dark a puff's underside is, against its top. */
const BELLY = 0.72;

/**
 * @param {import("../../world/clouds.js").CloudPlan} plan
 * @param {{segments?: number[]}} [options] override the plan's rings and segments (a cheaper cloud for slow machines)
 * @returns {import("../../three.js").BufferGeometry | null} null when there are no puffs
 */
export function cloudGeometry(plan, { segments = plan.segments } = {}) {
  const [rings, around] = segments;
  const color = new THREE.Color().setRGB(plan.color[0], plan.color[1], plan.color[2]);
  const parts = [];
  for (const { puffs } of plan.shapes) {
    for (const { at, radii, turn } of puffs) {
      const geometry = paint(new THREE.SphereGeometry(1, around, rings), color);
      geometry.scale(radii[0], radii[1], radii[2]);
      geometry.rotateY(turn);
      geometry.translate(at[0], at[1], at[2]);
      parts.push(shadeY(geometry, BELLY, 1, at[1] - radii[1], at[1] + radii[1]));
    }
  }
  if (!parts.length) return null;
  const merged = merge(parts);
  merged.computeVertexNormals();
  return merged;
}
