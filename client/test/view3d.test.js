import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { identity, lookAt, multiply, perspective, placement, rotationXAbout, transformPoint, yawFor } from "../public/js/view3d/math.js";
import { fbm, seededRandom, valueNoise } from "../public/js/world/noise.js";
import { roadStrips } from "../public/js/world/plan/roadStrips.js";
import { archPlacements } from "../public/js/view3d/world.js";
import { LANE_WIDTH, RoadIndex, bikeOnRoad, riderPosition, roadFrame, terrainModel, waterLevel } from "../public/js/world/roads.js";
import { invert } from "../public/js/view3d/math.js";
import { CLIPS, mirrorPose } from "../public/js/view3d/clips.js";
import { poseAt } from "../public/js/view3d/riderPose.js";
import { PLINTHS } from "../public/js/view3d/statues.js";
import { StudioCamera } from "../public/js/view3d/studioCamera.js";
import { fakeEngine } from "./support/fakeEngine.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { groundFixture } from "./support/groundFixture.js";
import { GYM_CAMERA, GymCamera, RIDE_LENS, projectToScreen, SIDE_CAMERA, View3D, gymCameraPose, insetViewport, sideCameraPose } from "../public/js/view3d/view3d.js";
import { assignSpots } from "../public/js/workout/gymSpots.js";
import { squareRoute } from "./helpers.js";
import { coachWorld, seatWorld } from "../public/js/view3d/studioLayer.js";
import { COACH_KIT, INSTRUCTOR, coachId, isCoach } from "../public/js/view3d/studioLayout.js";

const hexRgb = (hex) => [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16) / 255);
const linear = (rgb) => rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

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
  const road = roadStrips(route);
  assert.ok(road.kinds.length > 1000);
  assert.equal(road.positions.length, road.kinds.length * 3);
  assert.equal(road.indices.length, (road.kinds.length / 4) * 6);
  assert.ok(archPlacements(route).some((a) => a.kind === "start_finish" && !a.banner), "the start arch is placed");
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

// --- round 2: lighting, cameras, riders, ground detail ----------------------

