import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { identity, lookAt, multiply, perspective, placement, rotationXAbout, transformPoint, yawFor } from "../public/js/view3d/math.js";
import { fbm, seededRandom, valueNoise } from "../public/js/view3d/noise.js";
import { RIDER_GEOMETRY, buildBike, buildCrankset, buildFoot, buildShin, buildThigh, legPose } from "../public/js/view3d/riderModel.js";
import {
  LANE_WIDTH,
  RoadIndex,
  buildArches,
  buildClouds,
  buildGroundDetail,
  buildFarIslands,
  buildRoad,
  buildScenery,
  roadFrame,
  roadHalfWidth,
  riderPosition,
  terrainModel,
  waterLevel,
} from "../public/js/view3d/world.js";
import { invert } from "../public/js/view3d/math.js";
import { CLIPS, settle } from "../public/js/view3d/clips.js";
import { riderLook } from "../public/js/view3d/riderModel.js";
import { bodyTransforms, poseAt } from "../public/js/view3d/riderPose.js";
import { GymCamera, View3D, gymCameraPose } from "../public/js/view3d/view3d.js";
import { assignSpots } from "../public/js/workout/gymSpots.js";
import { squareRoute } from "./helpers.js";

const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const closeVec = (a, b, eps = 1e-5) => a.forEach((v, i) => close(v, b[i], eps));

// --- math --------------------------------------------------------------------

test("identity is neutral for multiplication", () => {
  const m = placement([1, 2, 3], 0.7, 0.2);
  assert.deepEqual(Array.from(multiply(identity(), m)), Array.from(m));
});

test("placement turns local forward (−Z) into the requested direction", () => {
  const direction = [Math.SQRT1_2, 0, Math.SQRT1_2];
  const m = placement([10, 0, 0], yawFor(direction), 0);
  closeVec(transformPoint(m, [0, 0, -1]).slice(0, 3), [10 + Math.SQRT1_2, 0, Math.SQRT1_2]);
});

test("positive pitch lifts the nose", () => {
  const m = placement([0, 0, 0], 0, 0.1);
  assert.ok(transformPoint(m, [0, 0, -1])[1] > 0);
});

test("lookAt puts the target in front of the camera on the view axis", () => {
  const view = lookAt([0, 2, 10], [0, 2, 0]);
  closeVec(transformPoint(view, [0, 2, 0]).slice(0, 3), [0, 0, -10]);
});

test("perspective maps the near and far planes to −1 and +1", () => {
  const proj = perspective(Math.PI / 3, 1.5, 1, 100);
  close(transformPoint(proj, [0, 0, -1])[2], -1);
  close(transformPoint(proj, [0, 0, -100])[2], 1);
});

test("rotating about a pivot keeps the pivot fixed", () => {
  closeVec(transformPoint(rotationXAbout([0, 1, 0.12], 0.8), [0, 1, 0.12]).slice(0, 3), [0, 1, 0.12]);
});

// --- noise -------------------------------------------------------------------

test("noise is deterministic, bounded and seed dependent", () => {
  for (let i = 0; i < 200; i += 1) {
    const v = fbm(i * 0.37, i * 0.11, 42);
    assert.ok(v >= 0 && v <= 1);
  }
  assert.equal(valueNoise(3.3, 7.1, 5), valueNoise(3.3, 7.1, 5));
  assert.notEqual(valueNoise(3.3, 7.1, 5), valueNoise(3.3, 7.1, 6));
  const a = seededRandom(9);
  const b = seededRandom(9);
  assert.equal(a(), b());
});

// --- road and riders ---------------------------------------------------------

test("the road frame follows the route in world axes", () => {
  const route = squareRoute();
  const frame = roadFrame(route, 100);
  closeVec(frame.center, [100, 100, -0]);
  closeVec(frame.right, [0, 0, 1], 1e-3);
  assert.equal(frame.grade, 0);
  const climbing = roadFrame(route, 375);
  closeVec(climbing.center, [250, 105, -125]);
  assert.ok(climbing.forward[1] > 0, "forward points uphill");
});

test("lanes are spread across the road from left to right", () => {
  const route = squareRoute();
  const left = riderPosition(route, 100, 0).position;
  const right = riderPosition(route, 100, 3).position;
  // Riding east (+X), right is +Z.
  close(right[2] - left[2], 3 * LANE_WIDTH);
  close((left[2] + right[2]) / 2, 0);
});

