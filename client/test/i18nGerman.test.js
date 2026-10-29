// German output of the pure text helpers (plurals and params in context).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setLocale } from "../public/js/i18n/i18n.js";
import { routeRiders, workoutTagline, stageHeadline } from "../public/js/view/startMenu.js";
import { raceStatus, onlineSummary } from "../public/js/view/panels.js";
import { eventBanner } from "../public/js/view/events.js";
import { ftpPromptText } from "../public/js/view/ftpPrompt.js";
import { splitLabel } from "../public/js/view/hud.js";
import { vehicleLabel } from "../public/js/ride/vehicle.js";
import { PRESETS } from "../public/js/workout/presets.js";
import { planSummary } from "../public/js/workout/plan.js";

afterEach(() => setLocale("en"));

test("rider counts and phone riders", () => {
  setLocale("de");
  assert.equal(routeRiders({ players: 3, phone_players: 1 }), "3 Fahrer · 1 📱");
});

test("race status and online summary", () => {
  setLocale("de");
  assert.equal(raceStatus({ phase: "countdown", remaining_s: 9.2, laps: 1 }), "Rennen startet in 10 s · 1 Runde");
  assert.equal(raceStatus({ phase: "countdown", remaining_s: 9, laps: 3 }), "Rennen startet in 9 s · 3 Runden");
  assert.equal(onlineSummary(4, [], { humans: 2, bots: 1 }).text, "4 Fahrer online · 2 auf dieser Strecke · 1 Bot");
});

test("event banner, FTP offer, split labels and vehicle label", () => {
  setLocale("de");
  assert.equal(eventBanner({ phase: "lobby", kind: "race", starts_in_s: 65, entered: true }), "Rennen startet in 1:05 · du bist dabei");
  assert.equal(ftpPromptText({ ftp: 250, delta: 10, basis: "twenty", source: "rides" }).title, "Neue FTP erkannt: 250 W (+10)");
  assert.equal(splitLabel({ kind: "lap", lap: 3 }), "Runde 3");
  assert.equal(vehicleLabel("tandem", "Anna"), "Tandem von Anna");
});

test("stage headline and workout presets read in German", () => {
  setLocale("de");
  assert.equal(stageHeadline({ kind: "workout" }), "Wähle dein Workout");
  assert.equal(workoutTagline(PRESETS), "3 Workouts · 4–12 Min.");
  assert.equal(PRESETS[0].name, "Ganzkörper");
  assert.match(planSummary(PRESETS[0]), /^Kniebeugen 40 s · Pause 20 s/);
});
