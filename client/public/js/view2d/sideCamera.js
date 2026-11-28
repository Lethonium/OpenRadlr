/**
 * The side view's camera: it stands CAM_M metres to the right of the road and looks across it. The road is a
 * flat strip along the screen; land further left shrinks towards the horizon (`f`), and its heights are flattened
 * with distance so near grades read and far hills do not shoot off the screen. Pure.
 */
/** Metres from the camera to the road; land `lateral` metres right of the road (negative: further away) shrinks by CAM_M / (CAM_M - lateral). */
export const CAM_M = 110;
/** The horizon is this far above the road, as a fraction of the height. */
export const HORIZON_ABOVE = 0.3;
/** The road sits this far down the height, and my rider this far across the width. */
export const ROAD_AT = 0.64;
export const RIDER_AT = 0.3;
/** Metres of road across the canvas width. */
export const SPAN_M = 55;
/** Vertical exaggeration at the road, and what far land is flattened to. */
export const VEX = 1.6;
export const FAR_VEX = 0.32;
/** Heights flatten between this shrink factor (far) and 1 (the road), quadratically. */
const FLATTEN_FROM = 0.45;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * @param {{width: number, height: number, me: {d: number}, route: {elevationAt: (d: number) => number}, ratio?: number}} input
 *   `width`, `height` are in CSS pixels; `ratio` is the device pixels per CSS pixel, for the caches that draw at device resolution
 * @returns {{width: number, height: number, ratio: number, scale: number, riderX: number, roadY: number, horizonY: number, elev: number, meD: number, f: (lateral: number) => number, vex: (f: number) => number, plane: (lateral: number) => number, rise: (lateral: number) => number, x: (d: number, lateral: number) => number, y: (height: number, lateral: number) => number}}
 */
export function sideCamera({ width, height, me, route, ratio = 1 }) {
  const scale = width / SPAN_M;
  const riderX = width * RIDER_AT;
  const roadY = height * ROAD_AT;
  const horizonY = roadY - height * HORIZON_ABOVE;
  const elev = route.elevationAt(me.d);
  const f = (lateral) => CAM_M / (CAM_M - lateral);
  const vex = (shrink) => FAR_VEX + (VEX - FAR_VEX) * clamp01((shrink - FLATTEN_FROM) / (1 - FLATTEN_FROM)) ** 2;
  /** Where flat land at the rider's height stands at this lateral. */
  const plane = (lateral) => horizonY + (roadY - horizonY) * f(lateral);
  /** Pixels per metre of height at this lateral. */
  const rise = (lateral) => scale * vex(f(lateral)) * f(lateral);
  return {
    width,
    height,
    ratio,
    scale,
    riderX,
    roadY,
    horizonY,
    elev,
    meD: me.d,
    f,
    vex,
    plane,
    rise,
    x: (d, lateral) => riderX + (d - me.d) * scale * f(lateral),
    y: (h, lateral) => plane(lateral) - (h - elev) * rise(lateral),
  };
}
