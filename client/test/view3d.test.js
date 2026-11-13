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
import { buildStatues } from "../public/js/view3d/statues.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { StudioCamera } from "../public/js/view3d/studioCamera.js";
import { GYM_CAMERA, GymCamera, SIDE_CAMERA, View3D, bodyAhead, gymCameraPose, insetViewport, sideCameraPose } from "../public/js/view3d/view3d.js";
import { WEATHER_VERTEX } from "../public/js/view3d/renderer.js";
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
  /** The scissored viewport of the pass being drawn, null for the whole canvas. */
  viewport(rect) {
    this.pass = rect;
    this.viewports.push(rect);
  }
  viewports = [];
  pass = null;
  begins = 0;
  begin() {
    this.begins += 1;
  }
  draw(handle, model, tint) {
    this.draws.push({ handle, model, tint, pass: this.pass });
  }
  drawBright() {}
  drawCloudLayer() {}
  drawTransparent() {}
  uploadWeather(data) {
    return { data };
  }
  drawWeather(handle, options) {
    this.weather = { handle, options };
  }
}

const emptyMesh = () => ({ positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0), vertexCount: 0 });
/** A gym 30 m off the square route's first side, facing the road (−Z). */
function testGym() {
  const center = [100, 100.4, 30];
  const spots = [];
  for (const z of [-0.9, 0.9]) for (let k = 0; k < 4; k += 1) spots.push({ position: [center[0] + (k - 1.5) * 1.8, center[1], center[2] + z], yaw: 0 });
  return { center, yaw: 0, spots };
}
function gymView(gyms, biome = "temperate", weather = null, renderer = new StubRenderer(), studio = undefined) {
  const route = squareRoute();
  const world = {
    biome,
    meshes: { horizon: emptyMesh(), islands: emptyMesh(), arches: emptyMesh() },
    chunks: { scenery: [], structures: [] },
    clouds: emptyMesh(),
    weather,
    water: emptyMesh(),
    rivers: emptyMesh(),
    rotors: [],
    spectators: [],
    gyms,
    studio,
  };
  const view = new View3D({ clientWidth: 320, clientHeight: 200 }, null, route, world, { renderer });
  return { view, renderer };
}
const workoutRider = { id: 7, name: "Ana", distance: 100, lane: 1, speed: 0, power: 0, device: "workout", exercise: null, exerciseSince: 10 };
const colors = { me: "#ff0000", human: "#00ff00", bot: "#0000ff" };

test("the view resolves the scene's biome for its sky", () => {
  assert.equal(gymView([]).view.biome.id, "temperate");
  assert.equal(gymView([], "winter").view.biome.id, "winter");
});

test("the view draws the biome's weather around the camera", () => {
  const weather = { kind: "snow", count: 2, data: new Float32Array(2 * 6 * 6) };
  const { view, renderer } = gymView([], "winter", weather);
  view.camera.update(100, 1, 0);
  view.render({ riders: [], myId: null, timeS: 12, colors });
  assert.ok(renderer.weather, "snow is drawn");
  assert.equal(renderer.weather.options.style.kind, "snow");
  assert.equal(renderer.weather.handle.data, weather.data);
});

/** Evaluates the weather shader's vertical placement, with GLSL's mod semantics. */
function weatherFlakeY({ seedY, timeS, speed, cameraY, boxY }) {
  const expression = WEATHER_VERTEX.match(/world\.y = ([^;]+);/)?.[1];
  assert.ok(expression, "the vertex shader places the weather");
  const mod = (x, y) => x - y * Math.floor(x / y);
  return new Function("seed", "u_time", "speed", "u_cameraPosition", "u_box", "mod", `return ${expression};`)({ y: seedY }, timeS, speed, { y: cameraY }, { y: boxY }, mod);
}

test("snow falls past the camera instead of rising with it", () => {
  const boxY = 100;
  const seedY = 60;
  const speed = 8;
  const first = weatherFlakeY({ seedY, timeS: 0, speed, cameraY: 30, boxY });
  const later = weatherFlakeY({ seedY, timeS: 1, speed, cameraY: 30, boxY });
  assert.ok(later < first, "the flake falls as time passes");
  assert.ok(Math.abs(first - later - speed) < 1e-9, "at its fall speed");
  // The field is wrapped around the camera: climbing must not drag it along.
  const climbed = weatherFlakeY({ seedY, timeS: 1, speed, cameraY: 40, boxY });
  assert.ok(Math.abs(climbed - later) < 1e-9, "climbing leaves the flake where it is");
});

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

