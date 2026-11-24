/**
 * A town is a network, not a row (#117): streets, junctions, blocks, plots and a square, decided from the seed
 * before a single triangle is built. Houses also keep off every road that crosses the town.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { roadHalfWidth } from "../public/js/world/roads.js";
import { SETTLEMENT_KIND, SETTLEMENT_STYLE } from "../public/js/world/plan/settlements/styles.js";
import { layoutSettlement } from "../public/js/world/plan/settlements/index.js";
import { valleyWorld } from "./support/planFixture.js";

let cachedValley;
const valley = () => (cachedValley ??= valleyWorld());

const TERRAIN = { height: () => 10 };
const road = (id, points, lanes) => new RouteGeometry({ id, name: id, points, lanes, markers: [], zones: [], closed: false });
const ROAD = road("road", [[-1000, 0], [1000, 0]], 4);

const city = (options = {}) =>
  layoutSettlement({ id: "hilltop", kind: SETTLEMENT_KIND.city, center: [0, 0], radius: 400, seed: 2026, terrain: TERRAIN, roads: [ROAD], ...options });
const village = (options = {}) =>
  layoutSettlement({ id: "southwest", kind: SETTLEMENT_KIND.village, center: [0, 0], radius: 220, seed: 2026, terrain: TERRAIN, roads: [ROAD], ...options });

const distanceToLine = (x, z, points) => {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l));
    best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)));
  }
  return best;
};

test("a city has streets, junctions, blocks, plots and a square", () => {
  const layout = city();
  assert.ok(layout.streets.length >= 8, `streets ${layout.streets.length}`);
  assert.ok(layout.junctions.length >= 12, `junctions ${layout.junctions.length}`);
  assert.ok(layout.blocks.length >= 8, `blocks ${layout.blocks.length}`);
  assert.ok(layout.plots.length >= 40, `plots ${layout.plots.length}`);
  assert.ok(layout.square, "a city has a market square");
  assert.ok(layout.lamps.length >= 20, `lamps ${layout.lamps.length}`);
  assert.ok(layout.streets.some((s) => s.existing), "the main road is reused, not drawn twice");
});

test("a village is smaller and has no grid", () => {
  const layout = village();
  assert.ok(layout.streets.length <= 5, `streets ${layout.streets.length}`);
  assert.ok(layout.plots.length < city().plots.length);
  assert.ok(layout.junctions.length <= 4, `junctions ${layout.junctions.length}`);
});

test("the same seed lays out the same town", () => {
  assert.deepEqual(city(), city());
});

test("different seeds lay out different towns", () => {
  assert.notDeepEqual(city({ seed: 1 }).plots, city({ seed: 2 }).plots);
});

test("no plot stands in a street, the square or another plot", () => {
  const layout = city();
  for (const plot of layout.plots) {
    for (const street of layout.streets) {
      assert.ok(distanceToLine(plot.x, plot.z, street.points) >= street.width / 2, `${plot.street} plot ${plot.x},${plot.z} is in ${street.id}`);
    }
    if (layout.square) {
      const d = [plot.x - layout.center[0], plot.z - layout.center[1]];
      const a = d[0] * layout.frame.u[0] + d[1] * layout.frame.u[1];
      const b = d[0] * layout.frame.v[0] + d[1] * layout.frame.v[1];
      const inside = a > layout.square.a0 - 2 && a < layout.square.a1 + 2 && b > layout.square.b0 - 2 && b < layout.square.b1 + 2;
      assert.equal(inside, false, `plot ${plot.x},${plot.z} is on the square`);
    }
  }
  for (let i = 0; i < layout.plots.length; i += 1) {
    for (let j = i + 1; j < layout.plots.length; j += 1) {
      const a = layout.plots[i];
      const b = layout.plots[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > Math.min(a.width, b.width) * 0.5, `plots ${i} and ${j} overlap`);
    }
  }
});

test("houses face the street on both sides", () => {
  const layout = city();
  const sides = new Set(layout.plots.map((plot) => Math.sign(plot.side)));
  assert.deepEqual([...sides].sort(), [-1, 1]);
  for (const plot of layout.plots) {
    assert.ok(Math.abs(plot.yaw) <= Math.PI + 1e-9);
    assert.ok(plot.width >= 5 && plot.depth >= 5);
  }
});

test("a harbour gets a lane to the road, a quay and boats", () => {
  // The shore is 80 m north of the centre; the road is 60 m south.
  const coast = { seaLevel: 0, height: (x, z) => 20 + z };
  const layout = layoutSettlement({ id: "harbour", kind: SETTLEMENT_KIND.harbour, center: [0, 60], radius: 50, seed: 7103, terrain: coast, roads: [ROAD] });
  const lane = layout.streets.find((s) => s.kind === "lane");
  assert.ok(lane, "a lane connects the harbour to the road");
  assert.ok(Math.hypot(lane.points[0][0], lane.points[0][1]) < 2, "the lane starts at the road");
  assert.ok(Math.hypot(lane.points.at(-1)[0], lane.points.at(-1)[1] - 60) < 2, "the lane ends at the harbour");
  assert.ok(layout.quay, "a quay on the shore");
  assert.equal(layout.boats.length, 4);
  assert.ok(layout.boats.every((boat) => coast.height(boat.x, boat.z) < 0), "the boats are in the water");
});

test("the map's village and harbour stand on dry land, and the boats do not", () => {
  const { network, terrain, routes } = valley();
  const layouts = Object.fromEntries(network.settlements.map((settlement) => [settlement.id, layoutSettlement({ ...settlement, terrain, roads: routes })]));

  const south = layouts.southwest;
  assert.ok(south.square, "the village has a green");
  assert.ok(south.props.some((prop) => prop.role === "church"), "the village has a church");
  assert.ok(south.streets.some((street) => street.kind === "street" && !street.existing), "a cross lane off the main road");

  const harbour = layouts.harbour;
  assert.ok(harbour.quay, "the harbour has a quay");
  assert.ok(harbour.boats.length >= 3, `boats ${harbour.boats.length}`);
  assert.ok(harbour.boats.every((boat) => terrain.height(boat.x, boat.z) < terrain.seaLevel), "the boats are in the sea");
  assert.ok(harbour.streets.some((street) => street.kind === "lane"), "a lane from the road to the harbour");

  for (const layout of [south, harbour]) {
    for (const plot of layout.plots) {
      assert.ok(terrain.height(plot.x, plot.z) > terrain.seaLevel + 0.5, `${layout.id} plot ${plot.x.toFixed(0)},${plot.z.toFixed(0)} is in the water`);
    }
  }
});

// --- roads that cross a town ----------------------------------------------------------

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
    for (const r of roads) {
      const clear = roadHalfWidth(r.lanes) + pavement;
      for (let d = 0; d <= r.length; d += 2) {
        const p = r.positionAt(d);
        if (distanceToPlot(plot, p.x, -p.y) < clear) {
          bad.push({ x: plot.x, z: plot.z, road: r.id });
          d = r.length;
        }
      }
    }
  }
  return bad;
}

test("no house plot of the map's settlements stands on a network road", () => {
  const { network, terrain, routes } = valley();
  for (const settlement of network.settlements) {
    const layout = layoutSettlement({ ...settlement, terrain, roads: routes });
    const pavement = SETTLEMENT_STYLE[settlement.kind]?.pavement ?? 2;
    assert.deepEqual(offenders(layout, routes, pavement), [], `${settlement.id}: plots on roads`);
  }
});

test("a road crossing the grid keeps its half width and pavement clear of plots", () => {
  const cross = road("cross", [[37, -600], [37, 600]], 2);
  const options = { id: "hilltop", kind: SETTLEMENT_KIND.city, center: [0, 0], radius: 400, seed: 2026, terrain: TERRAIN };
  const without = layoutSettlement({ ...options, roads: [ROAD] });
  const layout = layoutSettlement({ ...options, roads: [ROAD, cross] });
  assert.ok(layout.plots.length > 20, "the town still has houses");
  assert.ok(layout.plots.length < without.plots.length, "the crossing road culled some plots");
  assert.deepEqual(offenders(layout, [cross], SETTLEMENT_STYLE.city.pavement), []);
  const key = (p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
  const before = new Set(without.plots.map(key));
  assert.ok(layout.plots.every((p) => before.has(key(p))), "the rest of the grid is unchanged");
});
