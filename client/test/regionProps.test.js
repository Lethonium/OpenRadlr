import assert from "node:assert/strict";
import { test } from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { temperate } from "../public/js/view3d/biomes/index.js";
import { Occupancy } from "../public/js/view3d/features.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { PROPS } from "../public/js/view3d/regions/props.js";
import { REGION_STYLES } from "../public/js/view3d/regions/styles.js";
import { VERGE } from "../public/js/view3d/roadWidth.js";
import { buildRegionProps, roadHalfWidth } from "../public/js/view3d/world.js";

function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function draw(name, yaw = 0) {
  const mesh = new MeshBuilder();
  const { radius } = PROPS[name]({ mesh, x: 3, y: 2, z: -4, yaw, random: lcg(7) });
  return { mesh, radius };
}

test("PROPS covers every prop a region style names", () => {
  const named = new Set(Object.values(REGION_STYLES).flatMap((style) => style.props.kinds));
  for (const name of named) assert.equal(typeof PROPS[name], "function", name);
});

for (const name of Object.keys(PROPS)) {
  test(`${name} draws up to 300 triangles within its radius, at any yaw`, () => {
    for (const yaw of [0, 1, 2.5]) {
      const { mesh, radius } = draw(name, yaw);
      const triangles = mesh.vertexCount / 3;
      assert.ok(triangles > 0 && triangles <= 300, `${triangles}`);
      assert.ok(radius > 0);
      const p = mesh.positions.toFloat32();
      for (let i = 0; i < p.length; i += 3) {
        assert.ok(Math.hypot(p[i] - 3, p[i + 2] + 4) <= radius + 0.5, `${name} vertex outside its radius`);
        assert.ok(p[i + 1] >= 2 - 0.6 && p[i + 1] <= 2 + 2.2, `${name} height ${p[i + 1] - 2}`);
      }
    }
  });
}

test("a stone wall panel is 6 m long, under a metre high, and runs along its yaw", () => {
  const p = draw("stoneWall", 0).mesh.positions.toFloat32();
  const xs = [];
  const zs = [];
  let top = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    xs.push(p[i]);
    zs.push(p[i + 2]);
    top = Math.max(top, p[i + 1] - 2);
  }
  assert.ok(Math.max(...xs) - Math.min(...xs) > 5.5);
  assert.ok(Math.max(...zs) - Math.min(...zs) < 1);
  assert.ok(top > 0.8 && top < 1.1, `${top}`);
});

// A straight east road, so a side is the sign of z.
const FLAT = { height: () => 30, distanceToRoad: (x, z) => Math.abs(z), seed: 1 };
const LINE = new RouteGeometry({ id: "t", name: "T", points: [[0, 0], [500, 0]], lanes: 2, markers: [], zones: {}, closed: false, seed: 5 });
const HALF = roadHalfWidth(2) + VERGE;
const region = (kind) => () => [{ kind, weight: 1 }];
const propsOn = (terrain, options = {}) => buildRegionProps(LINE, terrain, { regionsAt: region("oliveTerraces"), water: -50, seed: 4, biome: temperate, ...options });

test("an olive terrace's 500 m of road gets at least five stone wall panels, parallel to the road", () => {
  const { items, mesh } = propsOn(FLAT, { into: new MeshBuilder() });
  assert.ok(items.filter((item) => item.prop === "stoneWall").length >= 5, `${items.map((i) => i.prop)}`);
  assert.ok(items.every((item) => Math.abs(item.z) >= HALF + 5), "nothing near the asphalt");
  assert.ok(items.every((item) => Math.abs(item.z) <= HALF + 12.5));
  assert.ok(mesh.vertexCount > 0);
});

test("props keep off the sea side, where water lies within 18 m of the road's edge", () => {
  const sea = { ...FLAT, height: (x, z) => (z > 0 && z > HALF + 12 ? -10 : 30) };
  const { items } = propsOn(sea, { water: 0 });
  assert.ok(items.filter((item) => item.z < 0).length > 3);
  assert.equal(items.filter((item) => item.z > 0).length, 0);
});

test("a boardwalk only lies where water is within 12 m of the road", () => {
  const regionsAt = region("wetland");
  const dry = propsOn(FLAT, { regionsAt });
  assert.equal(dry.count, 0);
  const wet = { ...FLAT, height: (x, z) => (Math.abs(z) > HALF + 11 ? -10 : 30) };
  const { items } = propsOn(wet, { regionsAt, water: 0 });
  assert.ok(items.length > 3 && items.every((item) => item.prop === "boardwalk"));
});

test("no prop stands in a blocked area or on top of an occupied one", () => {
  const blocked = (x) => x > 100 && x < 300;
  const { items } = propsOn(FLAT, { blocked });
  assert.ok(items.length > 3 && items.every((item) => !blocked(item.x)));
  const occupancy = new Occupancy();
  occupancy.add(250, 0, 120);
  const placed = propsOn(FLAT, { occupancy });
  assert.ok(placed.items.every((item) => Math.hypot(item.x - 250, item.z) >= 120), "the apron stays clear");
  assert.ok(placed.items.length > 0);
});

test("props enter the occupancy, are the same every time, and need a region", () => {
  const occupancy = new Occupancy();
  const first = propsOn(FLAT, { occupancy });
  const item = first.items[0];
  assert.equal(occupancy.blocked(item.x, item.z, 0), true);
  assert.deepEqual(propsOn(FLAT).items, propsOn(FLAT).items);
  assert.equal(propsOn(FLAT, { regionsAt: () => [] }).count, 0);
  assert.equal(propsOn(FLAT, { regionsAt: null }).count, 0);
});