test("in winter a workout rider is a penguin, and its bike still waits at the rack", () => {
  const gym = testGym();
  const { view, renderer } = gymView([gym], "winter");
  view.workoutMode(gym, { reducedMotion: true });
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  const penguin = view.workoutParts.get("pelvis");
  assert.ok(renderer.draws.some((d) => d.handle === penguin), "the penguin is drawn");
  const human = view.bodyParts[riderLook(7).variant].get("pelvis");
  assert.ok(!renderer.draws.some((d) => d.handle === human), "the human rider is not");
  assert.ok(renderer.draws.some((d) => d.handle === view.bodies[riderLook(7).variant]), "the bike is parked");
});

test("disposing a winter view frees the penguin rig", () => {
  const { view, renderer } = gymView([], "winter", null, new RecordingRenderer());
  const handles = [...view.workoutParts.values()];
  view.dispose();
  for (const handle of handles) assert.ok(renderer.disposed.includes(handle));
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
  closeVec([...eye, ...target], [100, 101.9, 25.5, 100, 101, 30]);
});

test("the gym camera looks at a given spot from its road side", () => {
  const spot = [101.8, 100.4, 30.9];
  const { eye, target } = gymCameraPose(testGym(), GYM_CAMERA, spot);
  closeVec([...eye, ...target], [101.8, 101.9, 26.4, 101.8, 101, 30.9]);
});

test("the gym camera swings to my spot when it changes", () => {
  const gym = testGym();
  const p1 = [101.8, 100.4, 30.9];
  const camera = new GymCamera(gym);
  const old = [...camera.eye];
  camera.focusOn(p1);
  camera.update(0, 0, GYM_CAMERA.swingS / 2);
  const half = [...camera.eye];
  camera.update(0, 0, GYM_CAMERA.swingS / 2);
  const goal = gymCameraPose(gym, GYM_CAMERA, p1).eye;
  assert.deepEqual([half[0] > old[0] && half[0] < goal[0], camera.eye], [true, goal]);
});

test("with reduced motion the gym camera cuts to my spot", () => {
  const gym = testGym();
  const spot = [101.8, 100.4, 30.9];
  const camera = new GymCamera(gym, null, GYM_CAMERA, { cut: true });
  camera.focusOn(spot);
  camera.update(0, 0, 0);
  assert.deepEqual(camera.eye, gymCameraPose(gym, GYM_CAMERA, spot).eye);
});

test("focusing on the same spot again does not restart the swing", () => {
  const gym = testGym();
  const p1 = [101.8, 100.4, 30.9];
  const camera = new GymCamera(gym);
  camera.focusOn(p1);
  camera.update(0, 0, GYM_CAMERA.swingS);
  camera.focusOn([...p1]);
  camera.update(0, 0, 0);
  assert.deepEqual(camera.eye, gymCameraPose(gym, GYM_CAMERA, p1).eye);
});

test("the workout view frames my rider at their spot", () => {
  const gym = testGym();
  const { view } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  for (let k = 0; k < 20; k += 1) view.render({ riders: [workoutRider], myId: 7, timeS: 12 + k * 0.1, colors });
  const [x, y, z] = assignSpots([7], gym).get(7).position;
  closeVec(view.camera.target, [x, y + GYM_CAMERA.aim, z]);
});