test("time-of-day presets are complete and auto follows the clock", async () => {
  const { TIME_PRESETS, presetForHour, resolvePreset } = await import("../public/js/world/daylight.js");
  for (const preset of Object.values(TIME_PRESETS)) {
    close(Math.hypot(...preset.sun), 1);
    assert.ok(preset.sun[1] > 0, "the sun is above the horizon");
    for (const key of ["sunColor", "zenith", "horizon", "ground", "cloudTint"]) assert.equal(preset[key].length, 3);
  }
  assert.equal(presetForHour(12), "day");
  assert.equal(presetForHour(7), "golden");
  assert.equal(presetForHour(18.5), "golden");
  assert.equal(presetForHour(22), "night");
  assert.equal(resolvePreset("auto", new Date(2026, 0, 1, 13, 0)).key, "day");
  assert.equal(resolvePreset("bogus").label, "Day");
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

// --- workout riders at the gym (#77) ------------------------------------------

/** A gym 30 m off the square route's first side, facing the road (−Z). */
function testGym() {
  const center = [100, 100.4, 30];
  const spots = [];
  for (const z of [-0.9, 0.9]) for (let k = 0; k < 4; k += 1) spots.push({ position: [center[0] + (k - 1.5) * 1.8, center[1], center[2] + z], yaw: 0 });
  return { center, yaw: 0, spots, position: [center[0], center[1] - 0.08, center[2]], base: center[1] - 0.08, drop: 0.4, signLift: 0 };
}
function gymView(gyms, biome = "temperate", studio = undefined, engine = fakeEngine()) {
  const route = squareRoute();
  const world = {
    biome,
    crowd: { people: [], figure: "person" },
    gyms,
    studio,
  };
  const view = new View3D({ clientWidth: 320, clientHeight: 200 }, null, route, world, { engine });
  return { view, engine };
}
const workoutRider = { id: 7, name: "Ana", distance: 100, lane: 1, speed: 0, power: 0, device: "workout", exercise: null, exerciseSince: 10 };
const colors = { me: "#ff0000", human: "#00ff00", bot: "#0000ff" };

test("a view made at a quality level never builds the high level first", () => {
  const engine = fakeEngine();
  const view = new View3D({ clientWidth: 320, clientHeight: 200 }, null, squareRoute(), { biome: "temperate", crowd: { people: [], figure: "person" } }, { engine, quality: "low" });
  assert.equal(view.quality, "low");
  assert.deepEqual(engine.qualities, [qualitySettings("low")]);
});

test("the view resolves the scene's biome for its sky", () => {
  assert.equal(gymView([]).view.biome.id, "temperate");
  assert.equal(gymView([], "winter").view.biome.id, "winter");
});

test("a workout rider reaches the athlete layer", () => {
  const gym = testGym();
  const { view } = gymView([gym], "temperate");
  view.workoutMode(gym, { reducedMotion: true });
  const frames = recordFrames(view);
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  const { athletes, riders } = frames.at(-1);
  assert.equal(athletes.length, 1);
  assert.equal(riders.length, 0, "not a road rider");
  const [entry] = athletes;
  const spot = assignSpots([7], gym).get(7);
  assert.equal(entry.id, 7);
  closeVec(entry.position, spot.position, 0.01);
  assert.equal(entry.yaw, spot.yaw);
  assert.deepEqual(entry.pose, poseAt(CLIPS.idle, 2));
  assert.equal(entry.plantMesh, null);
  assert.deepEqual(entry.tint, [1, 0, 0]);
  assert.equal(entry.figure, "rider");
  // By the mat's road edge (3 m towards the road, −Z here), beside the mat, on the gravel just below it.
  closeVec(entry.bike.position, [104.6, 100.34, 27], 0.01);
  assert.equal(entry.bike.yaw, 0);
});

test("a workout clip's planted foot reaches the athlete layer", () => {
  const gym = testGym();
  const { view } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  const frames = recordFrames(view);
  view.render({ riders: [{ ...workoutRider, exercise: "squats" }], myId: 7, timeS: 12, colors });
  assert.equal(frames.at(-1).athletes[0].plantMesh, "footR");
  view.render({ riders: [{ ...workoutRider, exercise: "squats", side: "left" }], myId: 7, timeS: 12.1, colors });
  assert.equal(frames.at(-1).athletes[0].plantMesh, "footL");
});

test("a winter gym's athletes are penguins", () => {
  const gym = testGym();
  const { view } = gymView([gym], "winter");
  view.workoutMode(gym, { reducedMotion: true });
  const frames = recordFrames(view);
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  assert.equal(frames.at(-1).athletes[0].figure, "penguin");
});

test("riding away from a gym and back leaves nothing behind", () => {
  const gym = testGym();
  const { view } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  const frames = recordFrames(view);
  const cycle = () => {
    view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
    assert.equal(frames.at(-1).athletes.length, 1);
    view.render({ riders: [], myId: 7, timeS: 13, colors });
    assert.equal(frames.at(-1).athletes?.length ?? 0, 0);
  };
  cycle();
  const baseline = view.tracker.live();
  for (let i = 0; i < 5; i += 1) cycle();
  assert.equal(view.tracker.live(), baseline);
});

test("a workout rider with no gym in reach rides the road in the world scene", () => {
  const { view } = gymView([]);
  const frames = recordFrames(view);
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  const [entry] = frames.at(-1).riders;
  closeVec(entry.position, bikeOnRoad(squareRoute(), 100, 1).position, 0.01);
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

function statueView() {
  const gym = { ...testGym(), cafeId: "valley-cafe", statueRow: { position: [100, 100.4, 38], yaw: 0 } };
  const { view } = gymView([gym], "temperate");
  view.camera.update(100, 1, 0);
  gym.statueRow.position = [view.camera.target[0], view.camera.target[1], view.camera.target[2]];
  return { view, gym };
}
const renderStatues = (view) => view.render({ riders: [], myId: null, timeS: 12, colors });

test("statue rows go to the statue layer, as riders on a temperate map", () => {
  const { view, gym } = statueView();
  const sent = [];
  view.worldScene.setStatues = (rows) => sent.push(rows);
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  assert.deepEqual(sent, [[{ gym, figures: ["squats", "plank"], material: "marble", figure: "rider" }]]);
});

test("a winter view sends its statue rows as penguins", () => {
  const gym = { ...testGym(), cafeId: "valley-cafe", statueRow: { position: [100, 100.4, 38], yaw: 0 } };
  const { view } = gymView([gym], "winter");
  const sent = [];
  view.worldScene.setStatues = (rows) => sent.push(rows);
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  assert.equal(sent[0][0].figure, "penguin");
});

test("the statue glow reaches the frame, and goes out", () => {
  const { view, gym } = statueView();
  const frames = recordFrames(view);
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  renderStatues(view);
  assert.equal(frames.at(-1).statueGlow ?? null, null);
  view.setStatueGlow(gym, 1);
  renderStatues(view);
  assert.deepEqual(frames.at(-1).statueGlow, { gym, index: 1 });
  view.setStatueGlow(null, null);
  renderStatues(view);
  assert.equal(frames.at(-1).statueGlow ?? null, null);
});

test("replacing the statues does not leak", () => {
  const { view, gym } = statueView();
  const rows = [{ gym, figures: ["squats", "plank"], material: "marble" }];
  view.setStatues(rows);
  const baseline = view.tracker.live();
  for (let i = 0; i < 4; i += 1) view.setStatues(rows);
  assert.equal(view.tracker.live(), baseline);
  view.setStatues([]);
  renderStatues(view);
  assert.equal(view.statueTargets(gym).length, 0);
});

test("statue targets are the world-space plinth tops of the row", () => {
  const { view, gym } = statueView();
  gym.statueRow = { position: [100, 100.4, 38], yaw: 0 };
  view.setStatues([{ gym, figures: ["squats", "plank"], material: "marble" }]);
  const targets = view.statueTargets(gym);
  assert.equal(targets.length, 2);
  const tops = [PLINTHS.upright[1], PLINTHS.lying[1]];
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

/** The athlete entry the view hands the world scene for `rider` at `timeS`, on a view that has already shown `before`. */
function athleteAt(view, rider, timeS) {
  const frames = recordFrames(view);
  view.render({ riders: [rider], myId: 7, timeS, colors });
  return frames.at(-1).athletes[0];
}

function sideView() {
  const gym = testGym();
  const { view } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true });
  return { view };
}

test("a rider on their left side is mirrored", () => {
  const right = athleteAt(sideView().view, { ...lungeRider, side: "right" }, 12);
  const left = athleteAt(sideView().view, { ...lungeRider, side: "left" }, 12);
  assert.deepEqual(left.pose, mirrorPose(right.pose));
  assert.notDeepEqual(left.pose.joints, right.pose.joints, "the lunge is one-sided, so the mirror shows");
});

test("a side change keeps the clip time", () => {
  // No exerciseSince: the view's own first sighting of the clip is its start, which a side change must not reset.
  const rider = { ...lungeRider, exerciseSince: undefined };
  const { view } = sideView();
  athleteAt(view, { ...rider, side: "right" }, 10);
  athleteAt(view, { ...rider, side: "left" }, 20.1); // the switch: a fade starts, the clip plays on
  const faded = athleteAt(view, { ...rider, side: "left" }, 20.5);
  // A rider who was on the left all along, 10.5 s into the same clip.
  const steady = sideView().view;
  athleteAt(steady, { ...rider, side: "left" }, 10);
  const reference = athleteAt(steady, { ...rider, side: "left" }, 20.5);
  assert.deepEqual(faded.pose, reference.pose);
});

test("a new exercise fades in from the last pose", () => {
  const { view } = sideView();
  const before = athleteAt(view, { ...workoutRider, exercise: "squats", exerciseSince: 10 }, 12);
  const pushups = { ...workoutRider, exercise: "pushups", exerciseSince: 12.05 };
  athleteAt(view, pushups, 12.1);
  const during = athleteAt(view, pushups, 12.2);
  const after = athleteAt(view, pushups, 12.6);
  assert.notDeepEqual(during.pose, poseAt(CLIPS.pushups, 12.2 - 12.05), "still blending");
  assert.notDeepEqual(during.pose, before.pose);
  assert.deepEqual(after.pose, poseAt(CLIPS.pushups, 12.6 - 12.05));
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
  const { view, engine } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true, sideView: sideBox });
  view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  assert.deepEqual(engine.rects, [null, { x: 220, y: 10, width: 90, height: 70 }]);
});

test("the inset shows my rider and not the riders on the next spots", (t) => {
  // The neighbour gets a name label: a bare stand-in for the DOM it is made of.
  const element = () => ({ style: {}, classList: { toggle() {} }, append() {}, querySelector: () => null, getBoundingClientRect: () => ({ width: 40, height: 16 }) });
  const saved = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => (globalThis.document = saved));
  const gym = testGym();
  const { view, engine } = gymView([gym]);
  view.labelLayer = { append() {} };
  view.workoutMode(gym, { reducedMotion: true, sideView: sideBox });
  // What the athlete layer shows at the moment the engine draws a scene.
  const shown = [];
  const render = engine.renderScene.bind(engine);
  engine.renderScene = (scene, camera, rect) => {
    const athletes = scene.getObjectByName("athletes");
    shown.push({ rect, ids: [...new Set(athletes.children.filter((c) => c.visible && c.userData.athlete !== undefined).map((c) => c.userData.athlete))] });
    return render(scene, camera, rect);
  };
  view.render({ riders: [workoutRider, { ...workoutRider, id: 9 }], myId: 7, timeS: 12, colors });
  const [full, inset] = shown;
  assert.deepEqual(full.ids.sort(), [7, 9], "the screen shows both");
  assert.deepEqual(inset.ids, [7], "the inset only mine");
  assert.ok(inset.rect);
  const after = [];
  engine.renderScene = (scene, camera, rect) => {
    after.push([...new Set(scene.getObjectByName("athletes").children.filter((c) => c.visible && c.userData.athlete !== undefined).map((c) => c.userData.athlete))]);
    return render(scene, camera, rect);
  };
  view.render({ riders: [workoutRider, { ...workoutRider, id: 9 }], myId: 7, timeS: 12.1, colors });
  assert.deepEqual(after[0].sort(), [7, 9], "the next frame is whole again");
});

test("the inset follows my body along the mat", () => {
  const gym = testGym();
  const { view } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true, sideView: sideBox });
  const frames = recordFrames(view);
  view.render({ riders: [{ ...workoutRider, exercise: "plank", exerciseSince: 10 }], myId: 7, timeS: 12, colors });
  assert.ok(frames.length > 0);
  const spot = assignSpots([7], gym).get(7);
  const ahead = view.worldScene.athleteAhead(7);
  assert.ok(Math.abs(ahead) > 0.02, "the body lies off the spot");
  closeVec(view.sideCamera.position.toArray(), sideCameraPose(spot, ahead).eye, 1e-3);
});

