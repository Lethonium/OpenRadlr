import { test } from "node:test";
import assert from "node:assert/strict";

import { RoadNetwork } from "../public/js/route/network.js";
import { junctionPads, ROAD_KIND, roadStrips } from "../public/js/world/plan/roadStrips.js";
import { riverStrips } from "../public/js/world/plan/riverStrips.js";
import { mergeStrips } from "../public/js/world/plan/strips.js";
import { buildBridges } from "../public/js/view3d/bridges.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { JUNCTION_LIFT, ROAD_LIFT, roadFrame, roadHalfWidth } from "../public/js/world/roads.js";
import { RIVER } from "../public/js/world/rivers.js";
import { squareRoute, tinyNetworkFile } from "./helpers.js";
import { tinyWorld } from "./support/planFixture.js";

const quadsOf = (strips, kind) => {
  const list = [];
  for (let q = 0; q < strips.kinds.length / 4; q += 1) {
    if (strips.kinds[q * 4] !== kind) continue;
    const vertex = (k) => Array.from(strips.positions.subarray((q * 4 + k) * 3, (q * 4 + k) * 3 + 3));
    list.push({ q, corners: [0, 1, 2, 3].map(vertex), u: strips.uvs[q * 8] });
  }
  return list;
};

test("the road sits where it sat", () => {
  const route = squareRoute();
  const strips = roadStrips(route, { step: 4 });
  const asphalt = quadsOf(strips, ROAD_KIND.asphalt);
  assert.ok(asphalt.length >= 200);
  for (const [i, { corners }] of asphalt.slice(0, 200).entries()) {
    const frame = roadFrame(route, i * 4);
    const [left, right] = corners;
    assert.ok(Math.abs((left[1] + right[1]) / 2 - (frame.center[1] + ROAD_LIFT.ridden)) < 0.02, `height at ${i * 4}`);
    assert.ok(Math.abs(Math.hypot(right[0] - left[0], right[2] - left[2]) / 2 - roadHalfWidth(route.lanes)) < 1e-4, `half width at ${i * 4}`);
    assert.ok(Math.abs((left[0] + right[0]) / 2 - frame.center[0]) < 1e-3 && Math.abs((left[2] + right[2]) / 2 - frame.center[2]) < 1e-3);
  }
});

test("another road sits lower, and skipped stretches are left out", () => {
  const route = squareRoute();
  const other = roadStrips(route, { lift: ROAD_LIFT.other });
  const first = quadsOf(other, ROAD_KIND.asphalt)[0].corners[0][1];
  assert.ok(Math.abs(first - (roadFrame(route, 0).center[1] + ROAD_LIFT.other)) < 0.02);
  const skipped = roadStrips(route, { skip: (d) => d < 500 });
  assert.ok(quadsOf(skipped, ROAD_KIND.asphalt).length < quadsOf(other, ROAD_KIND.asphalt).length - 100);
});

test("uv runs along the road, one 12 m tile per unit", () => {
  const route = squareRoute();
  const asphalt = quadsOf(roadStrips(route, { step: 4 }), ROAD_KIND.asphalt);
  asphalt.forEach(({ u }, i) => assert.ok(Math.abs(u - (i * 4) / 12) < 1e-4));
});

test("marks: edge lines, dashed dividers, and a bank that a junction flattens", () => {
  const route = squareRoute();
  const plain = roadStrips(route, {});
  assert.ok(quadsOf(plain, ROAD_KIND.edge).length > 0 && quadsOf(plain, ROAD_KIND.marking).length > 0);
  assert.equal(quadsOf(plain, ROAD_KIND.bank).length, 0);
  const banked = roadStrips(route, { bank: { height: 0.3 }, rut: { width: 0.36 } });
  assert.ok(quadsOf(banked, ROAD_KIND.bank).length > 0 && quadsOf(banked, ROAD_KIND.rut).length > 0);
  const apron = roadStrips(route, { bank: { height: 0.3 }, bankAt: () => 0 });
  assert.equal(quadsOf(apron, ROAD_KIND.edge).length, 0, "lines stop at a junction");
  const high = (strips) => Math.max(...strips.positions.filter((_, i) => i % 3 === 1));
  assert.ok(high(banked) > high(apron) + 0.2, "the apron is flat");
});

test("pads cover junctions", () => {
  const network = new RoadNetwork(tinyNetworkFile());
  const pads = junctionPads(network, {});
  for (const node of network.nodes.values()) {
    const centre = [node.x, node.elevation + JUNCTION_LIFT, -node.y];
    const near = quadsOf(pads, ROAD_KIND.asphalt).filter(({ corners }) => corners.some((c) => Math.hypot(c[0] - centre[0], c[2] - centre[2]) < 1e-3));
    assert.ok(near.length >= 1, `a pad at ${node.id}`);
    const rim = near.flatMap(({ corners }) => corners).filter((c) => Math.hypot(c[0] - centre[0], c[2] - centre[2]) > 1);
    assert.ok(Math.min(...rim.map((c) => c[0])) < centre[0] && Math.max(...rim.map((c) => c[0])) > centre[0], "the rim surrounds the node");
    assert.ok(rim.every((c) => Math.abs(c[1] - centre[1]) < 1e-4));
  }
  assert.equal(mergeStrips([pads, pads]).indices.length, pads.indices.length * 2);
});

test("rivers: a ribbon on the water, flowing downhill", () => {
  const world = tinyWorld();
  const strips = riverStrips(world.rivers);
  assert.ok(strips.indices.length > 0);
  assert.ok(strips.flow.every((f) => f >= 0 && f <= 1));
  const river = world.rivers[0];
  assert.ok(Math.abs(strips.positions[1] - (river.points[0].surface + 0.05)) < 1e-3, "on the surface");
  const first = strips.uvs[1];
  const last = strips.uvs[strips.uvs.length - 1];
  const highEnd = river.points[0].surface >= river.points.at(-1).surface ? first : last;
  const lowEnd = highEnd === first ? last : first;
  assert.ok(lowEnd > highEnd - RIVER.rise, "the distance counter grows towards the lower end");
});

test("every river crossing has a bridge at least as high as the road", () => {
  const world = tinyWorld();
  const mesh = buildBridges(world.rivers, world.terrain, resolveBiome("temperate"));
  assert.ok(mesh.vertexCount > 0);
  for (const river of world.rivers) {
    const frame = roadFrame(river.route, river.at);
    let top = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (Math.hypot(mesh.positions[i] - frame.center[0], mesh.positions[i + 2] - frame.center[2]) < 6) top = Math.max(top, mesh.positions[i + 1]);
    }
    assert.ok(top >= frame.center[1], `deck ${top} vs road ${frame.center[1]}`);
  }
});
