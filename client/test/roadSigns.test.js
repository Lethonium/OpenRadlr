/** The warning sign seen from behind (two-way roads): a plain grey back, not just the post. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SIGN_COLORS, warningSignParts } from "../public/js/view3d/assets/props/roadSigns.js";

/** Every triangle of a geometry as {normal, ys, color}. */
function triangles(geometry) {
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  const index = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: position.count }, (_, i) => i);
  const out = [];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((axis) => position.getComponent(index[t + k], axis)));
    const u = [0, 1, 2].map((k) => b[k] - a[k]);
    const v = [0, 1, 2].map((k) => c[k] - a[k]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    out.push({ normal, ys: [a[1], b[1], c[1]], color: [0, 1, 2].map((k) => color.getComponent(index[t], k)) });
  }
  return out;
}

test("the warning sign has a grey back facing +Z at the height of its face", () => {
  const { geometry } = warningSignParts();
  const backs = triangles(geometry).filter((t) => t.normal[2] > 0 && t.ys.every((y) => y > 1.5));
  assert.equal(backs.length, 1);
  assert.ok(Math.abs(backs[0].normal[0]) < 1e-6 && Math.abs(backs[0].normal[1]) < 1e-6, "flat toward +Z");
  const metal = SIGN_COLORS.metal;
  assert.ok(backs[0].color.every((v, k) => Math.abs(v - metal[k]) < 1e-3), "the post's grey");
});