test("riding has no side view", () => {
  const gym = testGym();
  const { view, engine } = gymView([gym]);
  view.workoutMode(gym, { reducedMotion: true, sideView: sideBox });
  view.rideMode();
  view.camera.update(100, 1, 0);
  view.render({ riders: [], myId: null, timeS: 12, colors });
  assert.deepEqual(engine.rects, [null]);
});

// --- golden lemons -------------------------------------------------------------

function lemonView() {
  const { view } = gymView([], "temperate");
  return { view, frames: recordFrames(view), me: { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 } };
}

test("lemons near my rider go to the frame, collected ones and other routes' never", () => {
  const { view, frames, me } = lemonView();
  const lemons = [
    { id: "a", distance: 50, lane: 0, collected: false },
    { id: "b", distance: 60, lane: 0, collected: true },
  ];
  const mine = { ...me, distance: 0 };
  view.setLemons(lemons);
  view.render({ riders: [mine], myId: 1, timeS: 3, colors });
  assert.equal(frames.at(-1).lemons.length, 1);
  view.render({ riders: [{ ...mine, route: "somewhere-else" }], myId: 1, timeS: 3, colors });
  assert.equal(frames.at(-1).lemons.length, 0);
  lemons[0].collected = true;
  view.render({ riders: [mine], myId: 1, timeS: 3, colors });
  assert.equal(frames.at(-1).lemons.length, 0);
});

