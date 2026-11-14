/**
 * What a VR frame source hands the view each frame, and the matrix helpers the
 * sources share. Matrices are 4×4, column-major (the layout of view3d/math.js).
 *
 * @typedef {{x: number, y: number, width: number, height: number}} ViewRect device pixels, from the bottom left
 * @typedef {{rect: ViewRect, projection: Float32Array, headFromEye: Float32Array}} XrView
 * @typedef {{timeS: number, framebuffer: WebGLFramebuffer | null, size: {width: number, height: number}, head: Float32Array, views: XrView[], hands: XrHand[]}} XrFrame
 *   `head` is the head's pose in seated space; `size` is the framebuffer's; `hands` are the tracked ones (none with controllers).
 * @typedef {{handedness: "left" | "right", joints: Float32Array[], radii: number[]}} XrHand 25 joint poses (4×4, seated space, WebXR joint order) and their radii
 * @typedef {{start(onFrame: (frame: XrFrame) => void): Promise<void>, stop(): void, onEnd?: () => void}} XrFrameSource
 */
import { multiply, perspective } from "../view3d/math.js";

/** Where the eyes' near and far planes sit, metres: a head close to the handlebars needs a near plane well under the 2D view's. */
export const XR_DEPTH = Object.freeze({ near: 0.1, far: 9000 });

/** A pure translation. */
export const translation = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

/** The position a pose matrix puts its origin at. */
export const positionOf = (m) => [m[12], m[13], m[14]];

/** The direction a pose matrix looks along (its −Z axis). */
export const forwardOf = (m) => [-m[8], -m[9], -m[10]];

/** A projection from a field of view given by its full angles, radians. */
export function fieldOfView(horizontalRad, verticalRad, { near, far } = XR_DEPTH) {
  return perspective(verticalRad, Math.tan(horizontalRad / 2) / Math.tan(verticalRad / 2), near, far);
}

/** The pose of an eye in the world: the world-from-seat anchor, the head in seat space, the eye on the head. */
export const eyePose = (anchor, head, headFromEye) => multiply(anchor, multiply(head, headFromEye));
