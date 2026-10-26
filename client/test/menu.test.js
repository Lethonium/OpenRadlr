import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { coastOutline, islandOf, mapFrame } from "../public/js/view/mapPreview.js";
import { MenuStage } from "../public/js/view/menuStage.js";
import { HIGHLIGHT, buildHighlight, highlightColor } from "../public/js/view3d/highlight.js";
import { MENU_CAMERA, MenuCamera, groundAt, gymPose, orbitPose, routePose } from "../public/js/view3d/menuCamera.js";
import { roadFrame } from "../public/js/view3d/world.js";

const file = (id) => JSON.parse(readFileSync(new URL(`../../routes/${id}.json`, import.meta.url)));
const flats = new RouteGeometry(file("riverside-flats"));
const hills = new RouteGeometry(file("rolling-hills"));
const col = new RouteGeometry(file("col-de-la-forge"));

/** A flat overview: island of 2 km around the origin, ground at 30 m, a hill of 400 m at (500, 500). */
function overview() {
  const cell = 100;
  const columns = 61;
  const heights = new Float32Array(columns * columns).fill(30);
  const x0 = -3000;
  const z0 = -3000;
  heights[((500 - z0) / cell) * columns + (500 - x0) / cell] = 400;
  return { center: [0, 0], radius: 2000, sea: 0, grid: { x0, z0, cell, columns, rows: columns, heights } };
}

// --- camera ---------------------------------------------------------------------

test("ground height comes from the overview grid, bilinear and clamped at its edge", () => {
  const o = overview();
  assert.equal(groundAt(o, 0, 0), 30);
  assert.equal(groundAt(o, 500, 500), 400);
  assert.equal(groundAt(o, 550, 500), 215);
  assert.equal(groundAt(o, 99_999, 0), 30);
  assert.equal(groundAt({ sea: 0 }, 1, 2), 0);
});

test("the drone circles high above the island, looking at its centre", () => {
  const o = overview();
  for (const angle of [0, 1, 2, 4]) {
    const { eye, target } = orbitPose(o, angle);
    assert.ok(Math.abs(Math.hypot(eye[0], eye[2]) - o.radius * MENU_CAMERA.orbitDistance) < 1e-6);
    assert.ok(eye[1] > o.radius * 0.4);
    assert.deepEqual([target[0], target[2]], [0, 0]);
  }
});

test("a route view looks along the road from behind and above, clear of hills", () => {
  const o = overview();
  const { eye, target } = routePose(hills, 0, o);
  const ahead = roadFrame(hills, MENU_CAMERA.lookAhead).center;
  assert.deepEqual(target, ahead);
  assert.ok(eye[1] >= groundAt(o, eye[0], eye[2]) + MENU_CAMERA.clearance - 1e-6);
  assert.ok(eye[1] > roadFrame(hills, 0).center[1] + 100);
});

test("picking a route glides down to it, then follows the road", () => {
  const camera = new MenuCamera(overview());
  camera.update(0.016);
  const high = camera.eye[1];
  camera.showRoute(flats);
  assert.ok(camera.flying);
  camera.update(0.05);
  assert.ok(camera.eye[1] < high && camera.eye[1] > routePose(flats, 0, overview()).eye[1], "on the way down");
  for (let i = 0; i < 80; i += 1) camera.update(0.05);
  assert.ok(!camera.flying);
  const landed = routePose(flats, 0, overview());
  assert.ok(Math.hypot(...camera.eye.map((v, i) => v - landed.eye[i])) < 40, "arrived next to the start");
  const before = camera.target.slice();
  for (let i = 0; i < 20; i += 1) camera.update(0.1);
  assert.ok(Math.hypot(...camera.target.map((v, i) => v - before[i])) > 20, "rolls along the road");
  camera.showIsland();
  for (let i = 0; i < 80; i += 1) camera.update(0.05);
  assert.ok(camera.eye[1] > overview().radius * 0.4, "back up high");
});

test("with reduced motion the camera cuts and stands still", () => {
  const camera = new MenuCamera(overview(), { reducedMotion: true });
  camera.update(0.1);
  const island = camera.eye.slice();
  camera.update(5);
  assert.deepEqual(camera.eye, island, "no orbiting");
  camera.showRoute(col);
  assert.ok(!camera.flying);
  camera.update(0.1);
  const still = camera.eye.slice();
  assert.deepEqual(still, routePose(col, 0, overview()).eye, "cut straight to the route");
  camera.update(1);
  assert.deepEqual(camera.eye, still, "and stays there");
});

