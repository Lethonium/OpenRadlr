/** Roadside board sites: where billboards stand beside the ridden road, as plain data. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { BOARD, boardClearings, boardSites, boardSpot, goalBoardSpot, placeBoards } from "../public/js/view3d/boards.js";
import { Occupancy } from "../public/js/view3d/features.js";
import { sceneOf } from "../public/js/view3d/worldScene.js";
import { VERGE, roadFrame, roadHalfWidth } from "../public/js/world/roads.js";

const flatTerrain = { height: () => 0 };
const straight = (points, markers = [], loop = false) => new RouteGeometry({ id: "t", name: "t", lanes: 2, seed: 1, loop, points, markers });
const flat = (length) => [[0, 0, 0], [length / 2, 0, 0], [length, 0, 0]];
/** A square loop of about `km` kilometres, with the start/finish arch. */
const loopOf = (km) => {
  const s = (km * 1000) / 4;
  return straight([[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, 0]], [{ type: "start_finish", distance: 0, length: 0 }], true);
};
const kinds = (sites, kind) => sites.filter((s) => s.kind === kind).map((s) => s.distance);

test("a 20 km loop gets two or three general boards at least 3 km apart", () => {
  const sites = boardSites(loopOf(20), {}).filter((s) => s.kind === "general");
  assert.ok(sites.length >= 2 && sites.length <= 3, `${sites.length} general boards`);
  for (let i = 1; i < sites.length; i += 1) assert.ok(sites[i].distance - sites[i - 1].distance >= 3000);
});

test("a climb of 1.5 km gets one board 150 m before the top, one of 2.5 km a second at its middle", () => {
  const route = straight(flat(6000), [{ type: "climb", distance: 1000, length: 1500 }, { type: "climb", distance: 3000, length: 2600 }]);
  assert.deepEqual(kinds(boardSites(route, {}), "climb"), [2350, 4300, 5450]);
});

test("a climb under 1.5 km gets no board", () => {
  const route = straight(flat(6000), [{ type: "climb", distance: 1000, length: 1400 }]);
  assert.deepEqual(kinds(boardSites(route, {}), "climb"), []);
});

test("the last-km board stands 600-900 m before the end of a loop and of a point-to-point route", () => {
  for (const route of [loopOf(8), straight(flat(8000))]) {
    const [last, ...rest] = boardSites(route, {}).filter((s) => s.kind === "lastKm");
    assert.equal(rest.length, 0);
    const before = route.length - last.distance;
    assert.ok(before >= 600 && before <= 900, `${before} m before the end`);
  }
});

test("routes under 1 km get no boards", () => {
  assert.deepEqual(boardSites(straight(flat(900)), {}), []);
});

test("no general board inside a village", () => {
  const villages = [{ from: 2000, to: 9000 }];
  const sites = boardSites(loopOf(12), { villages }).filter((s) => s.kind === "general");
  assert.ok(sites.length > 0);
  for (const { distance } of sites) assert.ok(distance < 2000 || distance > 9000, `board at ${distance} m is in the village`);
});

test("placed boards stand beside the road, face oncoming riders and claim their ground", () => {
  const route = straight(flat(6000));
  const occupancy = new Occupancy();
  const site = { kind: "general", distance: 3000 };
  const [board] = placeBoards(route, flatTerrain, [site], { occupancy });
  const frame = roadFrame(route, site.distance);
  const off = (board.position[0] - frame.center[0]) * frame.right[0] + (board.position[2] - frame.center[2]) * frame.right[2];
  assert.ok(Math.abs(off - (roadHalfWidth(route.lanes) + VERGE + BOARD.setback)) < 0.01, `${off} m off the centre line`);
  const normal = [Math.sin(board.yaw), Math.cos(board.yaw)];
  const towardRider = -(normal[0] * frame.forward[0] + normal[1] * frame.forward[2]);
  assert.ok(towardRider > Math.cos(BOARD.angle + 0.01), `faces riders by ${towardRider}`);
  assert.ok(occupancy.blocked(board.position[0], board.position[2], 1));
  assert.equal(board.kind, site.kind);
  assert.equal(board.distance, site.distance);
});