test("the workout view shifts the picture by the gym camera's offset, the ride not at all", () => {
  const gym = testGym();
  const { view } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  const inWorkout = view.viewOffset;
  view.rideMode();
  assert.deepEqual([inWorkout, view.viewOffset], [[0, GYM_CAMERA.screenY], [0, 0]]);
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

/** Records shadow casters, bright draws and disposals on top of the stub. */
class RecordingRenderer extends StubRenderer {
  casters = [];
  brights = [];
  disposed = [];
  upload(mesh) {
    return { mesh };
  }
  dispose(handle) {
    this.disposed.push(handle);
  }
  createShadowMap() {
    return true;
  }
  beginShadows() {}
  endShadows() {}
  drawShadowCaster(handle, model) {
    this.casters.push({ handle, model });
  }
  drawBright(handle, model, glow) {
    this.brights.push({ handle, model, glow });
  }
}

function statueView() {
  const gym = { ...testGym(), cafeId: "valley-cafe", statueRow: { position: [100, 100.4, 38], yaw: 0 } };
  const { view, renderer } = gymView([gym], "temperate", null, new RecordingRenderer());
  view.camera.update(100, 1, 0);
  gym.statueRow.position = [view.camera.target[0], view.camera.target[1], view.camera.target[2]];
  return { view, renderer, gym };
}
const renderStatues = (view) => view.render({ riders: [], myId: null, timeS: 12, colors });

test("a statue row is drawn lit and casts a shadow", () => {
  const { view, renderer, gym } = statueView();
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  renderStatues(view);
  const mesh = buildStatues(["squats", "plank"], "marble").mesh;
  const drawn = renderer.draws.filter((d) => d.handle.mesh.vertexCount === mesh.vertexCount);
  assert.equal(drawn.length, 1);
  const cast = renderer.casters.filter((d) => d.handle === drawn[0].handle);
  assert.equal(cast.length, 1);
  assert.deepEqual([...drawn[0].model], [...placement(gym.statueRow.position, gym.statueRow.yaw)]);
});

test("a winter view casts its statue rows as penguins", () => {
  const gym = { ...testGym(), cafeId: "valley-cafe", statueRow: { position: [100, 100.4, 38], yaw: 0 } };
  const { view, renderer } = gymView([gym], "winter", null, new RecordingRenderer());
  view.camera.update(100, 1, 0);
  gym.statueRow.position = [view.camera.target[0], view.camera.target[1], view.camera.target[2]];
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  renderStatues(view);
  const winter = buildStatues(["squats", "plank"], "marble", resolveBiome("winter").workout).mesh;
  const human = buildStatues(["squats", "plank"], "marble").mesh;
  assert.notEqual(winter.vertexCount, human.vertexCount, "the figures differ from the human row");
  const drawn = renderer.draws.filter((d) => d.handle.mesh?.vertexCount === winter.vertexCount);
  assert.equal(drawn.length, 1, "the penguin row is drawn");
  assert.deepEqual([...drawn[0].handle.mesh.positions], [...winter.positions]);
});

test("no glow is drawn until one is set, then exactly that ring", () => {
  const { view, renderer, gym } = statueView();
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  const ring = buildStatues(["squats", "plank"], "marble").glows[1];
  const glows = () => renderer.brights.filter((b) => b.handle !== view.meshes.arches);
  renderStatues(view);
  assert.equal(glows().length, 0);
  view.setStatueGlow(gym, 1);
  renderer.brights.length = 0;
  renderStatues(view);
  assert.equal(glows().length, 1);
  assert.equal(glows()[0].glow, 0.9);
  assert.deepEqual([...glows()[0].handle.mesh.positions], [...ring.positions]);
  view.setStatueGlow(null, null);
  renderer.brights.length = 0;
  renderStatues(view);
  assert.equal(glows().length, 0);
});

test("replacing the statues disposes the previous handles", () => {
  const { view, renderer, gym } = statueView();
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  renderer.disposed.length = 0;
  view.setStatues([]);
  assert.equal(renderer.disposed.length, 3, "one mesh and two rings");
  renderStatues(view);
  assert.equal(view.statueTargets(gym).length, 0);
});

test("disposing the view disposes the statue handles too", () => {
  const { view, renderer, gym } = statueView();
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  const uploaded = buildStatues(["squats", "plank"], "marble");
  renderer.disposed.length = 0;
  view.dispose();
  const sizes = renderer.disposed.filter((h) => h.mesh).map((h) => h.mesh.positions.length);
  assert.ok(sizes.includes(uploaded.mesh.positions.length), "the statue mesh");
  assert.ok(sizes.filter((n) => n === uploaded.glows[0].positions.length).length >= 2, "both rings");
});

test("statue targets are the world-space plinth tops of the row", () => {
  const { view, gym } = statueView();
  gym.statueRow = { position: [100, 100.4, 38], yaw: 0 };
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  const targets = view.statueTargets(gym);
  assert.equal(targets.length, 2);
  const tops = buildStatues(["squats", "plank"], "marble").tops;
  closeVec(targets[0].position, [100 - 1.5, 100.4 + tops[0], 38]);
  closeVec(targets[1].position, [100 + 1.5, 100.4 + tops[1], 38]);
  assert.equal(targets[0].yaw, 0);
  assert.equal(targets[0].top, tops[0]);
  assert.deepEqual(view.statueTargets({ statueRow: null }), []);
});

test("statue targets follow the row's yaw", () => {
  const { view, gym } = statueView();
  gym.statueRow = { position: [0, 0, 0], yaw: Math.PI / 2 };
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  const [first] = view.statueTargets(gym);
  assert.equal(first.yaw, Math.PI / 2);
  closeVec([first.position[0], first.position[2]], transformPoint(placement([0, 0, 0], Math.PI / 2), [-1.5, 0, 0]).filter((_, i) => i !== 1).slice(0, 2));
});

// --- a workout rider's side (yoga) ----------------------------------------------
const lungeRider = { ...workoutRider, exercise: "low_lunge", exerciseSince: 10 };

/** The thigh and pelvis models drawn for `rider` at `timeS`, on a view that has already drawn `before`. */
function drawnThighs(view, renderer, rider, timeS) {
  renderer.draws.length = 0;
  view.render({ riders: [rider], myId: 7, timeS, colors });
  const thigh = view.thighs[riderLook(7).variant];
  const pelvis = view.bodyParts[riderLook(7).variant].get("pelvis");
  const body = invert(renderer.draws.find((d) => d.handle === pelvis).model);
  // [left, right] points along each thigh in the rider's frame (pelvis-relative, which the mirror leaves alone).
  return renderer.draws.filter((d) => d.handle === thigh).map((d) => transformPoint(multiply(body, d.model), [0, -0.3, 0]).slice(0, 3));
}

function sideView() {
  const gym = testGym();
  const { view, renderer } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  return { view, renderer };
}

test("a rider on their left side is mirrored", () => {
  const right = sideView();
  const left = sideView();
  const [rightL, rightR] = drawnThighs(right.view, right.renderer, { ...lungeRider, side: "right" }, 12);
  const [leftL, leftR] = drawnThighs(left.view, left.renderer, { ...lungeRider, side: "left" }, 12);
  closeVec(leftL, [-rightR[0], rightR[1], rightR[2]], 1e-4);
  closeVec(leftR, [-rightL[0], rightL[1], rightL[2]], 1e-4);
  assert.ok(Math.abs(rightL[2] - rightR[2]) > 0.05, "the lunge puts one thigh ahead of the other");
});

test("a side change keeps the clip time", () => {
  // No exerciseSince: the view's own first sighting of the clip is its start, which a side change must not reset.
  const rider = { ...lungeRider, exerciseSince: undefined };
  const { view, renderer } = sideView();
  drawnThighs(view, renderer, { ...rider, side: "right" }, 10);
  drawnThighs(view, renderer, { ...rider, side: "left" }, 20.1); // the switch: a fade starts, the clip plays on
  const faded = drawnThighs(view, renderer, { ...rider, side: "left" }, 20.5);
  // A rider who was on the left all along, 10.5 s into the same clip.
  const steady = sideView();
  drawnThighs(steady.view, steady.renderer, { ...rider, side: "left" }, 10);
  const reference = drawnThighs(steady.view, steady.renderer, { ...rider, side: "left" }, 20.5);
  closeVec(faded[0], reference[0], 1e-4);
  closeVec(faded[1], reference[1], 1e-4);
});

// --- the workout's side view ------------------------------------------------------

test("the side camera stands to the rider's left, a little above the mat, looking at the rider", () => {
  // Yaw 0 faces −Z, so the rider's right is +X and their left −X.
  const spot = { position: [10, 2, 5], yaw: 0 };
  const { eye, target } = sideCameraPose(spot);
  closeVec(eye, [10 - SIDE_CAMERA.distance, 2 + SIDE_CAMERA.up, 5], 1e-9);
  closeVec(target, [10, 2 + SIDE_CAMERA.aim, 5], 1e-9);
});

test("the side camera frames a body that reaches ahead of the feet", () => {
  const { eye, target } = sideCameraPose({ position: [10, 2, 5], yaw: 0 }, 0.9);
  closeVec(eye, [10 - SIDE_CAMERA.distance, 2 + SIDE_CAMERA.up, 5 - 0.9], 1e-9);
  closeVec(target, [10, 2 + SIDE_CAMERA.aim, 5 - 0.9], 1e-9);
});

test("the side camera turns with the spot", () => {
  // Yaw π/2 faces −X, so the rider's left is +Z.
  const { eye } = sideCameraPose({ position: [0, 0, 0], yaw: Math.PI / 2 });
  closeVec(eye, [0, SIDE_CAMERA.up, SIDE_CAMERA.distance], 1e-9);
});

test("a body's reach ahead of its spot is where its parts lie on average, along the way it faces", () => {
  const at = (x, z) => Object.assign(new Float32Array(16), { 12: x, 14: z });
  const spot = { position: [10, 0, 5], yaw: 0 };
  // Facing −Z: parts 0.4, 1.2 and 0.8 m ahead; the last one's metre to the side does not count.
  assert.ok(Math.abs(bodyAhead([at(10, 4.6), at(10, 3.8), at(11, 4.2)], spot) - 0.8) < 1e-6);
  assert.equal(bodyAhead([], spot), 0);
});

test("the inset's viewport is the box on the canvas in device pixels, counted from the bottom", () => {
  const box = { left: 900, top: 500, width: 300, height: 200 };
  const canvas = { left: 0, top: 0, width: 1280, height: 800 };
  assert.deepEqual(insetViewport(box, canvas, 2), { x: 1800, y: 200, width: 600, height: 400 });
});

test("the inset is clipped to the canvas, and a hidden box has none", () => {
  const canvas = { left: 0, top: 0, width: 1000, height: 600 };
  assert.deepEqual(insetViewport({ left: 900, top: 500, width: 300, height: 200 }, canvas, 1), { x: 900, y: 0, width: 100, height: 100 });
  assert.equal(insetViewport({ left: 0, top: 0, width: 0, height: 0 }, canvas, 1), null);
  assert.equal(insetViewport(null, canvas, 1), null);
});

/** A side-view box at the lower right of the 320×200 test canvas. */
const sideBox = { getBoundingClientRect: () => ({ left: 220, top: 120, width: 90, height: 70 }) };

test("with a side view the workout draws a second pass into the inset", () => {
  const gym = testGym();
  const { view, renderer } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true, sideView: sideBox });
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  assert.equal(renderer.begins, 2);
  assert.deepEqual(renderer.viewports, [{ x: 220, y: 10, width: 90, height: 70 }, null]);
});