test("a lemon ahead of my rider floats over its lane at handlebar height", () => {
  const { view, frames, me } = lemonView();
  view.setLemons([{ id: "a", distance: 130, lane: 2, collected: false }]);
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  const [lemon] = frames.at(-1).lemons;
  const road = riderPosition(squareRoute(), 130, 2).position;
  close(lemon.position[0], road[0], 0.01);
  close(lemon.position[2], road[2], 0.01);
  assert.ok(lemon.position[1] > road[1] + 0.9 && lemon.position[1] < road[1] + 1.6, "about handlebar height over the road");
});

test("far-off lemons are not in the frame", () => {
  const { view, frames, me } = lemonView();
  view.setLemons([{ id: "b", distance: 700, lane: 2, collected: false }]);
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  assert.equal(frames.at(-1).lemons.length, 0);
});

test("without lemons none are in the frame", () => {
  const { view, frames, me } = lemonView();
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  assert.equal(frames.at(-1).lemons.length, 0);
});

// --- ghost lap -------------------------------------------------------------------

/** Records what the view hands the world scene each frame, then runs the real update. */
function recordFrames(view) {
  const frames = [];
  const update = view.worldScene.update;
  view.worldScene.update = (frame) => {
    frames.push(frame);
    return update(frame);
  };
  return frames;
}

