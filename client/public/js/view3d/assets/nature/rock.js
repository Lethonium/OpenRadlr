/**
 * Lumpy boulder with moss on top (snow in winter) and dark crevices.
 * Restyled from the reference's `rock.js`.
 */
import * as THREE from "../../../three.js";
import { mergeVertices } from "../../../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { defineAsset } from "./asset.js";
import { bodyMaterial } from "./foliage.js";
import { colour, paint } from "./geom.js";

const STONE = Object.freeze({ spring: "#99928a", summer: "#99928a", autumn: "#938b82", winter: "#9aa3b3" });
const MOSS = Object.freeze({ spring: "#6f8a4a", summer: "#6f8a4a", autumn: "#8a8250", winter: "#f2f5f9" });

/** One boulder: an icosphere pushed out by waves, flattened at the bottom, sitting on y = 0. */
function boulder(detail, season) {
  let sphere = new THREE.IcosahedronGeometry(1, detail);
  sphere.deleteAttribute("normal");
  sphere.deleteAttribute("uv");
  sphere = mergeVertices(sphere);
  const p = sphere.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const f = 1 + 0.22 * Math.sin(x * 3.1 + y * 2.3) * Math.cos(z * 2.7 - y * 1.9) + 0.07 * Math.sin(x * 9.3 - z * 8.1 + y * 7.7) + 0.035 * Math.sin(x * 21 + y * 17 - z * 19);
    p.setXYZ(i, x * f, Math.max(y * f * 0.72, -0.35) + 0.35, z * f);
  }
  sphere.computeVertexNormals();
  const out = paint(sphere, colour(STONE[season]));
  const n = out.attributes.normal;
  const c = out.attributes.color;
  const q = out.attributes.position;
  const moss = colour(MOSS[season]);
  const snow = season === "winter";
  for (let i = 0; i < n.count; i += 1) {
    const m = Math.max(0, Math.max(0, n.getY(i)) - (snow ? 0.4 : 0.55)) * (snow ? 2.2 : 1.6);
    const k = Math.min(1, m);
    const dark = 0.7 + 0.3 * Math.min(1, q.getY(i) / 0.9);
    c.setXYZ(i, (c.getX(i) * (1 - k) + moss.r * k) * dark, (c.getY(i) * (1 - k) + moss.g * k) * dark, (c.getZ(i) * (1 - k) + moss.b * k) * dark);
  }
  return out;
}

export const rock = defineAsset({ id: "rock", name: "Rock", description: "Lumpy boulder with moss on top, snowcapped in winter." }, ({ season, uniforms, own }) => { // i18n-ok
  const material = own(bodyMaterial(uniforms, 0, 0.95));
  return { near: [{ geometry: own(boulder(3, season)), material }], far: [{ geometry: own(boulder(1, season)), material }] };
});
