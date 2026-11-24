import { test } from "node:test";
import assert from "node:assert/strict";
import { TIME_MODES, TIME_PRESETS, environmentAt, presetForHour, resolvePreset } from "../public/js/world/daylight.js";

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const env = (mode, season = "summer", options) => environmentAt(resolvePreset(mode), season, options);

test("night is a time mode", () => {
  assert.ok(TIME_MODES.includes("night"));
  assert.ok(TIME_PRESETS.night);
});

test("the clock reaches night", () => {
  assert.equal(presetForHour(23), "night");
  assert.equal(presetForHour(3), "night");
  assert.equal(presetForHour(20), "dusk");
  assert.equal(presetForHour(12), "day");
});

test("at night the sun is below the horizon and the moon above", () => {
  const night = env("night");
  assert.ok(night.sun[1] < 0);
  assert.ok(night.moon[1] > 0);
  assert.equal(night.night, 1);
});

test("by day there are no stars", () => {
  const day = env("day");
  assert.equal(day.stars, 0);
  assert.equal(day.night, 0);
});

test("night is exposed brighter than day", () => {
  assert.equal(env("night").exposure, 1.5);
  assert.equal(env("day").exposure, 1.05);
});

test("haze thins the fog", () => {
  assert.ok(env("day", "summer", { haze: 2 }).fogDensity < env("day", "summer", { haze: 1 }).fogDensity);
});

test("winter brings snow", () => {
  assert.equal(env("day", "winter").snow, 1);
  assert.equal(env("day", "summer").snow, 0);
});

test("colours are linear", () => {
  const day = env("day");
  assert.deepEqual([...day.skyTop], TIME_PRESETS.day.zenith.map(toLinear));
});

test("the environment is frozen", () => {
  assert.ok(Object.isFrozen(env("day")));
});