test("my best lap's ghost goes to the world scene as a see-through rider", () => {
  const { view } = gymView([], "temperate");
  const frames = recordFrames(view);
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  const ghost = { id: -1, name: "Best lap", distance: 200, lane: 2, speed: 8, power: 0, ghost: true };
  // 100 m ahead: past label range, so no DOM is needed.
  view.render({ riders: [me, ghost], myId: 1, timeS: 3, colors });
  const entry = frames.at(-1).riders.find((r) => r.id === -1);
  assert.equal(entry.ghost, true);
  closeVec(entry.position, bikeOnRoad(squareRoute(), 200, 2).position);
  assert.equal(frames.at(-1).riders.find((r) => r.id === 1).ghost, false);
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

/** A view whose crowd is `people` (the square route's first side runs along x, the road's centre at z = 0), recording its frames. */
function crowdView(people, biome = "temperate") {
  const { view } = gymView([], biome);
  const base = { yaw: 0, shirt: [1, 0, 0], armsUp: false, motion: "jump", phase: 0, scale: 1, rank: 0, flag: null };
  view.crowd.people = people.map((person) => ({ ...base, position: [112, 100, 8], ...person }));
  return { view, frames: recordFrames(view) };
}
const rider = (id, extra = {}) => ({ id, name: `R${id}`, distance: 400 + id * 10, lane: 1, speed: 8, power: 200, ...extra });
const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };

test("a lining spectator comes out once enough riders are online", () => {
  const friends = [2, 3, 4, 5, 6].map((id) => rider(id));
  const alone = crowdView([{ rank: 0.7 }]);
  alone.view.render({ riders: [me], myId: 1, timeS: 3, colors });
  assert.equal(alone.frames.at(-1).crowd.length, 0, "not out for one rider");
  const busy = crowdView([{ rank: 0.7 }]);
  busy.view.render({ riders: [me, ...friends], myId: 1, timeS: 3, colors });
  assert.equal(busy.frames.at(-1).crowd.length, 1, "out for six");
});

test("bots don't bring out the crowd", () => {
  const bots = [2, 3, 4, 5, 6].map((id) => rider(id, { is_bot: true }));
  const { view, frames } = crowdView([{ rank: 0.7 }]);
  view.render({ riders: [me, ...bots], myId: 1, timeS: 3, colors });
  assert.equal(frames.at(-1).crowd.length, 0);
});

test("the crowd thins out when I ride alone and keeps clear of the camera", () => {
  // A ring of lining spectators round the eye, at every rank, from point blank to 100 m.
  const ring = (eye) => Array.from({ length: 40 }, (_, i) => ({ rank: (i % 10) / 10, position: [eye[0] + (i % 4) * 1.2 + (i % 5) * 20, 100, eye[2] + i * 0.5] }));
  const { view, frames } = crowdView([]);
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  const eye = view.camera.eye;
  view.crowd.people = ring(eye).map((person) => ({ yaw: 0, shirt: [1, 0, 0], armsUp: false, motion: "jump", phase: 0, scale: 1, flag: null, ...person }));
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  const alone = frames.at(-1).crowd;
  view.render({ riders: [me, ...Array.from({ length: 9 }, (_, i) => rider(i + 2))], myId: 1, timeS: 3, colors });
  const busy = frames.at(-1).crowd;
  assert.ok(alone.length > 0 && alone.length < busy.length, `${alone.length} alone, ${busy.length} with ten`);
  for (const entry of busy) {
    const at = view.crowd.people[entry.index].position;
    assert.ok(Math.hypot(at[0] - eye[0], at[2] - eye[2]) > 4, "none within the near-camera cut");
  }
});

test("a flag waver's entry carries the swing and a rider nearby makes the crowd hop", () => {
  const { view, frames } = crowdView([{ flag: [0.1, 0.2, 0.9], phase: 0.5 }]);
  view.render({ riders: [me], myId: 1, timeS: 3, colors });
  const [entry] = frames.at(-1).crowd;
  assert.equal(entry.index, 0);
  assert.ok(Math.abs(entry.flagSwing - Math.sin(3 * 2.6 + 0.5) * 0.5) < 1e-9);
  assert.equal(typeof entry.pose, "boolean");
  assert.ok(entry.lift >= 0);
});

// --- bot kits (#64) ------------------------------------------------------------------

test("a bot rides in its team's kit; one without a known team in the bot colour", () => {
  const { view } = gymView([], "temperate");
  const frames = recordFrames(view);
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  // Past label range, so no DOM is needed.
  const teamed = { id: 41, name: "Gus Tailwind", is_bot: true, team: "moos", distance: 200, lane: 0, speed: 8, power: 150 };
  const plain = { id: 42, name: "Sally Sprocket", is_bot: true, distance: 205, lane: 3, speed: 8, power: 150 };
  view.render({ riders: [me, teamed, plain], myId: 1, timeS: 3, colors });
  // The layer takes linear colours; the colour code is in sRGB.
  const srgb = (rider) => frames.at(-1).riders.find((r) => r.id === rider.id).tint.map((c) => Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255));
  assert.deepEqual(srgb(teamed), [0x4f, 0x8f, 0x3a]);
  assert.deepEqual(srgb(plain), [0, 0, 255]);
});

