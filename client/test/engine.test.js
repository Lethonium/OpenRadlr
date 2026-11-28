import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { engineFor } from "../public/js/view3d/engine/engine.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { fakeRenderer } from "./support/fakeRenderer.js";

/** An engine on a fake renderer; `post` records what the chain was asked. */
function make(canvas = {}, settings = undefined) {
  const fake = fakeRenderer();
  const posts = [];
  const createPost = (renderer, target, settings) => {
    const post = { settings, rendered: [], sizes: [], disposed: 0, render: (camera, env, options) => post.rendered.push({ camera, env, options, target: renderer.getRenderTarget() }), setSize: (w, h) => post.sizes.push([w, h]), dispose: () => (post.disposed += 1) };
    posts.push(post);
    return post;
  };
  const engine = engineFor(canvas, { createRenderer: () => fake, createPost, ...(settings ? { settings } : {}) });
  return { engine, fake, posts };
}

test("Low starts without an offscreen render target or post chain", () => {
  const low = qualitySettings("low");
  const { engine, posts } = make({}, low);
  assert.equal(engine.settings, low);
  assert.equal(posts.length, 0);
  assert.equal(engine.target, null);
});

test("one engine per canvas", () => {
  const a = {};
  const b = {};
  const { engine } = make(a);
  assert.equal(engineFor(a), engine);
  assert.notEqual(make(b).engine, engine);
});

test("a frame renders the scene into the scene target", () => {
  const { engine, fake } = make();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  engine.beginFrame();
  engine.renderScene(scene, camera);
  assert.equal(fake.calls.scenes.at(-1), scene);
  assert.equal(fake.calls.cameras.at(-1), camera);
  assert.equal(fake.calls.renderTargets.at(-1), engine.target);
  assert.equal(fake.calls.clears.at(-1).target, engine.target);
});

test("beginFrame leaves the scene target bound for the adapter", () => {
  const { engine, fake } = make();
  engine.beginFrame();
  assert.equal(fake.getRenderTarget(), engine.target);
});

test("a rectangle limits the scene to it", () => {
  const { engine, fake } = make();
  engine.resize(100, 50, 1);
  engine.beginFrame();
  engine.renderScene(new THREE.Scene(), new THREE.PerspectiveCamera(), { x: 10, y: 20, width: 30, height: 40 });
  assert.deepEqual(fake.calls.viewports.at(-1), [10, 20, 30, 40]);
  assert.deepEqual(fake.calls.scissors.at(-1), [10, 20, 30, 40]);
});

test("present draws to the screen last", () => {
  const { engine, fake, posts } = make();
  const camera = new THREE.PerspectiveCamera();
  const env = { exposure: 1.5 };
  engine.beginFrame();
  engine.renderScene(new THREE.Scene(), camera);
  engine.present(camera, env, { ride: true });
  assert.equal(fake.calls.targets.at(-1), null);
  assert.equal(posts[0].rendered.length, 1);
  assert.equal(posts[0].rendered[0].target, null);
  assert.equal(posts[0].rendered[0].env, env);
  assert.equal(posts[0].rendered[0].options.ride, true);
});

test("present sets the tone mapping exposure from the environment", () => {
  const { engine, fake } = make();
  engine.present(new THREE.PerspectiveCamera(), { exposure: 1.5 });
  assert.equal(fake.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(fake.toneMappingExposure, 1.5);
});

test("resize keeps the target in device pixels", () => {
  const { engine, fake, posts } = make();
  engine.resize(300, 200, 1.5);
  assert.equal(engine.target.width, 450);
  assert.equal(engine.target.height, 300);
  assert.deepEqual(fake.calls.sizes.at(-1), [450, 300]);
  assert.deepEqual(posts[0].sizes.at(-1), [450, 300]);
});

test("a quality level sets the samples and rebuilds the chain", () => {
  const { engine, posts } = make();
  engine.setQuality(qualitySettings("ultra"));
  assert.equal(engine.target.samples, 8);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].disposed, 1);
  assert.equal(posts[1].settings.msaa, 8);
});

test("dispose releases the chain and the renderer once", () => {
  const { engine, fake, posts } = make();
  engine.dispose();
  engine.dispose();
  assert.equal(posts[0].disposed, 1);
  assert.equal(fake.calls.disposed, 1);
});