const GYM = { center: [400, 30, -200], yaw: 0.7, spots: [] };
const flatDistance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test("the gym orbit circles the gym close up and comes round to where it began", () => {
  const o = overview();
  const poses = [0, 1, 2, 3, 4, 5].map((k) => gymPose(GYM, o, k));
  for (const { eye, target } of poses) {
    assert.ok(Math.abs(flatDistance(eye, GYM.center) - MENU_CAMERA.gymDistance) < 1e-6, "same distance all round");
    assert.ok(eye[1] - GYM.center[1] >= MENU_CAMERA.gymHeight - 1e-6, "above the gym");
    assert.ok(flatDistance(target, GYM.center) < 1e-6, "looking at it");
  }
  const loop = gymPose(GYM, o, 2 * Math.PI);
  for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(loop.eye[k] - poses[0].eye[k]) < 1e-6, "loops seamlessly");
});

test("picking the workout glides down to the gym and circles it", () => {
  const camera = new MenuCamera(overview());
  camera.update(0.016);
  camera.showGym(GYM);
  assert.equal(camera.view, "gym");
  let previous = camera.eye.slice();
  let arrival = null;
  for (let i = 0; i < 120; i += 1) {
    const wasFlying = camera.flying;
    camera.update(0.05);
    if (wasFlying && !camera.flying) arrival = Math.hypot(...camera.eye.map((v, k) => v - previous[k]));
    previous = camera.eye.slice();
  }
  assert.ok(!camera.flying);
  assert.ok(Math.abs(flatDistance(camera.eye, GYM.center) - MENU_CAMERA.gymDistance) < 1e-6, "on the orbit");
  assert.ok(arrival < 2, `lands without a jump (${arrival.toFixed(1)} m in the last frame)`);
  const before = camera.eye.slice();
  for (let i = 0; i < 20; i += 1) camera.update(0.1);
  assert.ok(flatDistance(camera.eye, before) > 2, "keeps circling");
  assert.ok(Math.abs(flatDistance(camera.eye, GYM.center) - MENU_CAMERA.gymDistance) < 1e-6);
});

test("leaving the gym climbs away smoothly, without a jump up", () => {
  for (const leave of [(camera) => camera.showIsland(), (camera) => camera.showRoute(flats)]) {
    const camera = new MenuCamera(overview());
    camera.showGym(GYM);
    for (let i = 0; i < 120; i += 1) camera.update(0.05);
    const before = camera.eye.slice();
    leave(camera);
    camera.update(0.016);
    const step = Math.hypot(...camera.eye.map((v, k) => v - before[k]));
    assert.ok(step < 2, `${step.toFixed(1)} m in the first frame`);
  }
});

test("with reduced motion the gym view is a still", () => {
  const camera = new MenuCamera(overview(), { reducedMotion: true });
  camera.showGym(GYM);
  assert.ok(!camera.flying);
  camera.update(0.1);
  const still = camera.eye.slice();
  camera.update(3);
  assert.deepEqual(camera.eye, still);
});

// --- highlight -------------------------------------------------------------------

test("the highlight shows climbs and sprints from the markers", () => {
  const climb = col.markers.find((m) => m.type === "climb");
  const sprint = col.markers.find((m) => m.type === "sprint");
  assert.deepEqual(highlightColor(col, climb.distance + 10), HIGHLIGHT.climb);
  assert.deepEqual(highlightColor(col, sprint.distance + 10), HIGHLIGHT.sprint);
  assert.deepEqual(highlightColor(col, climb.distance - 50), HIGHLIGHT.route);
});

test("the highlight band lies just above the road and faces up, with a beacon at the start", () => {
  const band = buildHighlight(hills, { lift: 0.35, beacon: 0 });
  for (let v = 0; v < band.vertexCount; v += 97) {
    assert.ok(band.normals[v * 3 + 1] > 0.5, "faces up");
  }
  const withBeacon = buildHighlight(hills);
  let top = -Infinity;
  for (let v = 0; v < withBeacon.vertexCount; v += 1) top = Math.max(top, withBeacon.positions[v * 3 + 1]);
  assert.ok(top > roadFrame(hills, 0).center[1] + 50, "beacon stands high over the start");
  const plain = buildHighlight(hills, { color: HIGHLIGHT.other, beacon: 0 });
  assert.equal(plain.vertexCount, band.vertexCount);
});

