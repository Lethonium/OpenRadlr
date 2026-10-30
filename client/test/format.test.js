import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { displayToKg, formatDistanceWithUnit, formatGrade, formatLength, formatNumber, formatSpeed, formatWkg, kgToDisplay, setUnits } from "../public/js/util/format.js";
import { setLocale } from "../public/js/i18n/i18n.js";
import { communityDistance } from "../public/js/view/startMenu.js";

afterEach(() => {
  setLocale("en");
  setUnits("metric");
});

test("formatNumber uses the decimal comma in German", () => {
  setLocale("de");
  assert.equal(formatNumber(36, 1), "36,0");
});

test("formatNumber keeps the decimal point in English", () => {
  assert.equal(formatNumber(36, 1), "36.0");
});

test("speed, distance, length, grade and W/kg follow the language", () => {
  setLocale("de");
  assert.equal(formatSpeed(10), "36,0");
  assert.equal(formatDistanceWithUnit(12345), "12,35 km");
  assert.equal(formatLength(2400), "2,4 km");
  assert.equal(formatGrade(-3.25), "−3,3");
  assert.equal(formatWkg(200, 80), "2,5");
});

test("the community total groups thousands the German way", () => {
  setLocale("de");
  const info = { distance_m: { trainer: 12345000, paddle: 678000 } };
  assert.match(communityDistance(info), /12\.345 km/);
});

test("the weight field's numbers stay plain numbers", () => {
  setLocale("de");
  assert.equal(typeof kgToDisplay(74.5), "number");
  assert.equal(typeof displayToKg(164.2), "number");
  assert.equal(String(kgToDisplay(74.5)), "74.5");
});
