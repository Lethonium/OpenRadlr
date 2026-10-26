import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlan, planPositionAt, withGetReady } from "../public/js/workout/plan.js";
import { WorkoutSession } from "../public/js/workout/workoutSession.js";
import { createCue } from "../public/js/workout/cue.js";
import { blockProgress, resyncWorkout, startingViewMode, summaryText, workoutHudText } from "../public/js/view/workoutStudioView.js";

// Get ready 0-30, squats 30-65, rest 65-80, burpees 80-120
const plan = () =>
  createPlan({
    id: "p1",
    name: "Test circuit",
    blocks: [
      { kind: "exercise", exercise: "squats", seconds: 35 },
      { kind: "rest", seconds: 15 },
      { kind: "exercise", exercise: "burpees", seconds: 40 },
    ],
  });
const at = (elapsed) => planPositionAt(withGetReady(plan()), elapsed);

test("an exercise block shows its name, the time left and what comes next", () => {
  const text = workoutHudText(at(60), { state: "block", heartRate: null });
  assert.deepEqual([text.exercise, text.time, text.next], ["Squats", "0:05", "Next: Rest 15 s"]);
});

test("the time left rounds up so the last second reads 0:01", () => {
  assert.equal(workoutHudText(at(64.2), { state: "block", heartRate: null }).time, "0:01");
});

test("a rest block says Rest and names the next exercise", () => {
  const text = workoutHudText(at(70), { state: "block", heartRate: null });
  assert.deepEqual([text.exercise, text.next], ["Rest", "Next: Burpees 40 s"]);
});

test("the last block has no next", () => {
  assert.equal(workoutHudText(at(100), { state: "block", heartRate: null }).next, "Last block");
});

test("the block counter counts the get-ready block", () => {
  assert.equal(workoutHudText(at(35), { state: "block", heartRate: null }).block, "Block 2/4");
});

test("elapsed and remaining time read as minutes and seconds", () => {
  const text = workoutHudText(at(35), { state: "block", heartRate: null });
  assert.deepEqual([text.elapsed, text.remaining], ["0:35", "1:25"]);
});

test("paused keeps the block's name and adds a Paused badge", () => {
  const text = workoutHudText(at(35), { state: "paused", heartRate: null });
  assert.deepEqual([text.exercise, text.paused], ["Squats", "Paused"]);
  assert.equal(workoutHudText(at(35), { state: "block", heartRate: null }).paused, "");
});

test("paused during rest and get ready still names them", () => {
  assert.equal(workoutHudText(at(70), { state: "paused", heartRate: null }).exercise, "Rest");
  assert.equal(workoutHudText(at(5), { state: "paused", heartRate: null }).exercise, "Get ready");
});

test("the first frame is consistent: the remaining time rounds up like the ring's, the elapsed time down", () => {
  const text = workoutHudText(at(0.01), { state: "ready", heartRate: null });
  assert.deepEqual([text.time, text.elapsed, text.remaining], ["0:30", "0:00", "2:00"]);
});

test("the heart rate shows when it is known and is empty otherwise", () => {
  assert.equal(workoutHudText(at(35), { state: "block", heartRate: 141.6 }).hr, "142 bpm");
  assert.equal(workoutHudText(at(35), { state: "block", heartRate: null }).hr, "");
});

test("the ring fills with the share of the block that is over", () => {
  assert.equal(blockProgress(at(47.5)), 0.5);
  assert.equal(blockProgress(at(500)), 1);
});

const record = (over = {}) => ({ planName: "Tabata", activeS: 680, blocksDone: 23, blocksSkipped: 1, hr: { avg: 138, max: 171 }, ...over });

test("the summary names the plan and the work against the plan", () => {
  const text = summaryText(record(), createPlan({ id: "t", name: "Tabata", blocks: [{ kind: "exercise", exercise: "squats", seconds: 360 }, { kind: "exercise", exercise: "plank", seconds: 360 }] }));
  assert.deepEqual([text.plan, text.worked], ["Tabata", "11:20 of 12:00"]);
});