// --- map preview -------------------------------------------------------------------

test("the 2D map's island matches the 3D one and holds every road", () => {
  const island = islandOf([flats, hills, col]);
  for (const route of [flats, hills, col]) {
    for (let d = 0; d < route.length; d += 50) {
      const { x, y } = route.positionAt(d);
      assert.ok(island.inland(x, -y) > 300);
    }
  }
  assert.equal(islandOf([]), null);
  assert.equal(coastOutline(island, 36).length, 36);
});

test("the map fits its points into the canvas, north up, without distortion", () => {
  const frame = mapFrame(
    [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ],
    220,
    220,
    10,
  );
  assert.deepEqual(frame.toScreen(0, 0), [10, 60]);
  assert.deepEqual(frame.toScreen(100, 50), [210, 160]);
  assert.equal(frame.scale, 2);
});

// --- stage -------------------------------------------------------------------------

const listed = [
  { id: "riverside-flats", name: "Riverside Flats" },
  { id: "rolling-hills", name: "Rolling Hills" },
  { id: "col-de-la-forge", name: "Col de la Forge" },
  { id: "spin-studio", name: "Spin Studio", kind: "studio" },
];

/** A stage with fake views, builds and timers; `builds` resolve by hand. */
function fakeStage({ use3d = true } = {}) {
  const log = { routes: [], world: [], builds: [], views: [], frames: 0, timers: [] };
  const stage = new MenuStage({
    fetchRouteFile: async (id) => file(id),
    buildScene: use3d
      ? (routeFile, others) =>
          new Promise((resolve) => log.builds.push({ id: routeFile.id, others: others.map((o) => o.id), resolve: () => resolve({ overview: overview(), id: routeFile.id }) }))
      : null,
    createView: use3d
      ? (route, scene) => {
          const view = { route, scene, highlights: [], disposed: false, setHighlights: (bands) => (view.highlights = bands), dispose: () => (view.disposed = true), render: () => {} };
          log.views.push(view);
          return view;
        }
      : null,
    createCamera: (o) => new MenuCamera(o),
    highlights: (route, others) => [{ route: route.id }, ...others.map((o) => ({ other: o.id }))],
    onRoute: ({ route, routes }) => log.routes.push({ route: route?.id ?? null, routes: routes.map((r) => r.id) }),
    onWorld: (ready) => log.world.push(ready),
    render: () => (log.frames += 1),
    requestFrame: () => 1,
    cancelFrame: () => {},
    setTimer: (callback) => log.timers.push(callback) && log.timers.length,
    clearTimer: () => {},
  });
  return { stage, log };
}

