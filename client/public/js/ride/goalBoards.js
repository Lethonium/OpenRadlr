/**
 * Goal boards: roadside boards that stand where this week's goal step is (nearly) reached in the ride in progress.
 * `planGoalBoards` turns the season goals' weeks into boards at ride distances, `resolvePending` projects the ones a
 * time or climb goal cannot place yet, and `anchorGoalBoards` pins the ones within reach to the road the rider is on.
 * Pure. See docs/superpowers/specs/2026-11-27-roadside-boards-design.md.
 */
import { t } from "../i18n/i18n.js";
import { formatDuration } from "../util/format.js";
import { amount } from "../view/goalsView.js";

const SOON_BEFORE_M = 2000;
const SOON_MIN_M = 500;
const LONG_LEAD_MAX_M = 5000;
const LONG_LEAD_SHARE = 0.1;
const LAP_BEFORE_END_M = 400;
const MIN_SPEED_MPS = 1;
const MIN_CLIMB_RATE = 0.002;
const CLIMB_BASIS_M = 500;

/**
 * The boards the open goal weeks in `entries` (`{goal, week}`) ask for on this ride:
 * `{id, text, at}` with `at` one of `{rideM}` (metres into the ride), `{lapM}` (metres into each lap of the route)
 * or `{pending: {metric, remaining}}` (a time or climb step, placed once the ride's pace tells where).
 */
export function planGoalBoards(entries, { routeId, routeLength }) {
  const boards = [];
  for (const { goal, week } of entries) {
    if (week.done || week.reached || week.finished || week.step === null) continue;
    const id = `${goal.id ?? goal.kind}:${goal.metric}:${goal.routeId ?? ""}`;
    const total = goal.kind === "total";
    if (goal.kind === "lap") {
      if (goal.routeId !== routeId) continue;
      boards.push({ id, text: t("boards.goal.lap", { time: formatDuration(Math.round(week.step)) }), at: { lapM: routeLength - LAP_BEFORE_END_M } });
    } else if (goal.metric !== "distance") {
      boards.push({ id, text: total ? t("boards.goal.weekDone", { amount: amount(goal.metric, week.step) }) : t("boards.goal.longDone"), at: { pending: { metric: goal.metric, remaining: week.step - (total ? week.soFar : 0) } } });
    } else if (total) {
      const remaining = week.step - week.soFar;
      boards.push({ id: `${id}:done`, text: t("boards.goal.weekDone", { amount: amount("distance", week.step) }), at: { rideM: remaining } });
      if (remaining - SOON_BEFORE_M >= SOON_MIN_M) {
        boards.push({ id: `${id}:soon`, text: t("boards.goal.weekSoon", { left: amount("distance", SOON_BEFORE_M), amount: amount("distance", week.step) }), at: { rideM: remaining - SOON_BEFORE_M } });
      }
    } else {
      const lead = Math.min(LONG_LEAD_MAX_M, LONG_LEAD_SHARE * week.step);
      boards.push({ id: `${id}:soon`, text: t("boards.goal.longSoon", { left: amount("distance", lead) }), at: { rideM: week.step - lead } });
      boards.push({ id: `${id}:done`, text: t("boards.goal.longDone"), at: { rideM: week.step } });
    }
  }
  return boards;
}

/** The ride distance at which a pending board's amount is reached at the current pace, or null (stopped, or too flat to tell). */
export function resolvePending(board, { distanceM, durationS, elevationGainM, speedMps }) {
  const { metric, remaining } = board.at.pending;
  if (speedMps < MIN_SPEED_MPS) return null;
  if (metric === "time") return distanceM + (remaining - durationS) * speedMps;
  const rate = elevationGainM / Math.max(distanceM, CLIMB_BASIS_M);
  if (rate < MIN_CLIMB_RATE) return null;
  return distanceM + (remaining - elevationGainM) / rate;
}

const wrapTo = (length, d) => ((d % length) + length) % length;

/** `g` as a signed gap on a loop of `length`: the short way round. */
const shortWay = (length, g) => (g > length / 2 ? g - length : g <= -length / 2 ? g + length : g);

/**
 * The boards to put on the road now, `{id, text, routeId, distance}`, at most `max`, nearest first. `planned` boards
 * carry a resolved `at` (`{rideM}` or `{lapM}`); `anchored` (id → anchor) is the state kept between calls: a board
 * comes into `reach` once and is pinned to the rider's route then (a loop wraps), so it never moves; a ride-distance
 * board passed by more than `behind` is gone for good (its anchor is null), a lap board returns next lap; a board
 * pinned to another route than the rider's is dropped.
 */
export function anchorGoalBoards(planned, anchored, { rideM, routeId, routeDistance, routeLength, loop }, { reach = 1500, behind = 50, max = 2 } = {}) {
  const out = [];
  for (const board of planned) {
    const lap = board.at.lapM !== undefined;
    const held = anchored.get(board.id);
    if (held === null) continue;
    if (held && held.routeId !== routeId) {
      if (lap) anchored.delete(board.id);
      else anchored.set(board.id, null);
      continue;
    }
    let gap;
    if (lap) {
      gap = board.at.lapM - routeDistance;
      if (loop) gap = shortWay(routeLength, gap);
    } else {
      gap = (held ? held.rideM : board.at.rideM) - rideM;
    }
    if (gap < -behind) {
      if (lap) anchored.delete(board.id);
      else anchored.set(board.id, null);
      continue;
    }
    if (!held) {
      if (gap > reach) continue;
      const raw = routeDistance + gap;
      if (!loop && (raw < 0 || raw > routeLength)) continue;
      anchored.set(board.id, { routeId, distance: loop ? wrapTo(routeLength, raw) : raw, rideM: lap ? null : board.at.rideM });
    }
    const { distance } = anchored.get(board.id);
    out.push({ id: board.id, text: board.text, routeId, distance, gap });
  }
  return out
    .sort((a, b) => a.gap - b.gap)
    .slice(0, max)
    .map(({ id, text, routeId, distance }) => ({ id, text, routeId, distance }));
}
