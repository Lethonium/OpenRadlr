/**
 * Landmarks (#117): hand-placed in the map, built once into the village groups
 * with an apron reserved before anything scatters. Scenery off builds none.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { roadNetworkOf } from "../public/js/route/worldMap.js";
import { floraOf } from "../public/js/view3d/scenery/flora.js";
import { ChunkedMesh } from "../public/js/view3d/chunks.js";
import { Occupancy } from "../public/js/view3d/features.js";
import { LANDMARKS, buildLandmarks } from "../public/js/view3d/landmarks.js";
import { balloonAt, buildBalloon } from "../public/js/view3d/structures.js";
import { seededRandom } from "../public/js/view3d/noise.js";
import { forestAt } from "../public/js/land/land.js";
import { buildWorld } from "../public/js/view3d/world.js";
import { sceneOf } from "../public/js/view3d/worldScene.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const VALLEY = read("../../routes/maps/valley.json");
const ROUTE = read("../../routes/rolling-hills.json");

const TRIANGLE = {
  name: "box",
  triangles: [
    [-4, 0, -4, 0.6, 0.3, 0.2],
    [4, 0, -4, 0.6, 0.3, 0.2],
    [0, 6, 4, 0.6, 0.3, 0.2],
  ],
  bounds: { min: [-4, 0, -4], max: [4, 6, 4] },
};
const SCENES = {
  nearRange: 180,
  kits: [{
    name: "town",
    licence: "CC0-1.0",
    provenance: { pack: "https://example.org", licence: "https://creativecommons.org/publicdomain/zero/1.0/", taken: "2026-11-17" },
    models: {
      house: { role: "houses", near: "house", far: "house" },
      church: { role: "church", near: "church", far: "church" },
      fountain: { role: "fountains", near: "fountain", far: "fountain" },
    },
    files: { house: TRIANGLE, church: TRIANGLE, fountain: TRIANGLE },
  }],
};

const FLAT = { height: () => 10 };
const triangles = (mesh) => mesh.vertexCount / 3;
const colorsOf = (mesh) => Array.from({ length: mesh.vertexCount }, (_, v) => Array.from(mesh.colors.slice(v * 4, v * 4 + 3)));
const heights = (mesh) => Array.from({ length: mesh.vertexCount }, (_, v) => mesh.positions[v * 3 + 1]);

test("a lighthouse builds a near and a cheap far mesh in white and red", () => {
  const built = LANDMARKS.lighthouse.build({ terrain: FLAT, center: [100, 200], yaw: 0, water: 0, random: seededRandom(1) });
  assert.ok(built.near.vertexCount > built.far.vertexCount, "the near mesh is the richer one");
  assert.ok(triangles(built.far) > 0 && triangles(built.far) <= 60, `far has ${triangles(built.far)} triangles`);
  for (const mesh of [built.near, built.far]) {
    const colors = colorsOf(mesh);
    assert.ok(colors.some(([r, g, b]) => r > 0.85 && g > 0.85 && b > 0.8), "white band");
    assert.ok(colors.some(([r, g, b]) => r > 0.6 && g < 0.3 && b < 0.3), "red band");
  }
  assert.deepEqual(built.at, [100, 10, 200], "it stands on the ground at its spot");
});

test("the lighthouse lamp is in the bright group, up in the lantern", () => {
  const built = LANDMARKS.lighthouse.build({ terrain: FLAT, center: [0, 0], yaw: 0, water: 0, random: seededRandom(1) });
  assert.ok(built.bright.vertexCount > 0, "a lit lamp");
  const top = Math.max(...heights(built.near));
  assert.ok(Math.min(...heights(built.bright)) > top * 0.6, "the lamp sits in the top of the tower");
});

test("a lighthouse on a slope sinks its foot below the ground instead of floating", () => {
  const slope = { height: (x) => 10 + x * 0.1 };
  const built = LANDMARKS.lighthouse.build({ terrain: slope, center: [0, 0], yaw: 0, water: 0, random: seededRandom(1) });
  assert.ok(Math.min(...heights(built.near)) < -0.5, "the foundation reaches below the stand point");
  assert.ok(built.at[1] >= 10, "and the stand point is the high side of the footprint");
});

test("a castle ruin builds a curtain wall with gaps and one tower taller than the walls", () => {
  const built = LANDMARKS.castle.build({ terrain: FLAT, center: [0, 0], yaw: 0, water: 0, random: seededRandom(1) });
  assert.ok(built.walls.length >= 4, "a wall on every side");
  assert.ok(built.gaps >= 2, `${built.gaps} gaps in the curtain`);
  const top = Math.max(...heights(built.near));
  assert.ok(top >= built.towerHeight - 0.01 && built.towerHeight > built.wallHeight * 1.8, "one tower stands well above the broken walls");
  assert.ok(triangles(built.far) > 0 && triangles(built.far) <= 60, `far has ${triangles(built.far)} triangles`);
  assert.ok(built.near.vertexCount > built.far.vertexCount);
  assert.ok(colorsOf(built.near).every(([r, g, b]) => Math.abs(r - g) < 0.12 && b <= r + 0.01), "stone, not painted");
});

test("the castle's walls follow a slope: every corner is founded below the ground", () => {
  const slope = { height: (x, z) => 10 + x * 0.25 + z * 0.1 };
  const built = LANDMARKS.castle.build({ terrain: slope, center: [0, 0], yaw: 0, water: 0, random: seededRandom(1) });
  for (const [cx, cz] of built.corners) {
    const near = Array.from({ length: built.near.vertexCount }, (_, v) => v)
      .filter((v) => Math.hypot(built.near.positions[v * 3] - cx, built.near.positions[v * 3 + 2] - cz) < 3)
      .map((v) => built.near.positions[v * 3 + 1] + built.at[1]);
    assert.ok(near.length > 0, "a wall reaches the corner");
    assert.ok(Math.min(...near) <= slope.height(cx, cz), `corner ${cx},${cz} floats: lowest ${Math.min(...near)} over ground ${slope.height(cx, cz)}`);
  }
});

test("a sea arch rises from the water on two feet and leaves the middle open", () => {
  const sea = { height: () => -20 };
  const built = LANDMARKS.seaArch.build({ terrain: sea, center: [0, 0], yaw: 0, water: -2.4, random: seededRandom(1) });
  assert.ok(triangles(built.far) > 0 && triangles(built.far) <= 60, `far has ${triangles(built.far)} triangles`);
  assert.equal(built.at[1], -2.4, "local zero is the water line");
  const xs = Array.from({ length: built.near.vertexCount }, (_, v) => built.near.positions[v * 3]);
  const ys = heights(built.near);
  const span = built.span;
  for (const side of [-1, 1]) {
    const foot = ys.filter((_, v) => Math.sign(xs[v]) === side && Math.abs(xs[v]) > span * 0.35);
    assert.ok(Math.min(...foot) + built.at[1] < -2.4 - 2, "a foot reaches below the surface");
  }
  assert.ok(Math.max(...ys) > 28 && Math.max(...ys) < 42, `${Math.max(...ys)} m high`);
  const p = built.near.positions;
  for (let t = 0; t < built.near.vertexCount; t += 3) {
    const verts = [0, 1, 2].map((k) => [p[(t + k) * 3], p[(t + k) * 3 + 1]]);
    const crossesOpening = verts.some(([x, y]) => Math.abs(x) < span * 0.15 && y > 0 && y < 8);
    assert.ok(!crossesOpening, "nothing stands in the middle opening above the water, below 8 m");
  }
  assert.ok(colorsOf(built.near).some(([r, g, b]) => r > 0.7 && g > 0.65 && b > 0.5), "pale limestone");
});

test("buildLandmarks places each landmark, reserves its apron and returns the movers", () => {
  const near = new ChunkedMesh();
  const far = new ChunkedMesh();
  const bright = new ChunkedMesh();
  const occupancy = new Occupancy();
  const list = [{ id: "a", kind: "lighthouse", center: [300, -400], yaw: 0, apron: 25 }];
  const result = buildLandmarks(list, { terrain: FLAT, near, far, bright, occupancy, water: 0 });
  assert.deepEqual(result.movers, []);
  assert.ok(near.vertexCount > 0 && far.vertexCount > 0 && bright.vertexCount > 0);
  assert.ok(occupancy.blocked(300, -400), "the apron is reserved");
  assert.ok(occupancy.blocked(320, -400), "out to the apron's edge");
  assert.ok(!occupancy.blocked(340, -400), "and no further");
});

test("an unknown landmark kind is skipped, not fatal", () => {
  const near = new ChunkedMesh();
  const result = buildLandmarks([{ id: "x", kind: "nothing", center: [0, 0], apron: 10 }], { terrain: FLAT, near, far: null, bright: null, occupancy: new Occupancy(), water: 0 });
  assert.deepEqual(result.movers, []);
  assert.equal(near.vertexCount, 0);
});


const windmills = (terrain = FLAT, count = 5, yaw = 0) => LANDMARKS.windmills.build({ terrain, center: [0, 0], yaw, water: 0, random: seededRandom(1), count });

test("windmills build a row of stone towers 60 to 90 m apart, each with sails at the cap", () => {
  const built = windmills();
  assert.equal(built.mills.length, 5);
  assert.equal(built.movers.length, 5);
  for (let i = 1; i < built.mills.length; i += 1) {
    const gap = Math.hypot(built.mills[i][0] - built.mills[i - 1][0], built.mills[i][2] - built.mills[i - 1][2]);
    assert.ok(gap >= 60 && gap <= 90, `gap ${gap.toFixed(1)} m`);
  }
  const first = built.mills[0];
  const last = built.mills[4];
  for (const mill of built.mills) {
    const cross = (last[0] - first[0]) * (mill[2] - first[2]) - (last[2] - first[2]) * (mill[0] - first[0]);
    assert.ok(Math.abs(cross) < 1, "the mills stand on one line");
  }
  built.mills.forEach((mill, i) => {
    const mover = built.movers[i];
    assert.equal(mover.kind, "sails");
    assert.ok(Math.hypot(mover.at[0] - mill[0], mover.at[2] - mill[2]) < 6, "the sails are at their own tower");
    assert.ok(mover.at[1] - mill[1] > 7 && mover.at[1] - mill[1] < 13, "up at the cap");
    assert.ok(mover.speed > 0 && mover.speed < 0.6, "slowly");
  });
  assert.equal(new Set(built.movers.map((m) => m.phase)).size, 5, "no two wheels in step");
});

test("a windmill tower is round, tapers, and is warm sandstone", () => {
  const built = windmills();
  const [mx, world, mz] = built.mills[2];
  const my = world - built.at[1]; // the mill's ground in the mesh's own frame
  const p = built.near.positions;
  const near = Array.from({ length: built.near.vertexCount }, (_, v) => v).filter((v) => Math.hypot(p[v * 3] - mx, p[v * 3 + 2] - mz) < 4.2);
  const reach = (from, to) => Math.max(...near.filter((v) => p[v * 3 + 1] - my >= from && p[v * 3 + 1] - my <= to).map((v) => Math.hypot(p[v * 3] - mx, p[v * 3 + 2] - mz)));
  assert.ok(reach(0, 1) > reach(7.5, 8.5) + 0.5, "narrower at the top");
  assert.ok(Math.max(...near.map((v) => p[v * 3 + 1] - my)) >= 10, "10 m or more tall");
  const sandstone = colorsOf(built.near).filter(([r, g, b]) => r > 0.7 && r > g && g > b + 0.1 && r < 0.95);
  assert.ok(sandstone.length > 50, "sandstone");
});

test("the far twin of a windmill row stays under 60 triangles", () => {
  const built = windmills();
  assert.ok(triangles(built.far) > 0 && triangles(built.far) <= 60, `far has ${triangles(built.far)} triangles`);
  assert.ok(built.near.vertexCount > built.far.vertexCount);
  assert.ok(triangles(windmills(FLAT, 9).far) <= 60, "however many are asked for");
});

test("each windmill is founded on the ground under it on a slope", () => {
  const slope = { height: (x, z) => 10 + x * 0.08 + z * 0.02 };
  const built = windmills(slope);
  built.mills.forEach(([x, y, z]) => assert.ok(Math.abs(y - slope.height(x, z)) < 0.5, "the stand point is the ground"));
  const bottom = Math.min(...heights(built.near)) + built.at[1];
  assert.ok(bottom < slope.height(built.mills[0][0], built.mills[0][2]), "the foot reaches into the slope");
});

test("buildLandmarks keeps every windmill clear and returns its sails as movers", () => {
  const occupancy = new Occupancy();
  const list = [{ id: "w", kind: "windmills", center: [0, 0], yaw: 0, apron: 14, count: 5 }];
  const result = buildLandmarks(list, { terrain: FLAT, near: new ChunkedMesh(), far: new ChunkedMesh(), bright: null, occupancy, water: 0 });
  assert.equal(result.movers.length, 5);
  for (const mover of result.movers) assert.ok(occupancy.blocked(mover.at[0], mover.at[2]), "a mill's ground is reserved");
});

// The real map.
const network = roadNetworkOf(VALLEY);
const on = buildWorld(new RouteGeometry(ROUTE), { network, scenery: floraOf(SCENES, "temperate") });
const lighthouse = network.landmarks.find((l) => l.kind === "lighthouse");

test("the map has a lighthouse on the cape", () => {
  assert.ok(lighthouse, "a lighthouse is in the map");
  assert.deepEqual(lighthouse.center, [4500, 2960], "map y is north-up, world z is −y");
});

test("every landmark stands on dry ground clear of the roads", () => {
  for (const l of network.landmarks.filter((m) => m.kind !== "seaArch")) {
    const height = on.terrain.height(l.center[0], l.center[1]);
    assert.ok(height > on.waterLevel + 2, `${l.id} is ${height.toFixed(1)} m, water is ${on.waterLevel}`);
    assert.ok(on.terrain.distanceToRoad(l.center[0], l.center[1]) >= l.apron, `${l.id} is clear of the roads`);
  }
});

test("the lighthouse is in the village groups and its lamp in the bright group", () => {
  const near = (chunks) => (chunks ?? []).some((c) => Math.hypot(c.center[0] - lighthouse.center[0], c.center[2] - lighthouse.center[1]) < 60 && c.mesh.vertexCount > 0);
  assert.ok(near(on.chunks.village), "near twin");
  assert.ok(near(on.chunks.villageFar), "far twin");
  assert.ok(near(on.chunks.bright), "lamp");
  assert.ok(on.movers.every((m) => m.kind === "sails" || m.kind === "balloon"), "the only movers are the windmills' sails and the balloons");
});

test("no tree, cover or prop stands within the lighthouse's apron", () => {
  const [cx, cz] = lighthouse.center;
  for (const group of ["scenery", "sceneryFar", "cover", "detail"]) {
    for (const chunk of on.chunks[group] ?? []) {
      for (const batch of chunk.batches ?? []) {
        for (let i = 0; i < batch.matrices.length; i += 16) {
          const d = Math.hypot(batch.matrices[i + 12] - cx, batch.matrices[i + 14] - cz);
          assert.ok(d >= lighthouse.apron, `${group} instance ${d.toFixed(1)} m from the lighthouse`);
        }
      }
    }
  }
});

test("the lighthouse stands near the sea, on dry ground", () => {
  const [cx, cz] = lighthouse.center;
  const sea = Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)])
    .some(([dx, dz]) => [100, 200, 300].some((r) => on.terrain.height(cx + dx * r, cz + dz * r) < on.waterLevel));
  assert.ok(sea, "open water within 300 m");
});

/** Metres of `routeFile`'s road (sampled every 20 m) from which a point `top` m above its ground is in line of sight; woods beyond the apron block the view. */
function seenAlong(routeFile, [cx, cz], ground, top, apron, minRange, maxRange) {
  const lamp = ground + top;
  const seed = network.seed;
  const route = new RouteGeometry(read(`../../routes/${routeFile}`));
  const sees = (x, z, eye) => {
    const dist = Math.hypot(cx - x, cz - z);
    const steps = Math.floor(dist / 10);
    for (let i = 1; i < steps; i += 1) {
      const f = i / steps;
      const px = x + (cx - x) * f;
      const pz = z + (cz - z) * f;
      const line = eye + (lamp - eye) * f;
      const land = on.terrain.height(px, pz);
      if (land > line - 1) return false;
      // The landmark's own apron keeps the wood back; beyond it, woods on land block.
      if (dist * (1 - f) > apron && land > on.waterLevel && forestAt(px, pz, seed) > 0.5) return false;
    }
    return true;
  };
  let seen = 0;
  for (let d = 0; d < route.length; d += 20) {
    const p = route.positionAt(d);
    const range = Math.hypot(p.x - cx, -p.y - cz);
    if (range < minRange || range > maxRange) continue;
    if (sees(p.x, -p.y, on.terrain.height(p.x, -p.y) + 3)) seen += 1;
  }
  return seen * 20;
}

