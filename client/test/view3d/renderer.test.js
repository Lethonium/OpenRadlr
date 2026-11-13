import { test } from "node:test";
import assert from "node:assert/strict";
import { Renderer, createContext } from "../../public/js/view3d/renderer.js";

/** A WebGL stand-in that answers every call with a truthy handle and remembers the framebuffer and viewport calls. */
function fakeGl() {
  const calls = [];
  const canvas = { width: 640, height: 480 };
  const answers = new Map();
  const gl = new Proxy(
    { canvas },
    {
      get(target, name) {
        if (name in target) return target[name];
        if (name === "bindFramebuffer" || name === "viewport") return (...args) => calls.push([name, ...args]);
        if (!answers.has(name)) answers.set(name, () => ({}));
        return answers.get(name);
      },
    },
  );
  return { gl, calls, canvas };
}

test("endShadows returns to the target framebuffer", () => {
  const { gl, calls } = fakeGl();
  const renderer = new Renderer(gl);
  const framebuffer = {};
  renderer.target(framebuffer, { width: 100, height: 50 });
  calls.length = 0;
  renderer.endShadows();
  assert.deepEqual(calls, [["bindFramebuffer", gl.FRAMEBUFFER, framebuffer], ["viewport", 0, 0, 100, 50]]);
});

test("target binds the framebuffer at once, so XR draws into it without a shadow pass", () => {
  const { gl, calls } = fakeGl();
  const renderer = new Renderer(gl);
  const framebuffer = {};
  calls.length = 0;
  renderer.target(framebuffer, { width: 100, height: 50 });
  assert.deepEqual(calls, [["bindFramebuffer", gl.FRAMEBUFFER, framebuffer]]);
  calls.length = 0;
  renderer.target(null);
  assert.deepEqual(calls, [["bindFramebuffer", gl.FRAMEBUFFER, null]]);
});

test("a second view on the same renderer reuses its shadow map", () => {
  const { gl } = fakeGl();
  let textures = 0;
  const counting = new Proxy(gl, { get: (target, name) => (name === "createTexture" ? () => (textures += 1, {}) : name === "checkFramebufferStatus" ? () => target.FRAMEBUFFER_COMPLETE : target[name]) });
  const renderer = new Renderer(counting);
  textures = 0;
  assert.equal(renderer.createShadowMap(512), true);
  assert.equal(renderer.createShadowMap(512), true);
  assert.equal(textures, 1);
});

test("viewport(null) returns to the target size", () => {
  const { gl, calls } = fakeGl();
  const renderer = new Renderer(gl);
  renderer.target({}, { width: 100, height: 50 });
  calls.length = 0;
  renderer.viewport(null);
  assert.deepEqual(calls, [["viewport", 0, 0, 100, 50]]);
});

test("without a target the canvas is drawn into", () => {
  const { gl, calls } = fakeGl();
  const renderer = new Renderer(gl);
  calls.length = 0;
  renderer.endShadows();
  assert.deepEqual(calls, [["bindFramebuffer", gl.FRAMEBUFFER, null], ["viewport", 0, 0, 640, 480]]);
});

test("createContext passes xrCompatible", () => {
  const asked = [];
  const canvas = { getContext: (kind, options) => asked.push({ kind, options }) };
  createContext(canvas, { xrCompatible: true });
  createContext(canvas);
  assert.equal(asked[0].options.xrCompatible, true);
  assert.equal(asked[1].options.xrCompatible, false);
});