test("the inset shows my rider and not the riders on the next spots", (t) => {
  // The neighbour gets a name label: a bare stand-in for the DOM it is made of.
  const element = () => ({ style: {}, classList: { toggle() {} }, append() {}, querySelector: () => null, getBoundingClientRect: () => ({ width: 40, height: 16 }) });
  const saved = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => (globalThis.document = saved));
  const gym = testGym();
  const { view, renderer } = gymView([gym]);
  view.labelLayer = { append() {} };
  view.workoutMode(gym, { reducedMotion: true, sideView: sideBox });
  const other = { ...workoutRider, id: 9 };
  view.render({ riders: [workoutRider, other], myId: 7, timeS: 12, colors });
  const inset = renderer.draws.filter((d) => d.pass);
  const pelvis = (id) => view.bodyParts[riderLook(id).variant].get("pelvis");
  const pelvisAt = (id) => assignSpots([7, 9], gym).get(id).position;
  const drawnAt = (draw) => [draw.model[12], draw.model[14]];
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[2]) < 0.5;
  assert.ok(inset.some((d) => d.handle === pelvis(7) && near(drawnAt(d), pelvisAt(7))), "mine is drawn");
  assert.ok(!inset.some((d) => d.handle === pelvis(9) && near(drawnAt(d), pelvisAt(9))), "the neighbour is not");
});