test("a stretch of cape-loop sees the lighthouse across open ground or water", () => {
  const seen = seenAlong("cape-loop.json", lighthouse.center, on.terrain.height(...lighthouse.center), 30, lighthouse.apron, 150, 600);
  assert.ok(seen >= 200, `cape-loop sees it along ${seen} m of road`);
});

const castle = network.landmarks.find((l) => l.kind === "castle");
const southwest = network.settlements.find((s) => s.id === "southwest");

/** The highest ground within `radius` of `center`, on a 10 m grid. */
function highestNear(terrain, [cx, cz], radius) {
  let best = { height: -Infinity, at: [cx, cz] };
  for (let dx = -radius; dx <= radius; dx += 10) {
    for (let dz = -radius; dz <= radius; dz += 10) {
      if (Math.hypot(dx, dz) > radius) continue;
      const height = terrain.height(cx + dx, cz + dz);
      if (height > best.height) best = { height, at: [cx + dx, cz + dz] };
    }
  }
  return best;
}

test("the castle crowns the crag above the southwest village", () => {
  assert.ok(castle, "a castle is in the map");
  assert.ok(Math.hypot(castle.center[0] - southwest.center[0], castle.center[1] - southwest.center[1]) <= 600, "within 600 m of the village");
  const top = highestNear(on.terrain, southwest.center, 600);
  const ground = on.terrain.height(...castle.center);
  // The very highest knoll is deep in the wood and no road sees it: the crag is
  // the highest ground a road can see, which is within a few metres of it.
  assert.ok(ground >= top.height - 6, `crag ${ground.toFixed(1)} m, highest ground ${top.height.toFixed(1)} m`);
});