test("a disposed engine is replaced by a new one for the canvas", () => {
  const canvas = {};
  const { engine } = make(canvas);
  engine.dispose();
  const again = make(canvas).engine;
  assert.notEqual(again, engine);
});

test("the renderer draws soft shadows for the world's sun", () => {
  const { fake } = make();
  assert.equal(fake.shadowMap.enabled, true);
  assert.equal(fake.shadowMap.type, THREE.PCFSoftShadowMap);
});

test("resizing to the size it already has does nothing", () => {
  const { engine, fake, posts } = make();
  engine.resize(300, 200, 1);
  const sizes = fake.calls.sizes.length;
  const post = posts[0].sizes.length;
  engine.resize(300, 200, 1);
  assert.equal(fake.calls.sizes.length, sizes);
  assert.equal(posts[0].sizes.length, post);
});

test("a rectangle is cleared before its scene is drawn into it", () => {
  const { engine, fake } = make();
  engine.resize(100, 50, 1);
  engine.beginFrame();
  const clears = fake.calls.clears.length;
  engine.renderScene(new THREE.Scene(), new THREE.PerspectiveCamera(), { x: 10, y: 20, width: 30, height: 40 });
  assert.equal(fake.calls.clears.length, clears + 1);
  assert.deepEqual(fake.calls.clears.at(-1).scissor, [10, 20, 30, 40]);
  assert.equal(fake.calls.clears.at(-1).scissorTest, true);
});

