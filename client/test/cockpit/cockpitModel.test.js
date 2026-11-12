import { test } from "node:test";
import assert from "node:assert/strict";
import { CockpitModel } from "../../public/js/cockpit/cockpitModel.js";

function setup() {
  let t = 0;
  const model = new CockpitModel({ now: () => t });
  return { model, at: (ms) => (t = ms) };
}
const state = (power, extra = {}) => ({ type: "state", riders: [{ id: 1, name: "Anna", power, speed: 8, ...extra }] });

test("waiting until the host is live", () => {
  const { model } = setup();
  assert.equal(model.status, "waiting");
  model.onStatus({ live: true, name: "Anna" });
  assert.equal(model.status, "live");
  assert.equal(model.name, "Anna");
  model.onStatus({ live: false, name: "Anna" });
  assert.equal(model.status, "waiting");
  assert.equal(model.live, false);
});

test("stale after 3 s without a message", () => {
  const { model, at } = setup();
  model.onStatus({ live: true, name: "Anna" });
  model.onState(state(200));
  at(2999);
  assert.equal(model.status, "live");
  at(3001);
  assert.equal(model.status, "stale");
  model.onState(state(200));
  assert.equal(model.status, "live");
});

test("the rider comes from state or studio_state", () => {
  const { model } = setup();
  model.onState(state(210, { cadence: 88 }));
  assert.deepEqual([model.power, model.cadence, model.speed], [210, 88, 8]);
  model.onState(state(210, {}));
  model.onDisplay({ cadence: 77 });
  assert.equal(model.cadence, 77);
  model.onState({ type: "studio_state", riders: [{ id: 2, name: "Anna", power: 150, cadence: 95, speed: 7 }] });
  assert.deepEqual([model.power, model.cadence, model.speed], [150, 95, 7]);
});

test("3 s power averages the last three seconds", () => {
  const { model, at } = setup();
  for (const [ms, power] of [[0, 100], [1000, 200], [2000, 300], [3000, 400]]) {
    at(ms);
    model.onState(state(power));
  }
  // the window is the last 3000 ms, exclusive: the sample at 0 ms is out
  assert.equal(model.power3s, 300);
});

test("history keeps 20 minutes", () => {
  const { model, at } = setup();
  for (let s = 0; s < 1300; s++) {
    at(s * 1000);
    model.onState(state(s));
  }
  assert.equal(model.history.power.length, 1200);
  assert.equal(model.history.power.at(-1), 1299);
  assert.equal(model.history.hr.length, 1200);
  assert.equal(model.history.cadence.length, 1200);
  assert.equal(model.history.speed.length, 1200);
});

test("history keeps the rider's speed", () => {
  const { model } = setup();
  model.onState(state(200, { speed: 9.5 }));
  assert.deepEqual(model.history.speed, [9.5]);
});

test("history takes one sample per second however fast states arrive", () => {
  const { model, at } = setup();
  for (let ms = 0; ms < 2000; ms += 250) {
    at(ms);
    model.onState(state(100));
  }
  assert.equal(model.history.power.length, 2);
});

test("display frames feed heart rate, grade and stats; a plan frame feeds the plan", () => {
  const { model } = setup();
  model.onDisplay({ hr: 142, grade: 3.5, ftp: 250, stats: { elapsedS: 60 }, zones_s: [1, 2, 3, 4, 5, 6], workout: { id: "w", step: 1, step_elapsed_s: 5, target_w: 200 } });
  assert.deepEqual([model.hr, model.grade, model.ftp, model.stats.elapsedS, model.zonesS.length, model.workout.step], [142, 3.5, 250, 60, 6, 1]);
  model.onDisplay({ workout_plan: { id: "w", name: "W", steps: [{ s: 60, from_w: 100, to_w: 100 }] } });
  assert.equal(model.plan.name, "W");
  assert.equal(model.hr, 142, "a plan frame leaves the live figures alone");
  model.onDisplay({ ftp: 250, stats: { elapsedS: 61 }, zones_s: [0, 0, 0, 0, 0, 0] });
  assert.equal(model.hr, null);
  assert.equal(model.plan, null, "the plan goes when the workout ends");
});

test("the race comes from the state", () => {
  const { model } = setup();
  assert.equal(model.race, null);
  model.onState({ ...state(100), race: { phase: "running", laps: 2 } });
  assert.equal(model.race.phase, "running");
});

test("a state with no rider keeps the last figures", () => {
  const { model } = setup();
  model.onState(state(120));
  model.onState({ type: "state", riders: [] });
  assert.equal(model.power, 120);
});