test("road riders reach the world scene", () => {
  const { view } = gymView([], "temperate");
  const frames = recordFrames(view);
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  const human = { id: 2, name: "Ann", distance: 300, lane: 2, speed: 6, power: 100 };
  const bot = { id: 3, name: "Bo", is_bot: true, distance: 310, lane: 0, speed: 7, power: 0 };
  view.render({ riders: [me, human, bot], myId: 1, myCadence: 77, timeS: 3, colors });
  const riders = frames.at(-1).riders;
  assert.equal(riders.length, 3);
  assert.deepEqual(riders.map((r) => [r.id, r.me, r.ghost]), [[1, true, false], [2, false, false], [3, false, false]]);
  assert.deepEqual(riders.map((r) => r.tint), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  assert.deepEqual(riders.map((r) => r.cadence), [77, 85, 0]);
  assert.deepEqual(riders.map((r) => r.speed), [8, 6, 7]);
  const first = bikeOnRoad(squareRoute(), 100, 1);
  closeVec(riders[0].position, first.position);
  closeVec(riders[0].forward, first.forward);
  assert.equal(riders[0].grade, squareRoute().gradeAt(100));
});

/** Two riders on a tandem, me in the captain's seat. */
const onTandem = [
  { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200, vehicle: { id: 5, kind: "tandem", seat: 0, seats: 2, captain: true } },
  { id: 2, name: "Ann", distance: 100, lane: 1, speed: 8, power: 100, vehicle: { id: 5, kind: "tandem", seat: 1, seats: 2 } },
];

test("a vehicle reaches the rider layer, with me on it once", (t) => {
  const { view } = gymView([], "temperate");
  view.labelLayer = labelDom(t).layer;
  const frames = recordFrames(view);
  view.render({ riders: onTandem, myId: 1, myCadence: 70, timeS: 3, colors });
  const frame = frames.at(-1);
  assert.deepEqual(frame.riders, [], "nobody is also drawn on the road");
  assert.equal(frame.vehicles.length, 1);
  const [vehicle] = frame.vehicles;
  assert.deepEqual([vehicle.id, vehicle.kind, vehicle.speed], [5, "tandem", 8]);
  assert.equal(vehicle.layout.seats.length, 2);
  assert.deepEqual(vehicle.seats.map((seat) => [seat.id, seat.me]), [[1, true], [2, false]]);
  assert.deepEqual(vehicle.seats[0].tint, [1, 0, 0]);
  assert.equal(vehicle.seats[0].cadence, 70);
  const first = bikeOnRoad(squareRoute(), 100, 1);
  closeVec(vehicle.position, first.position);
  closeVec(vehicle.forward, first.forward);
});

test("a beer bike with empty seats sends null for them", (t) => {
  const { view } = gymView([]);
  view.labelLayer = labelDom(t).layer;
  const frames = recordFrames(view);
  const seat = (id, at) => ({ id, name: `R${id}`, distance: 100, lane: 1, speed: 6, power: 50, vehicle: { id: 9, kind: "beer_bike", seat: at, seats: 7, captain: at === 0 } });
  view.render({ riders: [seat(1, 0), seat(2, 2), seat(3, 5)], myId: 1, timeS: 3, colors });
  const [vehicle] = frames.at(-1).vehicles;
  assert.deepEqual(vehicle.seats.map((s) => s?.id ?? null), [1, null, 2, null, null, 3, null]);
});

test("seated riders' labels sit above their heads", (t) => {
  const { layer, labels } = labelDom(t);
  const { view } = gymView([]);
  view.labelLayer = layer;
  view.render({ riders: onTandem, myId: 1, timeS: 3, colors });
  const head = view.worldScene.seatHeads().get(2);
  assert.ok(head, "the layer reports the stoker's head");
  const viewProjection = multiply(perspective((58 * Math.PI) / 180, 320 / 200, RIDE_LENS.near, RIDE_LENS.far), lookAt(view.camera.eye, view.camera.target));
  const at = projectToScreen(viewProjection, head, 320, 200);
  assert.equal(labels.length, 1);
  assert.ok(labels[0].style.transform.startsWith(`translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`), labels[0].style.transform);
});

/** A bare stand-in for the DOM a label is made of. */
function labelDom(t) {
  const labels = [];
  const element = () => ({ style: {}, classList: { toggle() {} }, hidden: false, append() {}, remove() {}, querySelector: () => null, getBoundingClientRect: () => ({ width: 40, height: 16 }) });
  const saved = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => (globalThis.document = saved));
  return { layer: { append: (el) => labels.push(el) }, labels };
}

test("a label behind a house is hidden once its rider has been out of sight a moment", (t) => {
  const { layer, labels } = labelDom(t);
  const { view } = gymView([]);
  view.labelLayer = layer;
  const me = { id: 1, name: "Me", distance: 100, lane: 1, speed: 8, power: 200 };
  const other = { id: 2, name: "Ann", distance: 125, lane: 1, speed: 8, power: 100 };
  view.render({ riders: [me, other], myId: 1, timeS: 3, colors });
  assert.equal(labels.length, 1);
  assert.equal(labels[0].hidden, false, "in sight on the open road");
  const head = [...riderPosition(squareRoute(), 125, 1).position];
  const eye = view.camera.eye;
  view.sight.boxes = [{ x: (eye[0] + head[0]) / 2, z: (eye[2] + head[2]) / 2, halfX: 6, halfZ: 6, yaw: 0, top: head[1] + 40 }];
  view.render({ riders: [me, other], myId: 1, timeS: 3.05, colors });
  assert.equal(labels[0].hidden, false, "not at once");
  view.render({ riders: [me, other], myId: 1, timeS: 4, colors });
  assert.equal(labels[0].hidden, true);
});

test("a world without a studio site has no studio and ignores studio riders", () => {
  const { view } = gymView([]);
  const frames = recordFrames(view);
  view.camera.update(100, 1, 0);
  view.render({ riders: [{ id: 9, route: null, studio: { room: 0, seat: 0 }, power: 100, cadence: 80 }], myId: null, timeS: 1, colors });
  assert.equal(view.studioSite, null);
  assert.equal(frames.at(-1).riders.length, 0, "a studio rider adds nothing without a studio");
  assert.equal(frames.at(-1).studio, undefined);
});

const studioSite = { position: [100, 100, 80], yaw: 0 };
const studioRider = (id, seat, extra = {}) => ({ id, route: null, studio: { room: 0, seat }, power: 100, cadence: 80, ...extra });
/** A camera that stays where it is, standing in for the studio camera (which needs my seat). */
const fixedCamera = (eye, mode = "seat") => ({ eye, target: [eye[0], eye[1], eye[2] - 10], mode, update() {}, setMode() {} });

