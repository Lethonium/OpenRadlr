import { test } from "node:test";
import assert from "node:assert/strict";
import { actionForKey } from "../public/js/input/keyboard.js";
import {
  LAYOUT_CHOICES,
  MetricBinder,
  chooseLayout,
  formatTimeGap,
  gaugeFraction,
  nextLayoutChoice,
  nextMarker,
  powerZone,
  raceProgress,
  raceStanding,
  splitLabel,
  splitLine,
} from "../public/js/view/hud.js";
import { setUnits } from "../public/js/util/format.js";
import { upcomingSamples } from "../public/js/view/profileView.js";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { squareRoute } from "./helpers.js";

test("auto layout follows the ride: race beats workout beats free ride", () => {
  assert.equal(chooseLayout({}), "cockpit");
  assert.equal(chooseLayout({ workoutRunning: true }), "training");
  assert.equal(chooseLayout({ workoutRunning: true, racePhase: "running", inRace: true }), "race");
  assert.equal(chooseLayout({ racePhase: "countdown", inRace: true }), "race");
  // Races are opt-in: someone else's race doesn't take over the screen.
  assert.equal(chooseLayout({ racePhase: "countdown", inRace: false }), "cockpit");
  // A race I am not in never takes over the screen.
  assert.equal(chooseLayout({ racePhase: "running", inRace: false }), "cockpit");
  assert.equal(chooseLayout({ racePhase: "finished", inRace: true }), "cockpit");
});

test("a fixed layout choice always wins", () => {
  assert.equal(chooseLayout({ choice: "broadcast", racePhase: "running", inRace: true }), "broadcast");
  assert.equal(chooseLayout({ choice: "nonsense", workoutRunning: true }), "training");
});

test("layout choices cycle and wrap", () => {
  let choice = "auto";
  const seen = [];
  for (let i = 0; i < LAYOUT_CHOICES.length; i += 1) {
    seen.push(choice);
    choice = nextLayoutChoice(choice);
  }
  assert.deepEqual(seen, [...LAYOUT_CHOICES]);
  assert.equal(choice, "auto");
  assert.equal(nextLayoutChoice("unknown"), "auto");
});

test("layout, menu and escape keys", () => {
  assert.equal(actionForKey({ code: "KeyL", target: {} }), "cycleLayout");
  assert.equal(actionForKey({ code: "KeyM", target: {} }), "toggleMenu");
  assert.equal(actionForKey({ code: "Escape", target: {} }), "closePanels");
});

test("power zone and gauge are relative to FTP", () => {
  assert.equal(powerZone(150, 250), 2);
  assert.equal(powerZone(250, 250), 4);
  assert.equal(powerZone(400, 250), 6);
  assert.equal(powerZone(200, 0), 0);
  assert.equal(gaugeFraction(200, 250), 0.5);
  assert.equal(gaugeFraction(1000, 250), 1);
  assert.equal(gaugeFraction(-5, 250), 0);
  assert.equal(gaugeFraction(NaN, 250), 0);
});

function markedRoute() {
  // 1000 m loop with a climb at 200 (length 300) and a sprint at 700 (length 100).
  return new RouteGeometry({
    id: "m",
    name: "M",
    lanes: 2,
    seed: 1,
    points: [
      [0, 0, 0],
      [250, 0, 0],
      [250, 250, 0],
      [0, 250, 0],
    ],
    markers: [
      { type: "start_finish", distance: 0 },
      { type: "climb", distance: 200, length: 300 },
      { type: "sprint", distance: 700, length: 100 },
    ],
  });
}

test("next marker ahead, inside a segment and wrapping past the finish", () => {
  const route = markedRoute();
  assert.deepEqual(nextMarker(route, 100), { type: "climb", label: "KOM", inM: 100, inside: false });
  assert.deepEqual(nextMarker(route, 300), { type: "climb", label: "KOM", inM: 200, inside: true });
  assert.deepEqual(nextMarker(route, 600), { type: "sprint", label: "Sprint", inM: 100, inside: false });
  assert.deepEqual(nextMarker(route, 900), { type: "start_finish", label: "Finish line", inM: 100, inside: false });
  assert.equal(nextMarker(route, 520, 50), null);
});

const rider = (id, lap, distance, extra = {}) => ({ id, name: `R${id}`, is_bot: id > 10, lap, distance, speed: 10, ...extra });

test("race progress adds completed laps", () => {
  assert.equal(raceProgress(rider(1, 1, 300), 1000), 300);
  assert.equal(raceProgress(rider(1, 3, 300), 1000), 2300);
  assert.equal(raceProgress(rider(1, 0, 50), 1000), 50);
});

