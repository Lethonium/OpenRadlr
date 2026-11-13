import { test } from "node:test";
import assert from "node:assert/strict";
import { STUDIO_CAMERAS, cameraModeOf, studioCamera } from "../../public/js/view3d/studioCamera.js";
import { StudioCamera } from "../../public/js/view3d/studioCamera.js";
import { FLOOR_HEIGHT, SLAB } from "../../public/js/view3d/studioBuilding.js";
import { seatPosition } from "../../public/js/view3d/studioLayout.js";
import { RIDER_GEOMETRY } from "../../public/js/view3d/riderModel.js";

const site = { position: [100, 20, 80], yaw: 0 };

test("the studio offers a point of view between the seat and the wide camera", () => {
  assert.deepEqual([...STUDIO_CAMERAS], ["seat", "pov", "wide", "coach"]);
});

test("pov sits at my head and looks forward through the glass", () => {
  const seat = seatPosition(5);
  const { eye, target } = studioCamera("pov", 5);
  assert.ok(Math.abs(eye[1] - (seat[1] + RIDER_GEOMETRY.headHeight)) < 1e-9);
  assert.deepEqual([eye[0], eye[2]], [seat[0], seat[2]]);
  assert.ok(target[2] < eye[2] - 5, "looks ahead");
  assert.ok(Math.abs(target[1] - (eye[1] - 0.3)) < 1e-9);
});

test("pov bobs with cadence and not with reduced motion", () => {
  const rest = studioCamera("pov", 5, { cadence: 90, timeS: 0 }).eye[1];
  const quarter = studioCamera("pov", 5, { cadence: 60, timeS: 0.25 }).eye[1];
  assert.ok(Math.abs(quarter - rest - 0.03) < 1e-9, "a quarter turn of the cranks lifts by the bob height");
  assert.equal(studioCamera("pov", 5, { cadence: 60, timeS: 0.25, reducedMotion: true }).eye[1], rest);
  assert.equal(studioCamera("pov", 5, { cadence: 0, timeS: 0.25 }).eye[1], rest);
});

test("cameraModeOf keeps a saved mode and falls back to seat", () => {
  assert.equal(cameraModeOf("wide"), "wide");
  assert.equal(cameraModeOf("pov"), "pov");
  assert.equal(cameraModeOf("bogus"), "seat");
  assert.equal(cameraModeOf(null), "seat");
});

test("StudioCamera on room 2 sits two floors above room 0", () => {
  const ground = new StudioCamera(site, 0, 4, "seat");
  const upper = new StudioCamera(site, 2, 4, "seat");
  assert.ok(Math.abs(upper.eye[1] - ground.eye[1] - 2 * FLOOR_HEIGHT) < 1e-3);
  assert.ok(Math.abs(upper.target[1] - ground.target[1] - 2 * FLOOR_HEIGHT) < 1e-3);
  assert.ok(Math.abs(ground.eye[1] - (site.position[1] + SLAB + studioCamera("seat", 4).eye[1])) < 1e-3, "the room stands on the slab");
});

test("StudioCamera switches and cycles modes, ignoring unknown ones", () => {
  const camera = new StudioCamera(site, 0, 4, "seat");
  camera.setMode("coach");
  assert.equal(camera.mode, "coach");
  camera.setMode("chase");
  assert.equal(camera.mode, "coach");
  camera.setMode("coach");
  assert.equal(camera.cycle(), "seat");
});

test("StudioCamera moves to another seat and bobs as time passes", () => {
  const camera = new StudioCamera(site, 0, 4, "pov");
  const before = camera.eye[0];
  camera.place(0, 6);
  assert.notEqual(camera.eye[0], before);
  camera.cadence = 60;
  const y = camera.eye[1];
  camera.update(0, 0, 0.25);
  assert.ok(camera.eye[1] > y);
});