test("studio riders ride the rider layer, with a coach on the open floor", () => {
  const { view } = gymView([], "temperate", studioSite);
  const frames = recordFrames(view);
  view.camera.update(100, 1, 0);
  view.render({ riders: [studioRider(5, 3)], myId: null, timeS: 1, colors });
  const frame = frames.at(-1);
  const seated = frame.riders.find((r) => r.id === 5);
  closeVec(seated.position, seatWorld(studioSite, 0, 3).position);
  assert.equal(seated.cadence, 80);
  assert.equal(seated.hideBody ?? false, false);
  const coach = frame.riders.find((r) => r.id === coachId(0));
  assert.ok(coach, "the coach of floor 0");
  assert.equal(coach.lookId, INSTRUCTOR.id);
  closeVec(coach.position, coachWorld(studioSite, 0).position);
  assert.deepEqual(frame.studio, { floors: 2, open: 1 });
  assert.deepEqual(coach.tint, linear(hexRgb(COACH_KIT)), "lemon yellow, whatever the colours");
  view.render({ riders: [studioRider(5, 3)], myId: null, timeS: 1.1, colors: { ...colors, accent: "#ff7a1a" } });
  assert.deepEqual(frames.at(-1).riders.find((r) => r.id === coachId(0)).tint, linear(hexRgb("#f5d000")), "not the theme's accent");
});

test("a rider above the studio's rooms grows the building and lights the floor", () => {
  const { view } = gymView([], "temperate", studioSite);
  const frames = recordFrames(view);
  view.setStudioRooms(1);
  view.camera.update(100, 1, 0);
  view.render({ riders: [studioRider(5, 0, { studio: { room: 2, seat: 0 } })], myId: null, timeS: 1, colors });
  assert.deepEqual(frames.at(-1).studio, { floors: 3, open: 3 });
  assert.equal(frames.at(-1).riders.filter((r) => isCoach(r.id)).length, 3, "a coach per open floor, each its own id");
});

test("my body is hidden in my own point of view, my bike stays", () => {
  const { view } = gymView([], "temperate", studioSite);
  const frames = recordFrames(view);
  const me = studioRider(9, 3);
  const mine = (mode) => {
    view.camera = new StudioCamera(studioSite, 0, 3, mode);
    view.render({ riders: [me], myId: 9, myCadence: 80, timeS: 1, colors });
    return frames.at(-1).riders.find((r) => r.id === 9);
  };
  assert.equal(mine("pov").hideBody, true);
  assert.equal(mine("seat").hideBody ?? false, false);
});

test("riders next to the studio camera are left out, the coach and I never", () => {
  const { view } = gymView([], "temperate", studioSite);
  const frames = recordFrames(view);
  const at = seatWorld(studioSite, 0, 3).position;
  view.camera = fixedCamera([at[0], at[1] + 1.5, at[2]]);
  view.render({ riders: [studioRider(10, 3), studioRider(11, 0), studioRider(12, 3)], myId: 12, timeS: 1, colors });
  const ids = frames.at(-1).riders.map((r) => r.id);
  assert.ok(!ids.includes(10), "right at the camera");
  assert.ok(ids.includes(11), "a seat away");
  assert.ok(ids.includes(12), "me, even at the camera");
  const coach = coachWorld(studioSite, 0).position;
  view.camera = fixedCamera([coach[0], coach[1] + 1.5, coach[2]]);
  view.render({ riders: [studioRider(11, 0)], myId: null, timeS: 1.1, colors });
  assert.ok(frames.at(-1).riders.some((r) => r.id === coachId(0)), "the coach stays in view");
});

test("a studio camera follows my seat in the studio, without a road rider of mine", () => {
  const { view } = gymView([], "temperate", studioSite);
  view.camera = new StudioCamera(studioSite, 0, 0, "seat");
  const before = [...view.camera.eye];
  view.render({ riders: [{ id: 9, route: null, studio: { room: 1, seat: 7 }, power: 100 }], myId: 9, timeS: 1, colors });
  assert.ok(view.camera.eye[1] > before[1] + 4, "moved up a floor");
});

test("the view draws without any adapter", () => {
  const { view, engine } = gymView([]);
  view.camera.update(100, 1, 0);
  view.render({ riders: [], myId: null, timeS: 12, colors });
  assert.equal(view.renderer, undefined);
  assert.equal(engine.presented.length, 1);
});

test("the world camera is the view's camera", () => {
  const { view, engine } = gymView([]);
  view.camera.update(100, 1, 0);
  view.render({ riders: [], myId: null, timeS: 12, colors });
  closeVec(engine.scenes[0].camera.position.toArray(), view.camera.eye, 1e-3);
});

test("every graphics level but low renders the shadow map", () => {
  const rendered = {};
  for (const level of ["low", "medium", "high", "ultra"]) {
    const { view } = gymView([]);
    const frames = recordFrames(view);
    view.camera.update(100, 1, 0);
    view.setQuality(level);
    view.render({ riders: [], myId: null, timeS: 12, colors });
    rendered[level] = frames.at(-1).shadows;
  }
  assert.deepEqual(rendered, { low: false, medium: true, high: true, ultra: true });
});

// --- the world scene and the engine (new world, part 1) ----------------------

