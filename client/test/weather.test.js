import { test } from "node:test";
import assert from "node:assert/strict";
import { WEATHER_KINDS, WEATHER_ODDS, precipitationAt, weatherFor, weatherFromLocation } from "../public/js/world/weather.js";
import { SEASONS } from "../public/js/world/seasons.js";

const utcDay = (i) => new Date(Date.UTC(2026, 0, 1 + i, 12));

test("the same map and UTC day give the same weather", () => {
  const a = weatherFor({ season: "autumn", seed: "rolling-hills", date: new Date(Date.UTC(2026, 10, 24, 3)) });
  const b = weatherFor({ season: "autumn", seed: "rolling-hills", date: new Date(Date.UTC(2026, 10, 24, 21)) });
  assert.deepEqual(a, b);
});

test("local dates either side of midnight on one UTC day agree", () => {
  // 00:30 and 23:30 UTC are the same UTC day, however far east or west the rider is.
  const early = new Date("2026-11-24T00:30:00Z");
  const late = new Date("2026-11-24T23:30:00Z");
  for (let seed = 0; seed < 20; seed++) {
    assert.deepEqual(weatherFor({ season: "spring", seed, date: early }), weatherFor({ season: "spring", seed, date: late }));
  }
});

test("winter never rains, summer never snows", () => {
  for (let i = 0; i < 400; i++) {
    const winter = weatherFor({ season: "winter", seed: "m", date: utcDay(i) }).kind;
    const summer = weatherFor({ season: "summer", seed: "m", date: utcDay(i) }).kind;
    assert.ok(!["rain", "storm"].includes(winter), winter);
    assert.notEqual(summer, "snow");
    assert.notEqual(summer, "rain");
  }
});

test("over 1000 days each season's kinds match its odds within 5 points", () => {
  for (const season of SEASONS) {
    const counts = Object.fromEntries(WEATHER_KINDS.map((k) => [k, 0]));
    for (let i = 0; i < 1000; i++) counts[weatherFor({ season, seed: "odds", date: utcDay(i) }).kind]++;
    for (const kind of WEATHER_KINDS) {
      const expected = WEATHER_ODDS[season][kind] ?? 0;
      assert.ok(Math.abs(counts[kind] / 1000 - expected) < 0.05, `${season} ${kind}: ${counts[kind] / 1000} vs ${expected}`);
    }
  }
});

test("strength is between one half and one", () => {
  for (let i = 0; i < 200; i++) {
    const { strength } = weatherFor({ season: "autumn", seed: 7, date: utcDay(i) });
    assert.ok(strength >= 0.5 && strength <= 1, String(strength));
  }
});

test("steady kinds give their strength and clear gives none", () => {
  assert.equal(precipitationAt({ kind: "rain", strength: 0.7 }, 12345), 0.7);
  assert.equal(precipitationAt({ kind: "snow", strength: 0.6 }, 99), 0.6);
  assert.equal(precipitationAt({ kind: "storm", strength: 1 }, 5), 1);
  assert.equal(precipitationAt({ kind: "clear", strength: 1 }, 5), 0);
});

test("showers are dry about two thirds of the time", () => {
  const weather = { kind: "showers", strength: 1 };
  let wet = 0;
  const steps = 2000;
  for (let i = 0; i < steps; i++) {
    const p = precipitationAt(weather, i * 60);
    assert.ok(p >= 0 && p <= 1);
    if (p > 0) wet++;
  }
  assert.ok(Math.abs(wet / steps - 1 / 3) < 0.1, String(wet / steps));
});

test("showers ramp smoothly rather than switching", () => {
  const weather = { kind: "showers", strength: 1 };
  let last = precipitationAt(weather, 0);
  for (let s = 1; s < 3600; s++) {
    const p = precipitationAt(weather, s);
    assert.ok(Math.abs(p - last) < 0.05, `jump at ${s}`);
    last = p;
  }
});

test("?weather=storm previews a storm", () => {
  assert.deepEqual(weatherFromLocation("?weather=storm", { kind: "clear", strength: 1 }), { kind: "storm", strength: 1 });
});

test("an unknown or missing ?weather keeps the fallback", () => {
  const fallback = { kind: "rain", strength: 0.6 };
  assert.equal(weatherFromLocation("?weather=hail", fallback), fallback);
  assert.equal(weatherFromLocation("", fallback), fallback);
});
