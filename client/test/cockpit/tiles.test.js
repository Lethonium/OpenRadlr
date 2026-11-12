import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LAYOUT, TILES, tileById } from "../../public/js/cockpit/tiles.js";
import { CockpitModel } from "../../public/js/cockpit/cockpitModel.js";
import { setUnits } from "../../public/js/util/format.js";
import { setLocale } from "../../public/js/i18n/i18n.js";
import { squareRoute } from "../helpers.js";

setLocale("en");
setUnits("metric");

const STATS = { elapsedS: 3725, distanceM: 24500, climbedM: 312, kJ: 480, avgHeartRate: 138, avgPower: 190, weightedPower: 205, load: 61.4, efforts: [{ s: 5, w: 600 }] };

function riding() {
  const t = 0;
  const model = new CockpitModel({ now: () => t });
  model.onStatus({ live: true, name: "Anna" });
  model.onState({ type: "state", riders: [{ id: 1, name: "Anna", power: 250, cadence: 90, speed: 10, lap: 1 }], race: { phase: "running", laps: 3 } });
  model.onDisplay({ hr: 142, grade: -2.5, ftp: 250, stats: STATS, zones_s: [1, 2, 3, 4, 5, 6] });
  return model;
}

test("every default tile exists and allows its size", () => {
  for (const { id, size } of DEFAULT_LAYOUT) {
    const tile = tileById(id);
    assert.ok(tile, id);
    assert.ok(tile.sizes.includes(size), `${id} allows ${size}`);
  }
});

test("every tile has a label key, sizes and a value or a draw", () => {
  for (const tile of TILES) {
    assert.match(tile.labelKey, /^cockpit\.tile\./, tile.id);
    assert.ok(tile.sizes.length > 0, tile.id);
    assert.ok(Boolean(tile.value) !== Boolean(tile.draw), `${tile.id} has exactly one of value and draw`);
  }
  assert.equal(new Set(TILES.map((t) => t.id)).size, TILES.length);
});

test("the catalogue has the tiles of the spec", () => {
  assert.deepEqual(
    TILES.map((t) => t.id).sort(),
    ["power3s", "heartRate", "cadence", "speed", "grade", "elapsed", "workout", "zones", "avgPower", "np", "kj", "distance", "efforts", "load", "climbed", "avgHeartRate", "powerGraph", "hrGraph", "speedGraph", "minimap", "profile", "laps", "raceGaps"].sort(),
  );
});

test("number tiles read the model", () => {
  const model = riding();
  const cases = {
    power3s: "250",
    heartRate: "142",
    cadence: "90",
    speed: "36.0",
    grade: "−2.5",
    elapsed: "1:02:05",
    avgPower: "190",
    np: "205",
    kj: "480",
    distance: "24.50",
    load: "61",
    climbed: "312 m",
    avgHeartRate: "138",
    laps: "1 / 3",
  };
  for (const [id, expected] of Object.entries(cases)) {
    assert.equal(tileById(id).value(model), expected, id);
  }
});

test("number tiles show a dash without data", () => {
  const model = new CockpitModel({ now: () => 0 });
  for (const id of ["power3s", "cadence", "speed", "grade", "elapsed", "avgPower", "kj", "distance"]) {
    assert.equal(tileById(id).value(model), "–", id);
  }
});

test("the units follow the profile", () => {
  setUnits("imperial");
  try {
    assert.equal(tileById("speed").value(riding()), "22.4");
    assert.equal(tileById("speed").unit(), "mph");
  } finally {
    setUnits("metric");
  }
});

test("the power tile carries the power zone of the 3 s average", () => {
  assert.equal(tileById("power3s").zone(riding()), 4);
  assert.equal(tileById("power3s").zone(new CockpitModel({ now: () => 0 })), 0);
});

test("heart rate hides without data", () => {
  assert.equal(tileById("heartRate").hidden(new CockpitModel({ now: () => 0 })), true);
  assert.equal(tileById("heartRate").hidden(riding()), false);
});

test("workout hides outside a workout", () => {
  const model = riding();
  assert.equal(tileById("workout").hidden(model), true);
  model.onDisplay({ ftp: 250, stats: STATS, zones_s: [0, 0, 0, 0, 0, 0], workout: { id: "w", step: 0, step_elapsed_s: 1, target_w: 200 } });
  assert.equal(tileById("workout").hidden(model), false);
});

test("laps and race gaps hide outside a race", () => {
  const idle = new CockpitModel({ now: () => 0 });
  assert.equal(tileById("laps").hidden(idle), true);
  assert.equal(tileById("raceGaps").hidden(idle), true);
  assert.equal(tileById("laps").hidden(riding()), false);
});

/** A canvas context that accepts any call, so a draw function can run without a browser. */
function fakeContext() {
  const calls = [];
  return new Proxy({ calls }, {
    get: (target, name) => (name in target ? target[name] : (...args) => calls.push([name, args])),
    set: () => true,
  });
}

test("graph tiles draw on an empty model and a riding one", () => {
  const empty = new CockpitModel({ now: () => 0 });
  const full = riding();
  full.onDisplay({ ftp: 250, stats: STATS, zones_s: [1, 2, 3, 4, 5, 6], workout: { id: "w", step: 1, step_elapsed_s: 10, target_w: 200 } });
  full.onDisplay({ workout_plan: { id: "w", name: "W", steps: [{ s: 60, from_w: 100, to_w: 100 }, { s: 60, from_w: 200, to_w: 220 }] } });
  for (const tile of TILES.filter((t) => t.draw)) {
    for (const model of [empty, full]) assert.doesNotThrow(() => tile.draw(fakeContext(), model, 300, 80), tile.id);
  }
});

test("every tile label is translated", async () => {
  const { default: en } = await import("../../public/js/i18n/en.js");
  const { default: de } = await import("../../public/js/i18n/de.js");
  for (const tile of TILES) {
    assert.ok(tile.labelKey in en, `en ${tile.labelKey}`);
    assert.ok(tile.labelKey in de, `de ${tile.labelKey}`);
  }
});

test("the map and the profile show only while the rider is on the loaded route", () => {
  const model = riding();
  for (const id of ["minimap", "profile"]) assert.equal(tileById(id).hidden(model), true, `${id} without a route`);
  model.setRoute(squareRoute());
  for (const id of ["minimap", "profile"]) assert.equal(tileById(id).hidden(model), true, `${id} on another route`);
  model.onState({ type: "state", riders: [{ id: 1, name: "Anna", power: 250, speed: 10, route: "square", distance: 300 }] });
  for (const id of ["minimap", "profile"]) assert.equal(tileById(id).hidden(model), false, `${id} on the route`);
});

test("the map and the profile draw the route and the rider on it", () => {
  const model = riding();
  model.setRoute(squareRoute());
  model.onState({ type: "state", riders: [{ id: 1, name: "Anna", power: 250, speed: 10, route: "square", distance: 300 }] });
  for (const id of ["minimap", "profile"]) {
    const ctx = fakeContext();
    tileById(id).draw(ctx, model, 300, 120);
    assert.ok(ctx.calls.filter(([name]) => name === "arc").length >= 1, `${id} draws the rider`);
  }
});
