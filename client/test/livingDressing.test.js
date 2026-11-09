import { test } from "node:test";
import assert from "node:assert/strict";
import { boxOf, fakeIsland } from "./livingFixture.js";
import { Occupancy } from "../public/js/view3d/features.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { seededRandom } from "../public/js/view3d/noise.js";
import { temperate } from "../public/js/view3d/biomes/temperate.js";
import { buildFields, groundGrid } from "../public/js/view3d/living/fields.js";
import { temperateLiving } from "../public/js/view3d/living/temperate.js";
import { buildCoast, coastSpots, planCoast } from "../public/js/view3d/living/coast.js";
import { buildFences, buildHedges, buildOrchards, buildProps, buildWoods, treeBlocked } from "../public/js/view3d/living/dressing.js";

/** Remembers the larger primitives a builder asked for. */
class RecordingMesh extends MeshBuilder {
  boxes = [];
  trees = [];
  orientedBox(center, u, v, w, color) {
    this.boxes.push({ center, length: Math.hypot(...u), color });
    super.orientedBox(center, u, v, w, color);
  }
  cone(base, ...rest) {
    this.trees.push(base);
    super.cone(base, ...rest);
  }
}

function context({ keepClear = () => false, options, mesh = new RecordingMesh() } = {}) {
  const terrain = fakeIsland(options);
  const box = boxOf(terrain);
  const grid = groundGrid(terrain, box);
  const fields = buildFields(terrain, grid, { seed: terrain.seed, sea: 0, villages: () => false });
  const ctx = { mesh, fields, grid, terrain, occupancy: new Occupancy(), keepClear, random: seededRandom(5), biome: temperate, zonesOf: new Map(), ordered: [], water: 0, box, seed: terrain.seed };
  return ctx;
}

const NO_LIMIT = 10_000_000;

function distanceToSegment(p, [a, b]) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

test("hedges lie on parcel edges", () => {
  const ctx = context();
  buildHedges(ctx, NO_LIMIT);
  assert.ok(ctx.mesh.boxes.length > 20);
  const edges = [...ctx.fields.edges()].map((e) => [e.a, e.b]);
  for (const { center } of ctx.mesh.boxes.slice(0, 200)) {
    assert.ok(edges.some((e) => distanceToSegment([center[0], center[2]], e) < 1), `box at ${center}`);
  }
});

test("hedges only within 450 m of a road", () => {
  const ctx = context();
  buildHedges(ctx, NO_LIMIT);
  for (const { center } of ctx.mesh.boxes) assert.ok(Math.abs(center[2]) <= 450, `z ${center[2]}`);
});

test("about a third of the near edges have a hedge", () => {
  const ctx = context();
  buildHedges(ctx, NO_LIMIT);
  const built = ctx.mesh.boxes.reduce((sum, b) => sum + b.length, 0);
  let near = 0;
  for (const { a, b } of ctx.fields.edges()) if (Math.abs((a[1] + b[1]) / 2) <= 450) near += Math.hypot(b[0] - a[0], b[1] - a[1]);
  assert.ok(built / near >= 0.25 && built / near <= 0.42, `${built / near}`);
});

test("stone walls on rough land, hedges in the lowlands", () => {
  const ctx = context({ options: { height: (x, z) => (x < 0 ? 30 : Math.hypot(x, z) > 1500 ? -5 : 80) } });
  buildHedges(ctx, NO_LIMIT);
  const lowland = ctx.mesh.boxes.filter((b) => b.center[0] < -50);
  const rough = ctx.mesh.boxes.filter((b) => b.center[0] > 50);
  assert.ok(lowland.length > 5 && rough.length > 5, `${lowland.length} / ${rough.length}`);
  assert.ok(lowland.every((b) => temperateLiving.hedge.includes(b.color)));
  assert.ok(rough.every((b) => temperateLiving.wall.includes(b.color)));
});

test("woods gather where woodAt says", () => {
  const ctx = context({ options: { height: () => 80 } });
  buildWoods(ctx, NO_LIMIT);
  assert.ok(ctx.mesh.trees.length > 30, `${ctx.mesh.trees.length} trees`);
  const inWoods = ctx.mesh.trees.filter(([x, , z]) => ctx.fields.woodAt(x, z) > 0).length;
  assert.ok(inWoods / ctx.mesh.trees.length >= 0.9, `${inWoods}/${ctx.mesh.trees.length}`);
});

for (const [name, build] of Object.entries({ buildHedges, buildWoods, buildOrchards, buildFences, buildProps })) {
  test(`${name} keeps out of what must stay clear`, () => {
    const ctx = context({ keepClear: (x) => x > 300 && x < 700, options: { height: (x, z) => (Math.hypot(x, z) > 1500 ? -5 : x > 0 ? 80 : 30) } });
    build(ctx, NO_LIMIT);
    const { data } = ctx.mesh.positions;
    for (let i = 0; i < ctx.mesh.positions.length; i += 3) assert.ok(data[i] < 335 || data[i] > 665, `vertex at x ${data[i]}`);
  });

  test(`${name} stops at its limit`, () => {
    const ctx = context();
    const added = build(ctx, 3000);
    assert.ok(added <= 3000, `${added} vertices`);
    assert.equal(added, ctx.mesh.vertexCount);
  });

  test(`${name} places the same things for the same seed`, () => {
    const run = () => {
      const ctx = context();
      build(ctx, 20_000);
      return ctx.mesh.build().positions;
    };
    assert.deepEqual(run(), run());
  });
}

