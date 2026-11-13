import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteFollower } from "../../public/js/cockpit/routeFollower.js";

const FILE = { id: "hills", name: "Hills", lanes: 2, seed: 1, points: [[0, 0, 10], [500, 0, 20]], markers: [] };

/** A route fetch that answers only when the test resolves it. */
function setup() {
  const requests = [];
  const loaded = [];
  const follower = new RouteFollower({
    fetchRoute: (id) => new Promise((resolve, reject) => requests.push({ id, resolve, reject })),
    onRoute: (route) => loaded.push(route),
  });
  return { follower, requests, loaded };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("following a route loads it once", async () => {
  const { follower, requests, loaded } = setup();
  follower.follow("hills");
  follower.follow("hills");
  assert.deepEqual(requests.map((r) => r.id), ["hills"]);
  requests[0].resolve(FILE);
  await settle();
  follower.follow("hills");
  assert.equal(requests.length, 1);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "hills");
  assert.ok(loaded[0].length > 0, "a route geometry");
});

test("no route (studio, own road) loads nothing", () => {
  const { follower, requests } = setup();
  follower.follow(null);
  follower.follow(undefined);
  assert.equal(requests.length, 0);
});

test("a route that arrives after the rider moved on is dropped", async () => {
  const { follower, requests, loaded } = setup();
  follower.follow("hills");
  follower.follow("coast");
  requests[1].resolve({ ...FILE, id: "coast" });
  requests[0].resolve(FILE);
  await settle();
  assert.deepEqual(loaded.map((r) => r.id), ["coast"]);
});

test("a failed load is not retried until the route changes", async () => {
  const { follower, requests } = setup();
  follower.follow("hills");
  requests[0].reject(new Error("404"));
  await settle();
  follower.follow("hills");
  assert.equal(requests.length, 1);
  follower.follow("coast");
  follower.follow("hills");
  assert.deepEqual(requests.map((r) => r.id), ["hills", "coast", "hills"]);
});
