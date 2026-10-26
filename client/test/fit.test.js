import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFitActivity, fitCrc } from "../public/js/ride/fitFile.js";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";
import { fitMessages } from "./helpers.js";

function ride(seconds = 30) {
  const recorder = new RideRecorder();
  for (let i = 0; i < seconds; i += 1) {
    recorder.add({ t: Date.UTC(2026, 9, 15, 12, 0, i), distance: i * 8, power: 210, cadence: 90, speed: 8, elevation: 40 + i, lat: 39 + i * 1e-5, lon: 2.6 });
  }
  return recorder;
}

test("a FIT file has its header, size and checksums right", () => {
  const bytes = ride().toFit();
  const view = new DataView(bytes.buffer);
  assert.equal(bytes[0], 14);
  assert.equal(String.fromCharCode(...bytes.subarray(8, 12)), ".FIT");
  assert.equal(view.getUint32(4, true), bytes.length - 16, "data size");
  assert.equal(view.getUint16(12, true), fitCrc(bytes.subarray(0, 12)), "header CRC");
  assert.equal(fitCrc(bytes), 0, "the file CRC checks out");
});

test("the FIT session says virtual ride, or indoor cycling for a spin class", () => {
  // The session's definition lists sub_sport (field 6) as an enum; find its value after the definition.
  const subSportOf = (bytes) => {
    const text = Array.from(bytes);
    // Local message 4 is the session (see fitFile.js); its data starts with 0x04 after its definition.
    const definition = text.findIndex((b, i) => b === 0x44 && text[i + 3] === 18 && text[i + 4] === 0);
    assert.ok(definition > 0, "a session definition");
    const fields = text[definition + 5];
    const sizes = Array.from({ length: fields }, (_, k) => text[definition + 6 + 3 * k + 1]);
    const numbers = Array.from({ length: fields }, (_, k) => text[definition + 6 + 3 * k]);
    const data = definition + 6 + 3 * fields;
    assert.equal(text[data], 0x04);
    const at = numbers.indexOf(6);
    return text[data + 1 + sizes.slice(0, at).reduce((a, b) => a + b, 0)];
  };
  assert.equal(subSportOf(ride().toFit()), 58);
  assert.equal(subSportOf(ride().toFit({ indoor: true })), 6);
});

test("an empty ride has no FIT file", () => {
  assert.throws(() => encodeFitActivity([]), /nothing recorded/);
});

test("fit marks pauses with timer events and leaves them out of the timer", () => {
  const recorder = new RideRecorder();
  const t0 = Date.UTC(2026, 9, 15, 12, 0, 0);
  for (let i = 0; i <= 20; i += 1) recorder.add({ t: t0 + i * 1000, distance: i * 8, power: 210, speed: 8 });
  recorder.pause(t0 + 20_000);
  recorder.resume(t0 + 50_000);
  for (let i = 50; i <= 60; i += 1) recorder.add({ t: t0 + i * 1000, distance: i * 8, power: 210, speed: 8 });
  const messages = fitMessages(recorder.toFit());
  const events = messages.filter((m) => m.global === 21);
  assert.deepEqual(
    events.map((m) => m.values[1]),
    [0, 1, 0, 4],
  );
  const session = messages.find((m) => m.global === 18);
  assert.equal(session.values[7] - session.values[8], 30_000);
});

test("fit without pauses has just the start and stop events", () => {
  const messages = fitMessages(ride().toFit());
  assert.deepEqual(
    messages.filter((m) => m.global === 21).map((m) => m.values[1]),
    [0, 4],
  );
  const session = messages.find((m) => m.global === 18);
  assert.equal(session.values[7], session.values[8]);
});

const fitTimeOf = (ms) => Math.round(ms / 1000) - 631065600;

function threeSplits(recorder) {
  const s = recorder.samples;
  const mk = (index, a, b, kind) => ({ index, kind, lap: kind === "lap" ? index : null, route: null, startIndex: a, endIndex: b, fromM: s[a].distance, toM: s[b].distance, startT: s[a].t, endT: s[b].t, durationS: (s[b].t - s[a].t) / 1000, distanceM: s[b].distance - s[a].distance, avgSpeed: 8, avgPower: 210, maxPower: 250, avgHeartRate: null, elevationGainM: 10, partial: false });
  return [mk(1, 0, 10, "lap"), mk(2, 10, 20, "lap"), mk(3, 20, 29, "free")];
}

test("fit writes one lap per split and counts them in the session", () => {
  const recorder = ride();
  const splits = threeSplits(recorder);
  const messages = fitMessages(recorder.toFit({ splits }));
  const laps = messages.filter((m) => m.global === 19);
  assert.equal(laps.length, 3);
  assert.equal(laps[1].values[2], fitTimeOf(splits[1].startT));
  assert.equal(laps[1].values[8], 10_000, "timer time");
  assert.equal(laps[0].values[24], 4);
  assert.equal(laps[2].values[24], 7, "the last lap ends the session");
  assert.equal(laps[0].values[20], 250);
  assert.equal(messages.find((m) => m.global === 18).values[26], 3);
});

test("fit without splits has one lap over the whole ride", () => {
  const messages = fitMessages(ride().toFit());
  assert.equal(messages.filter((m) => m.global === 19).length, 1);
  assert.equal(messages.find((m) => m.global === 18).values[26], 1);
});