test("riding has no side view", () => {
  const gym = testGym();
  const { view, renderer } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true, sideView: sideBox });
  view.rideMode();
  view.camera.update(100, 1, 0);
  view.render({ riders: [], myId: null, timeS: 12, colors });
  assert.equal(renderer.begins, 1);
});

// --- golden lemons -------------------------------------------------------------

function lemonView() {
  const { view, renderer } = gymView([], "temperate", null, new RecordingRenderer());
  return { view, renderer, me: { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 } };
}

test("a lemon ahead of my rider floats over its lane, drawn bright", () => {
  const { view, renderer, me } = lemonView();
  view.setLemons([{ id: "a", distance: 130, lane: 2, collected: false }]);
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  const lemons = renderer.brights.filter((d) => d.handle === view.lemonMesh);
  assert.equal(lemons.length, 1);
  const road = riderPosition(squareRoute(), 130, 2).position;
  const model = lemons[0].model;
  close(model[12], road[0], 0.01);
  close(model[14], road[2], 0.01);
  assert.ok(model[13] > road[1] + 0.9 && model[13] < road[1] + 1.6, "about handlebar height over the road");
});

test("collected and far-off lemons are not drawn", () => {
  const { view, renderer, me } = lemonView();
  view.setLemons([
    { id: "a", distance: 130, lane: 2, collected: true },
    { id: "b", distance: 700, lane: 2, collected: false },
  ]);
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  assert.equal(renderer.brights.filter((d) => d.handle === view.lemonMesh).length, 0);
});

