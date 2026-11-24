/**
 * A paddock's fence: posts every few metres round the rectangle with two rails between them, standing on the
 * ground, and a gap with two taller gate posts on the side that faces the yard.
 */
import { box, colour, rod } from "../assets/geom.js";

const POST = Object.freeze({ every: 3, width: 0.14, height: 1.25 });
const RAILS = Object.freeze([0.45, 0.95]);
const GATE = 4; // metres of gap
const WOOD = colour("#8a6a48");
const GATE_WOOD = colour("#5e4330");

/**
 * World-space fence geometry for one paddock.
 * @param {{x: number, z: number, width: number, depth: number, yaw: number}} paddock `width` runs along (cos yaw, sin yaw), `depth` across it
 * @param {{x: number, z: number}} yard where the gate faces
 * @param {(x: number, z: number) => number} heightAt ground height
 * @returns {import("../../three.js").BufferGeometry[]}
 */
export function paddockFence(paddock, yard, heightAt) {
  const { x, z, width, depth, yaw } = paddock;
  const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)];
  const world = (u, v) => [x + cos * u - sin * v, z + sin * u + cos * v];
  const toYard = [(yard.x - x) * cos + (yard.z - z) * sin, -(yard.x - x) * sin + (yard.z - z) * cos];
  const alongU = Math.abs(toYard[0]) / (width / 2) > Math.abs(toYard[1]) / (depth / 2);
  const gate = alongU ? { u: Math.sign(toYard[0]) * width / 2, v: 0 } : { u: 0, v: Math.sign(toYard[1]) * depth / 2 };
  const corners = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
  const parts = [];
  const post = (u, v, tall) => {
    const [px, pz] = world(u, v);
    const base = heightAt(px, pz);
    parts.push(box(POST.width, POST.height * (tall ? 1.25 : 1), POST.width, tall ? GATE_WOOD : WOOD, px, base + (POST.height * (tall ? 1.25 : 1)) / 2 - 0.1, pz));
    return [px, base, pz];
  };
  const inGate = (u, v) => Math.hypot(u - gate.u, v - gate.v) < GATE / 2 + 0.01;
  for (let side = 0; side < 4; side += 1) {
    const [a, b] = [corners[side], corners[(side + 1) % 4]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.round(length / POST.every));
    let previous = null;
    for (let k = 0; k <= count; k += 1) {
      const u = a[0] + ((b[0] - a[0]) * k) / count;
      const v = a[1] + ((b[1] - a[1]) * k) / count;
      const here = inGate(u, v) ? null : post(u, v, false);
      if (here && previous) for (const h of RAILS) parts.push(rod([previous[0], previous[1] + h, previous[2]], [here[0], here[1] + h, here[2]], 0.04, WOOD, 4, true));
      previous = here;
    }
  }
  const [gx, gz] = [gate.u, gate.v];
  const along = alongU ? [0, 1] : [1, 0];
  for (const s of [-1, 1]) post(gx + along[0] * s * (GATE / 2), gz + along[1] * s * (GATE / 2), true);
  return parts;
}
