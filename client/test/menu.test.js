import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { coastOutline, islandOf, mapFrame } from "../public/js/view/mapPreview.js";
import { MenuStage } from "../public/js/view/menuStage.js";
import { HIGHLIGHT, HIGHLIGHT_LIFT, buildHighlight, highlightColor } from "../public/js/view3d/highlight.js";
import { DRONE_LENS, depthStep } from "../public/js/view3d/view3d.js";
import { MENU_CAMERA, MenuCamera, groundAt, gymPose, orbitPose, routePose, statuePose } from "../public/js/view3d/menuCamera.js";
import { roadFrame } from "../public/js/view3d/world.js";
import { PRESETS } from "../public/js/workout/presets.js";

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

/**
 * How abruptly the camera moves: the largest frame-to-frame change of the eye's
 * per-frame velocity change (m/s) over `seconds` at 60 fps. Smooth acceleration,
 * even a strong one, stays near zero; a snap or a jolt shows as a spike.
 */
function roughness(camera, seconds) {
  const dt = 1 / 60;
  let previous = camera.eye.slice();
  let velocity = null;
  let change = null;
  let worst = 0;
  for (let i = 0; i < seconds * 60; i += 1) {
    camera.update(dt);
    const v = camera.eye.map((x, k) => (x - previous[k]) / dt);
    if (velocity) {
      const dv = v.map((x, k) => x - velocity[k]);
      if (change) worst = Math.max(worst, Math.hypot(...dv.map((x, k) => x - change[k])));
      change = dv;
    }
    velocity = v;
    previous = camera.eye.slice();
  }
  return worst;
}

test("following the road takes bends in smooth arcs, not snaps", () => {
  const camera = new MenuCamera(overview());
  camera.showRoute(col);
  for (let i = 0; i < 100; i += 1) camera.update(0.05);
  assert.ok(!camera.flying);
  // The col's hairpins: placed straight from the road, the eye snaps round them.
  const worst = roughness(camera, 90);
  assert.ok(worst < 2, `a jolt of ${worst.toFixed(2)} m/s`);
});

test("a flight leaves at the speed the camera had and lands at the speed of the new shot", () => {
  const camera = new MenuCamera(overview());
  for (let i = 0; i < 30; i += 1) camera.update(1 / 60);
  camera.showRoute(flats);
  // From the circling drone, through the glide, onto the road: no jolt anywhere.
  const worst = roughness(camera, 8);
  assert.ok(worst < 2, `a jolt of ${worst.toFixed(2)} m/s`);
});

test("the opening: the camera starts high and wide over the island and descends onto the picked route", () => {
  const o = overview();
  const camera = new MenuCamera(o, { intro: true });
  assert.equal(camera.view, "intro");
  assert.ok(camera.eye[1] > orbitPose(o, 0).eye[1] * 1.5, "well above the usual orbit");
  camera.showRoute(flats);
  const worst = roughness(camera, MENU_CAMERA.introS + 1);
  assert.ok(worst < 2, `a jolt of ${worst.toFixed(2)} m/s`);
  assert.ok(!camera.flying, "arrived");
  assert.equal(camera.view, "route");
});