test("without lemons none are drawn", () => {
  const { view, renderer, me } = lemonView();
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  assert.equal(renderer.brights.filter((d) => d.handle === view.lemonMesh).length, 0);
});

test("disposing the view frees the lemon mesh", () => {
  const { view, renderer } = lemonView();
  const handle = view.lemonMesh;
  view.dispose();
  assert.ok(renderer.disposed.includes(handle));
});

// --- ghost lap -------------------------------------------------------------------

class TransparentRecorder extends RecordingRenderer {
  transparent = [];
  drawTransparent(handle, model, options) {
    this.transparent.push({ handle, model, options });
  }
}

test("my best lap's ghost is drawn see-through, casting no shadow, never solid", () => {
  const { view, renderer } = gymView([], "temperate", null, new TransparentRecorder());
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  const ghost = { id: -1, name: "Best lap", distance: 200, lane: 2, speed: 8, power: 0, ghost: true };
  // 100 m ahead: past label range, so no DOM is needed.
  view.render({ riders: [me, ghost], myId: 1, timeS: 3, colors });
  const bike = view.bodies[riderLook(-1).variant];
  const seeThrough = renderer.transparent.filter((d) => d.handle === bike);
  assert.equal(seeThrough.length, 1, "the ghost's bike is see-through");
  assert.ok(seeThrough[0].options.alpha < 0.6);
  const road = riderPosition(squareRoute(), 200, 2).position;
  close(seeThrough[0].model[12], road[0], 0.01);
  const solidAtGhost = (list) => list.filter((d) => d.handle === bike && Math.abs(d.model[12] - road[0]) < 0.01 && Math.abs(d.model[14] - road[2]) < 0.01);
  assert.equal(solidAtGhost(renderer.draws).length, 0, "not drawn solid");
  assert.equal(solidAtGhost(renderer.casters).length, 0, "no shadow");
});

test("past the ends of a route that isn't a loop the road keeps its direction", () => {
  const route = new RouteGeometry({ id: "line", name: "Line", lanes: 2, seed: 1, loop: false, points: [[0, 0, 0], [100, 0, 0]] });
  for (const distance of [-24, -1, 0, 100, 124]) {
    const frame = roadFrame(route, distance);
    closeVec(frame.right, [0, 0, 1]);
    closeVec([frame.forward[0], frame.forward[2]], [1, 0]);
  }
});

// --- crowds ------------------------------------------------------------------------

/** A view with one spectator 12 m along the square route's first side, beside the road. */
function crowdView(person, biome = "temperate") {
  const { view, renderer } = gymView([], biome, null, new RecordingRenderer());
  const base = { yaw: 0, shirt: [1, 0, 0], armsUp: false, motion: "jump", phase: 0, scale: 1, rank: 0, flag: null };
  view.spectators = [{ ...base, position: [112, 100, 8], ...person }];
  return { view, renderer };
}
const spectatorDraws = (view, renderer) => renderer.draws.filter((d) => view.spectatorMeshes.includes(d.handle));

test("a lining spectator comes out once enough riders are online", () => {
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  const friends = [2, 3, 4, 5, 6].map((id) => ({ id, name: `R${id}`, distance: 400 + id * 10, lane: 1, speed: 8, power: 200 }));
  const alone = crowdView({ rank: 0.7 });
  alone.view.render({ riders: [me], myId: 1, timeS: 3, colors });
  assert.equal(spectatorDraws(alone.view, alone.renderer).length, 0, "not out for one rider");
  const busy = crowdView({ rank: 0.7 });
  busy.view.render({ riders: [me, ...friends], myId: 1, timeS: 3, colors });
  assert.equal(spectatorDraws(busy.view, busy.renderer).length, 1, "out for six");
});