test("a road sees the castle's tower rise over the trees", () => {
  const ground = on.terrain.height(...castle.center);
  const seen = ["cape-loop.json", "riverside-flats.json"].map((f) => seenAlong(f, castle.center, ground, 22, castle.apron, 150, 1200));
  assert.ok(Math.max(...seen) >= 200, `the best road sees it along ${Math.max(...seen)} m`);
});

test("the castle is in the village groups and reserves its apron", () => {
  const near = (chunks) => (chunks ?? []).some((c) => Math.hypot(c.center[0] - castle.center[0], c.center[2] - castle.center[1]) < 80 && c.mesh.vertexCount > 0);
  assert.ok(near(on.chunks.village) && near(on.chunks.villageFar));
});

const seaArch = network.landmarks.find((l) => l.kind === "seaArch");

test("the sea arch stands in deep water within sight of a road", () => {
  assert.ok(seaArch, "a sea arch is in the map");
  const [ax, az] = seaArch.center;
  for (const dx of [-30, 0, 30]) {
    assert.ok(on.terrain.height(ax + dx, az) <= on.waterLevel - 3, `the sea is ${(on.waterLevel - on.terrain.height(ax + dx, az)).toFixed(1)} m deep at ${dx}`);
  }
  const seen = ["cape-loop.json", "island-tour.json"].map((f) => seenAlong(f, seaArch.center, on.waterLevel, 35, 0, 100, 1200));
  assert.ok(Math.max(...seen) >= 200, `a road sees it along ${Math.max(...seen)} m`);
});