test("a rectangle survives what Three does when a shadow pass hands the target back", () => {
  // `setRenderTarget(target)` (the shadow map's way back to the scene target) takes the target's own viewport and scissor.
  const { engine, fake } = make();
  engine.resize(100, 50, 1);
  engine.beginFrame();
  let handedBack = null;
  fake.render = () => {
    const { viewport, scissor, scissorTest } = engine.target;
    handedBack = { viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest };
  };
  engine.renderScene(new THREE.Scene(), new THREE.PerspectiveCamera(), { x: 10, y: 20, width: 30, height: 40 });
  assert.deepEqual(handedBack, { viewport: [10, 20, 30, 40], scissor: [10, 20, 30, 40], scissorTest: true });
  // The next whole-frame pass has the whole target again.
  engine.renderScene(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.deepEqual(handedBack, { viewport: [0, 0, 100, 50], scissor: [0, 0, 100, 50], scissorTest: false });
});

test("a whole-frame scene is not cleared again after beginFrame", () => {
  const { engine, fake } = make();
  engine.beginFrame();
  const clears = fake.calls.clears.length;
  engine.renderScene(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(fake.calls.clears.length, clears);
});

test("Low resets the entire viewport after an inset and a resize", () => {
  const { engine, fake } = make({}, qualitySettings("low"));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  engine.resize(120, 80);
  engine.beginFrame({ exposure: 1.5 });
  engine.renderScene(scene, camera, { x: 10, y: 5, width: 50, height: 30 });
  assert.deepEqual(fake.calls.viewports.at(-1), [10, 5, 50, 30]);
  engine.present(camera, { exposure: 1.5 });
  assert.equal(fake.calls.renderTargets.at(-1), null);
  assert.deepEqual(fake.calls.viewports.at(-1), [0, 0, 120, 80]);
  engine.resize(160, 120);
  engine.beginFrame({ exposure: 1.5 });
  assert.deepEqual(fake.calls.clears.at(-1).viewport, [0, 0, 160, 120]);
  assert.equal(fake.calls.clears.at(-1).scissorTest, false);
  assert.equal(fake.toneMappingExposure, 1.5);
});

test("changing between Low and High allocates and releases the post chain", () => {
  const { engine, posts } = make({}, qualitySettings("low"));
  engine.resize(120, 80);
  engine.setQuality(qualitySettings("high"));
  assert.deepEqual([engine.target.width, engine.target.height], [120, 80]);
  assert.equal(posts.length, 1);
  engine.setQuality(qualitySettings("low"));
  assert.equal(engine.target, null);
  assert.equal(posts[0].disposed, 1);
});

test("warm compiles a scene's shaders ahead and resolves once they are ready", async () => {
  const { engine, fake } = make();
  const asked = [];
  let ready;
  fake.compileAsync = (scene, camera) => {
    asked.push({ scene, camera });
    return new Promise((resolve) => (ready = resolve));
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  let done = false;
  const warming = engine.warm(scene, camera).then(() => (done = true));
  assert.deepEqual(asked, [{ scene, camera }]);
  await Promise.resolve();
  assert.equal(done, false, "not before the shaders are");
  ready();
  await warming;
  assert.equal(done, true);
});

test("warm resolves at once on a renderer that cannot compile ahead", async () => {
  const { engine } = make();
  await engine.warm(new THREE.Scene(), new THREE.PerspectiveCamera());
});

test("warm gives up waiting after a while, so a stuck driver never stops the drawing", async () => {
  const fake = fakeRenderer();
  fake.compileAsync = () => new Promise(() => {});
  const timers = [];
  const engine = engineFor({}, { createRenderer: () => fake, createPost: () => ({ render() {}, setSize() {}, dispose() {} }), setTimeout: (fn, ms) => timers.push({ fn, ms }) });
  const warming = engine.warm(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms >= 1000);
  timers[0].fn();
  await warming;
});

test("warm calls the timer as a plain function, as browsers only allow", async () => {
  const fake = fakeRenderer();
  fake.compileAsync = () => Promise.resolve();
  let self = "unset";
  function timer() {
    "use strict";
    self = this;
  }
  const engine = engineFor({}, { createRenderer: () => fake, createPost: () => ({ render() {}, setSize() {}, dispose() {} }), setTimeout: timer });
  await engine.warm(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(self, undefined);
});

test("warm compiles for the scene target the frames draw into (its tone mapping and colours differ from the screen's)", async () => {
  const { engine, fake } = make();
  let target = "unset";
  fake.compileAsync = () => ((target = fake.getRenderTarget()), Promise.resolve());
  fake.setRenderTarget(null);
  await engine.warm(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(target, engine.target);
  assert.equal(fake.getRenderTarget(), null, "what was bound before is bound again");
});

test("shader error checks are off unless asked for (each costs a stall on a shader's first use)", () => {
  const quiet = fakeRenderer();
  quiet.debug = { checkShaderErrors: true };
  const createPost = () => ({ render() {}, setSize() {}, dispose() {} });
  engineFor({}, { createRenderer: () => quiet, createPost });
  assert.equal(quiet.debug.checkShaderErrors, false);
  const checked = fakeRenderer();
  checked.debug = { checkShaderErrors: false };
  engineFor({}, { createRenderer: () => checked, createPost, checkShaderErrors: true });
  assert.equal(checked.debug.checkShaderErrors, true);
});

test("a resolution scale draws the scene smaller while the canvas keeps its size (resizing a canvas stalls the GPU)", () => {
  const { engine, fake, posts } = make();
  engine.resize(200, 100, 2);
  engine.resize(200, 100, 2, 0.5);
  assert.deepEqual(fake.calls.sizes, [[400, 200]], "the canvas was sized once");
  assert.deepEqual([engine.target.width, engine.target.height], [200, 100]);
  assert.deepEqual(posts.at(-1).sizes.at(-1), [200, 100]);
});

test("the post chain presents over the whole canvas, whatever the scale", () => {
  const { engine, fake } = make();
  engine.resize(200, 100, 2, 0.5);
  engine.present(new THREE.PerspectiveCamera(), { exposure: 1 });
  assert.deepEqual(fake.calls.viewports.at(-1), [0, 0, 400, 200]);
});

test("after a warm-up the new shaders are put to first use a few per frame, not all in the frame that needs them", async () => {
  const { engine, fake } = make();
  const used = [];
  const program = (id) => ({ getUniforms: () => used.push(id), getAttributes() {} });
  fake.info = { programs: [1, 2, 3, 4, 5, 6, 7].map(program), render: {}, reset() {} };
  fake.compileAsync = () => Promise.resolve();
  await engine.warm(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.deepEqual(used, [], "none at once");
  engine.beginFrame();
  assert.ok(used.length > 0 && used.length < 7, `a few in a frame (${used.length})`);
  for (let i = 0; i < 7; i += 1) engine.beginFrame();
  assert.deepEqual([...new Set(used)].sort(), [1, 2, 3, 4, 5, 6, 7]);
});
