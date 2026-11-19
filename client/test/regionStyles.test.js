/** Region kinds look different, and winter changes only what snow changes (#117). */
import assert from "node:assert/strict";
import test from "node:test";
import { REGION_KIND } from "../public/js/land/regions.js";
import { temperate, winter } from "../public/js/view3d/biomes/index.js";
import { regionStyle } from "../public/js/view3d/regions/styles.js";

const OPEN_LAND = new Set([REGION_KIND.highCountry, REGION_KIND.lavenderFields]);

test("every region kind has a temperate style", () => {
  for (const kind of Object.values(REGION_KIND)) assert.ok(regionStyle(kind, temperate), kind);
});

test("wooded kinds grow trees, open kinds few", () => {
  for (const kind of Object.values(REGION_KIND)) {
    const { density } = regionStyle(kind, temperate).trees;
    if (OPEN_LAND.has(kind)) assert.ok(density <= 0.2, `${kind} ${density}`);
    else assert.ok(density > 0, `${kind} ${density}`);
  }
});

test("lavender fields are stripes", () => {
  assert.equal(regionStyle("lavenderFields", temperate).mass.kind, "stripes");
});

test("the blossom canopy is pink in summer", () => {
  const [r, g] = regionStyle("blossomValley", temperate).trees.canopy;
  assert.ok(r > g + 0.15);
});

test("winter takes the pink out of the blossom", () => {
  const [r, g] = regionStyle("blossomValley", winter).trees.canopy;
  assert.ok(r - g < 0.05);
});

test("winter lays snow over the lavender", () => {
  assert.ok(regionStyle("lavenderFields", winter).mass.colour.every((c) => c > 0.8));
});

test("a kind winter does not override keeps its temperate trees", () => {
  assert.deepEqual(regionStyle("pineCoast", winter).trees, regionStyle("pineCoast", temperate).trees);
});

test("an override merges into the style rather than replacing it", () => {
  const style = regionStyle("lavenderFields", winter);
  assert.equal(style.mass.kind, "stripes");
  assert.ok(style.props.kinds.length > 0);
});

test("an unknown kind has no style", () => {
  assert.equal(regionStyle("nope", temperate), null);
});

test("winter's bare blossom trees are marked bare", () => {
  assert.equal(regionStyle("blossomValley", winter).trees.bare, true);
  assert.notEqual(regionStyle("blossomValley", temperate).trees.bare, true);
});

test("under snow no region keeps flowers in its cover or its verge strip", () => {
  const flowering = ["lavender", "wildflower", "alpineFlower"];
  for (const kind of Object.values(REGION_KIND)) {
    const cover = regionStyle(kind, winter)?.cover;
    if (!cover) continue;
    for (const plant of [...cover.plants, ...(cover.strip ?? [])]) assert.ok(!flowering.includes(plant), `${kind} keeps ${plant}`);
  }
});

test("summer cover keeps its flowers", () => {
  assert.ok(regionStyle("lavenderFields", temperate).cover.plants.includes("lavender"));
});

test("under snow the lavender fields keep some cover to draw", () => {
  assert.ok(regionStyle("lavenderFields", winter).cover.plants.length > 0);
});
