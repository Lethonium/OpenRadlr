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

function fakeNode(tag) {
  return { tag, className: "", textContent: "", children: [], append(...kids) { this.children.push(...kids); }, setAttribute() {} };
}

function setup({ confirmAnswer = true, initial = [] } = {}) {
  const els = { code: fakeEl(), countdown: fakeEl(), bar: fakeEl(), renew: fakeEl(), unpair: fakeEl(), status: fakeEl(), note: fakeEl(), empty: fakeEl() };
  els.list = { children: [], replaceChildren(...kids) { this.children = kids; } };
  const stored = [...initial];
  const paired = { list: () => stored, add: (device, at) => stored.push({ device, pairedAt: at }), clear: () => (stored.length = 0) };
  els.bar.vars = {};
  els.bar.style = { setProperty: (name, value) => (els.bar.vars[name] = value) };
  const session = Object.assign(new Emitter(), { calls: [], start() { this.calls.push("start"); }, query() { this.calls.push("query"); }, renew() { this.calls.push("renew"); }, close() { this.calls.push("close"); } });
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
    paired,
    doc: { createElement: fakeNode },
    formatDate: (ms) => `on ${ms}`,
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
  });
  return { els, session, scheduler, clock, asked, unpaired, dialog, paired };
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
  session.emit("claimed", { device: null });
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

const rowTexts = (els) => els.list.children.map((li) => li.children.map((c) => c.textContent));

test("a claimed code adds the device to the list with the date", () => {
  const { dialog, els, session, clock } = setup();
  dialog.open();
  clock.ms = 5000;
  session.emit("claimed", { device: "Pixel 8" });
  assert.deepEqual(rowTexts(els), [["", "Pixel 8", "on 5000"]]);
  assert.equal(els.status.textContent, 'screens.pairedDevice {"device":"Pixel 8"}');
});

test("the list says nothing is paired when it is empty", () => {
  const { dialog, els } = setup();
  dialog.showList();
  assert.equal(els.empty.hidden, false);
  assert.deepEqual(els.list.children, []);
});

test("showing the list asks the server who watches and marks those live", () => {
  const { dialog, els, session } = setup({ initial: [{ device: "Quest 3", pairedAt: 1 }, { device: "Pixel 8", pairedAt: 2 }] });
  dialog.showList();
  assert.deepEqual(session.calls, ["start", "query"]);
  assert.equal(els.empty.hidden, true);
  assert.deepEqual(els.list.children.map((li) => li.children[0].className), ["screens-dot", "screens-dot"]);
  session.emit("watching", ["Quest 3"]);
  assert.deepEqual(els.list.children.map((li) => li.children[0].className), ["screens-dot is-live", "screens-dot"]);
  assert.deepEqual(rowTexts(els)[0], ["", "Quest 3", "on 1 · screens.live"]);
  assert.equal(session.calls.at(-1), "close");
});

test("the list asks again every few seconds and stops when closed", () => {
  const { dialog, session, scheduler } = setup();
  dialog.showList();
  scheduler.fire();
  assert.equal(session.calls.filter((c) => c === "query").length, 2);
  dialog.close();
  assert.equal(scheduler.active, 0);
});

test("unpairing empties the list", () => {
  const { dialog, els, paired } = setup({ initial: [{ device: "Quest 3", pairedAt: 1 }] });
  dialog.showList();
  els.unpair.click();
  assert.deepEqual(paired.list(), []);
  assert.deepEqual(els.list.children, []);
  assert.equal(els.empty.hidden, false);
});
