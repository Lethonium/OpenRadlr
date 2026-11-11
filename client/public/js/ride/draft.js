/**
 * Drafting as seen by the client, mirroring the server's rule: up to 6.5 m
 * behind a rider in the same lane reduces drag by up to 30 %, all of it from
 * 2 m (a bike length, middle to middle: the closest riders get) in.
 * Used only for display ("in draft" indicator); the server stays authoritative.
 */
export const DRAFT = Object.freeze({ minGap: 2, maxGap: 6.5, maxReduction: 0.3, laneTolerance: 0.5 });

/**
 * @returns {{gap: number, savingPercent: number, leader: object} | null}
 */
export function draftInfo(me, riders, route) {
  let best = null;
  for (const other of riders) {
    if (other.id === me.id || Math.abs(other.lane - me.lane) >= DRAFT.laneTolerance) continue;
    const gap = route.signedGap(me.distance, other.distance);
    if (gap <= 0 || (best && gap >= best.gap)) continue;
    best = { gap, leader: other };
  }
  if (!best || best.gap > DRAFT.maxGap) return null;
  const t = (Math.max(best.gap, DRAFT.minGap) - DRAFT.minGap) / (DRAFT.maxGap - DRAFT.minGap);
  return { ...best, savingPercent: Math.round(DRAFT.maxReduction * (1 - t) * 100) };
}