test("a completed plan with rests reads as complete: work is compared with the planned exercise time", () => {
  const text = summaryText(record({ activeS: 480 }), createPlan({ id: "f", name: "Full body", blocks: [{ kind: "exercise", exercise: "squats", seconds: 240 }, { kind: "rest", seconds: 240 }, { kind: "exercise", exercise: "plank", seconds: 240 }] }), { finished: true });
  assert.equal(text.worked, "8:00 of 8:00");
});

test("the summary title says complete only when the plan was finished", () => {
  assert.equal(summaryText(record(), plan(), { finished: true }).title, "Workout complete");
  assert.equal(summaryText(record(), plan(), { finished: false }).title, "Workout ended");
  assert.equal(summaryText(record(), plan()).title, "Workout ended");
});

test("the summary counts blocks done and skipped", () => {
  assert.equal(summaryText(record(), plan()).blocks, "23 done · 1 skipped");
});

test("the summary leaves out skipped blocks when there are none", () => {
  assert.equal(summaryText(record({ blocksSkipped: 0 }), plan()).blocks, "23 done");
});

test("the summary shows the heart rate only when it was measured", () => {
  assert.equal(summaryText(record(), plan()).hr, "Avg 138 · max 171 bpm");
  assert.equal(summaryText(record({ hr: null }), plan()).hr, "");
});

function audio() {
  const log = [];
  const oscillator = { frequency: { value: 0 }, connect: (to) => log.push(["connect", to]), start: (t) => log.push(["start", t]), stop: (t) => log.push(["stop", t]) };
  const gain = { gain: { value: 1 }, connect: () => {} };
  return { log, oscillator, gain, context: { currentTime: 2, destination: "out", state: "running", createOscillator: () => oscillator, createGain: () => gain } };
}

test("the cue plays a 60 ms 880 Hz beep", () => {
  const { context, oscillator, log } = audio();
  createCue({ audioContext: context, vibrate: null })();
  assert.equal(oscillator.frequency.value, 880);
  assert.deepEqual(log.filter(([name]) => name === "start" || name === "stop"), [["start", 2], ["stop", 2.06]]);
});

test("the cue vibrates for 30 ms", () => {
  const calls = [];
  createCue({ audioContext: null, vibrate: (ms) => calls.push(ms) })();
  assert.deepEqual(calls, [30]);
});

test("the cue wakes a suspended audio context", () => {
  const { context } = audio();
  let resumed = 0;
  context.state = "suspended";
  context.resume = () => resumed++;
  createCue({ audioContext: context, vibrate: null })();
  assert.equal(resumed, 1);
});

test("the cue works with neither audio nor vibration", () => {
  assert.doesNotThrow(() => createCue({})());
});

function fakeConnection() {
  const sent = [];
  return { sent, workout: (exercise) => sent.push(exercise) };
}

test("after a reconnect the current exercise is sent again", () => {
  const clock = { t: 0 };
  const session = new WorkoutSession({ plan: plan(), now: () => clock.t });
  session.tick();
  clock.t = 40;
  session.tick();
  const connection = fakeConnection();
  resyncWorkout(session, connection);
  assert.deepEqual(connection.sent, ["squats"]);
});

test("after a reconnect while paused the avatar stands", () => {
  const clock = { t: 40 };
  const session = new WorkoutSession({ plan: plan(), now: () => clock.t });
  session.tick();
  session.pause();
  const connection = fakeConnection();
  resyncWorkout(session, connection);
  assert.deepEqual(connection.sent, [null]);
});

test("a reconnect without a workout sends nothing", () => {
  const connection = fakeConnection();
  resyncWorkout(null, connection);
  assert.deepEqual(connection.sent, []);
});

test("the workout opens in 3D whatever view was saved; a ride follows the saved view", () => {
  assert.equal(startingViewMode("2d", { workout: true }), "3d");
  assert.equal(startingViewMode("2d"), "2d");
  assert.equal(startingViewMode(null), "3d");
});
