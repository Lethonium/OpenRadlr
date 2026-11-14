import { test } from "node:test";
import assert from "node:assert/strict";
import { VrWorld, pickHost, worldWanted } from "../../public/js/vr/vrWorld.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("pickHost finds the rider by id", () => {
  const riders = [{ id: 1 }, { id: 2 }];
  assert.equal(pickHost(riders, 2), riders[1]);
});

test("pickHost is null before the rider id is known", () => {
  assert.equal(pickHost([{ id: 1 }], null), null);
  assert.equal(pickHost([{ id: 1 }], 9), null);
});

test("worldWanted asks for the host's route", () => {
  const message = { type: "state", riders: [{ id: 1, route: "hills" }] };
  assert.deepEqual(worldWanted(message, 1), { kind: "route", routeId: "hills" });
});

test("worldWanted asks for the studio on studio_state", () => {
  assert.deepEqual(worldWanted({ type: "studio_state", riders: [] }, 1), { kind: "studio" });
});

test("worldWanted keeps the world while the host is off every route", () => {
  assert.equal(worldWanted({ type: "state", riders: [{ id: 1, route: null }] }, 1), null);
  assert.equal(worldWanted({ type: "state", riders: [{ id: 2, route: "hills" }] }, 1), null);
  assert.equal(worldWanted({ type: "studio_state", riders: [] }, null), null);
});

function setup() {
  const builds = [];
  const world = new VrWorld({
    buildRouteWorld: (routeId) => new Promise((resolve) => builds.push({ routeId, resolve })),
    buildStudioWorld: () => new Promise((resolve) => builds.push({ routeId: "studio", resolve })),
  });
  const built = [];
  world.on("world", (w) => built.push(w));
  return { world, builds, built };
}

test("a route change builds the new world", async () => {
  const { world, builds, built } = setup();
  world.want({ kind: "route", routeId: "a" });
  builds[0].resolve({ name: "A" });
  await flush();
  world.want({ kind: "route", routeId: "b" });
  builds[1].resolve({ name: "B" });
  await flush();
  assert.deepEqual(built, [{ name: "A" }, { name: "B" }]);
});

test("the same want twice builds once", () => {
  const { world, builds } = setup();
  world.want({ kind: "route", routeId: "a" });
  world.want({ kind: "route", routeId: "a" });
  assert.equal(builds.length, 1);
});

test("a newer want drops the older build's result", async () => {
  const { world, builds, built } = setup();
  world.want({ kind: "route", routeId: "a" });
  world.want({ kind: "studio" });
  builds[1].resolve({ name: "studio" });
  await flush();
  builds[0].resolve({ name: "A" });
  await flush();
  assert.deepEqual(built, [{ name: "studio" }]);
});

test("a failed build is tried again by the next want", async () => {
  const failures = [];
  const builds = [];
  const world = new VrWorld({
    buildRouteWorld: () => new Promise((resolve, reject) => builds.push({ resolve, reject })),
    buildStudioWorld: () => new Promise(() => {}),
  });
  world.on("failed", (error) => failures.push(error));
  world.want({ kind: "route", routeId: "a" });
  builds[0].reject(new Error("offline"));
  await flush();
  world.want({ kind: "route", routeId: "a" });
  assert.equal(failures.length, 1);
  assert.equal(builds.length, 2);
});

test("a stale build's failure does not forget the newer want", async () => {
  const builds = [];
  const world = new VrWorld({
    buildRouteWorld: () => new Promise((resolve, reject) => builds.push({ resolve, reject })),
    buildStudioWorld: () => new Promise(() => {}),
  });
  world.on("failed", () => {});
  world.want({ kind: "route", routeId: "a" });
  world.want({ kind: "route", routeId: "b" });
  builds[0].reject(new Error("offline"));
  await flush();
  world.want({ kind: "route", routeId: "b" });
  assert.equal(builds.length, 2);
});
