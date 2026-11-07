import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP_COLORS } from "../public/js/view/mapPreview.js";
import { rideMapTheme } from "../public/js/view/rideMapTheme.js";

const COLORS = Object.freeze({
  text: "#e8ecf1",
  muted: "#8a94a3",
  road: "#2b3139",
});

test("temperate day keeps the established map palette", () => {
  const theme = rideMapTheme({ biome: "temperate", timeMode: "day", colors: COLORS });
  assert.equal(theme.sea, MAP_COLORS.sea);
  assert.equal(theme.land, MAP_COLORS.land);
  assert.equal(theme.sand, MAP_COLORS.sand);
  assert.equal(theme.road, COLORS.road);
  assert.equal(theme.contextRoad, COLORS.muted);
  assert.equal(theme.edge, COLORS.text);
  assert.equal(theme.marking, COLORS.text);
  assert.ok(Array.isArray(theme.landRgb));
});

test("winter paints the map with the biome's snow, ice, road and trees", () => {
  const theme = rideMapTheme({ biome: "winter", timeMode: "day", colors: COLORS });
  assert.equal(theme.land, "rgb(240, 245, 252)");
  assert.equal(theme.sea, "rgb(51, 79, 107)");
  assert.equal(theme.road, "rgb(184, 189, 201)");
  assert.equal(theme.marking, "rgb(219, 173, 71)");
  assert.deepEqual(theme.trees, ["rgb(31, 59, 43)", "rgb(194, 219, 237)"]);
  assert.notEqual(theme.houseFill, rideMapTheme({ biome: "temperate", timeMode: "day", colors: COLORS }).houseFill);
  assert.notEqual(theme.road, theme.land, "the road reads against the snow");
  assert.notEqual(theme.marking, theme.land, "the lane markings read against the snow");
});

test("golden hour and dusk tint the map, and auto follows the clock", () => {
  const day = rideMapTheme({ biome: "temperate", timeMode: "day", colors: COLORS });
  const golden = rideMapTheme({ biome: "temperate", timeMode: "golden", colors: COLORS });
  const dusk = rideMapTheme({ biome: "temperate", timeMode: "dusk", colors: COLORS });
  assert.notEqual(golden.land, day.land);
  assert.notEqual(dusk.land, day.land);
  assert.notEqual(dusk.land, golden.land);
  assert.notEqual(golden.road, day.road);
  assert.notEqual(dusk.sea, day.sea);

  const noon = new Date(2026, 10, 7, 12, 0);
  const night = new Date(2026, 10, 7, 22, 0);
  assert.equal(rideMapTheme({ biome: "temperate", timeMode: "auto", date: noon, colors: COLORS }).land, day.land);
  assert.equal(rideMapTheme({ biome: "temperate", timeMode: "auto", date: night, colors: COLORS }).land, dusk.land);
});

test("an unknown biome falls back to the temperate theme", () => {
  assert.equal(rideMapTheme({ biome: "not-a-biome", timeMode: "day", colors: COLORS }).land, MAP_COLORS.land);
});
