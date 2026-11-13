/**
 * The headset's XR frame source: an immersive WebXR session whose frames reach
 * the view as the same `XrFrame` the preview makes. The head pose is in a
 * "local" (seated) space, turned so that the first pose faces forward; the
 * session's `reset` event (the rider recentres) captures the facing again.
 */
import { invert, multiply, yawFor } from "../view3d/math.js";
import { JOINT_COUNT } from "./hands.js";
import { forwardOf } from "./xrFrame.js";

/** A rotation about +Y by `angle` radians (counter-clockwise seen from above, like `placement`'s yaw). */
function rotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

/** Every tracked hand with all 25 joint poses (a hand missing one is left out), in `space`. */
function hands(session, xrFrame, space) {
  const found = [];
  for (const source of session.inputSources ?? []) {
    if (!source.hand || !["left", "right"].includes(source.handedness)) continue;
    const poses = [...source.hand.values()].map((joint) => xrFrame.getJointPose?.(joint, space));
    if (poses.length !== JOINT_COUNT || poses.some((pose) => !pose)) continue;
    found.push({ handedness: source.handedness, joints: poses.map((pose) => new Float32Array(pose.transform.matrix)), radii: poses.map((pose) => pose.radius) });
  }
  return found;
}

/** @implements {import("./xrFrame.js").XrFrameSource} */
export class WebXrSource {
  #xr;
  #gl;
  #Layer;
  #now;
  #session = null;
  #yaw = null;
  #ended = false;

  /**
   * @param {{xr?: object, gl: WebGL2RenderingContext, Layer?: new (session: object, gl: object) => object, now?: () => number, onEnd?: () => void}} deps
   *   `xr` is `navigator.xr`; `Layer` is `XRWebGLLayer`; `now` gives seconds on the clock the ride's samples use.
   */
  constructor({ xr = globalThis.navigator?.xr, gl, Layer = globalThis.XRWebGLLayer, now = () => Date.now() / 1000, onEnd } = {}) {
    this.#xr = xr;
    this.#gl = gl;
    this.#Layer = Layer;
    this.#now = now;
    this.onEnd = onEnd;
  }

  async start(onFrame) {
    this.#ended = false;
    this.#yaw = null;
    const session = await this.#xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] });
    this.#session = session;
    session.addEventListener("end", () => {
      this.#session = null;
      if (this.#ended) return;
      this.#ended = true;
      this.onEnd?.();
    });
    const layer = new this.#Layer(session, this.#gl);
    session.updateRenderState({ baseLayer: layer });
    const space = await session.requestReferenceSpace("local");
    space.addEventListener?.("reset", () => (this.#yaw = null));
    const tick = (_time, xrFrame) => {
      if (this.#session !== session) return;
      session.requestAnimationFrame(tick);
      const pose = xrFrame.getViewerPose(space);
      if (!pose) return;
      onFrame(this.#frame(layer, pose, hands(session, xrFrame, space)));
    };
    session.requestAnimationFrame(tick);
  }

  #frame(layer, pose, tracked) {
    const matrix = pose.transform.matrix;
    this.#yaw ??= yawFor(forwardOf(matrix));
    const inverse = invert(matrix);
    const turn = rotationY(-this.#yaw);
    return {
      timeS: this.#now(),
      framebuffer: layer.framebuffer,
      size: { width: layer.framebufferWidth, height: layer.framebufferHeight },
      head: multiply(turn, matrix),
      hands: tracked.map((hand) => ({ ...hand, joints: hand.joints.map((joint) => multiply(turn, joint)) })),
      views: pose.views.map((view) => ({
        rect: layer.getViewport(view),
        projection: view.projectionMatrix,
        headFromEye: multiply(inverse, view.transform.matrix),
      })),
    };
  }

  stop() {
    this.#session?.end();
  }
}
