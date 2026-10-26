import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOOR_GRADE, GEAR_RATIOS, Gearbox, SHIFTING_CW, effectiveGrade, referenceRatio } from "../public/js/ride/virtualShifting.js";
import { RideSession } from "../public/js/ride/rideSession.js";
import { Emitter } from "../public/js/util/emitter.js";
import { fakeScheduler } from "./helpers.js";

const base = { gradePercent: 0, referenceRatio: referenceRatio(34, 14), speed: 0, massKg: 75 };

test("24 gears from easy to hard", () => {
  assert.equal(GEAR_RATIOS.length, 24);
  assert.equal(GEAR_RATIOS[0], 0.75);
  assert.equal(GEAR_RATIOS.at(-1), 5);
  for (let i = 1; i < GEAR_RATIOS.length; i += 1) assert.ok(GEAR_RATIOS[i] > GEAR_RATIOS[i - 1]);
});

test("the gearbox shifts within its range", () => {
  const box = new Gearbox({ startGear: 2 });
  assert.equal(box.gear, 2);
  assert.ok(box.shiftDown());
  assert.equal(box.shiftDown(), false, "already in the easiest gear");
  const top = new Gearbox({ startGear: 24 });
  assert.equal(top.shiftUp(), false);
  assert.equal(top.ratio, 5);
  assert.equal(new Gearbox({ startGear: 99 }).gear, 24);
});

test("the physical gear passes a climb on, plus the air drag at the rider's speed", () => {
  for (const gradePercent of [3, 8]) {
    const grade = effectiveGrade({ ...base, gradePercent, ratio: base.referenceRatio });
    assert.ok(Math.abs(grade - gradePercent) <= 0.1, `${gradePercent} % became ${grade} %`);
  }
  const fast = effectiveGrade({ ...base, gradePercent: 3, ratio: base.referenceRatio, speed: 8 });
  assert.ok(fast > 3.5, `at 29 km/h ${fast} %`);
  const drafting = effectiveGrade({ ...base, gradePercent: 3, ratio: base.referenceRatio, speed: 8, dragFactor: 0.7 });
  assert.ok(drafting < fast, "less drag in a draft");
});

test("harder gears feel steeper, easier gears flatter", () => {
  const easy = effectiveGrade({ ...base, gradePercent: 5, ratio: 1.2 });
  const same = effectiveGrade({ ...base, gradePercent: 5, ratio: base.referenceRatio });
  const hard = effectiveGrade({ ...base, gradePercent: 5, ratio: 4 });
  assert.ok(easy < same && same < hard, `${easy} < ${same} < ${hard}`);
});

test("each gear changes the force by its ratio, whatever the cadence", () => {
  // On the flat at 36 km/h: the force at the pedals scales with the gear, no more.
  const force = (ratio) => effectiveGrade({ ...base, speed: 10, ratio }) + 0.4; // + rolling resistance
  const top = force(GEAR_RATIOS.at(-1));
  const next = force(GEAR_RATIOS.at(-2));
  assert.ok(Math.abs(top / next - GEAR_RATIOS.at(-1) / GEAR_RATIOS.at(-2)) < 0.05, `${next} % to ${top} %`);
  assert.ok(top < 7, `the hardest gear at 36 km/h stays a hill, not a wall: ${top} %`);
});

test("a descent keeps something to push against, more in a harder gear", () => {
  // Rolling down 6 % at 55 km/h: the road's own force is about nothing there.
  const descent = { ...base, gradePercent: -6, speed: 15.3 };
  const physical = effectiveGrade({ ...descent, ratio: base.referenceRatio });
  assert.ok(Math.abs(physical - (FLOOR_GRADE - 0.4)) <= 0.1, `${physical} %`);
  const top = effectiveGrade({ ...descent, ratio: GEAR_RATIOS.at(-1) });
  assert.ok(top > physical && top < 4, `top gear: ${top} %`);
  // Pedalling faster than one rolls makes the air push back.
  const faster = effectiveGrade({ ...descent, speed: 18, ratio: GEAR_RATIOS.at(-1) });
  assert.ok(faster > top, `${top} % to ${faster} %`);
});

test("results stay in a range trainers accept", () => {
  assert.equal(effectiveGrade({ ...base, gradePercent: 15, ratio: 5, speed: 10 }), 20);
  assert.ok(effectiveGrade({ ...base, gradePercent: -40, ratio: 0.75 }) >= -10);
  assert.ok(Number.isFinite(effectiveGrade({ ...base, speed: null, ratio: 3 })));
});

class FakeTrainer extends Emitter {
  grades = [];
  options = [];
  async setGrade(grade, options) {
    this.grades.push(grade);
    this.options.push(options);
  }
}

test("the ride session re-sends resistance when speed changes the virtual load", async () => {
  const scheduler = fakeScheduler();
  const trainer = new FakeTrainer();
  const connection = new Emitter();
  connection.sendTelemetry = () => {};
  const gearbox = new Gearbox({ startGear: 20 });
  let speed = 6;
  const session = new RideSession({
    connection,
    trainer,
    resistanceModel: (grade) => ({ grade: effectiveGrade({ ...base, gradePercent: grade, ratio: gearbox.ratio, speed }), cw: SHIFTING_CW }),
    ...scheduler,
  });
  session.start();
  scheduler.fire();
  assert.equal(trainer.grades.length, 0, "nothing is sent before the server grade arrives");

  connection.emit("resistance", { grade_percent: 0 });
  speed = 11;
  scheduler.fire();
  scheduler.fire();
  await Promise.resolve();
  assert.equal(trainer.grades.length, 2, "initial grade plus one update after the speed changed");
  assert.ok(trainer.grades[1] > trainer.grades[0]);
  assert.deepEqual(trainer.options.at(-1), { cw: 0 }, "the trainer adds no air drag of its own");

  // A shift applies at once.
  gearbox.shiftUp();
  session.refreshResistance();
  assert.ok(trainer.grades[2] > trainer.grades[1]);
});
