import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSetTargetPower } from "../public/js/ble/ftms.js";
import { SimulatedTrainer, SmartTrainer } from "../public/js/ble/devices.js";
import { RideSession } from "../public/js/ride/rideSession.js";
import {
  PRESET_WORKOUTS,
  WorkoutPlayer,
  createWorkout,
  intervals,
  parseZwo,
  positionAt,
  ramp,
  steady,
  totalDuration,
  zoneFor,
} from "../public/js/ride/workout.js";
import { Emitter } from "../public/js/util/emitter.js";
import { fakeScheduler } from "./helpers.js";
import { fakeTrainer } from "./fakeBluetooth.js";

// --- FTMS ERG ---------------------------------------------------------------

test("encodes FTMS Set Target Power", () => {
  assert.deepEqual([...encodeSetTargetPower(250)], [0x05, 0xfa, 0x00]);
  assert.deepEqual([...encodeSetTargetPower(-10)], [0x05, 0x00, 0x00]);
  assert.deepEqual([...encodeSetTargetPower(1234.6)], [0x05, 0xd3, 0x04]);
});

test("grade and power commands share one queue; only the latest pending is sent", async () => {
  const fake = fakeTrainer({ services: { 0x1826: { 0x2ad2: {}, 0x2ad9: {} } } });
  const trainer = await SmartTrainer.connect(fake.bluetooth);
  const control = fake.characteristics[0x2ad9];
  control.writes.length = 0;
  await Promise.all([trainer.setGrade(2), trainer.setTargetPower(180), trainer.setTargetPower(200)]);
  assert.deepEqual(control.writes.map((w) => w[0]), [0x11, 0x05]);
  assert.deepEqual(control.writes[1], [0x05, 200, 0]);
});

test("the simulated trainer holds the ERG target", async () => {
  const trainer = new SimulatedTrainer(fakeScheduler());
  await trainer.setTargetPower(230);
  assert.equal(trainer.reading().power, 230);
  await trainer.setGrade(3);
  assert.equal(trainer.targetPower, null);
});

class FakeTrainer extends Emitter {
  commands = [];
  async setGrade(grade) {
    this.commands.push({ grade });
  }
  async setTargetPower(power) {
    this.commands.push({ power });
  }
}

test("the ride session switches between grade and target power", async () => {
  const scheduler = fakeScheduler();
  const trainer = new FakeTrainer();
  const connection = new Emitter();
  connection.sendTelemetry = () => {};
  let mode = { grade: 0 };
  const session = new RideSession({ connection, trainer, resistanceModel: () => mode, ...scheduler });
  session.start();
  connection.emit("resistance", { grade_percent: 0 });

  mode = { power: 200 };
  scheduler.fire();
  mode = { power: 200.4 };
  scheduler.fire();
  mode = { power: 215 };
  scheduler.fire();
  mode = { grade: 0 };
  scheduler.fire();
  await Promise.resolve();
  assert.deepEqual(trainer.commands, [{ grade: 0 }, { power: 200 }, { power: 215 }, { grade: 0 }]);
});

// --- workouts ---------------------------------------------------------------

test("intervals expand into on/off blocks", () => {
  const blocks = intervals(3, 60, 1.1, 30, 0.5);
  assert.equal(blocks.length, 6);
  assert.deepEqual(blocks.map((b) => b.kind), ["on", "off", "on", "off", "on", "off"]);
  assert.equal(blocks[4].label, "Interval 3/3");
  assert.equal(intervals(2, 60, 1, 0, 0).length, 2);
});

test("workouts are validated", () => {
  assert.throws(() => createWorkout({ name: "x", segments: [] }), /at least one block/);
  assert.throws(() => createWorkout({ name: "x", segments: [steady(0, 0.5)] }), /no duration/);
  assert.throws(() => createWorkout({ name: "x", segments: [steady(60, 9)] }), /invalid power/);
  assert.throws(() => createWorkout({ name: "x", segments: [steady(7 * 3600, 0.5)] }), /6 hours/);
});

