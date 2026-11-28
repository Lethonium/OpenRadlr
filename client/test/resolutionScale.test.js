import { test } from "node:test";
import assert from "node:assert/strict";

import { ResolutionGovernor } from "../public/js/view3d/engine/resolutionScale.js";

/** Feeds `seconds` worth of frames of `ms` each; returns the last scale. */
const run = (governor, ms, seconds) => {
  let scale = governor.scale;
  for (let t = 0; t < seconds * 1000; t += ms) scale = governor.sample(ms);
  return scale;
};

test("frames on budget keep the full resolution", () => {
  const governor = new ResolutionGovernor({ floor: 0.6 });
  assert.equal(run(governor, 16.7, 10), 1);
});

test("slow frames lower the resolution a step at a time, never below the floor", () => {
  const governor = new ResolutionGovernor({ floor: 0.7 });
  const first = run(governor, 40, 1.5);
  assert.ok(first < 1 && first >= 0.7, `a first step down, got ${first}`);
  assert.equal(run(governor, 40, 30), 0.7, "the floor holds");
});

test("one long frame (a hitch) does not lower the resolution", () => {
  const governor = new ResolutionGovernor({ floor: 0.6 });
  run(governor, 16.7, 2);
  governor.sample(180);
  assert.equal(run(governor, 16.7, 2), 1);
});

test("a hidden tab's gap is not a slow frame", () => {
  const governor = new ResolutionGovernor({ floor: 0.6 });
  for (let i = 0; i < 20; i += 1) governor.sample(1000);
  assert.equal(governor.scale, 1);
});

test("fast frames win the resolution back", () => {
  const governor = new ResolutionGovernor({ floor: 0.6 });
  run(governor, 40, 10);
  assert.ok(governor.scale < 1);
  assert.equal(run(governor, 8, 30), 1);
});

test("a step up that turns out too slow waits longer before the next try", () => {
  const governor = new ResolutionGovernor({ floor: 0.6, upAfterS: 2 });
  run(governor, 40, 5);
  const low = governor.scale;
  // Fast enough at this scale, too slow one step up: each try up is answered with a step down.
  const frameAt = () => (governor.scale > low + 1e-9 ? 40 : 15);
  const tries = [];
  let last = governor.scale;
  for (let t = 0; t < 60_000; ) {
    const ms = frameAt();
    t += ms;
    const scale = governor.sample(ms);
    if (scale > last) tries.push(t);
    last = scale;
  }
  assert.ok(tries.length >= 2, `it tried more than once (${tries.length})`);
  const gaps = tries.slice(1).map((t, i) => t - tries[i]);
  assert.ok(gaps.at(-1) > gaps[0] * 1.5, `the tries grow apart: ${gaps.map(Math.round)}`);
});

test("a higher floor (a new quality level) lifts the scale to it", () => {
  const governor = new ResolutionGovernor({ floor: 0.6 });
  run(governor, 60, 30);
  assert.equal(governor.scale, 0.6);
  governor.setFloor(0.85);
  assert.equal(governor.scale, 0.85);
});

test("a floor of 1 turns the scaling off", () => {
  const governor = new ResolutionGovernor({ floor: 1 });
  assert.equal(run(governor, 80, 10), 1);
});
