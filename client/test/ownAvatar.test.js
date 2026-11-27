/** My own workout avatar follows my timer, not the server's echo of it. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ownAvatar } from "../public/js/workout/ownAvatar.js";

const workout = (exercise, side = null) => ({ currentExercise: () => exercise, currentSide: () => side });
const echoed = { id: 7, exercise: null, side: undefined, exerciseSince: 3 };

test("my avatar does the exercise of my timer before the server has echoed it", () => {
  const mine = ownAvatar(echoed, workout("jumping_jacks"), 41.5);
  assert.equal(mine.exercise, "jumping_jacks");
  assert.equal(mine.exerciseSince, 41.5);
});

test("my avatar rests when my timer rests, whatever the server last said", () => {
  assert.equal(ownAvatar({ ...echoed, exercise: "squats" }, workout(null), 41.5).exercise, null);
});

test("my avatar takes the side of my timer", () => {
  assert.equal(ownAvatar(echoed, workout("low_lunge", "left"), 41.5).side, "left");
});

test("without a block start (paused, done) the server's rider stands", () => {
  const rider = { ...echoed, exercise: "squats" };
  assert.equal(ownAvatar(rider, workout("squats"), null), rider);
});
