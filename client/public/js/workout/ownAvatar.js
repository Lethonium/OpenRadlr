/**
 * My avatar at the gym keeps step with my own timer: the exercise and side of the plan now and the start of its block,
 * not the server's echo of them, which is a network round trip behind (or, on a busy page, much later) and would leave
 * me standing idle through a block. `blockStart` is null while paused or done: then the server's rider shows as it is.
 * @param {object} rider my rider as the smoother gives it
 * @param {{currentExercise: () => ?string, currentSide: () => ?string}} workout
 * @param {?number} blockStart the scene clock at which the current block began
 */
export function ownAvatar(rider, workout, blockStart) {
  if (blockStart === null) return rider;
  return { ...rider, exercise: workout.currentExercise(), exerciseSince: blockStart, side: workout.currentSide() };
}