test("positions inside a workout follow ramps and steps", () => {
  const workout = createWorkout({ name: "t", segments: [ramp(100, 0.5, 1.0), steady(60, 1.2)] });
  assert.equal(totalDuration(workout), 160);
  const mid = positionAt(workout, 50);
  assert.equal(mid.index, 0);
  assert.ok(Math.abs(mid.fraction - 0.75) < 1e-9);
  assert.equal(mid.remainingS, 110);
  const step = positionAt(workout, 100);
  assert.equal(step.index, 1);
  assert.equal(step.fraction, 1.2);
  assert.equal(step.segmentRemainingS, 60);
  assert.ok(positionAt(workout, 160).finished);
});

test("the player converts to watts, pauses and skips", () => {
  const workout = createWorkout({ name: "t", segments: [steady(60, 0.5), steady(60, 1.0)] });
  const player = new WorkoutPlayer(workout, 250);
  assert.equal(player.tick(100).targetWatts, 125);
  player.tick(130);
  assert.equal(player.elapsedS, 30);
  player.paused = true;
  player.tick(200);
  assert.equal(player.elapsedS, 30, "paused time does not count");
  player.paused = false;
  player.skipSegment();
  assert.equal(player.tick(200).targetWatts, 250);
  player.tick(300);
  assert.ok(player.state().finished);
});

test("presets are valid and zones match FTP fractions", () => {
  assert.ok(PRESET_WORKOUTS.length >= 3);
  for (const workout of PRESET_WORKOUTS) assert.ok(totalDuration(workout) > 0);
  assert.deepEqual([0.5, 0.7, 0.85, 1.0, 1.15, 1.5].map(zoneFor), [1, 2, 3, 4, 5, 6]);
});

const ZWO = `<?xml version="1.0"?>
<workout_file>
  <author>Coach</author>
  <name>Over &amp; Unders</name>
  <description>Threshold work</description>
  <sportType>bike</sportType>
  <workout>
    <Warmup Duration="600" PowerLow="0.40" PowerHigh="0.70"/>
    <SteadyState Duration="300" Power="0.88" Cadence="90">
      <textevent timeoffset="10" message="Settle in"/>
    </SteadyState>
    <IntervalsT Repeat="2" OnDuration="120" OffDuration="60" OnPower="1.05" OffPower="0.6"/>
    <Ramp Duration="120" PowerLow="0.6" PowerHigh="0.9"/>
    <FreeRide Duration="180"/>
    <Cooldown Duration="300" PowerLow="0.65" PowerHigh="0.40"/>
  </workout>
</workout_file>`;

test("parses .zwo workout files", () => {
  const workout = parseZwo(ZWO);
  assert.equal(workout.name, "Over & Unders");
  assert.equal(workout.description, "Threshold work");
  assert.deepEqual(
    workout.segments.map((s) => s.kind),
    ["warmup", "steady", "on", "off", "on", "off", "ramp", "steady", "cooldown"],
  );
  assert.equal(workout.segments[0].from, 0.4);
  assert.equal(workout.segments[0].to, 0.7);
  assert.equal(workout.segments[2].from, 1.05);
  assert.equal(workout.segments[7].label, "Free ride");
  assert.equal(totalDuration(workout), 600 + 300 + 2 * 180 + 120 + 180 + 300);
});

test("rejects files that are not workouts", () => {
  assert.throws(() => parseZwo("<html></html>"), /not a .zwo/);
  assert.throws(() => parseZwo("<workout_file><name>x</name></workout_file>"), /no <workout>/);
  assert.throws(() => parseZwo("<workout_file><workout><SteadyState Duration=\"x\" Power=\"1\"/></workout></workout_file>"), /no duration/);
});

// --- training control -------------------------------------------------------

import { TrainingControl } from "../public/js/ride/trainingControl.js";
import { workoutShapes } from "../public/js/view/workoutView.js";

test("training control: sim by default, manual ERG with clamped steps", () => {
  const control = new TrainingControl({ ftp: 250 });
  assert.deepEqual(control.command(() => ({ grade: 3 })), { grade: 3 });
  assert.equal(control.adjust(+1), false, "no adjusting in sim mode");
  control.setMode("erg");
  assert.deepEqual(control.command(() => ({ grade: 3 })), { power: 150 });
  control.adjust(+1);
  assert.equal(control.targetWatts(), 155);
  for (let i = 0; i < 400; i += 1) control.adjust(-1);
  assert.equal(control.targetWatts(), 50);
  assert.throws(() => control.setMode("turbo"));
});