test("race standing: position, groups and time gaps", () => {
  const race = { phase: "running", laps: 2, elapsed_s: 100, results: [] };
  const riders = [
    rider(1, 1, 500), // me
    rider(2, 1, 510), // same group, 10 m ahead
    rider(11, 1, 700), // leaders, 200 m ahead
    rider(12, 1, 490), // my group, behind me
    rider(13, 1, 200), // dropped
    rider(14, null, 600), // not racing
  ];
  const standing = raceStanding(race, riders, 1, 1000);
  assert.equal(standing.position, 3);
  assert.equal(standing.total, 5);
  assert.equal(standing.lap, 1);
  assert.equal(standing.fraction, 0.25);
  assert.equal(standing.toGoM, 1500);
  assert.deepEqual(
    standing.groups.map((g) => [g.label, g.size, Math.round(g.gapS)]),
    [
      ["Leaders", 1, 19],
      ["Your group", 3, 0],
      ["Behind", 1, -31],
    ],
  );
  assert.deepEqual(
    standing.around.map((a) => [a.rider.id, a.position, a.gapS, a.mine]),
    [
      [11, 1, 20, false],
      [2, 2, 1, false],
      [1, 3, 0, true],
      [12, 4, -1, false],
      [13, 5, -30, false],
    ],
  );
  assert.equal(standing.others.length, 4);
});

test("finished riders rank ahead; no standing when I'm not racing", () => {
  const race = { phase: "running", laps: 1, results: [{ rider_id: 9 }] };
  const standing = raceStanding(race, [rider(1, 1, 100), rider(2, 1, 50)], 1, 1000);
  assert.equal(standing.position, 2);
  assert.equal(standing.total, 3);
  assert.equal(raceStanding(race, [rider(1, null, 100)], 1, 1000), null);
  assert.equal(raceStanding({ phase: "idle" }, [rider(1, 1, 100)], 1, 1000), null);
  assert.equal(raceStanding(null, [rider(1, 1, 100)], 1, 1000), null);
});

test("time gaps format as seconds or minutes", () => {
  assert.equal(formatTimeGap(1.24), "+1.2 s");
  assert.equal(formatTimeGap(-0.4), "−0.4 s");
  assert.equal(formatTimeGap(14.2), "+0:14");
  assert.equal(formatTimeGap(-82), "−1:22");
  assert.equal(formatTimeGap(0, { mine: true }), "—");
});

test("upcoming samples start at my position and span the lookahead", () => {
  const route = squareRoute();
  const samples = upcomingSamples(route, 200, 200, 5);
  assert.equal(samples.length, 5);
  assert.equal(samples[0].along, 0);
  assert.equal(samples[4].along, 200);
  assert.equal(samples[0].elevation, 100);
  // The climb starts at 250 m (4 %), so 400 m is 6 m up.
  assert.ok(Math.abs(samples[4].elevation - 106) < 1e-9);
});

test("metric binder writes every copy of a metric and skips unchanged values", () => {
  const make = (m) => ({ dataset: { m }, textContent: "", writes: 0 });
  const elements = [make("power"), make("power"), make("speed")];
  for (const element of elements) {
    let text = "";
    Object.defineProperty(element, "textContent", {
      get: () => text,
      set: (value) => {
        text = value;
        element.writes += 1;
      },
    });
  }
  const binder = new MetricBinder({ querySelectorAll: () => elements });
  assert.deepEqual(binder.names.sort(), ["power", "speed"]);
  binder.set("power", 248);
  binder.set("power", 248);
  binder.set("unknown", 1);
  assert.equal(elements[0].textContent, "248");
  assert.equal(elements[1].textContent, "248");
  assert.equal(elements[0].writes, 1);
  assert.equal(elements[2].writes, 0);
});

test("nextMarker adds a marker's name to its label", () => {
  const route = { markers: [{ type: "climb", distance: 200, length: 100, name: "Femés" }], wrap: (d) => ((d % 1000) + 1000) % 1000 };
  assert.equal(nextMarker(route, 100).label, "KOM · Femés");
});

test("split readout: lap, distance and free splits in both unit systems", () => {
  const base = { avgSpeed: 10.2222, avgPower: 223.6, durationS: 761 };
  const lap = { ...base, kind: "lap", lap: 3, distanceM: 7780, toM: 23000 };
  assert.equal(splitLine(lap), "Lap 3 · 12:41 · 36.8 km/h · 224 W");
  assert.match(splitLine({ ...base, kind: "distance", toM: 10000, distanceM: 10000 }), /^Km 10 · /);
  assert.match(splitLine({ ...base, kind: "free", distanceM: 6200, toM: 6200 }), /^6\.2 km · /);
  setUnits("imperial");
  try {
    const mile = splitLine({ ...base, kind: "distance", toM: 8046.72, distanceM: 8046.72 }, 1609.344);
    assert.match(mile, /^Mi 5 · 12:41 · 22\.9 mph · 224 W$/);
    assert.equal(splitLabel({ kind: "free", distanceM: 1609.344 }, 1609.344), "1.0 mi");
  } finally {
    setUnits("metric");
  }
});

test("a partial distance split is labelled by its length", () => {
  assert.match(splitLabel({ kind: "distance", partial: true, distanceM: 300, toM: 3300 }, 1000), /^0\.3 km$/);
});
