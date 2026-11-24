import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { engineFor } from "../public/js/view3d/engine/engine.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { fakeRenderer } from "./support/fakeRenderer.js";

/** An engine on a fake renderer; `post` records what the chain was asked. */
function make(canvas = {}) {
  const fake = fakeRenderer();
  const posts = [];
  const createPost = (renderer, target, settings) => {
    const post = { settings, rendered: [], sizes: [], disposed: 0, render: (camera, env, options) => post.rendered.push({ camera, env, options, target: renderer.getRenderTarget() }), setSize: (w, h) => post.sizes.push([w, h]), dispose: () => (post.disposed += 1) };
    posts.push(post);
    return post;
  };
  const engine = engineFor(canvas, { createRenderer: () => fake, createPost });
  return { engine, fake, posts };
}

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
