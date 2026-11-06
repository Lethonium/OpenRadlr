import { test } from "node:test";
import assert from "node:assert/strict";
import { VENUES, figuresAt, statueRows, venueRoute } from "../public/js/workout/venues.js";
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

const mapGyms = () => ["valley-cafe", "hill-cafe", "forge-hut"].map((cafeId) => ({ cafeId, statueRow: { position: [0, 0, 0], yaw: 0 } }));

test("each gym with a known café and figures gets a statue row in its venue's material", () => {
  const gyms = mapGyms();
  const rows = statueRows(gyms, PRESETS);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].gym, gyms[0]);
  assert.deepEqual(rows[0].figures, figuresAt("valley-cafe", PRESETS));
  assert.equal(rows[0].figures.length, 6);
  assert.equal(rows[0].material, "marble");
  assert.equal(rows[1].gym, gyms[1]);
  assert.deepEqual(rows[1].figures, ["squats", "burpees"]);
  assert.equal(rows[1].material, "bronze");
});

test("a gym without a café id or a statue row gets no statues", () => {
  const rows = statueRows([{ cafeId: null, statueRow: { position: [0, 0, 0], yaw: 0 } }, { cafeId: "valley-cafe", statueRow: null }], PRESETS);
  assert.deepEqual(rows, []);
});

test("an override shows the plan's figures in its venue's material at the given gym", () => {
  const gyms = mapGyms();
  const core = PRESETS.find((p) => p.id === "core");
  const rows = statueRows(gyms, PRESETS, { gym: gyms[0], plan: core });
  assert.equal(rows[0].gym, gyms[0]);
  assert.deepEqual(rows[0].figures, ["situps", "plank", "pushups"]);
  assert.equal(rows[0].material, "sandstone");
  assert.equal(rows.length, 2);
});

test("an override works on a gym that has no café id of its own", () => {
  const gym = { cafeId: null, statueRow: { position: [0, 0, 0], yaw: 0 } };
  const core = PRESETS.find((p) => p.id === "core");
  const rows = statueRows([gym], PRESETS, { gym, plan: core });
  assert.deepEqual(rows.map((r) => r.figures), [["situps", "plank", "pushups"]]);
});
