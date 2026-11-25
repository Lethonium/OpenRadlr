import test from "node:test";
import assert from "node:assert/strict";
import { REGION_KINDS, REGION_STYLE } from "../public/js/world/regionKinds.js";
import { SEASONS } from "../public/js/world/seasons.js";
import { COAST_BAND, CROP_PAINT, LAND_KINDS, LAND_STYLE, PLOUGH_SLOPE, TERRACE_SLOPE, landKindWeights } from "../public/js/world/landKinds.js";

const flat = { shore: 2000, slope: 0, height: 40, village: 300 };
const alone = (kind) => [{ kind, weight: 1 }];
const argmax = (w) => Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];

test("weights sum to one for every region kind", () => {
  for (const kind of REGION_KINDS) {
    const w = landKindWeights({ mix: alone(kind), ...flat });
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, kind);
    for (const v of Object.values(w)) assert.ok(v >= 0, kind);
  }
});

test("no ploughland or orchards in the coastal band", () => {
  const w = landKindWeights({ mix: alone("farmBelt"), shore: COAST_BAND / 2, slope: 0, height: 3, village: 300 });
  assert.equal(w.arable, 0);
  assert.equal(w.orchard, 0);
  assert.equal(w.vineyard, 0);
  assert.ok(w.scrub + w.dune > 0.5);
});

test("steep ground is not ploughed", () => {
  const mix = alone("farmBelt");
  assert.equal(landKindWeights({ mix, ...flat, slope: PLOUGH_SLOPE + 0.08 }).arable, 0);
  const w = landKindWeights({ mix, ...flat, slope: TERRACE_SLOPE + 0.05 });
  for (const kind of LAND_KINDS) assert.equal(w[kind], 0, kind);
  assert.equal(w.wild, 1);
});

test("farmland clusters near villages", () => {
  const mix = alone("farmBelt");
  const near = landKindWeights({ mix, ...flat, village: 200 }).arable;
  const far = landKindWeights({ mix, ...flat, village: 3000 }).arable;
  assert.ok(near > 2 * far);
});

test("regions differ", () => {
  assert.equal(argmax(landKindWeights({ mix: alone("oliveTerraces"), ...flat })), "orchard");
  assert.equal(argmax(landKindWeights({ mix: alone("farmBelt"), ...flat })), "arable");
  assert.ok(["wild", "pasture"].includes(argmax(landKindWeights({ mix: alone("highCountry"), ...flat }))));
});

test("every crop has a ground colour", () => {
  for (const style of Object.values(REGION_STYLE)) {
    for (const season of SEASONS) {
      for (const crop of style.crops[season]) assert.equal(CROP_PAINT[crop]?.length, 3, crop);
    }
  }
});

test("every kind paints all four seasons", () => {
  for (const kind of LAND_KINDS) {
    for (const season of SEASONS) {
      const c = LAND_STYLE[kind].paint[season];
      assert.equal(c.length, 3, `${kind} ${season}`);
      for (const v of c) assert.ok(v >= 0 && v <= 1, `${kind} ${season}`);
    }
  }
});
