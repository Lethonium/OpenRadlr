import { test } from "node:test";
import assert from "node:assert/strict";

import { LAND_STYLE } from "../public/js/world/landKinds.js";
import { paintLandUse } from "../public/js/world/landPaint.js";

const bounds = { x0: -500, z0: -500, x1: 500, z1: 500 };
const pasture = { kind: "pasture", x: 0, z: 0, width: 120, depth: 80, yaw: 0, crop: null, edge: "hedge", tint: 0.5 };
const texel = (paint, x, z) => {
  const i = Math.floor((x - paint.x0) / paint.cell);
  const j = Math.floor((z - paint.z0) / paint.cell);
  const k = (j * paint.columns + i) * 4;
  return paint.rgba.subarray(k, k + 4);
};

test("a parcel paints its kind's season colour", () => {
  const paint = paintLandUse([pasture], { bounds, season: "summer", seed: 3 });
  const [r, g, b, a] = texel(paint, 0, 0);
  const expected = LAND_STYLE.pasture.paint.summer.map((c) => 255 * c * (1 + 0.08 * pasture.tint));
  assert.equal(a, 255);
  for (const [got, want] of [[r, expected[0]], [g, expected[1]], [b, expected[2]]]) assert.ok(Math.abs(got - want) <= 2, `${got} vs ${want}`);
  assert.equal(texel(paint, 110, 0)[3], 0, "50 m outside the parcel nothing is painted");
});

test("the texture stays within 2048 texels", () => {
  const paint = paintLandUse([pasture], { bounds: { x0: -15000, z0: -15000, x1: 15000, z1: 15000 }, season: "summer", seed: 3 });
  assert.ok(paint.columns <= 2048 && paint.rows <= 2048);
  assert.equal(paint.rgba.length, paint.columns * paint.rows * 4);
});

test("winter paints winter", () => {
  const summer = [...texel(paintLandUse([pasture], { bounds, season: "summer", seed: 3 }), 0, 0)];
  const winter = [...texel(paintLandUse([pasture], { bounds, season: "winter", seed: 3 }), 0, 0)];
  assert.notDeepEqual(winter, summer);
  assert.ok(Math.max(...winter.slice(0, 3)) > 0.2 * 255);
});

test("an arable parcel paints its crop", () => {
  const field = { ...pasture, kind: "arable", crop: "wheat", tint: 0 };
  const [r] = texel(paintLandUse([field], { bounds, season: "summer", seed: 3 }), 0, 0);
  assert.ok(Math.abs(r - 0.78 * 255) <= 2);
});
