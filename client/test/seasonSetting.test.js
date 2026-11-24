import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonFromLocation } from "../public/js/world/seasons.js";
import { seasonChoices } from "../public/js/view/seasonPicker.js";

const JULY = new Date(2026, 6, 1);

test("?season previews that season without saving it", () => {
  assert.deepEqual(seasonFromLocation("?season=autumn", { season: "spring" }, JULY), { mode: "autumn", season: "autumn", preview: true });
});

test("?biome=winter still previews winter", () => {
  assert.deepEqual(seasonFromLocation("?biome=winter", {}, JULY), { mode: "winter", season: "winter", preview: true });
});

test("an unknown preview falls back to the saved setting", () => {
  assert.deepEqual(seasonFromLocation("?season=monsoon", { season: "spring" }, JULY), { mode: "spring", season: "spring", preview: false });
});

test("the stored season is used when nothing previews", () => {
  assert.deepEqual(seasonFromLocation("", { season: "spring" }, JULY), { mode: "spring", season: "spring", preview: false });
});

test("a stored winter biome from before opens in winter", () => {
  assert.deepEqual(seasonFromLocation("", { biome: "winter" }, JULY), { mode: "winter", season: "winter", preview: false });
});

test("auto resolves by the date", () => {
  assert.deepEqual(seasonFromLocation("", {}, JULY), { mode: "auto", season: "summer", preview: false });
  assert.deepEqual(seasonFromLocation("", {}, new Date(2026, 0, 5)), { mode: "auto", season: "winter", preview: false });
});

test("the season picker lists auto and the four seasons in order", () => {
  const choices = seasonChoices();
  assert.deepEqual(choices.map((c) => c.id), ["auto", "spring", "summer", "autumn", "winter"]);
  assert.deepEqual(choices.map((c) => c.label), ["season.auto", "season.spring", "season.summer", "season.autumn", "season.winter"]);
});
