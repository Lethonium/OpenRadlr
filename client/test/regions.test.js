import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REGION_KINDS, REGION_STYLE } from "../public/js/world/regionKinds.js";
import { regionAt, regionMix } from "../public/js/world/regions.js";
import { SEASONS } from "../public/js/world/seasons.js";
import { RoadNetwork } from "../public/js/route/network.js";
import { seededRandom } from "../public/js/world/noise.js";

const SEED = 7;
const two = [
  { id: "a", kind: "farmBelt", center: [0, 0], radius: 400 },
  { id: "b", kind: "pineCoast", center: [900, 0], radius: 400 },
];
const file = () => JSON.parse(readFileSync(new URL("../../routes/maps/valley.json", import.meta.url)));

test("regionAt is empty without regions", () => {
  assert.deepEqual(regionAt(10, 10, [], SEED), []);
  assert.deepEqual(regionAt(10, 10, undefined, SEED), []);
});

test("regionMix fills with meadow and sums to one", () => {
  const random = seededRandom(3);
  for (let i = 0; i < 50; i++) {
    const mix = regionMix(random() * 1600 - 400, random() * 800 - 400, two, SEED);
    assert.ok(Math.abs(mix.reduce((s, m) => s + m.weight, 0) - 1) < 1e-9);
  }
});

test("a region centre is that region", () => {
  const [top] = regionAt(0, 0, two, SEED);
  assert.equal(top.kind, "farmBelt");
  assert.equal(top.weight, 1);
});

test("far outside a region is meadow", () => {
  assert.deepEqual(regionMix(0, 5000, two, SEED), [{ kind: "meadow", weight: 1 }]);
});

test("edges blend", () => {
  let blended = false;
  for (let x = 300; x <= 600 && !blended; x += 5) {
    const mix = regionMix(x, 0, two, SEED).filter((m) => m.weight > 0.2);
    blended = mix.length >= 2;
  }
  assert.ok(blended);
});

test("every kind has a full style", () => {
  assert.ok(Object.isFrozen(REGION_KINDS));
  for (const kind of REGION_KINDS) {
    const style = REGION_STYLE[kind];
    assert.ok(style, kind);
    for (const season of SEASONS) {
      assert.equal(style.ground[season].length, 3, `${kind} ground ${season}`);
      assert.ok(style.crops[season].length > 0, `${kind} crops ${season}`);
    }
    for (const mix of [style.trees.mix, style.verge.mix]) {
      const sum = Object.values(mix).reduce((s, v) => s + v, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${kind} shares sum ${sum}`);
    }
    assert.ok(style.fieldShare >= 0 && style.fieldShare <= 1);
    assert.ok(style.props.every > 0 && style.props.kinds.length > 0);
  }
});

test("the lowland is about a third farmland", () => {
  const network = new RoadNetwork(file());
  const { center, radiusAt } = network.island();
  let land = 0;
  let fields = 0;
  for (let x = center[0] - 7000; x <= center[0] + 7000; x += 100) {
    for (let z = center[1] - 7000; z <= center[1] + 7000; z += 100) {
      if (Math.hypot(x - center[0], z - center[1]) > radiusAt(Math.atan2(z - center[1], x - center[0]))) continue;
      const height = network.heightAt(x, -z);
      if (height <= 0 || height >= 120) continue;
      land += 1;
      for (const { kind, weight } of regionMix(x, z, network.regions, network.seed)) fields += weight * REGION_STYLE[kind].fieldShare;
    }
  }
  assert.ok(land > 1000, `land cells ${land}`);
  const share = fields / land;
  console.log("farmland share", share.toFixed(3));
  assert.ok(share >= 0.25 && share <= 0.42, `share ${share}`);
});

test("the network reads regions", () => {
  const map = file();
  assert.ok(new RoadNetwork(map).regions.length >= 11);
  const bare = { ...map };
  delete bare.regions;
  assert.deepEqual(new RoadNetwork(bare).regions, []);
  const one = new RoadNetwork({ ...bare, regions: [{ id: "r", kind: "deepWood", x: 10, y: 20, radius: 30 }] });
  assert.deepEqual(one.regions, [{ id: "r", kind: "deepWood", center: [10, -20], radius: 30 }]);
});
