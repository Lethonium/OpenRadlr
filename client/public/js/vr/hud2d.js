/**
 * The numbers of the VR page's HUD. Power, cadence and speed come from the
 * relayed state (4 Hz); heart rate, grade and the workout only come with the
 * display frames (1 Hz), which the cockpit model holds.
 */
const MS_TO_KMH = 3.6;

/**
 * @param {{hr: number|null, grade: number|null, workout: object|null}} model the CockpitModel
 * @param {{power?: number, cadence?: number, speed?: number}|null} rider the host's rider in the latest state
 */
export function hudValues(model, rider) {
  return {
    power: rider?.power ?? null,
    cadence: rider?.cadence ?? null,
    speedKmh: Number.isFinite(rider?.speed) ? rider.speed * MS_TO_KMH : null,
    grade: model.grade ?? null,
    heartRate: model.hr ?? null,
    workout: model.workout ?? null,
  };
}
