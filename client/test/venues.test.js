import { test } from "node:test";
import assert from "node:assert/strict";
import { VENUES, figuresAt, venueRoute } from "../public/js/workout/venues.js";
import { PRESETS } from "../public/js/workout/presets.js";

test("the figures at a venue are the distinct exercises of its presets, in order", () => {
  assert.deepEqual(figuresAt("valley-cafe", PRESETS), ["squats", "situps", "pushups", "jumping_jacks", "plank", "burpees"]);
  assert.deepEqual(figuresAt("hill-cafe", PRESETS), ["squats", "burpees"]);
  assert.deepEqual(figuresAt("beach-cafe", PRESETS), ["situps", "plank", "pushups"]);
  assert.deepEqual(figuresAt("forge-hut", PRESETS), []);
});

test("the venue route is the first offered route that starts at the café", () => {
  const cafes = [{ id: "beach-cafe", x: 700, y: -3220 }, { id: "valley-cafe", x: 0, y: 0 }];
  const routes = [
    { id: "a", start: { x: 0, y: 0 } },
    { id: "b", start: { x: 710, y: -3200 } },
    { id: "c", start: { x: 700, y: -3220 } },
  ];
  assert.equal(venueRoute("beach-cafe", routes, cafes), "b");
  assert.equal(venueRoute("valley-cafe", routes, cafes), "a");
});

test("no offered route within 30 m of the café gives no venue route", () => {
  const cafes = [{ id: "valley-cafe", x: 0, y: 0 }];
  assert.equal(venueRoute("valley-cafe", [{ id: "far", start: { x: 31, y: 0 } }], cafes), null);
  assert.equal(venueRoute("nowhere", [{ id: "a", start: { x: 0, y: 0 } }], cafes), null);
});

test("every preset names a known venue", () => {
  for (const preset of PRESETS) assert.ok(Object.hasOwn(VENUES, preset.venue), preset.id);
});
