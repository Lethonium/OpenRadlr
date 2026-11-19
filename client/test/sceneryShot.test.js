import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShotArgs, pinCamera, settingsFor } from "../sceneryShot.mjs";

test("--eye and --target take world points as x,y,z", () => {
  const opts = parseShotArgs(["--eye", "1,2.5,-3", "--target", "4,5,6"]);
  assert.deepEqual(opts.eye, [1, 2.5, -3]);
  assert.deepEqual(opts.target, [4, 5, 6]);
});

test("a point that is not three numbers is refused", () => {
  assert.throws(() => parseShotArgs(["--eye", "1,2"]), /--eye/);
});

test("pinCamera makes the chase camera hold the given eye and target", async () => {
  const source = "export class ChaseCamera { update() { this.eye = [0, 0, 0]; this.target = [0, 0, 1]; return this; } }";
  const url = `data:text/javascript,${encodeURIComponent(pinCamera(source, [1, 2, 3], [4, 5, 6]))}`;
  const { ChaseCamera } = await import(url);
  const camera = new ChaseCamera().update();
  assert.deepEqual(camera.eye, [1, 2, 3]);
  assert.deepEqual(camera.target, [4, 5, 6]);
});

test("--biome is written as the rider's saved season", () => {
  const opts = parseShotArgs(["--biome", "winter"]);
  assert.equal(settingsFor(opts)["openride.biome"], "winter");
});
