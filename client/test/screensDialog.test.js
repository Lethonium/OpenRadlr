import { test } from "node:test";
import assert from "node:assert/strict";
import { Emitter } from "../public/js/util/emitter.js";
import { createScreensDialog } from "../public/js/view/screensDialog.js";
import { fakeScheduler } from "./helpers.js";

function fakeEl() {
  const listeners = {};
  return {
    textContent: "",
    hidden: false,
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    click: () => (listeners.click ?? []).forEach((fn) => fn({})),
  };
}

function setup({ confirmAnswer = true } = {}) {
  const els = { code: fakeEl(), countdown: fakeEl(), bar: fakeEl(), renew: fakeEl(), unpair: fakeEl(), status: fakeEl(), note: fakeEl() };
  els.bar.vars = {};
  els.bar.style = { setProperty: (name, value) => (els.bar.vars[name] = value) };
  const session = Object.assign(new Emitter(), { calls: [], start() { this.calls.push("start"); }, renew() { this.calls.push("renew"); }, close() { this.calls.push("close"); } });
  const scheduler = fakeScheduler();
  const clock = { ms: 0 };
  const asked = [];
  const unpaired = [];
  const dialog = createScreensDialog({
    els,
    createSession: () => session,
    now: () => clock.ms,
    setInterval: scheduler.setInterval,
    clearInterval: scheduler.clearInterval,
    confirm: (question) => (asked.push(question), confirmAnswer),
    onUnpair: () => unpaired.push(true),
    t: (key) => key,
  });
  return { els, session, scheduler, clock, asked, unpaired, dialog };
}

test("opening starts a session and shows the code it gets", () => {
  const { dialog, els, session } = setup();
  dialog.open();
  assert.deepEqual(session.calls, ["start"]);
  session.emit("code", { code: "ABC234", expiresInS: 300 });
  assert.equal(els.code.textContent, "ABC 234");
  assert.equal(els.bar.vars["--share"], "1");
  assert.equal(els.countdown.textContent, "5:00");
  assert.equal(els.renew.hidden, true);
});

test("the countdown runs out and offers a new code", () => {
  const { dialog, els, session, scheduler, clock } = setup();
  dialog.open();
  session.emit("code", { code: "ABC234", expiresInS: 300 });
  clock.ms = 65_000;
  scheduler.fire();
  assert.equal(els.countdown.textContent, "3:55");
  assert.equal(els.bar.vars["--share"], String(235 / 300));
  clock.ms = 300_000;
  scheduler.fire();
  assert.equal(els.countdown.textContent, "screens.expired");
  assert.equal(els.bar.vars["--share"], "0");
  assert.equal(els.renew.hidden, false);
  assert.equal(scheduler.active, 0);
  els.renew.click();
  assert.deepEqual(session.calls, ["start", "renew"]);
});

test("a claimed code shows the paired status", () => {
  const { dialog, els, session } = setup();
  dialog.open();
  session.emit("code", { code: "ABC234", expiresInS: 300 });
  session.emit("claimed");
  assert.equal(els.status.textContent, "screens.paired");
});

test("unpair asks first and renews the key", () => {
  const { dialog, els, asked, unpaired, session } = setup();
  dialog.open();
  els.unpair.click();
  assert.deepEqual(asked, ["screens.unpairConfirm"]);
  assert.equal(unpaired.length, 1);
  assert.equal(els.note.textContent, "screens.unpaired");
  assert.deepEqual(session.calls, ["start", "close"]);
});

test("unpair does nothing when not confirmed", () => {
  const { dialog, els, unpaired } = setup({ confirmAnswer: false });
  dialog.open();
  els.unpair.click();
  assert.equal(unpaired.length, 0);
});

test("closing stops the countdown and the session", () => {
  const { dialog, session, scheduler } = setup();
  dialog.open();
  session.emit("code", { code: "ABC234", expiresInS: 300 });
  dialog.close();
  assert.equal(scheduler.active, 0);
  assert.equal(session.calls.at(-1), "close");
});
