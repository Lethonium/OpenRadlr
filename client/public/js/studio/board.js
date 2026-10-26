/**
 * The room board: who rode closest to their own targets this class. Ranked
 * by time on target, then by work, so a beginner on target beats a strong
 * rider who ignores the plan.
 */

/**
 * @param {{id: number, name: string, is_bot: boolean, on_target_pct: ?number, class_kj: number}[]} riders
 * @param {number} myId
 */
export function studioBoard(riders, myId) {
  const score = (r) => r.on_target_pct ?? -1;
  return [...riders]
    .sort((a, b) => score(b) - score(a) || b.class_kj - a.class_kj || a.id - b.id)
    .map((r, i) => ({
      rank: i + 1,
      id: r.id,
      name: r.name,
      isBot: r.is_bot,
      me: r.id === myId,
      onTarget: r.on_target_pct === null || r.on_target_pct === undefined ? "–" : `${Math.round(r.on_target_pct)} %`,
      kj: `${Math.round(r.class_kj)} kJ`,
    }));
}