test("bots don't bring out the crowd", () => {
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  const bots = [2, 3, 4, 5, 6].map((id) => ({ id, name: `B${id}`, distance: 400 + id * 10, lane: 1, speed: 8, power: 200, is_bot: true }));
  const { view, renderer } = crowdView({ rank: 0.7 });
  view.render({ riders: [me, ...bots], myId: 1, timeS: 3, colors });
  assert.equal(spectatorDraws(view, renderer).length, 0);
});

test("a spectator with a flag waves it in its colour, beside its head", () => {
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  const { view, renderer } = crowdView({ flag: [0.1, 0.2, 0.9] });
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  const flags = renderer.draws.filter((d) => d.handle === view.flagMesh);
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0].tint, [0.1, 0.2, 0.9]);
  assert.ok(Math.hypot(flags[0].model[12] - 112, flags[0].model[14] - 8) < 1, "at the spectator");
  assert.ok(flags[0].model[13] > 101.5, "held up high");
});

test("a penguin holds its flag lower, in its flipper", () => {
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  const { view, renderer } = crowdView({ flag: [0.1, 0.2, 0.9], motion: "clap" }, "winter");
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  const flag = renderer.draws.find((d) => d.handle === view.flagMesh);
  assert.ok(flag.model[13] < 101.2, `at ${flag.model[13]}`);
});

// --- bot kits (#64) ------------------------------------------------------------------

test("a bot rides in its team's kit; one without a known team in the bot colour", () => {
  const { view, renderer } = gymView([], "temperate", null, new RecordingRenderer());
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  // Past label range, so no DOM is needed.
  const teamed = { id: 41, name: "Gus Tailwind", is_bot: true, team: "moos", distance: 200, lane: 0, speed: 8, power: 150 };
  const plain = { id: 42, name: "Sally Sprocket", is_bot: true, distance: 205, lane: 3, speed: 8, power: 150 };
  view.render({ riders: [me, teamed, plain], myId: 1, timeS: 3, colors });
  const tintAt = (rider) => {
    const road = riderPosition(squareRoute(), rider.distance, rider.lane).position;
    const body = view.bodies[riderLook(rider.id).variant];
    const draw = renderer.draws.find((d) => d.handle === body && Math.abs(d.model[12] - road[0]) < 0.01 && Math.abs(d.model[14] - road[2]) < 0.01);
    return draw.tint.map((c) => Math.round(c * 255));
  };
  assert.deepEqual(tintAt(teamed), [0x4f, 0x8f, 0x3a]);
  assert.deepEqual(tintAt(plain), [0, 0, 255]);
});

test("a world without a studio site has no studio and ignores studio riders", () => {
  const { view, renderer } = gymView([]);
  view.camera.update(100, 1, 0);
  view.render({ riders: [{ id: 9, route: null, studio: { room: 0, seat: 0 }, power: 100, cadence: 80 }], myId: null, timeS: 1, colors });
  assert.equal(view.studioSite, null);
  assert.equal(renderer.draws.length > 0, true);
});

test("a world with a studio site draws the building and its riders", () => {
  const studio = { position: [100, 100, 80], yaw: 0 };
  const { view, renderer } = gymView([], "temperate", null, new StubRenderer(), studio);
  assert.deepEqual(view.studioSite, studio);
  view.camera.update(100, 1, 0);
  const frame = (riders) => {
    renderer.draws.length = 0;
    view.render({ riders, myId: null, timeS: 1, colors });
    return renderer.draws.length;
  };
  const empty = frame([]);
  const seated = frame([{ id: 9, route: null, studio: { room: 0, seat: 0 }, power: 100, cadence: 80 }]);
  assert.ok(empty > 0, "the building is drawn");
  assert.ok(seated > empty, "the seated rider adds meshes");
});

test("my own body is hidden in the point of view, the bike stays", () => {
  const studio = { position: [100, 100, 80], yaw: 0 };
  const { view, renderer } = gymView([], "temperate", null, new StubRenderer(), studio);
  const me = { id: 9, route: null, studio: { room: 0, seat: 3 }, power: 100, cadence: 80 };
  const drawn = (mode) => {
    view.camera = new StudioCamera(studio, 0, 3, mode);
    renderer.draws.length = 0;
    view.render({ riders: [me], myId: 9, myCadence: 80, timeS: 1, colors });
    return renderer.draws.filter((d) => d.model[12] > 99 && d.model[12] < 101 && d.model[14] > 79 && d.model[14] < 82);
  };
  const seat = drawn("seat");
  const pov = drawn("pov");
  assert.ok(pov.length > 0, "the bike and its front wheel are drawn");
  assert.ok(pov.length < seat.length, "no torso or legs in the point of view");
});

