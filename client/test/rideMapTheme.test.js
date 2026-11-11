import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP_COLORS } from "../public/js/view/mapPreview.js";
import { rideMapTheme } from "../public/js/view/rideMapTheme.js";

const COLORS = Object.freeze({
  text: "#e8ecf1",
  muted: "#8a94a3",
  road: "#2b3139",
});

const hex = (value) => {
  const number = Number.parseInt(value.slice(1), 16);
  return `rgb(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255})`;
};

test("temperate day keeps the established map palette", () => {
  const theme = rideMapTheme({ biome: "temperate", timeMode: "day", colors: COLORS });
  assert.equal(theme.sea, hex(MAP_COLORS.sea));
  assert.equal(theme.land, hex(MAP_COLORS.land));
  assert.equal(theme.sand, hex(MAP_COLORS.sand));
  assert.equal(theme.road, hex(COLORS.road));
  assert.equal(theme.contextRoad, hex(COLORS.muted));
  assert.equal(theme.edge, hex(COLORS.text));
  assert.equal(theme.marking, hex(COLORS.text));
  // The biome's own building colours, translucent as drawn.
  assert.equal(theme.houseFill, "rgba(116, 76, 56, 0.46)");
  assert.equal(theme.cafeEdge, "rgba(232, 214, 172, 0.95)");
  assert.ok(theme.trees.every((tree) => /^rgb\(/.test(tree)), "tree colours are CSS strings");
});

test("winter paints the map with the biome's snow, ice, road and trees", () => {
  const theme = rideMapTheme({ biome: "winter", timeMode: "day", colors: COLORS });
  assert.equal(theme.land, "rgb(240, 245, 252)");
  assert.equal(theme.sea, "rgb(51, 79, 107)");
  assert.equal(theme.marking, "rgb(219, 173, 71)");
  assert.deepEqual(theme.trees, ["rgb(31, 59, 43)", "rgb(194, 219, 237)"]);
  assert.notEqual(theme.houseFill, rideMapTheme({ biome: "temperate", timeMode: "day", colors: COLORS }).houseFill);
  assert.notEqual(theme.road, theme.land, "the road reads against the snow");
  assert.notEqual(theme.marking, theme.land, "the lane markings read against the snow");
  const channel = (color) => Number(color.match(/rgb\((\d+), (\d+), (\d+)\)/)[1]);
  assert.ok(channel(theme.road) < channel(theme.land) * 0.6, "the winter road is clearly darker than the snow");
  assert.ok(channel(theme.edge) > channel(theme.road), "the edge lines read against the road");
  const dusk = rideMapTheme({ biome: "winter", timeMode: "dusk", colors: COLORS });
  assert.ok(channel(dusk.edge) > channel(dusk.road) + 30, "the edge lines still read against the road at dusk");
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
  assert.equal(rideMapTheme({ biome: "not-a-biome", timeMode: "day", colors: COLORS }).land, hex(MAP_COLORS.land));
});
