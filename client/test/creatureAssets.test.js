import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { CREATURES } from "../public/js/view3d/assets/creatures/index.js";
import { WORKBENCH_ASSETS } from "../public/js/workbenchState.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const SEASONS = ["spring", "summer", "autumn", "winter"];
const SEEDS = [1, 2, 3, 4, 5, 6];
const IDS = ["cow", "sheep", "horse", "pig", "chicken", "deer", "rabbit", "fox", "bird", "butterfly", "dolphin"];
/** Flyers and swimmers are centred on the origin; the rest stand on y = 0. */
const CENTRED = ["bird", "butterfly", "dolphin"];
const SWINGS = ["leg", "wing", "head", "tail"];
/** Triangle budgets from the plan: body and limbs together. */
const BUDGET = { cow: 500, horse: 500, sheep: 400, pig: 400, deer: 400, chicken: 250, rabbit: 250, fox: 250, bird: 60, butterfly: 60, dolphin: 300 };

const triangles = (geometry) => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
const geometries = (built) => [built.body, ...built.limbs.map((limb) => limb.geometry)];
const total = (built) => geometries(built).reduce((sum, geometry) => sum + triangles(geometry), 0);
const bounds = (built) => geometries(built).reduce((b, geometry) => (geometry.computeBoundingBox(), b.union(geometry.boundingBox)), new THREE.Box3());
const build = (id, options) => CREATURES[id].parts({ season: "summer", detail: true, seed: 1, ...options });
const signature = (built) => geometries(built).map((geometry) => Array.from(geometry.attributes.position.array)).concat(built.limbs.map((limb) => limb.pivot));

test("the registry lists the island's animals", () => {
  assert.deepEqual(Object.keys(CREATURES).sort(), [...IDS].sort());
});

test("every creature is on the workbench", () => {
  for (const id of IDS) assert.equal(WORKBENCH_ASSETS[id], CREATURES[id], id);
});

test("each creature describes itself", () => {
  for (const id of IDS) {
    const { meta } = CREATURES[id];
    assert.equal(meta.id, id);
    assert.equal(meta.category, "Creatures");
    assert.equal(typeof meta.name, "string");
    assert.equal(typeof meta.description, "string");
    assert.ok(meta.options.season);
  }
});

