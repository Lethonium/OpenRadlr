/** Landmark placement (#117): where each stands, that a road sees it, and that its apron stays free. */
import assert from "node:assert/strict";
import test from "node:test";
import { MASK, buildMasks, maskAt } from "../public/js/world/plan/masks.js";
import { MILL_SPACING, planLandmarks } from "../public/js/world/plan/landmarks.js";
import { seenFromRoad } from "../public/js/world/sight.js";
import { waterLevel } from "../public/js/world/roads.js";
import { buildWorld } from "../public/js/view3d/world.js";
import { RIVER } from "../public/js/world/rivers.js";
import { BUILDINGS } from "../public/js/view3d/assets/buildings/index.js";
import { valleyWorld } from "./support/planFixture.js";

const valley = valleyWorld();
const water = waterLevel(valley.roads);
const masks = buildMasks({ roads: valley.roads, rivers: [], bounds: valley.bounds });
const input = { landmarks: valley.landmarks, terrain: valley.terrain, roads: valley.roads, seed: valley.seed, masks, water };
const placed = planLandmarks(input);
const of = (kind) => placed.find((l) => l.kind === kind);
const eye = (l, up) => [l.x, l.y + up, l.z];
const seen = (l, up, reach = 2500) => seenFromRoad(eye(l, up), { roads: valley.roads, terrain: valley.terrain, reach });

test("the lighthouse stands near the sea, on dry ground", () => {
  const l = of("lighthouse");
  assert.ok(l.y > water, "dry");
  const sea = Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)])
    .some(([dx, dz]) => [100, 200, 300].some((r) => valley.terrain.height(l.x + dx * r, l.z + dz * r) < water));
  assert.ok(sea, "open water within 300 m");
});

test("the lighthouse stands within 25 m of the shore, on a headland", () => {
  const l = of("lighthouse");
  const ring = (radius, count) => Array.from({ length: count }, (_, i) => valley.terrain.height(l.x + Math.cos((i / count) * Math.PI * 2) * radius, l.z + Math.sin((i / count) * Math.PI * 2) * radius) < water);
  let shore = Infinity;
  for (let r = 0; r <= 25 && shore === Infinity; r += 1) if (ring(r, 36).some(Boolean)) shore = r;
  assert.ok(shore <= 25, `the sea is ${shore === Infinity ? "more than 25" : shore} m away`);
  assert.ok(ring(150, 32).filter(Boolean).length >= 12, "at least a third of the ring 150 m round is sea: a headland");
});

test("a stretch of cape-loop sees the lighthouse", () => {
  assert.ok(seen(of("lighthouse"), 30, 700), "some road sample sees the lantern");
});

test("the castle crowns the crag above the southwest village", () => {
  const castle = of("castle");
  const village = valley.settlements.find((s) => s.id === "southwest");
  assert.ok(Math.hypot(castle.x - village.center[0], castle.z - village.center[1]) <= 600, "within 600 m of the village");
  let top = -Infinity;
  for (let dx = -600; dx <= 600; dx += 10) for (let dz = -600; dz <= 600; dz += 10) if (Math.hypot(dx, dz) <= 600) top = Math.max(top, valley.terrain.height(village.center[0] + dx, village.center[1] + dz));
  assert.ok(valley.terrain.height(castle.x, castle.z) >= top - 6, "on the highest ground a road can see");
  assert.ok(seen(castle, 22, 1200), "a road sees the keep");
});

test("the sea arch stands in deep water within sight of a road", () => {
  const arch = of("seaArch");
  assert.equal(arch.y, water, "the water line");
  for (const dx of [-30, 0, 30]) assert.ok(valley.terrain.height(arch.x + dx, arch.z) <= water - 3, `deep at ${dx}`);
  assert.ok(seen(arch, 35, 1200), "a road sees the arch");
});

test("the farm belt has a row of five windmills on dry ground clear of the roads", () => {
  const row = of("windmills");
  assert.equal(row.members.length, 5);
  row.members.forEach((m, i) => {
    assert.ok(m.y > water + 2, "dry");
    assert.ok(valley.terrain.distanceToRoad(m.x, m.z) >= 16, "clear of the road");
    if (i > 0) assert.ok(Math.abs(Math.hypot(m.x - row.members[i - 1].x, m.z - row.members[i - 1].z) - MILL_SPACING) < 1e-6);
  });
  assert.ok(seen(row, 18, 1200), "a road sees the sails");
});

test("balloons loop 600 to 1,500 m round the centre at 250 to 450 m", () => {
  const { members } = of("balloons");
  assert.equal(members.length, 4);
  for (const b of members) {
    assert.ok(b.radius >= 600 && b.radius <= 1500 && b.y >= 250 && b.y <= 450, `${b.radius} m at ${b.y} m`);
  }
  assert.ok(members.some((b) => b.speed > 0) && members.some((b) => b.speed < 0), "both directions");
});

test("an unknown landmark kind is skipped", () => {
  const out = planLandmarks({ ...input, landmarks: [{ id: "x", kind: "nothing", center: [0, 0], yaw: 0, apron: 10, count: 0 }] });
  assert.deepEqual(out, []);
});

test("each apron is stamped built, the sea arch's water excepted", () => {
  const fresh = buildMasks({ roads: valley.roads, rivers: [], bounds: valley.bounds });
  const out = planLandmarks({ ...input, masks: fresh });
  const light = out.find((l) => l.kind === "lighthouse");
  assert.equal(maskAt(fresh, light.x, light.z), MASK.built);
  const row = out.find((l) => l.kind === "windmills");
  for (const m of row.members) assert.equal(maskAt(fresh, m.x, m.z), MASK.built);
});