test("the terrain lies just below the road and rises into hills further out", () => {
  const route = new RouteGeometry(JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url))));
  const terrain = terrainModel(route);
  for (const d of [0, 800, 1600, 2400, 3200, 4000]) {
    const { center } = roadFrame(route, d);
    const below = center[1] - terrain.height(center[0], center[2]);
    assert.ok(below > 0.1 && below < 1, `terrain at ${d} m is ${below} m below the road`);
  }
  assert.equal(terrain.height(123, -456), terrain.height(123, -456));
});

test("road index finds the nearest sample", () => {
  const index = new RoadIndex(squareRoute());
  const near = index.nearest(100, 3);
  close(near.distance, 3, 1);
  assert.equal(index.nearest(10_000, 10_000), null);
});

test("road, arches and riders produce geometry", () => {
  const route = squareRoute();
  const road = buildRoad(route);
  assert.ok(road.vertexCount > 1000);
  assert.equal(road.positions.length, road.vertexCount * 3);
  assert.equal(road.colors.length, road.vertexCount * 4);
  assert.ok(buildArches(route).vertexCount >= 108, "start arch: two posts and a beam");
  assert.ok(buildBike().vertexCount > 100);
  for (const part of [buildThigh(), buildShin(), buildFoot(), buildCrankset()]) assert.ok(part.vertexCount > 0);
});

test("pedalling legs stay attached: hip → knee → ankle → pedal on the crank circle", () => {
  const { hip, bottomBracket, crankLength, thigh, shin, ball } = RIDER_GEOMETRY;
  const at = (point, angle) => multiply(placement(point), rotationXAbout([0, 0, 0], angle));
  for (let i = 0; i < 24; i += 1) {
    const pose = legPose((i / 24) * Math.PI * 2);
    closeVec(transformPoint(at(hip, pose.thighAngle), [0, -thigh, 0]).slice(0, 3), pose.knee, 1e-4);
    closeVec(transformPoint(at(pose.knee, pose.shinAngle), [0, -shin, 0]).slice(0, 3), pose.ankle, 1e-4);
    closeVec(transformPoint(at(pose.ankle, pose.footAngle), ball).slice(0, 3), pose.pedal, 1e-4);
    closeVec(transformPoint(at(bottomBracket, pose.crankAngle), [0, -crankLength, 0]).slice(0, 3), pose.pedal, 1e-4);
    // The knee bends forward (−Z) of the straight hip–ankle line, never backwards.
    const along = [pose.ankle[1] - hip[1], pose.ankle[2] - hip[2]];
    const toKnee = [pose.knee[1] - hip[1], pose.knee[2] - hip[2]];
    assert.ok(along[0] * toKnee[1] - along[1] * toKnee[0] > 0, `knee bends forward at step ${i}`);
  }
});

test("cranks turn forward and the leg extends at the bottom of the stroke", () => {
  const bottom = legPose(0);
  const later = legPose(0.3);
  assert.ok(later.pedal[2] > bottom.pedal[2], "after the bottom the pedal moves back (+Z)");
  assert.ok(legPose(Math.PI / 2).pedal[2] > legPose(-Math.PI / 2).pedal[2], "back of the stroke behind the front");
  const kneeAngle = (pose) => {
    const a = [RIDER_GEOMETRY.hip[1] - pose.knee[1], RIDER_GEOMETRY.hip[2] - pose.knee[2]];
    const b = [pose.ankle[1] - pose.knee[1], pose.ankle[2] - pose.knee[2]];
    return Math.acos((a[0] * b[0] + a[1] * b[1]) / Math.hypot(...a) / Math.hypot(...b));
  };
  assert.ok(kneeAngle(bottom) > (125 * Math.PI) / 180, "almost straight at the bottom");
  assert.ok(kneeAngle(legPose(Math.PI)) < (80 * Math.PI) / 180, "well bent at the top");
});

test("scenery is deterministic and never on the road", () => {
  const route = squareRoute();
  const terrain = terrainModel(route);
  const bounds = { x0: -200, z0: -450, x1: 450, z1: 200 };
  const a = buildScenery(route, terrain, bounds, { count: 150 });
  const b = buildScenery(route, terrain, bounds, { count: 150 });
  assert.equal(a.count, 150);
  assert.deepEqual(a.positions, b.positions);
  for (const [x, , z] of a.positions) assert.ok(terrain.distanceToRoad(x, z) >= roadHalfWidth(route.lanes) + 4);
});

