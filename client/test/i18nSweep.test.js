// Sweeps the client JS for English prose literals that would reach the screen
// untranslated. A heuristic, not a parser: mark false positives `// i18n-ok`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const JS_ROOT = new URL("../public/js/", import.meta.url).pathname;
// Files still to convert; each group of Task 7 removes its files.
const PENDING_FILES = [
  "ble/deviceLog.js",
  "ble/devices.js",
  "ble/knownDevices.js",
  "ble/zwiftController.js",
  "input/keyboard.js",
  "main.js",
  "net/connection.js",
  "net/strava.js",
  "ride/junction.js",
  "ride/rideAutosave.js",
  "ride/rideHistory.js",
  "ride/rideRecorder.js",
  "ride/vehicle.js",
  "ride/workout.js",
  "studio/classClock.js",
  "view/hud.js",
  "view/paddleView.js",
  "view/photos.js",
  "view/splitsView.js",
  "view/vehicleView.js",
  "view/workoutStudioView.js",
  "view3d/chaseCamera.js",
  "view3d/lighting.js",
  "view3d/studioScene.js",
  "view3d/worldScene.js",
  "workout/plan.js",
  "workout/presets.js",
];

const SKIP_LINE = /^\s*(\/\/|\*|\/\*|import |export .* from )|console\.|throw new|i18n-ok|classList|className|querySelector|dataset|addEventListener|getAttribute|createElement|fillStyle|strokeStyle|\.font\b|gradient|rgba?\(|\bcase "/;
const LITERAL = /(["'`])((?:\\.|(?!\1).)*?)\1/g;
// "badge badge-paddle": lowercase words are CSS classes, not prose.
const CLASS_LIST = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/;
const PLAIN_TOKEN = /^[\w./#:[\]=_%@&-]+$/;

export function proseLiterals(source) {
  const found = [];
  source.split("\n").forEach((line, index) => {
    if (SKIP_LINE.test(line)) return;
    for (const match of line.matchAll(LITERAL)) {
      const text = match[2].replace(/\$\{[^}]*\}/g, "");
      if (CLASS_LIST.test(match[2])) continue;
      const capitalWord = /^[A-Z][a-z]{2,}[a-z….!?]*$/.test(text);
      const twoWords = !PLAIN_TOKEN.test(text) && /[A-Za-z]{2,} [A-Za-z]{2,}/.test(text);
      if (twoWords || capitalWord) found.push({ line: index + 1, text });
    }
  });
  return found;
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "i18n") yield* sourceFiles(path);
    } else if (name.endsWith(".js")) yield path;
  }
}

test("proseLiterals flags prose and ignores identifiers", () => {
  assert.deepEqual(proseLiterals('el.textContent = "No trainer";'), [{ line: 1, text: "No trainer" }]);
  assert.deepEqual(proseLiterals('el.textContent = "Menu";'), [{ line: 1, text: "Menu" }]);
  assert.deepEqual(proseLiterals('const k = "hud-info";'), []);
  assert.deepEqual(proseLiterals('el.className = "badge badge-paddle";'), []);
  assert.deepEqual(proseLiterals('el.textContent = "Menu"; // i18n-ok'), []);
});

test("no English prose literals outside the pending files", () => {
  const offenders = [];
  for (const path of sourceFiles(JS_ROOT)) {
    const name = relative(JS_ROOT, path);
    if (PENDING_FILES.includes(name)) continue;
    for (const { line, text } of proseLiterals(readFileSync(path, "utf8"))) offenders.push(`${name}:${line} ${text}`);
  }
  assert.deepEqual(offenders, []);
});