test("a ridge between the road and the point blocks the view", () => {
  const ridge = { height: (x) => (Math.abs(x - 500) < 30 ? 80 : 0) };
  const roads = { samples: [{ x: 0, z: 0 }] };
  assert.equal(seenFromRoad([1000, 10, 0], { roads, terrain: ridge }), false);
  assert.equal(seenFromRoad([300, 10, 0], { roads, terrain: ridge }), true);
  assert.equal(seenFromRoad([300, 10, 0], { roads, terrain: ridge, reach: 100 }), false, "out of reach");
});

test("no landmark, town plot or farm yard stands in a river of the valley as built", () => {
  const { network } = valley;
  const world = buildWorld(network.roads()[0], { network, detail: "low" });
  const { terrain, plan } = world;
  const wet = (x, z, r) => terrain.riverDistance(x, z) < r;
  for (const l of plan.landmarks) if (l.kind !== "seaArch" && l.kind !== "balloons") assert.ok(!wet(l.x, l.z, l.apron), `${l.id} clear of rivers`);
  for (const s of plan.settlements) for (const p of s.plots) assert.ok(!wet(p.x, p.z, 8), `${s.id} plot clear of rivers`);
  for (const f of plan.farms) assert.ok(!wet(f.x, f.z, 42), "farm yard clear of rivers");
});

test("the castle's whole footprint, towers and walls, keeps 2 m from the river's water", () => {
  const { network } = valley;
  const { terrain, plan } = buildWorld(network.roads()[0], { network, detail: "low" });
  const castle = plan.landmarks.find((l) => l.kind === "castle");
  const { width, depth } = BUILDINGS.castle.parts({ seed: 1 });
  const [c, s] = [Math.cos(castle.yaw), Math.sin(castle.yaw)];
  const steps = 8;
  const rim = [];
  for (let i = 0; i <= steps; i += 1) {
    const [u, v] = [(i / steps - 0.5) * width, (i / steps - 0.5) * depth];
    rim.push([u, -depth / 2], [u, depth / 2], [-width / 2, v], [width / 2, v]);
  }
  for (const [u, v] of [[0, 0], ...rim]) {
    const [x, z] = [castle.x + u * c + v * s, castle.z - u * s + v * c];
    assert.ok(terrain.riverDistance(x, z) > RIVER.halfWidth + 2, `footprint point ${x.toFixed(0)},${z.toFixed(0)} is ${terrain.riverDistance(x, z).toFixed(1)} m from the river's centre`);
  }
});

test("the castle's reported footprint reaches the round keep's far edge", () => {
  const { width, depth } = BUILDINGS.castle.parts({ seed: 1 });
  assert.ok(width / 2 >= 22 + 6 && depth / 2 >= 16 + 6, `${width} x ${depth}`);
});

/** Height of the drawn ground (the near grid's triangles, as the terrain layer cuts them) at x, z. */
function meshHeight(grid, x, z) {
  const [fi, fj] = [(x - grid.x0) / grid.cell, (z - grid.z0) / grid.cell];
  const [i, j] = [Math.floor(fi), Math.floor(fj)];
  const [u, v] = [fi - i, fj - j];
  const h = (di, dj) => grid.heights[(j + dj) * grid.columns + i + di];
  // Cell triangles a,b,d and b,c,d with a=(i,j) b=(i,j+1) c=(i+1,j+1) d=(i+1,j): the diagonal runs b-d.
  if (u + v <= 1) return h(0, 0) + (h(1, 0) - h(0, 0)) * u + (h(0, 1) - h(0, 0)) * v;
  return h(1, 1) + (h(0, 1) - h(1, 1)) * (1 - u) + (h(1, 0) - h(1, 1)) * (1 - v);
}

test("along every river the drawn ground stays below the water, across the middle of its width", () => {
  const { network } = valley;
  const world = buildWorld(network.roads()[0], { network, detail: "low" });
  const { positions } = world.rivers.strips;
  const grid = world.ground.near;
  const checked = [];
  // The ribbon's vertices come in left/right pairs per sample (ponds follow as fans, only the pairs are walked here).
  const pairs = Math.floor(positions.length / 6);
  for (let k = 0; k < pairs; k += 1) {
    const [lx, ly, lz, rx, , rz] = positions.slice(k * 6, k * 6 + 6);
    if (!(ly > -Infinity)) continue;
    for (const t of [0.5, 0.35, 0.65]) {
      const [x, z] = [lx + (rx - lx) * t, lz + (rz - lz) * t];
      if (x < grid.x0 || z < grid.z0 || x > grid.x0 + (grid.columns - 1) * grid.cell || z > grid.z0 + (grid.rows - 1) * grid.cell) continue;
      if (Math.hypot(rx - lx, rz - lz) > 2 * (RIVER.halfWidth + 2)) continue; // a pond fan, not a river pair
      checked.push([x, z, ly]);
      if (t === 0.5) assert.ok(world.terrain.height(x, z) < ly, `terrain below the water at ${x.toFixed(0)},${z.toFixed(0)}`);
      assert.ok(meshHeight(grid, x, z) < ly, `drawn ground below the water at ${x.toFixed(0)},${z.toFixed(0)}, t ${t}: ${meshHeight(grid, x, z).toFixed(2)} vs ${ly.toFixed(2)}`);
    }
  }
  assert.ok(checked.length > 50, `${checked.length} samples`);
});
