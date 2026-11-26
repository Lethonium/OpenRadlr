/** The studio building layer: it grows with the floors, closed floors are dark, nothing leaks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createStudioBuildingLayer } from "../public/js/view3d/scene/studioBuildingLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { FLOOR_HEIGHT, SLAB } from "../public/js/world/studioLayout.js";

const site = { position: [100, 20, -50], yaw: 0.4 };
const make = () => {
  const tracker = createTracker();
  const layer = createStudioBuildingLayer(site, { settings: qualitySettings("high"), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker };
};
const panes = (layer) => {
  const found = [];
  layer.object.traverse((child) => child.name === "glass" && found.push(child));
  return found;
};
const glow = (layer, floor) => layer.object.getObjectByName(`room-${floor}`).getObjectByName("lit-lemon").material.emissiveIntensity;

test("the layer is named studio and stands on its site", () => {
  const { layer } = make();
  layer.update({ studio: { floors: 2, open: 0 } });
  assert.equal(layer.object.name, "studio");
  assert.deepEqual(layer.object.position.toArray(), site.position);
  assert.ok(Math.abs(layer.object.rotation.y - site.yaw) < 1e-9);
});

test("grows by floors", () => {
  const { layer } = make();
  layer.update({ studio: { floors: 1, open: 1 } });
  assert.equal(panes(layer).length, 1);
  layer.update({ studio: { floors: 3, open: 3 } });
  assert.equal(panes(layer).length, 3);
  layer.object.updateMatrixWorld(true);
  const sign = layer.object.getObjectByName("sign");
  const y = new THREE.Vector3().setFromMatrixPosition(sign.matrixWorld).y;
  assert.ok(Math.abs(y - (site.position[1] + 3 * FLOOR_HEIGHT + SLAB + 1.6)) < 1e-6, `sign at ${y}`);
  for (let floor = 0; floor < 3; floor += 1) {
    assert.ok(Math.abs(layer.object.getObjectByName(`room-${floor}`).position.y - (floor * FLOOR_HEIGHT + SLAB)) < 1e-9);
  }
});

test("closed floors are dark", () => {
  const { layer } = make();
  layer.update({ studio: { floors: 2, open: 1 } });
  assert.ok(glow(layer, 0) > 0);
  assert.equal(glow(layer, 1), 0);
  layer.update({ studio: { floors: 2, open: 2 } });
  assert.ok(glow(layer, 1) > 0);
  const open = panes(layer)[1].material.opacity;
  layer.update({ studio: { floors: 2, open: 1 } });
  assert.ok(panes(layer)[1].material.opacity > open, "the closed floor's glass is darker");
  assert.ok(panes(layer)[1].material.opacity > panes(layer)[0].material.opacity);
});

test("an update that changes nothing builds nothing", () => {
  const { layer, tracker } = make();
  layer.update({ studio: { floors: 2, open: 1 } });
  const live = tracker.live();
  layer.update({ studio: { floors: 2, open: 1 } });
  assert.equal(tracker.live(), live);
});

test("disposes", () => {
  const { layer, tracker } = make();
  layer.update({ studio: { floors: 3, open: 2 } });
  layer.update({ studio: { floors: 2, open: 2 } });
  assert.ok(tracker.live() > 0);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
