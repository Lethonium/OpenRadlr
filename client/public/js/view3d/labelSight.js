/**
 * Whether a rider's label is in sight of the camera: the line from the eye to the head must clear the ground and
 * every building plot. Pure geometry over the world's ground grid and plan; nothing is read back from the GPU.
 */
import { lineOfSight } from "../world/sight.js";

/** Metres a house stands over the ground its plot is on (a roof ridge, a little over a two-storey house). */
const HOUSE_HEIGHT = 8;
/** Half the edge of a farmstead's square, metres: the yard's house and barn stand within it. */
const FARM_HALF = 12;

/**
 * @typedef {object} SightBox an upright box over a plot; its width axis is (cos yaw, sin yaw) in world x/z, its depth axis (-sin yaw, cos yaw)
 * @property {number} x centre
 * @property {number} z
 * @property {number} halfX half the width
 * @property {number} halfZ half the depth
 * @property {number} yaw
 * @property {number} top height of the roof, metres
 */

/** The cell of a grid that holds (x, z) as bilinear weights, or null when the point lies outside the grid. */
function bilinear(grid, x, z) {
  const { x0, z0, cell, columns, rows, heights } = grid;
  const gx = (x - x0) / cell;
  const gz = (z - z0) / cell;
  if (gx < 0 || gz < 0 || gx > columns - 1 || gz > rows - 1) return null;
  const i = Math.min(columns - 2, Math.floor(gx));
  const j = Math.min(rows - 2, Math.floor(gz));
  const fx = gx - i;
  const fz = gz - j;
  const at = (di, dj) => heights[(j + dj) * columns + i + di];
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fz) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fz;
}

/**
 * The ground's height at (x, z): bilinear over the near grid, the far grid beyond it (the nearest edge height past both).
 * @param {{near: object, far: object} | undefined} ground the world's ground grids
 * @returns {(x: number, z: number) => number}
 */
export function groundHeight(ground) {
  if (!ground) return () => -Infinity;
  const { near, far } = ground;
  return (x, z) => bilinear(near, x, z) ?? bilinear(far, x, z) ?? edge(far, x, z);
}

/** The far grid's height at the point of it nearest (x, z). */
function edge(grid, x, z) {
  const { x0, z0, cell, columns, rows } = grid;
  const clampedX = x0 + Math.min(columns - 1, Math.max(0, (x - x0) / cell)) * cell;
  const clampedZ = z0 + Math.min(rows - 1, Math.max(0, (z - z0) / cell)) * cell;
  return bilinear(grid, clampedX, clampedZ) ?? 0;
}

/**
 * A box for every house plot of every settlement and every farm, a roof's height over the ground.
 * @param {{settlements?: object[], farms?: object[]} | undefined} plan the world's plan
 * @returns {SightBox[]}
 */
export function plotBoxes(plan) {
  const boxes = [];
  for (const settlement of plan?.settlements ?? []) {
    settlement.plots.forEach((plot, i) => {
      const yaw = Math.atan2(plot.facing[0], -plot.facing[1]);
      boxes.push({ x: plot.x, z: plot.z, halfX: plot.width / 2, halfZ: plot.depth / 2, yaw, top: (settlement.ground[i] ?? 0) + HOUSE_HEIGHT });
    });
  }
  for (const farm of plan?.farms ?? []) {
    boxes.push({ x: farm.x, z: farm.z, halfX: FARM_HALF, halfZ: FARM_HALF, yaw: farm.yaw ?? 0, top: farm.y + HOUSE_HEIGHT });
  }
  return boxes;
}

/** True when the line from `from` to `to` passes through `box` below its roof. */
function blockedBy(from, to, box) {
  const cos = Math.cos(box.yaw);
  const sin = Math.sin(box.yaw);
  const local = (p) => [(p[0] - box.x) * cos + (p[2] - box.z) * sin, -(p[0] - box.x) * sin + (p[2] - box.z) * cos];
  const [u0, v0] = local(from);
  const [u1, v1] = local(to);
  let enter = 0;
  let leave = 1;
  for (const [start, delta, half] of [[u0, u1 - u0, box.halfX], [v0, v1 - v0, box.halfZ]]) {
    if (delta === 0) {
      if (Math.abs(start) > half) return false;
      continue;
    }
    const a = (-half - start) / delta;
    const b = (half - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  if (enter > leave) return false;
  const lowest = Math.min(from[1] + (to[1] - from[1]) * enter, from[1] + (to[1] - from[1]) * leave);
  return lowest < box.top;
}

/**
 * Whether the eye sees the head: the ground does not rise over the line and no plot's box blocks it.
 * @param {number[]} eye
 * @param {number[]} head
 * @param {{height: (x: number, z: number) => number, boxes: SightBox[]}} world
 * @returns {boolean}
 */
export function labelInSight(eye, head, { height, boxes }) {
  return lineOfSight(eye, head, { height }) && !boxes.some((box) => blockedBy(eye, head, box));
}
