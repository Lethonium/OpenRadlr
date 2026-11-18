/**
 * A town's houses keep off every road that crosses it (#117), not only the
 * streets the layout drew itself: Hilltop sits on a network, and the roads
 * through it are not the main street.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { roadNetworkOf } from "../public/js/route/worldMap.js";
import { networkTerrain } from "../public/js/view3d/world.js";
import { roadHalfWidth } from "../public/js/view3d/roadWidth.js";
import { SETTLEMENT_KIND, SETTLEMENT_STYLE, layoutSettlement } from "../public/js/land/settlement.js";

/** Distance from a point to a plot's oriented footprint rectangle. */
function distanceToPlot(plot, x, z) {
  const along = [-plot.facing[1], plot.facing[0]];
  const dx = x - plot.x;
  const dz = z - plot.z;
  const a = Math.abs(dx * along[0] + dz * along[1]) - plot.width / 2;
  const b = Math.abs(dx * plot.facing[0] + dz * plot.facing[1]) - plot.depth / 2;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0));
}

/** Plots of `layout` that come closer than the road's half width plus pavement. */
function offenders(layout, roads, pavement) {
  const bad = [];
  for (const plot of layout.plots) {
    for (const road of roads) {
      const clear = roadHalfWidth(road.lanes) + pavement;
      for (let d = 0; d <= road.length; d += 2) {
        const p = road.positionAt(d);
        if (distanceToPlot(plot, p.x, -p.y) < clear) {
          bad.push({ x: plot.x, z: plot.z, road: road.id });
          d = road.length;
        }
      }
    }
  }
  return bad;
}

test("no house plot of the map's settlements stands on a network road", () => {
  const network = roadNetworkOf(JSON.parse(readFileSync(new URL("../../routes/maps/valley.json", import.meta.url))));
  const roads = network.roads();
  const terrain = networkTerrain(network, roads);
  for (const settlement of network.settlements) {
    const layout = layoutSettlement({ ...settlement, terrain, roads });
    const pavement = SETTLEMENT_STYLE[settlement.kind]?.pavement ?? 2;
    assert.deepEqual(offenders(layout, roads, pavement), [], `${settlement.id}: plots on roads`);
  }
});

test("a road crossing the grid keeps its half width and pavement clear of plots", () => {
  const flat = { height: () => 10 };
  const main = new RouteGeometry({ id: "main", name: "Main", points: [[-1000, 0], [1000, 0]], lanes: 4, markers: [], zones: [], closed: false });
  const cross = new RouteGeometry({ id: "cross", name: "Cross", points: [[37, -600], [37, 600]], lanes: 2, markers: [], zones: [], closed: false });
  const options = { id: "hilltop", kind: SETTLEMENT_KIND.city, center: [0, 0], radius: 400, seed: 2026, terrain: flat };
  const without = layoutSettlement({ ...options, roads: [main] });
  const layout = layoutSettlement({ ...options, roads: [main, cross] });
  assert.ok(layout.plots.length > 20, "the town still has houses");
  assert.ok(layout.plots.length < without.plots.length, "the crossing road culled some plots");
  assert.deepEqual(offenders(layout, [cross], SETTLEMENT_STYLE.city.pavement), []);
  // Only offenders go: every surviving plot is one the uncrossed town had.
  const key = (p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
  const before = new Set(without.plots.map(key));
  assert.ok(layout.plots.every((p) => before.has(key(p))), "the rest of the grid is unchanged");
});