for (const id of IDS) {
  test(`${id} has a speed and a size`, () => {
    const { speed, size } = build(id);
    assert.ok(speed > 0 && Number.isFinite(speed), `${id} speed`);
    assert.ok(size > 0 && Number.isFinite(size), `${id} size`);
  });

  for (const seed of SEEDS) {
    test(`${id} ${CENTRED.includes(id) ? "is centred" : "stands on the ground"} (seed ${seed})`, () => {
      const { min, max } = bounds(build(id, { seed }));
      if (CENTRED.includes(id)) {
        for (const axis of ["x", "y", "z"]) assert.ok(Math.abs((min[axis] + max[axis]) / 2) < 0.02, `${id} centre ${axis}`);
      } else {
        assert.ok(Math.abs(min.y) < 0.02, `${id} min y ${min.y}`);
        assert.ok(max.y > 0.2, `${id} max y ${max.y}`);
      }
    });

    test(`${id} faces +z (seed ${seed})`, () => {
      const built = build(id, { seed });
      const { min, max } = bounds(built);
      assert.ok(max.z - min.z >= max.x - min.x - 0.01 || id === "bird" || id === "butterfly", `${id} is longer than wide`);
      // the head ends up in front: the head limb, or for headless-limb animals the body's front half
      const head = built.limbs.find((limb) => limb.swing === "head");
      if (head) assert.ok(head.pivot[2] > 0, `${id} head pivot z ${head.pivot[2]}`);
      const front = new THREE.Box3().setFromBufferAttribute(built.body.attributes.position);
      assert.ok(max.z > Math.abs(min.z) - 0.01 || head, `${id} reaches further forward than back`);
      assert.ok(front.max.z > 0, id);
    });
  }

  test(`${id} stays within its triangle budget per detail`, () => {
    for (const season of SEASONS) {
      for (const seed of SEEDS) {
        const rich = total(build(id, { season, seed }));
        const plain = total(build(id, { season, seed, detail: false }));
        assert.ok(rich <= BUDGET[id], `${id} ${season} ${seed} rich ${rich}`);
        assert.ok(plain <= BUDGET[id] / 2, `${id} ${season} ${seed} plain ${plain}`);
        assert.ok(plain <= rich, `${id} plain is not heavier`);
      }
    }
  });

  test(`${id} is vertex-coloured with well-formed limbs`, () => {
    const built = build(id);
    for (const geometry of geometries(built)) {
      assert.ok(geometry.attributes.color, `${id} colours`);
      assert.ok(!geometry.attributes.uv, `${id} has no uv`);
    }
    for (const limb of built.limbs) {
      assert.ok(SWINGS.includes(limb.swing), `${id} swing ${limb.swing}`);
      assert.equal(limb.pivot.length, 3);
      assert.ok(limb.pivot.every(Number.isFinite));
    }
  });

  test(`${id} disposes everything it made`, () => {
    for (const season of SEASONS) {
      const tracker = createTracker();
      const made = CREATURES[id].create({ season, track: tracker.track });
      assert.ok(tracker.live() > 0, id);
      made.update(0.016, 1.5);
      made.dispose();
      assert.equal(tracker.live(), 0, `${id} ${season} leaked`);
    }
  });

  test(`${id} owns what parts makes, so the caller can free it`, () => {
    const tracker = createTracker();
    const built = CREATURES[id].parts({ own: tracker.track });
    assert.equal(tracker.live(), 1 + built.limbs.length);
    for (const geometry of geometries(built)) geometry.dispose();
    assert.equal(tracker.live(), 0);
  });

  test(`${id} is the same for the same seed`, () => {
    assert.deepEqual(signature(build(id, { seed: 7 })), signature(build(id, { seed: 7 })));
  });

  test(`${id} moves when created and updated`, () => {
    const made = CREATURES[id].create({});
    const before = made.object.children.map((child) => child.rotation.toArray().join());
    made.update(0.1, 0.3);
    made.update(0.1, 0.9);
    const after = made.object.children.map((child) => child.rotation.toArray().join());
    assert.notDeepEqual(after, before, id);
    made.dispose();
  });
}

test("four-legged animals walk with diagonal legs", () => {
  for (const id of ["cow", "sheep", "horse", "pig", "deer", "fox"]) {
    const legs = build(id).limbs.filter((limb) => limb.swing === "leg");
    assert.equal(legs.length, 4, id);
    for (const leg of legs) {
      for (const other of legs) {
        if (leg === other) continue;
        const sameSide = Math.sign(leg.pivot[0]) === Math.sign(other.pivot[0]);
        const sameEnd = Math.sign(leg.pivot[2]) === Math.sign(other.pivot[2]);
        if (!sameSide && !sameEnd) assert.equal(leg.phase, other.phase, `${id} diagonal legs together`);
        else assert.notEqual(leg.phase, other.phase, `${id} neighbouring legs alternate`);
      }
    }
  }
});

test("winter turns the fox white", () => {
  const brightness = (season) => {
    const color = build("fox", { season }).body.attributes.color;
    return color.getX(0) + color.getY(0) + color.getZ(0);
  };
  assert.ok(brightness("winter") > brightness("summer"));
});

test("different seeds give different cows", () => {
  const colours = new Set(SEEDS.map((seed) => Array.from(build("cow", { seed }).body.attributes.color.array).join()));
  assert.ok(colours.size > 1);
});

test("the sources of a creature never touch Math.random", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../public/js/view3d/assets/creatures/", import.meta.url);
  for (const file of readdirSync(dir)) assert.ok(!readFileSync(new URL(file, dir), "utf8").includes("Math.random"), file);
});