test("training control: workouts set the target and intensity scales it", () => {
  const control = new TrainingControl({ ftp: 200 });
  const workout = createWorkout({ name: "w", segments: [steady(60, 1.0), steady(60, 0.5)] });
  control.startWorkout(workout);
  assert.equal(control.mode, "erg");
  control.tick(0, { cadence: 90 });
  assert.equal(control.targetWatts(), 200);
  control.adjust(-1);
  assert.equal(control.targetWatts(), 190, "95 % intensity");
  control.tick(30, { cadence: 5 });
  control.tick(40, { cadence: 5 });
  assert.equal(control.workoutState().elapsedS, 30, "stopped pedalling pauses the workout");
  control.tick(45, { cadence: 90 });
  control.tick(50, { cadence: 90 });
  assert.equal(control.workoutState().elapsedS, 35, "pedalling again resumes it");
});

test("training control: a paused ride holds the workout clock even while pedalling (#89)", () => {
  const control = new TrainingControl({ ftp: 200 });
  control.startWorkout(createWorkout({ name: "w", segments: [steady(60, 1.0)] }));
  control.tick(0, { cadence: 90 });
  control.held = true;
  control.tick(10, { cadence: 90 });
  control.tick(20, { cadence: 90 });
  assert.equal(control.workoutState().elapsedS, 10, "the tick before the hold still counts, then it stands still");
  control.held = false;
  control.tick(25, { cadence: 90 });
  control.tick(30, { cadence: 90 });
  assert.equal(control.workoutState().elapsedS, 15);
});

test("training control: a finished workout falls back to manual ERG and reports it", () => {
  const control = new TrainingControl({ ftp: 200 });
  let finished = null;
  control.on("workoutFinished", (w) => (finished = w.name));
  control.startWorkout(createWorkout({ name: "short", segments: [steady(10, 1)] }));
  control.tick(0, { cadence: 90 });
  control.tick(11, { cadence: 90 });
  assert.equal(finished, "short");
  assert.equal(control.workout, null);
  assert.equal(control.targetWatts(), 100);
  control.setMode("sim");
  assert.equal(control.targetWatts(), null);
});

test("training control: power-only trainers get guided workouts, never ERG", () => {
  const control = new TrainingControl({ ftp: 200, canControl: false });
  assert.equal(control.setMode("erg"), false);
  assert.equal(control.mode, "sim");
  assert.equal(control.targetWatts(), null);

  control.startWorkout(createWorkout({ name: "w", segments: [steady(60, 1.0)] }));
  assert.equal(control.mode, "sim");
  assert.equal(control.guided, true);
  control.tick(0, { cadence: 90 });
  assert.equal(control.targetWatts(), 200, "the target is still shown");
  assert.deepEqual(control.command(() => ({ grade: 2 })), { grade: 2 }, "but the road keeps control");
  assert.equal(control.adjust(+1), true, "intensity still works");
  assert.equal(control.targetWatts(), 210);
});

test("workout chart shapes span the width and scale with power", () => {
  const workout = createWorkout({ name: "w", segments: [steady(60, 0.5), steady(60, 1.2)] });
  const shapes = workoutShapes(workout, 600, 100, { maxFraction: 1.2, padding: 0 });
  assert.equal(shapes.length, 2);
  assert.deepEqual(shapes[0].points[0], [0, 100]);
  assert.equal(shapes[1].points[2][0], 600);
  assert.equal(shapes[1].points[1][1], 0, "1.2 × FTP reaches the top");
  assert.ok(Math.abs(shapes[0].points[1][1] - 100 * (1 - 0.5 / 1.2)) < 1e-9);
  assert.equal(shapes[1].zone, 5, "120 % FTP is zone 5");
});

test("a locked workout ignores adjust and skipSegment until it stops", () => {
  const control = new TrainingControl({ ftp: 200 });
  control.startWorkout(createWorkout({ name: "t", segments: [steady(60, 1)] }), { locked: true });
  control.tick(0);
  assert.equal(control.locked, true);
  assert.equal(control.adjust(1), false);
  assert.equal(control.intensity, 1);
  control.skipSegment();
  assert.equal(control.tick(0).elapsedS, 0);
  control.stopWorkout();
  assert.equal(control.locked, false);
  control.startWorkout(createWorkout({ name: "t", segments: [steady(60, 1)] }));
  assert.equal(control.adjust(1), true);
  control.skipSegment();
  assert.equal(control.tick(0).finished, true);
});
