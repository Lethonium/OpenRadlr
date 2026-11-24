/**
 * Conifer: a dark inner cone hull per tier plus rings of drooping needle
 * branches, snowy in winter. Restyled from the reference's `tree-pine.js`.
 */
import * as THREE from "../../../three.js";
import { seededRandom } from "../../../world/noise.js";
import { defineAsset } from "./asset.js";
import { bodyMaterial, foliageDepth, foliageMaterial } from "./foliage.js";
import { needleTexture } from "./foliageTextures.js";
import { colour, cone, cylinder, merge, shadeY } from "./geom.js";

/** radius, height, centre height, branches per tier */
const TIERS = Object.freeze([[2.6, 3.0, 3.0, 13], [2.05, 2.6, 4.6, 12], [1.5, 2.2, 6.0, 10], [0.95, 1.7, 7.3, 8], [0.5, 1.1, 8.4, 5]].map((tier) => Object.freeze(tier)));
const GREEN = "#24502c";
const SNOW = "#f1f5fa";
const BARK = "#4e3826";

/** Drooping branch cards, one fan per tier. */
function needleCards(random) {
  const position = [];
  const normal = [];
  const uv = [];
  const color = [];
  TIERS.forEach(([r, h, y, k], tier) => {
    for (let i = 0; i < k; i += 1) {
      const a = ((i + (random() - 0.5) * 0.4) / k) * Math.PI * 2 + tier * 0.7;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const len = r * (0.95 + random() * 0.2);
      const wid = r * 1.05;
      const from = [dx * 0.15, y + h * 0.35, dz * 0.15];
      const to = [dx * len, y - h * 0.45, dz * len];
      const n = new THREE.Vector3(dx, 1.1, dz).normalize();
      const s = 0.75 + 0.25 * (tier / TIERS.length);
      for (const [p, side, u, v] of [[from, -1, 0, 0], [to, -1, 1, 0], [to, 1, 1, 1], [from, -1, 0, 0], [to, 1, 1, 1], [from, 1, 0, 1]]) {
        const w = wid * (u ? 1 : 0.35) * 0.5 * side;
        position.push(p[0] - dz * w, p[1], p[2] + dx * w);
        normal.push(n.x, n.y, n.z);
        uv.push(u, v);
        color.push(s, s, s);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  return geometry;
}

export const pine = defineAsset({ id: "pine", name: "Pine", description: "Spruce with drooping needle branches; snow on the tiers in winter." }, ({ season, uniforms, own }) => { // i18n-ok
  const snowy = season === "winter";
  const green = colour(GREEN);
  const bark = colour(BARK);
  const tiers = (segments, open, snow) =>
    TIERS.flatMap(([r, h, y]) => {
      const parts = [shadeY(cone(r * 0.72, h, segments, green, 0, y, 0, open), 0.45, 0.8, y - h / 2, y + h / 2)];
      if (snow) {
        const hc = h * 0.42;
        parts.push(cone(r * 0.72 * 0.42 * 1.08, hc, segments, colour(SNOW), 0, y + h / 2 - hc / 2 + 0.05, 0, open));
      }
      return parts;
    });
  const material = own(bodyMaterial(uniforms, 0.01));
  const nearHull = merge([cylinder(0.14, 0.3, 9, 6, bark, 0, 4.5, 0), ...tiers(9, false, snowy)]);
  const farHull = merge([cylinder(0.14, 0.3, 9, 4, bark, 0, 4.5, 0, true), ...tiers(6, true, snowy)]);
  const map = own(needleTexture(snowy));
  const cards = needleCards(seededRandom(41));
  return {
    near: [{ geometry: own(nearHull), material }, { geometry: own(cards), material: own(foliageMaterial(map, { wind: 0.012, uniforms })), depth: own(foliageDepth(map)) }],
    far: [{ geometry: own(farHull), material }],
  };
});