test("the sea arch is in the village groups", () => {
  const [ax, az] = seaArch.center;
  const near = (chunks) => (chunks ?? []).some((c) => Math.hypot(c.center[0] - ax, c.center[2] - az) < 100 && c.mesh.vertexCount > 0);
  assert.ok(near(on.chunks.village) && near(on.chunks.villageFar));
});

const windmillRow = network.landmarks.find((l) => l.kind === "windmills");

test("the farm belt has a row of five windmills on dry ground clear of the roads", () => {
  assert.ok(windmillRow, "windmills are in the map");
  assert.equal(windmillRow.count, 5);
  const mills = on.movers.filter((m) => m.kind === "sails");
  assert.equal(mills.length, 5);
  for (const m of mills) {
    assert.ok(on.terrain.height(m.at[0], m.at[2]) > on.waterLevel + 2, "dry");
    assert.ok(on.terrain.distanceToRoad(m.at[0], m.at[2]) >= 16, "clear of the road");
  }
});

test("a road sees the windmills' sails turn over the trees", () => {
  const ground = on.terrain.height(...windmillRow.center);
  const seen = ["riverside-flats.json", "cape-loop.json", "island-tour.json", "balcony-road.json", "col-de-la-forge.json"].map((f) => seenAlong(f, windmillRow.center, ground, 18, windmillRow.apron, 100, 1200));
  assert.ok(Math.max(...seen) >= 200, `the best road sees them along ${Math.max(...seen)} m`);
});

