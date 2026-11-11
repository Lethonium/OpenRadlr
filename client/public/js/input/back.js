/**
 * What Android's back button or gesture does (docs/app.md#back-button). Like
 * Esc it undoes the innermost thing first, and it never ends a ride without
 * asking: on the road it opens the menu at "Finish this ride?", in a café
 * workout it pauses and asks whether to end it.
 * @param {{ finished: boolean, panelOpen: boolean, riding: boolean, workout: null | "running" | "summary", figureOpen: boolean }} state
 * @returns {"leaveRide" | "stepBack" | "askEndWorkout" | "leaveWorkout" | "askFinish" | "closeFigure" | "leaveApp"}
 */
export function backAction({ finished, panelOpen, riding, workout, figureOpen }) {
  // The summary ignores the panels, as it does for Esc: back is "Back to the menu".
  if (finished) return "leaveRide";
  if (panelOpen) return "stepBack";
  if (workout === "summary") return "leaveWorkout";
  if (workout === "running") return "askEndWorkout";
  if (riding) return "askFinish";
  if (figureOpen) return "closeFigure";
  return "leaveApp";
}
