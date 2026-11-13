import { test } from "node:test";
import assert from "node:assert/strict";
import { WebXrSource } from "../../public/js/vr/webXrSource.js";
import { switchToXr } from "../../public/js/vr/xrLoop.js";
import { forwardOf, translation } from "../../public/js/vr/xrFrame.js";
import { placement, yawFor } from "../../public/js/view3d/math.js";

const DEG = Math.PI / 180;
const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const headYaw = (frame) => yawFor(forwardOf(frame.head));

class FakeLayer {
  constructor(session, gl) {
    this.session = session;
    this.gl = gl;
    this.framebuffer = { fb: true };
    this.framebufferWidth = 2000;
    this.framebufferHeight = 1000;
  }
  getViewport(view) {
    return view.viewport;
  }
}

/** A session that runs its frames by hand: `pose.yawDeg` is the head's facing for the next frame. */
function fakeXr() {
  const listeners = {};
  const spaceListeners = {};
  const state = { yawDeg: 0, pose: true, requests: [], frameCallback: null, ended: 0 };
  const space = { addEventListener: (type, fn) => (spaceListeners[type] = fn) };
  const eye = (x) => ({
    viewport: { x: x < 0 ? 0 : 1000, y: 0, width: 1000, height: 1000 },
    projectionMatrix: new Float32Array(16).fill(x),
    transform: { matrix: translation(x, 0, 0) },
  });
  const session = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    updateRenderState: (renderState) => (state.renderState = renderState),
    requestReferenceSpace: async (type) => {
      state.spaceType = type;
      return space;
    },
    requestAnimationFrame: (fn) => (state.frameCallback = fn),
    end: () => {
      state.ended += 1;
      listeners.end?.();
    },
  };
  const xrFrame = {
    getViewerPose: (given) => {
      assert.equal(given, space);
      return state.pose ? { transform: { matrix: placement([0, 1.6, 0], state.yawDeg * DEG, 0) }, views: [eye(-0.032), eye(0.032)] } : null;
    },
  };
  const xr = {
    requestSession: async (mode, options) => {
      state.requests.push({ mode, options });
      return session;
    },
  };
  const runFrame = () => {
    const fn = state.frameCallback;
    state.frameCallback = null;
    fn(0, xrFrame);
  };
  return { xr, state, runFrame, resetSpace: () => spaceListeners.reset(), endSession: () => listeners.end() };
}

async function started(onEnd = () => {}) {
  const fake = fakeXr();
  const frames = [];
  const gl = { gl: true };
  const source = new WebXrSource({ xr: fake.xr, gl, Layer: FakeLayer, now: () => 7, onEnd });
  await source.start((frame) => frames.push(frame));
  return { ...fake, source, frames, gl };
}

test("asks for an immersive seated session", async () => {
  const { state, gl } = await started();
  assert.deepEqual(state.requests, [{ mode: "immersive-vr", options: { optionalFeatures: ["local-floor"] } }]);
  assert.equal(state.spaceType, "local");
  assert.equal(state.renderState.baseLayer.gl, gl);
});

test("one frame gives one view per XR view with its viewport", async () => {
  const { runFrame, frames } = await started();
  runFrame();
  assert.equal(frames.length, 1);
  const [frame] = frames;
  assert.equal(frame.timeS, 7);
  assert.deepEqual(frame.size, { width: 2000, height: 1000 });
  assert.deepEqual(frame.framebuffer, { fb: true });
  assert.deepEqual(
    frame.views.map((view) => view.rect),
    [
      { x: 0, y: 0, width: 1000, height: 1000 },
      { x: 1000, y: 0, width: 1000, height: 1000 },
    ],
  );
  close(frame.views[0].projection[0], -0.032);
});

test("an eye sits where the head's inverse puts it", async () => {
  const { runFrame, frames } = await started();
  runFrame();
  const [left, right] = frames[0].views;
  close(left.headFromEye[12], -0.032);
  close(right.headFromEye[12], 0.032);
  close(right.headFromEye[13], -1.6);
});

test("a frame without a pose draws nothing and the next one still comes", async () => {
  const { runFrame, frames, state } = await started();
  state.pose = false;
  runFrame();
  state.pose = true;
  runFrame();
  assert.equal(frames.length, 1);
});

test("the head starts facing forward", async () => {
  const { runFrame, frames, state } = await started();
  state.yawDeg = 30;
  runFrame();
  close(headYaw(frames[0]), 0);
  state.yawDeg = 50;
  runFrame();
  close(headYaw(frames[1]), 20 * DEG);
});

test("reset recenters", async () => {
  const { runFrame, frames, state, resetSpace } = await started();
  state.yawDeg = 30;
  runFrame();
  state.yawDeg = 90;
  resetSpace();
  runFrame();
  close(headYaw(frames[1]), 0);
});

test("the session's end calls onEnd once", async () => {
  let ended = 0;
  const { endSession } = await started(() => (ended += 1));
  endSession();
  endSession();
  assert.equal(ended, 1);
});

test("no frames are drawn after the session ended", async () => {
  const { runFrame, frames, endSession } = await started();
  runFrame();
  endSession();
  assert.equal(frames.length, 1);
});

test("stop ends the session", async () => {
  const { source, state } = await started();
  source.stop();
  assert.equal(state.ended, 1);
});

function fakeSource({ failing = false } = {}) {
  const source = { started: 0, onEnd: undefined, async start() { source.started += 1; if (failing) throw new Error("denied"); }, stop() {} };
  return source;
}

test("switching stops the 2D loop and starts the source", async () => {
  const calls = [];
  const source = fakeSource();
  const frameFn = () => {};
  source.start = async (onFrame) => calls.push(["start", onFrame]);
  assert.equal(await switchToXr(source, { stop2d: () => calls.push(["stop2d"]), start2d: () => calls.push(["start2d"]), onFrame: frameFn }), true);
  assert.deepEqual(calls, [["stop2d"], ["start", frameFn]]);
});

test("ending the session restarts the 2D loop", async () => {
  let restarts = 0;
  const source = fakeSource();
  await switchToXr(source, { stop2d() {}, start2d: () => (restarts += 1), onFrame() {} });
  source.onEnd();
  source.onEnd();
  assert.equal(restarts, 1);
});

test("a source that fails to start brings the 2D loop back", async () => {
  let restarts = 0;
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal(await switchToXr(fakeSource({ failing: true }), { stop2d() {}, start2d: () => (restarts += 1), onFrame() {} }), false);
  } finally {
    console.error = error;
  }
  assert.equal(restarts, 1);
});

test("the source's own onEnd still runs", async () => {
  const seen = [];
  const source = fakeSource();
  source.onEnd = () => seen.push("source");
  await switchToXr(source, { stop2d() {}, start2d: () => seen.push("2d"), onFrame() {} });
  source.onEnd();
  assert.deepEqual(seen, ["source", "2d"]);
});