test("the windmills are in the village groups and the scene carries their sails", () => {
  const near = (chunks) => (chunks ?? []).some((c) => Math.hypot(c.center[0] - windmillRow.center[0], c.center[2] - windmillRow.center[1]) < 200 && c.mesh.vertexCount > 0);
  assert.ok(near(on.chunks.village) && near(on.chunks.villageFar));
  assert.deepEqual(sceneOf(on).movers, on.movers);
});

test("scenery off builds no landmarks and no movers", () => {
  const off = buildWorld(new RouteGeometry(ROUTE), { network });
  assert.equal(off.movers, undefined);
  assert.equal(off.chunks.village, undefined);
});

// Balloons (#117).
const balloons = (count = 4, center = [600, 300]) => LANDMARKS.balloons.build({ terrain: FLAT, center, yaw: 0, water: 0, random: seededRandom(5), count });

test("balloons are movers on loops of 600 to 1,500 m round the entry's centre at 250 to 450 m", () => {
  const built = balloons(4);
  assert.equal(built.movers.length, 4);
  for (const m of built.movers) {
    assert.equal(m.kind, "balloon");
    assert.deepEqual(m.center, [600, 300]);
    assert.ok(m.radius >= 600 && m.radius <= 1500, `loop radius ${m.radius}`);
    assert.ok(m.altitude >= 250 && m.altitude <= 450, `altitude ${m.altitude}`);
    // A loop takes several minutes, not seconds and not hours.
    const period = (Math.PI * 2) / Math.abs(m.speed);
    assert.ok(period >= 240 && period <= 1800, `a loop takes ${period.toFixed(0)} s`);
  }
  assert.equal(new Set(built.movers.map((m) => m.radius)).size, 4, "no two on the same loop");
  assert.equal(new Set(built.movers.map((m) => m.phase)).size, 4, "no two in step");
  assert.equal(new Set(built.movers.map((m) => m.palette)).size, 4, "four colour schemes");
});