// --- view helpers -----------------------------------------------------------

test("labels: not mine, nearest first, no overlaps", async () => {
  const { visibleLabels } = await import("../public/js/view3d/view3d.js");
  const at = (id, x, distance, name = "Rider") => ({ rider: { id, name, is_bot: false }, distance, screen: { x, y: 100 } });
  const shown = visibleLabels([at(3, 105, 20), at(2, 100, 10), at(1, 102, 5), at(4, 400, 40)], 1).map((c) => c.rider.id);
  assert.deepEqual(shown, [2, 4]);
});

test("the chase camera sits behind and above the rider and looks ahead", async () => {
  const { ChaseCamera } = await import("../public/js/view3d/chaseCamera.js");
  const route = squareRoute();
  const camera = new ChaseCamera(route).update(100, 1.5, 0);
  // Riding east along +X at elevation 100.
  close(camera.eye[0], 100 - 5.5, 1e-3);
  close(camera.eye[1], 102.2, 1e-3);
  assert.ok(camera.target[0] > 100);
  close(camera.eye[2], 0, 1e-3);
  camera.update(100, 3, 0.25);
  assert.ok(camera.eye[2] > 0 && camera.eye[2] < 0.5 * 1.5 * 1.4, "lane change glides");
});

test("projection hides points behind the camera and maps the centre", async () => {
  const { projectToScreen, hexToRgb } = await import("../public/js/view3d/view3d.js");
  const viewProjection = multiply(perspective(1, 2, 0.1, 100), lookAt([0, 0, 0], [0, 0, -1]));
  const centre = projectToScreen(viewProjection, [0, 0, -10], 200, 100);
  close(centre.x, 100);
  close(centre.y, 50);
  assert.equal(projectToScreen(viewProjection, [0, 0, 10], 200, 100), null);
  assert.deepEqual(hexToRgb("#ff0000"), [1, 0, 0]);
  assert.deepEqual(hexToRgb("bogus"), [0.6, 0.6, 0.6]);
});

test("invert undoes a matrix", () => {
  const m = multiply(perspective(1, 1.7, 0.3, 900), lookAt([3, 4, 5], [0, 1, -2]));
  const product = multiply(m, invert(m));
  identity().forEach((v, i) => close(product[i], v, 1e-4));
});

test("the sea level stays below the road", () => {
  const route = new RouteGeometry(JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url))));
  const index = new RoadIndex(route);
  assert.ok(waterLevel(index) <= index.minElevation - 4);
});

test("far islands stand out at sea and clouds float high", () => {
  const route = squareRoute();
  const terrain = terrainModel(route);
  const islands = buildFarIslands(route, terrain, { count: 8 });
  for (let i = 0; i < islands.vertexCount; i += 3) {
    const x = islands.positions[i * 3];
    const z = islands.positions[i * 3 + 2];
    if (islands.positions[i * 3 + 1] > terrain.seaLevel) continue;
    assert.ok(terrain.island.inland(x, z) < -500, "far islands stand well off the coast");
  }
  const clouds = buildClouds(route, terrain, { count: 4 });
  for (let i = 0; i < clouds.vertexCount; i += 1) assert.ok(clouds.positions[i * 3 + 1] > terrain.index.meanElevation + 200);
});

test("scenery avoids the lake", () => {
  const route = squareRoute();
  const terrain = terrainModel(route);
  const bounds = { x0: -200, z0: -450, x1: 450, z1: 200 };
  const water = 95;
  const scenery = buildScenery(route, terrain, bounds, { count: 120, water });
  for (const [x, , z] of scenery.positions) assert.ok(terrain.height(x, z) >= water + 1);
});

// --- round 2: lighting, cameras, riders, ground detail ----------------------

test("time-of-day presets are complete and auto follows the clock", async () => {
  const { TIME_PRESETS, presetForHour, resolvePreset } = await import("../public/js/view3d/lighting.js");
  for (const preset of Object.values(TIME_PRESETS)) {
    close(Math.hypot(...preset.sun), 1);
    assert.ok(preset.sun[1] > 0, "the sun is above the horizon");
    for (const key of ["sunColor", "zenith", "horizon", "ground", "cloudTint"]) assert.equal(preset[key].length, 3);
  }
  assert.equal(presetForHour(12), "day");
  assert.equal(presetForHour(7), "golden");
  assert.equal(presetForHour(18.5), "golden");
  assert.equal(presetForHour(22), "dusk");
  assert.equal(resolvePreset("auto", new Date(2026, 0, 1, 13, 0)).key, "day");
  assert.equal(resolvePreset("bogus").label, "Day");
});

