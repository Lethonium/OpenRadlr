/**
 * The cameras' lenses: near and far planes, haze and shadows. Plain data, so
 * the menu can pick a lens before the renderer is loaded.
 */

/**
 * The ride's lens; the menu's drone view sees further (`haze` stretches fog
 * and draw distances). Depth precision far away grows with `near`, so it is
 * as large as the cameras allow: the closest ride camera sits 3 m behind the
 * rider, the drone at least 70 m above the ground.
 */
export const RIDE_LENS = Object.freeze({ near: 1, far: 9000, haze: 1, shadows: true });
export const DRONE_LENS = Object.freeze({ near: 20, far: 16000, haze: 1.3, shadows: false });
/** The drone's haze before it thickened: its draw reach (`reach`) is still what this clearer air gave. */
const CLEAR_HAZE = 2.6;

/**
 * The menu's gym orbit drops far below the drone (about 17 m up over the mat,
 * not 70), so `DRONE_LENS.near` would clip the ground in the foreground. This
 * lens keeps the haze and draw reach of the drone but pulls `near` in to the
 * closest the orbit gets to anything.
 */
export const GYM_LENS = Object.freeze({ ...DRONE_LENS, near: 2 });

/**
 * The drone's lens for an island of `overview.radius` metres: the haze grows
 * with a big island, so its far coast stays a silhouette in the haze rather than
 * being fogged out (the fixed DRONE_LENS was made for a 2.5 km island).
 */
export function droneLens(overview) {
  const radius = overview?.radius ?? 0;
  const haze = Math.max(DRONE_LENS.haze, radius / 4500);
  // Small things reach as far as the clearer air let them (`reach`): the thicker haze must not cost the view its depth.
  return Object.freeze({ ...DRONE_LENS, haze, reach: Math.sqrt(CLEAR_HAZE), far: Math.max(DRONE_LENS.far, radius * 3.4) });
}

/**
 * The gym orbit's lens for an island of `overview.radius` metres: the drone
 * lens (same haze and draw reach) with a `near` plane the low orbit clears.
 * The orbit is `MENU_CAMERA.gymHeight` metres up at `gymDistance` out, so the
 * terrain in the foreground is never nearer than the height; 2 m leaves room
 * for the mat slipping below the eye.
 */
export function gymLens(overview) {
  return Object.freeze({ ...droneLens(overview), near: GYM_LENS.near });
}

/**
 * Smallest depth difference (metres) a `bits` depth buffer resolves at
 * `distance` with a `near`/`far` perspective lens. Surfaces closer than this
 * flicker against each other.
 */
export function depthStep({ near, far }, distance, bits = 24) {
  // Window depth is (1/near - 1/z) / (1/near - 1/far); one step of it in z.
  return (distance * distance * (1 / near - 1 / far)) / 2 ** bits;
}
