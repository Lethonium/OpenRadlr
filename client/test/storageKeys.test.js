// Every storage key literal in the client must be a conscious decision: a device key
// (shared by the tablet) or a rider key (scoped per rider). See #112.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DEVICE_PREFIXES, RIDER_PREFIX, isDeviceKey } from "../public/js/profile/riderStorage.js";

const JS_ROOT = new URL("../public/js/", import.meta.url).pathname;
const KEY_LITERAL = /(["'`])(open(?:radlr|ride)\.[\w.-]+)\1/g;

const RIDER_KEYS = [
  "openride.profile.v1",
  "openradlr.summits",
  "openradlr.lemons",
  "openradlr.achievements",
  "openradlr.goals",
  "openride.view",
  "openride.camera",
  "openride.time",
  "openride.biome",
  "openride.season",
  "openride.classicRider",
  "openride.layout",
  "openride.route",
  "openride.rideMode",
  "openradlr.studio-camera",
  "openradlr.coach-voice",
  "openradlr.locale",
  // The rider's link to their account and when it was last backed up (ADR 0032).
  "openradlr.account.rider",
  "openradlr.account.backedUp",
  "openradlr.account.rides",
];
// Bare prefixes used to recognise our keys, not keys themselves.
const PREFIXES = ["openradlr.", "openride.", RIDER_PREFIX, ...DEVICE_PREFIXES];

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (name.endsWith(".js")) yield path;
  }
}

test("every storage key in the client is a device key or a rider key", () => {
  const unknown = [];
  for (const file of sourceFiles(JS_ROOT)) {
    for (const match of readFileSync(file, "utf8").matchAll(KEY_LITERAL)) {
      const key = match[2];
      if (isDeviceKey(key) || RIDER_KEYS.includes(key) || PREFIXES.includes(key)) continue;
      unknown.push(`${relative(JS_ROOT, file)}: ${key}`);
    }
  }
  assert.deepEqual(unknown, []);
});