test("the shadow frustum contains the focus and is stable to small moves", async () => {
  const { sunShadowMatrix, TIME_PRESETS } = await import("../public/js/view3d/lighting.js");
  const sun = TIME_PRESETS.golden.sun;
  const m = sunShadowMatrix(sun, [100, 50, -20], { halfSize: 60, mapSize: 2048 });
  const p = transformPoint(m, [100, 50, -20]);
  for (const v of p.slice(0, 3)) assert.ok(v > -1 && v < 1);
  const nearby = transformPoint(m, [140, 52, -20]);
  assert.ok(Math.abs(nearby[0]) < 1 && Math.abs(nearby[1]) < 1, "40 m away is still inside");
  const a = sunShadowMatrix(sun, [100.001, 50, -20]);
  assert.deepEqual(Array.from(a), Array.from(m), "sub-texel moves snap to the same matrix");
  const overhead = sunShadowMatrix([0, 1, 0], [0, 0, 0]);
  assert.ok(overhead.every(Number.isFinite), "a sun straight above is handled");
});

test("orthographic maps its box to clip space", async () => {
  const { orthographic } = await import("../public/js/view3d/math.js");
  const m = orthographic(-10, 10, -5, 5, 1, 101);
  closeVec(transformPoint(m, [10, 5, -1]).slice(0, 3), [1, 1, -1]);
  closeVec(transformPoint(m, [-10, -5, -101]).slice(0, 3), [-1, -1, 1]);
});

test("camera modes: drone is high, side looks at the rider from the road side", async () => {
  const { ChaseCamera, cameraPose, CAMERA_MODES } = await import("../public/js/view3d/chaseCamera.js");
  const route = squareRoute();
  const drone = cameraPose(route, 100, 0, CAMERA_MODES.drone);
  const chase = cameraPose(route, 100, 0, CAMERA_MODES.chase);
  assert.ok(drone.eye[1] > chase.eye[1] + 5);
  const side = cameraPose(route, 100, 0, CAMERA_MODES.side);
  assert.ok(side.eye[2] > 4, "beside the road on the right");
  close(side.target[0], 100, 1e-3);

  const camera = new ChaseCamera(route);
  assert.equal(camera.cycle(), "close");
  camera.update(100, 1.5, 0.1);
  const midway = camera.eye[0];
  camera.update(100, 1.5, 1);
  assert.ok(Math.abs(camera.eye[0] - (100 - 3)) < 1e-3 && midway < camera.eye[0], "the switch blends in");
  for (let i = 0; i < 4; i += 1) camera.cycle();
  assert.equal(camera.mode, "close", "cycling wraps around");
});

test("riders get a stable look from their id", async () => {
  const { riderLook, variantLook, VARIANT_COUNT, buildWheel } = await import("../public/js/view3d/riderModel.js");
  assert.deepEqual(riderLook(42), riderLook(42));
  const looks = Array.from({ length: 50 }, (_, i) => riderLook(i));
  assert.ok(new Set(looks.map((l) => l.variant)).size > 5, "riders look different");
  for (const look of looks) {
    assert.ok(look.variant >= 0 && look.variant < VARIANT_COUNT);
    assert.ok(look.scale >= 0.93 && look.scale <= 1.07);
  }
  assert.equal(variantLook(3).skin.length, 3);
  assert.ok(buildWheel().vertexCount > 200);
});

test("grass and flowers grow beside the road, not on it", () => {
  const route = squareRoute();
  const terrain = terrainModel(route);
  const detail = buildGroundDetail(route, terrain, { tufts: 300, flowers: 50 });
  assert.ok(detail.count > 250, "most spots are usable even on a tight test loop");
  const half = roadHalfWidth(route.lanes);
  for (let i = 0; i < detail.mesh.vertexCount; i += 9) {
    const x = detail.mesh.positions[i * 3];
    const z = detail.mesh.positions[i * 3 + 2];
    assert.ok(terrain.distanceToRoad(x, z) > half, "outside the asphalt");
    assert.ok(terrain.distanceToRoad(x, z) < half + 40, "close to the road where the camera sees it");
  }
});

