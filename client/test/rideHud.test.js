import { test } from "node:test";
import assert from "node:assert/strict";
import { RideHud, rideHudValues } from "../public/js/view/rideHud.js";
import { setUnits } from "../public/js/util/format.js";
import { squareRoute } from "./helpers.js";

const route = squareRoute();
const snapshot = (overrides = {}) => ({
  power: 200,
  cadence: 90,
  heartRate: 140,
  me: { id: 1, distance: 100, speed: 10 },
  route,
  rideDistanceM: 2500,
  elapsedS: 125,
  target: null,
  intensity: 1,
  weightKg: 70,
  ftp: 200,
  ...overrides,
});

test("fills every metric the tablet shows", () => {
  setUnits("metric");
  const values = rideHudValues(snapshot({ target: 210, intensity: 0.95 }));
  assert.deepEqual(Object.keys(values).sort(), ["avg-speed", "cadence", "distance", "grade", "hr", "intensity", "next-marker", "power", "speed", "target", "target-suffix", "time", "wkg", "zone"]);
  assert.equal(values.power, 200);
  assert.equal(values.zone, "Z4");
  assert.equal(values.target, 210);
  assert.equal(values.cadence, 90);
  assert.equal(values.hr, 140);
  assert.equal(values.intensity, "95 %");
  assert.equal(values.time, "2:05");
});

test("unknown cadence and heart rate show a dash", () => {
  const values = rideHudValues(snapshot({ cadence: undefined, heartRate: null }));
  assert.equal(values.cadence, "–");
  assert.equal(values.hr, "–");
});

test("the target suffix is empty without a target", () => {
  const values = rideHudValues(snapshot({ target: null }));
  assert.equal(values["target-suffix"], "");
  assert.equal(values.target, "–");
});

test("grade reads the route at my distance", () => {
  setUnits("metric");
  // The square route climbs 4 % between 250 m and 500 m.
  assert.equal(rideHudValues(snapshot({ me: { distance: 300, speed: 5 } })).grade, "4.0 %");
  assert.equal(rideHudValues(snapshot({ me: { distance: 100, speed: 5 } })).grade, "0.0 %");
});

function fakeHud() {
  const calls = [];
  const element = (id) => ({ id, hidden: false, style: {}, classList: { toggle() {} }, setAttribute() {} });
  const elements = new Map(["profile", "minimap", "upcoming", "race-timeline", "gauge-fill", "gauge-target", "training-power"].map((id) => [id, element(id)]));
  const root = { querySelectorAll: () => [], querySelector: (selector) => elements.get(selector.slice(1)) ?? null };
  const draw = (name) => (canvas) => calls.push(`${name}:${canvas.id}`);
  const hud = new RideHud(root, { drawProfile: draw("profile"), drawMinimap: draw("minimap"), drawUpcoming: draw("upcoming"), drawRaceTimeline: draw("timeline") });
  return { hud, calls };
}
const context = (layout, extra = {}) => ({ layout, riders: [], myId: 1, standing: null, colors: {}, ...extra });

test("draws only the visible layout's canvases: cockpit", () => {
  const { hud, calls } = fakeHud();
  hud.render(snapshot(), context("cockpit"));
  assert.deepEqual(calls, ["upcoming:upcoming"]);
});

test("draws only the visible layout's canvases: broadcast", () => {
  const { hud, calls } = fakeHud();
  hud.render(snapshot(), context("broadcast"));
  assert.deepEqual(calls, ["profile:profile", "minimap:minimap"]);
});

test("draws only the visible layout's canvases: race needs a standing", () => {
  const { hud, calls } = fakeHud();
  hud.render(snapshot(), context("race"));
  assert.deepEqual(calls, []);
  hud.render(snapshot(), context("race", { standing: {} }));
  assert.deepEqual(calls, ["timeline:race-timeline"]);
});
