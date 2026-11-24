/**
 * Material hooks: small `onBeforeCompile` patches that stack on one material
 * (painted grain, drifting cloud shadows, height fog). Ported from the
 * reference renderer; its module-level uniforms and texture cache became
 * `createSharedUniforms()` and `createGrainTexture()`, owned by the scene.
 */
import * as THREE from "../../three.js";
import { CLOUD_GLSL, CLOUD_VERTEX, GRAIN_BUMP_GLSL, GRAIN_VERTEX, HEIGHT_FOG_FRAGMENT, HEIGHT_FOG_VERTEX } from "./shaderChunks.js";

/**
 * A shader patch. `key` tells Three's program cache that patched and plain
 * materials differ.
 * @typedef {((shader: {uniforms: object, vertexShader: string, fragmentShader: string}) => void) & {key?: string}} Hook
 */

/**
 * Stacks a hook on a material; every hook runs, in the order added.
 * @param {import("../../three.js").Material} material
 * @param {Hook} hook
 * @returns {import("../../three.js").Material} the same material
 */
export function addHook(material, hook) {
  const data = material.userData;
  (data.hooks ??= []).push(hook);
  data.hookKey = `${data.hookKey ?? ""}|${hook.key ?? data.hooks.length}`;
  material.onBeforeCompile = (shader) => data.hooks.forEach((each) => each(shader));
  material.customProgramCacheKey = () => data.hookKey;
  return material;
}

/**
 * The uniforms the hooks share across a scene's materials.
 * @returns {{time: {value: number}, wind: {value: number}, cloudShadow: {value: number},
 *   fogBase: {value: number}, fogFalloff: {value: number},
 *   sunDirV: {value: import("../../three.js").Vector3}, sunCol: {value: import("../../three.js").Color}}}
 */
export function createSharedUniforms() {
  return {
    time: { value: 0 },
    wind: { value: 1 },
    cloudShadow: { value: 0 },
    fogBase: { value: 0 },
    fogFalloff: { value: 0.004 },
    sunDirV: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color(1, 0.95, 0.85) },
  };
}

/** Tileable value noise of `cells` cells over `size` texels, from an injected random source. */
function tileNoise(size, cells, random) {
  const grid = Array.from({ length: cells * cells }, random);
  const at = (x, y) => grid[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      let tx = fx - ix;
      let ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      out[y * size + x] = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
    }
  }
  return out;
}

/**
 * The grain texture: red is fine mottling, green broad blotches. Deterministic.
 * @param {number} [size]
 * @returns {import("../../three.js").DataTexture}
 */
export function createGrainTexture(size = 256) {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const fine = [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.07], [64, 0.03]].map(([cells, weight]) => [tileNoise(size, cells, random), weight]);
  const broad = [[2, 0.6], [4, 0.3], [8, 0.1]].map(([cells, weight]) => [tileNoise(size, cells, random), weight]);
  const data = new Uint8Array(size * size * 4);
  const sum = (layers, i) => Math.min(255, layers.reduce((total, [noise, weight]) => total + noise[i] * weight, 0) * 255);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = sum(fine, i);
    data[i * 4 + 1] = sum(broad, i);
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Painted detail: tri-planar world-space grain multiplied into the albedo, and
 * a bump from it that fades with distance.
 * @param {{texture: import("../../three.js").Texture, scale?: number, strength?: number, scale2?: number, strength2?: number, bump?: number}} options
 * @returns {Hook}
 */
export function grain({ texture, scale = 0.6, strength = 0.45, scale2 = 0, strength2 = 0, bump = 1 }) {
  const hook = (shader) => {
    shader.uniforms.uGrain = { value: texture };
    shader.vertexShader = `varying vec3 vGW; varying vec3 vGN;\n${shader.vertexShader.replace("#include <project_vertex>", GRAIN_VERTEX)}`; // i18n-ok
    const broadGrain = scale2 > 0 ? `float gc = texture2D(uGrain, vGW.xz * ${scale2.toFixed(5)}).g; diffuseColor.rgb *= mix(1.0, 0.7 + gc * 0.6, ${strength2.toFixed(3)});` : ""; // i18n-ok
    const bumpCode = bump > 0 ? `{ float fade = 1.0 - smoothstep(25.0, 90.0, length(vViewPosition)); normal = gBump(-vViewPosition, normal, vec2(dFdx(gGrain), dFdy(gGrain)) * ${(bump * strength).toFixed(3)} * fade); }` : ""; // i18n-ok
    const albedo = `#include <color_fragment>
      float gGrain = 0.5;
      {
        vec3 bw = pow(abs(normalize(vGN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z + 1e-5);
        float S = ${scale.toFixed(4)};
        float gt = texture2D(uGrain, vGW.zy * S).r * bw.x + texture2D(uGrain, vGW.xz * S).r * bw.y + texture2D(uGrain, vGW.xy * S).r * bw.z;
        gGrain = gt;
        diffuseColor.rgb *= mix(1.0, 0.5 + gt * 1.0, ${strength.toFixed(3)});
        ${broadGrain}
      }`;
    const normal = `#include <normal_fragment_maps>
      ${bumpCode}`;
    shader.fragmentShader = `uniform sampler2D uGrain; varying vec3 vGW; varying vec3 vGN;\n${GRAIN_BUMP_GLSL}${shader.fragmentShader.replace("#include <color_fragment>", albedo).replace("#include <normal_fragment_maps>", normal)}`; // i18n-ok
  };
  return Object.assign(hook, { key: `g${scale}_${strength}_${scale2}_${strength2}_${bump}` });
}

/**
 * Soft cloud shadows drifting over the land, multiplied into the albedo.
 * @param {ReturnType<typeof createSharedUniforms>} uniforms
 * @returns {Hook}
 */
export function cloudShadows(uniforms) {
  const hook = (shader) => {
    shader.uniforms.uCST = uniforms.time;
    shader.uniforms.uCSK = uniforms.cloudShadow;
    shader.vertexShader = `varying vec2 vCSW;\n${shader.vertexShader.replace("#include <project_vertex>", CLOUD_VERTEX)}`; // i18n-ok
    shader.fragmentShader = `uniform float uCST, uCSK; varying vec2 vCSW;\n${CLOUD_GLSL}${shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb *= cloudShade(vCSW, uCST, uCSK);")}`; // i18n-ok
  };
  return Object.assign(hook, { key: "cloud" });
}

/**
 * Fog that thins out with height: valleys get hazier than hilltops.
 * @param {ReturnType<typeof createSharedUniforms>} uniforms
 * @returns {Hook}
 */
export function heightFog(uniforms) {
  const hook = (shader) => {
    shader.uniforms.uHFBase = uniforms.fogBase;
    shader.uniforms.uHFFall = uniforms.fogFalloff;
    shader.vertexShader = `varying vec3 vHFW;\n${shader.vertexShader.replace("#include <project_vertex>", HEIGHT_FOG_VERTEX)}`; // i18n-ok
    shader.fragmentShader = `uniform float uHFBase, uHFFall; varying vec3 vHFW;\n${shader.fragmentShader.replace("#include <fog_fragment>", HEIGHT_FOG_FRAGMENT)}`; // i18n-ok
  };
  return Object.assign(hook, { key: "hfog" });
}
