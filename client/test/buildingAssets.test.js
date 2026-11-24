import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import * as THREE from "../public/js/three.js";
import { BUILDINGS } from "../public/js/view3d/assets/buildings/index.js";
import { HOUSE_STYLES } from "../public/js/view3d/assets/buildings/house.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const SEASONS = ["spring", "summer", "autumn", "winter"];
const IDS = Object.keys(BUILDINGS);
const SEEDS = [1, 2, 3, 4, 5, 6];
/** Triangle budgets from the plan: near, near without detail, far. */
const BUDGET = {
  house: { near: 600, plain: 300, far: 24 },
  farmstead: { near: 3000, plain: 3000, far: 80 },
  streetLamp: { near: 120, plain: 120, far: 12 },
  cathedral: { near: 4000, plain: 4000, far: 120 },
};

const triangles = (geometry) => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
const total = (list) => list.reduce((sum, part) => sum + triangles(part.geometry ?? part), 0);
const bounds = (list) => list.reduce((b, part) => ((part.geometry ?? part).computeBoundingBox(), b.union((part.geometry ?? part).boundingBox)), new THREE.Box3());
const build = (id, options) => BUILDINGS[id].parts({ season: "summer", detail: true, seed: 1, ...options });
/** Every variant of an asset worth checking: each house style, else the one look. */
const variants = (id) => (id === "house" ? HOUSE_STYLES.map((style) => ({ style })) : [{}]);
/** Near-white vertices above `height`: snow, not walls (the colours are linear). */
function whiteAbove(part, height) {
  const { position, color } = part.geometry.attributes;
  let count = 0;
  for (let i = 0; i < position.count; i += 1) {
    if (position.getY(i) > height && Math.min(color.getX(i), color.getY(i), color.getZ(i)) > 0.8) count += 1;
  }
  return count;
}

test("the registry lists houses, farmsteads, lamps and the cathedral", () => {
  assert.deepEqual(IDS.sort(), ["cathedral", "farmstead", "house", "streetLamp"]);
});

test("each building describes itself", () => {
  for (const id of IDS) {
    assert.equal(BUILDINGS[id].meta.id, id);
    assert.equal(BUILDINGS[id].meta.category, "Buildings");
    assert.equal(typeof BUILDINGS[id].meta.name, "string");
    assert.equal(typeof BUILDINGS[id].meta.description, "string");
  }
});

test("a house comes in cottage, whitewashed, timber and stone", () => {
  assert.deepEqual([...HOUSE_STYLES], ["cottage", "whitewashed", "timber", "stone"]);
});

for (const id of IDS) {
  for (const variant of variants(id)) {
    const label = variant.style ? `${id} ${variant.style}` : id;
    for (const seed of SEEDS) {
      test(`${label} stands on the ground (seed ${seed})`, () => {
        const { near, far } = build(id, { ...variant, seed });
        for (const list of [near, far]) {
          const { min, max } = bounds(list);
          assert.ok(min.y >= -0.6 && min.y <= 0.05, `${label} min y ${min.y}`);
          assert.ok(max.y > 1, `${label} max y ${max.y}`);
        }
      });

      test(`${label} faces +z (seed ${seed})`, () => {
        const { door, depth, near } = build(id, { ...variant, seed });
        assert.ok(door.z > 0, `${label} door z ${door.z}`);
        assert.ok(door.z <= depth / 2 + 1, `${label} door z ${door.z} depth ${depth}`);
        const { min, max } = bounds(near);
        assert.ok(door.y >= 0 && door.y <= max.y, `${label} door y ${door.y}`);
        assert.ok(door.z >= min.z && door.z <= max.z, `${label} door inside the box`);
      });
    }

    test(`${label} stays within its triangle budget per detail`, () => {
      for (const season of SEASONS) {
        for (const seed of SEEDS) {
          const limits = BUDGET[id];
          const rich = build(id, { ...variant, season, seed });
          const plain = build(id, { ...variant, season, seed, detail: false });
          assert.ok(total(rich.near) <= limits.near, `${label} ${season} ${seed} near ${total(rich.near)}`);
          assert.ok(total(plain.near) <= limits.plain, `${label} ${season} ${seed} plain ${total(plain.near)}`);
          assert.ok(total(rich.far) <= limits.far, `${label} ${season} ${seed} far ${total(rich.far)}`);
          assert.ok(total(plain.near) <= total(rich.near), `${label} plain is not heavier`);
          assert.ok(total(rich.far) < total(rich.near), `${label} far is lighter`);
        }
      }
    });

    test(`${label} is vertex-coloured, with panes kept apart in glows`, () => {
      const { near, far, glows } = build(id, variant);
      for (const part of [...near, ...far, ...glows.map((geometry) => ({ geometry }))]) {
        assert.ok(part.geometry.attributes.color, `${label} colours`);
        assert.ok(!part.geometry.attributes.uv, `${label} has no uv`);
      }
      assert.ok(glows.length > 0 && total(glows) > 0, `${label} lights up`);
    });
  }

  test(`${id} disposes everything it made`, () => {
    for (const season of SEASONS) {
      const tracker = createTracker();
      const asset = BUILDINGS[id].create({ season, track: tracker.track });
      assert.ok(tracker.live() > 0, id);
      asset.dispose();
      assert.equal(tracker.live(), 0, `${id} ${season} leaked`);
    }
  });

  test(`${id} owns what parts makes, so the caller can free it`, () => {
    const tracker = createTracker();
    const { near, far, glows } = BUILDINGS[id].parts({ own: tracker.track });
    assert.equal(tracker.live(), near.length + far.length + glows.length);
    for (const part of [...near, ...far]) part.geometry.dispose();
    for (const geometry of glows) geometry.dispose();
    assert.equal(tracker.live(), 0);
  });

  test(`${id} is the same for the same seed`, () => {
    const a = build(id, { seed: 7 });
    const b = build(id, { seed: 7 });
    assert.deepEqual([...a.near[0].geometry.attributes.position.array], [...b.near[0].geometry.attributes.position.array]);
    assert.deepEqual([...a.near[0].geometry.attributes.color.array], [...b.near[0].geometry.attributes.color.array]);
  });
}

