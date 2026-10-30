import { test } from "node:test";
import assert from "node:assert/strict";
import { backToMenuWarning, createFinishController } from "../public/js/ride/finishController.js";
import { t } from "../public/js/i18n/i18n.js";

function setup({ empty = false, exportable = true } = {}) {
  const calls = [];
  const step = (name) => () => { calls.push(name); return Promise.resolve(); };
  const controller = createFinishController({
    recorder: { empty },
    closePause: step("closePause"),
    saveHistory: step("saveHistory"),
    markAutosaveFinished: step("markAutosaveFinished"),
    detachConnection: step("detachConnection"),
    leaveWorld: step("leaveWorld"),
    releaseTrainer: step("releaseTrainer"),
    exportable,
  });
  return { controller, calls };
}

test("finish runs the steps in order", () => {
  const { controller, calls } = setup();
  controller.finish();
  assert.deepEqual(calls, ["closePause", "detachConnection", "leaveWorld", "releaseTrainer", "saveHistory", "markAutosaveFinished"]);
});

test("finish twice saves history once and leaves once", () => {
  const { controller, calls } = setup();
  controller.finish();
  controller.finish();
  assert.equal(calls.filter((c) => c === "saveHistory").length, 1);
  assert.equal(calls.filter((c) => c === "leaveWorld").length, 1);
});

test("an empty ride saves nothing but still leaves", () => {
  const { controller, calls } = setup({ empty: true });
  controller.finish();
  assert.deepEqual(calls, ["closePause", "detachConnection", "leaveWorld", "releaseTrainer"]);
});

test("a paddle ride marks no autosave", () => {
  const { controller, calls } = setup({ exportable: false });
  controller.finish();
  assert.ok(calls.includes("saveHistory"));
  assert.ok(!calls.includes("markAutosaveFinished"));
});

test("canRecord turns false after finish", () => {
  const { controller } = setup();
  assert.equal(controller.canRecord, true);
  assert.equal(controller.finished, false);
  controller.finish();
  assert.equal(controller.canRecord, false);
  assert.equal(controller.finished, true);
});

test("nothing unsaved gives null", () => {
  assert.equal(backToMenuWarning({ exportable: true, saved: true, empty: false, albumSize: 0 }), null);
  assert.equal(backToMenuWarning({ exportable: true, saved: false, empty: true, albumSize: 0 }), null);
  assert.equal(backToMenuWarning({ exportable: false, saved: false, empty: false, albumSize: 0 }), null);
});

test("an unsaved exportable ride warns about the ride and photos", () => {
  assert.equal(backToMenuWarning({ exportable: true, saved: false, empty: false, albumSize: 0 }), t("ride.confirmBack.exportable"));
});

test("a paddle ride warns about photos only", () => {
  assert.equal(backToMenuWarning({ exportable: false, saved: false, empty: false, albumSize: 2 }), t("ride.confirmBack.photos"));
});

test("a downloaded ride with photos warns about the photos only", () => {
  assert.equal(backToMenuWarning({ exportable: true, saved: true, empty: false, albumSize: 1 }), t("ride.confirmBack.photos"));
});

test("an empty paddle ride without photos goes back without asking", () => {
  assert.equal(backToMenuWarning({ exportable: false, saved: false, empty: true, albumSize: 0 }), null);
});
