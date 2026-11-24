import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { ThreeRenderer } from "../public/js/view3d/threeRenderer.js";
import { fakeRenderer } from "./support/fakeRenderer.js";

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

test("each mesh asks Three to re-upload the shared material's uniforms", () => {
  const { renderer, fake } = make();
  const seen = [];
  fake.render = (scene) => {
    for (const child of scene.children) {
      child.material.uniformsNeedUpdate = false;
      child.material.onBeforeRender(fake, scene, null, child.geometry, child);
      seen.push(child.material.uniformsNeedUpdate);
    }
  };
  renderer.begin(frame());
  renderer.draw(renderer.upload(mesh("one")), identity);
  renderer.drawTransparent(renderer.upload(mesh("two")), identity, { alpha: 0.5 });
  renderer.end();
  assert.deepEqual(seen.slice(1), [true, true]);
});

test("every material keeps the own renderer's LESS depth test, so the far-plane sky stays hidden", () => {
  const { renderer } = make();
  for (const material of [renderer.meshMaterial, renderer.transparentMaterial, renderer.skyMaterial, renderer.depthMaterial]) {
    assert.equal(material.depthFunc, THREE.LessDepth);
  }
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
  fake.calls.clears.length = 0;
  renderer.viewport({ x: 10, y: 20, width: 300, height: 200 });
  renderer.begin(frame());
  renderer.end();
  assert.deepEqual(fake.calls.clears, [
    { scissorTest: true, scissor: [10, 20, 300, 200], viewport: [10, 20, 300, 200], target: null },
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

test("an uploaded mesh draws exactly its vertices", () => {
  const { renderer } = make();
  const handle = renderer.upload(mesh("one"));
  assert.equal(handle.geometry.drawRange.count, 3);
});

test("the camera uses the frame's view and projection", () => {
  const { renderer } = make();
  renderer.begin(frame());
  assert.deepEqual([...renderer.camera.matrixWorldInverse.elements], [...view]);
  assert.deepEqual([...renderer.camera.projectionMatrix.elements], [...projection]);
});

test("shadow casters render into the shadow target before the main pass", () => {
  const { renderer, fake } = make();
  assert.equal(renderer.createShadowMap(1024), true);
  const target = renderer.shadow.target;
  // Creating the map clears it once; the test is about the passes after that.
  fake.calls.targets.length = 0;
  renderer.beginShadows(identity);
  renderer.drawShadowCaster(renderer.upload(mesh("caster")), identity);
  renderer.endShadows();
  renderer.begin(frame());
  renderer.end();
  assert.deepEqual(fake.calls.renders, [["caster"], ["sky"]]);
  assert.deepEqual(fake.calls.targets, [target, null]);
  assert.deepEqual(fake.calls.renderTargets, [target, null]);
});

test("without a shadow pass the strength is zero", () => {
  const { renderer } = make();
  renderer.createShadowMap();
  renderer.begin(frame({ shadowStrength: 0.6 }));
  assert.equal(renderer.meshMaterial.uniforms.u_shadowStrength.value, 0);
  renderer.end();
});

test("a shadow pass turns the strength on for the main pass", () => {
  const { renderer } = make();
  renderer.createShadowMap();
  renderer.beginShadows(identity);
  renderer.endShadows();
  renderer.begin(frame({ shadowStrength: 0.6 }));
  assert.equal(renderer.meshMaterial.uniforms.u_shadowStrength.value, 0.6);
  renderer.end();
});

test("an overlay pass neither clears nor draws the sky", () => {
  const { renderer, fake } = make();
  fake.calls.clears.length = 0;
  renderer.begin(frame({ overlay: true }));
  renderer.draw(renderer.upload(mesh("rider")), identity);
  renderer.end();
  assert.equal(fake.calls.clears.length, 0);
  assert.deepEqual(fake.calls.renders, [["rider"]]);
});

test("an overlay pass draws into the engine's target", () => {
  const { renderer, fake } = make();
  const target = new THREE.WebGLRenderTarget(4, 4);
  fake.setRenderTarget(target);
  renderer.begin(frame({ overlay: true }));
  renderer.end();
  assert.deepEqual(fake.calls.renderTargets, [target]);
});

test("the shadow pass hands the target back", () => {
  const { renderer, fake } = make();
  renderer.createShadowMap(512);
  const target = new THREE.WebGLRenderTarget(4, 4);
  fake.setRenderTarget(target);
  renderer.beginShadows(identity);
  renderer.drawShadowCaster(renderer.upload(mesh("caster")), identity);
  renderer.endShadows();
  assert.equal(fake.calls.targets.at(-1), target);
});

test("a pass hands the target back as well", () => {
  const { renderer, fake } = make();
  const target = new THREE.WebGLRenderTarget(4, 4);
  fake.setRenderTarget(target);
  renderer.begin(frame({ overlay: true }));
  renderer.end();
  assert.equal(fake.calls.targets.at(-1), target);
});

test("overlay output is linear, a plain pass is display-ready", () => {
  const { renderer } = make();
  renderer.begin(frame({ overlay: true }));
  assert.equal(renderer.meshMaterial.uniforms.u_linearOut.value, 1);
  assert.equal(renderer.transparentMaterial.uniforms.u_linearOut.value, 1);
  renderer.end();
  renderer.begin(frame());
  assert.equal(renderer.meshMaterial.uniforms.u_linearOut.value, 0);
  renderer.end();
});

test("the mesh shader linearises its output when asked", () => {
  const { renderer } = make();
  assert.match(renderer.meshMaterial.fragmentShader, /u_linearOut > 0\.5\)\s*outColor\.rgb = pow\(outColor\.rgb, vec3\(2\.2\)\)/);
});

test("a shared renderer outlives the adapter", () => {
  const fake = fakeRenderer();
  new ThreeRenderer(null, { renderer: fake }).destroy();
  assert.equal(fake.calls.disposed, 0);
});

test("an own renderer goes with the adapter", () => {
  const { renderer, fake } = make();
  renderer.destroy();
  assert.equal(fake.calls.disposed, 1);
});

test("the adapter's ambient sky is the whitened horizon by day and the dark zenith at night", async () => {
  const { ambientSky } = await import("../public/js/view3d/threeRenderer.js");
  const day = ambientSky([0.08, 0.34, 0.8], [0.56, 0.78, 1.0]);
  assert.ok(Math.abs(day[0] - day[2]) < 0.35, `a pale, nearly neutral fill, not navy: ${day}`);
  assert.ok(day[0] > 0.6, `bright: ${day}`);
  assert.deepEqual(ambientSky([0.03, 0.06, 0.17], [0.06, 0.11, 0.25]).map((c) => +c.toFixed(2)), [0.03, 0.06, 0.17]);
});
