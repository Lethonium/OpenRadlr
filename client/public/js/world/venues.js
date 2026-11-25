/**
 * Where things stand on an outdoor gym's pad, in the gym's frame (metres; the pad's front, towards the road, is -z,
 * the mat is centred on the origin). Placement (view3d/features.js, in the world's worker) and the gym's model
 * (view3d/assets/props/outdoorGym.js) both read them.
 */

/** The pad's edges: a gravel strip with kerbs, reaching from the road side of the mat to behind the bench. */
export const GYM_PAD = Object.freeze({ x0: -8.6, x1: 8.6, z0: -3.6, z1: 6.6 });

/** The mat (metres): along the road, then away from it. */
export const GYM_MAT = Object.freeze({ w: 8, d: 5 });

/** How high the mat's top stands over the pad's origin (the athletes' spots stand on it). */
export const GYM_TOP = 0.08;

/** Where the gym's sign stands, off the pad, towards the road. */
export const GYM_SIGN = Object.freeze({ x: -6.2, z: -9.4 });
