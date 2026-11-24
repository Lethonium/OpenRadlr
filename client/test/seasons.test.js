import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEASONS,
  SEASON_LOOK,
  SEASON_MODES,
  biomeForSeason,
  resolveSeason,
  seasonSetting,
} from "../public/js/world/seasons.js";

test("auto follows the month", () => {
  assert.equal(resolveSeason("auto", new Date(2026, 0, 15)), "winter");
  assert.equal(resolveSeason("auto", new Date(2026, 3, 1)), "spring");
  assert.equal(resolveSeason("auto", new Date(2026, 6, 1)), "summer");
  assert.equal(resolveSeason("auto", new Date(2026, 9, 31)), "autumn");
  assert.equal(resolveSeason("auto", new Date(2026, 11, 1)), "winter");
});

test("a chosen season is that season", () => {
  for (const season of SEASONS) assert.equal(resolveSeason(season, new Date(2026, 0, 15)), season);
});

test("an unknown mode reads as auto", () => {
  assert.equal(resolveSeason("monsoon", new Date(2026, 6, 1)), "summer");
});

test("a saved winter biome opens in winter", () => {
  assert.equal(seasonSetting({ biome: "winter" }), "winter");
});

test("a saved season beats a saved biome", () => {
  assert.equal(seasonSetting({ season: "spring", biome: "winter" }), "spring");
});

test("anything else is auto", () => {
  assert.equal(seasonSetting({}), "auto");
  assert.equal(seasonSetting(), "auto");
  assert.equal(seasonSetting({ season: "nope", biome: "temperate" }), "auto");
  assert.equal(seasonSetting({ season: null, biome: null }), "auto");
  assert.ok(SEASON_MODES.includes("auto"));
});

test("only winter draws the winter biome", () => {
  assert.equal(biomeForSeason("winter"), "winter");
  for (const season of ["spring", "summer", "autumn"]) assert.equal(biomeForSeason(season), "temperate");
});

test("every season has a complete look", () => {
  for (const season of SEASONS) {
    const look = SEASON_LOOK[season];
    for (const key of ["grass", "grassDry", "soil", "rock", "sand"]) {
      assert.equal(look[key].length, 3, `${season} ${key}`);
      for (const c of look[key]) assert.ok(c >= 0 && c <= 1, `${season} ${key} in 0..1`);
    }
    assert.ok(look.snowCover >= 0 && look.snowCover <= 1);
    assert.equal(typeof look.snowLine, "number");
    assert.ok(Object.isFrozen(look));
  }
});

test("only winter has snow", () => {
  assert.equal(SEASON_LOOK.winter.snowCover, 1);
  assert.equal(SEASON_LOOK.winter.snowLine, 0);
  for (const season of ["spring", "summer", "autumn"]) {
    assert.equal(SEASON_LOOK[season].snowCover, 0);
    assert.ok(SEASON_LOOK[season].snowLine > 2000, "above the island's highest point");
  }
});
