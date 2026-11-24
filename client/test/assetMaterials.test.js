import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { addHook, cloudShadows, createGrainTexture, createSharedUniforms, grain, heightFog } from "../public/js/view3d/assets/materials.js";

const shader = () => ({
  uniforms: {},
  vertexShader: "#include <project_vertex>\n#include <begin_vertex>",
  fragmentShader: "#include <color_fragment>\n#include <normal_fragment_maps>\n#include <fog_fragment>",
});

test("hooks stack on one material and all run", () => {
  const material = new THREE.MeshStandardMaterial();
  const ran = [];
  const one = Object.assign(() => ran.push("one"), { key: "a" });
  const two = Object.assign(() => ran.push("two"), { key: "b" });
  addHook(material, one);
  addHook(material, two);
  material.onBeforeCompile(shader());
  assert.deepEqual(ran, ["one", "two"]);
});

test("stacked hooks give the program its own cache key", () => {
  const a = addHook(new THREE.MeshStandardMaterial(), Object.assign(() => {}, { key: "a" }));
  const ab = addHook(addHook(new THREE.MeshStandardMaterial(), Object.assign(() => {}, { key: "a" })), Object.assign(() => {}, { key: "b" }));
  assert.notEqual(a.customProgramCacheKey(), ab.customProgramCacheKey());
});

test("shared uniforms are made per call, not shared between scenes", () => {
  const one = createSharedUniforms();
  const two = createSharedUniforms();
  one.time.value = 5;
  assert.equal(two.time.value, 0);
  assert.notEqual(one.sunCol, two.sunCol);
});

test("cloud shadows read the shared time and strength", () => {
  const uniforms = createSharedUniforms();
  const sh = shader();
  cloudShadows(uniforms)(sh);
  assert.equal(sh.uniforms.uCST, uniforms.time);
  assert.equal(sh.uniforms.uCSK, uniforms.cloudShadow);
  assert.match(sh.fragmentShader, /cloudShade\(vCSW/);
});

test("height fog thins the fog with height", () => {
  const uniforms = createSharedUniforms();
  const sh = shader();
  heightFog(uniforms)(sh);
  assert.equal(sh.uniforms.uHFBase, uniforms.fogBase);
  assert.match(sh.fragmentShader, /uHFFall/);
  assert.doesNotMatch(sh.fragmentShader, /#include <fog_fragment>/);
});

test("grain only adds a bump when asked", () => {
  const texture = createGrainTexture();
  const bumped = shader();
  grain({ texture })(bumped);
  const flat = shader();
  grain({ texture, bump: 0 })(flat);
  assert.match(bumped.fragmentShader, /gBump\(-vViewPosition/);
  assert.doesNotMatch(flat.fragmentShader, /gBump\(-vViewPosition/);
  assert.equal(bumped.uniforms.uGrain.value, texture);
});

test("different grain settings do not share a program", () => {
  const texture = createGrainTexture();
  assert.notEqual(grain({ texture, strength: 0.4 }).key, grain({ texture, strength: 0.2 }).key);
});

test("the grain texture is a repeating square", () => {
  const texture = createGrainTexture();
  assert.equal(texture.image.width, 256);
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
});
