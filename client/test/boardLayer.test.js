/** Board layer: frames are instances, static posters one atlas mesh, goal boards ride on the frame, nothing leaks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { slotUv } from "../public/js/view3d/posters/paint.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createBoardLayer } from "../public/js/view3d/scene/boardLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const boards = [
  { kind: "general", distance: 100, position: [10, 2, 5], yaw: 0 },
  { kind: "climb", distance: 900, position: [40, 3, -5], yaw: Math.PI / 2 },
  { kind: "lastKm", distance: 1500, position: [-20, 1, 8], yaw: 1 },
];
const make = (list = boards, level = "high") => {
  const tracker = createTracker();
  const layer = createBoardLayer({ boards: list }, { settings: qualitySettings(level), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker };
};
const atlas = { width: 2048, height: 2048 };
const frameAt = (mesh, i) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(mesh.instanceMatrix.array, i * 16));

test("each board is one frame instance at its position", () => {
  const { layer } = make();
  const frames = layer.object.getObjectByName("board-frames");
  assert.equal(frames.count, 3);
  assert.deepEqual(frameAt(frames, 1).toArray(), [40, 3, -5]);
  assert.deepEqual(layer.stats(), { boards: 3, goal: 0 });
});

test("static posters are one mesh of quads whose uvs follow the atlas slots", () => {
  const { layer } = make();
  layer.setPosters(atlas, [2, 0, 5], 8);
  const posters = layer.object.getObjectByName("board-posters");
  const uv = posters.geometry.getAttribute("uv");
  assert.equal(uv.count, 12);
  const [u0, v0, u1, v1] = slotUv(5);
  assert.deepEqual([uv.getX(8), uv.getY(8), uv.getX(10), uv.getY(10)].map((n) => +n.toFixed(5)), [u0, v0, u1, v1].map((n) => +n.toFixed(5)));
  assert.equal(posters.material.map.image, atlas);
});

test("a poster stands on its board, facing along its yaw", () => {
  const { layer } = make();
  const positions = layer.object.getObjectByName("board-posters").geometry.getAttribute("position");
  // Board 0 has yaw 0: its quad is at x 10 +- 3 and z 5 + inset.
  assert.ok(Math.abs(positions.getX(1) - positions.getX(0) - 6) < 1e-5);
  assert.ok(Math.abs(positions.getZ(0) - 5.05) < 1e-5);
});

test("goal boards add frame instances and a goal poster each, and none hides them", () => {
  const { layer } = make();
  layer.setGoalPosters(atlas);
  layer.update({ goalBoards: [{ position: [0, 0, 0], yaw: 0, slot: 0 }, { position: [5, 0, 5], yaw: 0, slot: 1 }] });
  const frames = layer.object.getObjectByName("board-frames");
  const goal = layer.object.getObjectByName("goal-posters");
  assert.equal(frames.count, 5);
  assert.equal(goal.geometry.drawRange.count, 12);
  assert.deepEqual(layer.stats(), { boards: 3, goal: 2 });
  layer.update({ goalBoards: [] });
  assert.equal(frames.count, 3);
  assert.equal(goal.visible, false);
  layer.update({});
  assert.equal(frames.count, 3);
});

test("a goal poster takes its half of the goal canvas", () => {
  const { layer } = make();
  layer.update({ goalBoards: [{ position: [0, 0, 0], yaw: 0, slot: 1 }] });
  const uv = layer.object.getObjectByName("goal-posters").geometry.getAttribute("uv");
  assert.equal(uv.getX(0), 0.5);
  assert.equal(uv.getX(1), 1);
});

test("night lights the posters", () => {
  const { layer } = make();
  const material = layer.object.getObjectByName("board-posters").material;
  layer.setEnvironment({ night: 1 });
  assert.ok(Math.abs(material.emissiveIntensity - 0.7) < 1e-9);
  layer.setEnvironment({ night: 0 });
  assert.ok(Math.abs(material.emissiveIntensity - 0.1) < 1e-9);
});

test("at most three meshes draw, even with goal boards", () => {
  const { layer } = make();
  layer.update({ goalBoards: [{ position: [0, 0, 0], yaw: 0, slot: 0 }] });
  const drawn = layer.object.children.filter((child) => child.isMesh && child.visible);
  assert.ok(drawn.length <= 3, String(drawn.length));
});

test("no boards: no static posters, goal boards still possible", () => {
  const { layer } = make([]);
  assert.equal(layer.object.getObjectByName("board-posters"), undefined);
  assert.equal(layer.object.getObjectByName("board-frames").count, 0);
  layer.update({ goalBoards: [{ position: [0, 0, 0], yaw: 0, slot: 0 }] });
  assert.equal(layer.object.getObjectByName("board-frames").count, 1);
});

test("quality sets the frame detail and the atlas size", () => {
  assert.deepEqual({ ...qualitySettings("low").boards }, { atlas: 1024, detail: false });
  assert.deepEqual({ ...qualitySettings("medium").boards }, { atlas: 2048, detail: true });
  assert.deepEqual({ ...qualitySettings("ultra").boards }, { atlas: 2048, detail: true });
  assert.ok(Object.isFrozen(qualitySettings("high").boards));
});

test("dispose frees everything", () => {
  const { layer, tracker } = make();
  layer.setPosters(atlas, [0, 1, 2], 8);
  layer.setGoalPosters(atlas);
  assert.ok(tracker.live() > 0);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("poster quads carry normals along their board's front, so lit materials show them", () => {
  const { layer } = make();
  const normals = layer.object.getObjectByName("board-posters").geometry.getAttribute("normal");
  assert.ok(normals, "posters have a normal attribute");
  // Board 1 has yaw pi/2: its +z front turns to +x.
  for (let k = 4; k < 8; k += 1) assert.deepEqual([normals.getX(k), normals.getY(k), normals.getZ(k)].map((n) => Math.round(n * 1e5) / 1e5 + 0), [1, 0, 0]);
  assert.ok(layer.object.getObjectByName("goal-posters").geometry.getAttribute("normal"), "goal posters have normals too");
});
