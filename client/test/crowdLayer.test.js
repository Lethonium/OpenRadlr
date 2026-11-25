/** Crowd layer: a pose picks its mesh, the shirt keeps its colour, hops lift, only wavers carry flags, nothing leaks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { spectatorGeometry } from "../public/js/view3d/assets/people/spectator.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createCrowdLayer } from "../public/js/view3d/scene/crowdLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const person = (x, shirt, flag = null) => ({ position: [x, 10, 5], yaw: 0, shirt, armsUp: true, motion: "jump", phase: 0, scale: 1, rank: 0, flag });
const people = [person(0, [0.55, 0.3, 0.75], [0.1, 0.2, 0.9]), person(2, [0.2, 0.45, 0.85]), person(4, [0.9, 0.1, 0.1])];
const entry = (index, extra = {}) => ({ index, yaw: 0, lift: 0, pose: false, flagSwing: 0, ...extra });

const make = (world = { biome: "temperate", crowd: { people, figure: "person" } }) => {
  const tracker = createTracker();
  const layer = createCrowdLayer(world, { settings: qualitySettings("high"), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker, mesh: (name) => layer.object.getObjectByName(name) };
};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("a pose picks its mesh and the shirt keeps its colour", () => {
  const { layer, mesh } = make();
  layer.update({ crowd: [entry(0, { pose: true }), entry(1), entry(2, { pose: true })] });
  assert.equal(mesh("crowd-body-up").count, 2);
  assert.equal(mesh("crowd-body-down").count, 1);
  assert.equal(mesh("crowd-shirt-up").count, 2);
  const colour = new THREE.Color();
  mesh("crowd-shirt-up").getColorAt(0, colour);
  [0.55, 0.3, 0.75].forEach((v, i) => near([colour.r, colour.g, colour.b][i], v, 1e-6, `shirt ${i}`));
  mesh("crowd-shirt-down").getColorAt(0, colour);
  near(colour.g, 0.45, 1e-6, "the next spectator's shirt");
  assert.equal(layer.stats().drawn, 3);
});

test("a hop lifts the spectator", () => {
  const { layer, mesh } = make();
  layer.update({ crowd: [entry(1, { lift: 0.3 })] });
  const matrix = new THREE.Matrix4();
  mesh("crowd-body-down").getMatrixAt(0, matrix);
  near(new THREE.Vector3().setFromMatrixPosition(matrix).y, 10.3, 1e-6, "instance y");
});

test("only flag wavers carry a flag", () => {
  const { layer, mesh } = make();
  layer.update({ crowd: [entry(0), entry(1), entry(2)] });
  assert.equal(mesh("crowd-flags").count, 1);
  const colour = new THREE.Color();
  mesh("crowd-flags").getColorAt(0, colour);
  near(colour.b, 0.9, 1e-6, "flag colour");
  const matrix = new THREE.Matrix4();
  mesh("crowd-flags").getMatrixAt(0, matrix);
  const hand = new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.ok(Math.hypot(hand.x - 0, hand.z - 5) < 1 && hand.y > 11.5, "held up high beside the head");
});

test("a spectator that is not in the world is skipped", () => {
  const { layer } = make();
  layer.update({ crowd: [entry(0), entry(99)] });
  assert.equal(layer.stats().drawn, 1);
});

test("winter crowds are penguins", () => {
  const height = (geometry) => {
    geometry.computeBoundingBox();
    return geometry.boundingBox.max.y - geometry.boundingBox.min.y;
  };
  const penguin = spectatorGeometry({ figure: "penguin", pose: false });
  const human = spectatorGeometry({ figure: "person", pose: false });
  assert.ok(height(penguin.body) < height(human.body), "shorter than a person");
  assert.ok(height(penguin.body) < 1.6);
  const clap = spectatorGeometry({ figure: "penguin", pose: true });
  assert.notDeepEqual([...clap.body.attributes.position.array], [...penguin.body.attributes.position.array], "the flippers move");
  const { layer, mesh } = make({ biome: "winter", crowd: { people, figure: "penguin" } });
  layer.update({ crowd: [entry(0, { pose: true })] });
  assert.equal(mesh("crowd-body-up").count, 1);
});

test("dispose frees everything", () => {
  const { layer, tracker } = make();
  layer.update({ crowd: [entry(0)] });
  assert.ok(tracker.live() > 0);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
