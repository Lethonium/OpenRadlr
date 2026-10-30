import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setLocale } from "../public/js/i18n/i18n.js";
import {
  MENU_PAGES, visiblePages, pageStatus, pageTitle, createMenuNav,
} from "../public/js/view/menuPages.js";

afterEach(() => setLocale("en"));

const ctx = {
  viewMode: "3d", cameraLabel: "Chase", vehicleLabel: null, racePhase: null,
  trainingLabel: "Road (sim)", eventCount: 2, units: "metric",
};

test("overview is first", () => {
  assert.equal(MENU_PAGES[0], "overview");
  assert.deepEqual(MENU_PAGES, ["overview", "view", "vehicle", "race", "events", "training", "settings"]);
});

test("studio drops vehicle race events and keeps training", () => {
  assert.deepEqual(visiblePages({ studio: true, hasEvents: true }),
    ["overview", "view", "training", "settings"]);
});

test("events only with events", () => {
  assert.ok(!visiblePages({ studio: false, hasEvents: false }).includes("events"));
  assert.ok(visiblePages({ studio: false, hasEvents: true }).includes("events"));
});

test("setPages keeps the open page when it survives and falls back when it does not", () => {
  const nav = createMenuNav(MENU_PAGES);
  nav.open("race");
  nav.setPages(["overview", "race"]);
  assert.equal(nav.page, "race");
  nav.setPages(["overview", "view"]);
  assert.equal(nav.page, "overview");
});

test("back returns to the list", () => {
  const nav = createMenuNav(MENU_PAGES);
  assert.equal(nav.page, null);
  nav.open("view");
  assert.equal(nav.page, "view");
  nav.back();
  assert.equal(nav.page, null);
});

test("open ignores pages that are not in the list", () => {
  const nav = createMenuNav(["overview"]);
  nav.open("race");
  assert.equal(nav.page, null);
});

test("status lines read as in the spec", () => {
  assert.equal(pageStatus("view", ctx), "3D · Chase");
  assert.equal(pageStatus("view", { ...ctx, viewMode: "2d" }), "2D");
  assert.equal(pageStatus("vehicle", ctx), "Not boarded");
  assert.equal(pageStatus("vehicle", { ...ctx, vehicleLabel: "Tandem" }), "Tandem");
  assert.equal(pageStatus("race", ctx), "None running");
  assert.equal(pageStatus("race", { ...ctx, racePhase: "idle" }), "None running");
  assert.equal(pageStatus("race", { ...ctx, racePhase: "running" }), "Running");
  assert.equal(pageStatus("training", ctx), "Road (sim)");
  assert.equal(pageStatus("events", ctx), "2 happening");
  assert.equal(pageStatus("settings", ctx), "km · kg");
  assert.equal(pageStatus("settings", { ...ctx, units: "imperial" }), "mi · lb");
  assert.equal(pageStatus("overview", ctx), "");
});

test("status and titles follow the locale", () => {
  setLocale("de");
  assert.equal(pageStatus("vehicle", ctx), "Nicht aufgestiegen");
  assert.equal(pageTitle("settings"), "Einstellungen");
});

test("page titles", () => {
  assert.equal(pageTitle("overview"), "Overview");
  assert.equal(pageTitle("training"), "Training");
});
