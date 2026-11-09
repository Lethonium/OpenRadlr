import { test } from "node:test";
import assert from "node:assert/strict";
import { AfkPrompt } from "../public/js/ride/afkPrompt.js";

function setup() {
  let clock = 0;
  const calls = { stay: 0, leave: 0 };
  const prompt = new AfkPrompt({
    stay: () => calls.stay++,
    leave: () => calls.leave++,
    now: () => clock,
  });
  return { prompt, calls, setTime: (ms) => (clock = ms) };
}

test("opens with the server's countdown", () => {
  const { prompt, setTime } = setup();
  setTime(0);
  prompt.open({ leave_in_s: 120, can_stay: true });
  assert.equal(prompt.visible, true);
  assert.equal(prompt.canStay, true);
  assert.equal(prompt.secondsLeft(), 120);
  setTime(30_500);
  assert.equal(prompt.secondsLeft(), 90);
  setTime(200_000);
  assert.equal(prompt.secondsLeft(), 0);
});

test("pedalling closes it without sending anything", () => {
  const { prompt, calls } = setup();
  prompt.open({ leave_in_s: 120, can_stay: true });
  prompt.power(0);
  assert.equal(prompt.visible, true);
  prompt.power(95);
  assert.equal(prompt.visible, false);
  assert.deepEqual(calls, { stay: 0, leave: 0 });
});

test("stay sends once and closes", () => {
  const { prompt, calls } = setup();
  prompt.open({ leave_in_s: 120, can_stay: true });
  prompt.pressStay();
  assert.equal(calls.stay, 1);
  assert.equal(prompt.visible, false);
});

test("the final warning has no stay", () => {
  const { prompt, calls } = setup();
  prompt.open({ leave_in_s: 120, can_stay: false });
  assert.equal(prompt.canStay, false);
  prompt.pressStay();
  assert.equal(calls.stay, 0);
  assert.equal(prompt.visible, true);
});

test("leave ends the ride", () => {
  const { prompt, calls } = setup();
  prompt.open({ leave_in_s: 120, can_stay: true });
  prompt.pressLeave();
  assert.equal(calls.leave, 1);
  assert.equal(prompt.visible, false);
});
