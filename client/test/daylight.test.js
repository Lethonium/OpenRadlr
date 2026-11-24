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

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test("the day sky is blue: the zenith is bluer than it is red and the horizon is not grey", () => {
  const day = env("day");
  assert.ok(day.skyTop[2] > day.skyTop[0] * 5);
  assert.ok(day.skyHorizon[2] > day.skyHorizon[0] * 1.3);
  assert.ok(day.fogColor[2] > day.fogColor[0] * 1.2, "the distance tints blue");
});

test("fog leaves most of the view clear at two kilometres by day and fades it out past twelve", () => {
  const { fogDensity } = env("day");
  const left = (metres) => Math.exp(-((fogDensity * metres) ** 2));
  assert.ok(left(2000) > 0.8);
  assert.ok(left(12000) < 0.05);
});

test("winter is hazier than summer and the drone's haze thins the fog by its factor", () => {
  assert.ok(env("day", "winter").fogDensity > env("day", "summer").fogDensity);
  assert.ok(Math.abs(env("day", "summer", { haze: 2 }).fogDensity * 2 - env("day").fogDensity) < 1e-12);
});

test("the night is lit enough to read the ground by the moon", () => {
  const night = env("night");
  const day = env("day");
  assert.ok(luma(night.hemiSky) * night.hemiIntensity * night.exposure >= 0.1, "moonlit ambient");
  assert.ok(luma(night.sunColor) * night.sunIntensity >= 0.3, "moon key");
  assert.ok(luma(night.sunColor) * night.sunIntensity < luma(day.sunColor) * day.sunIntensity / 2, "but far below the sun");
  assert.ok(night.skyHorizon[2] > night.skyHorizon[0] * 2, "a blue night");
});
