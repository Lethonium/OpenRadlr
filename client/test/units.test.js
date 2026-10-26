import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  defaultUnits,
  displayToKg,
  formatDistance,
  formatDistanceWithUnit,
  formatElevation,
  formatGap,
  formatLength,
  formatSpeed,
  kgToDisplay,
  setUnits,
  speedUnit,
  weightUnit,
} from "../public/js/util/format.js";
import { ProfileStore, validateProfile } from "../public/js/profile/profileStore.js";
import { routeStats } from "../public/js/view/startMenu.js";

afterEach(() => setUnits("metric"));

test("metric is the default and unknown systems fall back to it", () => {
  setUnits("furlongs");
  assert.equal(formatSpeed(10), "36.0");
  assert.equal(speedUnit(), "km/h");
});

test("imperial speed, distance and elevation", () => {
  setUnits("imperial");
  assert.equal(formatSpeed(10), "22.4");
  assert.equal(speedUnit(), "mph");
  assert.equal(formatDistance(1609.344), "1.00");
  assert.equal(formatDistanceWithUnit(12345), "7.67 mi");
  assert.equal(formatDistanceWithUnit(12345, 1), "7.7 mi");
  assert.equal(formatElevation(27), "89 ft");
});

test("metric distances and elevation are unchanged", () => {
  assert.equal(formatDistanceWithUnit(12345), "12.35 km");
  assert.equal(formatElevation(27.4), "27 m");
});

test("lengths ahead: metres under a km, feet under a tenth of a mile", () => {
  assert.equal(formatLength(347), "350 m");
  assert.equal(formatLength(2450), "2.5 km");
  setUnits("imperial");
  assert.equal(formatLength(100), "330 ft");
  assert.equal(formatLength(160), "520 ft");
  assert.equal(formatLength(161), "0.1 mi");
  assert.equal(formatLength(2450), "1.5 mi");
});

test("gaps to other riders", () => {
  assert.equal(formatGap(12.4), "+12 m");
  assert.equal(formatGap(-3), "−3 m");
  assert.equal(formatGap(0.2), "0 m");
  setUnits("imperial");
  assert.equal(formatGap(12.2), "+40 ft");
  assert.equal(formatGap(-3), "−10 ft");
  assert.equal(formatGap(0.1), "0 ft");
});

test("weight converts both ways and stays within a tenth of a kilo", () => {
  assert.equal(kgToDisplay(75), 75);
  setUnits("imperial");
  assert.equal(weightUnit(), "lb");
  assert.equal(kgToDisplay(75), 165.3);
  assert.equal(displayToKg(165.3), 75);
  assert.equal(displayToKg(kgToDisplay(82.4)), 82.4);
});

test("route stats follow the setting", () => {
  const route = { length_m: 6800, elevation_gain_m: 27 };
  assert.equal(routeStats(route), "6.8 km · 27 m up");
  setUnits("imperial");
  assert.equal(routeStats(route), "4.2 mi · 89 ft up");
});

test("the default units follow the region", () => {
  assert.equal(defaultUnits("en-US"), "imperial");
  assert.equal(defaultUnits("en_LR"), "imperial");
  assert.equal(defaultUnits("my-MM"), "imperial");
  assert.equal(defaultUnits("en-GB"), "metric");
  assert.equal(defaultUnits("de-CH"), "metric");
  assert.equal(defaultUnits("en"), "metric");
  assert.equal(defaultUnits(undefined), "metric");
});

test("profiles without units take the locale default; a saved choice wins", () => {
  const storage = (value) => ({ getItem: () => value, setItem() {} });
  assert.equal(new ProfileStore({ storage: storage(null), locale: "en-US" }).load().units, "imperial");
  assert.equal(new ProfileStore({ storage: storage('{"name":"Old"}'), locale: "fr-FR" }).load().units, "metric");
  assert.equal(new ProfileStore({ storage: storage('{"units":"metric"}'), locale: "en-US" }).load().units, "metric");
});

test("profile validation checks units and words the weight limits in the rider's units", () => {
  const ok = { name: "A", weightKg: 75, difficulty: 0.5 };
  assert.deepEqual(validateProfile({ ...ok, units: "imperial" }), []);
  assert.deepEqual(validateProfile({ ...ok, autoPause: true }), []);
  assert.deepEqual(validateProfile({ ...ok, autoPause: "yes" }), ["Auto-pause must be on or off."]);
  assert.equal(new ProfileStore({ storage: { getItem: () => null, setItem() {} } }).load().autoPause, false);
  assert.deepEqual(validateProfile({ ...ok, units: "cubits" }), ["Units must be metric or imperial."]);
  assert.deepEqual(validateProfile({ ...ok, weightKg: 10, units: "imperial" }), ["Weight must be between 66 and 440 lb."]);
  assert.deepEqual(validateProfile({ ...ok, weightKg: 10 }), ["Weight must be between 30 and 200 kg."]);
});
