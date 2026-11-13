import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeleteConfirm, deleteTexts } from "../public/js/view/deleteConfirm.js";
import { createPanelStack } from "../public/js/input/panelStack.js";
import { t } from "../public/js/i18n/i18n.js";

function fakeEl() {
  const listeners = new Map();
  return {
    hidden: true, disabled: false, checked: false, textContent: "", children: [],
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    fire(type, extra = {}) { for (const fn of listeners.get(type) ?? []) fn({ target: this, ...extra }); },
    replaceChildren(...nodes) { this.children = nodes; },
    focus() { fakeEl.focused = this; },
  };
}
const doc = { createElement: (tag) => ({ tag, textContent: "" }) };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const els = Object.fromEntries(["root", "title", "lines", "tickRow", "tick", "error", "exportButton", "cancel", "go"].map((k) => [k, fakeEl()]));
  const stack = createPanelStack();
  const confirm = createDeleteConfirm({ els, stack, doc });
  return { els, stack, confirm };
}

test("deleteTexts: rides say what goes, what changes and what stays", () => {
  const x = deleteTexts("rides", { count: 42, from: "3 Mar", to: "13 Nov" });
  assert.equal(x.action, "Delete 42 rides");
  assert.ok(x.lines.some((line) => line.includes("42 rides from 3 Mar to 13 Nov")));
  assert.ok(x.lines.some((line) => /set FTP stays/.test(line)));
  assert.ok(x.lines.some((line) => /Strava/.test(line)));
  assert.match(x.lines.at(-1), /cannot be undone/);
  assert.equal(x.offerExport, true);
  assert.equal(x.requireTick, false);
});

test("deleteTexts: one ride offers no export", () => {
  const x = deleteTexts("ride", { date: "Tue, Nov 10" });
  assert.equal(x.action, "Delete this ride");
  assert.equal(x.offerExport, false);
  assert.ok(x.lines[0].includes("Tue, Nov 10"));
});

test("deleteTexts: the profile reset says servers see a new rider", () => {
  assert.ok(deleteTexts("profile", {}).lines.some((line) => /new rider/.test(line)));
});

test("deleteTexts: everything needs the tick", () => {
  assert.equal(deleteTexts("everything", { count: 3 }).requireTick, true);
  assert.equal(deleteTexts("everything", { count: 3 }).action, "Delete everything");
});

test("deleteTexts: every kind of data has its texts", () => {
  for (const item of ["ride", "rides", "bestLaps", "profile", "progress", "unfinished", "settings", "everything"]) {
    const x = deleteTexts(item, { count: 2, summits: 1, lemons: 3, from: "a", to: "b", date: "d" });
    assert.ok(x.title && x.action && x.lines.length >= 2, item);
    assert.ok(![x.title, x.action, ...x.lines].join(" ").includes("{"), item);
  }
});

test("ask: shows the texts and focuses Cancel", () => {
  const { els, confirm } = setup();
  confirm.ask({ texts: deleteTexts("rides", { count: 2, from: "a", to: "b" }), onConfirm: async () => true, onExport: () => {} });
  assert.equal(els.root.hidden, false);
  assert.equal(els.title.textContent, "Delete all rides?");
  assert.equal(els.go.textContent, "Delete 2 rides");
  assert.equal(els.lines.children.length, deleteTexts("rides", { count: 2, from: "a", to: "b" }).lines.length);
  assert.equal(fakeEl.focused, els.cancel);
  assert.equal(els.exportButton.hidden, false);
  assert.equal(els.tickRow.hidden, true);
});

test("ask: Cancel deletes nothing", async () => {
  const { els, confirm } = setup();
  let deleted = false;
  const answer = confirm.ask({ texts: deleteTexts("ride", {}), onConfirm: async () => (deleted = true) });
  els.cancel.fire("click");
  assert.equal(await answer, false);
  assert.equal(deleted, false);
  assert.equal(els.root.hidden, true);
});

test("ask: a click beside the card deletes nothing", async () => {
  const { els, confirm } = setup();
  const answer = confirm.ask({ texts: deleteTexts("ride", {}), onConfirm: async () => true });
  els.root.fire("click", { target: els.root });
  assert.equal(await answer, false);
});

test("ask: Esc through the panel stack closes only the confirm", async () => {
  const { stack, confirm } = setup();
  let profileClosed = false;
  stack.push({ close: () => (profileClosed = true) });
  const answer = confirm.ask({ texts: deleteTexts("ride", {}), onConfirm: async () => true });
  stack.closeTop();
  assert.equal(await answer, false);
  assert.equal(profileClosed, false);
  stack.closeTop();
  assert.equal(profileClosed, true);
});

test("ask: everything stays disabled until ticked", async () => {
  const { els, confirm } = setup();
  let deleted = false;
  confirm.ask({ texts: deleteTexts("everything", { count: 3 }), onConfirm: async () => (deleted = true) });
  assert.equal(els.tickRow.hidden, false);
  assert.equal(els.go.disabled, true);
  els.go.fire("click");
  await tick();
  assert.equal(deleted, false);
  els.tick.checked = true;
  els.tick.fire("change");
  assert.equal(els.go.disabled, false);
});

test("ask: a successful delete closes and resolves true", async () => {
  const { els, confirm } = setup();
  const answer = confirm.ask({ texts: deleteTexts("ride", {}), onConfirm: async () => true });
  els.go.fire("click");
  assert.equal(await answer, true);
  assert.equal(els.root.hidden, true);
});

test("ask: a failed delete keeps the card open with an error", async () => {
  const { els, confirm } = setup();
  let settled = false;
  const answer = confirm.ask({ texts: deleteTexts("ride", {}), onConfirm: async () => false });
  answer.then(() => (settled = true));
  els.go.fire("click");
  await tick();
  assert.equal(els.root.hidden, false);
  assert.equal(els.error.hidden, false);
  assert.equal(els.error.textContent, t("profilePage.delete.failed"));
  assert.equal(settled, false);
  els.cancel.fire("click");
  assert.equal(await answer, false);
});

test("ask: Export first runs the export and keeps the card open", () => {
  const { els, confirm } = setup();
  let exported = 0;
  confirm.ask({ texts: deleteTexts("rides", { count: 2, from: "a", to: "b" }), onConfirm: async () => true, onExport: () => exported++ });
  els.exportButton.fire("click");
  assert.equal(exported, 1);
  assert.equal(els.root.hidden, false);
});
