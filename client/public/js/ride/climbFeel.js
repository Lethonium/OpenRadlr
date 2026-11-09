/**
 * Climb feel (the difficulty slider) scales climbs for riders shifting real
 * gears. With virtual shifting the gears do that, so it's hidden (#22).
 * @param {{ shiftingOffered: boolean, shiftingChecked: boolean }} input
 */
export function climbFeelVisible({ shiftingOffered, shiftingChecked }) {
  return !(shiftingOffered && shiftingChecked);
}