// --- workout riders at the gym (#77) ------------------------------------------

/** A renderer that draws nothing and remembers every draw call. */
class StubRenderer {
  draws = [];
  upload(mesh) {
    return { mesh };
  }
  dispose() {}
  createShadowMap() {
    return false;
  }
  resize() {}
  begin() {}
  draw(handle, model) {
    this.draws.push({ handle, model });
  }
  drawBright() {}
  drawCloudLayer() {}
  drawTransparent() {}
}

const emptyMesh = () => ({ positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0), vertexCount: 0 });
/** A gym 30 m off the square route's first side, facing the road (−Z). */
function testGym() {
  const center = [100, 100.4, 30];
  const spots = [];
  for (const z of [-0.9, 0.9]) for (let k = 0; k < 4; k += 1) spots.push({ position: [center[0] + (k - 1.5) * 1.8, center[1], center[2] + z], yaw: 0 });
  return { center, yaw: 0, spots };
}
function gymView(gyms) {
  const route = squareRoute();
  const world = {
    meshes: { horizon: emptyMesh(), islands: emptyMesh(), arches: emptyMesh() },
    chunks: {},
    clouds: emptyMesh(),
    water: emptyMesh(),
    rivers: emptyMesh(),
    rotors: [],
    spectators: [],
    gyms,
  };
  const renderer = new StubRenderer();
  const view = new View3D({ clientWidth: 320, clientHeight: 200 }, null, route, world, { renderer });
  return { view, renderer };
}
const workoutRider = { id: 7, name: "Ana", distance: 100, lane: 1, speed: 0, power: 0, device: "workout", exercise: null, exerciseSince: 10 };
const colors = { me: "#ff0000", human: "#00ff00", bot: "#0000ff" };

test("a workout rider is drawn at its gym spot, not on the road", () => {
  const gym = testGym();
  const { view, renderer } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  const pelvis = view.bodyParts[riderLook(7).variant].get("pelvis");
  const drawn = renderer.draws.find((d) => d.handle === pelvis).model;
  // The pelvis as the clip poses it in the rider's own frame; what is left of the drawn model is the spot.
  const local = bodyTransforms(settle(poseAt(CLIPS.idle, 2))).find((p) => p.mesh === "pelvis").model;
  const placed = multiply(drawn, invert(local));
  closeVec([placed[12], placed[13], placed[14]], assignSpots([7], gym).get(7).position, 0.01);
});

test("a workout rider's bike stands at the gym's bike rack", () => {
  const gym = testGym();
  const { view, renderer } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  const bike = renderer.draws.find((d) => d.handle === view.bodies[riderLook(7).variant]).model;
  // By the mat's road edge (3 m towards the road, −Z here), beside the mat, on the gravel just below it.
  closeVec([bike[12], bike[13], bike[14]], [104.6, 100.34, 27], 0.01);
});

test("a workout rider with no gym in reach stays on its bike on the road", () => {
  const { view, renderer } = gymView([]);
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  const bike = renderer.draws.find((d) => d.handle === view.bodies[riderLook(7).variant]).model;
  const road = riderPosition(squareRoute(), 100, 1).position;
  closeVec([bike[12], bike[13], bike[14]], road, 0.01);
});

test("the gym camera looks at the mat centre from its road side", () => {
  const { eye, target } = gymCameraPose(testGym());
  closeVec([...eye, ...target], [100, 102.6, 23, 100, 100.4, 30]);
});

test("the gym camera swings over from the chase camera in 1.5 s", () => {
  const gym = testGym();
  const camera = new GymCamera(gym, { eye: [100, 102.2, -5.5], target: [109, 101.1, 0] });
  const start = [...camera.eye];
  camera.update(0, 0, 0.75);
  const half = [...camera.eye];
  camera.update(0, 0, 0.75);
  assert.deepEqual([start, half[2] > -5.5 && half[2] < 23, camera.eye], [[100, 102.2, -5.5], true, gymCameraPose(gym).eye]);
});

test("with reduced motion the gym camera is there at once", () => {
  const gym = testGym();
  const { view } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  assert.deepEqual(view.camera.eye, gymCameraPose(gym).eye);
});
