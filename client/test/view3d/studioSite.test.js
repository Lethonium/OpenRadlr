import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../../public/js/route/geometry.js";
import { RoadNetwork } from "../../public/js/route/network.js";
import { CAFE_DISTANCE, Occupancy, STUDIO_DISTANCE, STUDIO_FOOTPRINT, studioSite } from "../../public/js/view3d/features.js";
import { buildWorld, roadFrame, roadHalfWidth } from "../../public/js/view3d/world.js";
import { sceneOf } from "../../public/js/view3d/worldScene.js";

const loadRoute = (id) => new RouteGeometry(JSON.parse(readFileSync(new URL(`../../../routes/${id}.json`, import.meta.url))));
const route = loadRoute("riverside-flats");
const lateralOf = (frame, p) => (p[0] - frame.center[0]) * frame.right[0] + (p[2] - frame.center[2]) * frame.right[2];

test("the studio stands across the road from the café", () => {
  const site = studioSite(route, null, { occupancy: new Occupancy() });
  assert.ok(site);
  assert.equal(STUDIO_DISTANCE, CAFE_DISTANCE + 12);
  assert.ok(lateralOf(roadFrame(route, STUDIO_DISTANCE), site.position) < 0, "the café is on the right, the studio on the left");
});

test("its glass front faces the road and stands 8 m off the edge", () => {
  const site = studioSite(route, null, { occupancy: new Occupancy() });
  const frame = roadFrame(route, STUDIO_DISTANCE);
  // Local -Z turned by the yaw is the way the riders look.
  const forward = [-Math.sin(site.yaw), -Math.cos(site.yaw)];
  assert.ok(forward[0] * frame.right[0] + forward[1] * frame.right[2] > 0.99, "looks at the road");
  const front = [site.position[0] + forward[0] * -STUDIO_FOOTPRINT.front, 0, site.position[2] + forward[1] * -STUDIO_FOOTPRINT.front];
  assert.ok(Math.abs(-lateralOf(frame, front) - roadHalfWidth(route.lanes) - 8) < 0.01);
});

test("it reserves its footprint", () => {
  const occupancy = new Occupancy();
  const site = studioSite(route, null, { occupancy });
  assert.ok(occupancy.blocked(site.position[0], site.position[2]));
});

test("it stands on the highest ground under its footprint", () => {
  const terrain = { height: (x, z) => 100 + 0.01 * x + 0.02 * z };
  const site = studioSite(route, terrain, { occupancy: new Occupancy() });
  const { halfWidth, front, back } = STUDIO_FOOTPRINT;
  const corner = (x, z) => [site.position[0] + x * Math.cos(site.yaw) + z * Math.sin(site.yaw), site.position[2] - x * Math.sin(site.yaw) + z * Math.cos(site.yaw)];
  const highest = Math.max(...[-halfWidth, halfWidth].flatMap((x) => [front, back].map((z) => terrain.height(...corner(x, z)))));
  assert.ok(Math.abs(site.position[1] - highest) < 1e-9);
});

test("it is skipped where something already stands", () => {
  const occupancy = new Occupancy();
  assert.ok(studioSite(route, null, { occupancy }));
  assert.equal(studioSite(route, null, { occupancy }), null, "not twice in one place");
  assert.equal(studioSite(route, null, { occupancy: new Occupancy(), avoid: () => true }), null, "never in a river or on a road");
});

test("only the valley café gets one", () => {
  const networkText = readFileSync(new URL("../../../routes/maps/valley.json", import.meta.url), "utf8");
  const others = ["riverside-flats", "rolling-hills", "col-de-la-forge"].map(loadRoute);
  const ridden = others[1];
  const valleyWorld = buildWorld(ridden, { network: new RoadNetwork(JSON.parse(networkText)), others });
  assert.ok(sceneOf(valleyWorld).studio, "the valley café has the studio across the road");
  const renamed = new RoadNetwork(JSON.parse(networkText.replaceAll("valley-cafe", "vale-cafe")));
  assert.equal(sceneOf(buildWorld(ridden, { network: renamed, others })).studio, null, "no valley café, no studio");
  assert.equal(sceneOf(buildWorld(ridden)).studio, null, "a route without a map has none");
});