test("the orchards and fences have something to build on the island", () => {
  const trees = context();
  assert.ok(buildOrchards(trees, NO_LIMIT) > 100);
  const fences = context();
  assert.ok(buildFences(fences, NO_LIMIT) > 100);
  const props = context();
  assert.ok(buildProps(props, NO_LIMIT) > 100);
});

test("lone trees in crop parcels are blocked, hedge lines and rough land are not", () => {
  const { fields } = context({ options: { height: (x) => (x < 0 ? 30 : 80) } });
  let inside = null;
  let nearEdge = null;
  let rough = null;
  for (let x = -1200; x < 1200 && !(inside && nearEdge && rough); x += 7) {
    for (let z = -1200; z < 1200; z += 7) {
      const parcel = fields.parcelAt(x, z);
      if (parcel?.crop === "wheat") {
        const margin = Math.min(parcel.u, parcel.v, parcel.width - parcel.u, parcel.depth - parcel.v);
        if (!inside && margin > 15) inside = [x, z];
        if (!nearEdge && margin < 3) nearEdge = [x, z];
      }
      if (!rough && x > 100 && fields.landAt(x, z) === "rough" && !parcel) rough = [x, z];
    }
  }
  assert.ok(inside && nearEdge && rough);
  assert.equal(treeBlocked(fields, ...inside), true);
  assert.equal(treeBlocked(fields, ...nearEdge), false);
  assert.equal(treeBlocked(fields, ...rough), false);
});

function coastContext(options = {}) {
  const ctx = context(options);
  ctx.cafes = [[0, 0, 1490]];
  return ctx;
}

test("coast spots lie on the sand and know which way the sea is", () => {
  const ctx = coastContext();
  const spots = coastSpots(ctx.fields, ctx.terrain, ctx.seed);
  assert.ok(spots.length > 30, `${spots.length} spots`);
  for (const { x, z, seaward } of spots) {
    assert.equal(ctx.fields.landAt(x, z), "sand");
    const inland = ctx.terrain.height(x - seaward[0] * 40, z - seaward[1] * 40);
    const out = ctx.terrain.height(x + seaward[0] * 40, z + seaward[1] * 40);
    assert.ok(out < inland, "the land falls towards the sea");
  }
});

test("beach huts and parasols stand on sand", () => {
  const ctx = coastContext();
  const { huts, parasols } = planCoast(ctx);
  assert.ok(huts.length > 5, `${huts.length} huts`);
  assert.ok(parasols.length > 5, `${parasols.length} parasols`);
  for (const { x, z } of [...huts, ...parasols]) assert.ok(["sand", "dunes"].includes(ctx.fields.landAt(x, z)), `${x}, ${z}: ${ctx.fields.landAt(x, z)}`);
});

test("the coast keeps out of what must stay clear", () => {
  const ctx = coastContext({ keepClear: (x) => x > 0 });
  const { huts, parasols, boats, rocks } = planCoast(ctx);
  for (const { x } of [...huts, ...parasols, ...rocks]) assert.ok(x <= 0, `at x ${x}`);
  assert.ok(boats.every(({ x }) => x <= 0));
});

test("the jetty starts at the shore and reaches the water", () => {
  const ctx = coastContext();
  const { points } = planCoast(ctx).jetty;
  const heights = points.map(([x, z]) => ctx.terrain.height(x, z));
  assert.ok(heights[0] >= 0, `starts at ${heights[0]}`);
  assert.ok(heights.at(-1) < 0, `ends at ${heights.at(-1)}`);
});

test("the jetty is built at the spot nearest the café", () => {
  const ctx = coastContext();
  const [start] = planCoast(ctx).jetty.points;
  assert.ok(Math.hypot(start[0] - 0, start[1] - 1490) < 80, `starts at ${start}`);
});

test("moored boats float in shallow water", () => {
  const ctx = coastContext();
  const { boats } = planCoast(ctx);
  assert.ok(boats.length > 3, `${boats.length} boats`);
  for (const { x, z } of boats) {
    const height = ctx.terrain.height(x, z);
    assert.ok(height < 0 && height > -6, `height ${height}`);
  }
});

test("an island without a beach is left alone", () => {
  const ctx = coastContext({ options: { height: () => 80 } });
  assert.deepEqual(coastSpots(ctx.fields, ctx.terrain, ctx.seed), []);
  assert.equal(buildCoast(ctx, NO_LIMIT), 0);
});

test("the coast stops at its limit", () => {
  const ctx = coastContext();
  const added = buildCoast(ctx, 3000);
  assert.ok(added > 0 && added <= 3000, `${added}`);
  assert.equal(added, ctx.mesh.vertexCount);
});

test("the living tuft faces up, so it isn't black", () => {
  const mesh = new MeshBuilder();
  temperateLiving.flora.tuft({ mesh, x: 0, y: 0, z: 0, random: seededRandom(3) });
  const { normals, vertexCount } = mesh.build();
  assert.ok(vertexCount > 0);
  for (let i = 0; i < vertexCount; i += 1) assert.deepEqual([...normals.subarray(i * 3, i * 3 + 3)], [0, 1, 0]);
});

test("the living flower's stem faces up too", () => {
  const mesh = new MeshBuilder();
  temperateLiving.flora.flower({ mesh, x: 0, y: 0, z: 0, random: seededRandom(3) });
  const { normals } = mesh.build();
  assert.deepEqual([...normals.subarray(0, 3)], [0, 1, 0]);
});