test("a studio camera follows my seat in the studio, without a road rider of mine", () => {
  const studio = { position: [100, 100, 80], yaw: 0 };
  const { view, renderer } = gymView([], "temperate", null, new StubRenderer(), studio);
  view.camera = new StudioCamera(studio, 0, 0, "seat");
  const before = [...view.camera.eye];
  renderer.draws.length = 0;
  view.render({ riders: [{ id: 9, route: null, studio: { room: 1, seat: 7 }, power: 100 }], myId: 9, timeS: 1, colors });
  assert.ok(view.camera.eye[1] > before[1] + 4, "moved up a floor");
  assert.ok(renderer.draws.length > 0);
});

// --- one frame's calls (the split into frame and views must not change them) -----

/** A renderer that logs the name of every call (and the rect of a viewport) on top of the recording one. */
function callLog() {
  const log = [];
  const inner = new RecordingRenderer();
  inner.queryOcclusion = () => {};
  const renderer = new Proxy(inner, {
    get(target, name) {
      const value = target[name];
      if (typeof value !== "function") return value;
      return (...args) => {
        log.push(
          name === "viewport"
            ? `viewport ${args[0] ? Object.values(args[0]).join(",") : "null"}`
            : name,
        );
        return value.apply(target, args);
      };
    },
  });
  return { renderer, log };
}
/** A bare stand-in for the DOM the name labels are made of. */
function stubLabels(t) {
  const element = () => ({
    style: {},
    classList: { toggle() {} },
    append() {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: 40, height: 16 }),
  });
  const saved = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => (globalThis.document = saved));
}
const collapse = (log) =>
  log.map((name, i) => (name === log[i - 1] ? null : name)).filter(Boolean);

test("a ride frame makes the same renderer calls as before", (t) => {
  stubLabels(t);
  const weather = { kind: "snow", count: 2, data: new Float32Array(2 * 6 * 6) };
  const { renderer, log } = callLog();
  const { view } = gymView([], "winter", weather, renderer);
  view.labelLayer = { append() {} };
  view.camera.update(100, 1, 0);
  const rider = {
    id: 7,
    name: "Ana",
    distance: 100,
    lane: 1,
    speed: 8,
    power: 150,
  };
  const other = {
    id: 8,
    name: "Bo",
    distance: 110,
    lane: 0,
    speed: 8,
    power: 150,
  };
  view.render({ riders: [rider, other], myId: 7, timeS: 12, colors });
  assert.deepEqual(collapse(log), EXPECTED_RIDE_CALLS);
});

test("a workout frame with a side view makes the same renderer calls as before", (t) => {
  stubLabels(t);
  const gym = testGym();
  const { renderer, log } = callLog();
  const { view } = gymView([gym], "temperate", null, renderer);
  view.labelLayer = { append() {} };
  view.workoutMode(gym, { reducedMotion: true, sideView: sideBox });
  view.render({
    riders: [workoutRider, { ...workoutRider, id: 9 }],
    myId: 7,
    timeS: 12,
    colors,
  });
  assert.deepEqual(collapse(log), EXPECTED_WORKOUT_CALLS);
});
const EXPECTED_RIDE_CALLS = [
  "upload",
  "createShadowMap",
  "upload",
  "uploadWeather",
  "upload",
  "resize",
  "beginShadows",
  "drawShadowCaster",
  "endShadows",
  "begin",
  "draw",
  "drawBright",
  "drawCloudLayer",
  "draw",
  "drawTransparent",
  "queryOcclusion",
  "drawWeather",
];
const EXPECTED_WORKOUT_CALLS = [
  "createShadowMap",
  "upload",
  "resize",
  "beginShadows",
  "drawShadowCaster",
  "endShadows",
  "begin",
  "draw",
  "drawBright",
  "drawCloudLayer",
  "draw",
  "drawTransparent",
  "queryOcclusion",
  "viewport 220,10,90,70",
  "begin",
  "draw",
  "drawBright",
  "drawCloudLayer",
  "draw",
  "drawTransparent",
  "viewport null",
];