test("clearings sit where the boards will stand", () => {
  const route = straight(flat(6000));
  const sites = boardSites(route, {});
  const placed = placeBoards(route, flatTerrain, sites, { occupancy: new Occupancy() });
  const clearings = boardClearings(route, sites);
  assert.equal(clearings.length, placed.length);
  clearings.forEach((c, i) => {
    assert.ok(Math.hypot(c.x - placed[i].position[0], c.z - placed[i].position[2]) < 1e-6);
    assert.equal(c.radius, BOARD.clearing);
  });
});

test("a site the world avoids is dropped", () => {
  const route = straight(flat(6000));
  const sites = boardSites(route, {});
  assert.ok(sites.length > 1);
  const first = roadFrame(route, sites[0].distance).center[0];
  const avoid = (x) => Math.abs(x - first) < 50;
  const placed = placeBoards(route, flatTerrain, sites, { occupancy: new Occupancy(), avoid });
  assert.equal(placed.length, sites.length - 1);
  assert.ok(placed.every((b) => b.distance !== sites[0].distance));
});

/** A house box standing between the road 45 m before `distance` and the board of a straight east-west route. */
const houseBefore = (route, distance) => {
  const spot = boardSpot(route, distance);
  return { x: spot.x - 30, z: (spot.z + roadFrame(route, distance).center[2]) / 3, halfX: 12, halfZ: 4, yaw: 0, top: 8 };
};

test("a house between the road and a board moves the board along the road, to where it is seen", () => {
  const route = straight(flat(6000));
  const site = { kind: "general", distance: 3000 };
  const boxes = [houseBefore(route, site.distance)];
  const [board] = placeBoards(route, flatTerrain, [site], { occupancy: new Occupancy(), boxes });
  assert.ok(board, "the board was dropped instead of moved");
  assert.notEqual(board.distance, site.distance);
  assert.ok(Math.abs(board.distance - site.distance) <= 100);
  const clear = placeBoards(route, flatTerrain, [{ ...site, distance: board.distance }], { occupancy: new Occupancy(), boxes });
  assert.equal(clear[0].distance, board.distance);
});

test("a board no slide frees from houses is dropped", () => {
  const route = straight(flat(6000));
  const site = { kind: "general", distance: 3000 };
  const wall = { x: roadFrame(route, site.distance).center[0], z: boardSpot(route, site.distance).z / 2, halfX: 400, halfZ: 3, yaw: 0, top: 8 };
  assert.deepEqual(placeBoards(route, flatTerrain, [site], { occupancy: new Occupancy(), boxes: [wall] }), []);
});

test("a house off the sight line leaves the board where it was", () => {
  const route = straight(flat(6000));
  const site = { kind: "general", distance: 3000 };
  const far = { x: boardSpot(route, site.distance).x, z: boardSpot(route, site.distance).z + 60, halfX: 6, halfZ: 6, yaw: 0, top: 8 };
  const [board] = placeBoards(route, flatTerrain, [site], { occupancy: new Occupancy(), boxes: [far] });
  assert.equal(board.distance, site.distance);
});

test("a goal board stands on the ground beside the road, not at the road's height", () => {
  const route = straight(flat(6000));
  const slope = (x, z) => 3 + z * 0.5;
  const { position, yaw } = goalBoardSpot(route, 3000, slope);
  const spot = boardSpot(route, 3000);
  assert.deepEqual(position, [spot.x, slope(spot.x, spot.z), spot.z]);
  assert.equal(yaw, spot.yaw);
});

test("a goal board without ground data takes the road's height", () => {
  const route = straight([[0, 0, 5], [3000, 0, 5], [6000, 0, 5]]);
  assert.equal(goalBoardSpot(route, 3000, undefined).position[1], roadFrame(route, 3000).center[1]);
  assert.equal(goalBoardSpot(route, 3000, () => -Infinity).position[1], roadFrame(route, 3000).center[1]);
});

test("the scene carries the boards", () => {
  const board = { kind: "general", distance: 100, position: [1, 2, 3], yaw: 0 };
  assert.deepEqual(sceneOf({ boards: [board] }).boards, [board]);
});
