/**
 * GPU grass in concentric rings around the camera (the Ghost of Tsushima
 * approach). Each ring is a square tile of random blade roots that wraps
 * around the camera, so the field looks endless; near rings are dense and
 * thin, far rings sparse and wide, and neighbours cross-fade by dithering.
 * Height and colour come from textures baked from the ground. Restyled from
 * the reference's `grass-field.js`: ring tables live in `quality.js`, the
 * random roots are injected, flowers are left out.
 */
import * as THREE from "../../../three.js";
import { createOwner } from "./asset.js";
import { GRASS_EMISSIVE, GRASS_FRAGMENT_HEAD, GRASS_VERTEX_BLADE, GRASS_VERTEX_HEAD } from "./grassShader.js";

export { GRASS_GLSL } from "./grassShader.js";

/**
 * @typedef {{r: number, dens: number, w: number, segs: number, h?: number}} GrassRing
 * r outer radius (m), dens roots per square metre, w blade width (m), segs blade segments, h height factor
 */

/**
 * A ring set from a quality level, each ring but the first fading in over the previous ring's outer 20%.
 * @param {readonly GrassRing[]} rings
 * @returns {(GrassRing & {fadeIn: [number, number] | null})[]}
 */
export const ringSet = (rings) => rings.map((ring, i) => ({ ...ring, fadeIn: i ? [rings[i - 1].r * 0.8, rings[i - 1].r] : null }));

/** How many blade roots a ring set plants: the weight of a quality level. */
export const bladeCount = (rings) => rings.reduce((sum, ring) => sum + Math.round(ring.dens * ring.r * 2 * ring.r * 2), 0);

/** A blade: a tapering strip of `segs` quads and a tip, standing 1 m high, 1 m wide at the base. */
function bladeGeometry(segs) {
  const position = [];
  const index = [];
  for (let i = 0; i <= segs; i += 1) {
    const y = i / segs;
    const w = 0.5 * Math.pow(1 - y, 0.85);
    if (i < segs) position.push(-w, y, 0, w, y, 0);
    else position.push(0, 1, 0);
  }
  for (let i = 0; i < segs - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const t = (segs - 1) * 2;
  index.push(t, t + 1, t + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * One ring of grass.
 * @param {object} options
 * @param {ReturnType<typeof ringSet>[number]} options.ring
 * @param {number} options.world side of the ground textures in metres
 * @param {number} options.res texels per side of the ground textures
 * @param {import("../../../three.js").Texture} options.heightTex red: ground height (float)
 * @param {import("../../../three.js").Texture} options.colorTex rgb: ground colour, alpha: grass density
 * @param {ReturnType<typeof import("../materials.js").createSharedUniforms>} options.uniforms
 * @param {() => number} options.random source of the roots' scatter
 * @param {import("../../scene/tracker.js").Tracker["track"]} options.track
 * @param {number} [options.bladeHeight] metres of a full-density blade
 * @returns {{object: import("../../../three.js").Mesh, uniforms: object, update: (camera: import("../../../three.js").Vector3) => void, dispose: () => void}}
 */
export function createGrassRing({ ring, world, res, heightTex, colorTex, uniforms: shared, random, track, bladeHeight = 0.5 }) {
  const owner = createOwner(track);
  const tile = ring.r * 2;
  const count = Math.max(1, Math.round(ring.dens * tile * tile));
  const base = bladeGeometry(ring.segs);
  const geometry = owner.own(new THREE.InstancedBufferGeometry());
  geometry.setIndex(base.index);
  geometry.setAttribute("position", base.attributes.position);
  const roots = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) roots.set([random() * tile, random() * tile, random()], i * 3);
  geometry.setAttribute("aOff", new THREE.InstancedBufferAttribute(roots, 3));
  geometry.instanceCount = count;
  const material = owner.own(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.62, metalness: 0 }));
  const fade = ring.fadeIn ?? [-1, 0];
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uSize: { value: tile },
    uROut: { value: ring.r },
    uFadeIn: { value: new THREE.Vector2(fade[0], fade[1]) },
    uWorld: { value: world },
    uRes: { value: res },
    uH: { value: heightTex },
    uC: { value: colorTex },
    uBlade: { value: bladeHeight * (ring.h ?? 1) },
    uBladeW: { value: ring.w },
    uTime: shared.time,
    uWind: shared.wind,
    uGlow: { value: 0.1 },
    uSunDirV: shared.sunDirV,
    uSunCol: shared.sunCol,
    uCSK: shared.cloudShadow,
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = GRASS_VERTEX_HEAD + shader.vertexShader.replace("#include <color_vertex>", "").replace("#include <beginnormal_vertex>", GRASS_VERTEX_BLADE).replace("#include <begin_vertex>", "vec3 transformed = gPos;"); // i18n-ok
    shader.fragmentShader = GRASS_FRAGMENT_HEAD + shader.fragmentShader
      .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb = vGCol;")
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n normal = normalize(vNormal);")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n gl_FragColor = clamp(gl_FragColor, vec4(0.0), vec4(8.0, 8.0, 8.0, 1.0));")
      .replace("#include <emissivemap_fragment>", GRASS_EMISSIVE); // i18n-ok
  };
  material.customProgramCacheKey = () => `grass${ring.segs}`;
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  object.receiveShadow = true;
  base.dispose();
  return { object, uniforms, ring, update: (camera) => uniforms.uCam.value.copy(camera), dispose: () => owner.disposeAll() };
}
