import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDifficulty } from "../public/js/ride/difficulty.js";
import { draftInfo } from "../public/js/ride/draft.js";
import { RideSession } from "../public/js/ride/rideSession.js";
import { RiderSmoother } from "../public/js/ride/smoothing.js";
import { Emitter } from "../public/js/util/emitter.js";
import { fakeScheduler, squareRoute } from "./helpers.js";

test("difficulty scales climbs and halves descents", () => {
  assert.equal(applyDifficulty(8, 0.5), 4);
  assert.equal(applyDifficulty(8, 1), 8);
  assert.equal(applyDifficulty(8, 0), 0);
  assert.equal(applyDifficulty(-6, 1), -3);
  assert.equal(applyDifficulty(8, 7), 8);
});

test("detects a draft only close behind in the same lane", () => {
  const route = squareRoute();
  const me = { id: 1, distance: 100, lane: 1 };
  assert.equal(draftInfo(me, [me, { id: 2, distance: 102, lane: 1.1 }], route).savingPercent, 20);
  assert.equal(draftInfo(me, [me, { id: 2, distance: 102, lane: 2 }], route), null);
  assert.equal(draftInfo(me, [me, { id: 2, distance: 110, lane: 1 }], route), null);
  assert.equal(draftInfo(me, [me, { id: 2, distance: 98, lane: 1 }], route), null);
});

test("drafting works across the start line and picks the nearest leader", () => {
  const route = squareRoute();
  const me = { id: 1, distance: 999, lane: 0 };
  const info = draftInfo(me, [me, { id: 2, distance: 3, lane: 0 }, { id: 3, distance: 1.5, lane: 0 }], route);
  assert.equal(info.leader.id, 3);
});

test("smoother extrapolates with speed and wraps at the line", () => {
  const smoother = new RiderSmoother(squareRoute(), { correctionRate: 1000 });
  smoother.update([{ id: 1, distance: 995, lane: 0, speed: 10 }], 0);
  smoother.sample(0);
  const [rider] = smoother.sample(0.5);
  assert.ok(Math.abs(rider.distance - 0) < 1e-6 || Math.abs(rider.distance - 1000) < 1e-6, `distance ${rider.distance}`);
});

test("smoother blends small corrections and snaps big jumps", () => {
  const smoother = new RiderSmoother(squareRoute(), { correctionRate: 1, maxExtrapolationS: 0 });
  smoother.update([{ id: 1, distance: 100, lane: 0, speed: 0 }], 0);
  smoother.sample(0);
  smoother.update([{ id: 1, distance: 110, lane: 0, speed: 0 }], 0.1);
  const [blended] = smoother.sample(0.1);
  assert.ok(blended.distance > 100 && blended.distance < 110);

  smoother.update([{ id: 1, distance: 600, lane: 0, speed: 0 }], 0.2);
  assert.equal(smoother.sample(0.2)[0].distance, 600);
});

test("smoother wraps riders of other routes at their own route's line (#14)", () => {
  const short = { length: 300, wrap: (d) => ((d % 300) + 300) % 300, signedGap: (a, b) => ((((b - a) % 300) + 450) % 300) - 150 };
  const smoother = new RiderSmoother(squareRoute(), { correctionRate: 1000, routeOf: (r) => (r.route === "short" ? short : undefined) });
  smoother.update([{ id: 1, route: "short", distance: 295, lane: 0, speed: 10 }, { id: 2, distance: 295, lane: 0, speed: 10 }], 0);
  smoother.sample(0);
  const [other, mine] = smoother.sample(0.5);
  assert.ok(Math.abs(other.distance) < 1e-6 || Math.abs(other.distance - 300) < 1e-6, `other at ${other.distance}`);
  assert.ok(Math.abs(mine.distance - 300) < 1e-6, `mine at ${mine.distance}`);
});

test("smoother forgets riders that left", () => {
  const smoother = new RiderSmoother(squareRoute());
  smoother.update([{ id: 1, distance: 0, lane: 0, speed: 0 }, { id: 2, distance: 5, lane: 0, speed: 0 }], 0);
  smoother.update([{ id: 2, distance: 5, lane: 0, speed: 0 }], 0.25);
  assert.deepEqual(smoother.sample(0.25).map((r) => r.id), [2]);
});

class FakeTrainer extends Emitter {
  grades = [];
  async setGrade(grade) {
    this.grades.push(grade);
  }
}

class FakeConnection extends Emitter {
  telemetry = [];
  sendTelemetry(reading) {
    this.telemetry.push(reading);
  }
}