/** A view over a world with real ground, logging its engine's calls. */
function worldView({ timeMode = "day", sideView = null } = {}) {
  const log = [];
  const engine = fakeEngine(log);
  const gym = testGym();
  const world = { biome: "temperate", season: "summer", ground: groundFixture(), chunks: { scenery: [], structures: [] }, crowd: { people: [], figure: "person" }, gyms: [gym] };
  const canvas = { clientWidth: 320, clientHeight: 200, getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 200 }) };
  const view = new View3D(canvas, null, squareRoute(), world, { engine });
  view.setTimeMode(timeMode);
  view.workoutMode(gym, { reducedMotion: true, sideView });
  const render = () => view.render({ riders: [workoutRider], myId: 7, timeS: 12, colors });
  return { view, engine, log, render };
}

test("a frame draws the world and presents last", () => {
  const { log, render } = worldView();
  render();
  assert.equal(log[0], "beginFrame");
  assert.equal(log[1], "renderScene");
  assert.equal(log.at(-1), "present");
});

test("the world is the Three.js scene of the view", () => {
  const { view, engine, render } = worldView();
  render();
  assert.equal(engine.scenes[0].scene, view.worldScene.scene);
  assert.ok(view.worldScene.scene.getObjectByName("terrain"));
});

test("night darkens the frame", () => {
  const night = worldView({ timeMode: "night" });
  night.render();
  assert.equal(night.engine.presented.at(-1).env.night, 1);
  const day = worldView();
  day.render();
  assert.equal(day.engine.presented.at(-1).env.night, 0);
});

test("a season change reaches the frame's environment", () => {
  const { view, engine, render } = worldView();
  view.setSeason("winter");
  render();
  assert.equal(engine.presented.at(-1).env.snow, 1);
});

test("view3d no longer draws the old terrain, sea or clouds", () => {
  const { view, render } = worldView();
  render();
  assert.equal(view.clouds, undefined);
  assert.equal(view.water, undefined);
});

test("disposing a view frees its world scene and does not touch the engine", () => {
  const { view, engine, render } = worldView();
  render();
  const before = engine.calls.length;
  view.dispose();
  assert.equal(view.worldScene.scene.children.length, 0);
  assert.equal(engine.calls.length, before);
});

test("a workout's side view draws the world into the inset first", () => {
  const side = { getBoundingClientRect: () => ({ left: 200, top: 100, width: 100, height: 80 }) };
  const { engine, log, render } = worldView({ sideView: side });
  render();
  assert.equal(engine.rects.filter(Boolean).length, 1, "one scissored world pass for the inset");
  assert.equal(log.at(-1), "present");
});

test("the quality reaches the engine and the world scene", () => {
  const { view, engine } = worldView();
  view.setQuality("low");
  assert.equal(engine.qualities.at(-1).shadowMapSize, 0);
  assert.equal(view.worldScene.sun.castShadow, false);
});

test("the view keeps no chunk list", () => {
  const { view } = gymView([]);
  view.render({ riders: [], myId: null, timeS: 1, colors });
  assert.equal("chunks" in view, false);
});

test("a view with a studio disposes without throwing", () => {
  const { view } = gymView([], "temperate", studioSite);
  assert.doesNotThrow(() => view.dispose());
});

test("only my road entry is classic, and only once the classic rider is on", (t) => {
  const element = () => ({ style: {}, classList: { toggle() {} }, append() {}, querySelector: () => null, getBoundingClientRect: () => ({ width: 40, height: 16 }) });
  const saved = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => (globalThis.document = saved));
  const { view } = gymView([]);
  view.labelLayer = { append() {} };
  const frames = recordFrames(view);
  const riders = [{ ...workoutRider, id: 7 }, { ...workoutRider, id: 8, distance: 110 }];
  view.render({ riders, myId: 7, timeS: 12, colors });
  assert.ok(frames.at(-1).riders.every((r) => !r.classic), "off by default");
  view.setClassicRider(true);
  view.render({ riders, myId: 7, timeS: 12.1, colors });
  const [mine, other] = [7, 8].map((id) => frames.at(-1).riders.find((r) => r.id === id));
  assert.equal(mine.classic, true);
  assert.ok(!other.classic, "the others keep the new look");
  view.setClassicRider(false);
  view.render({ riders, myId: 7, timeS: 12.2, colors });
  assert.ok(frames.at(-1).riders.every((r) => !r.classic));
});

test("my studio entry is classic when the classic rider is on, the coach never", () => {
  const { view } = gymView([], "temperate", studioSite);
  const frames = recordFrames(view);
  view.setClassicRider(true);
  view.camera = fixedCamera([100, 101.5, 90]);
  view.render({ riders: [studioRider(9, 3), studioRider(5, 4)], myId: 9, timeS: 1, colors });
  const entries = frames.at(-1).riders;
  assert.equal(entries.find((r) => r.id === 9).classic, true);
  assert.ok(!entries.find((r) => r.id === 5).classic);
  assert.ok(!entries.find((r) => r.id === coachId(0)).classic);
});
