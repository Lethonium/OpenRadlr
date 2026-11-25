/** Highlight layer: bands drawn in their colours scaled by glow, replaced without leaks, kept across quality rebuilds. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { qualitySettings } from "../public/js/view3d/quality.js";
import { createHighlightLayer } from "../public/js/view3d/scene/highlightLayer.js";
import { MARK_OFFSET } from "../public/js/view3d/scene/roadLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";

const band = () => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1]),
  colors: new Float32Array([1, 0.5, 0, 1, 0.5, 0, 1, 0.5, 0, 1, 0.5, 0, 1, 0.5, 0, 1, 0.5, 0]),
});
const make = () => {
  const tracker = createTracker();
  const layer = createHighlightLayer({ settings: qualitySettings("high"), track: tracker.track });
  return { layer, tracker };
};
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} vs ${expected}`);

test("a band is drawn in its colours, scaled by its glow", () => {
  const { layer } = make();
  layer.setBands([{ band: band(), glow: 0.35 }]);
  assert.equal(layer.object.children.length, 1);
  const mesh = layer.object.children[0];
  const colors = mesh.geometry.getAttribute("color");
  const tint = mesh.material.color.toArray();
  [0.35, 0.175, 0].forEach((expected, i) => near(colors.getComponent(0, i) * tint[i], expected, `channel ${i}`));
});

test("a band is pulled in front of the road markings, or the road's own depth offset hides it", () => {
  const { layer } = make();
  layer.setBands([{ band: band(), glow: 1 }]);
  const { material } = layer.object.children[0];
  assert.equal(material.polygonOffset, true);
  assert.ok(material.polygonOffsetFactor < MARK_OFFSET.factor, `factor ${material.polygonOffsetFactor}`);
  assert.ok(material.polygonOffsetUnits < MARK_OFFSET.units, `units ${material.polygonOffsetUnits}`);
});

test("setting bands again replaces them and leaks nothing", () => {
  const { layer, tracker } = make();
  const baseline = tracker.live();
  for (let i = 0; i < 30; i += 1) layer.setBands([1, 2, 3].map(() => ({ band: band(), glow: 1 })));
  layer.setBands([]);
  assert.equal(tracker.live(), baseline);
  assert.equal(layer.object.children.length, 0);
});

test("bands survive a quality rebuild", () => {
  const tracker = createTracker();
  const scene = createWorldScene({}, { settings: qualitySettings("high"), track: tracker.track });
  scene.setHighlights([{ band: band(), glow: 1 }]);
  scene.setQuality(qualitySettings("low"));
  assert.equal(scene.scene.getObjectByName("highlight").children.length, 1);
  scene.dispose();
  assert.equal(tracker.live(), 0);
});

test("disposing the layer frees every band", () => {
  const { layer, tracker } = make();
  layer.setBands([{ band: band(), glow: 1 }]);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
