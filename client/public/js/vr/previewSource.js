/**
 * The headset-free XR frame source: both eyes side by side on a normal canvas,
 * the head pose from the mouse, the arrow keys or the URL. It hands the view
 * the same `XrFrame` the headset would, so everything past the source is the
 * code a Quest runs.
 */
import { placement } from "../view3d/math.js";
import { gripPoints, restingHand } from "./hands.js";
import { XR_DEPTH, fieldOfView, translation } from "./xrFrame.js";

const RAD = Math.PI / 180;
export const EYE_SEPARATION_M = 0.064;
export const EYE_FOV = Object.freeze({ horizontalDeg: 100, verticalDeg: 96 });
const DRAG_DEG_PER_PX = 0.25;
const KEY_STEP_DEG = 5;
const MAX_PITCH_DEG = 80;

/** `?head=<yawDeg>,<pitchDeg>[,<x>,<y>,<z>]` as a pose, or null without a usable one. */
export function parseHead(search) {
  const raw = new URLSearchParams(search).get("head");
  if (raw === null) return null;
  const parts = raw.split(",");
  if (![2, 5].includes(parts.length) || parts.some((part) => part.trim() === "")) return null;
  const numbers = parts.map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  const [yawDeg, pitchDeg, ...position] = numbers;
  return { yawDeg, pitchDeg, position: position.length ? position : [0, 0, 0] };
}

/** The largest rect with the eye's aspect inside a `width` × `height` half, centred. */
function letterbox(x, width, height) {
  const aspect = Math.tan((EYE_FOV.horizontalDeg * RAD) / 2) / Math.tan((EYE_FOV.verticalDeg * RAD) / 2);
  const w = Math.min(width, Math.round(height * aspect));
  const h = Math.min(height, Math.round(width / aspect));
  return { x: x + Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
}

/**
 * One frame of the preview for a canvas of `width` × `height` pixels. Positive
 * yaw turns right, positive pitch looks up.
 * @param {{width: number, height: number, timeS: number, pose: {yawDeg: number, pitchDeg: number, position: number[]}}} input
 * @returns {import("./xrFrame.js").XrFrame}
 */
export function previewFrame({ width, height, timeS, pose }) {
  const half = Math.floor(width / 2);
  const projection = fieldOfView(EYE_FOV.horizontalDeg * RAD, EYE_FOV.verticalDeg * RAD, XR_DEPTH);
  const grips = gripPoints();
  return {
    timeS,
    framebuffer: null,
    size: { width, height },
    head: placement(pose.position, -pose.yawDeg * RAD, pose.pitchDeg * RAD),
    hands: [restingHand("left", grips.left), restingHand("right", grips.right)],
    views: [
      { rect: letterbox(0, half, height), projection, headFromEye: translation(-EYE_SEPARATION_M / 2, 0, 0) },
      { rect: letterbox(half, half, height), projection, headFromEye: translation(EYE_SEPARATION_M / 2, 0, 0) },
    ],
  };
}

/** @implements {import("./xrFrame.js").XrFrameSource} */
export class PreviewSource {
  #canvas;
  #schedule;
  #now;
  #initial;
  #pose;
  #running = false;
  #ticket = 0;

  /**
   * @param {{canvas: {width: number, height: number, clientWidth: number, clientHeight: number}, schedule?: (tick: () => void) => unknown, now: () => number,
   *   input: {onDrag: (fn: (dx: number, dy: number) => void) => void, onKey: (fn: (key: string) => void) => void},
   *   initial?: {yawDeg: number, pitchDeg: number, position: number[]}}} deps
   */
  constructor({ canvas, schedule = (tick) => requestAnimationFrame(tick), now, input, initial = { yawDeg: 0, pitchDeg: 0, position: [0, 0, 0] } }) {
    this.#canvas = canvas;
    this.#schedule = schedule;
    this.#now = now;
    this.#initial = initial;
    this.#pose = { ...initial, position: [...initial.position] };
    input.onDrag((dx, dy) => this.#turn(dx * DRAG_DEG_PER_PX, -dy * DRAG_DEG_PER_PX));
    input.onKey((key) => this.#key(key));
  }

  /** The current head pose. */
  get pose() {
    return { ...this.#pose, position: [...this.#pose.position] };
  }

  #turn(yawDeg, pitchDeg) {
    this.#pose.yawDeg += yawDeg;
    this.#pose.pitchDeg = Math.max(-MAX_PITCH_DEG, Math.min(MAX_PITCH_DEG, this.#pose.pitchDeg + pitchDeg));
  }

  #key(key) {
    if (key === "ArrowLeft") this.#turn(-KEY_STEP_DEG, 0);
    else if (key === "ArrowRight") this.#turn(KEY_STEP_DEG, 0);
    else if (key === "ArrowUp") this.#turn(0, KEY_STEP_DEG);
    else if (key === "ArrowDown") this.#turn(0, -KEY_STEP_DEG);
    else if (key === "r" || key === "R") this.#pose = { ...this.#initial, position: [...this.#initial.position] };
  }

  async start(onFrame) {
    this.stop();
    this.#running = true;
    const ticket = this.#ticket;
    const tick = () => {
      if (!this.#running || ticket !== this.#ticket) return;
      this.#schedule(tick);
      const canvas = this.#canvas;
      const width = Math.max(2, Math.round(canvas.clientWidth));
      const height = Math.max(1, Math.round(canvas.clientHeight));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      onFrame(previewFrame({ width, height, timeS: this.#now(), pose: this.pose }));
    };
    this.#schedule(tick);
  }

  stop() {
    this.#running = false;
    this.#ticket += 1;
  }
}
