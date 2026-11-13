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

/** A root whose elements remember what was written to them; metrics are the `data-m` ones. */
function textRoot(ids) {
  const elements = new Map(ids.map((id) => [id, { id, hidden: false, textContent: "", style: {}, children: [], replaceChildren(...children) { this.children = children; } }]));
  const metrics = ["lap-info", "position", "lap", "to-go", "race-caption"].map((name) => ({ dataset: { m: name }, textContent: "" }));
  const document = { createElement: () => ({ children: [], className: "", textContent: "", append(...nodes) { this.children.push(...nodes); } }) };
  const root = { ownerDocument: document, querySelectorAll: () => metrics, querySelector: (selector) => elements.get(selector.slice(1)) ?? null };
  const metric = (name) => metrics.find((m) => m.dataset.m === name).textContent;
  return { root, elements, metric, drawn: [] };
}
const WORKOUT_IDS = ["workout-chart", "workout-block", "workout-next", "workout-block-time", "workout-elapsed", "workout-remaining", "workout-avg", "workout-progress"];
const RACE_IDS = ["race-timeline", "race-groups", "race-around", "race-groups-panel"];
const noDraw = { drawProfile() {}, drawMinimap() {}, drawUpcoming() {}, drawRaceTimeline() {}, drawWorkout() {} };

test("renderWorkout fills the block and progress", () => {
  setUnits("metric");
  const { root, elements } = textRoot(WORKOUT_IDS);
  const hud = new RideHud(root, noDraw);
  const workout = { name: "Two", segments: [{ durationS: 40, from: 0.5, to: 0.5, label: "Steady" }, { durationS: 40, from: 1, to: 1, label: "Steady" }] };
  hud.renderWorkout({ workout, state: { index: 1, segment: workout.segments[1], elapsedS: 70, remainingS: 10, segmentRemainingS: 10 }, ftp: 200, intensity: 1, avgW: 180, paused: false, layout: "training" });
  assert.equal(elements.get("workout-block").textContent, "Block 2 of 2 · Steady");
  assert.equal(elements.get("workout-next").textContent, "Last block");
  assert.equal(elements.get("workout-block-time").textContent, "0:10");
  assert.equal(elements.get("workout-elapsed").textContent, "1:10");
  assert.equal(elements.get("workout-remaining").textContent, "0:10");
  assert.equal(elements.get("workout-avg").textContent, "180 W");
  assert.equal(elements.get("workout-progress").style.width, "87.5%");
});

test("renderWorkout names the next block and shows a dash without an average", () => {
  const { root, elements } = textRoot(WORKOUT_IDS);
  const hud = new RideHud(root, noDraw);
  const workout = { name: "Two", segments: [{ durationS: 40, from: 0.5, to: 0.5, label: "Steady" }, { durationS: 40, from: 1, to: 1, label: "Steady" }] };
  hud.renderWorkout({ workout, state: { index: 0, segment: workout.segments[0], elapsedS: 0, remainingS: 80, segmentRemainingS: 40 }, ftp: 200, intensity: 0.5, avgW: null, paused: true, layout: "cockpit" });
  assert.equal(elements.get("workout-block").textContent, "Block 1 of 2 · Steady (paused)");
  assert.equal(elements.get("workout-next").textContent, "Next: Steady 0:40 · 100 W");
  assert.equal(elements.get("workout-avg").textContent, "– W");
});

test("renderWorkout draws the chart only in the training layout", () => {
  const { root } = textRoot(WORKOUT_IDS);
  const drawn = [];
  const hud = new RideHud(root, { ...noDraw, drawWorkout: (canvas, options) => drawn.push([canvas.id, options.elapsedS]) });
  const workout = { name: "One", segments: [{ durationS: 40, from: 1, to: 1, label: "Steady" }] };
  const args = { workout, state: { index: 0, segment: workout.segments[0], elapsedS: 5, remainingS: 35, segmentRemainingS: 35 }, ftp: 200, intensity: 1, avgW: null, paused: false };
  hud.renderWorkout({ ...args, layout: "broadcast" });
  assert.deepEqual(drawn, []);
  hud.renderWorkout({ ...args, layout: "training" });
  assert.deepEqual(drawn, [["workout-chart", 5]]);
});

const standing = (extra = {}) => ({ position: 2, total: 5, lap: 1, laps: 3, toGoM: 2500, groups: [{ label: "A", size: 2, gapS: 0, mine: true }], around: [{ position: 2, rider: { name: "Ann" }, gapS: 0, mine: true }], ...extra });

test("renderRace shows the position and laps", () => {
  setUnits("metric");
  const { root, elements, metric } = textRoot(RACE_IDS);
  const hud = new RideHud(root, noDraw);
  hud.renderRace({ race: { phase: "running", laps: 3, elapsed_s: 60 }, standing: standing(), status: "Lap 1/3" });
  assert.equal(metric("lap-info"), "Lap 1/3");
  assert.equal(metric("position"), "2/5");
  assert.equal(metric("lap"), "1/3");
  assert.equal(metric("to-go"), "2.5 km");
  assert.equal(elements.get("race-timeline").hidden, false);
  assert.equal(elements.get("race-groups-panel").hidden, false);
  assert.equal(elements.get("race-groups").children.length, 1);
  assert.equal(elements.get("race-around").children.length, 1);
});

test("renderRace hides the timeline without a standing", () => {
  const { root, elements, metric } = textRoot(RACE_IDS);
  const hud = new RideHud(root, noDraw);
  hud.renderRace({ race: { phase: "running", laps: 3 }, standing: null, status: "Race running" });
  assert.equal(metric("position"), "–");
  assert.equal(metric("race-caption"), "Race running");
  assert.equal(elements.get("race-timeline").hidden, true);
  assert.equal(elements.get("race-groups-panel").hidden, true);
  assert.equal(elements.get("race-groups").children.length, 0);
});
