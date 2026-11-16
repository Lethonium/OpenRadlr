import assert from "node:assert/strict";
import test from "node:test";
import { benchMetadata, parseBenchArgs } from "../sceneryBenchArgs.mjs";

test("the scenery benchmark has a reproducible default scenario", () => {
  assert.deepEqual(parseBenchArgs([]), {
    url: "http://localhost:8080",
    route: null,
    at: 6490,
    camera: "chase",
    scenery: "models",
    biome: "temperate",
    quality: "high",
    width: 1280,
    height: 720,
    warmup: 30,
    frames: 300,
    out: null,
  });
});

test("benchmark options override one scenario without sharing state", () => {
  const first = parseBenchArgs(["--route", "rolling-hills", "--at", "7562", "--camera", "drone", "--scenery", "off", "--frames", "60"]);
  assert.equal(first.route, "rolling-hills");
  assert.equal(first.at, 7562);
  assert.equal(first.camera, "drone");
  assert.equal(first.scenery, "off");
  assert.equal(first.frames, 60);
  assert.equal(parseBenchArgs([]).scenery, "models");
});

test("benchmark metadata reports the revision, its dirty state and an unavailable repository", () => {
  const clean = benchMetadata((args) => (args[0] === "status" ? "" : "abc123\n"));
  assert.deepEqual(clean, { commit: "abc123", dirty: false });
  const dirty = benchMetadata((args) => (args[0] === "status" ? " M file.js\n" : "abc123\n"));
  assert.deepEqual(dirty, { commit: "abc123", dirty: true });
  assert.deepEqual(benchMetadata(() => { throw new Error("not a repository"); }), { commit: null, dirty: null });
});

test("benchmark options reject missing, unknown and invalid values", () => {
  assert.throws(() => parseBenchArgs(["--at"]), /Missing value/);
  assert.throws(() => parseBenchArgs(["--wat", "1"]), /Unknown option/);
  assert.throws(() => parseBenchArgs(["--at", "-1"]), /Invalid --at/);
  assert.throws(() => parseBenchArgs(["--frames", "301"]), /2\.\.300/);
  assert.throws(() => parseBenchArgs(["--warmup", "1.5"]), /--warmup/);
  assert.throws(() => parseBenchArgs(["--quality", "ultra"]), /--quality/);
  assert.throws(() => parseBenchArgs(["--scenery", "everything"]), /--scenery/);
});
