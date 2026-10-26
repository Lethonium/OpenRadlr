/**
 * Trainer difficulty: scales positive grades so climbs feel easier,
 * like Zwift's "trainer difficulty" setting. Descents are passed through
 * unchanged at 50 % so riders still notice them without spinning out.
 *
 * @param {number} gradePercent grade from the server
 * @param {number} difficulty 0..1 (1 = full grade)
 * @param {{descents?: number}} [options] the share of a descent passed on;
 *   virtual gears take descents whole, their floor keeps them rideable
 */
export function applyDifficulty(gradePercent, difficulty, { descents = 0.5 } = {}) {
  const d = Math.min(1, Math.max(0, difficulty));
  if (gradePercent >= 0) return gradePercent * d;
  return gradePercent * descents;
}
