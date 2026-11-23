import { test } from "node:test";
import assert from "node:assert/strict";

import { ThreeRenderer } from "../public/js/view3d/threeRenderer.js";

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
const projection = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const frame = (extra = {}) => ({
  view,
  projection,
  viewProjection: identity,
  inverseViewProjection: identity,
  camera: [1, 2, 3],
  zenith: [0.2, 0.4, 0.9],
  horizon: [0.7, 0.8, 0.9],
  ground: [0.3, 0.3, 0.2],
  sun: [0, 1, 0],
  sunColor: [1, 1, 1],
  fog: [10, 1000],
  ...extra,
});

const mesh = (name) => ({
  name,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  colors: new Float32Array(12).fill(1),
  vertexCount: 3,
});

/** A stand-in for Three's WebGLRenderer that records what it is asked to do. */
function fakeRenderer() {
  const calls = { clears: [], renders: [], viewports: [], scissors: [] };
  const state = { scissorTest: false, scissor: null, viewport: null };
  return {
    calls,
    autoClear: true,
    setPixelRatio() {},
    setSize() {},
    setClearColor() {},
    setViewport(x, y, width, height) {
      state.viewport = [x, y, width, height];
      calls.viewports.push(state.viewport);
    },
    setScissor(x, y, width, height) {
      state.scissor = [x, y, width, height];
      calls.scissors.push(state.scissor);
    },
    setScissorTest(on) {
      state.scissorTest = on;
    },
    clear() {
      calls.clears.push({ scissorTest: state.scissorTest, scissor: state.scissor, viewport: state.viewport });
    },
    render(scene) {
      calls.renders.push(scene.children.map((child) => child.name));
    },
  };
}

function make() {
  const fake = fakeRenderer();
  const renderer = new ThreeRenderer(null, { createRenderer: () => fake });
  return { renderer, fake };
}

test("one pass renders once, on end", () => {
  const { renderer, fake } = make();
  renderer.begin(frame());
  renderer.draw(renderer.upload(mesh("one")), identity);
  renderer.draw(renderer.upload(mesh("two")), identity);
  assert.equal(fake.calls.renders.length, 0);
  renderer.end();
  assert.deepEqual(fake.calls.renders, [["sky", "one", "two"]]);
});

test("transparent draws render after opaque ones", () => {
  const { renderer, fake } = make();
  renderer.begin(frame());
  renderer.draw(renderer.upload(mesh("A")), identity);
  renderer.drawTransparent(renderer.upload(mesh("B")), identity, { alpha: 0.5 });
  renderer.draw(renderer.upload(mesh("C")), identity);
  renderer.end();
  assert.deepEqual(fake.calls.renders, [["sky", "A", "C", "B"]]);
});

test("starting a new pass renders the pending one first", () => {
  const { renderer, fake } = make();
  renderer.begin(frame());
  renderer.draw(renderer.upload(mesh("one")), identity);
  renderer.viewport({ x: 10, y: 20, width: 300, height: 200 });
  renderer.begin(frame());
  renderer.draw(renderer.upload(mesh("two")), identity);
  renderer.end();
  assert.deepEqual(fake.calls.renders, [
    ["sky", "one"],
    ["sky", "two"],
  ]);
});

test("an inset clears only inside its rectangle", () => {
  const { renderer, fake } = make();
  renderer.viewport({ x: 10, y: 20, width: 300, height: 200 });
  renderer.begin(frame());
  renderer.end();
  assert.deepEqual(fake.calls.clears, [
    { scissorTest: true, scissor: [10, 20, 300, 200], viewport: [10, 20, 300, 200] },
  ]);
});

test("draws are not kept for the next frame", () => {
  const { renderer, fake } = make();
  renderer.begin(frame());
  renderer.draw(renderer.upload(mesh("one")), identity);
  renderer.end();
  renderer.begin(frame());
  renderer.draw(renderer.upload(mesh("two")), identity);
  renderer.end();
  assert.deepEqual(fake.calls.renders, [["sky", "one"], ["sky", "two"]]);
});

test("the camera uses the frame's view and projection", () => {
  const { renderer } = make();
  renderer.begin(frame());
  assert.deepEqual([...renderer.camera.matrixWorldInverse.elements], [...view]);
  assert.deepEqual([...renderer.camera.projectionMatrix.elements], [...projection]);
});