test("ride session sends telemetry and applies resistance with difficulty", async () => {
  const scheduler = fakeScheduler();
  const trainer = new FakeTrainer();
  const connection = new FakeConnection();
  let difficulty = 0.5;
  const session = new RideSession({ connection, trainer, getDifficulty: () => difficulty, ...scheduler });
  session.start();

  trainer.emit("data", { power: 240, cadence: 92, heartRate: 150 });
  scheduler.fire();
  assert.deepEqual(connection.telemetry, [{ power: 240, cadence: 92 }]);
  assert.equal(session.latest.heartRate, 150);

  connection.emit("resistance", { grade_percent: 6 });
  difficulty = 1;
  session.refreshResistance();
  await Promise.resolve();
  assert.deepEqual(trainer.grades, [3, 6]);

  session.stop();
  assert.equal(scheduler.active, 0);
  trainer.emit("data", { power: 999 });
  assert.equal(session.latest.power, 240);
});

test("a change of grade is eased into the trainer, not passed on as a jolt", async () => {
  const scheduler = fakeScheduler();
  const trainer = new FakeTrainer();
  const connection = new FakeConnection();
  const session = new RideSession({ connection, trainer, getDifficulty: () => 1, ...scheduler });
  session.start();
  connection.emit("resistance", { grade_percent: 0 });
  assert.deepEqual(trainer.grades, [0], "the first grade applies at once");

  connection.emit("resistance", { grade_percent: 6 });
  assert.deepEqual(trainer.grades, [0], "later ones wait for the next tick");
  const seconds = (s) => {
    for (let i = 0; i < s * 4; i += 1) scheduler.fire();
  };
  seconds(1);
  const afterOne = trainer.grades.at(-1);
  assert.ok(afterOne > 0.5 && afterOne <= 1.5, `1.5 %/s at most: ${afterOne} %`);
  const steps = trainer.grades.slice(1).map((g, i) => g - trainer.grades[i]);
  assert.ok(Math.max(...steps) <= 0.4, `small steps: ${steps}`);
  seconds(10);
  assert.equal(trainer.grades.at(-1), 6, "and arrives");

  connection.emit("resistance", { grade_percent: 5.8 });
  seconds(3);
  assert.equal(trainer.grades.at(-1), 5.8, "small changes settle within seconds");
});

test("on a flat ride (the studio) the trainer gets its first command at once, ERG or not (#41)", () => {
  const scheduler = fakeScheduler();
  const trainer = new FakeTrainer();
  trainer.powers = [];
  trainer.setTargetPower = async (watts) => trainer.powers.push(watts);
  const connection = new FakeConnection();
  let erg = true;
  const session = new RideSession({ connection, trainer, flat: true, resistanceModel: (grade) => (erg ? { power: 150 } : { grade }), ...scheduler });
  session.start();
  assert.deepEqual(trainer.powers, [150], "the ERG target, without any grade from the server");

  scheduler.fire();
  assert.deepEqual(trainer.powers, [150], "and not again while it holds");
  erg = false;
  scheduler.fire();
  assert.deepEqual(trainer.grades, [0], "switching to the flat road is sent too");
});

test("a heart rate strap wins over the trainer's heart rate", () => {
  const scheduler = fakeScheduler();
  const trainer = new FakeTrainer();
  const strap = new Emitter();
  const session = new RideSession({ connection: new FakeConnection(), trainer, heartRateMonitor: strap, getDifficulty: () => 1, ...scheduler });
  session.start();
  strap.emit("data", { heartRate: 130 });
  trainer.emit("data", { power: 200, heartRate: 90 });
  assert.equal(session.latest.heartRate, 130);
});

test("trainer errors are reported, not thrown", async () => {
  const errors = [];
  const trainer = { on: () => () => {}, setGrade: () => Promise.reject(new Error("gatt busy")) };
  const session = new RideSession({ connection: new FakeConnection(), trainer, getDifficulty: () => 1, onError: (e) => errors.push(e.message), ...fakeScheduler() });
  session.refreshResistance();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(errors, ["gatt busy"]);
});

test("set connection moves telemetry and resistance to the new connection", () => {
  const scheduler = fakeScheduler();
  const trainer = new FakeTrainer();
  const first = new FakeConnection();
  const second = new FakeConnection();
  const session = new RideSession({ connection: first, trainer, getDifficulty: () => 1, ...scheduler });
  session.start();
  first.emit("resistance", { grade_percent: 2 });
  session.setConnection(second);

  trainer.emit("data", { power: 200, cadence: 90 });
  scheduler.fire();
  assert.deepEqual(first.telemetry, []);
  assert.deepEqual(second.telemetry, [{ power: 200, cadence: 90 }]);
  first.emit("resistance", { grade_percent: 9 });
  assert.equal(session.serverGrade, 2);
  second.emit("resistance", { grade_percent: 4 });
  assert.equal(session.serverGrade, 4);
  session.stop();
});