test("a balloon's loop is clock-driven: the same time gives the same place, a later one a different place", () => {
  const [m] = balloons(1).movers;
  assert.deepEqual(balloonAt(m, 100), balloonAt(m, 100));
  assert.notDeepEqual(balloonAt(m, 100), balloonAt(m, 160));
  for (const t of [0, 97, 2000]) {
    const [x, y, z] = balloonAt(m, t);
    assert.ok(Math.abs(Math.hypot(x - 600, z - 300) - m.radius) < 1e-6, "on its loop");
    assert.ok(Math.abs(y - m.altitude) <= 4, "near its altitude");
  }
  const period = (Math.PI * 2) / Math.abs(m.speed);
  const [a, , c] = balloonAt(m, 10);
  const [b, , d] = balloonAt(m, 10 + period);
  assert.ok(Math.hypot(a - b, c - d) < 1e-6, "back where it started after one loop");
});

test("a balloon is a pear of ten gores in two bright colours, a basket and ropes, in 200 triangles", () => {
  for (let palette = 0; palette < 4; palette += 1) {
    const mesh = buildBalloon(palette);
    assert.ok(mesh.vertexCount / 3 <= 200, `${mesh.vertexCount / 3} triangles`);
    assert.ok(mesh.vertexCount / 3 >= 100, "not a stub");
    const colours = new Set(colorsOf(mesh).map((c) => c.map((v) => v.toFixed(2)).join()));
    const bright = [...colours].filter((c) => Math.max(...c.split(",").map(Number)) > 0.85);
    assert.ok(bright.length >= 2, `two bright envelope colours in ${[...colours]}`);
    const ys = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    assert.ok(Math.min(...ys) < -2, "the basket hangs below the envelope's mouth");
    assert.ok(Math.max(...ys) > 14, "an envelope some 20 m tall");
  }
});

test("balloons reserve no ground and add no baked mesh", () => {
  const near = new ChunkedMesh();
  const occupancy = new Occupancy();
  const result = buildLandmarks([{ id: "b", kind: "balloons", center: [600, 300], yaw: 0, apron: 0, count: 4 }], { terrain: FLAT, near, far: new ChunkedMesh(), bright: null, occupancy, water: 0 });
  assert.equal(result.movers.length, 4);
  assert.equal(near.vertexCount, 0);
  assert.ok(!occupancy.blocked(600, 300));
});

const balloonEntry = network.landmarks.find((l) => l.kind === "balloons");

test("the valley has four balloons over its centre, and the scene carries them", () => {
  assert.ok(balloonEntry, "balloons are in the map");
  assert.deepEqual(balloonEntry.center, [600, 300], "map y is north-up, world z is −y");
  const flying = on.movers.filter((m) => m.kind === "balloon");
  assert.equal(flying.length, 4);
  assert.deepEqual(sceneOf(on).movers.filter((m) => m.kind === "balloon"), flying);
});
