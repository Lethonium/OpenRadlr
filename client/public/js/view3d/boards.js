/**
 * Roadside billboards: where they stand along the ridden route, as plain data. Sites come from the route's geometry,
 * markers and village zones alone (general boards on straight stretches, one near the top of each long climb, one in
 * the last kilometre); placement puts them beside the road on the right, facing oncoming riders.
 * See docs/superpowers/specs/2026-11-27-roadside-boards-design.md.
 */
import { BANNERS } from "./banners.js";
import { VERGE, roadFrame, roadHalfWidth } from "../world/roads.js";
import { inStretch } from "../world/zones.js";

/** Poster size (metres), setback from the verge edge to the board's centre, clearing radius and the turn (radians) of its face off the road's direction. */
export const BOARD = Object.freeze({ width: 6, height: 3, setback: 5, clearing: 7, angle: 0.35 });

const MIN_ROUTE_M = 1000;
const CANDIDATE_STEP_M = 100;
const ROUTE_PER_GENERAL_M = 8500;
const MAX_SPACING_M = 3000;
/** General boards keep this far from climb and last-km boards and from arches. */
const CLEAR_M = 300;
const STRAIGHT_AHEAD_M = 300;
const VILLAGE_BONUS = 0.5;
const VILLAGE_BONUS_REACH_M = 150;
const CLIMB_MIN_M = 1500;
const CLIMB_SECOND_MIN_M = 2500;
const CLIMB_BEFORE_TOP_M = 150;
const LAST_KM_BEFORE_END_M = 750;

const ARCH_MARKERS = new Set(["start_finish", "climb", "sprint"]);

/** Distance between two spots along the route (the short way round a loop). */
const gap = (route, a, b) => Math.abs(route.signedGap(a, b));

/** How straight the road runs for the 300 m after `d`: the mean of the forward vectors' dot products, 1 for a straight line. */
function straightness(route, d) {
  const here = roadFrame(route, d).forward;
  let sum = 0;
  for (let ahead = 100; ahead <= STRAIGHT_AHEAD_M; ahead += 100) {
    const f = roadFrame(route, route.wrap(d + ahead)).forward;
    sum += here[0] * f[0] + here[1] * f[1] + here[2] * f[2];
  }
  return sum / (STRAIGHT_AHEAD_M / 100);
}

/**
 * The boards a route gets, `{kind: "general"|"climb"|"lastKm", distance}` in riding order: one on each long climb (150 m
 * before the top, and a second in the middle of a long one), one 750 m before the end, and a few general ones on straight
 * stretches outside villages, kept well apart.
 */
export function boardSites(route, { villages = [] } = {}) {
  if (route.length < MIN_ROUTE_M) return [];
  const arches = route.markers.filter((m) => ARCH_MARKERS.has(m.type)).map((m) => m.distance);
  const clearOfArches = (d) => arches.every((a) => gap(route, a, d) >= BANNERS.clearOfArchM);

  const special = [];
  for (const marker of route.markers) {
    const length = marker.length ?? 0;
    if (marker.type !== "climb" || length < CLIMB_MIN_M) continue;
    special.push({ kind: "climb", distance: route.wrap(marker.distance + length - CLIMB_BEFORE_TOP_M) });
    if (length >= CLIMB_SECOND_MIN_M) special.push({ kind: "climb", distance: route.wrap(marker.distance + length / 2) });
  }
  const sites = special.filter((s) => clearOfArches(s.distance));
  sites.push({ kind: "lastKm", distance: route.length - LAST_KM_BEFORE_END_M });

  const count = Math.max(route.loop ? 2 : 0, Math.round(route.length / ROUTE_PER_GENERAL_M));
  const spacing = Math.min(MAX_SPACING_M, route.length / 2);
  const candidates = [];
  for (let d = 0; d < route.length; d += CANDIDATE_STEP_M) {
    if (inStretch(route, villages, d)) continue;
    if ([...arches, ...sites.map((s) => s.distance)].some((o) => gap(route, o, d) < CLEAR_M)) continue;
    const nearVillage = villages.some((v) => gap(route, v.from, d) <= VILLAGE_BONUS_REACH_M || gap(route, v.to, d) <= VILLAGE_BONUS_REACH_M);
    candidates.push({ distance: d, score: straightness(route, d) + (nearVillage ? VILLAGE_BONUS : 0) });
  }
  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);
  const general = [];
  for (const candidate of candidates) {
    if (general.length >= count) break;
    if (general.every((g) => gap(route, g.distance, candidate.distance) >= spacing)) general.push({ kind: "general", distance: candidate.distance });
  }
  return [...sites, ...general].sort((a, b) => a.distance - b.distance);
}

/** Where a board at `distance` stands (x, z), the yaw that turns its front (+z) to riders coming along the road, and the road's frame. */
export function boardSpot(route, distance) {
  const frame = roadFrame(route, distance);
  const off = roadHalfWidth(route.lanes) + VERGE + BOARD.setback;
  const x = frame.center[0] + frame.right[0] * off;
  const z = frame.center[2] + frame.right[2] * off;
  // The face looks back along the road (-forward), turned toward the road's side by BOARD.angle.
  const flat = Math.hypot(frame.forward[0], frame.forward[2]);
  const back = [-frame.forward[0] / flat, -frame.forward[2] / flat];
  const toRoad = [-frame.right[0], -frame.right[2]];
  const nx = back[0] * Math.cos(BOARD.angle) + toRoad[0] * Math.sin(BOARD.angle);
  const nz = back[1] * Math.cos(BOARD.angle) + toRoad[1] * Math.sin(BOARD.angle);
  return { x, z, yaw: Math.atan2(nx, nz) };
}

/** The ground the boards at `sites` take, `{x, z, radius}` each: the world plan keeps plants and houses off it. */
export function boardClearings(route, sites) {
  return sites.map(({ distance }) => {
    const { x, z } = boardSpot(route, distance);
    return { x, z, radius: BOARD.clearing };
  });
}

/**
 * The boards for `sites`, placed: `{kind, distance, position, yaw}` for each one that `avoid` (x, z, radius) and the
 * `occupancy` leave room for. Each placed board claims its ground in `occupancy`.
 */
export function placeBoards(route, terrain, sites, { occupancy, avoid = () => false }) {
  const boards = [];
  for (const { kind, distance } of sites) {
    const { x, z, yaw } = boardSpot(route, distance);
    if (avoid(x, z, BOARD.width / 2) || occupancy?.blocked(x, z, BOARD.width / 2)) continue;
    occupancy?.add(x, z, BOARD.clearing);
    boards.push({ kind, distance, position: [x, terrain.height(x, z), z], yaw });
  }
  return boards;
}
