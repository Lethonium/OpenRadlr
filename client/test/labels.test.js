import { test } from "node:test";
import assert from "node:assert/strict";
import { LabelVisibility, labelLook } from "../public/js/view3d/labels.js";

test("a label shows once its rider is first seen", () => {
  const labels = new LabelVisibility();
  assert.equal(labels.update(1, undefined, 0), false, "no result yet");
  assert.equal(labels.update(1, true, 0.02), true);
});

test("a label of a rider hidden from the start never shows", () => {
  const labels = new LabelVisibility();
  assert.equal(labels.update(1, false, 0), false);
  assert.equal(labels.update(1, false, 1), false);
});

test("a rider going behind a house loses its label after a moment, not at once", () => {
  const labels = new LabelVisibility({ hideS: 0.25 });
  labels.update(1, true, 0);
  assert.equal(labels.update(1, false, 1), true, "just went behind it");
  assert.equal(labels.update(1, false, 1.2), true);
  assert.equal(labels.update(1, false, 1.3), false);
});

test("a rider flickering at an edge keeps its label", () => {
  const labels = new LabelVisibility({ hideS: 0.25 });
  labels.update(1, true, 0);
  for (let t = 0.1; t < 2; t += 0.1) assert.equal(labels.update(1, Math.round(t * 10) % 2 === 0, t), true, `at ${t}`);
});

test("a label comes back when its rider has been in sight for a moment", () => {
  const labels = new LabelVisibility({ hideS: 0.25, showS: 0.1 });
  labels.update(1, true, 0);
  labels.update(1, false, 0.5);
  labels.update(1, false, 1);
  assert.equal(labels.update(1, true, 1.05), false);
  assert.equal(labels.update(1, true, 1.2), true);
});

test("without results (no occlusion queries) a label keeps its state", () => {
  const labels = new LabelVisibility();
  labels.update(1, true, 0);
  assert.equal(labels.update(1, undefined, 5), true);
});

test("riders that are gone are forgotten", () => {
  const labels = new LabelVisibility();
  labels.update(1, true, 0);
  labels.update(2, true, 0);
  labels.keep(new Set([2]));
  assert.equal(labels.update(1, undefined, 1), false, "starts over");
  assert.equal(labels.update(2, undefined, 1), true);
});

test("labels get smaller and fainter with distance, but stay readable", () => {
  const near = labelLook(0, 80);
  const mid = labelLook(40, 80);
  const far = labelLook(80, 80);
  assert.deepEqual(near, { scale: 1, opacity: 1 });
  assert.ok(mid.scale < 1 && mid.scale > far.scale && mid.opacity < 1 && mid.opacity > far.opacity);
  assert.ok(far.scale >= 0.7 && far.opacity >= 0.5, JSON.stringify(far));
  assert.deepEqual(labelLook(500, 80), far);
});
