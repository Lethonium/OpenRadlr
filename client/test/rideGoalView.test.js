import { test } from "node:test";
import assert from "node:assert/strict";
import { RideGoal } from "../public/js/ride/rideGoal.js";
import { createRideGoalView } from "../public/js/view/rideGoalView.js";
import { setUnits } from "../public/js/util/format.js";

function setup() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { hidden: false, value: "time", textContent: "", events: {}, addEventListener(type, fn) { this.events[type] = fn; }, setAttribute() {} });
    return els.get(id);
  };
  const goal = new RideGoal();
  const notifications = [];
  let summary = { durationS: 0 };
  const pill = el("pill");
  const view = createRideGoalView({ root: { querySelector: el }, pill, goal, read: () => summary, notify: (s) => notifications.push(s), onChange() {} });
  const submit = (n) => { el("#goal-target").valueAsNumber = n; el("#goal-form").events.submit({ preventDefault() {} }); };
  return { el, goal, pill, view, submit, notifications, total: (value) => { summary = value; } };
}

test("form sets a goal; reaching it announces once and removing it hides progress", () => {
  const s = setup();
  assert.equal(s.pill.hidden, true);
  s.submit(1);
  assert.equal(s.goal.target, 60);
  assert.equal(s.pill.hidden, false);
  s.total({ durationS: 60 });
  s.view.update();
  s.view.update();
  assert.equal(s.notifications.length, 1);
  assert.equal(s.el("#goal-progress").value, 1);
  s.el("#goal-clear").events.click();
  assert.equal(s.pill.hidden, true);
});

test("invalid input shows an error without replacing the goal", () => {
  const s = setup();
  s.submit(10);
  s.submit(NaN);
  assert.equal(s.goal.target, 600);
  assert.equal(s.el("#goal-error").hidden, false);
});

test("distance input follows imperial units", () => {
  setUnits("imperial");
  try {
    const s = setup();
    s.el("#goal-kind").value = "distance";
    s.submit(10);
    assert.equal(s.goal.target, 16093.44);
    assert.equal(s.el("#goal-unit").textContent, "mi");
  } finally { setUnits("metric"); }
});
