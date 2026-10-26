import { test } from "node:test";
import assert from "node:assert/strict";
import { ftpTestState } from "../public/js/view/ftpTestView.js";

test("idle offers the test, with a hint while the FTP is only a default", () => {
  const measured = ftpTestState({ state: "idle", source: "tested" });
  assert.equal(measured.primary.label, "FTP test");
  assert.equal(measured.body, "");
  assert.equal(ftpTestState({ state: "idle", source: "default" }).body, "No measured FTP yet. Take the ramp test.");
});

test("warm-up shows the best minute so far, or a dash", () => {
  const live = ftpTestState({ state: "warmup", liveMinuteW: 141.6 });
  assert.equal(live.heading, "Warm up");
  assert.equal(live.body, "Ride freely at your own level. Your best minute so far: 142 W.");
  assert.equal(live.primary.label, "I'm warm, set up the ramp");
  assert.equal(live.fields, false);
  assert.equal(ftpTestState({ state: "warmup", liveMinuteW: null }).body, "Ride freely at your own level. Your best minute so far: –.");
});

test("settings shows the fields and a way back", () => {
  const view = ftpTestState({ state: "settings", startW: 90, stepW: 10 });
  assert.equal(view.heading, "Ramp setup");
  assert.equal(view.body, "Starts at 90 W and adds 10 W every minute until you can't hold the target.");
  assert.equal(view.fields, true);
  assert.equal(view.primary.label, "Start ramp");
  assert.equal(view.secondary.label, "Back to warmup");
});

test("countdown and ramp", () => {
  const countdown = ftpTestState({ state: "countdown" });
  assert.equal(countdown.heading, "Get ready");
  assert.equal(countdown.primary, null);
  const ramp = ftpTestState({ state: "ramp" });
  assert.equal(ramp.heading, "Ramp test");
  assert.equal(ramp.body, "Hold the target as long as you can.");
  assert.equal(ramp.primary.label, "I'm done");
});

test("a result offers the new FTP and keeps the current one as the alternative", () => {
  const view = ftpTestState({ state: "result", result: { ftp: 240, bestMinuteW: 320, durationS: 900 }, ftp: 200 });
  assert.equal(view.heading, "Your FTP ≈ 240 W");
  assert.equal(view.body, "75 % of your best minute (320 W). It is an estimate.");
  assert.equal(view.primary.label, "Use 240 W");
  assert.equal(view.secondary.label, "Keep 200 W");
});

test("a too short ramp asks to try again", () => {
  const view = ftpTestState({ state: "result", result: { tooShort: true }, ftp: 200 });
  assert.equal(view.heading, "That ramp was too short to trust.");
  assert.equal(view.primary.label, "Try again");
  assert.equal(view.secondary.label, "Keep 200 W");
});