/** A gym 40 m from the start of `route`. */
const gymAt = (route) => {
  const start = roadFrame(route, 0).center;
  return { center: [start[0] + 40, start[1], start[2]], yaw: 0, spots: [] };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("the stage shows the pick at once and builds its world in the background", async () => {
  const { stage, log } = fakeStage();
  await stage.select(listed, "rolling-hills");
  assert.deepEqual(log.routes.at(-1), { route: "rolling-hills", routes: ["rolling-hills", "riverside-flats", "col-de-la-forge"] });
  assert.equal(log.builds.length, 1);
  assert.deepEqual(log.builds[0].others.sort(), ["col-de-la-forge", "riverside-flats"]);
  assert.deepEqual(log.world, [], "not on screen before it is built");
  log.builds[0].resolve();
  await settle();
  assert.deepEqual(log.world, [true]);
  assert.equal(stage.viewRouteId, "rolling-hills");
  assert.equal(log.views[0].highlights[0].route, "rolling-hills");
  assert.ok(log.views[0].camera instanceof MenuCamera);
  // Same pick on the next menu refresh: nothing new.
  await stage.select(listed, "rolling-hills");
  assert.equal(log.builds.length, 1);
});

test("another pick is highlighted right away and its world rebuilt once the pick settles", async () => {
  const { stage, log } = fakeStage();
  await stage.select(listed, "rolling-hills");
  log.builds[0].resolve();
  await settle();
  await stage.select(listed, "col-de-la-forge");
  assert.equal(log.views[0].highlights[0].route, "col-de-la-forge", "highlighted on the world already there");
  assert.equal(log.builds.length, 1, "the rebuild waits");
  await stage.select(listed, "riverside-flats");
  log.timers.at(-2)(); // the timer for the col: no longer picked
  log.timers.at(-1)();
  assert.deepEqual(
    log.builds.map((b) => b.id),
    ["rolling-hills", "riverside-flats"],
  );
  log.builds[1].resolve();
  await settle();
  assert.ok(log.views[0].disposed, "the old world is released");
  assert.equal(stage.viewRouteId, "riverside-flats");
  assert.equal(log.views[1].camera, log.views[0].camera, "the camera flies on");
});

test("joining takes the view over only when it was built for the joined route", async () => {
  const { stage, log } = fakeStage();
  await stage.select(listed, "rolling-hills");
  log.builds[0].resolve();
  await settle();
  const view = stage.takeView("rolling-hills");
  assert.equal(view, log.views[0]);
  assert.deepEqual(view.highlights, [], "nothing highlighted any more");
  assert.ok(!view.disposed);

  const other = fakeStage();
  await other.stage.select(listed, "rolling-hills");
  other.log.builds[0].resolve();
  await settle();
  assert.equal(other.stage.takeView("col-de-la-forge"), null);
  assert.ok(other.log.views[0].disposed);
});

test("joining pauses the drone view; a failed join resumes it", async () => {
  const { stage, log } = fakeStage();
  let frames = 0;
  let cancelled = 0;
  stage.deps.requestFrame = () => ++frames;
  stage.deps.cancelFrame = () => (cancelled += 1);
  await stage.select(listed, "rolling-hills");
  log.builds[0].resolve();
  await settle();
  assert.equal(frames, 1, "drawing");
  stage.pause();
  assert.equal(cancelled, 1);
  stage.resume();
  assert.equal(frames, 2, "drawing again");
});

test("the studio keeps the island circling, without a highlight or profile", async () => {
  const { stage, log } = fakeStage();
  await stage.select(listed, "spin-studio");
  await settle();
  assert.equal(log.routes.at(-1).route, null);
  assert.equal(log.builds[0].id, "riverside-flats", "the island of the first route");
  log.builds[0].resolve();
  await settle();
  assert.deepEqual(log.views[0].highlights, []);
  assert.equal(log.views[0].camera.view, "island");
});

test("the stage uses the gym's lens while the camera circles the gym", async () => {
  const { stage, log } = fakeStage();
  const withWorkout = [...listed, { id: "workout", name: "Workout", kind: "workout" }];
  let frame = null;
  stage.deps.requestFrame = (callback) => {
    frame = callback;
    return 1;
  };
  const island = { near: 20 };
  const gym = { near: 2 };
  stage.deps.lensFor = (kind) => (kind === "gym" ? gym : island);
  stage.deps.buildScene = (routeFile) =>
    new Promise((resolve) => log.builds.push({ id: routeFile.id, resolve: () => resolve({ overview: overview(), gyms: [gymAt(flats)] }) }));

  await stage.select(withWorkout, "workout");
  await settle();
  log.builds[0].resolve();
  await settle();
  const view = log.views[0];
  assert.equal(view.lens, gym, "the low gym orbit gets the near plane it needs");
  // A tick keeps it; switching back to a route's world moves to the drone lens.
  frame(16);
  assert.equal(view.lens, gym);
  await stage.select(withWorkout, "riverside-flats");
  frame(32);
  assert.equal(view.lens, island, "the drone view keeps its far-field precision");
});

test("the workout card circles the gym at the default route's start", async () => {
  const { stage, log } = fakeStage();
  const withWorkout = [...listed, { id: "workout", name: "Workout", kind: "workout" }];
  stage.deps.buildScene = (routeFile) =>
    new Promise((resolve) => log.builds.push({ id: routeFile.id, resolve: () => resolve({ overview: overview(), gyms: [gymAt(flats)] }) }));
  await stage.select(withWorkout, "workout");
  await settle();
  assert.equal(log.routes.at(-1).route, null, "no route profile");
  assert.equal(log.builds[0].id, "riverside-flats", "the world of the default route");
  log.builds[0].resolve();
  await settle();
  assert.deepEqual(log.views[0].highlights, []);
  assert.equal(log.views[0].camera.view, "gym");
  // Back to a route and to the workout again, on the world already there.
  await stage.select(withWorkout, "riverside-flats");
  assert.equal(log.views[0].camera.view, "route");
  await stage.select(withWorkout, "workout");
  assert.equal(log.views[0].camera.view, "gym");
  assert.deepEqual(log.views[0].highlights, []);
});

test("the workout card circles the default route's gym on a world of its map, without a rebuild", async () => {
  const { stage, log } = fakeStage();
  const withWorkout = [...listed, { id: "workout", name: "Workout", kind: "workout" }];
  const flatsGym = gymAt(flats);
  // The map's world holds every café's gym.
  stage.deps.buildScene = (routeFile) => new Promise((resolve) => log.builds.push({ id: routeFile.id, resolve: () => resolve({ overview: overview(), gyms: [gymAt(col), flatsGym] }) }));
  await stage.select(withWorkout, "col-de-la-forge");
  log.builds[0].resolve();
  await settle();
  await stage.select(withWorkout, "workout");
  assert.equal(log.views[0].camera.view, "gym");
  for (let i = 0; i < 120; i += 1) log.views[0].camera.update(0.05);
  assert.deepEqual([log.views[0].camera.target[0], log.views[0].camera.target[2]], [flatsGym.center[0], flatsGym.center[2]], "at the default route's gym");
  assert.deepEqual(log.views[0].highlights, []);
  assert.equal(log.timers.length, 0, "no rebuild");
  assert.equal(log.builds.length, 1);
});

test("the workout card builds the default route's world when the one on screen lacks its gym", async () => {
  const { stage, log } = fakeStage();
  const withWorkout = [...listed, { id: "workout", name: "Workout", kind: "workout" }];
  // The col's world here has no gym (as if its café had no room for one).
  stage.deps.buildScene = (routeFile) =>
    new Promise((resolve) => log.builds.push({ id: routeFile.id, resolve: () => resolve({ overview: overview(), gyms: routeFile.id === "riverside-flats" ? [gymAt(flats)] : [] }) }));
  await stage.select(withWorkout, "col-de-la-forge");
  log.builds[0].resolve();
  await settle();
  await stage.select(withWorkout, "workout");
  assert.equal(log.views[0].camera.view, "island", "the island meanwhile");
  log.timers.at(-1)();
  assert.equal(log.builds.at(-1).id, "riverside-flats", "rebuilt for the default route");
  log.builds.at(-1).resolve();
  await settle();
  assert.equal(stage.viewRouteId, "riverside-flats");
  assert.equal(log.views.at(-1).camera.view, "gym");
});

test("without 3D the stage still shows the map and profile", async () => {
  const { stage, log } = fakeStage({ use3d: false });
  await stage.select(listed, "col-de-la-forge");
  assert.equal(log.routes.at(-1).route, "col-de-la-forge");
  assert.equal(log.builds.length, 0);
  assert.equal(stage.takeView("col-de-la-forge"), null);
});

test("the stage fetches the map's network once and builds the world on it", async () => {
  const networkFile = { id: "valley", edges: [] };
  const fetched = [];
  const builds = [];
  const routes = [];
  const stage = new MenuStage({
    fetchRouteFile: async (id) => file(id),
    fetchNetwork: async (id) => {
      fetched.push(id);
      return networkFile;
    },
    buildScene: (routeFile, others, options) => {
      builds.push({ id: routeFile.id, network: options?.network ?? null });
      return new Promise(() => {});
    },
    createView: () => ({}),
    createCamera: (o) => new MenuCamera(o),
    onRoute: (picked) => routes.push(picked),
    requestFrame: () => 1,
    cancelFrame: () => {},
    setTimer: () => 1,
    clearTimer: () => {},
  });
  await stage.select(listed, "rolling-hills");
  await stage.select(listed, "col-de-la-forge");
  assert.equal(builds[0].network, networkFile, "the world is built on the network");
  assert.equal(routes.at(-1).network, networkFile, "the map shows the network too");
  assert.deepEqual(fetched, ["valley"], "once per map");
});