test("no building asks for Math.random: the seed decides", () => {
  const dir = new URL("../public/js/view3d/assets/buildings/", import.meta.url);
  for (const file of readdirSync(dir)) assert.ok(!readFileSync(new URL(file, dir), "utf8").includes("Math.random"), file);
});

test("houses differ from seed to seed", () => {
  const sizes = new Set(SEEDS.map((seed) => `${build("house", { seed }).width.toFixed(3)}`));
  assert.ok(sizes.size > 3, `${sizes.size} sizes`);
});

test("the four house styles look different", () => {
  const colours = HOUSE_STYLES.map((style) => [...build("house", { style, seed: 3 }).near[0].geometry.attributes.color.array].join());
  assert.equal(new Set(colours).size, HOUSE_STYLES.length);
});

test("a big house is larger than a small one", () => {
  for (const seed of SEEDS) assert.ok(build("house", { seed, big: true }).width > build("house", { seed }).width);
});

for (const style of HOUSE_STYLES) {
  test(`a winter ${style} house has snow on its roof`, () => {
    for (const seed of SEEDS) {
      const winter = build("house", { style, season: "winter", seed });
      const summer = build("house", { style, season: "summer", seed });
      const snow = whiteAbove(winter.near[0], winter.eaves);
      assert.ok(snow >= 6, `${style} ${seed} snow vertices ${snow}`);
      assert.ok(snow > whiteAbove(summer.near[0], summer.eaves), `${style} ${seed} snow beats the summer roof`);
      assert.ok(whiteAbove(winter.far[0], winter.eaves) > whiteAbove(summer.far[0], summer.eaves), `${style} ${seed} far roof is white too`);
    }
  });
}

test("the same house keeps its footprint in every season", () => {
  for (const style of HOUSE_STYLES) {
    const sizes = SEASONS.map((season) => build("house", { style, season, seed: 4 })).map(({ width, depth }) => `${width}x${depth}`);
    assert.equal(new Set(sizes).size, 1, style);
  }
});

test("a farmstead's yard fits the planner's farm yard", () => {
  const { near, width, depth } = build("farmstead");
  const { min, max } = bounds(near);
  assert.ok(width <= 58.01 && depth <= 46.01);
  assert.ok(Math.hypot(Math.max(Math.abs(min.x), max.x), Math.max(Math.abs(min.z), max.z)) <= 42, "inside the stamped radius");
});

test("a farmstead in winter is white where it is not in summer", () => {
  assert.ok(whiteAbove(build("farmstead", { season: "winter" }).near[0], 3) > whiteAbove(build("farmstead", { season: "summer" }).near[0], 3));
});

test("the cathedral stands about twice a church's height with two towers", () => {
  const { near } = build("cathedral");
  const box = bounds(near);
  assert.ok(box.max.y >= 30 && box.max.y <= 36, `height ${box.max.y}`);
  const high = near[0].geometry.attributes.position;
  const sides = new Set();
  for (let i = 0; i < high.count; i += 1) if (high.getY(i) > box.max.y - 2) sides.add(Math.sign(high.getX(i)));
  assert.ok(sides.has(-1) && sides.has(1), "a tower each side");
});

test("a street lamp is slim and reaches toward the road", () => {
  const { near } = build("streetLamp");
  const box = bounds(near);
  assert.ok(box.max.y > 5 && box.max.y < 8, `height ${box.max.y}`);
  assert.ok(box.max.x - box.min.x < 3 && box.max.z - box.min.z < 1, "slim");
});