test("the opening settles into the island orbit when no route is picked; with reduced motion there is none", () => {
  const o = overview();
  const camera = new MenuCamera(o, { intro: true });
  camera.showIsland();
  assert.ok(camera.flying);
  for (let i = 0; i < 200; i += 1) camera.update(0.05);
  assert.equal(camera.view, "island");
  assert.ok(Math.abs(camera.eye[1] - orbitPose(o, 0).eye[1]) < 1e-6, "at the orbit's height");
  assert.equal(new MenuCamera(o, { intro: true, reducedMotion: true }).view, "island");
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

const STATUE = { position: [400, 31, -190], yaw: 0.7, top: 1 };

test("the statue shot stands 4.5 m in front of the plinth, above it, looking at the figure's chest", () => {
  const o = overview();
  const { eye, target } = statuePose(STATUE, o, 0);
  assert.ok(Math.abs(flatDistance(eye, STATUE.position) - MENU_CAMERA.statueDistance) < 0.05);
  const front = [-Math.sin(STATUE.yaw), -Math.cos(STATUE.yaw)];
  const off = [eye[0] - STATUE.position[0], eye[2] - STATUE.position[2]];
  assert.ok(off[0] * front[0] + off[1] * front[1] > 4.4, "on the road side");
  assert.ok(Math.abs(eye[1] - (STATUE.position[1] + MENU_CAMERA.statueHeight)) < 1e-6);
  assert.ok(Math.abs(target[1] - STATUE.position[1] - 0.9) <= 0.2);
  assert.ok(flatDistance(target, STATUE.position) < 1e-6);
});

test("the statue shot swings no more than 20 degrees off the plinth's facing", () => {
  const o = overview();
  const front = [-Math.sin(STATUE.yaw), -Math.cos(STATUE.yaw)];
  for (let k = 0; k <= 12; k += 1) {
    const { eye } = statuePose(STATUE, o, (k * Math.PI) / 6);
    const off = [eye[0] - STATUE.position[0], eye[2] - STATUE.position[2]];
    const angle = Math.acos(Math.min(1, (off[0] * front[0] + off[1] * front[1]) / Math.hypot(...off)));
    assert.ok(angle <= MENU_CAMERA.statueSwing + 1e-6, `phase ${k}: ${angle}`);
  }
});

test("a hill under the statue shot's eye lifts it", () => {
  const hill = { position: [500, 31, 495.5], yaw: Math.PI, top: 1 };
  const { eye } = statuePose(hill, overview(), 0);
  assert.ok(eye[1] >= groundAt(overview(), eye[0], eye[2]) + 1.2 - 1e-6);
});

test("picking a statue glides to it, and picking the gym flies back", () => {
  const o = overview();
  const camera = new MenuCamera(o);
  camera.showStatue(STATUE);
  assert.equal(camera.view, "statue");
  for (let i = 0; i < 120; i += 1) camera.update(0.05);
  assert.ok(!camera.flying);
  assert.ok(Math.abs(flatDistance(camera.eye, STATUE.position) - MENU_CAMERA.statueDistance) < 0.05, "at the statue");
  assert.ok(Math.abs(camera.eye[1] - STATUE.position[1] - MENU_CAMERA.statueHeight) < 1e-6);
  camera.showGym(GYM);
  assert.equal(camera.view, "gym");
  assert.ok(camera.flying);
});

test("with reduced motion the statue shot is a cut", () => {
  const o = overview();
  const camera = new MenuCamera(o, { reducedMotion: true });
  camera.showStatue(STATUE);
  assert.ok(!camera.flying);
  camera.update(10);
  const pose = statuePose(STATUE, o, 0);
  for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(camera.eye[k] - pose.eye[k]) < 1e-6);
});

// --- highlight -------------------------------------------------------------------

test("the highlight shows climbs and sprints from the markers", () => {
  const climb = col.markers.find((m) => m.type === "climb");
  const sprint = col.markers.find((m) => m.type === "sprint");
  assert.deepEqual(highlightColor(col, climb.distance + 10), HIGHLIGHT.climb);
  assert.deepEqual(highlightColor(col, sprint.distance + 10), HIGHLIGHT.sprint);
  assert.deepEqual(highlightColor(col, climb.distance - 50), HIGHLIGHT.route);
});

test("where routes share a road, the picked band lies clearly over the others' bands: no flicker from the drone", () => {
  const lowest = (mesh) => {
    let low = Infinity;
    for (let v = 0; v < mesh.vertexCount; v += 1) low = Math.min(low, mesh.positions[v * 3 + 1]);
    return low;
  };
  const start = roadFrame(hills, 0).center[1];
  // The same road under both: only the lift tells them apart.
  const picked = buildHighlight(hills, { beacon: 0, step: 1e9 });
  const other = buildHighlight(hills, { color: HIGHLIGHT.other, beacon: 0, step: 1e9 });
  assert.ok(Math.abs(lowest(picked) - start - HIGHLIGHT_LIFT.picked) < 1e-3);
  assert.ok(Math.abs(lowest(other) - start - HIGHLIGHT_LIFT.other) < 1e-3);
  const gap = HIGHLIGHT_LIFT.picked - HIGHLIGHT_LIFT.other;
  assert.ok(gap > depthStep(DRONE_LENS, 6000) * 2, `${gap} m apart flickers from the drone`);
  assert.ok(HIGHLIGHT_LIFT.other > 0.2, "the other bands still clear the road and its markings");
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
          const view = {
            route,
            scene,
            highlights: [],
            disposed: false,
            statueCalls: [],
            lateStatues: 0,
            setHighlights: (bands) => (view.highlights = bands),
            setStatues: (rows) => {
              if (view.disposed) view.lateStatues += 1;
              view.statueCalls.push(rows);
            },
            // Six targets per gym with a row, as the real view lays out a full-body row.
            statueTargets: (gym) => (view.statueCalls.at(-1)?.some((row) => row.gym === gym) ? Array.from({ length: 6 }, (_, i) => ({ position: [gym.center[0] + i, 0, gym.center[2]], yaw: 0, top: 1 })) : []),
            dispose: () => (view.disposed = true),
            render: () => {},
          };
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

/** Flies the stage's camera to where it is going: rebuilds wait for that. */
const land = (log) => {
  for (let i = 0; i < 100 && log.views[0].camera.flying; i += 1) log.views[0].camera.update(0.05);
};

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
  land(log);
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

test("another biome rebuilds the menu world in it", async () => {
  const { stage, log } = fakeStage();
  let biome = "temperate";
  stage.deps.biome = () => biome;
  stage.deps.buildScene = (routeFile, others, options) =>
    new Promise((resolve) => log.builds.push({ id: routeFile.id, biome: options?.biome, resolve: () => resolve({ overview: overview() }) }));

  await stage.select(listed, "rolling-hills");
  log.builds[0].resolve();
  await settle();
  assert.equal(log.builds[0].biome, "temperate");

  // The pick did not change, the season did: the same route is built again.
  biome = "winter";
  await stage.biomeChanged();
  land(log);
  log.timers.at(-1)();
  assert.deepEqual(
    log.builds.map((build) => [build.id, build.biome]),
    [
      ["rolling-hills", "temperate"],
      ["rolling-hills", "winter"],
    ],
  );

  // Asking again while that one is on its way changes nothing.
  await stage.biomeChanged();
  assert.equal(log.builds.length, 2);
});

test("a season change on the studio tab rebuilds the island in it", async () => {
  const { stage, log } = fakeStage();
  let biome = "temperate";
  stage.deps.biome = () => biome;
  stage.deps.buildScene = (routeFile, others, options) =>
    new Promise((resolve) => log.builds.push({ id: routeFile.id, biome: options?.biome, resolve: () => resolve({ overview: overview() }) }));

  await stage.select(listed, "spin-studio");
  log.builds[0].resolve();
  await settle();
  assert.equal(stage.viewRouteId, "riverside-flats", "the island of the first route");

  biome = "winter";
  await stage.biomeChanged();
  land(log);
  log.timers.at(-1)();
  assert.deepEqual(
    log.builds.map((build) => [build.id, build.biome]),
    [
      ["riverside-flats", "temperate"],
      ["riverside-flats", "winter"],
    ],
  );

  log.builds[1].resolve();
  await settle();
  assert.ok(log.views[0].disposed, "the old season's island is released");
  assert.equal(stage.viewRouteId, "riverside-flats");
});

test("a season change on the workout card rebuilds the world around its gym", async () => {
  const { stage, log } = fakeStage();
  const withWorkout = [...listed, { id: "workout", name: "Workout", kind: "workout" }];
  let biome = "temperate";
  stage.deps.biome = () => biome;
  stage.deps.buildScene = (routeFile, others, options) =>
    new Promise((resolve) => log.builds.push({ id: routeFile.id, biome: options?.biome, resolve: () => resolve({ overview: overview(), gyms: [gymAt(flats)] }) }));

  await stage.select(withWorkout, "workout");
  log.builds[0].resolve();
  await settle();
  assert.equal(log.views[0].camera.view, "gym", "circling the gym");

  biome = "winter";
  await stage.biomeChanged();
  land(log);
  log.timers.at(-1)();
  assert.deepEqual(
    log.builds.map((build) => [build.id, build.biome]),
    [
      ["riverside-flats", "temperate"],
      ["riverside-flats", "winter"],
    ],
  );

  log.builds[1].resolve();
  await settle();
  assert.ok(log.views[0].disposed, "the old season's world is released");
  assert.equal(log.views[1].camera.view, "gym", "still circling the gym");
});

test("a season change while the first world is still building is not lost", async () => {
  const { stage, log } = fakeStage();
  let biome = "temperate";
  stage.deps.biome = () => biome;
  stage.deps.buildScene = (routeFile, others, options) =>
    new Promise((resolve) => log.builds.push({ id: routeFile.id, biome: options?.biome, resolve: () => resolve({ overview: overview() }) }));

  await stage.select(listed, "rolling-hills");
  biome = "winter";
  await stage.biomeChanged();

  // The temperate build lands too late: it is dropped, and the winter one waits behind it.
  log.builds[0].resolve();
  await settle();
  assert.equal(stage.viewRouteId, null, "the old season's world is not shown");
  assert.deepEqual(log.world, [], "nothing faded in");

  log.timers.at(-1)();
  assert.equal(log.builds.at(-1).biome, "winter");
  log.builds.at(-1).resolve();
  await settle();
  assert.equal(stage.viewRouteId, "rolling-hills");
  assert.deepEqual(log.world, [true]);
});

test("a rebuilt world waits until the camera has landed: no hitch in the middle of a glide", async () => {
  const { stage, log } = fakeStage();
  await stage.select(listed, "rolling-hills");
  log.builds[0].resolve();
  await settle();
  await stage.select(listed, "col-de-la-forge");
  const camera = log.views[0].camera;
  assert.ok(camera.flying);
  log.timers.at(-1)();
  assert.equal(log.builds.length, 1, "not while flying");
  land(log);
  log.timers.at(-1)();
  assert.deepEqual(
    log.builds.map((b) => b.id),
    ["rolling-hills", "col-de-la-forge"],
  );
});

test("the opening descends to whatever is picked: a route, or the island orbit for the studio", async () => {
  for (const [pick, view] of [["col-de-la-forge", "route"], ["spin-studio", "island"]]) {
    const { stage, log } = fakeStage();
    stage.deps.createCamera = (o) => new MenuCamera(o, { intro: true });
    await stage.select(listed, pick);
    await settle();
    log.builds[0].resolve();
    await settle();
    const camera = log.views[0].camera;
    assert.equal(camera.view, view, pick);
    assert.ok(camera.flying, `${pick}: descending`);
  }
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

test("joining takes the view over when it shows the joined route's map", async () => {
  const { stage, log } = fakeStage();
  await stage.select(listed, "rolling-hills");
  log.builds[0].resolve();
  await settle();
  const view = stage.takeView("riverside-flats", "valley");
  assert.equal(view, log.views[0], "the valley's world serves every route on the valley map");
  assert.ok(!view.disposed);
});

test("joining a route on another map releases the view", async () => {
  const { stage, log } = fakeStage();
  await stage.select(listed, "rolling-hills");
  log.builds[0].resolve();
  await settle();
  assert.equal(stage.takeView("riverside-flats", "other-map"), null);
  assert.ok(log.views[0].disposed);
});

test("joining takes the view over only when it was built in the season picked", async () => {
  const { stage, log } = fakeStage();
  let biome = "temperate";
  stage.deps.biome = () => biome;
  await stage.select(listed, "rolling-hills");
  log.builds[0].resolve();
  await settle();
  biome = "winter";
  assert.equal(stage.takeView("rolling-hills"), null, "the old season's world is not ridden");
  assert.ok(log.views[0].disposed, "it is released instead");
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
  land(log);
  log.timers.at(-1)();
  assert.equal(log.builds.at(-1).id, "riverside-flats", "rebuilt for the default route");
  log.builds.at(-1).resolve();
  await settle();
  assert.equal(stage.viewRouteId, "riverside-flats");
  assert.equal(log.views.at(-1).camera.view, "gym");
});

// --- workout venues -----------------------------------------------------------------

const full = PRESETS.find((plan) => plan.id === "full-body");
const tabata = PRESETS.find((plan) => plan.id === "tabata");
const CAFES = [
  { id: "valley-cafe", kind: "cafe", name: "Valley Café", x: 0, y: 0 },
  { id: "hill-cafe", kind: "cafe", name: "Hilltop Café", x: 2400, y: 950 },
];

/** A stage on the valley map: a gym at the flats' start (valley café) and one at the hills' (hill café). */
function venueStage({ offered }) {
  const { stage, log } = fakeStage();
  const valleyGym = { ...gymAt(flats), cafeId: "valley-cafe", statueRow: {} };
  const hillGym = { ...gymAt(hills), cafeId: "hill-cafe", statueRow: {} };
  stage.deps.fetchNetwork = async () => ({ id: "valley", edges: [], nodes: CAFES });
  stage.deps.buildScene = (routeFile) => new Promise((resolve) => log.builds.push({ id: routeFile.id, resolve: () => resolve({ overview: overview(), gyms: [valleyGym, hillGym] }) }));
  stage.deps.createCamera = (o) => {
    const camera = new MenuCamera(o);
    camera.shots = [];
    for (const name of ["showGym", "showStatue"]) {
      const original = camera[name].bind(camera);
      camera[name] = (arg) => {
        camera.shots.push([name, arg]);
        original(arg);
      };
    }
    return camera;
  };
  return { stage, log, valleyGym, hillGym, routes: [...offered, { id: "workout", name: "Workout", kind: "workout" }] };
}

const ALL = [listed[0], listed[1], listed[2]];

test("the workout tab flies to the gym of the picked workout's café", async () => {
  const { stage, log, valleyGym, hillGym, routes } = venueStage({ offered: ALL });
  await stage.select(routes, "workout");
  log.builds[0].resolve();
  await settle();
  await stage.showWorkout(tabata, null);
  assert.deepEqual(log.views[0].camera.shots.at(-1), ["showGym", hillGym]);
  assert.equal(log.builds.length, 1, "the world of the map holds both gyms: no rebuild");
  await stage.showWorkout(full, null);
  assert.deepEqual(log.views[0].camera.shots.at(-1), ["showGym", valleyGym]);
  assert.equal(stage.workoutRouteId(tabata), "rolling-hills");
  assert.equal(stage.workoutRouteId(full), "riverside-flats");
  assert.equal(stage.cafeNames().get("hill-cafe"), "Hilltop Café");
});

test("a workout picked before the tab opens decides the gym the tab shows", async () => {
  const { stage, log, hillGym, routes } = venueStage({ offered: ALL });
  await stage.showWorkout(tabata, null);
  await stage.select(routes, "workout");
  assert.equal(log.builds[0].id, "rolling-hills", "the world of the route at the hill café");
  log.builds[0].resolve();
  await settle();
  assert.deepEqual(log.views[0].camera.shots.at(-1), ["showGym", hillGym]);
});

test("a figure chip flies to its statue and back to the gym", async () => {
  const { stage, log, valleyGym, routes } = venueStage({ offered: ALL });
  await stage.select(routes, "workout");
  log.builds[0].resolve();
  await settle();
  await stage.showWorkout(full, 2);
  const view = log.views[0];
  assert.deepEqual(view.camera.shots.at(-1), ["showStatue", view.statueTargets(valleyGym)[2]]);
  assert.equal(view.camera.view, "statue");
  await stage.showWorkout(full, null);
  assert.deepEqual(view.camera.shots.at(-1), ["showGym", valleyGym]);
});

test("a workout whose café has no offered route is shown at the default gym with its own figures", async () => {
  const { stage, log, valleyGym, routes } = venueStage({ offered: [listed[0]] });
  await stage.select(routes, "workout");
  log.builds[0].resolve();
  await settle();
  await stage.showWorkout(tabata, null);
  const view = log.views[0];
  assert.equal(stage.workoutRouteId(tabata), null);
  assert.deepEqual(view.camera.shots.at(-1), ["showGym", valleyGym]);
  const rowAt = (rows) => rows.find((row) => row.gym === valleyGym);
  assert.deepEqual([rowAt(view.statueCalls.at(-1)).figures, rowAt(view.statueCalls.at(-1)).material], [["squats", "burpees"], "bronze"]);
  await stage.showWorkout(full, null);
  assert.equal(rowAt(view.statueCalls.at(-1)).figures.length, 6);
  assert.equal(rowAt(view.statueCalls.at(-1)).material, "marble");
});

test("two picks while the world is still building end on the last pick's gym and leave nothing on a disposed view", async () => {
  const { stage, log, valleyGym, routes } = venueStage({ offered: ALL });
  await stage.select(routes, "workout");
  const first = stage.showWorkout(tabata, null);
  const second = stage.showWorkout(full, null);
  await Promise.all([first, second]);
  log.builds[0].resolve();
  await settle();
  assert.deepEqual(log.views[0].camera.shots.at(-1), ["showGym", valleyGym]);
  for (const t of log.timers) t();
  land(log);
  for (const build of log.builds.slice(1)) build.resolve();
  await settle();
  assert.deepEqual(log.views.map((view) => view.lateStatues), log.views.map(() => 0));
  assert.equal(log.views.filter((view) => !view.disposed).length, 1);
  assert.deepEqual(log.views.at(-1).camera.shots.at(-1), ["showGym", valleyGym]);
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
